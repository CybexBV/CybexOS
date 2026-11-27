"""Serialized staged NixOS deployments with durable recovery boundaries."""
import hashlib
import os  # noqa: F401 - kept on module for patch targets (os.fstat)
from pathlib import Path
import re
import shutil  # noqa: F401 - kept on module for patch targets (shutil.copyfile)
import time

from . import channel as channels
from . import firmware, inputs, review
from .activation import BUSY, ActivationMixin
from .common import Failure, Runner, atomic, parse, read, syncdir
from .config_tree import (
    LOGIN_SCREEN,
    ConfigTreeMixin,
    boot_path,
    config_digest,
    configuration_paths,
    copy_config,
)
from .progress import NixProgress
from .staging import (
    FAILED_BUILDS,
    SCOPES,
    IncompatibleNixpkgs,
    NotBuilt,
    NotPrebuilt,
    StagingMixin,
)
from .trust import FOREVER, GITHUB_API, REPO, AheadOfChannel, Fetcher, NoPublishedRelease, discover, validate_source, version

__all__ = [
    'BUSY',
    'Engine',
    'FAILED_BUILDS',
    'IncompatibleNixpkgs',
    'LOGIN_SCREEN',
    'NotBuilt',
    'NotPrebuilt',
    'SCOPES',
    'boot_path',
    'config_digest',
    'configuration_paths',
    'copy_config',
]


class Engine(ConfigTreeMixin, StagingMixin, ActivationMixin):
    def __init__(self, state='/var/lib/cybexos', working='/etc/nixos', run=None,
                 release='/etc/cybexos/release.json', policy='/etc/cybexos/update.json',
                 system='/run/current-system', booted='/run/booted-system', channel_state=None):
        self.state, self.working = Path(state), Path(working)
        self.release, self.policy = map(Path, (release, policy))
        # The administrator's channel choice; discovery as the signed-in
        # person uses its own cache directory as state, so it is separate.
        self.channel_state = Path(channel_state or state)
        self.current_system = Path(system)
        self.booted_system = Path(booted)
        self.run = run or Runner()
        self.status_path = self.state / 'status.json'
        self.pending_path = self.state / 'pending.json'
        self.state.mkdir(parents=True, exist_ok=True)
        (self.state / 'transactions').mkdir(exist_ok=True, mode=0o700)

    def _syncdir(self, path):
        syncdir(path)

    def status(self, **values):
        previous = read(self.status_path, {})
        now = time.time()
        if 'transaction' in values and values['transaction'] != previous.get('transaction'):
            previous = {'schema': 1, 'startedAt': now, 'phase': '', 'error': '', 'notes': '', 'releases': [],
                        'replacement': None,
                        'changes': '', 'packageChanges': [], 'highlights': None, 'reviewToken': None, 'inputs': {},
                        'recovery': '', 'retry': '', 'restart': '', 'restartRecommended': None, 'requestId': None,
                        'workerUnit': None, 'software': None, 'firmware': None, 'notPrebuilt': None,
                        'incompatible': None,
                        'sessionRestarts': [], 'desktopRestart': ''}
        if (values.get('state', previous.get('state')) != previous.get('state')
                or values.get('phase', previous.get('phase')) != previous.get('phase')):
            previous['phaseStartedAt'] = now
        state = values.get('state', previous.get('state'))
        if state in BUSY and previous.get('state') not in BUSY:
            previous.update(operationStartedAt=now, finishedAt=None, progress=None)
        elif state not in BUSY:
            if previous.get('state') in BUSY:
                previous['finishedAt'] = now
            values['progress'] = None
        context = getattr(self, 'request_context', {})
        record = previous | values | context | {'updatedAt': now}
        atomic(self.status_path, record, 0o644)
        return record

    def nix(self, *args, step='evaluating', **kwargs):
        monitor = NixProgress(lambda value: self.status(progress=value), step)
        observer = getattr(self.run, 'observer', None)
        self.run.observer = monitor.feed
        try:
            return self.run('nix', *args, '--log-format', 'internal-json', **kwargs)
        finally:
            self.run.observer = observer
            # Observation failures must not replace the command's result/error.
            try:
                monitor.close()
            except Exception:
                pass

    def boot_id(self):
        return Path('/proc/sys/kernel/random/boot_id').read_text().strip()

    def tx(self, identifier):
        if not re.fullmatch('[0-9a-f]{32}', identifier):
            raise Failure('Invalid deployment identifier')
        return self.state / 'transactions' / identifier

    def conclude(self, identifier, outcome):
        """Record how an unconfirmed transaction ended (operation lock held).

        Storage cleanup releases the GC roots of a transaction that ended this
        way once it is a few days old (maintenance.ABANDONED). A confirmed
        one follows recovery-point retention instead; a rolled-back one
        already has failed.json. The first outcome stays.
        """
        if not isinstance(identifier, str) or not re.fullmatch('[0-9a-f]{32}', identifier):
            return
        tx = self.tx(identifier)
        try:
            if not tx.is_dir() or (tx / 'good.json').exists() or (tx / 'outcome.json').exists():
                return
            atomic(tx / 'outcome.json', {'outcome': outcome, 'at': int(time.time())})
        except OSError:
            # Bookkeeping must not replace the error being reported. Without
            # an outcome, cleanup keeps the transaction's roots.
            pass

    def selected_channel(self):
        return channels.selected(self.channel_state, self.policy)['selected']

    def channel(self, max_age=0):
        """The newest release on the selected channel; `max_age` lets a check
        the desktop makes on its own reuse GitHub's recent answers."""
        installed, selected = read(self.release), self.selected_channel()
        candidate = discover(Fetcher(self.state / 'cache', max_age), selected, installed['version'])
        if self.replaced(candidate, installed, candidate['revision'] != installed.get('revision')):
            raise Failure('Published version was replaced with different source content. Update rejected.')
        return candidate | {'channel': selected}

    def left_channel(self, record):
        """A Cybex OS release prepared on beta, after the machine moved to stable.

        Every stable release is also on beta, so moving to beta keeps a preview.
        """
        try:
            return record.get('channel') == 'beta' and self.selected_channel() == 'stable'
        except Failure:
            return True

    def channel_changed(self):
        """Mark a beta preview stale once the machine follows stable (operation lock held)."""
        status = read(self.status_path, {})
        if status.get('state') != 'ready' or not status.get('transaction'):
            return False
        record = read(self.tx(status['transaction']) / 'deployment.json', {}) or {}
        if not self.left_channel(record):
            return False
        message = 'The update channel changed to stable after this beta release was prepared. Prepare again.'
        self.status(state='stale', phase=message, error=message, reviewToken=None)
        return True

    @staticmethod
    def replaced(candidate, installed, differs):
        """The installed version now names other source content."""
        return (candidate['version'] == installed['version'] and differs
                and bool(re.fullmatch('[0-9a-f]{40}', installed.get('revision', ''))))

    def release_source(self, candidate):
        """Download the selected release once, pin its content and read its own declarations."""
        installed = read(self.release)
        fetched = parse(self.nix('flake', 'prefetch', '--json', f'github:{REPO}/' + candidate['revision'], step='inputs'))
        nar_hash, store = fetched.get('hash'), fetched.get('storePath')
        if (not isinstance(nar_hash, str) or not re.fullmatch(r'sha256-[A-Za-z0-9+/]{43}=', nar_hash)
                or not isinstance(store, str) or not re.fullmatch(r'/nix/store/[a-z0-9]{32}-[^/]+', store)):
            raise Failure('Downloaded release source has no valid content identity')
        validate_source(self.run('cat', store + '/VERSION', sensitive=True),
                        parse(self.run('cat', store + '/release/compatibility.json', sensitive=True)),
                        candidate, installed | {'nixos': self.installed_branch()})
        if self.replaced(candidate, installed, nar_hash != installed.get('narHash')):
            raise Failure('Published version was replaced with different source content. Update rejected.')
        # The Nixpkgs revision this release was checked with, from its own
        # content-addressed source: what the machine's Nixpkgs moves to.
        pinned = inputs.pin(parse(self.run('cat', store + '/flake.lock', sensitive=True)))
        return candidate | {'narHash': nar_hash, 'nixpkgs': pinned}

    def installed_branch(self):
        """The NixOS branch this machine's Nixpkgs follows ("unstable", "26.11").

        Its own flake.lock, not its release's: a release prepared alone keeps
        the machine's Nixpkgs, also when the release itself moved to a later
        branch, so only the machine's lock knows the branch it runs.
        """
        try:
            ref = inputs.resolved(read(self.working / 'flake.lock'), 'nixpkgs')['original'].get('ref')
        except (KeyError, TypeError, AttributeError, ValueError, OSError) as error:
            raise Failure('The machine configuration names no NixOS branch. Check /etc/nixos/flake.lock.') from error
        return inputs.release_name(ref)

    def release_pin(self, revision):
        """The Nixpkgs revision a published release was checked with: its
        flake.lock at that commit, read through the trusted GitHub API. A
        commit's file never changes, so it is asked for once."""
        return inputs.pin(parse(Fetcher(self.state / 'cache').get(
            f'{GITHUB_API}/contents/flake.lock?ref={revision}', limit=1024 * 1024,
            accept='application/vnd.github.raw+json', max_age=FOREVER)))

    def release_brings_nixpkgs(self, lock):
        """The newer release whose Nixpkgs revision is newer than the lock's, or None.

        NixOS packages alone move only to the installed release's revision;
        a newer one belongs to the release that was checked with it.
        """
        try:
            candidate = self.channel()
            if version(candidate['version']) <= version(read(self.release)['version']):
                return None
            return candidate['version'] if inputs.newer(self.release_pin(candidate['revision']), lock) else None
        except (Failure, KeyError, TypeError, ValueError):
            return None

    def installed_pin(self):
        """The installed release's Nixpkgs revision, or None for a release without one."""
        value = read(self.release).get('nixpkgs')
        return inputs.pin(value) if value is not None else None

    @staticmethod
    def nixpkgs_branch(config, ref):
        """Name a NixOS branch in the machine flake's literal nixpkgs.url."""
        flake = config / 'flake.nix'
        text, count = re.subn(r'(nixpkgs\.url\s*=\s*")github:NixOS/nixpkgs/[A-Za-z0-9._-]+("\s*;)',
                              lambda m: m[1] + 'github:NixOS/nixpkgs/' + ref + m[2], flake.read_text())
        if count != 1:
            raise Failure('Machine flake must declare one literal nixpkgs.url. Keep personal modules in local/.')
        atomic(flake, text.encode(), flake.stat().st_mode & 0o777)

    @classmethod
    def move_nixpkgs(cls, config, old, pinned):
        """Lock the staged configuration's Nixpkgs to a release's revision.

        When the release follows another NixOS branch (nixos-unstable to
        nixos-26.11), the machine flake's literal nixpkgs.url names it too, so
        the lock stays what the flake declares.
        """
        if pinned['ref'] != inputs.resolved(old, 'nixpkgs')['original']['ref']:
            cls.nixpkgs_branch(config, pinned['ref'])
        atomic(config / 'flake.lock', inputs.take(read(config / 'flake.lock'), pinned))

    def check(self, max_age=0):
        result = {'upstream': {}, 'cybexos': {}, 'firmware': firmware.discover(self.run, refresh=True),
                  'checkedAt': int(time.time())}
        try:
            lock_body = (self.working / 'flake.lock').read_bytes()
            old = parse(lock_body)
            inputs.validate_machine(old)
        except (Failure, KeyError, TypeError, ValueError, OSError):
            message = 'The machine update configuration is invalid or unavailable. Check /etc/nixos/flake.nix and flake.lock; no inputs were changed.'
            return result | {'upstream': {'state': 'unavailable', 'error': message},
                             'cybexos': {'state': 'unavailable'}, 'error': message}
        result['installedIdentity'] = hashlib.sha256(lock_body).hexdigest()
        try:
            selected = self.selected_channel()
        except (Failure, KeyError, TypeError, ValueError):
            selected = ''
        try:
            candidate = self.channel(max_age)
            result['cybexos'] = {'state': 'available' if version(candidate['version']) > version(read(self.release)['version']) else 'current',
                                 'installed': read(self.release)['version'], 'available': candidate['version'],
                                 'revision': candidate['revision'], 'notes': candidate['notes'],
                                 'releases': candidate.get('releases', [])}
        except AheadOfChannel as error:
            # Not an error: the next release on this channel will be offered.
            result['cybexos'] = {'state': 'ahead', 'installed': error.installed, 'available': error.newest}
        except NoPublishedRelease:
            result['cybexos'] = {'state': 'unpublished', 'installed': read(self.release)['version']}
        except (Failure, KeyError, TypeError, ValueError) as error:
            result['cybexos'] = {'state': 'unavailable', 'installed': read(self.release)['version'], 'error': str(error)}
        result['cybexos']['channel'] = selected
        result['upstream'] = self.upstream(old, result['cybexos'])
        return result

    def upstream(self, lock, vendor):
        """The NixOS packages an update would bring.

        Not the channel head: the Nixpkgs revision the release it installs
        was checked with (the available release's, else the installed one's),
        and only when it is newer than the machine's.
        """
        installed = inputs.identity(lock, 'nixpkgs')['rev']
        available = vendor.get('state') == 'available'
        source = vendor.get('available') if available else read(self.release).get('version')
        try:
            if available:
                pinned = self.release_pin(vendor['revision'])
            else:
                pinned = self.installed_pin()
        except (Failure, KeyError, TypeError, ValueError):
            return {'state': 'unreachable', 'installed': installed, 'error':
                    f'NixOS package status is unknown: the Nixpkgs revision of Cybex OS {source} could not be read. '
                    'Retry when connected; no account or token is required.'}
        if pinned is None or not inputs.newer(pinned, lock):
            return {'state': 'current', 'installed': installed, 'available': installed}
        return {'state': 'available', 'installed': installed, 'available': pinned['rev'], 'release': source,
                'detail': f'Cybex OS {source} was checked with these NixOS packages. '
                          'Prepare them to build and review the actual package changes.'}

    def components(self, system):
        # A system built before the manifest existed simply lists no components.
        try:
            return review.components(self.run('cat', system + '/etc/cybexos/components.json', sensitive=True))
        except Failure:
            return {}

    def session_restarts(self, previous, system):
        """The desktop services applying `system` over `previous` restarts (review.session_restarts)."""
        read_file = lambda path: self.run('cat', path, sensitive=True)  # noqa: E731
        units = [unit for _, unit in review.SESSION_UNITS]
        return review.session_restarts({unit: review.session_unit(read_file, previous, unit) for unit in units},
                                       {unit: review.session_unit(read_file, system, unit) for unit in units})

    def root(self, path, name, tx):
        roots = tx / 'roots'
        roots.mkdir(exist_ok=True)
        self.run('nix-store', '--add-root', roots / name, '--indirect', '-r', path)

    def archive(self, config, tx):
        data = parse(self.nix('flake', 'archive', '--json', '--no-update-lock-file', f'path:{config}', step='inputs'))

        def retain(node, name):
            self.root(node['path'], name, tx)
            for i, value in enumerate(node.get('inputs', {}).values()):
                retain(value, f'{name}-{i}')

        retain(data, 'configuration')
        atomic(tx / 'archive.json', data)
