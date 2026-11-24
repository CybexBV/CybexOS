"""scripts/qualify-upgrade's pure logic and its GitHub API stand-in, without a VM or network."""
import http.client
import importlib.machinery
import importlib.util
import json
from pathlib import Path
import shutil
import socket
import ssl
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'lifecycle'))
from cybexos.trust import discover  # noqa: E402

loader = importlib.machinery.SourceFileLoader('qualify_upgrade', str(ROOT / 'scripts/qualify-upgrade'))
upgrade = importlib.util.module_from_spec(importlib.util.spec_from_loader(loader.name, loader))
loader.exec_module(upgrade)

REVISION = 'c' * 40


def release(tag, prerelease=False, draft=False, body=''):
    return {'tag_name': tag, 'prerelease': prerelease, 'draft': draft, 'body': body or f'# Cybex OS {tag[1:]}\n'}


LISTING = [release('v1.0.32', True), release('v1.0.31', True), release('v1.0.26', True),
           release('v1.0.25'), release('v1.0.40', draft=True), release('nightly'), release('v1.0.24', True)]
TARGET = {'version': '1.0.32', 'revision': REVISION, 'notes': '# Cybex OS 1.0.32\n\nUnder test.\n'}


class FakeFetcher:
    """What the updater's Fetcher reads, answered by the stand-in's routing."""

    def __init__(self, listing, target):
        self.listing, self.target = listing, target

    def page(self, url, limit=0, accept='application/vnd.github+json'):
        """One page of the listing: the stand-in serves it whole, with no next page."""
        return self.get(url, limit, accept), ''

    def get(self, url, limit=0, accept='application/vnd.github+json'):
        path = url.removeprefix('https://api.github.com')
        kind = upgrade.route('GET', path, accept, self.target['version'])
        if kind == 'listing':
            return json.dumps(self.listing).encode()
        if kind == 'revision':
            return self.target['revision'].encode()
        raise AssertionError('passed on to GitHub: ' + path)


class ReleaseChoiceTests(unittest.TestCase):
    def test_previous_release_on_an_ordinary_branch_is_the_one_before_the_newest(self):
        self.assertEqual(upgrade.previous_release(LISTING, '1.0.32')['tag_name'], 'v1.0.31')

    def test_previous_release_on_a_release_branch_is_the_newest(self):
        self.assertEqual(upgrade.previous_release(LISTING, '1.0.33')['tag_name'], 'v1.0.32')

    def test_previous_release_ignores_drafts_and_other_tags(self):
        self.assertEqual(upgrade.previous_release(LISTING, '1.0.50')['tag_name'], 'v1.0.32')
        self.assertEqual(upgrade.previous_release(LISTING, '1.0.25')['tag_name'], 'v1.0.24')

    def test_no_older_release_is_an_error(self):
        with self.assertRaises(ValueError):
            upgrade.previous_release(LISTING, '1.0.24')

    def test_the_served_listing_makes_the_release_under_test_the_newest(self):
        served = upgrade.served_listing(LISTING, TARGET)
        self.assertEqual([item['tag_name'] for item in served], ['v1.0.32', 'v1.0.31', 'v1.0.26', 'v1.0.25', 'v1.0.24'])
        self.assertEqual(served[0], {'tag_name': 'v1.0.32', 'name': 'Cybex OS 1.0.32', 'draft': False,
                                     'prerelease': False, 'body': TARGET['notes'], 'target_commitish': REVISION})
        self.assertTrue(served[1]['prerelease'])
        # For a machine on beta the release under test is a prerelease, as published.
        self.assertTrue(upgrade.served_listing(LISTING, TARGET | {'prerelease': True})[0]['prerelease'])
        # Newer releases than the one under test are left out.
        older = upgrade.served_listing(LISTING, TARGET | {'version': '1.0.30'})
        self.assertEqual([item['tag_name'] for item in older][:2], ['v1.0.30', 'v1.0.26'])

    def test_a_beta_machine_discovers_the_release_under_test_as_a_prerelease(self):
        fetch = FakeFetcher(upgrade.served_listing(LISTING, TARGET | {'prerelease': True}), TARGET)
        found = discover(fetch, 'beta', '1.0.31')
        self.assertEqual((found['version'], found['releases']), ('1.0.32', ['1.0.32']))

    def test_an_installed_updater_discovers_the_release_under_test_on_either_channel(self):
        fetch = FakeFetcher(upgrade.served_listing(LISTING, TARGET), TARGET)
        for channel, installed, included in (('stable', '1.0.25', ['1.0.32']),
                                             ('beta', '1.0.25', ['1.0.32', '1.0.31', '1.0.26']),
                                             ('beta', '1.0.31', ['1.0.32'])):
            with self.subTest(channel=channel, installed=installed):
                found = discover(fetch, channel, installed)
                self.assertEqual((found['version'], found['revision'], found['releases']), ('1.0.32', REVISION, included))
                self.assertIn('Under test.', found['notes'])


class RouteTests(unittest.TestCase):
    def test_the_listing_under_either_repository_name(self):
        for path in ('/repos/CybexBV/CybexOS/releases?per_page=100', '/repos/CybexHQ/CybexOS/releases',
                     '/repos/cybexhq/cybexos/releases?per_page=100'):
            self.assertEqual(upgrade.route('GET', path, 'application/vnd.github+json', '1.0.32'), 'listing', path)

    def test_only_the_tag_under_test_as_a_bare_commit(self):
        sha = 'application/vnd.github.sha'
        self.assertEqual(upgrade.route('GET', '/repos/CybexHQ/CybexOS/commits/v1.0.32', sha, '1.0.32'), 'revision')
        self.assertEqual(upgrade.route('GET', '/repos/CybexBV/CybexOS/commits/v1.0.25', sha, '1.0.32'), 'proxy')
        self.assertEqual(upgrade.route('GET', '/repos/CybexBV/CybexOS/commits/v1.0.32',
                                       'application/vnd.github+json', '1.0.32'), 'proxy')

    def test_everything_else_is_passed_on(self):
        for method, path in (('GET', '/repos/CybexBV/CybexOS/contents/flake.lock?ref=' + REVISION),
                             ('GET', '/repos/NixOS/nixpkgs/tarball/' + REVISION),
                             ('GET', '/repos/NixOS/nixpkgs/releases'),
                             ('GET', '/repos/CybexBV/CybexOS/releases/latest'),
                             ('POST', '/repos/CybexBV/CybexOS/releases'),
                             ('GET', '/repositories/123/releases')):
            self.assertEqual(upgrade.route(method, path, 'application/vnd.github+json', '1.0.32'), 'proxy', path)
        self.assertEqual(upgrade.route('GET', '/cybexos-upgrade-test/nix', '*/*', '1.0.32'), 'probe')


class UpdaterPathTests(unittest.TestCase):
    AVAILABLE = {'upstream': {'state': 'available'}, 'cybexos': {'state': 'available'}}
    CURRENT = {'upstream': {'state': 'current'}, 'cybexos': {'state': 'available'}}

    def test_updaters_without_a_fallback_prepare_the_release_alone(self):
        self.assertEqual(upgrade.stage_scope('1.0.25', self.AVAILABLE), 'cybexos')
        self.assertEqual(upgrade.stage_scope('1.0.26', self.AVAILABLE), 'cybexos')

    def test_later_updaters_prepare_what_software_update_offers(self):
        self.assertEqual(upgrade.stage_scope('1.0.27', self.AVAILABLE), 'both')
        self.assertEqual(upgrade.stage_scope('1.0.32', self.AVAILABLE), 'both')
        self.assertEqual(upgrade.stage_scope('1.0.32', self.CURRENT), 'cybexos')

    def test_only_updaters_before_1_0_32_are_helped_to_the_release_alone(self):
        failed = {'state': 'failed'}
        self.assertEqual(upgrade.fallback_scope('1.0.31', 'both', failed), 'cybexos')
        self.assertIsNone(upgrade.fallback_scope('1.0.31', 'both', {'state': 'ready'}))
        self.assertIsNone(upgrade.fallback_scope('1.0.31', 'cybexos', failed))
        self.assertIsNone(upgrade.fallback_scope('1.0.32', 'both', failed))

    def test_expected_nixpkgs(self):
        before = {'rev': 'b' * 40, 'lastModified': 100}
        staged = {'rev': 'd' * 40, 'lastModified': 300}
        newer, older = {'rev': 'e' * 40, 'lastModified': 200}, {'rev': 'f' * 40, 'lastModified': 50}
        self.assertEqual(upgrade.expected_nixpkgs('1.0.25', 'cybexos', before, before, newer), before['rev'])
        self.assertEqual(upgrade.expected_nixpkgs('1.0.32', 'cybexos', before, before, newer), before['rev'])
        self.assertEqual(upgrade.expected_nixpkgs('1.0.32', 'both', before, newer, newer), newer['rev'])
        # Never backwards, from a machine ahead of the release's pin.
        self.assertEqual(upgrade.expected_nixpkgs('1.0.32', 'both', before, before, older), before['rev'])
        # An updater before 1.0.32 takes the channel head of the day.
        self.assertEqual(upgrade.expected_nixpkgs('1.0.31', 'both', before, staged, newer), staged['rev'])
        # A release on a later branch moves the machine even with an older
        # commit (the move to nixos-26.11); from 1.0.33 never to an earlier one.
        unstable, stable, next_stable = 'nixos-unstable', 'nixos-26.11', 'nixos-27.05'
        for source in ('1.0.32', '1.0.33'):
            self.assertEqual(upgrade.expected_nixpkgs(source, 'both', before, older, older, unstable, stable),
                             older['rev'], source)
        self.assertEqual(upgrade.expected_nixpkgs('1.0.33', 'both', before, before, newer, next_stable, stable),
                         before['rev'])
        self.assertEqual(upgrade.expected_nixpkgs('1.0.33', 'both', before, before, newer, stable, unstable),
                         before['rev'])
        # 1.0.32's updater took any other branch.
        self.assertEqual(upgrade.expected_nixpkgs('1.0.32', 'both', before, newer, newer, stable, unstable),
                         newer['rev'])
        self.assertEqual(upgrade.expected_nixpkgs('1.0.33', 'both', before, newer, newer, unstable, unstable),
                         newer['rev'])


@unittest.skipUnless(shutil.which('openssl'), 'needs openssl')
class StandInTests(unittest.TestCase):
    def test_serves_over_tls_trusted_only_through_its_test_ca(self):
        with tempfile.TemporaryDirectory(prefix='cybexos-standin-') as directory, \
                upgrade.StandIn(Path(directory), LISTING, TARGET) as standin:
            port = standin.server_address[1]
            context = ssl.create_default_context(cafile=str(standin.ca))

            def get(path, accept='application/vnd.github+json'):
                connection = http.client.HTTPSConnection('api.github.com', context=context, timeout=10)
                connection.sock = context.wrap_socket(socket.create_connection(('127.0.0.1', port), 10),
                                                      server_hostname='api.github.com')
                connection.request('GET', path, headers={'Accept': accept})
                response = connection.getresponse()
                body = response.read()
                connection.close()
                return response.status, body

            status, body = get('/repos/CybexHQ/CybexOS/releases?per_page=100')
            self.assertEqual((status, json.loads(body)[0]['tag_name']), (200, 'v1.0.32'))
            self.assertEqual(get('/repos/CybexBV/CybexOS/commits/v1.0.32', 'application/vnd.github.sha'),
                             (200, REVISION.encode()))
            self.assertEqual(get('/cybexos-upgrade-test/python'), (200, f'cybexos-upgrade-test {standin.nonce}\n'.encode()))
            self.assertEqual([(row['route'], row['count'], row['status']) for row in standin.summary()],
                             [('listing', 1, [200]), ('revision', 1, [200]), ('probe', 1, [200])])
            # Without the test CA it is not api.github.com.
            with self.assertRaises(ssl.SSLCertVerificationError):
                ssl.create_default_context().wrap_socket(socket.create_connection(('127.0.0.1', port), 10),
                                                         server_hostname='api.github.com')



class TokenTests(unittest.TestCase):
    def test_the_stand_in_lends_its_token_only_to_reads_of_this_repository(self):
        for method, path in (('GET', '/repos/CybexBV/CybexOS/contents/flake.lock?ref=abc'),
                             ('GET', '/repos/CybexHQ/CybexOS/tarball/abc'),
                             ('HEAD', '/repos/CybexBV/CybexOS'),
                             ('GET', '/repositories/1438845778/releases?per_page=30&page=2')):
            self.assertTrue(upgrade.lends_token(method, path), path)
        for method, path in (('POST', '/repos/CybexBV/CybexOS/issues'),
                             ('GET', '/repos/CybexBV/private-thing/contents/x'),
                             ('GET', '/repos/CybexBV/CybexOS-fork/contents/x'),
                             ('GET', '/repositories/1/contents/secret'),
                             ('GET', '/user'), ('GET', '/user/repos')):
            self.assertFalse(upgrade.lends_token(method, path), path)

if __name__ == '__main__':
    unittest.main()
