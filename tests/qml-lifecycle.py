#!/usr/bin/env python3
"""Run tests/qml-lifecycle/shell.qml in the real `qs` engine.

The harness drives production components (PolkitPrompt, CommandRequest,
InputDrafts with the real SettingsView Loader, Themes, OverviewView,
ProcessList and Settings layout pieces) through their lifecycles. It is
overlaid as shell.qml on a private copy of desktop/quickshell, so its imports
resolve inside the config root as in production, and `qs` runs offscreen with
a home, runtime directory and session bus of its own: nothing reaches a
desktop session, the user's config or the host. The harness logs
LIFECYCLE_FAIL lines and one LIFECYCLE_RESULT, then terminates its own qs.

Run through nix develop, e.g.
  nix develop -c python3 -B tests/qml-lifecycle.py
"""
from __future__ import annotations

import importlib.util
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import tempfile

import shell_fonts

ROOT = Path(__file__).resolve().parents[1]
SHELL = ROOT / 'desktop/quickshell'
HARNESS = ROOT / 'tests/qml-lifecycle/shell.qml'
TIMEOUT = 60

# The isolated session bus and process-group teardown of the plugin tests.
_spec = importlib.util.spec_from_file_location('user_plugins', Path(__file__).with_name('user-plugins.py'))
PLUGINS = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(PLUGINS)

QML_ERRORS = re.compile(r'(?:Type|Reference|Range)Error|Binding loop|Failed to load configuration'
                        r'|is not a type|Type \w+ unavailable|Cannot assign|Unable to assign')


def main():
    if not shutil.which('qs'):
        raise SystemExit('qs is required; use nix develop')
    # A short path: Quickshell's IPC socket lives below XDG_RUNTIME_DIR and
    # must fit Linux's 108-byte sockaddr_un path.
    with tempfile.TemporaryDirectory(prefix='cxl-', dir='/tmp') as temporary:
        base = Path(temporary)
        runtime = base / 'run'
        runtime.mkdir(mode=0o700)
        shell = base / 'shell'
        shutil.copytree(SHELL, shell)
        shutil.copy2(HARNESS, shell / 'shell.qml')
        env = {**os.environ, 'HOME': str(base / 'home'), 'XDG_CONFIG_HOME': str(base / 'config'),
               'XDG_DATA_HOME': str(base / 'data'), 'XDG_STATE_HOME': str(base / 'state'),
               'XDG_CACHE_HOME': str(base / 'cache'), 'XDG_RUNTIME_DIR': str(runtime),
               'QT_QPA_PLATFORM': 'offscreen', 'QT_QUICK_BACKEND': 'software', 'QS_REDUCED_MOTION': '1',
               **shell_fonts.fontconfig(base)}
        for key in ('WAYLAND_DISPLAY', 'DISPLAY', 'HYPRLAND_INSTANCE_SIGNATURE',
                    'CYBEXOS_USER_CONFIG_ROOT', 'CYBEXOS_PLUGIN_ROOT'):
            env.pop(key, None)
        process = subprocess.Popen([*PLUGINS.DBUS, 'qs', '--no-color', '-p', str(shell)], env=env,
                                   stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                                   start_new_session=True)
        try:
            output, _ = process.communicate(timeout=TIMEOUT)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGTERM)
            output, _ = process.communicate(timeout=3)
            raise AssertionError(output + f'\nqml lifecycle: no result within {TIMEOUT}s') from None
        finally:
            PLUGINS.end_session(process)
    failures = [line for line in output.splitlines() if 'LIFECYCLE_FAIL' in line]
    errors = [line for line in output.splitlines() if QML_ERRORS.search(line)]
    if 'LIFECYCLE_RESULT pass' not in output or failures or errors:
        print(output)
        for line in failures + errors:
            print('qml lifecycle: ' + line, file=sys.stderr)
        raise SystemExit('qml lifecycle: the harness did not pass')
    print('QML lifecycle: production components constructed, drove and tore down in the real engine')


if __name__ == '__main__':
    # tests/checks.bash stops an overrunning check with SIGTERM. Unwind so the
    # qs session, in a process group of its own, is still stopped.
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
    main()
