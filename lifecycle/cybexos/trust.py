"""Release discovery. The GitHub repository is the trust root.

A Cybex OS release is a published GitHub release of REPO with a semantic tag.
There are no publisher signatures: HTTPS to GitHub and the repository's own
access control authenticate a release. Staging pins the tag's exact commit
and the content hash of what it downloads, and a release's own source declares
its version and requirements. No Nix evaluation or privilege escalation here.
"""
import hashlib
import http.client
import math
from pathlib import Path
import re
import time
import urllib.error
import urllib.parse
import urllib.request

from .common import Failure, atomic, parse, read

API = 1
REPO = 'CybexBV/CybexOS'
# Earlier names of REPO. GitHub redirects them, but an installed machine's
# flake names the one it was installed or last updated from: the updater
# accepts it there and writes REPO at its next Cybex OS update.
FORMER_REPOS = ('CybexHQ/CybexOS',)
GITHUB_API = f'https://api.github.com/repos/{REPO}'
HOSTS = {'api.github.com'}
SEMVER = re.compile(r'^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-(beta|rc)\.([1-9][0-9]*))?$')
COMPATIBILITY = {'schema', 'configurationApi', 'pluginApi', 'minUpdater', 'architectures', 'nixos'}


class EndpointNotFound(Failure):
    """An HTTP 404, distinguished from rate limits and network failures."""


class NoPublishedRelease(Failure):
    """No release has been published for this channel yet."""


class AheadOfChannel(Failure):
    """This machine runs a newer version than its channel's newest release.

    It is on a beta release and now follows stable, or its release was
    withdrawn. It is never moved back: Cybex OS updates resume once the
    channel publishes a newer version. Explicit generation rollback is separate.
    """

    def __init__(self, channel, installed, newest):
        super().__init__(f'Cybex OS {installed} is newer than the newest {channel} release ({newest}). '
                         f'Cybex OS updates resume with the next {channel} release after {installed}.')
        self.channel, self.installed, self.newest = channel, installed, newest


def version(value):
    match = SEMVER.fullmatch(value) if isinstance(value, str) else None
    if not match:
        raise Failure('Invalid semantic release version')
    a, b, c, pre, number = match.groups()
    return int(a), int(b), int(c), {'beta': 0, 'rc': 1, None: 2}[pre], int(number or 0)


def https(url, hosts):
    p = urllib.parse.urlsplit(url)
    if p.scheme != 'https' or p.hostname not in hosts or p.username or p.password or p.fragment:
        raise Failure('Release URL is outside the trusted GitHub endpoints')
    return url


# GitHub answers 60 requests an hour from one internet address without an
# account, shared by every computer behind it, and a conditional request
# that comes back 304 still counts unless it is signed in. A check the
# desktop makes on its own therefore reuses GitHub's answers for a while
# (CHECK_MAX_AGE); a check someone asks for, and every update, asks again.
CHECK_MAX_AGE = 3 * 60 * 60
# What a URL naming an exact commit returns never changes.
FOREVER = math.inf


def rate_limited(headers, now):
    """The Failure for GitHub's rate limit, naming when it lifts when GitHub says."""
    until = None
    try:
        if str(headers.get('X-RateLimit-Remaining', '')).strip() == '0':
            until = int(headers.get('X-RateLimit-Reset', ''))
        elif headers.get('Retry-After') is not None:
            until = int(now) + int(headers.get('Retry-After'))
    except (TypeError, ValueError):
        until = None
    shared = ('Every computer on the same internet connection shares GitHub\'s 60 requests an hour; '
              'no account or token is needed.')
    if until is not None and now < until <= now + 2 * 60 * 60:
        return Failure(f'GitHub\'s limit for this internet connection is used up until '
                       f'{time.strftime("%H:%M", time.localtime(until))}. {shared}')
    return Failure(f'GitHub\'s limit for this internet connection is used up. Retry within the hour. {shared}')


class Fetcher:
    def __init__(self, cache, max_age=0):
        self.cache = Path(cache)
        self.cache.mkdir(parents=True, exist_ok=True)
        # Seconds an earlier answer is used again without asking GitHub.
        self.max_age = max_age

    def get(self, url, limit=2 * 1024 * 1024, accept='application/vnd.github+json', max_age=None):
        return self.page(url, limit, accept, max_age)[0]

    def page(self, url, limit=2 * 1024 * 1024, accept='application/vnd.github+json', max_age=None):
        """A response body and its Link header's rel="next" URL ('' on the last page)."""
        https(url, HOSTS)
        name = hashlib.sha256((accept + ' ' + url).encode()).hexdigest()
        body, meta = self.cache / name, self.cache / (name + '.json')
        old = read(meta, {})
        now = time.time()
        fetched = old.get('at')
        if (body.exists() and isinstance(fetched, (int, float)) and not isinstance(fetched, bool)
                and 0 <= now - fetched < (self.max_age if max_age is None else max_age)):
            # The cached page's own Link, checked again as it is used.
            following = old.get('next') if isinstance(old.get('next'), str) else ''
            return body.read_bytes(), following and listing_url(following)
        headers = {'User-Agent': 'CybexOS-updater/1', 'Accept': accept, 'X-GitHub-Api-Version': '2022-11-28'}
        if old.get('etag') and body.exists():
            # A 304 is small and quick, but counts against the anonymous limit.
            headers['If-None-Match'] = old['etag']
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=30) as response:
                https(response.url, HOSTS)
                data = response.read(limit + 1)
                if len(data) > limit:
                    raise Failure('Release response exceeds its size limit')
                following = next_page(response.headers.get('Link', ''))
                atomic(body, data)
                atomic(meta, {'etag': response.headers.get('ETag', ''), 'next': following, 'at': int(now)})
                return data, following
        except urllib.error.HTTPError as error:
            if error.code == 304 and body.exists():
                # The cached page's own Link, checked again as it is used.
                following = old.get('next') if isinstance(old.get('next'), str) else ''
                atomic(meta, old | {'at': int(now)})
                return body.read_bytes(), following and listing_url(following)
            if error.code == 404:
                raise EndpointNotFound('Release endpoint unavailable (HTTP 404); its status is unknown.') from error
            if error.code in (403, 429):
                raise rate_limited(error.headers or {}, now) from error
            raise Failure(f'Release endpoint unavailable (HTTP {error.code}); its status is unknown.') from error
        except (urllib.error.URLError, http.client.HTTPException, TimeoutError, OSError) as error:
            raise Failure('Release endpoint unreachable; its status is unknown. Retry when connected.') from error


# GitHub names a release listing's following pages by repository ID.
LISTING_PATHS = re.compile(r'/(?:repositories/[1-9][0-9]*|repos/(?:%s))/releases' % '|'.join(
    re.escape(name) for name in (REPO, *FORMER_REPOS)))


def listing_url(url):
    """A following page of the release listing on the trusted API, or a Failure."""
    https(url, HOSTS)
    if not LISTING_PATHS.fullmatch(urllib.parse.urlsplit(url).path):
        raise Failure('Release URL is outside the trusted GitHub endpoints')
    return url


def next_page(link):
    """The rel="next" URL of an HTTP Link header, checked; '' when there is none."""
    for part in link.split(','):
        match = re.fullmatch(r'\s*<([^<>]*)>\s*((?:;\s*[^;]*)*)', part)
        if match and re.search(r';\s*rel="?([^";]*\s)?next(\s[^";]*)?"?\s*(;|$)', match[2]):
            return listing_url(match[1])
    return ''


# The release listing comes in pages, newest first. A page of 30 releases
# whose notes reach GitHub's 125,000-character limit stays below PAGE_LIMIT;
# MAX_PAGES bounds the walk for a machine that is very far behind.
PAGE_SIZE = 30
PAGE_LIMIT = 8 * 1024 * 1024
MAX_PAGES = 20


def discover(fetch, channel, installed):
    """The newest published release on a channel: its version, exact commit and notes.

    Stable is the newest release that is neither marked as a prerelease nor
    has a prerelease version; beta is the newest of all published releases.
    Drafts and tags that are not semantic versions are ignored.

    The listing is read page by page, following GitHub's Link header, until
    it holds a release on the channel and reaches the installed version, so
    the notes of every release the update brings come along.
    """
    if channel not in ('stable', 'beta'):
        raise Failure('Unknown release channel')
    current = version(installed)
    url, seen, eligible, reached = f'{GITHUB_API}/releases?per_page={PAGE_SIZE}', set(), [], False
    while url and not (eligible and reached):
        if len(seen) == MAX_PAGES:
            if eligible:
                break
            raise Failure(f'No {channel} release is among the newest {MAX_PAGES * PAGE_SIZE} Cybex OS releases.')
        if url in seen:
            raise Failure('Invalid release listing')
        seen.add(url)
        try:
            data, url = fetch.page(url, limit=PAGE_LIMIT)
        except EndpointNotFound as error:
            raise Failure('The Cybex OS release repository is unavailable (HTTP 404).') from error
        listing = parse(data)
        if not isinstance(listing, list):
            raise Failure('Invalid release listing')
        # GitHub lists releases by creation date, not by version: a release
        # published after a higher version (a draft finished later) can sit
        # on an earlier page. Only a page with releases, none of them newer
        # than the installed version, ends the walk: drafts and other tags
        # say nothing either way.
        reached, versioned = True, False
        for item in listing:
            if not isinstance(item, dict) or item.get('draft') is not False:
                continue
            tag = item.get('tag_name')
            try:
                key = version(tag[1:]) if isinstance(tag, str) and tag.startswith('v') else None
            except Failure:
                key = None
            if key is None:
                continue
            if not isinstance(item.get('prerelease'), bool):
                raise Failure('Invalid release listing')
            reached, versioned = reached and key <= current, True
            if channel == 'stable' and (item['prerelease'] or '-' in tag):
                continue
            notes = item.get('body') if isinstance(item.get('body'), str) else ''
            eligible.append((key, tag, notes[:100000]))
        reached = reached and versioned
    if not eligible:
        raise NoPublishedRelease('No Cybex OS release has been published for this channel yet.')
    key, tag, notes = max(eligible)
    if key < current:
        raise AheadOfChannel(channel, installed, tag[1:])
    revision = fetch.get(f'{GITHUB_API}/commits/{urllib.parse.quote(tag)}', limit=64,
                         accept='application/vnd.github.sha').decode('ascii', 'replace').strip()
    if not re.fullmatch('[0-9a-f]{40}', revision):
        raise Failure('Release tag does not name an exact Git commit')
    # One update installs the newest release; it also brings every release
    # on this channel the machine skipped, so their notes come along.
    included = sorted({item[0]: item for item in eligible if current < item[0] <= key}.values(), reverse=True)
    return {'version': tag[1:], 'revision': revision, 'notes': combined_notes(included) if included else notes,
            'releases': [item[1][1:] for item in included]}


NOTES_LIMIT = 100000


def release_body(release, notes):
    """A release's notes without their own "# Cybex OS VERSION" heading."""
    return re.sub(rf'^#[ \t]+Cybex OS {re.escape(release)}[ \t]*(?:\n+|$)', '', notes.strip()).strip()


def combined_notes(included):
    """Notes for an update that installs the first release and includes the rest.

    The shape release/promote gives stable notes: the newest release's own
    notes, then each skipped release's under its own heading, newest first.
    The oldest sections are left out when the whole would exceed the limit.
    """
    (_, tag, notes), skipped = included[0], included[1:]
    if not skipped:
        return notes
    newest = tag[1:]
    names = [item[1][1:] for item in reversed(skipped)]
    listed = names[0] if len(names) == 1 else ', '.join(names[:-1]) + ' and ' + names[-1]
    parts = [f'# Cybex OS {newest}', f'This update also includes Cybex OS {listed}.', release_body(newest, notes)]
    text = '\n\n'.join(part for part in parts if part)
    for _, older, body in skipped:
        section = '\n\n'.join(part for part in (f'## From Cybex OS {older[1:]}', release_body(older[1:], body)) if part)
        if len(text) + 2 + len(section) > NOTES_LIMIT:
            break
        text += '\n\n' + section
    return text[:NOTES_LIMIT] + '\n'


def validate_source(version_text, compatibility, release, installed):
    """A release's own source declares its version and what it requires."""
    if not isinstance(version_text, str) or version_text.strip() != release['version']:
        raise Failure('Release tag and its VERSION file disagree')
    if not isinstance(compatibility, dict) or set(compatibility) != COMPATIBILITY:
        raise Failure('Unsupported or incomplete release compatibility metadata')
    for name in ('schema', 'configurationApi', 'pluginApi', 'minUpdater'):
        if type(compatibility[name]) is not int or compatibility[name] < 1:
            raise Failure('Invalid release API metadata type')
    for name in ('architectures', 'nixos'):
        if (not isinstance(compatibility[name], list) or not compatibility[name]
                or any(not isinstance(x, str) for x in compatibility[name])):
            raise Failure('Invalid supported platform metadata')
    if (compatibility['schema'] != 1 or compatibility['configurationApi'] != 1 or compatibility['pluginApi'] != 1
            or compatibility['minUpdater'] > API):
        raise Failure('Release requires a newer updater or incompatible configuration/plugin API')
    if installed['architecture'] not in compatibility['architectures'] or installed['nixos'] not in compatibility['nixos']:
        raise Failure('Release does not support this architecture or NixOS branch')
