"""Activation, health checks, recovery, confirmation and rollback for Engine."""
from pathlib import Path
import re
import time

from . import firmware
from .common import CommandFailure, Failure, atomic, link, locked, parse, read
from .config_tree import boot_path, config_digest, configuration_paths, copy_config

BUSY = ('discovering', 'building', 'validating', 'activating', 'recovering', 'firmware')


class ActivationMixin:
    """Supervised activation, health gates, trial-boot confirmation and recovery."""

    def switch(self, system, action):
        try:
            self.run(system + '/bin/switch-to-configuration', action)
        except CommandFailure as error:
            # NixOS reports any failed systemd unit, including pre-existing
            # failures. Its exit 4 can also mask an activation-script exit 2.
            # Never accept that masked error, even when declared health passes.
            if (error.returncode != 4 or 'Failed to run activate script' in error.output
                    or re.search(r"Activation script snippet '[^'\n]+' failed", error.output)):
                raise
            if self.run.log:
                with Path(self.run.log).open('a') as log:
                    log.write('NixOS reported service warnings (exit 4); checking activation diagnostics and system-service health.\n')

    def failed_units(self):
        units = parse(self.run('systemctl', 'list-units', '--state=failed,auto-restart', '--all', '--output=json', '--no-pager'))
        if not isinstance(units, list) or any(not isinstance(unit, dict) or not isinstance(unit.get('unit'), str)
                                               or not isinstance(unit.get('sub'), str) for unit in units):
            raise Failure('Cannot determine failed system services; activation was not accepted.')
        failed = set()
        for unit in units:
            if unit['sub'] == 'auto-restart':
                status = self.run('systemctl', 'show', '--property=ExecMainStatus', '--value', unit['unit']).strip()
                if not re.fullmatch(r'[0-9]+', status):
                    raise Failure('Cannot determine restarting service exit status; activation was not accepted.')
                # Restart=always with a successful exit can be intentional.
                if int(status) == 0:
                    continue
            failed.add(unit['unit'])
        return failed

    def reject_new_failures(self, before, reported=()):
        # Reported units (an optional camera, haptics) are shown, never a reason to roll back.
        newly_failed = self.failed_units() - before - set(reported)
        if newly_failed:
            raise Failure('Activation introduced failed system units: ' + ', '.join(sorted(newly_failed))
                          + '. Inspect their journals and correct the configuration before retrying.')

    def health_baseline(self):
        """Declared health units the running system and its desktop already lack."""
        empty = {'units': [], 'userUnits': []}
        try:
            baseline = parse(self.run('cybexos-health', 'baseline', timeout=120))
        except Failure:
            # No baseline; the declared checks themselves still fail closed.
            return empty
        if not isinstance(baseline, dict) or any(
                not isinstance(baseline.get(key), list) or not all(isinstance(unit, str) for unit in baseline[key])
                for key in empty):
            return empty
        return {key: sorted(baseline[key]) for key in empty}

    def health_report(self, command):
        """Reported (optional) units that are not running; empty when unknown."""
        empty = {'units': [], 'userUnits': []}
        try:
            report = parse(self.run(command, 'report', timeout=120))
        except Failure:
            return empty
        if not isinstance(report, dict) or any(
                not isinstance(report.get(key), list) or not all(isinstance(unit, str) for unit in report[key])
                for key in empty):
            return empty
        return {key: sorted(report[key]) for key in empty}

    def health(self, command, mode, record):
        # Like reject_new_failures, declared health judges what a deployment
        # changed. Units recorded as inactive before it neither block the
        # candidate nor the restoration of the generation that already lacked them.
        preexisting = record.get('preexistingHealth', {}).get('units' if mode == 'system' else 'userUnits', [])
        self.run(command, mode, *('--preexisting=' + unit for unit in preexisting), timeout=120)

    def profile(self, system):
        self.run('nix-env', '--profile', '/nix/var/nix/profiles/system', '--set', system)
        self.switch(system, 'boot')

    def apply(self, identifier, token):
        with locked(self.state / 'operation.lock'):
            tx = self.tx(identifier)
            self.run.log = tx / 'build.log'
            record = read(tx / 'deployment.json')
            if not record or read(self.status_path).get('state') != 'ready' or read(self.status_path).get('transaction') != identifier:
                raise Failure('This deployment is not ready for application')
            if token != record['reviewToken']:
                raise Failure('Staged configuration changed after review; stage and review again')
            if record['scope'] == 'firmware':
                result = firmware.install(self, tx, record['firmware'])
                self.status(state='failed' if result['error'] else 'done', phase='Firmware update finished', error=result['error'])
                self.run.log = None
                if result['error']:
                    raise Failure(result['error'])
                return
            reason = ''
            try:
                unchanged = (config_digest(tx / 'config') == record['configDigest']
                             and config_digest(self.working) == record['baseline']
                             and str(self.current_system.resolve()) == record['previousSystem'])
            except Failure as error:
                reason = str(error) + ' '
                unchanged = False
            except OSError:
                unchanged = False
            if unchanged and self.left_channel(record):
                message = 'The update channel changed to stable after this beta release was prepared. Prepare again.'
                self.status(state='stale', phase=message, error=message, reviewToken=None)
                raise Failure(message)
            if not unchanged:
                message = reason + 'The system or personal configuration changed after preparation. Prepare again to preserve those changes.'
                self.status(state='stale', phase=message, error=message, reviewToken=None)
                raise Failure(message)
            self.git_metadata(self.working)
            # Recorded before anything changes, and kept in every later pending
            # record, so trial boot, confirmation and recovery use the same baseline.
            record = record | {'preexistingHealth': self.health_baseline()}
            atomic(self.pending_path, record | {'phase': 'activation', 'bootId': self.boot_id()})
            self.status(state='activating', phase='Activating under supervision',
                        preexistingHealth=record['preexistingHealth'])
            try:
                # Pin the safe persistent boot default before the boot installer
                # can write a candidate menu. Power loss during profile() must
                # not leave an unvalidated candidate as the default boot.
                self.run('cybexos-boot-trial', '--restore', record['previousSystem'])
                previously_failed = self.failed_units()
                self.switch(record['system'], 'test')
                warnings = self.health_report(record['system'] + '/sw/bin/cybexos-health')
                self.reject_new_failures(previously_failed, warnings['units'])
                self.health(record['system'] + '/sw/bin/cybexos-health', 'system', record)
                self.health(record['system'] + '/sw/bin/cybexos-health', 'desktop', record)
                if config_digest(self.working) != record['baseline']:
                    raise Failure('Personal configuration changed during activation. Working edits retained; stage again.')
                self.select_config(tx / 'config', identifier)
                self.profile(record['system'])
                self.reject_new_failures(previously_failed, warnings['units'])
                self.status(healthWarnings=warnings)
                software = self.packages_only(record, tx)
                if software or self.boot_unchanged(record):
                    # Only Software's packages changed, or an update left the
                    # kernel, early-boot image, boot options, login screen and
                    # session script as they were. Activation and health passed,
                    # so the new generation becomes the default without a trial
                    # boot. The recovery record moves to the boot phase first: a
                    # crash before the commit restores the previous generation.
                    atomic(self.pending_path, record | {'phase': 'boot', 'bootId': self.boot_id()})
                    self.run('cybexos-boot-trial', '--commit', record['system'])
                    atomic(tx / 'good.json', {'at': int(time.time())})
                    self.finish_confirmation(record, 'Installed. System services and the desktop passed health checks.' if software
                                             else 'Installed. Starting the computer and logging in are unchanged, so no restart is needed.')
                    return
                # Keep the previous boot as default and try the candidate once.
                # A failed boot therefore does not strand the next boot on it.
                self.run('cybexos-boot-trial', record['system'], record['previousSystem'])
                atomic(self.pending_path, record | {'phase': 'boot', 'bootId': self.boot_id()})
                self.status(state='awaiting-boot', phase='Activation passed. Reboot when ready, then sign in to confirm health.',
                            recovery='Previous generation remains the default until the trial boot and desktop pass.', restart='Reboot required')
            except BaseException as error:
                # Keep the original failure even if restoration also fails or
                # is interrupted. Command output stays in the private log.
                atomic(tx / 'activation-error.json', {'error': str(error), 'at': int(time.time())})
                selected = self.state / 'working' / identifier
                self.restore(record, 'Activation failed',
                             preserve_working=self.working.resolve() != selected.resolve())
                raise
            # Firmware is outside generation rollback. Flash only after OS
            # activation passed; a device failure must not roll back that OS.
            if (record.get('firmware') or {}).get('devices'):
                result = firmware.install(self, tx, record['firmware'])
                self.status(state='awaiting-boot', phase='Restart when ready to finish updating.',
                            error=result['error'])

    def restore(self, record, reason, preserve_working=False, switch=True):
        tx = self.tx(record['id'])
        self.run.log = tx / 'build.log'
        activation_error = read(tx / 'activation-error.json', {}).get('error', '')
        if 'preexistingHealth' not in record:
            # An explicit rollback has no activation baseline: the running
            # system's state is the one this restoration must not be judged by.
            record = record | {'preexistingHealth': self.health_baseline()}
        # Explicit rollback can start without a pending deployment. Journal it
        # first, and distinguish recovery from a healthy boot trial so a second
        # interruption always resumes restoration, including on the same boot.
        atomic(self.pending_path, record | {'phase': 'recovery', 'preserveWorking': preserve_working})
        self.status(state='recovering', phase='Restoring previous generation: ' + reason, error=activation_error,
                    preexistingHealth=record['preexistingHealth'])
        try:
            # Disarming the one-shot requires no retained boot entry and must
            # precede even personal backup validation. profile() recreates a
            # pruned entry before --restore selects the known-good default.
            self.run('cybexos-boot-trial', '--disarm')
            if not (tx / 'personal-before-rollback').exists():
                copy_config(self.working, tx / 'personal-before-rollback')
            self.profile(record['previousSystem'])
            self.run('cybexos-boot-trial', '--restore', record['previousSystem'])
            if switch:
                self.switch(record['previousSystem'], 'test')
            self.health(record['previousSystem'] + '/sw/bin/cybexos-health', 'system', record)
            if not preserve_working:
                self.select_config(tx / 'previous-config', record['id'] + '-rollback', fresh=True)
            atomic(tx / 'failed.json', {'reason': reason, 'at': int(time.time())})
            link(tx / 'previous-config', self.state / 'deployed')
            self.status(state='rolled-back', phase=reason + '; previous generation restored', error=activation_error,
                        recovery='Configuration and generation restored; persistent application data was not rolled back.')
            self.pending_path.unlink(missing_ok=True)
            self._syncdir(self.state)
        except BaseException as error:
            # The pending record is the resumable recovery boundary. Never
            # report success or an endless running state when a worker exits.
            if self.pending_path.exists():
                atomic(tx / 'recovery-error.json', {'error': str(error), 'at': int(time.time())})
                failures = ([('Activation failed: ' + activation_error)] if activation_error else [])
                failures.append('Restoration failed: ' + str(error))
                self.status(state='recovery-failed', phase='Restoration failed; recovery remains pending',
                            error='\n'.join(failures),
                            recovery='Inspect cybex update log ' + record['id'] + '. Correct the reported failure, then retry cybex update rollback ' + record['id']
                                     + '. A reboot into the retained known-good boot entry also resumes recovery. Personal configuration and state remain retained.',
                            restart='Recovery is incomplete; no reboot is automatic.')
            raise

    def recover(self):
        # Activation may restart a previously failed recovery unit while a
        # supervised worker owns the lock. That worker owns durable recovery.
        with locked(self.state / 'operation.lock', skip_busy=True) as acquired:
            if not acquired:
                return
            if (self.state / 'maintenance-pending.json').exists():
                from .maintenance import Maintenance
                Maintenance(self, worker_unit='cybexos-recover.service').resume()
            pending = read(self.pending_path)
            if not pending:
                status = read(self.status_path, {})
                if status.get('state') in BUSY:
                    if status['state'] == 'firmware':
                        message = 'Firmware installation was interrupted. Check the device before retrying; firmware cannot be rolled back.'
                        self.status(state='interrupted', phase=message,
                                    firmware=(status.get('firmware') or {}) | {'state': 'failed', 'error': message})
                    else:
                        self.conclude(status.get('transaction'), 'interrupted')
                        self.status(state='interrupted', phase='Interrupted before activation; working system retained. Stage again.')
                return
            self.run.log = self.tx(pending['id']) / 'build.log'
            current = str(self.current_system.resolve())
            boot_id = self.boot_id()
            if pending['phase'] != 'boot':
                selected = self.state / 'working' / pending['id']
                preserve = pending.get('preserveWorking', pending['phase'] == 'activation'
                                       and self.working.resolve() != selected.resolve())
                self.restore(pending, 'Interrupted application', preserve_working=preserve)
                return
            if boot_id == pending['bootId']:
                return
            booted = str(self.booted_system.resolve())
            if current != pending['system'] or booted != pending['system']:
                # A new boot that booted and runs the previous generation needs
                # no switch. Switching would only re-execute the system and user
                # service managers just as automatic login starts the desktop,
                # and the session's start-up then fails: no bar, keyring locked.
                self.restore(pending, 'Failed trial boot',
                             switch=not current == booted == pending['previousSystem'])
                return
            if (self.tx(pending['id']) / 'good.json').is_file():
                # Confirmation already passed health, committed the boot default
                # and retained channel replay protection. Complete its durable
                # bookkeeping instead of asking for another trial confirmation.
                self.finish_confirmation(pending)
                return
            try:
                self.health('cybexos-health', 'system', pending)
            except Failure:
                self.restore(pending, 'Trial boot failed system health')
                return
            self.status(state='awaiting-login', phase='Trial boot passed system health. Sign in to validate the desktop.')

    def confirm(self):
        with locked(self.state / 'operation.lock'):
            record = read(self.pending_path)
            if (not record or record.get('phase') != 'boot'
                    or str(self.current_system.resolve()) != record['system']
                    or str(self.booted_system.resolve()) != record['system']):
                raise Failure('No running trial generation to confirm')
            if self.boot_id() == record['bootId']:
                raise Failure('Confirmation requires a fresh boot of the selected generation')
            self.run.log = self.tx(record['id']) / 'build.log'
            self.health('cybexos-health', 'system', record)
            self.health('cybexos-health', 'desktop-required', record)
            self.status(healthWarnings=self.health_report('cybexos-health'))
            self.run('cybexos-boot-trial', '--commit', record['system'])
            tx = self.tx(record['id'])
            atomic(tx / 'good.json', {'at': int(time.time())})
            self.finish_confirmation(record)

    def packages_only(self, record, tx):
        """Does this Software change differ from the deployed system only in packages?"""
        if record.get('changeKind') != 'software':
            return False

        def tree(root):
            root = Path(root).resolve()
            return {str(path.relative_to(root)): (path.read_bytes() if path.is_file() else None)
                    for path in configuration_paths(root)
                    if str(path.relative_to(root)) != 'local/software.json'}

        try:
            return (tree(tx / 'config') == tree(self.state / 'deployed')
                    and boot_path(record['system']) == boot_path(record['previousSystem']))
        except OSError:
            return False

    def boot_unchanged(self, record):
        """Does this update leave starting the computer and logging in as they are?

        Activation and health already exercised everything else in the running
        session. Device firmware still takes its restart.
        """
        if record.get('changeKind') != 'update' or ((record.get('firmware') or {}).get('devices')):
            return False
        try:
            return boot_path(record['system']) == boot_path(record['previousSystem'])
        except OSError:
            return False

    def finish_confirmation(self, record, phase='Boot, login, system services, Hyprland and Quickshell passed health checks.'):
        """Idempotent finalization after the durable successful-health marker."""
        link(self.tx(record['id']) / 'config', self.state / 'deployed')
        # Publish the completed state before removing the recovery record. A
        # crash after unlink must never leave an unconfirmable awaiting-login UI.
        self.status(state='done', phase=phase,
                    recovery='Known-good generation and all input identities retained against garbage collection.', restart='None')
        self.pending_path.unlink(missing_ok=True)
        self._syncdir(self.state)

    def rollback(self, identifier=None):
        with locked(self.state / 'operation.lock'):
            if (self.state / 'maintenance-pending.json').exists():
                raise Failure('Storage cleanup awaits recovery. Complete it before rollback.')
            if identifier and (self.tx(identifier) / 'retired.json').exists():
                raise Failure('This recovery point was retired by reviewed storage cleanup. Choose a retained deployment.')
            record = read(self.pending_path) if identifier is None else read(self.tx(identifier) / 'deployment.json')
            if not record:
                raise Failure('Select a retained deployment from cybex update history')
            if record.get('scope') == 'firmware':
                raise Failure('Device firmware cannot be reverted by a NixOS generation rollback.')
            self.restore(record, 'Explicit rollback requested')

    def discard(self, identifier):
        with locked(self.state / 'operation.lock'):
            status = read(self.status_path, {})
            self.tx(identifier)
            # A finished failure can be dismissed too; its files and logs stay.
            if (self.pending_path.exists() or status.get('transaction') != identifier
                    or status.get('state') not in ('ready', 'stale', 'failed', 'interrupted', 'rolled-back')):
                raise Failure('Only the current unapplied preview or a finished failure can be dismissed. Refresh its status.')
            self.conclude(identifier, 'discarded')
            self.status(transaction=None, state='idle', changeKind=None, scope=None,
                        phase='Preview discarded. No update was applied.' if status['state'] in ('ready', 'stale')
                        else 'Dismissed. The running system was not changed.')
