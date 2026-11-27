#!/usr/bin/env python3
"""Software Update, Software and Settings open whatever took their window away.

The real shell in a private headless Sway with two outputs. Each app's window
is moved to the second output, closed and opened again from the first, which
hands the window a different output as it opens. It is closed by the
compositor, its output is unplugged under it, and the window is lost behind
the app's back while the app still counts as open. After each, opening the app
must leave exactly one window in the compositor's own tree, with the app's
open flag matching it, and closing it must leave none.

Software Update 1.0.35 failed this: choosing the output for a window already
shown made Quickshell hide and show it again, its `closed` cleared the app's
flag inside the binding that showed it, and from then on the window and the
flag disagreed. Opening the app only sent a focus request for a window that
was gone.

    nix develop -c python3 -B tests/app-windows.py
"""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), ROOT / 'tests' / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


welcome = load('welcome-guide')
updates = load('update-flow')

# Each app: its shell.qml line, its compositor title and how scripts open and close it.
APPS = {
    'updates': ('SoftwareUpdateWindow', 'Software Update', ('updates', 'open'), ('updates', 'close')),
    'software': ('SoftwareWindow', 'Cybex OS Software', ('software', 'open'), ('software', 'close')),
    'settings': ('SettingsWindow', 'Cybex OS Settings', ('settings', 'open', 'home'), ('settings', 'close')),
}

# Small outputs: Sway keeps their frames in /dev/shm, which fast-test's
# container caps at 63 MB for all the shell checks running side by side
# (47.7 MB at their peak without this test). Two 1280x800 outputs left too
# little for settings-pages.py's screenshot, which then died with SIGBUS.
# Every window still fits: the largest minimum size is Software's 760x520.
OUTPUT = '800x600'

IPC = '''
    property var windowTest: ({})
    function windowTestOpen(name) {
        return name === "updates" ? Updates.appOpen : name === "software" ? Software.open : Settings.panelOpen;
    }
    IpcHandler {
        target: "window-test"
        function state(): string {
            const report = {screens: Quickshell.screens.map(screen => screen.name),
                focused: Screens.focused ? Screens.focused.name : null};
            for (const name of ["updates", "software", "settings"]) {
                const window = shell.windowTest[name];
                report[name] = {open: shell.windowTestOpen(name), visible: !!window && window.visible,
                    screen: window && window.screen ? window.screen.name : null};
            }
            return JSON.stringify(report);
        }
        // Hidden while the app still counts as open, as a lost graphics
        // context leaves a window: no closed signal, no flag change.
        function lose(name: string): void { shell.windowTest[name].visible = false; }
    }
'''


class Session(welcome.Session):
    def copy_source(self):
        self.source.mkdir()
        for name in ('desktop', 'assets'):
            shutil.copytree(ROOT / name, self.source / name, ignore=shutil.ignore_patterns('__pycache__'))
        shutil.copyfile(ROOT / 'VERSION', self.source / 'VERSION')
        subprocess.run(['git', 'init', '-q', str(self.source)], check=True)
        entry = self.source / 'desktop/quickshell/shell.qml'
        text = entry.read_text().replace('    id: shell', '    id: shell\n' + IPC, 1)
        for name, (component, *_rest) in APPS.items():
            line = f'    {component} {{}}\n'
            assert text.count(line) == 1, component
            text = text.replace(line, f'    {component} {{ id: {name}TestWindow; '
                                f'Component.onCompleted: shell.windowTest.{name} = {name}TestWindow }}\n')
        entry.write_text(text)

    def state(self):
        return self.json_call('window-test', 'state')

    def probe(self):
        return {'shell': self.state(), 'compositor': self.windows()}

    def windows(self):
        """(title, output) of every window in Sway's tree: what is really mapped."""
        try:
            tree = json.loads(self.sway('-t', 'get_tree'))
        except (subprocess.CalledProcessError, json.JSONDecodeError):
            return None
        found = []

        def walk(node, output):
            if node.get('type') == 'output':
                output = node.get('name')
            if 'shell' in node:
                found.append((node.get('name'), output))
            for child in node.get('nodes', []) + node.get('floating_nodes', []):
                walk(child, output)
        walk(tree, None)
        return found

    def mapped(self, title):
        return [output for name, output in self.windows() or [] if name == title]


def check_app(session, name):
    _component, title, open_args, close_args = APPS[name]
    criteria = f'[title="^{title}$"]'
    app = lambda: session.state().get(name) or {}
    first, second = session.state()['screens']

    def opened(label, output=None):
        session.wait(lambda: app().get('open') and app().get('visible') and len(session.mapped(title)) == 1
                     and (output is None or session.mapped(title) == [output]), f'{title}: {label}', timeout=15)

    def closed(label):
        session.wait(lambda: app() and not app().get('open') and not app().get('visible')
                     and not session.mapped(title), f'{title}: {label}', timeout=15)

    def move(output):
        session.sway(f'{criteria} move container to output {output}')
        session.wait(lambda: app().get('screen') == output, f'{title}: Qt follows it to {output}')

    session.call(*open_args)
    opened('opens')
    # Opening it again only raises it.
    session.call(*open_args)
    time.sleep(.5)
    opened('a second open keeps one window')

    # On the second output, then closed: Qt keeps that output for the
    # hidden window, so opening it again on the focused (first) output
    # gives the window another output as it opens.
    move(second)
    session.call(*close_args)
    closed('closes from the second output')
    session.call(*open_args)
    opened('opens again from the first output', first)

    # Closed by the compositor (its close button, Super+W): the app hears it.
    session.sway(criteria + ' kill')
    closed('the compositor closes it')
    session.call(*open_args)
    opened('opens after the compositor closed it')

    # Lost behind the app's back: still open, no window. Opening it maps it again.
    session.call('window-test', 'lose', name)
    session.wait(lambda: app().get('open') and not session.mapped(title), f'{title}: lost window')
    session.call(*open_args)
    opened('opens a lost window again')

    # Its output unplugged under it, then plugged in again (Sway names the
    # new one afresh). The window stays, the app stays open, and it closes
    # and opens again on the outputs there are then.
    move(second)
    session.sway(f'output {second} unplug')
    session.wait(lambda: session.state().get('screens') == [first], f'{second} gone from the shell')
    opened('survives its output going away', first)
    session.call(*open_args)
    opened('opens with its output gone')
    session.call(*close_args)
    closed('closes with its output gone')
    session.sway('create_output')
    session.wait(lambda: len(session.state().get('screens') or []) == 2, 'a second output again')
    replugged = session.state()['screens'][1]
    session.sway(f'output {replugged} mode {OUTPUT} pos 800 0')
    session.call(*open_args)
    opened('opens after the output came back')
    move(replugged)
    session.call(*close_args)
    closed('closes from the new output')
    session.call(*open_args)
    opened('opens again from the first output after a replug', first)
    session.call(*close_args)
    closed('closes at the end')


def main():
    for executable in ('qs', 'sway', 'swaymsg', 'cmake', 'git'):
        if not shutil.which(executable):
            raise SystemExit(f'{executable} is required; use nix develop')
    updates.process_guard()
    with tempfile.TemporaryDirectory(prefix='cxa-') as temporary:
        base = Path(temporary)
        native = base / 'native'
        subprocess.run(['cmake', '-S', str(ROOT / 'desktop/notification-images'), '-B', str(native),
                        '-DBUILD_TESTING=OFF'], check=True, capture_output=True)
        subprocess.run(['cmake', '--build', str(native), '--parallel', '2'], check=True, capture_output=True)
        session = Session(base, native / 'qml')
        session.env.update(CYBEXOS_WELCOME='0')
        for name, body in (('cybex', updates.FAKE),
                           ('systemctl', updates.SYSTEMCTL.replace('REAL', repr(shutil.which('systemctl')))),
                           ('notify-send', updates.NOTIFY_SEND)):
            (base / 'bin' / name).write_text(body)
            (base / 'bin' / name).chmod(0o700)
        (session.runtime / 'fixture.json').write_text(json.dumps({'sources': {
            'installedIdentity': 'installed-lock', 'upstream': {'state': 'current'}, 'cybexos': {'state': 'current'}}}))
        (session.runtime / 'status.json').write_text(json.dumps({'state': 'idle', 'installedIdentity': 'installed-lock',
            'automatic': {'prepare': False, 'confirm': True}}))
        try:
            conf = base / 'sway.conf'
            conf.write_text(f'output HEADLESS-1 mode {OUTPUT} pos 0 0\nseat seat0 fallback true\n'
                            'for_window [title="^(Software Update|Cybex OS Software|Cybex OS Settings)$"] '
                            'floating enable\n')
            sway = base / 'sway'
            shutil.copyfile(os.environ.get('CYBEXOS_SWAY_BINARY') or shutil.which('sway'), sway)
            sway.chmod(0o700)
            session.start([str(sway), '-c', str(conf)], 'sway.log')
            sockets = session.wait(lambda: [p for p in session.runtime.glob('wayland-*') if p.is_socket()], 'Sway')
            session.env['WAYLAND_DISPLAY'] = sockets[0].name
            session.env['SWAYSOCK'] = str(session.wait(lambda: next(session.runtime.glob('sway-ipc.*.sock'), None),
                                                       'Sway IPC'))
            session.sway('create_output')
            session.sway(f'output HEADLESS-2 mode {OUTPUT} pos 800 0')
            session.sway('focus output HEADLESS-1')
            session.start_shell('qs-first.log')
            session.wait(lambda: session.state().get('screens') == ['HEADLESS-1', 'HEADLESS-2'], 'two outputs')
            # Without Hyprland the focused output is the first one.
            assert session.state()['focused'] == 'HEADLESS-1', session.state()
            for name in APPS:
                check_app(session, name)
            errors = [line for log in session.logs if log.name.startswith('qs-')
                      for line in log.read_text(errors='replace').splitlines()
                      if 'Binding loop' in line or (welcome.ERRORS.search(line) and any(
                          file in line for file in ('AppWindow.qml', 'SoftwareUpdateWindow.qml',
                                                    'SoftwareWindow.qml', 'SettingsWindow.qml')))]
            assert not errors, '\n'.join(errors)
            print('PASS: Software Update, Software and Settings open with one window after a second open, '
                  'after opening on another output than the hidden window had, after the compositor closed '
                  'them, after losing their window while open, and around unplugging and replugging their output')
        except BaseException:
            for log in session.logs:
                if log.exists(): print(log.name, log.read_text(errors='replace')[-12000:])
            raise
        finally:
            session.stop()
            for pid in welcome.own_processes(session.runtime):
                try: os.kill(pid, 15)
                except ProcessLookupError: pass
            time.sleep(.2)
            updates.process_guard(session.runtime)
            assert not welcome.own_processes(session.runtime)


if __name__ == '__main__':
    main()
