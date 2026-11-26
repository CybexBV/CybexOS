# The actual request boundary and systemd worker, with fake device hardware.
# No test may flash host firmware. This qualifies firmware-only orchestration;
# physical devices and vendor capsule execution still need hardware testing.
{ pkgs, module }:
let
  # The fake device (nix/tests/firmware-device.py) holds its write until the
  # test has seen the status it publishes mid-write.
  helper = pkgs.writeScript "cybexos-firmware-fixture"
    ("#!${pkgs.python3.interpreter}\n" + builtins.readFile ./firmware-device.py);
in pkgs.testers.runNixOSTest {
  name = "cybexos-firmware";
  nodes.machine = { config, lib, ... }: {
    imports = [ module ];
    cybexos = {
      enable = true; primaryUser = "tester";
      features = { proprietary = false; steam = false; docker = false; };
    };
    users.users.tester.initialPassword = "qualification-only";
    networking.hostName = "machine";
    boot.loader.systemd-boot.enable = lib.mkForce false;
    # The test instrumentation otherwise forces verbose serial logging.
    boot.consoleLogLevel = lib.mkForce 0;
    boot.kernelParams = [ "plymouth.ignore-serial-consoles" ];
    system.stateVersion = "26.05";
    virtualisation = {
      memorySize = 4096; cores = 4; graphics = true;
      qemu.options = [ "-no-user-config" ];
    };
    # Replace only the helper inside the worker's mount namespace. Everything
    # else is the production CLI, request protocol, worker, engine and reader.
    systemd.services."cybexos-update@".serviceConfig.BindReadOnlyPaths = [
      "${helper}:${config.cybexos.desktopPackage}/bin/cybexos-firmware-update"
    ];
  };
  testScript = ''
    import json
    machine.start()
    machine.wait_for_unit("multi-user.target")
    machine.wait_for_unit("display-manager.service")
    machine.wait_for_unit("cybexos-recover.service")
    machine.succeed("cybex update automatic prepare off --json")
    with subtest("the shared quiet defaults reach the running kernel and both boot stages"):
        cmdline = machine.succeed("cat /proc/cmdline").split()
        assert {"quiet", "loglevel=0", "systemd.show_status=false", "rd.systemd.show_status=false"} <= set(cmdline), cmdline
        assert machine.succeed("cut -f1 /proc/sys/kernel/printk").strip() == "0"

    def status():
        return json.loads(machine.succeed("runuser -u tester -- cybex update status --json"))

    def request(arguments):
        accepted = json.loads(machine.succeed("cybexos-request " + arguments))
        assert accepted["accepted"] is True, accepted
        return accepted

    def finish(accepted):
        # The worker records the request's end after its last status and after
        # it releases the operation lock: only then is the next request taken.
        machine.wait_until_succeeds("cybex update request " + accepted["requestId"]
                                    + " | grep -Eq '\"state\": \"(done|failed)\"'")
        record = json.loads(machine.succeed("cybex update request " + accepted["requestId"]))
        assert record["state"] == "done", record

    def published(condition):
        # The worker publishes a status for each device event, so a read after
        # a wait for one field can still predate the event that follows it.
        # Assertions use the very status the wait accepted.
        seen = []
        def check(_):
            seen.append(status())
            return condition(seen[-1])
        retry(check, timeout_seconds=300)
        return seen[-1]

    with subtest("prepare reviews firmware without activating an OS or flashing"):
        before = machine.succeed("readlink -f /run/current-system").strip()
        finish(request("stage firmware"))
        ready = status()
        assert ready["state"] == "ready", ready
        assert ready["scope"] == "firmware", ready
        assert ready["firmware"]["devices"][0]["to"] == "2", ready
        machine.fail("test -e /var/lib/cybexos/qualification-firmware-installed")

    with subtest("the supervised worker publishes progress and finishes independently of clients"):
        accepted = request("apply " + ready["transaction"] + " " + ready["reviewToken"])
        # The device's request is its last event before it holds the write.
        installing = published(lambda value: any(
            item.get("kind") == "immediate" for item in (value.get("firmware") or {}).get("requests", [])))
        assert installing["state"] == "firmware", installing
        assert installing["firmware"]["percent"] == 42, installing
        assert installing["firmware"]["requests"][0]["message"] == "Keep external power connected.", installing
        machine.fail("test -e /var/lib/cybexos/qualification-firmware-installed")
        machine.succeed("touch /var/lib/cybexos/qualification-firmware-continue")
        finish(accepted)
        finished = status()
        assert finished["state"] == "done" and finished["firmware"]["needsReboot"], finished
        assert finished["firmware"]["requests"][0]["kind"] == "post", finished
        machine.succeed("test -e /var/lib/cybexos/qualification-firmware-installed")
        machine.fail("test -e /var/lib/cybexos/pending.json")
        assert machine.succeed("readlink -f /run/current-system").strip() == before
        machine.succeed("systemctl show " + accepted["unit"] + " -p Result | grep -q Result=success")

    with subtest("a new boot clears the firmware restart requirement"):
        machine.shutdown()
        machine.start()
        machine.wait_for_unit("multi-user.target")
        assert status()["firmware"]["needsReboot"] is False
    machine.shutdown()
  '';
}
