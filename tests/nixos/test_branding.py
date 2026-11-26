"""Verify delivered art integrity, boot-image geometry and readable brand colours."""
import hashlib
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]


class BrandAssets(unittest.TestCase):

    def test_supplied_masters_and_every_deployment_copy_are_unmodified(self):
        manifest = json.loads((ROOT / 'assets/brand/kit-sha256.json').read_text())
        self.assertEqual(manifest['schema'], 1)
        for name, record in manifest['files'].items():
            with self.subTest(asset=name, source=record['source']):
                self.assertEqual(hashlib.sha256((ROOT / name).read_bytes()).hexdigest(), record['sha256'])

if __name__ == '__main__':
    unittest.main()
