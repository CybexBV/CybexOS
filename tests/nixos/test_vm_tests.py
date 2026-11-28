"""The guards around the VM tests: each has a time limit of its own, fast-test
runs the ones a change touches (scripts/vm-test) and the full check's
watcher stops waiting on a stuck step (scripts/watch-full-check)."""
from datetime import datetime, timedelta, timezone
import importlib.machinery
import importlib.util
import json
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]


def load(name, path):
    loader = importlib.machinery.SourceFileLoader(name, str(ROOT / path))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


vm_test = load('vm_test', 'scripts/vm-test')
watch = load('watch_full_check', 'scripts/watch-full-check')


class TimeLimitTests(unittest.TestCase):
    def test_every_vm_test_fails_a_hang_within_half_an_hour(self):
        # The driver's default is an hour, and the full check runs a failed
        # test once more: a hang cost two hours on 2026-11-28.
        tests = vm_test.vm_tests()
        self.assertIn('nix/tests/hyprland-pointer.nix', tests)
        for path in tests:
            with self.subTest(path):
                limits = re.findall(r'^  globalTimeout = (\d+);', (ROOT / path).read_text(), re.M)
                self.assertEqual(len(limits), 1)
                self.assertLessEqual(int(limits[0]), 1800)


class ChangedTests(unittest.TestCase):
    def test_a_changed_test_runs(self):
        self.assertEqual(vm_test.changed_tests(['nix/tests/lid-guard.nix']), ['lid-guard'])
        self.assertEqual(vm_test.changed_tests(['nix/tests/lifecycle.nix']), ['vm'])

    def test_a_changed_helper_runs_the_tests_using_it(self):
        self.assertEqual(vm_test.changed_tests(['nix/tests/portal-open.py']), ['hyprland-pointer'])

    def test_code_a_test_covers_runs_it(self):
        self.assertEqual(vm_test.changed_tests(['assets/scripts/cybexos-apps']), ['hyprland-pointer'])
        self.assertEqual(vm_test.changed_tests(['desktop/hypr/looknfeel.lua']), ['hyprland-pointer'])

    def test_other_changes_run_none(self):
        self.assertEqual(vm_test.changed_tests(['README.md', 'nix/tests/parity.nix', 'desktop/hyprland.txt']), [])

    def test_fast_test_runs_the_step_for_exactly_these_paths(self):
        steps = {step['name']: step for step in json.loads((ROOT / '.fast-test.json').read_text())['steps']}
        step = steps['vm-tests']
        covered = [pattern for patterns in vm_test.COVERS.values() for pattern in patterns]
        self.assertEqual(step['when'], ['nix/tests/**', *covered])
        self.assertEqual(step['run'], 'scripts/vm-test --changed {files}')
        self.assertEqual(step.get('worksOn'), 'beast')


def step(name, status, started=None, completed=None):
    stamp = lambda moment: moment and moment.strftime('%Y-%m-%dT%H:%M:%SZ')
    return {'name': name, 'status': status, 'started_at': stamp(started), 'completed_at': stamp(completed)}


class WatchTests(unittest.TestCase):
    start = datetime(2026, 11, 28, 8, 0, tzinfo=timezone.utc)

    def usual(self):
        passing = [{'name': 'checks', 'steps': [
            step('Build the desktop VM tests', 'completed', self.start, self.start + timedelta(minutes=20))]}]
        return watch.durations(passing)

    def running(self, minutes, name='Build the desktop VM tests'):
        return [{'name': 'checks', 'steps': [step(name, 'in_progress', self.start)]}], self.start + timedelta(minutes=minutes)

    def test_a_step_within_its_usual_time_is_not_overdue(self):
        jobs, now = self.running(39)
        self.assertEqual(watch.overdue(jobs, self.usual(), now), [])

    def test_a_step_far_past_its_usual_time_is_overdue(self):
        # 20 minutes then: overdue after 20 × 1.5 + 10 = 40 minutes.
        jobs, now = self.running(41)
        [(job, name, spent, before)] = watch.overdue(jobs, self.usual(), now)
        self.assertEqual((job, name, spent, before), ('checks', 'Build the desktop VM tests', 41 * 60, 20 * 60))

    def test_a_step_the_last_run_had_not_gets_an_hour(self):
        jobs, now = self.running(59, 'A new step')
        self.assertEqual(watch.overdue(jobs, self.usual(), now), [])
        jobs, now = self.running(61, 'A new step')
        self.assertEqual(len(watch.overdue(jobs, self.usual(), now)), 1)


if __name__ == '__main__':
    unittest.main()
