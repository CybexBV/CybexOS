"""The feature lists and catalogue rules both installer front ends share."""
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'lifecycle'))
from cybexos import install_features
from cybexos.common import Failure


GOOD_APP = {'id': 'good', 'attribute': 'kdePackages.good'}
GOOD_PROFILE = {'id': 'mine', 'apps': ['good'], 'features': {'developer': True}}


class FeatureListTests(unittest.TestCase):
    def test_lists_name_only_plan_features(self):
        features = set(install_features.FEATURES)
        self.assertEqual(len(features), len(install_features.FEATURES))
        self.assertLessEqual({key for key, _, _ in install_features.SYSTEM_FEATURES}, features)
        self.assertLessEqual(set(install_features.UNFREE_FEATURES), features)
        # Flathub follows its module default; neither installer sets it.
        self.assertNotIn('flathub', features)


class CatalogueTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory(prefix='cybexos-install-features-')
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)

    def write(self, value):
        (self.root / 'catalogue.json').write_text(value if isinstance(value, str) else json.dumps(value))

    def test_the_release_catalogue_is_well_formed(self):
        catalogue = install_features.software_catalogue(ROOT / 'desktop/software', strict=True)
        raw = json.loads((ROOT / 'desktop/software/catalogue.json').read_text())
        self.assertEqual(catalogue, raw)

    def test_a_missing_or_corrupt_catalogue_is_always_rejected(self):
        for value in (None, '{', '{"apps": [], "apps": []}', [], {'apps': []}, {'profiles': []},
                      {'apps': {}, 'profiles': []}, {'apps': [], 'profiles': None}):
            if value is not None:
                self.write(value)
            for strict in (True, False):
                with self.subTest(value=value, strict=strict), \
                        self.assertRaisesRegex(Failure, 'missing its software catalogue'):
                    install_features.software_catalogue(self.root, strict=strict)

    def test_malformed_entries_are_rejected_when_strict_and_left_out_otherwise(self):
        apps = [{'id': 'Bad Id', 'attribute': 'x'}, {'id': '../escape', 'attribute': 'x'},
                {'id': 'evil', 'attribute': 'pkgs.${x}'}, {'id': 'long', 'attribute': 'a' * 201},
                {'id': 'none', 'attribute': None}, {'attribute': 'x'}, 'app']
        profiles = [{'id': 'Bad Id'}, {'id': 'text', 'apps': 'good'}, {'id': 'nested', 'apps': [['good']]},
                    {'id': 'flags', 'features': ['developer']}, {'apps': ['good']}, 'profile']
        for app in apps:
            self.write({'apps': [GOOD_APP, app], 'profiles': [GOOD_PROFILE]})
            with self.subTest(app=app):
                self.assertEqual(install_features.software_catalogue(self.root, strict=False)['apps'], [GOOD_APP])
                with self.assertRaisesRegex(Failure, 'software catalogue'):
                    install_features.software_catalogue(self.root, strict=True)
        for profile in profiles:
            self.write({'apps': [GOOD_APP], 'profiles': [profile, GOOD_PROFILE]})
            with self.subTest(profile=profile):
                self.assertEqual(install_features.software_catalogue(self.root, strict=False)['profiles'], [GOOD_PROFILE])
                with self.assertRaisesRegex(Failure, 'software catalogue'):
                    install_features.software_catalogue(self.root, strict=True)

    def test_well_formed_entries_keep_their_fields(self):
        app = {**GOOD_APP, 'name': 'Good', 'free': False, 'downloadBytes': 5}
        # Profiles may leave out apps and features; unknown apps are references, not malformed.
        profiles = [{'id': 'empty'}, {**GOOD_PROFILE, 'apps': ['good', 'gone'], 'default': True}]
        self.write({'schema': 1, 'apps': [app], 'profiles': profiles})
        for strict in (True, False):
            self.assertEqual(install_features.software_catalogue(self.root, strict=strict),
                             {'schema': 1, 'apps': [app], 'profiles': profiles})


if __name__ == '__main__':
    unittest.main()
