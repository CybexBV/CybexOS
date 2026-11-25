"""The pages people read first must describe the current release model.

They drifted once (council review, 2026-11-24): the README still called
Cybex OS unreleased and taught `stage upstream` as the retry after a failed
combined update, after the release-pinned Nixpkgs and the release-alone
fallback had shipped. Each phrase below is one that was wrong then.
"""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FRONT = ('README.md', 'SECURITY.md', 'CONTRIBUTING.md', 'docs/validation.md',
         'docs/installation.md', 'docs/updates.md', 'docs/releasing.md')
STALE = {
    r'\b(?:is|an \*\*)\s*unreleased\b': 'Cybex OS publishes beta and stable releases',
    r'independently (?:selectable|updatable)': 'a release pins its Nixpkgs; they update together',
    r'retried explicitly with `stage upstream`': 'the fallback is the release alone, `stage cybexos`',
    r'ships to beta with `release/publish`': 'landing on main is not a release',
    r'No workflow gates a release': 'release/publish requires a passing full check',
}


class FrontDocsTest(unittest.TestCase):
    def test_front_pages_carry_no_retired_claims(self):
        for name in FRONT:
            text = (ROOT / name).read_text()
            for pattern, why in STALE.items():
                with self.subTest(page=name, phrase=pattern):
                    match = re.search(pattern, text, re.IGNORECASE)
                    self.assertIsNone(match, f'{name}: "{match and match[0]}" is out of date: {why}')


if __name__ == '__main__':
    unittest.main()
