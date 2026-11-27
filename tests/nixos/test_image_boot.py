import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]


loader = importlib.machinery.SourceFileLoader('image_parity', str(Path(__file__).resolve().parents[2] / 'scripts/check-image-parity'))
spec = importlib.util.spec_from_loader(loader.name, loader)
parity = importlib.util.module_from_spec(spec)
loader.exec_module(parity)

loader = importlib.machinery.SourceFileLoader('installation_qualification', str(Path(__file__).resolve().parents[2] / 'scripts/qualify-installations'))
spec = importlib.util.spec_from_loader(loader.name, loader)
qualification = importlib.util.module_from_spec(spec)
loader.exec_module(qualification)


class InstalledSourceIdentityTests(unittest.TestCase):
    media = {'version': '1.0.0-beta.2', 'revision': 'a' * 40, 'narHash': 'sha256-' + 'A' * 43 + '='}
    path_source = {'type': 'path', 'path': '/nix/store/bundled-source', 'narHash': media['narHash']}
    installed = dict(media, revision='uncommitted')

    def test_committed_medium_keeps_exact_content_identity_through_a_bundled_path(self):
        evidence = qualification.check_installed_identity(self.media, self.installed, self.path_source)
        self.assertEqual(evidence['result'], 'passed')
        self.assertEqual(evidence['isoRelease']['revision'], 'a' * 40)
        self.assertEqual(evidence['installedRelease']['revision'], 'uncommitted')
        self.assertEqual(evidence['installedSource']['narHash'], self.media['narHash'])

    def test_git_input_requires_both_the_revision_and_content_identity(self):
        source = {'type': 'git', 'rev': self.media['revision'], 'narHash': self.media['narHash']}
        qualification.check_installed_identity(self.media, self.media, source)
        for installed, locked in ((self.installed, source), (self.media, dict(source, rev='b' * 40))):
            with self.subTest(installed=installed, locked=locked), self.assertRaises(RuntimeError):
                qualification.check_installed_identity(self.media, installed, locked)

    def test_rejects_different_installed_bytes_or_version(self):
        for change in ({'narHash': 'sha256-' + 'B' * 43 + '='}, {'version': '1.0.0'}):
            with self.subTest(change=change), self.assertRaises(RuntimeError):
                qualification.check_installed_identity(self.media, dict(self.installed, **change), self.path_source)

    def test_matching_release_labels_cannot_hide_a_different_locked_source(self):
        with self.assertRaises(RuntimeError):
            qualification.check_installed_identity(self.media, self.installed,
                                                   dict(self.path_source, narHash='sha256-' + 'B' * 43 + '='))

    def test_rejects_missing_identities_and_unexpected_path_revision(self):
        with self.assertRaises(RuntimeError):
            qualification.check_installed_identity({}, {}, {'type': 'path'})
        with self.assertRaises(RuntimeError):
            qualification.check_installed_identity(self.media, dict(self.installed, revision='b' * 40), self.path_source)


class KeyboardShortcutsRuntimeTests(unittest.TestCase):
    @staticmethod
    def bind(modmask, key, description, keycode=0, submap=''):
        return {'modmask': modmask, 'key': key, 'keycode': keycode, 'description': description, 'submap': submap}

    def live(self):
        rows = [{'id': name, 'group': 'G', 'label': name, 'keys': ['SUPER + code:%d' % (100 + index)],
                 'defaultKeys': []} for index, name in enumerate(qualification.REQUIRED_ACTIONS)]
        rows.append({'id': 'windows.move-window', 'group': 'Windows', 'label': 'Move window',
                     'keys': ['SUPER + mouse:272'], 'defaultKeys': []})
        rows[0]['keys'] = ['SUPER + SPACE']
        binds = [self.bind(64, '', 'G: ' + row['label'], 100 + index) for index, row in enumerate(rows[:-1])]
        binds[0] = self.bind(64, 'space', 'G: ' + rows[0]['label'])
        return {'v': 1, 'error': None, 'actions': rows, 'custom': [], 'diagnostics': []}, binds

    def test_bound_matches_modifiers_keys_case_insensitively_and_keycodes(self):
        binds = [self.bind(72, 'b', 'Apps: Browser'), self.bind(65, '', 'Workspaces: Move', 10)]
        self.assertTrue(qualification.bound(binds, 'Apps: Browser', 'SUPER + ALT + B'))
        self.assertTrue(qualification.bound(binds, 'Workspaces: Move', 'SUPER + SHIFT + code:10'))
        self.assertFalse(qualification.bound(binds, 'Apps: Browser', 'SUPER + B'))
        self.assertFalse(qualification.bound(binds, 'Apps: Files', 'SUPER + ALT + B'))
        self.assertFalse(qualification.bound([self.bind(72, 'B', 'Apps: Browser', submap='resize')],
                                             'Apps: Browser', 'SUPER + ALT + B'))

    def test_complete_live_state_passes_and_skips_mouse_keys(self):
        state, binds = self.live()
        rows = qualification.check_shortcut_state(state, binds)
        self.assertIn('workspaces.move.10', rows)

    def test_state_error_missing_action_or_unbound_key_fails(self):
        state, binds = self.live()
        for change in (lambda s, b: s.update(error='bad file'),
                       lambda s, b: s['actions'].pop(3),
                       lambda s, b: s['actions'][3].update(keys=[]),
                       lambda s, b: b.pop(3),
                       lambda s, b: s['custom'].append({'id': 'custom.x', 'group': 'Web', 'label': 'X',
                                                         'keys': ['SUPER + ALT + D']})):
            state, binds = self.live()
            change(state, binds)
            with self.subTest(change=change), self.assertRaises(AssertionError):
                qualification.check_shortcut_state(state, binds)

    def test_only_onboarding_qml_errors_fail_the_journal(self):
        lines = ['file:///nix/store/x/Welcome/HelloStep.qml:9: TypeError: Cannot read property',
                 'file:///nix/store/x/Settings/ShortcutRow.qml:4: Binding loop detected for property "width"',
                 'file:///nix/store/x/Bar/Clock.qml:3: ReferenceError: foo is not defined',
                 'qt.qpa.wayland: harmless warning']
        onboarding, other = qualification.onboarding_qml_errors(lines)
        self.assertEqual(onboarding, lines[:2])
        self.assertEqual(other, lines[2:3])

    def test_guest_script_compiles_with_its_checks(self):
        source = qualification.shortcuts_script()
        compile(source, 'qa-script.py', 'exec')
        self.assertIn('def check_shortcut_state', source)
        self.assertIn("SHORTCUT_REMAP = 'SUPER + ALT + B'", source)


class UpstreamHoldTests(unittest.TestCase):
    HELD = {'state': 'failed', 'changeKind': 'update', 'scope': 'upstream', 'notPrebuilt': ['codex-0.167.0', 'tectonic-0.17.0']}

    def test_packages_nixos_has_not_built_or_a_newer_release_are_a_hold(self):
        self.assertEqual(qualification.upstream_hold(self.HELD), {'notPrebuilt': ['codex-0.167.0', 'tectonic-0.17.0']})
        incompatible = {'origin': 'cybexos', 'file': 'nix/modules/applications.nix', 'message': 'gone'}
        self.assertEqual(qualification.upstream_hold(self.HELD | {'notPrebuilt': None, 'incompatible': incompatible}),
                         {'incompatible': incompatible})

    def test_any_other_failure_is_not(self):
        for change in ({'notPrebuilt': None}, {'notPrebuilt': []}, {'notPrebuilt': ['']}, {'state': 'ready'},
                       {'scope': 'both'}, {'changeKind': 'software'},
                       {'notPrebuilt': None, 'incompatible': {'origin': 'personal', 'file': 'local/x.nix'}}):
            with self.subTest(change=change):
                self.assertIsNone(qualification.upstream_hold(self.HELD | change))


class BootMenuIdentityTests(unittest.TestCase):
    profiles = [
        {'kernel': '/boot/kernel-a', 'initrd': '/boot/initrd-a', 'system': '/nix/store/system-a'},
        {'kernel': '/boot/kernel-b', 'initrd': '/boot/initrd-b', 'system': '/nix/store/system-b'},
    ]

    @staticmethod
    def grub(profile):
        return f"menuentry 'live' {{\nlinux {profile['kernel']} init={profile['system']}/init\ninitrd {profile['initrd']}\n}}\n"

    def test_distinct_complete_graphics_profiles(self):
        parity.check_boot_menu(''.join(map(self.grub, self.profiles)), self.profiles, 'grub')

    def test_bios_append_can_precede_or_follow_initrd(self):
        for commands in ('APPEND init={system}/init\nINITRD {initrd}', 'INITRD {initrd}\nAPPEND init={system}/init'):
            menu = ''.join(('LABEL live\nLINUX {kernel}\n' + commands + '\n').format(**p) for p in self.profiles)
            parity.check_boot_menu(menu, self.profiles, 'isolinux')

    def test_rejects_mixed_profile_paths(self):
        menu = ''.join(map(self.grub, self.profiles)).replace('initrd /boot/initrd-a', 'initrd /boot/initrd-b')
        with self.assertRaises(parity.ParityFailure):
            parity.check_boot_menu(menu, self.profiles, 'grub')

    def test_rejects_a_second_initrd_after_valid_tuple(self):
        menu = self.grub(self.profiles[0]).replace('\n}', '\ninitrd /boot/unexpected\n}')
        with self.assertRaises(parity.ParityFailure):
            parity.check_boot_menu(menu, self.profiles[:1], 'grub')

    def test_rejects_fields_split_across_entries(self):
        menu = "menuentry 'one' {\nlinux /boot/kernel-a init=/nix/store/system-a/init\n}\nmenuentry 'two' {\ninitrd /boot/initrd-a\n}\n"
        with self.assertRaises(parity.ParityFailure):
            parity.check_boot_menu(menu, self.profiles[:1], 'grub')

    def test_rejects_duplicate_init_parameter(self):
        menu = self.grub(self.profiles[0]).replace('/system-a/init', '/system-a/init init=/nix/store/other/init')
        with self.assertRaises(parity.ParityFailure):
            parity.check_boot_menu(menu, self.profiles[:1], 'grub')

    def test_requires_all_profiles(self):
        with self.assertRaises(parity.ParityFailure):
            parity.check_boot_menu(self.grub(self.profiles[0]), self.profiles, 'grub')


def ipc_limit(command):
    return int(re.search(r'CYBEXOS_IPC_TIMEOUT=([0-9]+) ', command).group(1))


class ShellIpcTests(unittest.TestCase):
    def test_reads_the_session_shell_with_the_vm_limit(self):
        command = qualification.shell_ipc('welcome status')
        self.assertTrue(command.startswith('runuser -u cybexqa -- env HOME=/home/cybexqa XDG_RUNTIME_DIR=/run/user/1000 '
                                           'DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus '))
        self.assertTrue(command.endswith(' cybexos-runtime ipc welcome status'))
        # Longer than the interactive 2 s a full-screen view can take to open.
        self.assertEqual(ipc_limit(command), qualification.SHELL_IPC_TIMEOUT)
        self.assertGreater(qualification.SHELL_IPC_TIMEOUT, 2)

    def test_limit_stays_within_what_cybexos_runtime_accepts(self):
        self.assertEqual(ipc_limit(qualification.shell_ipc('polkit status', 0.4)), 1)
        self.assertEqual(ipc_limit(qualification.shell_ipc('polkit status', -5)), 1)
        self.assertEqual(ipc_limit(qualification.shell_ipc('polkit status', 89.7)), 89)
        self.assertEqual(ipc_limit(qualification.shell_ipc('polkit status', 900)), 120)


class PromptStatusTests(unittest.TestCase):
    """The Polkit prompt check reads the shell while it opens the prompt."""

    NOT_YET = {'registered': True, 'active': True, 'responseRequired': False}
    READY = {'registered': True, 'active': True, 'responseRequired': True}

    class Guest(qualification.VM):
        def __init__(self, statuses):  # no QEMU; only the serial command transport is faked
            self.statuses, self.status_commands, self.keys = list(statuses), [], []
            self.slowest_prompt_status = 0

        def python(self, source, timeout=300):
            return ''

        def command(self, script, timeout=1800):
            if 'cybexos-runtime ipc polkit status' in script:
                self.status_commands.append(script)
                return json.dumps(self.statuses.pop(0) if len(self.statuses) > 1 else self.statuses[0]) + '\n'
            if script.startswith('cat ') and script.endswith('/code'):
                return '0\n'
            if script.startswith('cat ') and script.endswith('/stdout'):
                return '{"success": true}\n'
            return ''

        def type_text(self, text):
            self.keys.append('password')

        def press(self, *keys):
            self.keys.extend(keys)

    def test_waits_for_the_prompt_with_reads_bounded_by_its_deadline(self):
        guest = self.Guest([self.NOT_YET] * 3 + [self.READY])
        with mock.patch.object(qualification.time, 'sleep'):
            self.assertEqual(guest.authorize(['true']), (0, '{"success": true}'))
        self.assertEqual(len(guest.status_commands), 4)
        for command in guest.status_commands:
            self.assertTrue(2 < ipc_limit(command) <= 90, command)
        self.assertEqual(guest.keys, ['password', 'ret'])

    def test_a_prompt_that_never_asks_still_fails(self):
        guest = self.Guest([self.NOT_YET])
        clock = iter(range(0, 10000, 7))
        with mock.patch.object(qualification.time, 'sleep'), \
                mock.patch.object(qualification.time, 'monotonic', lambda: next(clock)):
            with self.assertRaisesRegex(RuntimeError, 'did not become ready'):
                guest.authorize(['true'])
        # No read may outlast the loop's own deadline: each may wait only for
        # what remains of it.
        limits = [ipc_limit(command) for command in guest.status_commands]
        self.assertGreater(len(limits), 2)
        self.assertLess(limits[0], 90)
        self.assertEqual(limits, sorted(set(limits), reverse=True))
        self.assertEqual(limits[-1], 1)
        self.assertEqual(guest.keys, [])


class FailureDiagnosticsTests(unittest.TestCase):
    guard = (ROOT / 'tests/lib/quickshell-live').read_text()
    PLUGIN_WARNING = ('[   49.218] cybexos-qa cybexos-runtime[1301]:   WARN scene: '
                      '@/home/cybexqa/.local/share/cybexos/plugins/personal.qualification/Widget.qml[1:34]: '
                      'Unable to assign [undefined] to QString')

    def test_shell_errors_are_the_ones_desktop_health_rejects(self):
        errors = qualification.shell_error_pattern(self.guard)
        self.assertTrue(errors.search(self.PLUGIN_WARNING))
        self.assertTrue(errors.search('qml: Bar.qml:3: TypeError: Cannot read property'))
        self.assertFalse(errors.search('  WARN qt.qpa.wayland.textinput: Trying to disable 0x1 but 0x0 is focused'))
        with self.assertRaises(ValueError):
            qualification.shell_error_pattern('#!/usr/bin/env bash\n')

    def test_findings_name_the_rejecting_check_ahead_of_the_restoration(self):
        rejected = ['quickshell live check: service invocation b1aa381ac5dc4ddab093c82d39432505 contains QML/runtime errors:',
                    self.PLUGIN_WARNING]
        log = '\n'.join(['copying path /nix/store/x-hello-2.12.3', *rejected,
                         'restarting the following units: polkit.service', 'Installing for x86_64-efi platform.',
                         *['setting up /etc...'] * 400])
        self.assertEqual(qualification.health_findings(log, qualification.shell_error_pattern(self.guard)), rejected)

    def test_findings_name_an_inactive_unit(self):
        line = ('hypridle.service is not active in the desktop session; inspect systemctl --user status '
                'hypridle.service and its journal before retrying')
        self.assertEqual(qualification.health_findings('a\n' + line + '\nb', re.compile('^$never')), [line])

    def test_guest_script_compiles_with_its_helpers(self):
        source = qualification.diagnostic_script()
        compile(source, 'qa-diagnostic.py', 'exec')
        self.assertIn('def health_findings', source)
        # A rolled-back activation's log is read as well.
        self.assertIn("'rolled-back'", source)
        self.assertNotIn('\nQA_DIAGNOSTIC\n', source)


class PersonalWidgetFixtureTests(unittest.TestCase):
    """The lifecycle's personal widget is never live without its setting."""

    def test_label_is_set_before_the_widget_is_enabled(self):
        state = qualification.PERSONAL_STATE
        self.assertLess(state.index('cybex plugin set personal.qualification label'),
                        state.index('cybex plugin enable personal.qualification'))

    def test_the_helper_keeps_a_setting_made_before_enabling(self):
        helper = ROOT / 'desktop/quickshell/scripts/user-plugins.py'
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            package = base / 'data/cybexos/plugins/personal.qualification'
            package.mkdir(parents=True)
            (package / 'manifest.json').write_text(json.dumps({
                'id': 'personal.qualification', 'name': 'Qualification', 'version': '1.0.0',
                'apiVersion': 1, 'entrypoint': 'Widget.qml'}))
            (package / 'Widget.qml').write_text('import QtQuick\nItem {}\n')
            environment = {key: value for key, value in os.environ.items()
                           if key not in ('CYBEXOS_USER_CONFIG_ROOT', 'CYBEXOS_PLUGIN_ROOT')}
            environment.update(HOME=str(base), XDG_CONFIG_HOME=str(base / 'config'), XDG_DATA_HOME=str(base / 'data'))

            def widget(*arguments):
                if arguments:
                    subprocess.run([sys.executable, str(helper), *arguments], env=environment, check=True)
                listed = subprocess.run([sys.executable, str(helper), 'list'], env=environment, check=True,
                                        capture_output=True, text=True).stdout
                return next(row for row in json.loads(listed)['widgets'] if row['id'] == 'personal.qualification')

            row = widget('set', 'personal.qualification', 'label', '"persistent-widget"')
            self.assertFalse(row['enabled'])
            row = widget('enable', 'personal.qualification', '--width', '120', '--order', '2')
            self.assertTrue(row['enabled'])
            self.assertEqual(row['settings'], {'label': 'persistent-widget'})


if __name__ == '__main__':
    unittest.main()
