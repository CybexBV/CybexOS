# The installed-desktop audits of Settings and of Omarchy plugin packages, in
# a disposable signed-in Cybex OS desktop.
#
# tests/settings-runtime.py inventories every Settings page and tab and sets
# each of their preferences through the real controls, with the test-only
# IPC target it injects into a private copy of the shell (--prepare; see
# docs/measurements/settings-audit-2026-10-27.md). tests/omarchy-runtime.py
# then installs Omarchy plugin fixtures with `cybex plugin` and drives their
# widgets in the same shell, with a local mpv playing a short tone over MPRIS.
# Both refuse to run outside a guest that carries their marker, hostname and
# QEMU identity, and both require that exactly one managed shell runs.
#
# The extended Settings cases (network, VPN, hotspot and display trials,
# backups and more) need hardware and services a VM test doesn't have; they
# stay with the manual audit.
#
# Test-only settings: SDDM signs the user in directly (Cybex OS's own automatic
# login requires verified LUKS).
{ pkgs, module, source }:
let
  mpv = pkgs.mpv.override { scripts = [ pkgs.mpvScripts.mpris ]; };
in pkgs.testers.runNixOSTest {
  name = "cybexos-settings-audit";
  nodes.machine = { lib, ... }: {
    imports = [ module ];
    cybexos = { enable = true; primaryUser = "cybexqa"; features = { proprietary = false; steam = false; docker = false; }; };
    networking.hostName = "cybexos-qa";
    users.users.cybexqa = { uid = 1000; initialPassword = "qualification-only"; };
    services.displayManager.autoLogin = { enable = true; user = "cybexqa"; };
    virtualisation = {
      memorySize = 6144;
      cores = 4;
      graphics = true;
      diskSize = 4096;
      qemu.options = [ "-no-user-config" ];
      additionalPaths = [ source mpv ];
    };
    system.stateVersion = "26.05";
    boot.loader.systemd-boot.enable = lib.mkForce false;
  };
  testScript = ''
    machine.start()
    machine.wait_for_unit("display-manager.service")
    session = "XDG_RUNTIME_DIR=/run/user/1000 HOME=/home/cybexqa DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus"
    machine.wait_until_succeeds(f"runuser -u cybexqa -- env {session} systemctl --user is-active quickshell.service", timeout=600)
    machine.succeed("touch /run/cybexos-settings-audit")

    def audit(name, command):
        status, output = machine.execute(f"cd /tmp && PYTHONDONTWRITEBYTECODE=1 ${pkgs.python3.interpreter} -B {command} 2>&1")
        machine.log(output)
        machine.copy_from_machine(f"/tmp/{name}.json", "")
        assert status == 0, f"{name} failed; see its report and the log above"

    audit("settings-audit", "${source}/tests/settings-runtime.py --prepare --report /tmp/settings-audit.json")
    audit("omarchy-audit", "${source}/tests/omarchy-runtime.py --mpv ${mpv}/bin/mpv --report /tmp/omarchy-audit.json")
  '';
}
