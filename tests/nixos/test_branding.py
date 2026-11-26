"""Verify delivered art integrity, boot-image geometry and readable brand colours."""
import hashlib
import json
from pathlib import Path
import struct
import unittest

ROOT = Path(__file__).resolve().parents[2]


class BrandAssets(unittest.TestCase):

    def test_supplied_masters_and_every_deployment_copy_are_unmodified(self):
        manifest = json.loads((ROOT / 'assets/brand/kit-sha256.json').read_text())
        self.assertEqual(manifest['schema'], 1)
        for name, record in manifest['files'].items():
            with self.subTest(asset=name, source=record['source']):
                self.assertEqual(hashlib.sha256((ROOT / name).read_bytes()).hexdigest(), record['sha256'])

    def test_plymouth_and_hinted_icon_dimensions(self):
        paths = {'desktop/plymouth/logo.png': (189, 44), 'desktop/plymouth/logo@2x.png': (378, 88),
                 'desktop/boot/splash.png': (640, 480)}
        paths.update({f'desktop/icons/hicolor/{size}x{size}/apps/cybexos.png': (size, size)
                      for size in (16, 32, 48, 64, 128, 256, 512)})
        for name, dimensions in paths.items():
            with self.subTest(asset=name):
                data = (ROOT / name).read_bytes()
                self.assertEqual(data[:8], b'\x89PNG\r\n\x1a\n')
                self.assertEqual(struct.unpack('!II', data[16:24]), dimensions)

if __name__ == '__main__':
    unittest.main()
