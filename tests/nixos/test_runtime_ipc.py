"""Isolated runtime resolver and real minimal headless IPC regression.

No live menubar or user service is started, stopped or replaced.
"""
import concurrent.futures
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[2]
QS = shutil.which('qs')


class RuntimeIpcTests(unittest.TestCase):
    def setUp(self):
        # Nix builders can have a long TMPDIR. Quickshell's IPC socket lives
        # below XDG_RUNTIME_DIR and must fit Linux's 108-byte sockaddr_un path.
        self.temporary = tempfile.TemporaryDirectory(prefix='cy-ipc.', dir='/tmp')
        self.addCleanup(self.temporary.cleanup)
        root = Path(self.temporary.name)
        vendor = root / 'vendor'; vendor.mkdir()
        self.shell = vendor / 'quickshell'; self.shell.mkdir()
        runtime = root / 'runtime'; runtime.symlink_to(vendor)
        self.alias_shell = runtime / 'quickshell'
        self.helper = self.alias_shell / 'compat/omarchy/bin/omarchy-shell'
        self.helper.parent.mkdir(parents=True)
        shutil.copy2(ROOT / 'desktop/quickshell/compat/omarchy/bin/omarchy-shell', self.helper)
        (self.shell / 'shell.qml').write_text('''import Quickshell
import Quickshell.Io
ShellRoot {
    IpcHandler {
        target: "shell"
        function ping(): string { return "pong" }
        function rescanPlugins(): string { return "rescanned" }
        // Blocks the shell for 3 s, as opening a full-screen view can in a
        // software-rendered VM.
        function slow(): string { const end = Date.now() + 3000; while (Date.now() < end) {} return "slow" }
    }
}
''')
        (self.shell / 'scripts').mkdir()
        shutil.copy2(ROOT / 'desktop/quickshell/scripts/shell-recovery.py', self.shell / 'scripts/shell-recovery.py')
        self.command = root / 'cybexos-runtime'
        source = (ROOT / 'assets/scripts/cybexos-runtime').read_text()
        self.assertEqual(source.count('runtime_root=/etc/cybexos/runtime'), 1)
        self.command.write_text(source.replace('runtime_root=/etc/cybexos/runtime', 'runtime_root=' + shlex.quote(str(runtime))))
        self.command.chmod(0o755)
        xdg = root / 'xdg'; xdg.mkdir(mode=0o700)
        self.environment = os.environ | {
            'HOME': str(root / 'home'), 'XDG_RUNTIME_DIR': str(xdg),
            'XDG_CONFIG_HOME': str(root / 'config'), 'XDG_DATA_HOME': str(root / 'data'),
            'XDG_STATE_HOME': str(root / 'state'), 'QT_QPA_PLATFORM': 'offscreen',
            'QT_QUICK_BACKEND': 'software', 'CYBEXOS_RUNTIME_TESTING': '1',
        }
        self.environment.pop('DISPLAY', None)
        self.environment.pop('WAYLAND_DISPLAY', None)

    def run_command(self, *arguments, environment=None, timeout=5):
        return subprocess.run(list(map(str, arguments)), env=self.environment | (environment or {}),
                              capture_output=True, text=True, timeout=timeout)

    def start_fixture(self, log, environment=None):
        process = subprocess.Popen([str(self.command), 'exec', 'quickshell'],
                                   env=self.environment | (environment or {}), stdout=log, stderr=subprocess.STDOUT)
        self.addCleanup(self.stop_fixture, process)
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            result = self.run_command(self.command, 'ipc', 'shell', 'ping', environment=environment)
            if result.returncode == 0 and result.stdout.strip() == 'pong':
                return process
            if process.poll() is not None:
                log.seek(0)
                self.fail('Headless fixture exited: ' + log.read())
            time.sleep(.1)
        log.seek(0)
        self.fail('Headless fixture IPC unavailable: ' + log.read())

    @staticmethod
    def stop_fixture(process):
        # Terminate only this test's own minimal fixture process.
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)

    def test_immutable_runtime_alias_resolves_to_one_canonical_identity(self):
        result = self.run_command(self.command, 'path', 'quickshell')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), str(self.shell))

    @unittest.skipUnless(QS, 'Quickshell required for the real headless IPC regression')
    def test_service_launcher_runtime_ipc_and_omarchy_plugin_reload_share_identity(self):
        with tempfile.TemporaryFile(mode='w+') as log:
            process = subprocess.Popen([str(self.command), 'exec', 'quickshell'],
                                       env=self.environment, stdout=log, stderr=subprocess.STDOUT)
            try:
                deadline = time.monotonic() + 15
                while time.monotonic() < deadline:
                    result = self.run_command(self.command, 'ipc', 'shell', 'ping')
                    if result.returncode == 0 and result.stdout.strip() == 'pong':
                        break
                    if process.poll() is not None:
                        log.seek(0)
                        self.fail('Headless fixture exited: ' + log.read())
                    time.sleep(.1)
                else:
                    log.seek(0)
                    self.fail('Headless fixture IPC unavailable: ' + log.read())
                # The helper resolves its bundled path with pwd -P, including
                # when it is invoked through the installed runtime alias.
                helper = self.run_command(self.helper, 'shell', 'ping')
                self.assertEqual(helper.returncode, 0, helper.stderr)
                self.assertEqual(helper.stdout.strip(), 'pong')
                reload = self.run_command(self.command, 'plugin', 'reload')
                self.assertEqual(reload.returncode, 0, reload.stderr)
                self.assertEqual(reload.stdout.strip(), 'rescanned')
            finally:
                # Terminate only this test's own minimal fixture process.
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=5)
                self.assertIsNotNone(process.poll())

    @unittest.skipUnless(QS, 'Quickshell required for the real headless IPC regression')
    def test_ipc_limit_is_two_seconds_unless_a_check_lengthens_it(self):
        def refused(value):
            # A call keeps its shell busy for 3 s, so each value asks a shell
            # of its own (its own runtime directory) and they run side by side.
            runtime = Path(self.temporary.name) / ('xdg-' + str(values.index(value)))
            runtime.mkdir(mode=0o700)
            environment = {'XDG_RUNTIME_DIR': str(runtime)}
            with tempfile.TemporaryFile(mode='w+') as log:
                self.start_fixture(log, environment)
                return self.run_command(self.command, 'ipc', 'shell', 'slow', timeout=10,
                                        environment=environment | {'CYBEXOS_IPC_TIMEOUT': value})

        with tempfile.TemporaryFile(mode='w+') as log:
            self.start_fixture(log)
            # The default stops a call to a busy shell after 2 s.
            started = time.monotonic()
            result = self.run_command(self.command, 'ipc', 'shell', 'slow', timeout=10)
            self.assertEqual(result.returncode, 124, result)
            self.assertLess(time.monotonic() - started, 4)
            # Values outside 1-120 whole seconds keep the default.
            values = ('0', '121', '5s', '05', '-3', '')
            with concurrent.futures.ThreadPoolExecutor(len(values)) as pool:
                results = pool.map(refused, values)
                time.sleep(3)  # let the shell finish the previous call
                result = self.run_command(self.command, 'ipc', 'shell', 'slow',
                                          environment={'CYBEXOS_IPC_TIMEOUT': '10'}, timeout=15)
                self.assertEqual((result.returncode, result.stdout.strip()), (0, 'slow'), result)
                for value, result in zip(values, results):
                    self.assertEqual(result.returncode, 124, (value, result))

    def _run_shell_startup_stub(self, *, process_dirs, session_dirs):
        """Run `cybexos-runtime exec quickshell` with stubbed systemd/D-Bus/qs."""
        root = Path(self.temporary.name) / 'scrub'
        if root.exists():
            shutil.rmtree(root)
        bin_dir = root / 'bin'
        bin_dir.mkdir(parents=True)
        calls = root / 'calls.log'
        captured_dirs = root / 'shell-xdg-data-dirs.txt'
        # Remove shell-recovery.py so exec_runtime runs `qs` directly.
        recovery = self.shell / 'scripts/shell-recovery.py'
        if recovery.exists():
            recovery.unlink()
        systemctl = bin_dir / 'systemctl'
        systemctl.write_text(f'''#!/usr/bin/env bash
printf 'systemctl %s\\n' "$*" >> {shlex.quote(str(calls))}
if [[ $1 == --user && $2 == show-environment ]]; then
  printf 'DISPLAY=:0\\nXDG_DATA_DIRS=%s\\n' {shlex.quote(session_dirs)}
  exit 0
fi
if [[ $1 == --user && $2 == show ]]; then
  printf 'not-found\\n'
  exit 0
fi
if [[ $1 == --user && $2 == is-active ]]; then
  exit 3
fi
exit 0
''')
        systemctl.chmod(0o755)
        dbus_update = bin_dir / 'dbus-update-activation-environment'
        dbus_update.write_text(f'''#!/usr/bin/env bash
printf 'dbus-update %s\\n' "$*" >> {shlex.quote(str(calls))}
''')
        dbus_update.chmod(0o755)
        qs_stub = bin_dir / 'qs'
        qs_stub.write_text(f'''#!/usr/bin/env bash
printf '%s' "${{XDG_DATA_DIRS:-}}" > {shlex.quote(str(captured_dirs))}
''')
        qs_stub.chmod(0o755)
        env = self.environment | {
            'PATH': str(bin_dir) + ':' + os.environ.get('PATH', '/usr/bin:/bin'),
            'XDG_DATA_DIRS': process_dirs,
            'CYBEXOS_RUNTIME_TESTING': '0',
        }
        result = subprocess.run([str(self.command), 'exec', 'quickshell'], env=env,
                                capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        log = calls.read_text().splitlines() if calls.exists() else []
        return captured_dirs.read_text(), log

    def test_shell_startup_scrubs_stale_unindexed_gnome_data_dirs_from_live_session(self):
        stale_goa = '/nix/store/p47gb5gx7zma9q41iabhdr6xq9v5mdlx-gnome-online-accounts-3.58.1/share'
        stale_eds = '/nix/store/2p0ixzs62nnmlxs2ycp44lwnl5chzz5n-evolution-data-server-3.62.1/share'
        kept_icons = '/nix/store/7p1mqi8qw9syn29s2d29svjv4sflfm7i-gnome-online-accounts-icons/share'
        kept_eds_icons = '/nix/store/983byyss2j1hkygwb77989s5w4wrcivy-evolution-data-server-icons/share'
        kept_schemas = '/nix/store/2p0ixzs62nnmlxs2ycp44lwnl5chzz5n-evolution-data-server-3.62.1/share/gsettings-schemas/evolution-data-server-3.62.1'
        kept_sw = '/run/current-system/sw/share'
        session_dirs = ':'.join([stale_goa, stale_eds, kept_schemas, kept_sw])
        process_dirs = ':'.join([kept_icons, kept_eds_icons, session_dirs])
        expected_session = ':'.join([kept_schemas, kept_sw])
        expected_process = ':'.join([kept_icons, kept_eds_icons, kept_schemas, kept_sw])

        got_dirs, log = self._run_shell_startup_stub(process_dirs=process_dirs, session_dirs=session_dirs)
        self.assertEqual(got_dirs, expected_process)
        self.assertIn(f'systemctl --user set-environment XDG_DATA_DIRS={expected_session}', log)
        self.assertIn(f'dbus-update --systemd XDG_DATA_DIRS={expected_session}', log)
        self.assertIn('systemctl --user try-restart --no-block xdg-desktop-portal.service xdg-desktop-portal-gtk.service', log)

    def test_shell_startup_leaves_clean_session_data_dirs_untouched(self):
        clean_dirs = ':'.join([
            '/nix/store/7p1mqi8qw9syn29s2d29svjv4sflfm7i-gnome-online-accounts-icons/share',
            '/nix/store/983byyss2j1hkygwb77989s5w4wrcivy-evolution-data-server-icons/share',
            '/nix/store/2p0ixzs62nnmlxs2ycp44lwnl5chzz5n-evolution-data-server-3.62.1/share/gsettings-schemas/evolution-data-server-3.62.1',
            '/run/current-system/sw/share',
        ])
        got_dirs, log = self._run_shell_startup_stub(process_dirs=clean_dirs, session_dirs=clean_dirs)
        self.assertEqual(got_dirs, clean_dirs)
        self.assertFalse(any('set-environment' in line or 'dbus-update' in line or 'try-restart' in line for line in log), log)


if __name__ == '__main__':
    unittest.main()
