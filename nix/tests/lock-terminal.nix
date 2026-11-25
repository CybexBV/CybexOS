# A signed-in Cybex OS desktop: the lock screen shows no Wiz beside its
# password field, and Wiz is in kitty, the default terminal, when fastfetch is
# typed at its fish prompt.
#
# The session locks as it does itself (cybexos-session-lock.service runs
# `cybexos-runtime exec hyprlock`), first with the lock screen the shell's
# system theme rendered, then with the vendor file, and is unlocked with the
# password each time. kitty is started through Hyprland, so its shell is
# kitty's own child, as on a desktop.
#
# Test-only settings: SDDM signs the user in directly (Cybex OS's own
# automatic login requires verified LUKS) and the display is fixed at
# 1280×800. This is VM qualification, not of physical displays.
{ pkgs, module }:
pkgs.testers.runNixOSTest {
  name = "cybexos-lock-terminal";
  extraPythonPackages = p: [ p.pillow ];
  nodes.machine = { lib, ... }: {
    imports = [ module ];
    cybexos = { enable = true; primaryUser = "tester"; features = { proprietary = false; steam = false; docker = false; }; };
    networking.hostName = "machine";
    users.users.tester.initialPassword = "qualification-only";
    services.displayManager.autoLogin = { enable = true; user = "tester"; };
    virtualisation = {
      memorySize = 8192;
      cores = 8;
      graphics = true;
      diskSize = 4096;
      qemu.options = [ "-no-user-config" "-device virtio-vga,xres=1280,yres=800" ];
    };
    system.stateVersion = "26.05";
    boot.loader.systemd-boot.enable = lib.mkForce false;
  };
  testScript = ''
    import time
    from PIL import Image

    out = machine.out_dir

    machine.start()
    machine.wait_for_unit("display-manager.service")
    uid = machine.succeed("id -u tester").strip()
    session = f"XDG_RUNTIME_DIR=/run/user/{uid} HOME=/home/tester DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/{uid}/bus"

    def user(command):
        return machine.succeed(f"runuser -u tester -- env {session} {command}")

    def locked():
        return machine.execute(f"runuser -u tester -- env {session} hyprctl -i 0 locked")[1].strip() == "true"

    def wait(predicate, timeout):
        deadline = time.monotonic() + timeout
        while not predicate():
            assert time.monotonic() < deadline, "timed out"
            time.sleep(0.5)

    def pixels(name, box, colour, tolerance):
        """How many pixels in `box` of a screenshot are within `tolerance` of `colour`."""
        data = Image.open(out / f"{name}.png").convert("RGB").crop(box).tobytes()
        return sum(1 for i in range(0, len(data), 3)
                   if all(abs(data[i + c] - colour[c]) <= tolerance for c in range(3)))

    machine.wait_until_succeeds(f"runuser -u tester -- env {session} systemctl --user is-active quickshell.service", timeout=600)
    machine.wait_until_succeeds(f"runuser -u tester -- env {session} cybexos-runtime ipc welcome status", timeout=300)
    # The first sign-in's welcome guide would cover the terminal.
    time.sleep(5)
    user("cybexos-runtime ipc welcome close")
    machine.fail("test -e /run/current-system/sw/share/cybexos/wiz/lock")
    machine.succeed("test -s /run/current-system/sw/share/cybexos/wiz/terminal/idle.png")

    # ---- the lock screen ---------------------------------------------------
    # Right of the field, where Wiz used to sleep: the field ends at x 790 in
    # a 1280x800 output. Nothing there may be his hat band's brand red.
    WIZ = (790, 360, 875, 460)
    RED = (0xDC, 0x1E, 0x37)
    themed = "/home/tester/.local/state/cybexos/theme/hyprlock.conf"
    machine.wait_until_succeeds(f"test -s {themed}", timeout=120)

    def lock(name):
        machine.execute(f"runuser -u tester -- env {session} systemctl --user reset-failed cybexos-session-lock.service")
        user("systemctl --user start cybexos-session-lock.service")
        wait(locked, 30)
        time.sleep(3)
        machine.screenshot(name)
        rendered = machine.succeed(f"cat /run/user/{uid}/cybexos/hyprlock.conf")
        (out / f"{name}.conf").write_text(rendered)
        assert "image {" not in rendered and "wiz" not in rendered.lower(), rendered
        band = pixels(name, WIZ, RED, 40)
        machine.log(f"{name}: {band} hat band pixels right of the field")
        assert band == 0, f"{name}: Wiz is still beside the field ({band} pixels)"
        machine.send_chars("qualification-only\n")
        wait(lambda: not locked(), 30)
        time.sleep(1)

    lock("lock-themed")
    machine.succeed(f"head -n1 /run/user/{uid}/cybexos/hyprlock.conf | grep -F 'theme_hyprlock.py'")
    machine.succeed(f"rm {themed}")
    lock("lock-vendor")
    machine.fail(f"grep -F 'theme_hyprlock.py' /run/user/{uid}/cybexos/hyprlock.conf")

    # ---- the terminal --------------------------------------------------------
    user("hyprctl -i 0 dispatch 'hl.dsp.exec_cmd(\"kitty\")'")
    machine.wait_until_succeeds(f"runuser -u tester -- env {session} hyprctl -i 0 -j clients | grep -q '\"class\": \"kitty\"'", timeout=60)
    time.sleep(5)

    # ---- the prompt icon -------------------------------------------------------
    # The shell writes the Control Center button's icon for fish, by default
    # the Cybex OS mark, which only Cybex OS Symbols has; kitty reaches it
    # through fontconfig. Switched to "os", the next prompt shows NixOS's.
    icon_file = "/home/tester/.local/state/cybexos/prompt-icon"
    machine.wait_until_succeeds(f"test -s {icon_file}", timeout=60)
    assert machine.succeed(f"cat {icon_file}") == "\U001000CB\n", machine.succeed(f"od -c {icon_file}")
    machine.succeed("fc-list ':charset=1000cb' family | grep -Fx 'Cybex OS Symbols'")
    PROMPT = (0, 40, 400, 120)
    machine.send_chars("clear\n")
    time.sleep(2)
    machine.screenshot("prompt-cybexos")
    machine.succeed(f"cp {icon_file} /tmp/prompt-icon")
    machine.succeed(f"runuser -u tester -- sh -c 'printf \"os\\n\" > {icon_file}'")
    machine.send_chars("clear\n")
    time.sleep(2)
    machine.screenshot("prompt-os")
    mark, logo = (Image.open(out / f"{name}.png").convert("RGB").crop(PROMPT).tobytes()
                  for name in ("prompt-cybexos", "prompt-os"))
    differ = sum(1 for i in range(0, len(mark), 3) if mark[i:i + 3] != logo[i:i + 3])
    machine.log(f"prompt icon: {differ} pixels changed between the Cybex OS and NixOS icons")
    assert differ > 20, f"the prompt did not follow its icon file ({differ} pixels)"
    machine.send_chars("clear\n")
    time.sleep(1)
    machine.send_chars("fastfetch\n")
    time.sleep(8)
    machine.screenshot("terminal-kitty")
    # Wiz's hat crown, a colour the braille logo does not use, in the left
    # part of the window, where the logo is.
    crown = pixels("terminal-kitty", (0, 0, 640, 800), (0x35, 0x3A, 0x43), 6)
    machine.log(f"terminal-kitty: {crown} hat crown pixels")
    assert crown > 200, f"Wiz is not in kitty's fastfetch ({crown} pixels)"

    # ---- where the mark sits -------------------------------------------------
    # kitty draws the mark at its own size from the left of its cell, so Cybex
    # OS Symbols places it for the prompt: in the middle of its dark segment,
    # across and down. Measured in a large kitty, where a few font units are
    # whole pixels. Across, the segment's body runs from the tip of the notch
    # on its left to the base of the arrow on its right.
    machine.succeed(f"cat /tmp/prompt-icon > {icon_file}")
    machine.send_chars("exit\n")
    machine.wait_until_fails(f"runuser -u tester -- env {session} hyprctl -i 0 -j clients | grep -q '\"class\": \"kitty\"'", timeout=30)
    user("hyprctl -i 0 dispatch 'hl.dsp.exec_cmd(\"kitty -o font_size=28 -o background_opacity=1\")'")
    machine.wait_until_succeeds(f"runuser -u tester -- env {session} hyprctl -i 0 -j clients | grep -q '\"class\": \"kitty\"'", timeout=60)
    time.sleep(5)
    machine.send_chars("clear\n")
    time.sleep(2)
    machine.screenshot("prompt-centre")
    image = Image.open(out / "prompt-centre.png").convert("RGB")
    width, height = image.size
    data = image.tobytes()
    rgb = lambda x, y: tuple(data[(y * width + x) * 3:(y * width + x) * 3 + 3])
    SEGMENT, PATH, TEXT = (0x28, 0x2A, 0x36), (0xCC, 0xCC, 0xCC), (0xF8, 0xF8, 0xF2)
    near = lambda p, c: all(abs(p[i] - c[i]) <= 3 for i in range(3))
    bright = lambda p: sum(p) > (sum(SEGMENT) + sum(TEXT)) / 2
    # Each row's dark span, up to the path segment (a run of its grey: the
    # mark's own edge has grey pixels too). The prompt is the tallest band.
    spans = {}
    for y in range(height):
        line = [rgb(x, y) for x in range(width)]
        end = next((x for x in range(width - 3) if all(near(line[x + i], PATH) for i in range(4))), width)
        dark = [x for x in range(end) if near(line[x], SEGMENT)]
        if len(dark) > 10:
            spans[y] = (dark[0], dark[-1])
    bands = []
    for y in sorted(spans):
        if not bands or y != bands[-1][-1] + 1:
            bands.append([])
        bands[-1].append(y)
    rows = {y: spans[y] for y in max(bands, key=len, default=[])}
    assert len(rows) > 20, f"no prompt segment found ({len(rows)} rows)"
    ink = [(x, y) for y, (left, right) in rows.items() for x in range(left, right + 1) if bright(rgb(x, y))]
    assert ink, "no mark in the prompt segment"
    across = (max(left for left, _ in rows.values()) + min(right for _, right in rows.values())) / 2
    down = (min(rows) + max(rows)) / 2
    mark_x = (min(x for x, _ in ink) + max(x for x, _ in ink)) / 2
    mark_y = (min(y for _, y in ink) + max(y for _, y in ink)) / 2
    machine.log(f"prompt mark: centre ({mark_x}, {mark_y}), segment centre ({across}, {down}), "
                f"segment rows {min(rows)}-{max(rows)}, mark {len(ink)} pixels")
    assert abs(mark_x - across) <= 1.5 and abs(mark_y - down) <= 1.5, \
        f"the mark is off the middle of its segment by ({mark_x - across}, {mark_y - down}) pixels"
  '';
}
