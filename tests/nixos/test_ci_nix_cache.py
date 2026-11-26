"""scripts/ci-nix-cache: the full check's Nix cache on a runner's own volume."""
import importlib.machinery
import importlib.util
import json
from pathlib import Path
import shutil
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

    def test_paths_without_details_are_skipped(self):
        self.assertEqual(cache.built_paths(json.dumps({BUILT: None, FETCHED: {}})), [])


class PrepareTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory(prefix='ci-nix-cache-')
        self.addCleanup(directory.cleanup)
        self.volume = Path(directory.name)
        self.cache = self.volume / 'nix'
        self.calls = []

        def run(*command):
            self.calls.append(command)
            if command[0] == 'rm':
                shutil.rmtree(command[-1])
            else:
                for path in command[4:]:
                    Path(path).mkdir(parents=True, exist_ok=True)
        patcher = mock.patch.object(cache, 'sudo', side_effect=run)
        patcher.start()
        self.addCleanup(patcher.stop)

    def usage(self, percent):
        return mock.patch.object(cache.shutil, 'disk_usage', return_value=mock.Mock(total=100, used=percent))

    def test_creates_the_cache_and_keeps_it_below_the_limit(self):
        (self.cache / 'nar').mkdir(parents=True)
        (self.cache / 'nar' / 'kept.nar.zst').write_bytes(b'nar')
        with mock.patch.object(cache, 'persistent', return_value=True), self.usage(40):
            cache.prepare(self.volume, self.cache)
        self.assertTrue((self.cache / 'nar' / 'kept.nar.zst').exists())
        self.assertTrue((self.cache / 'realisations').is_dir())

    def test_a_nearly_full_volume_starts_cold(self):
        (self.cache / 'nar').mkdir(parents=True)
        (self.cache / 'nar' / 'old.nar.zst').write_bytes(b'nar')
        with mock.patch.object(cache, 'persistent', return_value=True), self.usage(cache.FULL_PERCENT):
            cache.prepare(self.volume, self.cache)
        self.assertFalse((self.cache / 'nar' / 'old.nar.zst').exists())
        self.assertTrue((self.cache / 'nar').is_dir())
        self.assertEqual(self.calls[0][:3], ('rm', '-rf', '--one-file-system'))

    def test_without_a_volume_nothing_is_cleared_or_kept(self):
        with mock.patch.object(cache, 'persistent', return_value=False):
            cache.prepare(self.volume, self.cache)
            with mock.patch.object(cache.subprocess, 'run') as run:
                self.assertEqual(cache.save(self.volume), 0)
        run.assert_not_called()
        self.assertTrue(self.cache.is_dir())


class SaveTest(unittest.TestCase):
    def test_copies_the_built_paths_to_the_cache(self):
        listing = json.dumps({BUILT: {'ultimate': True}, FETCHED: {'ultimate': False}})
        results = [mock.Mock(returncode=0, stdout=listing), mock.Mock(returncode=0)]
        with mock.patch.object(cache, 'persistent', return_value=True), \
                mock.patch.object(cache.shutil, 'which', return_value='/bin/nix'), \
                mock.patch.object(cache.shutil, 'disk_usage', return_value=mock.Mock(total=100, used=10)), \
                mock.patch.object(cache.subprocess, 'run', side_effect=results) as run:
            self.assertEqual(cache.save(Path('/cache'), 'file:///cache/nix'), 0)
        copy = run.call_args_list[1]
        self.assertEqual(copy.args[0][-4:], ['copy', '--to', 'file:///cache/nix', '--stdin'])
        self.assertEqual(copy.kwargs['input'], BUILT + '\n')

    def test_a_failed_copy_never_fails_the_job(self):
        listing = json.dumps({BUILT: {'ultimate': True}})
        results = [mock.Mock(returncode=0, stdout=listing), mock.Mock(returncode=1)]
        with mock.patch.object(cache, 'persistent', return_value=True), \
                mock.patch.object(cache.shutil, 'which', return_value='/bin/nix'), \
                mock.patch.object(cache.shutil, 'disk_usage', return_value=mock.Mock(total=100, used=10)), \
                mock.patch.object(cache.subprocess, 'run', side_effect=results):
            self.assertEqual(cache.save(Path('/cache'), 'file:///cache/nix'), 0)


if __name__ == '__main__':
    unittest.main()
