"""Tests for the friendly `cybex` CLI, formatting, guided flows, `--json` and completions."""

import contextlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'lifecycle'))

from cybexos import cli, cli_flows
from cybexos.common import Failure


def run_cli(*argv, stdin_tty=False, answers=()):
    stdout, stderr = io.StringIO(), io.StringIO()
    answer_iter = iter(answers)
    with patch.object(sys, 'argv', ['cybex', *argv]), \
         patch.object(sys.stdin, 'isatty', return_value=stdin_tty), \
         patch('builtins.input', side_effect=lambda _prompt='': next(answer_iter)), \
         contextlib.redirect_stdout(stdout), \
         contextlib.redirect_stderr(stderr):
        try:
            cli.main()
            code = 0
        except SystemExit as exc:
            code = exc.code if isinstance(exc.code, int) else 1
    return code, stdout.getvalue(), stderr.getvalue()


class HelpAndDispatchTests(unittest.TestCase):

    def test_shell_plugin_and_theme_help_are_not_swallowed(self):
        code, out, _ = run_cli('update', '--help')
        self.assertEqual(code, 0)
        self.assertNotIn('==SUPPRESS==', out)
        self.assertNotIn('retry-failed', out)

        code, out, _ = run_cli('shell', '--help')
        self.assertEqual(code, 0)
        self.assertIn('cybex shell', out)
        self.assertIn('recover', out)

        with patch.object(cli.os, 'execvpe', side_effect=SystemExit(0)) as execvpe:
            code, _, _ = run_cli('plugin', '--help')
        self.assertEqual(code, 0)
        self.assertEqual(execvpe.call_args.args[1], ['cybexos-runtime', 'plugin', '--help'])
        self.assertEqual(execvpe.call_args.args[2]['CYBEX_CLI_PROG'], 'cybex plugin')

        with patch.object(cli.os, 'execvp', side_effect=SystemExit(0)) as execvp:
            code, _, _ = run_cli('theme', '--help')
        self.assertEqual(code, 0)
        self.assertEqual(execvp.call_args.args[1], ['cybexos-theme', '--help'])

    def test_ask_forwards_to_assistant_ask(self):
        with patch.object(cli.os, 'execvp', side_effect=SystemExit(0)) as execvp:
            code, _, _ = run_cli('ask', '--agent', 'claude', 'why', 'is', 'the', 'fan', 'loud')
        self.assertEqual(code, 0)
        self.assertEqual(execvp.call_args.args[1], ['cybexos-assistant', 'ask', '--agent', 'claude', 'why', 'is', 'the', 'fan', 'loud'])

    def test_errors_are_plain_text_for_humans_and_json_for_json_or_plumbing(self):
        stderr = io.StringIO()
        with patch.object(sys, 'argv', ['cybex', 'update', 'status']), \
             patch.object(cli, 'LIVE_MARKER', Path('/nonexistent-live-marker')), \
             patch.object(cli, 'update_status', side_effect=Failure('Something broke')), \
             contextlib.redirect_stderr(stderr), \
             self.assertRaises(SystemExit) as result:
            cli.entry(cli.main)
        self.assertEqual(result.exception.code, 1)
        self.assertEqual(stderr.getvalue().strip(), 'cybex: Something broke')

        stderr = io.StringIO()
        with patch.object(sys, 'argv', ['cybex', 'update', 'status', '--json']), \
             patch.object(cli, 'LIVE_MARKER', Path('/nonexistent-live-marker')), \
             patch.object(cli, 'update_status', side_effect=Failure('Something broke')), \
             contextlib.redirect_stderr(stderr), \
             self.assertRaises(SystemExit) as result:
            cli.entry(cli.main)
        self.assertEqual(result.exception.code, 1)
        self.assertEqual(json.loads(stderr.getvalue()), {'error': 'Something broke'})


class ReadableOutputAndJsonParityTests(unittest.TestCase):
    def test_update_check_status_history_and_hardware_support_both_human_and_json(self):
        discovery = {
            'cybexos': {'state': 'available', 'installed': '1.0.34', 'available': '1.0.35', 'channel': 'stable'},
            'upstream': {'state': 'available', 'release': '1.0.35'},
            'firmware': {'state': 'current', 'devices': []},
        }
        with patch.object(cli, 'LIVE_MARKER', Path('/nonexistent-live-marker')), \
             patch.object(cli, 'run_check', return_value=discovery):
            code, out, _ = run_cli('update', 'check')
            self.assertEqual(code, 0)
            self.assertIn('1.0.34 → 1.0.35', out)
            self.assertIn("cybex update", out)

            code, out_json, _ = run_cli('update', 'check', '--json')
            self.assertEqual(code, 0)
            self.assertEqual(json.loads(out_json), discovery)

            code, out_json2, _ = run_cli('--json', 'update', 'check')
            self.assertEqual(code, 0)
            # The desktop's own checks reuse GitHub's recent answers; a person's ask again.
            with patch.object(cli, 'run_check', return_value=discovery) as checked:
                self.assertEqual(run_cli('update', 'check', '--json', '--cached')[0], 0)
                self.assertEqual(run_cli('update', 'check', '--json')[0], 0)
            self.assertEqual([call.args for call in checked.call_args_list], [(True,), (False,)])
            self.assertEqual(json.loads(out_json2), discovery)

        records = [
            {'id': 'a' * 32, 'createdAt': 1760000000, 'changeKind': 'update', 'availableVersion': '1.0.34', 'good': True},
            {'id': 'b' * 32, 'createdAt': 1760100000, 'changeKind': 'software', 'scope': 'local', 'failed': {'at': 1760100010}},
        ]
        with patch.object(cli, 'LIVE_MARKER', Path('/nonexistent-live-marker')), \
             patch.object(cli_flows, 'run_privileged', return_value=records):
            code, out, _ = run_cli('update', 'history')
            self.assertEqual(code, 0)
            self.assertIn('Update history (2 deployments)', out)
            self.assertIn('aaaaaaaa', out)
            self.assertIn('confirmed', out)
            self.assertIn('failed', out)

        hw = {
            'schema': 'cybexos.hardware-inventory.v1',
            'support': {'profileId': 'dell-xps-14', 'profileName': 'Dell XPS 14', 'status': 'experimental', 'summary': 'Matched profile.', 'limitations': []},
            'configuration': {'summary': 'Configured.'},
            'system': {'sys_vendor': 'Dell', 'product_name': 'XPS 14', 'bios_version': '1.2', 'bios_date': '2026-10-01'},
            'cpu': {'model name': 'Intel Core Ultra'},
            'kernel': '6.18.4', 'architecture': 'x86_64',
            'firmware': {'uefi': True, 'secureBoot': False},
            'disks': [{'name': 'nvme0n1', 'sizeBytes': 512 * 1024**3, 'model': 'Samsung'}],
            'assessment': {'graphicsDevices': [{'vendor': '8086', 'device': '1234', 'driver': 'xe'}],
                           'networkDevices': [], 'blockers': [], 'networkIssues': []},
        }
        with patch('cybexos.hardware.report', return_value=hw):
            code, out, _ = run_cli('hardware')
            self.assertEqual(code, 0)
            self.assertIn('Dell XPS 14', out)
            self.assertIn('Intel Core Ultra', out)

            code, out_json, _ = run_cli('hardware', '--json')
            self.assertEqual(code, 0)
            self.assertEqual(json.loads(out_json)['schema'], 'cybexos.hardware-inventory.v1')

    def test_update_check_says_why_packages_stay(self):
        held = 'NixOS packages stay on nixos-unstable: test reason.'
        discovery = {'cybexos': {'state': 'current', 'installed': '1.0.38', 'channel': 'beta'},
                     'upstream': {'state': 'current', 'held': held},
                     'firmware': {'state': 'current', 'devices': []}}
        with patch.object(cli, 'LIVE_MARKER', Path('/nonexistent-live-marker')), \
             patch.object(cli, 'run_check', return_value=discovery):
            code, out, _ = run_cli('update', 'check')
        self.assertEqual(code, 0)
        self.assertIn(held, out)
        self.assertNotIn('Packages   Up to date', out)

    def test_status_overview_human_and_json(self):
        sample = {
            'version': '1.0.34', 'channel': 'stable', 'nixos': '26.11',
            'updates': {'state': 'ready', 'availableVersion': '1.0.35', 'phase': 'Ready', 'transaction': 'a' * 32},
            'storage': {'available': 142 * 1024**3, 'total': 500 * 1024**3, 'low': False, 'cleanable': 6 * 1024**3},
            'backup': {'state': 'ok', 'destination': 'sftp://nas', 'lastTime': '2026-11-26T04:00:00Z'},
            'desktop': {'safeMode': False, 'enabledPlugins': 3, 'theme': 'cybex-dark'},
            'region': {'timezone': 'Europe/Amsterdam', 'locale': 'en_US.UTF-8'},
        }
        with patch.object(cli_flows, 'collect_status', return_value=sample):
            code, out, _ = run_cli('status')
            self.assertEqual(code, 0)
            self.assertIn('Cybex OS 1.0.34', out)
            self.assertIn('Ready to apply (1.0.35)', out)
            self.assertIn('6.0 GiB cleanable', out)
            self.assertIn('3 plugins enabled', out)
            self.assertIn('Europe/Amsterdam', out)

            code, out_json, _ = run_cli('status', '--json')
            self.assertEqual(code, 0)
            self.assertEqual(json.loads(out_json), sample)

    def test_shell_status_formats_human_and_forwards_json(self):
        fake = SimpleNamespace(returncode=0, stdout=json.dumps({'safe': True, 'active': False, 'reason': 'Repeated crashes', 'failures': [1, 2, 3], 'runtime': '/etc/cybexos/runtime/quickshell/safe-mode'}), stderr='')
        with patch.object(cli.subprocess, 'run', return_value=fake):
            code, out, _ = run_cli('shell', 'status')
        self.assertEqual(code, 0)
        self.assertIn('safe mode', out)
        self.assertIn('cybex shell recover', out)

        with patch.object(cli.os, 'execvp', side_effect=SystemExit(0)) as execvp:
            code, _, _ = run_cli('shell', 'status', '--json')
        self.assertEqual(code, 0)
        self.assertEqual(execvp.call_args.args[1], ['cybexos-runtime', 'shell', 'status'])


class GuidedFlowTests(unittest.TestCase):
    def test_guided_update_checks_stages_shows_highlights_and_applies_on_confirm(self):
        discovery = {
            'cybexos': {'state': 'available', 'installed': '1.0.34', 'available': '1.0.35', 'channel': 'stable'},
            'upstream': {'state': 'available', 'release': '1.0.35'},
            'firmware': {'state': 'current', 'devices': []},
        }
        prepared = {
            'state': 'ready', 'transaction': 'a' * 32, 'reviewToken': 'b' * 64,
            'highlights': {'schema': 1, 'components': [{'id': 'cybexos', 'before': '1.0.34', 'after': '1.0.35'}],
                           'apps': [], 'tools': [], 'background': 4, 'sizeChange': 10 * 1024**2},
            'restart': 'Restart required after applying.', 'desktopRestart': '',
        }
        applied = {'state': 'awaiting-boot', 'phase': 'Restart when ready.'}
        privileged_calls = []

        def fake_priv(action, *extra, **kwargs):
            privileged_calls.append((action, *extra))
            return {'accepted': True, 'requestId': 'c' * 32}

        with patch.object(cli, 'LIVE_MARKER', Path('/nonexistent-live-marker')), \
             patch.object(cli, 'update_status', return_value={'state': 'idle'}), \
             patch.object(cli, 'run_check', return_value=discovery), \
             patch.object(cli_flows, 'run_privileged', side_effect=fake_priv), \
             patch.object(cli_flows, 'wait_for_update', side_effect=[prepared, applied]):
            code, out, _ = run_cli('update', stdin_tty=True, answers=('y',))

        self.assertEqual(code, 0)
        self.assertEqual(privileged_calls, [('stage', 'both'), ('apply', 'a' * 32, 'b' * 64)])
        self.assertIn('Cybex OS', out)
        self.assertIn('1.0.34 → 1.0.35', out)
        self.assertIn('Restart when convenient', out)

    def test_guided_update_declining_keeps_prepared_update(self):
        ready = {
            'state': 'ready', 'transaction': 'a' * 32, 'reviewToken': 'b' * 64,
            'highlights': {'schema': 1, 'components': [{'id': 'kernel', 'before': '6.18.1', 'after': '6.18.2'}],
                           'apps': [], 'tools': [], 'background': 0, 'sizeChange': 0},
        }
        with patch.object(cli, 'LIVE_MARKER', Path('/nonexistent-live-marker')), \
             patch.object(cli, 'update_status', return_value=ready), \
             patch.object(cli_flows, 'run_privileged') as priv:
            code, out, _ = run_cli('update', stdin_tty=True, answers=('n',))
        self.assertEqual(code, 0)
        priv.assert_not_called()
        self.assertIn('Prepared change kept', out)

    def test_apps_install_resolves_catalogue_checks_prebuilt_and_stages_with_previous(self):
        inv = {'schema': 1, 'selected': ['firefox'], 'desired': ['firefox'], 'packages': []}
        checked = {'prebuilt': True, 'downloadBytes': 1024, 'compiles': [],
                   'packages': {'kdePackages.okular': {'state': 'prebuilt', 'version': '25.04'}}}
        prepared = {'state': 'ready', 'transaction': 'a' * 32, 'reviewToken': 'b' * 64,
                    'highlights': {'schema': 1, 'components': [], 'apps': [{'name': 'okular', 'title': 'Okular', 'kind': 'added', 'before': None, 'after': '25.04'}],
                                   'tools': [], 'background': 0, 'sizeChange': 0}}
        applied = {'state': 'done'}
        calls = []

        def fake_priv(action, *extra, **kwargs):
            calls.append((action, *extra))
            return {'accepted': True, 'requestId': 'd' * 32}

        with patch.object(cli, 'LIVE_MARKER', Path('/nonexistent-live-marker')), \
             patch.object(cli_flows, '_resolve_catalogue_app', return_value={'id': 'okular', 'attribute': 'kdePackages.okular', 'name': 'Okular'}), \
             patch('cybexos.software.inventory', return_value=inv), \
             patch('cybexos.software.check', return_value=checked), \
             patch.object(cli, 'update_status', return_value={'state': 'idle', 'transaction': None}), \
             patch.object(cli_flows, 'run_privileged', side_effect=fake_priv), \
             patch.object(cli_flows, 'wait_for_update', side_effect=[prepared, applied]):
            code, out, _ = run_cli('apps', 'install', 'okular', '--yes')

        self.assertEqual(code, 0)
        self.assertEqual(calls[0][0], 'software')
        self.assertEqual(json.loads(calls[0][1]), {'packages': ['firefox', 'kdePackages.okular'], 'previous': ['firefox']})
        self.assertEqual(calls[1], ('apply', 'a' * 32, 'b' * 64))
        self.assertIn('Okular', out)

    def test_apps_install_refuses_compiling_nix_package(self):
        inv = {'schema': 1, 'selected': [], 'desired': [], 'packages': []}
        checked = {'prebuilt': False, 'downloadBytes': 0, 'compiles': ['linux-6.18'],
                   'packages': {'foo': {'state': 'compiles', 'compiles': ['linux-6.18']}}}
        with patch.object(cli, 'LIVE_MARKER', Path('/nonexistent-live-marker')), \
             patch.object(cli_flows, '_resolve_catalogue_app', return_value=None), \
             patch('cybexos.software.inventory', return_value=inv), \
             patch('cybexos.software.check', return_value=checked), \
             self.assertRaisesRegex(Failure, 'would compile locally'):
            with patch.object(sys, 'argv', ['cybex', 'apps', 'install', 'foo', '--yes']):
                cli.main()

    def test_cleanup_guided_flow_previews_confirms_and_cleans(self):
        preview = {'state': 'ready', 'reviewId': '1' * 32, 'reviewToken': '2' * 64,
                   'estimatedBytes': 6 * 1024**3, 'candidates': ['3' * 32],
                   'policy': {'automatic': True, 'keepConfirmed': 5, 'keepDays': 30},
                   'space': {'available': 100 * 1024**3, 'total': 500 * 1024**3}}
        done = {'state': 'done', 'reclaimedBytes': 6 * 1024**3}
        calls = []

        def fake_priv(action, *extra, **kwargs):
            calls.append((action, *extra))
            return {'accepted': True, 'requestId': 'e' * 32}

        with patch.object(cli, 'LIVE_MARKER', Path('/nonexistent-live-marker')), \
             patch.object(cli_flows, 'run_privileged', side_effect=fake_priv), \
             patch.object(cli_flows, 'wait_for_maintenance', side_effect=[preview, done]):
            code, out, _ = run_cli('cleanup', stdin_tty=True, answers=('y',))

        self.assertEqual(code, 0)
        self.assertEqual(calls, [('maintenance-preview',), ('maintenance-clean', '1' * 32, '2' * 64)])
        self.assertIn('6.0 GiB', out)

    def test_region_set_populates_previous_automatically(self):
        prepared = {'state': 'ready', 'transaction': 'a' * 32, 'reviewToken': 'b' * 64, 'highlights': None}
        applied = {'state': 'awaiting-boot'}
        calls = []

        def fake_priv(action, *extra, **kwargs):
            calls.append((action, *extra))
            return {'accepted': True}

        with patch.object(cli, 'LIVE_MARKER', Path('/nonexistent-live-marker')), \
             patch.object(cli_flows, 'read_region_state', return_value={'timezone': 'UTC', 'locale': 'en_US.UTF-8', 'localeValues': ['LANG=en_US.UTF-8']}), \
             patch.object(cli_flows, '_list_timezones', return_value=['Europe/Amsterdam', 'UTC']), \
             patch.object(cli, 'update_status', return_value={'state': 'idle', 'transaction': None}), \
             patch.object(cli_flows, 'run_privileged', side_effect=fake_priv), \
             patch.object(cli_flows, 'wait_for_update', side_effect=[prepared, applied]):
            code, out, _ = run_cli('region', 'set', '--timezone', 'Europe/Amsterdam', '--yes')

        self.assertEqual(code, 0)
        self.assertEqual(calls[0][0], 'region')
        self.assertEqual(json.loads(calls[0][1]), {
            'changes': [{'field': 'timezone', 'value': 'Europe/Amsterdam', 'previous': 'UTC'}],
        })
        self.assertEqual(calls[1], ('apply', 'a' * 32, 'b' * 64))
        self.assertIn('Europe/Amsterdam', out)

    def test_run_privileged_always_uses_absolute_pkexec_and_request_bin(self):
        ok = SimpleNamespace(returncode=0, stdout='{"accepted": true}', stderr='')
        with patch.dict(os.environ, {'PATH': '/tmp/hostile'}), \
             patch.object(cli_flows.subprocess, 'run', return_value=ok) as run:
            result = cli_flows.run_privileged('stage', 'local')
        self.assertEqual(result, {'accepted': True})
        self.assertEqual(run.call_args.args[0], [cli.PKEXEC, cli_flows.REQUEST_BIN, 'stage', 'local'])


class FishCompletionTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which('fish'), 'fish is not installed')
    def test_fish_completions_parse_and_complete_top_level_commands(self):
        completion_file = ROOT / 'lifecycle/completions/cybex.fish'
        check = subprocess.run(['fish', '--no-execute', str(completion_file)], capture_output=True, text=True)
        self.assertEqual(check.returncode, 0, check.stderr)

        with tempfile.TemporaryDirectory() as tmp:
            env = {**os.environ, 'HOME': tmp, 'XDG_CONFIG_HOME': tmp + '/cfg', 'XDG_DATA_HOME': tmp + '/data'}
            query = subprocess.run(
                ['fish', '--no-config', '-c', f'source {completion_file}; complete -C "cybex "'],
                capture_output=True, text=True, env=env,
            )
            self.assertEqual(query.returncode, 0, query.stderr)
            words = {line.split('\t', 1)[0] for line in query.stdout.splitlines() if line}
            self.assertTrue({'status', 'update', 'apps', 'cleanup', 'region', 'ask', 'doctor', 'theme'} <= words, words)

if __name__ == '__main__':
    unittest.main()
