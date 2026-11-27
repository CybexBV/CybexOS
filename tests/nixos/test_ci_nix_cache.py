"""scripts/ci-nix-cache: the full check's Nix cache on the runners' volumes."""
import contextlib
import importlib.machinery
import importlib.util
import io
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
loader = importlib.machinery.SourceFileLoader('ci_nix_cache', str(ROOT / 'scripts/ci-nix-cache'))
cache = importlib.util.module_from_spec(importlib.util.spec_from_loader('ci_nix_cache', loader))
loader.exec_module(cache)

BUILT = '/nix/store/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-cybexos-desktop-1.0.36'
FETCHED = '/nix/store/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-glibc-2.44'
DERIVATION = '/nix/store/cccccccccccccccccccccccccccccccc-cybexos-desktop-1.0.36.drv'


class BuiltPathsTest(unittest.TestCase):
    def test_only_what_this_runner_built_without_derivations(self):
        infos = {BUILT: {'ultimate': True}, FETCHED: {'ultimate': False}, DERIVATION: {'ultimate': True}}
        # Nix 2.19 and later key the listing by path; older ones give a list.
        self.assertEqual(cache.built_paths(json.dumps(infos)), [BUILT])
        listing = [dict(info, path=path) for path, info in infos.items()]
        self.assertEqual(cache.built_paths(json.dumps(listing)), [BUILT])


class PrepareTest(unittest.TestCase):
    """prepare() against temporary directories standing in for the volumes."""

    def setUp(self):
        directory = tempfile.TemporaryDirectory(prefix='ci-nix-cache-')
        self.addCleanup(directory.cleanup)
        self.shared = Path(directory.name, 'shared-cache')
        self.slot = Path(directory.name, 'cache')
        self.shared.mkdir()
        self.slot.mkdir()
        self.env = Path(directory.name, 'github-env')
        self.mounted = {self.shared, self.slot}
        self.used = {self.shared: 10, self.slot: 10}
        self.calls = []
        self.broken = set()  # commands that fail, by their first word

        def run(*command, check=True):
            self.calls.append(command)
            if command[0] in self.broken:
                if check:
                    raise subprocess.CalledProcessError(1, command)
                return mock.Mock(returncode=1)
            if command[0] == 'rm':
                shutil.rmtree(command[-1], ignore_errors=True)
            elif command[0] == 'mv':
                Path(command[-2]).rename(command[-1])
            elif command[0] == 'install':
                for path in command[4:]:
                    Path(path).mkdir(parents=True, exist_ok=True)
            return mock.Mock(returncode=0)
        for name, replacement in (('sudo', run), ('persistent', lambda volume: Path(volume) in self.mounted),
                                  ('percent_used', lambda volume: self.used[Path(volume)])):
            patcher = mock.patch.object(cache, name, side_effect=replacement)
            patcher.start()
            self.addCleanup(patcher.stop)

    def prepare(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.assertEqual(cache.prepare(self.shared, self.slot, env_file=str(self.env)), 0)
        self.output = output.getvalue()
        return dict(line.split('=', 1) for line in self.env.read_text().splitlines())

    def test_the_shared_volume_holds_the_cache_and_later_steps_are_told(self):
        (self.slot / 'nix' / 'nar').mkdir(parents=True)  # a slot cache from before the shared one
        env = self.prepare()
        self.assertEqual(env, {'CI_NIX_CACHE': str(self.shared / 'nix'),
                               'CI_NIX_SUBSTITUTER': f'file://{self.shared}/nix?trusted=true&priority=10'})
        self.assertTrue((self.shared / 'nix' / 'nar').is_dir())
        self.assertTrue((self.shared / 'nix' / 'realisations').is_dir())
        # Nothing reads the slot's own cache any more: its space is given back.
        self.assertFalse((self.slot / 'nix').exists())

    def test_a_nearly_full_shared_cache_is_renamed_away_then_deleted(self):
        (self.shared / 'nix' / 'nar').mkdir(parents=True)
        (self.shared / 'nix' / 'nar' / 'old.nar.zst').write_bytes(b'nar')
        (self.shared / 'nix.old-0badc0de').mkdir()  # left by a job stopped while deleting
        self.used[self.shared] = cache.FULL_PERCENT
        env = self.prepare()
        self.assertEqual(env['CI_NIX_CACHE'], str(self.shared / 'nix'))
        self.assertFalse((self.shared / 'nix' / 'nar' / 'old.nar.zst').exists())
        self.assertTrue((self.shared / 'nix' / 'nar').is_dir())
        self.assertEqual(sorted(p.name for p in self.shared.iterdir()), ['nix'])
        # The cache is renamed before anything is deleted, so a job that starts
        # meanwhile finds an empty cache rather than a half-deleted one.
        self.assertEqual(self.calls[0][0], 'mv')
        self.assertIn('clearing the Nix cache', self.output)

    def test_a_shared_cache_that_cannot_be_prepared_falls_back_to_the_slot(self):
        self.broken.add('install')
        with self.assertRaises(subprocess.CalledProcessError):
            self.prepare()  # the slot's own cache can't be made either: that still fails
        self.broken.clear()
        self.env.unlink(missing_ok=True)

        def install_fails_on_shared(*command, check=True):
            if command[0] == 'install' and str(self.shared) in command[-1]:
                raise subprocess.CalledProcessError(1, command)
            return original(*command, check=check)
        original = cache.sudo.side_effect
        cache.sudo.side_effect = install_fails_on_shared
        env = self.prepare()
        self.assertEqual(env['CI_NIX_CACHE'], str(self.slot / 'nix'))
        self.assertIn('::warning title=Shared Nix cache unavailable::', self.output)
        self.assertTrue((self.slot / 'nix' / 'nar').is_dir())

    def test_without_the_shared_volume_the_slot_keeps_the_cache(self):
        self.mounted.discard(self.shared)
        (self.slot / 'nix' / 'nar').mkdir(parents=True)
        (self.slot / 'nix' / 'nar' / 'kept.nar.zst').write_bytes(b'nar')
        env = self.prepare()
        self.assertEqual(env['CI_NIX_CACHE'], str(self.slot / 'nix'))
        self.assertTrue((self.slot / 'nix' / 'nar' / 'kept.nar.zst').exists())

    def test_without_a_volume_nothing_is_cleared_or_kept(self):
        self.mounted.clear()
        env = self.prepare()
        self.assertEqual(env['CI_NIX_CACHE'], str(self.slot / 'nix'))
        self.assertTrue((self.slot / 'nix').is_dir())
        self.assertFalse([c for c in self.calls if c[0] in ('rm', 'mv')])
        with mock.patch.object(cache.subprocess, 'run') as run, contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(cache.save(str(self.slot / 'nix'), self.shared, self.slot), 0)
        run.assert_not_called()


class SaveTest(unittest.TestCase):
    def save(self, results, cache_dir='/shared-cache/nix'):
        listing = json.dumps({BUILT: {'ultimate': True}, FETCHED: {'ultimate': False}})
        with mock.patch.object(cache, 'persistent', return_value=True), \
                mock.patch.object(cache.shutil, 'which', return_value='/bin/nix'), \
                mock.patch.object(cache, 'percent_used', return_value=10), \
                mock.patch.object(cache.subprocess, 'run',
                                  side_effect=[mock.Mock(returncode=0, stdout=listing), *results]) as run, \
                contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(cache.save(cache_dir), 0)
        return run

    def test_copies_the_built_paths_to_the_cache_prepare_chose(self):
        run = self.save([mock.Mock(returncode=0)])
        copy = run.call_args_list[1]
        self.assertEqual(copy.args[0][-4:], ['copy', '--to',
                                             'file:///shared-cache/nix?compression=zstd&parallel-compression=true',
                                             '--stdin'])
        self.assertEqual(copy.kwargs['input'], BUILT + '\n')

    def test_a_failed_copy_never_fails_the_job(self):
        self.save([mock.Mock(returncode=1)], '/cache/nix')


if __name__ == '__main__':
    unittest.main()
