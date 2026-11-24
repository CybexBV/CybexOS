"""The shell the update workflows run, outside GitHub: their steps' scripts,
taken from the workflow files, against a throwaway Git origin and stand-ins
for nix and gh. No network."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import textwrap
import unittest

ROOT = Path(__file__).resolve().parents[2]
WORKFLOWS = ROOT / '.github/workflows'


def step_script(workflow, name):
    """The `run: |` block of the step called `name`, dedented as YAML does."""
    lines = (WORKFLOWS / workflow).read_text().splitlines()
    start = next(i for i, line in enumerate(lines) if line.strip() == f'- name: {name}')
    run = next(i for i in range(start + 1, len(lines)) if lines[i].strip() == 'run: |')
    indent = len(lines[run]) - len(lines[run].lstrip())
    block = []
    for line in lines[run + 1:]:
        if line.strip() and len(line) - len(line.lstrip()) <= indent:
            break
        block.append(line)
    return textwrap.dedent('\n'.join(block)) + '\n'


class NixpkgsUpdateTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory(prefix='cybexos-workflow-')
        self.addCleanup(directory.cleanup)
        self.base = base = Path(directory.name)
        self.work, self.origin, tools = base / 'work', base / 'origin.git', base / 'bin'
        tools.mkdir()
        self.git('init', '--quiet', '--bare', str(self.origin), cwd=base)
        self.git('init', '--quiet', '--initial-branch=main', str(self.work), cwd=base)
        for key, value in (('user.name', 'Workflow Test'), ('user.email', 'workflow@example.invalid')):
            self.git('config', key, value)
        (self.work / 'flake.lock').write_text(json.dumps(self.lock('1' * 40)) + '\n')
        self.git('add', '.')
        self.git('commit', '--quiet', '-m', 'Fixture')
        self.git('remote', 'add', 'origin', str(self.origin))
        self.git('push', '--quiet', 'origin', 'main')
        # A stand-in nix: `flake update nixpkgs` moves the lock to $NEXT_REV.
        (tools / 'nix').write_text(
            '#!/bin/sh\nexec python3 -c "import json, os\n'
            "l = json.load(open('flake.lock'))\n"
            "l['nodes']['nixpkgs']['locked']['rev'] = os.environ['NEXT_REV']\n"
            "json.dump(l, open('flake.lock', 'w'))\"\n")
        (tools / 'nix').chmod(0o755)
        self.environment = os.environ | {'PATH': f'{tools}:{os.environ["PATH"]}',
                                         'GITHUB_OUTPUT': str(base / 'output'),
                                         'GITHUB_STEP_SUMMARY': str(base / 'summary')}

    @staticmethod
    def lock(rev):
        return {'version': 7, 'root': 'root', 'nodes': {'root': {'inputs': {'nixpkgs': 'nixpkgs'}},
                                                        'nixpkgs': {'locked': {'rev': rev}}}}

    def git(self, *arguments, cwd=None):
        return subprocess.run(['git', *arguments], cwd=cwd or self.work, check=True,
                              capture_output=True, text=True).stdout

    def run_step(self, rev):
        (self.base / 'output').write_text('')
        return subprocess.run(['bash', '-e', '-c', step_script('nixpkgs-update.yml', 'Move Nixpkgs on a branch')],
                              cwd=self.work, env=self.environment | {'NEXT_REV': rev},
                              capture_output=True, text=True)

    def test_a_moved_nixpkgs_is_committed_on_a_branch_and_pushed(self):
        result = self.run_step('2' * 40)
        self.assertEqual(result.returncode, 0, result.stderr)
        output = dict(line.split('=', 1) for line in (self.base / 'output').read_text().splitlines())
        self.assertEqual(output['changed'], 'true')
        self.assertEqual(output['branch'], 'nixpkgs-update')
        self.assertEqual((output['before'], output['after']), ('1' * 40, '2' * 40))
        pushed = self.git('show', f'{output["branch"]}:flake.lock', cwd=self.origin)
        self.assertEqual(json.loads(pushed)['nodes']['nixpkgs']['locked']['rev'], '2' * 40)
        self.assertIn('Update Nixpkgs to 222222222222',
                      self.git('log', '--format=%s', '-1', output['branch'], cwd=self.origin))
        # main never moves.
        self.assertEqual(json.loads(self.git('show', 'main:flake.lock', cwd=self.origin))
                         ['nodes']['nixpkgs']['locked']['rev'], '1' * 40)

    def test_the_next_update_replaces_the_branch(self):
        self.assertEqual(self.run_step('2' * 40).returncode, 0)
        self.git('checkout', '--quiet', 'main')
        self.git('branch', '--quiet', '-D', 'nixpkgs-update')
        result = self.run_step('3' * 40)
        self.assertEqual(result.returncode, 0, result.stderr)
        pushed = self.git('show', 'nixpkgs-update:flake.lock', cwd=self.origin)
        self.assertEqual(json.loads(pushed)['nodes']['nixpkgs']['locked']['rev'], '3' * 40)
        self.assertEqual(self.git('rev-list', '--count', 'main..nixpkgs-update', cwd=self.origin).strip(), '1')

    def test_an_unchanged_nixpkgs_pushes_nothing(self):
        result = self.run_step('1' * 40)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.base / 'output').read_text(), 'changed=false\n')
        self.assertEqual(self.git('branch', '--list', 'nixpkgs-update', cwd=self.origin), '')


class VendorReportTests(unittest.TestCase):
    def test_the_branch_report_lists_each_update(self):
        script = step_script('vendor-updates.yml', 'Push the update branch')
        start = script.index('python3 -I - "$RUNNER_TEMP/changes.json" <<')
        snippet = script[start:script.index('\nEOF\n', start) + len('\nEOF\n')]
        with tempfile.TemporaryDirectory(prefix='cybexos-workflow-') as temporary:
            (Path(temporary) / 'changes.json').write_text(json.dumps([
                {'title': 'Codex', 'from': '0.167.0', 'to': '0.167.2'},
                {'title': 'Brave Origin', 'from': '1.99.55', 'to': '1.99.57'}]))
            result = subprocess.run(['bash', '-e', '-c', snippet], env=os.environ | {'RUNNER_TEMP': temporary},
                                    capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, '- Codex 0.167.0 → 0.167.2\n- Brave Origin 1.99.55 → 1.99.57\n')


if __name__ == '__main__':
    unittest.main()
