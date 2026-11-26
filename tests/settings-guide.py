#!/usr/bin/env python3
""""Show me where" in the real Settings window, under a private headless Sway:
the assistant's settings_show tool (Common/AssistantTools.qml) opens Settings
at a row and a small Wiz points at it (Settings/SettingsGuide.qml). Never
touches a session, the user's config or the host.

Run through nix develop with grim and wtype on PATH, e.g.
  nix develop -c nix shell nixpkgs#grim nixpkgs#wtype -c python3 -B tests/settings-guide.py

It checks the tool's answer and its failures; that Wiz stands at the row and
covers neither its label nor its control at a wide and a narrow window, for
a row near the top and the bottom of a page, inside a folded Advanced group
and in a widget's dialog; that a second call moves him; that reduced motion
puts him there at once; that he holds still once settled; and that each way
of ending works: changing the setting, leaving the page, closing Settings,
another jump, the row going away and the time running out. The same fakes
as tests/settings-pages.py stand in for cybex, hyprctl and the pointer
tools. Only the PNG screenshots survive, and only in
CYBEXOS_SETTINGS_SCREENSHOTS when it is set.
"""
from __future__ import annotations
import atexit
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time

import shell_fonts

ROOT = Path(__file__).resolve().parents[1]
KEEP = os.environ.get('CYBEXOS_SETTINGS_SCREENSHOTS')
OUTPUT = Path(KEEP) if KEEP else Path(tempfile.mkdtemp(prefix='cybexos-settings-guide-'))
if not KEEP:
    atexit.register(shutil.rmtree, OUTPUT, True)

# The Settings pages test's fakes (cybex, the pointer tools, hyprctl) and its
# QML error pattern.
_spec = importlib.util.spec_from_file_location('settings_pages', Path(__file__).with_name('settings-pages.py'))
PAGES = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(PAGES)

TEST_IPC = '''
    function findNamed(item, name) {
        if (!item) return null;
        if (item.objectName === name) return item;
        for (const child of item.children || []) {
            const found = shell.findNamed(child, name);
            if (found) return found;
        }
        if (item.contentItem && item.contentItem !== item) return shell.findNamed(item.contentItem, name);
        return null;
    }
    // The window's root: its content and the overlay that dialogs (and then the guide) open on.
    function guideItem() {
        return shell.findNamed(guideSettings.contentItem.parent || guideSettings.contentItem, "settingsGuide");
    }
    property var toolAnswer: null
    IpcHandler {
        target: "guide-test"
        function point(key: string): void {
            shell.toolAnswer = null;
            AssistantTools.handle("settings_show", { key: key },
                result => shell.toolAnswer = { ok: true, result: result },
                error => shell.toolAnswer = { ok: false, error: error });
        }
        function answer(): string { return JSON.stringify(shell.toolAnswer); }
        function state(): string {
            const guide = shell.guideItem();
            const figure = guide ? shell.findNamed(guide, "settingsGuideWiz") : null;
            const ring = guide ? shell.findNamed(guide, "settingsGuideRing") : null;
            const measured = guide ? guide.measure() : null;
            const window = guideSettings.contentItem;
            const box = figure ? figure.mapToItem(guide, 0, 0) : null;
            const row = guide && guide.row ? guide.row : null;
            return JSON.stringify({
                key: Settings.guideKey, state: Settings.guideState, ended: Settings.guideEnded,
                page: Settings.page, tab: Settings.tab, open: Settings.panelOpen,
                shown: guide ? guide.shown : false, leaving: guide ? guide.leaving : false,
                inView: guide ? guide.inView : false, inOverlay: guide ? guide.parent === guide.overlay : false,
                spot: guide ? guide.spot : null,
                wiz: figure ? { x: box.x, y: box.y, width: figure.width, height: figure.height,
                    opacity: figure.opacity, visible: figure.visible, pose: figure.pose, facing: figure.facing,
                    animating: figure.animating } : null,
                ring: ring ? { visible: ring.visible, width: ring.width, height: ring.height } : null,
                row: measured ? measured.row : null, label: measured ? measured.label : null,
                controls: measured ? measured.controls : [], area: measured ? measured.area : null,
                highlighted: row && row.highlighted !== undefined ? row.highlighted : null,
                rowVisible: row ? row.visible : false,
                windowWidth: window.width, windowHeight: window.height });
        }
        function setValue(key: string, json: string): void { Settings.set(key, JSON.parse(json)); }
        function toggle(key: string): void { Settings.set(key, !Settings[key]); }
        function showPage(id: string): void { Settings.page = id; }
        function close(): void { Settings.closePanel(); }
        function highlight(key: string): void { Settings.highlightKey = ""; Settings.highlightKey = key; }
        function timeout(ms: int): void { Settings.guideTimeout = ms; }
        function scrollPage(y: real): void {
            const guide = shell.guideItem();
            if (guide && guide.page) guide.page.contentY = y;
        }
        function closeDialogs(): void {
            const view = shell.findNamed(guideSettings.contentItem, "settingsView");
            view.handleEscape();
        }
        function mark(text: string): void { console.log("TEST-MARK " + text); }
    }'''


def intersects(a, b):
    return a['x'] < b['x'] + b['width'] and b['x'] < a['x'] + a['width'] \
        and a['y'] < b['y'] + b['height'] and b['y'] < a['y'] + a['height']


def main():
    for executable in ('qs', 'sway', 'grim', 'cmake', 'node'):
        if not shutil.which(executable):
            raise SystemExit(f'{executable} is required; use nix develop with grim')
    lua = next((name for name in (os.environ.get('CYBEXOS_TEST_LUA'), 'lua', 'lua5.4', 'luajit')
                if name and shutil.which(name)), None)
    if not lua:
        raise SystemExit('Lua is required; use nix develop')
    PAGES.EDITOR.process_guard()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    processes = []
    with tempfile.TemporaryDirectory(prefix='private-', dir=OUTPUT) as temporary, \
            tempfile.TemporaryDirectory(prefix='cxw-', dir='/tmp') as runtime_directory:
        base = Path(temporary)
        runtime, home = Path(runtime_directory), base / 'home'
        (runtime / 'cybexos').mkdir()
        (home / '.config/cybexos/hypr').mkdir(parents=True)
        (home / '.config/cybexos/shell.json').write_text(json.dumps({'v': 31, 'wall': '', 'assistantShown': False}))
        (home / 'doctor.json').write_text(json.dumps(PAGES.DOCTOR))
        (home / 'maintenance.json').write_text(json.dumps(PAGES.MAINTENANCE))
        shell = base / 'runtime/quickshell'
        shutil.copytree(ROOT / 'desktop/quickshell', shell)
        native = base / 'native'
        with (base / 'native.log').open('w') as build_log:
            subprocess.run(['cmake', '-S', str(ROOT / 'desktop/notification-images'), '-B', str(native),
                            '-DBUILD_TESTING=OFF'], stdout=build_log, stderr=subprocess.STDOUT, check=True)
            subprocess.run(['cmake', '--build', str(native), '--parallel', '2'],
                           stdout=build_log, stderr=subprocess.STDOUT, check=True)
        entry = shell / 'shell.qml'
        source = entry.read_text().replace('SettingsWindow {}', 'SettingsWindow { id: guideSettings }')
        assert 'guideSettings' in source
        source = source.replace('    id: shell', '    id: shell' + TEST_IPC, 1)
        entry.write_text(source)

        stub = subprocess.run(['node', '-e', "process.stdout.write(require(process.argv[1]).stub)",
                               str(ROOT / 'tests/quickshell/keybindings-support.cjs')],
                              capture_output=True, text=True, check=True).stdout
        resolver = base / 'resolve.lua'
        resolver.write_text(f'package.path = {json.dumps(str(ROOT / "desktop/hypr/?.lua"))} .. ";" .. package.path\n'
                            'package.preload.features = function() return {} end\n'
                            + stub + "\nrequire('bindings')\nrequire('keybinding_preferences')\n")
        (base / 'bin').mkdir()
        for name in ('gsettings', 'dbus-update-activation-environment', 'nix-store', 'systemctl', 'xrdb', 'xsetroot'):
            path = base / 'bin' / name
            path.write_text(PAGES.FAKE_POINTER_TOOL)
            path.chmod(0o700)
        for name, program in (('hyprctl', PAGES.EDITOR.FAKE_HYPRCTL), ('cybex', PAGES.FAKE_CYBEX)):
            path = base / 'bin' / name
            path.write_text(program)
            path.chmod(0o700)

        env = {**os.environ, 'HOME': str(home), 'XDG_RUNTIME_DIR': str(runtime),
               'XDG_CONFIG_HOME': str(home / '.config'), 'XDG_DATA_HOME': str(home / '.local/share'),
               'XDG_STATE_HOME': str(home / '.local/state'), 'XDG_CACHE_HOME': str(home / '.cache'),
               'QT_QPA_PLATFORM': 'wayland', 'QT_QUICK_BACKEND': 'software', 'WLR_BACKENDS': 'headless',
               'WLR_RENDERER': 'pixman', 'WLR_LIBINPUT_NO_DEVICES': '1', 'CYBEXOS_ASSISTANT': '0',
               'CYBEXOS_CONNECTED_WIDGETS': '0', 'CYBEXOS_DEVELOPER_TOOLS': '0', 'CYBEXOS_WELCOME': '0',
               'CYBEXOS_LANG': 'en', 'CYBEXOS_TEST_LUA': shutil.which(lua), 'CYBEXOS_TEST_RESOLVER': str(resolver),
               'PATH': str(base / 'bin') + os.pathsep + os.environ['PATH'],
               'QT_PLUGIN_PATH': subprocess.check_output(['qtpaths', '--query', 'QT_INSTALL_PLUGINS'], text=True).strip(),
               'QML_IMPORT_PATH': str(native / 'qml') + ':' + os.environ.get('CYBEXOS_QML_IMPORT_PATH', ''),
               'PYTHONDONTWRITEBYTECODE': '1', 'GSETTINGS_BACKEND': 'memory',
               **shell_fonts.fontconfig(base)}
        for name in ('DISPLAY', 'WAYLAND_DISPLAY', 'HYPRLAND_INSTANCE_SIGNATURE', 'SWAYSOCK', 'DBUS_SESSION_BUS_ADDRESS',
                     'XCURSOR_THEME', 'XCURSOR_SIZE'):
            env.pop(name, None)
        subprocess.run([str(base / 'bin/hyprctl'), 'reload'], env=env, check=True, capture_output=True)

        def start(argv, log):
            handle = (base / log).open('w')
            proc = subprocess.Popen(argv, env=env, stdout=handle, stderr=subprocess.STDOUT, start_new_session=True)
            handle.close()
            processes.append(proc)
            return proc

        def ipc(target, method, *args):
            try:
                result = subprocess.run(['qs', 'ipc', '-p', str(shell), 'call', target, method, *args],
                                        env=env, capture_output=True, text=True, timeout=10)
            except subprocess.TimeoutExpired:
                return 'ipc-timeout'
            return result.stdout.strip() if result.returncode == 0 else 'ipc-unavailable'

        def state():
            try:
                return json.loads(ipc('guide-test', 'state'))
            except json.JSONDecodeError:
                return {}

        def wait(predicate, label, seconds=20):
            until = time.monotonic() + seconds
            while time.monotonic() < until:
                value = predicate()
                if value:
                    return value
                time.sleep(0.15)
            raise AssertionError(f'Timeout: {label}\n{json.dumps(state(), indent=1)[:4000]}')

        def answer():
            try:
                return json.loads(ipc('guide-test', 'answer'))
            except json.JSONDecodeError:
                return None

        def resize(width, height):
            subprocess.run(['swaymsg', '[title="Cybex OS Settings"]', 'resize', 'set', str(width), str(height)],
                           env=env, check=True, capture_output=True)
            wait(lambda: abs((s := state()).get('windowWidth', 0) - width) <= 8 and s, f'the window at {width}×{height}')

        def screenshot(name):
            ipc('guide-test', 'mark', name)
            time.sleep(0.6)
            target = OUTPUT / name
            subprocess.run(['grim', str(target)], env=env, check=True, timeout=10)
            print(target)

        def show(key):
            """settings_show for KEY, through the shell's own tool; its answer once he points."""
            ipc('guide-test', 'point', key)
            reply = wait(answer, f'settings_show {key} answered')
            return reply

        def pointing(key, label):
            """Wiz settled at KEY's row: in the area, clear of its label and controls."""
            s = wait(lambda: (s := state()).get('state') == 'pointing' and s.get('key') == key
                     and s.get('wiz') and s['wiz']['opacity'] == 1 and not s['wiz']['animating'] and s,
                     f'Wiz settled at {key} ({label})', 12)
            wiz, spot = s['wiz'], s['spot']
            assert s['inView'] and wiz['visible'] and wiz['pose'] == 'pointing', s
            assert spot['fits'], (label, s)
            assert wiz['facing'] == spot['facing'], s
            box = {k: wiz[k] for k in ('x', 'y', 'width', 'height')}
            for rect in [s['label']] + s['controls']:
                if rect:
                    assert not intersects(box, rect), (label, 'covers', rect, s)
            area = s['area']
            assert area['x'] - 1 <= box['x'] and box['x'] + box['width'] <= area['x'] + area['width'] + 1, (label, s)
            assert area['y'] - 1 <= box['y'] and box['y'] + box['height'] <= area['y'] + area['height'] + 1, (label, s)
            # Next to the row: within his own size of it.
            row = s['row']
            assert box['x'] < row['x'] + row['width'] + box['width'] and box['x'] + 2 * box['width'] > row['x'], s
            assert box['y'] < row['y'] + row['height'] + box['height'] and box['y'] + 2 * box['height'] > row['y'], s
            assert s['ring']['visible'], s
            if s['label']:
                assert s['highlighted'] is True, 'the row stays lit while he points'
            return s

        def ended(reason):
            s = wait(lambda: (s := state()).get('ended') == reason and s.get('key') == '' and s,
                     f'the guide ended: {reason}')
            # He leaves: nothing of him is left once he has gone.
            return wait(lambda: (s := state()).get('wiz') is None and not s.get('shown') and s,
                        f'Wiz gone after {reason}')

        try:
            (base / 'sway.conf').write_text('output HEADLESS-1 mode 1440x900\nseat seat0 fallback true\n'
                'for_window [title="Cybex OS Settings"] floating enable, resize set 1120 816, move position center\n')
            sway = base / 'sway'
            shutil.copyfile(os.environ.get('CYBEXOS_SWAY_BINARY') or shutil.which('sway'), sway)
            sway.chmod(0o700)
            start([str(sway), '-c', str(base / 'sway.conf')], 'sway.log')
            sockets = wait(lambda: [p for p in runtime.glob('wayland-*') if p.is_socket()], 'Sway')
            env['WAYLAND_DISPLAY'] = sockets[0].name
            env['SWAYSOCK'] = str(wait(lambda: next(runtime.glob('sway-ipc.*.sock'), None), 'Sway IPC'))
            dbus = ['dbus-run-session']
            if env.get('CYBEXOS_DBUS_SESSION_CONFIG'):
                dbus += ['--config-file', env['CYBEXOS_DBUS_SESSION_CONFIG']]
            start([*dbus, '--', 'qs', '--no-color', '-p', str(shell)], 'qs.log')
            wait(lambda: ipc('guide-test', 'answer') == 'null', 'the test IPC')

            # Failures first: an unknown key, and a setting no Settings row shows.
            ipc('guide-test', 'point', 'glass')
            failed = wait(answer, 'the unknown key refused')
            assert failed == {'ok': False, 'error': 'There is no setting called glass. Use settings_search to find one.'}, failed
            ipc('guide-test', 'point', 'assistantShown')
            failed = wait(answer, 'a key without a row refused')
            assert not failed['ok'] and 'Settings has no row for assistantShown' in failed['error'], failed
            assert state()['open'] is False, 'nothing opened for them'

            # A row near the top of a page, in a wide window: the answer says
            # where it is in Settings' words, and Wiz stands in the margin
            # before the label, pointing at it.
            reply = show('glassEnabled')
            assert reply['ok'], reply
            result = reply['result']
            assert (result['where'], result['page'], result['label'], result['shown']) == \
                ('Appearance › Glass effect', 'Appearance', 'Glass effect', True), result
            wide = pointing('glassEnabled', 'wide, near the top')
            assert wide['page'] == 'appearance' and wide['spot']['name'] == 'left', wide['spot']
            screenshot('01-wide-glass-effect.png')

            # Changing that setting ends it; he leaves.
            ipc('guide-test', 'toggle', 'glassEnabled')
            ended('changed')

            # Inside the folded "Advanced text options": it unfolds and he points there.
            reply = show('shellFontSize')
            assert reply['ok'] and reply['result']['label'] == 'Base font size', reply
            pointing('shellFontSize', 'inside Advanced')
            # A second call moves the same Wiz to another row of the page.
            reply = show('themeMode')
            assert reply['ok'], reply
            moved = pointing('themeMode', 'moved on the same page')
            assert moved['ended'] == '', moved

            # Near the bottom of a long page.
            reply = show('pointerHideIdle')
            assert reply['ok'], reply
            bottom = pointing('pointerHideIdle', 'near the bottom of the page')
            assert bottom['row']['y'] > bottom['area']['y'] + bottom['area']['height'] / 3, bottom

            # Leaving the page ends it.
            ipc('guide-test', 'showPage', 'wallpaper')
            ended('page')

            # Another jump (the palette, a Home link) ends it too.
            assert show('notifPosition')['ok']
            pointing('notifPosition', 'notifications')
            ipc('guide-test', 'highlight', 'notifDuration')
            ended('other')

            # A narrow window, in the dark theme: the rail folds to icons and
            # rows stack; he still finds a spot clear of the row's own parts.
            ipc('guide-test', 'setValue', 'themeMode', json.dumps('dark'))
            resize(560, 640)
            for key in ('glassEnabled', 'themeMode', 'shellFontSize', 'accent', 'pointerHideIdle', 'clock24'):
                reply = show(key)
                assert reply['ok'], reply
                pointing(key, 'narrow window')
            show('glassEnabled')
            narrow = pointing('glassEnabled', 'narrow window')
            screenshot('02-narrow-dark-glass-effect.png')
            assert narrow['spot']['name'] in ('gap', 'above', 'below', 'left', 'right'), narrow['spot']

            # Closing Settings ends it.
            ipc('guide-test', 'close')
            ended('closed')

            # Wide again, light: a row in a widget's dialog. He stands over
            # the dialog, and closing the dialog ends the guide.
            ipc('guide-test', 'setValue', 'themeMode', json.dumps('light'))
            reply = show('drawerWidth')
            assert reply['ok'] and 'Control Center' in reply['result']['where'], reply
            resize(1120, 816)
            dialog = pointing('drawerWidth', 'in a widget dialog')
            assert dialog['inOverlay'], dialog
            screenshot('03-dialog-control-center-width.png')
            ipc('guide-test', 'closeDialogs')
            ended('gone')

            # Scrolled out of view he waits unseen, and comes back with the row.
            assert show('pointerHideIdle')['ok']
            pointing('pointerHideIdle', 'before scrolling')
            ipc('guide-test', 'scrollPage', '0')
            wait(lambda: not state().get('inView'), 'Wiz hidden with the row scrolled away')
            assert state()['state'] == 'pointing'

            # The time runs out.
            ipc('guide-test', 'timeout', '5000')
            assert show('clock24')['ok']
            pointing('clock24', 'before the time runs out')
            ended('time')
            ipc('guide-test', 'timeout', '30000')

            # Reduced motion: he is simply there, still, from the first frame.
            ipc('guide-test', 'setValue', 'reducedMotion', 'true')
            assert show('glassEnabled')['ok']
            s = wait(lambda: (s := state()).get('state') == 'pointing' and s.get('wiz') and s, 'reduced motion')
            assert s['wiz']['opacity'] == 1 and not s['wiz']['animating'], s
            ipc('guide-test', 'close')
            ended('closed')

            log = (base / 'qs.log').read_text()
            problems = [line for line in log.splitlines() if PAGES.QML_ERRORS.search(line)]
            assert not problems, '\n'.join(problems[:40])
            print('settings guide: all checks passed')
        except BaseException:
            for name in ('qs.log', 'sway.log'):
                path = base / name
                if path.exists():
                    print(f'--- {name}\n' + path.read_text()[-12000:])
            raise
        finally:
            for proc in reversed(processes):
                try:
                    os.killpg(proc.pid, 15)
                except ProcessLookupError:
                    pass
            for proc in processes:
                try:
                    proc.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    os.killpg(proc.pid, 9)
    PAGES.EDITOR.process_guard(runtime)


if __name__ == '__main__':
    main()
