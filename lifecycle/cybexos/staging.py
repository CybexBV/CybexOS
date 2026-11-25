"""Staging, prebuilt guards and Nixpkgs compatibility checks for Engine."""
import hashlib
import json
import re
import shutil
import time
import uuid

from . import compatibility, firmware, inputs, prebuilt, review
from .common import CommandFailure, Failure, atomic, locked, parse, read
from .config_tree import config_digest, copy_config
from .trust import FORMER_REPOS, REPO

SCOPES = ('upstream', 'cybexos', 'both', 'local', 'firmware')
# A derivation that failed to build here doesn't build again for this long
# unless Nixpkgs or Cybex OS changes it (a new derivation path): a held
# update is checked again daily without compiling the same failure each time.
FAILED_BUILDS = 7 * 24 * 3600


class NotPrebuilt(Failure):
    """A candidate would compile Nixpkgs packages NixOS has not built yet."""
    def __init__(self, names, *, kernel=False):
        self.names = list(names)
        self.kernel = kernel
        shown = ', '.join(self.names[:5]) + (f' and {len(self.names) - 5} more' if len(self.names) > 5 else '')
        if kernel:
            super().__init__(f'The candidate would compile a Linux kernel ({shown}). '
                             'Cybex OS requires stock prebuilt kernels. No build was started; '
                             'personal declarations and machine locks were kept. '
                             'Use an unmodified cached Nixpkgs kernel before retrying.')
            return
        super().__init__(f"NixOS hasn't finished building {len(self.names)} "
                         f"package{'s' if len(self.names) != 1 else ''} in this change yet ({shown}). "
                         'Nothing was changed. Cybex OS installs prebuilt packages only; '
                         'try again after NixOS has built them.')


class NotBuilt(NotPrebuilt):
    """Packages of a new Nixpkgs that failed to build on this computer.

    The prebuilt check can't foresee every failure: Cybex OS's own packages
    build here and may not build against a new Nixpkgs yet (Voxtype on
    2026-11-10), and configuration builds are never cached. The update waits
    as a prebuilt hold does, and the same derivations don't build again
    (FAILED_BUILDS) until Nixpkgs or Cybex OS changes them.
    """
    def __init__(self, names):
        self.names, self.kernel = list(names), False
        shown = ', '.join(self.names[:5]) + (f' and {len(self.names) - 5} more' if len(self.names) > 5 else '')
        Failure.__init__(self, f"{len(self.names)} package{'s' if len(self.names) != 1 else ''} "
                         f"failed to build with the new NixOS packages ({shown}). Nothing was changed. "
                         'Cybex OS tries again when NixOS or Cybex OS publishes a fix.')


class IncompatibleNixpkgs(Failure):
    """The candidate Nixpkgs no longer evaluates with this configuration.

    Confirmed by evaluating the same candidate with the installed Nixpkgs.
    `details` (origin, file, message) is safe to publish; see compatibility.
    """
    def __init__(self, details, version):
        self.details = details
        super().__init__(compatibility.describe(details, version))

    @property
    def held(self):
        """Waiting for a Cybex OS release, rather than for the person."""
        return self.details['origin'] != 'personal'


class StagingMixin:
    """Staging a candidate deployment, checking prebuilt status and compatibility."""

    def stage(self, scope, region=None, software=None, maintenance=None, request_id=None):
        if scope not in SCOPES:
            raise Failure('Select upstream, cybexos, both, firmware, or local')
        with locked(self.state / 'operation.lock'):
            if (self.state / 'maintenance-pending.json').exists():
                raise Failure('Storage cleanup awaits recovery. Complete it before staging another deployment.')
            if self.pending_path.exists():
                raise Failure('A deployment awaits recovery or boot/login health. Confirm it or roll it back before staging another.')
            identifier = uuid.uuid4().hex
            tx = self.tx(identifier)
            tx.mkdir(mode=0o700)
            kind = ('software' if software is not None else 'maintenance' if maintenance is not None
                    else 'region' if region is not None else 'update' if scope != 'local' else 'configuration')
            # Preparing an update again replaces the prepared one only once
            # the new one is ready; until then that one stays installable.
            previous = read(self.status_path, {})
            replacing = kind == 'update' and scope != 'firmware' and self.replaceable(previous)
            if not replacing:
                # Its preview can no longer be applied: the status names this one.
                self.conclude(previous.get('transaction'), 'superseded')
            candidate = None
            self.status(transaction=identifier, state='discovering', scope=scope, error='', progress=None,
                        phase='Checking selected sources and preparing your configuration',
                        changeKind=kind, requestId=request_id, software=None)
            self.run.log = tx / 'build.log'
            try:
                device_firmware = firmware.discover(self.run) if kind == 'update' else None
                if scope == 'firmware':
                    return self._stage_firmware(identifier, tx, kind, device_firmware)
                # Release selection and compatibility precede lock mutation,
                # evaluation of selected code, and activation.
                candidate = self.channel() if scope in ('cybexos', 'both') else None
                if candidate:
                    # Lock generation evaluates the selected flake to learn its
                    # inputs. Pin its content and check its declarations first.
                    candidate = self.release_source(candidate)
                config, baseline, old, new, selections = self._prepare_staged_config(
                    tx, scope, candidate, region, software, maintenance)
                self._verify_prebuilt(kind, scope, config, tx, old, new, candidate, request_id)
                if region is not None:
                    from .configuration import verify_region
                    verify_region(config, region, self.run)
                system = self._build_candidate_system(kind, scope, config, old, new)
                return self._validate_and_publish_stage(
                    identifier, tx, scope, kind, request_id, baseline, config, new,
                    candidate, selections, device_firmware, system, replacing, previous)
            except IncompatibleNixpkgs as error:
                self.conclude(identifier, 'failed')
                if replacing:
                    self.keep_prepared(previous, scope, request_id, candidate, error,
                                       incompatible=error.details, waiting=error.held)
                    raise
                self.status(state='failed', error=str(error), incompatible=error.details,
                            phase='Waiting for a Cybex OS release that supports the new Nixpkgs' if error.held
                                else 'Staging failed; working system retained',
                            retry='Cybex OS prepares the update again when a newer release or Nixpkgs arrives.'
                                if error.held else 'Update the named file in your configuration, then prepare again.')
                raise
            except NotPrebuilt as error:
                self.conclude(identifier, 'failed')
                if replacing:
                    self.keep_prepared(previous, scope, request_id, candidate, error, error.names)
                    raise
                self.status(state='failed', error=str(error), notPrebuilt=error.names,
                            phase=('Waiting for a fix to the new NixOS packages' if isinstance(error, NotBuilt)
                                   else 'Waiting for NixOS to finish building this change') if kind == 'update'
                                else 'Staging failed; working system retained',
                            retry='Prepare again after NixOS has built these packages.' if kind == 'update'
                                else 'Correct the failure and prepare this change again.')
                raise
            except BaseException as error:
                self.conclude(identifier, 'failed')
                if replacing:
                    self.keep_prepared(previous, scope, request_id, candidate, error)
                    raise
                self.status(state='failed', phase='Staging failed; working system retained', error=str(error),
                            retry='Stage cybexos to install the release on the NixOS packages in use.' if scope == 'both'
                                else 'Correct the failure and stage again.')
                raise
            finally:
                self.run.log = None

    def _stage_firmware(self, identifier, tx, kind, device_firmware):
        if device_firmware['state'] != 'available':
            raise Failure(device_firmware.get('error') or 'No device firmware updates are available. Check again.')
        record = {'id': identifier, 'scope': 'firmware', 'changeKind': kind,
                  'createdAt': int(time.time()), 'firmware': device_firmware,
                  'packageChanges': [], 'highlights': None}
        record['reviewToken'] = hashlib.sha256(review.identity(device_firmware).encode()).hexdigest()
        atomic(tx / 'deployment.json', record)
        self.status(state='ready', phase='Device firmware ready for review', firmware=device_firmware,
                    packageChanges=[], changes='', reviewToken=record['reviewToken'])
        return record

    def _prepare_staged_config(self, tx, scope, candidate, region, software, maintenance):
        config = tx / 'config'
        baseline = config_digest(self.working)
        copy_config(self.working, config)
        if config_digest(config) != baseline or config_digest(self.working) != baseline:
            raise Failure('Personal configuration changed while it was being staged. Stage again.')
        if region is not None:
            if scope != 'local':
                raise Failure('Regional changes require a separate local preview')
            from .configuration import region as prepare_region
            prepare_region(config, region, self.run)
        selections = None
        if software is not None or maintenance is not None:
            if scope != 'local' or (software is not None and maintenance is not None):
                raise Failure('Personal software and maintenance changes require separate local previews.')
            if software is not None:
                from .software import prepare
                selections = prepare(config, software)
            else:
                from .maintenance import prepare
                prepare(config, maintenance)
        old = read(config / 'flake.lock')
        inputs.validate_machine(old)
        if scope in ('upstream', 'both'):
            # Never the channel head: the Nixpkgs revision the release
            # was checked with (the candidate's, else the installed
            # one's), and only forwards. Without a newer one the
            # machine's Nixpkgs stays.
            pinned = candidate['nixpkgs'] if candidate else self.installed_pin()
            if pinned and inputs.newer(pinned, old):
                self.move_nixpkgs(config, old, pinned)
            elif scope == 'upstream' and (bringing := self.release_brings_nixpkgs(old)):
                raise Failure(f'These NixOS packages come with Cybex OS {bringing}. '
                              'Prepare them together with it.')
        if candidate:
            flake = config / 'flake.nix'
            # A machine installed from its medium's bundled source names
            # that content-addressed store path until its first release.
            expression = (r'(cybexos\.url\s*=\s*")(?:github:(?:'
                          + '|'.join(map(re.escape, (REPO, *FORMER_REPOS)))
                          + r')/[^"]+|path:/nix/store/[^"]+)("\s*;)')
            text, count = re.subn(expression, lambda m: m[1] + f'github:{REPO}/' + candidate['revision'] + m[2],
                                  flake.read_text())
            if count != 1:
                raise Failure('Machine flake must declare one literal cybexos.url. Keep personal modules in local/.')
            atomic(flake, text.encode())
            # The Nixpkgs chosen above, which this update must not move.
            intended = inputs.resolved(read(config / 'flake.lock'), 'nixpkgs')
            self.nix('flake', 'update', 'cybexos', '--flake', f'path:{config}', step='inputs')
            final = inputs.resolved(read(config / 'flake.lock'), 'nixpkgs')
            # Nix locks an input again when the flake names it otherwise
            # than the lock (an edited nixpkgs.url): that would be the
            # channel head after all.
            if (final['original'] != intended['original']
                    or {key: final['locked'].get(key) for key in ('rev', 'narHash')}
                    != {key: intended['locked'].get(key) for key in ('rev', 'narHash')}):
                raise Failure('Updating Cybex OS also moved NixOS packages: /etc/nixos/flake.nix names '
                              'another Nixpkgs than its lock. Restore its nixpkgs.url.')
        new = read(config / 'flake.lock')
        inputs.validate_delta(old, new, scope)
        if candidate:
            selected = inputs.identity(new, 'cybexos')
            if selected.get('rev') != candidate['revision'] or selected.get('narHash') != candidate['narHash']:
                raise Failure('Selected source does not match the release revision and its downloaded content')
            atomic(tx / 'release.json', candidate)
        # Retain the attempted identities even when the prebuilt guard
        # holds this candidate, so discovery can recognise it after reboot.
        self.status(inputs={name: inputs.identity(new, name) for name in ('nixpkgs', 'cybexos')},
                    baseline=baseline)
        self.status(state='building', phase='Downloading inputs and building the complete system')
        self.archive(config, tx)
        return config, baseline, old, new, selections

    def _verify_prebuilt(self, kind, scope, config, tx, old, new, candidate, request_id):
        if kind in ('update', 'software'):
            self.status(phase='Checking that every package is prebuilt')
            try:
                # Builds that failed here wait only where they failed:
                # with a Nixpkgs move. The release alone (the fallback)
                # and Software changes build on the Nixpkgs in use.
                # Background preparation skips them; a person who
                # prepares again builds them again (a full disk, say).
                self.require_prebuilt(config, remembered=kind == 'update' and scope in ('upstream', 'both')
                                      and self.background(request_id))
            except CommandFailure as error:
                if kind != 'update' or scope not in ('upstream', 'both'):
                    raise
                self.status(phase='Checking whether the new Nixpkgs is the cause')
                held = self.incompatibility(error, old, new, config, tx,
                                            candidate['version'] if candidate else read(self.release)['version'])
                if held:
                    raise held from error
                raise
            self.status(phase='Downloading inputs and building the complete system')
            return
        self.status(phase='Checking that the Linux kernel is prebuilt')
        self.require_prebuilt(config, kernel_only=True)
        self.status(phase='Downloading inputs and building the complete system')

    def _build_candidate_system(self, kind, scope, config, old, new):
        try:
            out = parse(self.nix('build', '--no-link', '--json', '--no-update-lock-file',
                                 f'path:{config}#nixosConfigurations.cybexos.config.system.build.toplevel'))
        except CommandFailure as error:
            # A new Nixpkgs that doesn't build here waits like one
            # NixOS hasn't built yet; anything else is a failure.
            if (kind == 'update' and scope in ('upstream', 'both')
                    and inputs.identity(old, 'nixpkgs') != inputs.identity(new, 'nixpkgs')):
                failed = self.failed(error)
                if failed:
                    raise failed from error
            raise
        system = out[0]['outputs']['out']
        if not re.fullmatch(r'/nix/store/[a-z0-9]{32}-[^/]+', system):
            raise Failure('Invalid system build output')
        return system

    def _validate_and_publish_stage(self, identifier, tx, scope, kind, request_id, baseline, config, new,
                                    candidate, selections, device_firmware, system, replacing, previous):
        retry_authorizations = []
        for failed in (self.state / 'transactions').glob('*/failed.json'):
            prior = read(failed.parent / 'deployment.json', {})
            if prior.get('system') == system:
                authorization = failed.parent / 'retry-authorized.json'
                if not authorization.exists():
                    raise Failure('This exact system previously failed health checks. Inspect recovery history and explicitly authorize retry with cybex update retry-failed ' + prior['id'])
                retry_authorizations.append(authorization)
        self.root(system, 'system', tx)
        previous_system = str(self.current_system.resolve())
        self.root(previous_system, 'previous-system', tx)
        # Keep a separate immutable copy of the active personal configuration.
        copy_config(self.state / 'deployed', tx / 'previous-config')
        (tx / 'previous-inputs').mkdir()
        self.archive(tx / 'previous-config', tx / 'previous-inputs')
        self.status(state='validating', phase='Checking desktop and plugin compatibility', progress=None)
        self.run(system + '/sw/bin/cybexos-desktop-check', '--system', system, timeout=180)
        changes = self.run('nix', 'store', 'diff-closures', previous_system, system)
        package_changes = review.compare(
            self.run('cat', previous_system + '/etc/cybexos/software.json', sensitive=True),
            self.run('cat', system + '/etc/cybexos/software.json', sensitive=True))
        highlights = review.highlights(package_changes, self.components(previous_system),
                                       self.components(system), changes)
        session = self.session_restarts(previous_system, system)
        atomic(tx / 'changes.txt', changes.encode())
        record = {'id': identifier, 'scope': scope, 'system': system, 'previousSystem': previous_system,
                  'baseline': baseline, 'configDigest': config_digest(config), 'createdAt': int(time.time()),
                  'inputs': {name: inputs.identity(new, name) for name in ('nixpkgs', 'cybexos')},
                  'changeKind': kind, 'requestId': request_id, 'software': selections,
                  'packageChanges': package_changes, 'highlights': highlights,
                  'firmware': device_firmware, 'sessionRestarts': session,
                  'channel': candidate.get('channel') if candidate else None}
        record['reviewToken'] = hashlib.sha256((record['configDigest'] + changes + review.identity(package_changes)
                                                + review.identity(highlights) + review.identity(device_firmware)
                                                + review.identity(session)).encode()).hexdigest()
        atomic(tx / 'deployment.json', record)
        self.status(state='ready', phase='Built and checked; review changes before applying',
                    changes=changes, packageChanges=package_changes, highlights=highlights, firmware=device_firmware,
                    reviewToken=record['reviewToken'], inputs=record['inputs'],
                    installedVersion=read(self.release)['version'],
                    availableVersion=candidate['version'] if candidate else read(self.release)['version'],
                    notes=candidate['notes'] if candidate else '', software=selections,
                    releases=candidate.get('releases', []) if candidate else [],
                    sessionRestarts=session, desktopRestart=review.session_notice(session),
                    restart='Reboot may be required; no reboot is automatic.')
        # A failed preview must not spend explicit retry permission.
        for authorization in retry_authorizations:
            authorization.unlink(missing_ok=True)
        if replacing:
            self.conclude(previous.get('transaction'), 'superseded')
        return record

    def replaceable(self, status):
        """A prepared, unapplied update of Nixpkgs and/or Cybex OS (operation lock held)."""
        transaction = status.get('transaction')
        if (status.get('state') != 'ready' or status.get('changeKind') != 'update'
                or status.get('scope') not in ('upstream', 'cybexos', 'both')
                or not isinstance(transaction, str) or self.pending_path.exists()):
            return False
        try:
            return (read(self.tx(transaction) / 'deployment.json', {}) or {}).get('reviewToken') == status.get('reviewToken')
        except Failure:
            return False

    def keep_prepared(self, previous, scope, request_id, candidate, error, names=None, incompatible=None, waiting=False):
        """Preparing again failed: the update it would have replaced stays ready.

        The attempt is recorded beside it, so the review can say why the newer
        set is not ready yet; the request still fails with its error. The
        attempt's transaction and log stay for inspection.
        """
        now = time.time()
        attempt = {'scope': scope, 'requestId': request_id, 'state': 'waiting' if names or waiting else 'failed',
                   'version': candidate['version'] if candidate else None,
                   'error': str(error) or 'Preparation stopped.', 'notPrebuilt': names,
                   'incompatible': incompatible, 'finishedAt': now}
        atomic(self.status_path, previous | {'replacement': attempt, 'updatedAt': now}, 0o644)

    def incompatibility(self, error, old, new, config, tx, version):
        """An IncompatibleNixpkgs if the new Nixpkgs alone stops evaluation, else None.

        Evaluates the same candidate (configuration and Cybex OS) with the
        installed Nixpkgs. Only when that succeeds is Nixpkgs the cause.
        """
        found = compatibility.evaluation_error(getattr(error, 'output', ''))
        if not found:
            return None
        upstream, installed = inputs.root_inputs(new)['nixpkgs'], inputs.root_inputs(old)['nixpkgs']
        if new['nodes'][upstream] == old['nodes'][installed]:
            return None
        probe = tx / 'nixpkgs-probe'
        copy_config(config, probe)
        lock = parse(json.dumps(new))
        lock['nodes'][upstream] = old['nodes'][installed]
        # A release on another branch also moved the flake's nixpkgs.url;
        # the installed Nixpkgs needs its own back for the lock to match.
        if old['nodes'][installed]['original'].get('ref') != new['nodes'][upstream]['original'].get('ref'):
            self.nixpkgs_branch(probe, old['nodes'][installed]['original']['ref'])
        atomic(probe / 'flake.lock', lock)
        try:
            self.nix('eval', '--raw', '--no-update-lock-file',
                     f'path:{probe}#nixosConfigurations.cybexos.config.system.build.toplevel.drvPath')
        except CommandFailure:
            return None
        finally:
            shutil.rmtree(probe, ignore_errors=True)
        details = compatibility.origin(found[1], read(tx / 'archive.json', {}))
        if details['origin'] == 'cybexos' and found[0]:
            details['message'] = compatibility.public(found[0])
        return IncompatibleNixpkgs(details, version)

    def require_prebuilt(self, config, *, kernel_only=False, remembered=True):
        """Refuse a candidate that would compile Nixpkgs packages here.

        A dry run against this computer's store and configured caches; nothing
        is built. Configuration, fixed-output downloads and the system's
        expected local builds (Cybex OS's own packages, unfree vendor
        downloads, kernel modules, `cybexos.updates.expectedBuilds`) are fine;
        every other package must come prebuilt, including the inputs of those
        expected builds (prebuilt.compiles). A derivation that failed to build
        here before waits too (FAILED_BUILDS). Personal previews allow other package builds,
        but never a kernel build.
        """
        build = f'path:{config}#nixosConfigurations.cybexos.config.system.build'
        root, lists = None, {'expected': [], 'vendor': [], 'declared': []}
        if not kernel_only:
            root = self.nix('eval', '--raw', '--no-update-lock-file', build + '.toplevel.drvPath').strip()
            # Releases before 1.0.32 declare no covering builds: nothing covers.
            lists = parse(self.nix('eval', '--json', '--no-update-lock-file', build, '--apply',
                                   'build: { expected = build.cybexosExpectedBuilds; vendor = build.cybexosVendorBuilds or [ ];'
                                   ' declared = build.cybexosDeclaredBuilds or [ ]; }'))
            if (not re.fullmatch(r'/nix/store/[a-z0-9]{32}-[^/]+\.drv', root) or not isinstance(lists, dict)
                    or any(not isinstance(lists.get(key), list) or any(not isinstance(item, str) for item in lists[key])
                           for key in ('expected', 'vendor', 'declared'))):
                raise Failure('The candidate system has no valid build plan.')
        plan = prebuilt.dry_run(self.run, build + '.toplevel', options=('--no-update-lock-file',))
        if not kernel_only and remembered:
            known = self.failed_before()
            again = sorted(prebuilt.name(path) for path in plan['build'] if path in known)
            if again:
                raise NotBuilt(again)
        found = prebuilt.compiles(self.run, plan['build'], root=root, expected=lists['expected'], vendor=lists['vendor'],
                                  declared=lists['declared'], kernel_only=kernel_only) if plan['build'] else []
        if found:
            raise NotPrebuilt(found, kernel=kernel_only)

    def background(self, request_id):
        """Whether automatic preparation made this request (automatic.submitted)."""
        from . import automatic
        try:
            return request_id in automatic.submitted(read(self.state / automatic.LAST_RUN, {}) or {})
        except Failure:
            return False

    def failed_before(self):
        """Derivations that failed to build here recently (FAILED_BUILDS)."""
        try:
            known = read(self.state / 'failed-builds.json', {}) or {}
        except Failure:
            return {}
        now = time.time()
        return {path: when for path, when in known.items() if isinstance(when, (int, float))
                and now - when < FAILED_BUILDS} if isinstance(known, dict) else {}

    def failed(self, error):
        """A NotBuilt for the builds that failed in `error`, or None.

        Remembers them for a week, for background preparation only (a person
        who prepares again builds them again), except downloads: a
        fixed-output derivation fails when the network does, so a failure of
        downloads alone stays an ordinary failure and is tried again.
        """
        paths = prebuilt.failed_builds(getattr(error, 'output', ''))
        if not paths:
            return None
        try:
            graph = prebuilt.show(self.run, paths)
        except Failure:
            graph = {}
        remembered = [path for path in paths if path in graph and prebuilt.kind(graph[path]) != 'fetch']
        if not remembered:
            return None
        atomic(self.state / 'failed-builds.json', self.failed_before() | {path: time.time() for path in remembered})
        return NotBuilt([prebuilt.name(path) for path in remembered])
