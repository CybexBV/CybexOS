# Reading update history and build logs without a password (docs/updates.md):
# in the administrator's own active session, `cybex update history` and
# `cybex update log` run their root helper through pkexec without a prompt,
# so Wiz's research doesn't ask again for every command. Changes still ask,
# and an account outside wheel is refused.
{ pkgs, module }:
pkgs.testers.runNixOSTest {
  name = "cybexos-update-records";
  # A hang fails here, not after the driver's hour (and its retry): about
  # three times this test's run in the full check, at least 10 minutes.
  globalTimeout = 600;
  nodes.machine = { lib, ... }: {
    imports = [ module ];
    cybexos = {
      enable = true; primaryUser = "tester";
      features = { proprietary = false; steam = false; docker = false; };
    };
    users.users.tester.initialPassword = "qualification-only";
    users.users.other = { isNormalUser = true; initialPassword = "qualification-only"; };
    # A local, active login session, as at the computer.
    services.getty.autologinUser = "tester";
    networking.hostName = "machine";
    boot.loader.systemd-boot.enable = lib.mkForce false;
    system.stateVersion = "26.05";
    virtualisation = { memorySize = 4096; cores = 4; qemu.options = [ "-no-user-config" ]; };
  };
  testScript = ''
    import json

    tx = "0123456789abcdef0123456789abcdef"
    machine.start()
    machine.wait_for_unit("multi-user.target")
    machine.succeed(
        f"install -d -m 0700 /var/lib/cybexos/transactions/{tx}",
        f"echo '{json.dumps({'id': tx, 'scope': 'local'})}' > /var/lib/cybexos/transactions/{tx}/deployment.json",
        f"echo 'private module diagnostics' > /var/lib/cybexos/transactions/{tx}/build.log",
    )
    # pkexec runs exactly the helper the Polkit action names.
    helper = machine.succeed("realpath /run/current-system/sw/bin/cybexos-update-records").strip()
    machine.succeed(f"pkaction --action-id org.cybexos.update-records --verbose | grep -F 'org.freedesktop.policykit.exec.path -> {helper}'")

    # Commands typed in the session itself, whatever the login shell is. No
    # Polkit agent runs there: a request that needs a password fails.
    machine.wait_until_succeeds("loginctl show-user tester -p State --value | grep -qx active")
    probe = "\n".join([
        "out=/tmp/probe",
        "cybex update history --json > $out/history.json 2> $out/history.err",
        f"cybex update log {tx} > $out/log.txt 2> $out/log.err",
        f"cybex update log {tx[:8]} > $out/short.txt 2> $out/short.err",
        "pkcheck --action-id org.cybexos.update-records --process $$; echo $? > $out/read.rc",
        "pkcheck --action-id org.cybexos.passwordless-sudo --process $$; echo $? > $out/change.rc",
        "touch $out/done",
    ])
    machine.succeed(f"echo '{probe}' > /tmp/probe.sh", "install -d -o tester /tmp/probe")
    machine.send_chars("sh /tmp/probe.sh\n")
    machine.wait_for_file("/tmp/probe/done")

    records = json.loads(machine.succeed("cat /tmp/probe/history.json"))
    assert [record["id"] for record in records] == [tx], (records, machine.succeed("cat /tmp/probe/history.err"))
    assert "private module diagnostics" in machine.succeed("cat /tmp/probe/log.txt"), machine.succeed("cat /tmp/probe/log.err")
    # A short ID reads the history first, then the log: still no prompt.
    assert "private module diagnostics" in machine.succeed("cat /tmp/probe/short.txt"), machine.succeed("cat /tmp/probe/short.err")
    assert machine.succeed("cat /tmp/probe/read.rc").strip() == "0"
    # Changing the system still needs the administrator password.
    assert machine.succeed("cat /tmp/probe/change.rc").strip() != "0"

    # Someone outside wheel reads nothing.
    machine.fail("runuser -u other -- cybex update history --json")
    machine.fail("runuser -u other -- cybex update log " + tx)
  '';
}
