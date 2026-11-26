import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import uuid

from . import automatic
from . import channel as channels
from . import cli_flows, cli_format
from .common import Failure, atomic, digest, locked, read
from .engine import Engine, config_digest
from .trust import version

LIVE_MARKER = Path('/etc/cybexos/installer')
PKEXEC = '/run/wrappers/bin/pkexec'
REQUEST_BIN = '/run/current-system/sw/bin/cybexos-request'
LIVE_UPDATE_REASON = 'System updates are available after installation. Run cybex install to install Cybex OS.'

_ERROR_FORMAT = 'json'


def require_installed():
    if LIVE_MARKER.exists():
        raise Failure(LIVE_UPDATE_REASON)


def request_status(identifier, state='/var/lib/cybexos'):
    if not re.fullmatch('[a-f0-9]{32}', identifier):
        raise Failure('Invalid request identifier')
    value = read(Path(state) / 'request-status' / (identifier + '.json'))
    if value is None:
        raise Failure('No supervised request found. Refresh and submit again.')
    if value.get('state') in ('queued', 'running') and time.time() - value.get('createdAt', 0) > 10:
        unit = value.get('unit', '')
        if not re.fullmatch(r'cybexos-(?:update|software|maintenance-policy|maintenance)@[a-f0-9]{32}\.service', unit):
            raise Failure('Invalid supervised request record')
        try:
            result = subprocess.run(['systemctl', 'show', unit, '-p', 'ActiveState', '-p', 'Result'],
                                    text=True, capture_output=True, timeout=10)
        except (OSError, subprocess.SubprocessError):
            return value | {'state':'unknown', 'error':'Cannot check the supervised worker. Retry checking its status before submitting another operation.'}
        properties = dict(line.split('=', 1) for line in result.stdout.splitlines() if '=' in line)
        if result.returncode != 0 or 'ActiveState' not in properties:
            return value | {'state':'unknown', 'error':'Cannot check the supervised worker. Retry checking its status before submitting another operation.'}
        if result.returncode == 0 and properties.get('ActiveState') in ('inactive', 'failed'):
            return value | {'state':'failed', 'error':'The supervised request stopped before reporting completion. Review its system service log and retry.'}
    return value


def enqueue(state, action, payload):
    identifier = uuid.uuid4().hex
    atomic(state / 'requests' / (identifier + '.json'), payload)
    worker = action if action in ('software', 'maintenance-policy') else 'maintenance'
    unit = f'cybexos-{worker}@{identifier}.service'
    status = state / 'request-status' / (identifier + '.json')
    atomic(status, {'state':'queued', 'unit':unit, 'createdAt':time.time()}, 0o644)
    try:
        subprocess.run(['systemctl', 'start', '--no-block', unit], check=True)
    except BaseException:
        atomic(status, {'state':'failed', 'error':'The supervised service could not be started.'}, 0o644)
        (state / 'requests' / (identifier + '.json')).unlink(missing_ok=True)
        raise
    return {'accepted':True, 'requestId':identifier, 'unit':unit}


def update_arguments(action, values):
    identifier = lambda value: isinstance(value, str) and re.fullmatch('[0-9a-f]{32}', value)
    valid = ((action == 'stage' and len(values) == 1 and values[0] in ('upstream', 'cybexos', 'both', 'local', 'firmware'))
             or (action == 'apply' and len(values) == 2 and identifier(values[0])
                 and isinstance(values[1], str) and re.fullmatch('[0-9a-f]{64}', values[1]))
             or (action == 'confirm' and not values)
             or (action == 'rollback' and len(values) <= 1 and (not values or identifier(values[0])))
             or (action == 'discard' and len(values) == 1 and identifier(values[0])))
    if not valid:
        raise Failure('Invalid lifecycle request')


def enqueue_update(state, action, values):
    update_arguments(action, values)
    with locked(state / 'update-request.lock'):
        latest = read(state / 'update-request.json', {})
        if latest.get('id'):
            previous = request_status(latest['id'], state)
            if previous.get('state') in ('queued', 'running', 'unknown'):
                raise Failure('An update request is already running. Open Updates to review its progress.')
        identifier = uuid.uuid4().hex
        unit = f'cybexos-update@{identifier}.service'
        payload = state / 'requests' / (identifier + '.json')
        status = state / 'request-status' / (identifier + '.json')
        atomic(payload, {'action': action, 'arguments': values})
        atomic(status, {'id': identifier, 'action': action, 'state': 'queued', 'unit': unit,
                        'createdAt': time.time(), 'error': ''}, 0o644)
        atomic(state / 'update-request.json', {'id': identifier}, 0o644)
        try:
            subprocess.run(['systemctl', 'start', '--no-block', unit], check=True)
        except BaseException as error:
            atomic(status, read(status) | {'state': 'failed', 'finishedAt': time.time(),
                                          'error': 'The supervised update service could not be started. Retry or inspect its system service log.'}, 0o644)
            payload.unlink(missing_ok=True)
            raise Failure('The supervised update service could not be started. No update was applied.') from error
        return {'accepted': True, 'requestId': identifier, 'unit': unit}


def release_channel(state=Path('/var/lib/cybexos'), policy=channels.DECLARED):
    """The channel in effect; empty when the machine declares none (never guessed)."""
    try:
        return channels.selected(state, policy)
    except Failure:
        return {'selected': '', 'declared': '', 'override': False}


def update_status(state=Path('/var/lib/cybexos'), working=Path('/etc/nixos'), policy=channels.DECLARED):
    """Read-only reconciliation; worker failure must survive polls and reloads."""
    state, working = Path(state), Path(working)
    status = read(state / 'status.json', {'state': 'idle'})
    now = time.time()
    status['installedIdentity'] = digest(working / 'flake.lock') if (working / 'flake.lock').is_file() else ''
    identifiers = {read(state / 'update-request.json', {}).get('id'), status.get('requestId')} - {None, ''}
    requests = [request_status(identifier, state) | {'id': identifier} for identifier in identifiers]
    latest = max(requests, key=lambda value: value.get('createdAt', 0)) if requests else {}
    # An older failed update must not obscure a later local configuration change.
    if (latest and latest.get('id') != status.get('requestId')
            and latest.get('createdAt', 0) < status.get('startedAt', 0)):
        latest = {}
    status['request'] = latest
    status['automatic'] = automatic.policy(state)
    status['channel'] = release_channel(state, policy)
    device_firmware = status.get('firmware') or {}
    if device_firmware.get('needsReboot') and device_firmware.get('bootId'):
        boot_id = Path('/proc/sys/kernel/random/boot_id').read_text().strip()
        if device_firmware['bootId'] != boot_id:
            status['firmware'] = device_firmware | {'needsReboot': False}
    if (latest.get('id') == status.get('requestId') and latest.get('state') == 'failed'
            and status.get('state') in ('discovering', 'building', 'validating', 'activating', 'recovering', 'firmware')):
        recovery = status['state'] in ('activating', 'recovering')
        status |= {'state': 'recovery-failed' if recovery else 'interrupted',
                   'phase': 'The update worker stopped. Restore the previous generation before continuing.' if recovery
                            else 'Firmware installation was interrupted. Check the device before retrying; firmware cannot be rolled back.' if status['state'] == 'firmware'
                            else 'Preparation stopped before applying changes. You can prepare again.',
                   'error': latest['error'], 'reviewToken': None, 'progress': None,
                   'finishedAt': latest.get('finishedAt', status.get('updatedAt', now))}
        if device_firmware.get('state') == 'installing':
            message = 'Firmware installation was interrupted. Check the device before retrying; firmware cannot be rolled back.'
            status['firmware'] = device_firmware | {'state': 'failed', 'error': message}
            if read(state / 'pending.json', {}).get('phase') == 'boot':
                # The OS activation already passed before firmware started.
                # Preserve its trial boot instead of offering an impossible
                # discard or preparation over the pending deployment.
                status.update(state='awaiting-boot', phase='Restart when ready to finish the system update.')
    busy = status.get('state') in ('discovering', 'building', 'validating', 'activating', 'recovering', 'firmware')
    end = now if busy else status.get('finishedAt') or status.get('updatedAt', now)
    status['phaseElapsedSeconds'] = max(0, int(end - status.get('phaseStartedAt', end)))
    status['elapsedSeconds'] = max(0, int(end - status.get('operationStartedAt', status.get('startedAt', end))))
    return status


def run_check():
    """Read-only update discovery using the caller's own cache directory."""
    engine = object.__new__(Engine)
    engine.state = Path(os.environ.get('XDG_CACHE_HOME', str(Path.home() / '.cache'))) / 'cybexos'
    engine.state.mkdir(parents=True, exist_ok=True)
    engine.working = Path('/etc/nixos')
    engine.release = Path('/etc/cybexos/release.json')
    engine.policy = channels.DECLARED
    engine.channel_state = Path('/var/lib/cybexos')
    from .common import Runner
    engine.run = Runner()
    return engine.check()


def stage_update(engine, scope, identifier):
    """Stage `scope`; a combined update that fails brings its release alone.

    A published Cybex OS release must never wait for new NixOS packages: not
    for ones NixOS hasn't built, a Nixpkgs that needs a newer Cybex OS, a
    package that fails to build, or a fault in the updater's own checks.
    Whatever stopped the combined update, the release is prepared on the
    packages this computer runs now, so its updater's fixes always arrive;
    the newer packages follow on their own (automatic.prepare).
    """
    try:
        engine.stage(scope, request_id=identifier)
        return
    except Failure:
        if not release_alone(engine, scope):
            raise
    engine.stage('cybexos', request_id=identifier)


def release_alone(engine, scope):
    """Whether a failed combined update leaves a newer release to prepare alone."""
    if scope != 'both':
        return False
    try:
        candidate = engine.channel()
        if version(candidate['version']) <= version(read(engine.release)['version']):
            return False
    except (Failure, KeyError, TypeError):
        return False
    # Preparing again kept the prepared update, which may hold this release.
    current = read(engine.status_path, {}) or {}
    return not (current.get('state') == 'ready' and current.get('scope') in ('cybexos', 'both')
                and current.get('availableVersion') == candidate['version'])


def run_update(engine, identifier):
    if not re.fullmatch('[0-9a-f]{32}', identifier):
        raise Failure('Invalid request identifier')
    payload_path = engine.state / 'requests' / (identifier + '.json')
    status_path = engine.state / 'request-status' / (identifier + '.json')
    status = read(status_path)
    if not status or status.get('state') != 'queued':
        raise Failure('This update request has already run or is unavailable')
    atomic(status_path, status | {'state': 'running', 'updatedAt': time.time()}, 0o644)
    engine.request_context = {'requestId': identifier, 'workerUnit': f'cybexos-update@{identifier}.service'}
    try:
        payload = read(payload_path)
        if not isinstance(payload, dict) or set(payload) != {'action', 'arguments'} or not isinstance(payload['arguments'], list):
            raise Failure('Invalid supervised update payload')
        action, values = payload['action'], payload['arguments']
        update_arguments(action, values)
        if action == 'stage': stage_update(engine, values[0], identifier)
        elif action == 'apply': engine.apply(*values)
        elif action == 'rollback': engine.rollback(values[0] if values else None)
        elif action == 'confirm': engine.confirm()
        elif action == 'discard': engine.discard(values[0])
        atomic(status_path, read(status_path) | {'state': 'done', 'finishedAt': time.time(), 'error': ''}, 0o644)
    except BaseException as error:
        message = str(error) if isinstance(error, Failure) else 'The update request failed. Inspect its private system service log.'
        atomic(status_path, read(status_path) | {'state': 'failed', 'finishedAt': time.time(), 'error': message}, 0o644)
        raise
    finally:
        payload_path.unlink(missing_ok=True)
        engine.request_context = {}


PASSTHROUGH = ('agent', 'assistant', 'backup', 'report', 'doctor', 'plugin', 'shell', 'theme')
PLUMBING = ('software', 'maintenance', 'config')


def _release_version():
    data = read('/etc/cybexos/release.json', {})
    return data.get('version', '') if isinstance(data, dict) else ''


def _build_parser():
    json_parent = argparse.ArgumentParser(add_help=False)
    json_parent.add_argument('--json', action='store_true', default=argparse.SUPPRESS,
                             help='Output machine-readable JSON')

    parser = argparse.ArgumentParser(prog='cybex', add_help=False, parents=[json_parent])
    parser.add_argument('-h', '--help', action='store_true', dest='show_help')
    parser.add_argument('-V', '--version', action='store_true', dest='show_version')
    commands = parser.add_subparsers(dest='command')

    commands.add_parser('help', add_help=False)
    commands.add_parser('status', parents=[json_parent],
                        help='Quick overview of this computer',
                        description='Show a read-only overview of Cybex OS, updates, storage, backup, desktop and region.')
    commands.add_parser('version', parents=[json_parent],
                        help='Print the installed Cybex OS version')
    commands.add_parser('hardware', parents=[json_parent],
                        help='Detected hardware and support status',
                        description='Read-only hardware inventory, support status and qualification checklist.')

    installer = commands.add_parser('install')
    installer.add_argument('--terminal', action='store_true', help='Open the live installer in a terminal')

    # ---- cybex update -------------------------------------------------------
    update = commands.add_parser('update', parents=[json_parent],
                                 help='Check, prepare and apply updates',
                                 description='Check, prepare, review and apply Cybex OS and NixOS updates. '
                                             'Run with no subcommand for a guided update.')
    update.add_argument('--scope', choices=('both', 'cybexos', 'upstream', 'local', 'firmware'),
                        help='Choose which update source to prepare')
    update.add_argument('-y', '--yes', action='store_true', help='Apply after showing changes without asking')
    update.add_argument('--no-apply', action='store_true', help='Prepare and review without applying')
    sub = update.add_subparsers(
        dest='action',
        metavar='{check,status,history,log,stage,apply,rollback,confirm,discard,automatic,channel}',
    )
    sub.add_parser('check', parents=[json_parent], help='Check for available updates')
    sub.add_parser('status', parents=[json_parent], help='Show the current update state and review')
    sub.add_parser('history', parents=[json_parent], help='List retained deployments and recovery points')
    update_request = sub.add_parser('request', parents=[json_parent])
    update_request.add_argument('identifier')
    log = sub.add_parser('log', parents=[json_parent], help='Show the build log for a deployment')
    log.add_argument('transaction', nargs='?', help='Deployment ID (or prefix); defaults to the current one')
    stage = sub.add_parser('stage', parents=[json_parent], help='Prepare an update without applying')
    stage.add_argument('scope', choices=('upstream', 'cybexos', 'both', 'local', 'firmware'))
    stage.add_argument('--no-wait', action='store_true', help='Start staging in the background and exit')
    apply = sub.add_parser('apply', parents=[json_parent], help='Apply a prepared update')
    apply.add_argument('transaction', nargs='?')
    apply.add_argument('review_token', nargs='?')
    apply.add_argument('-y', '--yes', action='store_true', help='Apply without asking')
    rollback = sub.add_parser('rollback', parents=[json_parent], help='Restore a previous deployment')
    rollback.add_argument('transaction', nargs='?')
    sub.add_parser('confirm', parents=[json_parent], help='Confirm a trial boot and keep the update')
    retry = sub.add_parser('retry-failed', parents=[json_parent])
    retry.add_argument('transaction')
    discard = sub.add_parser('discard', parents=[json_parent], help='Discard a prepared update or dismiss a failure')
    discard.add_argument('transaction', nargs='?')
    choice = sub.add_parser('automatic', parents=[json_parent],
                            help='Show or configure automatic preparation and restart confirmation')
    choice.add_argument('name', nargs='?', choices=('prepare', 'confirm'))
    choice.add_argument('enabled', nargs='?', choices=('on', 'off'))
    release_choice = sub.add_parser('channel', parents=[json_parent],
                                    help='Show or choose the release channel (stable or beta)')
    release_choice.add_argument('name', nargs='?', choices=channels.CHANNELS)

    # ---- cybex apps ---------------------------------------------------------
    apps = commands.add_parser('apps', parents=[json_parent],
                               help='Search, install and remove apps',
                               description='Search, install, update and remove NixOS and Flathub apps.')
    apps_sub = apps.add_subparsers(dest='apps_action', required=True)
    apps_list = apps_sub.add_parser('list', parents=[json_parent], help='List installed apps')
    apps_list.add_argument('--all', action='store_true', help='Include built-in Cybex OS and personal packages')
    apps_list.add_argument('--source', choices=('all', 'nix', 'flathub'), default='all')
    apps_search = apps_sub.add_parser('search', parents=[json_parent], help='Search NixOS and Flathub apps')
    apps_search.add_argument('query', nargs='*', default=[])
    apps_search.add_argument('--source', choices=('all', 'nix', 'flathub'), default='all')
    apps_info = apps_sub.add_parser('info', parents=[json_parent], help='Show details about an app')
    apps_info.add_argument('name')
    apps_info.add_argument('--source', choices=('auto', 'nix', 'flathub'), default='auto')
    apps_install = apps_sub.add_parser('install', parents=[json_parent], help='Install one or more apps')
    apps_install.add_argument('names', nargs='+', metavar='APP')
    apps_install.add_argument('--source', choices=('auto', 'nix', 'flathub'), default='auto')
    apps_install.add_argument('-y', '--yes', action='store_true', help='Install without asking')
    apps_remove = apps_sub.add_parser('remove', parents=[json_parent], help='Remove installed apps')
    apps_remove.add_argument('names', nargs='+', metavar='APP')
    apps_remove.add_argument('--source', choices=('auto', 'nix', 'flathub'), default='auto')
    apps_remove.add_argument('-y', '--yes', action='store_true', help='Remove without asking')
    apps_sub.add_parser('updates', parents=[json_parent], help='Check for Flathub app updates')
    apps_update = apps_sub.add_parser('update', parents=[json_parent], help='Update installed Flathub apps')
    apps_update.add_argument('ids', nargs='*', metavar='APP_ID')

    # ---- cybex cleanup ------------------------------------------------------
    cleanup = commands.add_parser('cleanup', parents=[json_parent],
                                  help='Free space from old generations',
                                  description='Preview and free disk space from old system generations. '
                                              'Run with no subcommand for a guided cleanup.')
    cleanup.add_argument('-y', '--yes', action='store_true', help='Clean up after preview without asking')
    cleanup_sub = cleanup.add_subparsers(dest='cleanup_action')
    cleanup_sub.add_parser('status', parents=[json_parent], help='Show disk space and cleanup policy')
    cleanup_sub.add_parser('preview', parents=[json_parent], help='Check how much space can be freed')
    cleanup_run = cleanup_sub.add_parser('run', parents=[json_parent], help='Preview and clean old generations')
    cleanup_run.add_argument('-y', '--yes', action='store_true', help='Clean up without asking')
    cleanup_pin = cleanup_sub.add_parser('pin', parents=[json_parent], help='Pin or unpin a recovery deployment')
    cleanup_pin.add_argument('deployment')
    cleanup_pin.add_argument('state', nargs='?', default='on', choices=('on', 'off', 'true', 'false'))
    cleanup_policy = cleanup_sub.add_parser('policy', parents=[json_parent], help='Show or change retention policy')
    cleanup_policy.add_argument('--automatic', choices=('on', 'off'))
    cleanup_policy.add_argument('--keep-confirmed', type=int)
    cleanup_policy.add_argument('--keep-days', type=int)
    cleanup_policy.add_argument('-y', '--yes', action='store_true', help='Apply without asking')
    cleanup_sub.add_parser('resume', parents=[json_parent], help='Resume an interrupted cleanup')

    # ---- cybex region -------------------------------------------------------
    region = commands.add_parser('region', parents=[json_parent],
                                 help='Timezone and language settings',
                                 description='View or change the system timezone and locale.')
    region_sub = region.add_subparsers(dest='region_action')
    region_sub.add_parser('status', parents=[json_parent], help='Show current timezone and locale')
    region_set = region_sub.add_parser('set', parents=[json_parent], help='Change timezone and/or locale')
    region_set.add_argument('--timezone', '--tz', dest='timezone', help='IANA timezone (e.g. Europe/Amsterdam)')
    region_set.add_argument('--locale', help='System locale (e.g. en_US.UTF-8)')
    region_set.add_argument('-y', '--yes', action='store_true', help='Apply without asking')
    region_tz = region_sub.add_parser('timezones', parents=[json_parent], help='List available timezones')
    region_tz.add_argument('filter', nargs='?')
    region_loc = region_sub.add_parser('locales', parents=[json_parent], help='List installed locales')
    region_loc.add_argument('filter', nargs='?')

    # ---- cybex ask ----------------------------------------------------------
    ask = commands.add_parser('ask', help='Ask Wiz from the terminal',
                              description='Send a question to Wiz, the Cybex OS Assistant.')
    ask.add_argument('--agent', choices=('auto', 'claude', 'codex'), default='auto',
                     help='Choose which coding agent answers')
    ask.add_argument('text', nargs='+', help='Your question for Wiz')

    # ---- Hidden UI/backend plumbing (kept for Quickshell, Wiz & tests) ------
    software = commands.add_parser('software', parents=[json_parent])
    software_sub = software.add_subparsers(dest='software_action', required=True)
    software_sub.add_parser('list', parents=[json_parent])
    software_sub.add_parser('catalogue', parents=[json_parent])
    search = software_sub.add_parser('search', parents=[json_parent]); search.add_argument('query', nargs='?', default='')
    software_check = software_sub.add_parser('check', parents=[json_parent])
    software_check.add_argument('attributes', nargs='+', metavar='ATTRIBUTE')
    software_request = software_sub.add_parser('request', parents=[json_parent]); software_request.add_argument('identifier')
    software_stage = software_sub.add_parser('stage', parents=[json_parent]); software_stage.add_argument('request')
    flathub = software_sub.add_parser('flathub', parents=[json_parent])
    flathub_sub = flathub.add_subparsers(dest='flathub_action', required=True)
    flathub_sub.add_parser('status', parents=[json_parent])
    flathub_search = flathub_sub.add_parser('search', parents=[json_parent]); flathub_search.add_argument('query', nargs='?', default='')
    flathub_app = flathub_sub.add_parser('app', parents=[json_parent]); flathub_app.add_argument('id')
    flathub_sub.add_parser('updates', parents=[json_parent])
    for name in ('install', 'remove', 'update'):
        change = flathub_sub.add_parser(name, parents=[json_parent])
        change.add_argument('ids', nargs='*' if name == 'update' else '+', metavar='APP_ID')
        change.add_argument('--names', default='{}', help=argparse.SUPPRESS)
    flathub_run = flathub_sub.add_parser('run', parents=[json_parent]); flathub_run.add_argument('task')

    maintenance = commands.add_parser('maintenance', parents=[json_parent])
    maintenance_sub = maintenance.add_subparsers(dest='maintenance_action', required=True)
    for name in ('status', 'preview', 'resume'):
        maintenance_sub.add_parser(name, parents=[json_parent])
    clean = maintenance_sub.add_parser('clean', parents=[json_parent]); clean.add_argument('review'); clean.add_argument('token')
    pin = maintenance_sub.add_parser('pin', parents=[json_parent]); pin.add_argument('deployment'); pin.add_argument('enabled', choices=('true', 'false'))
    maintenance_request = maintenance_sub.add_parser('request', parents=[json_parent]); maintenance_request.add_argument('identifier')
    maintenance_policy = maintenance_sub.add_parser('policy', parents=[json_parent]); maintenance_policy.add_argument('request')

    config = commands.add_parser('config', parents=[json_parent])
    config.add_argument('domain', choices=('region',))
    config.add_argument('changes', nargs='+', metavar='FIELD VALUE PREVIOUS')

    # Helpers own their options (--json, --help); REMAINDER alone cannot start
    # with an option, so those arrive as parse_known_args extras.
    for name in PASSTHROUGH:
        command = commands.add_parser(name, add_help=False)
        command.add_argument('arguments', nargs=argparse.REMAINDER)

    return parser


def _handle_shell(passthrough_args, *, json_mode):
    args = list(passthrough_args)
    if '--json' in args:
        json_mode = True
        args = [arg for arg in args if arg != '--json']
    if not args or args[0] in ('-h', '--help', 'help'):
        print('\n'.join([
            'usage: cybex shell {status,safe,recover} [--json]',
            '',
            'Desktop shell health and crash-loop safe mode.',
            '',
            'commands:',
            '  status    Show whether the desktop shell is normal or in safe mode',
            '  safe      Restart the desktop shell in safe mode (pauses widgets)',
            '  recover   Leave safe mode and restart the full desktop shell',
        ]))
        return
    if args == ['status'] and not json_mode:
        res = subprocess.run(['cybexos-runtime', 'shell', 'status'], text=True, capture_output=True)
        if res.returncode != 0:
            raise Failure((res.stderr or res.stdout).strip() or 'Could not read desktop shell status.')
        try:
            data = json.loads(res.stdout)
        except ValueError:
            sys.stdout.write(res.stdout)
            return
        print(cli_format.format_shell_status(data))
        return
    os.execvp('cybexos-runtime', ['cybexos-runtime', 'shell', *args])


def _handle_plugin(passthrough_args, *, json_mode):
    args = list(passthrough_args)
    if '--json' in args:
        json_mode = True
    env = dict(os.environ)
    env['CYBEX_CLI_PROG'] = 'cybex plugin'
    if not json_mode:
        env['CYBEX_CLI_HUMAN'] = '1'
    else:
        env.pop('CYBEX_CLI_HUMAN', None)
    if not args:
        args = ['--help']
    os.execvpe('cybexos-runtime', ['cybexos-runtime', 'plugin', *args], env)


def _handle_assistant(passthrough_args, *, json_mode):
    args = list(passthrough_args)
    if '--json' in args:
        json_mode = True
        args = [arg for arg in args if arg != '--json']
    env = dict(os.environ)
    env['CYBEX_CLI_PROG'] = 'cybex assistant'
    if args[:1] == ['status'] and not json_mode and '-h' not in args and '--help' not in args:
        res = subprocess.run(['cybexos-assistant', *args], text=True, capture_output=True, env=env)
        if res.returncode != 0:
            raise Failure((res.stderr or res.stdout).strip() or 'The assistant service is not running.')
        try:
            data = json.loads(res.stdout)
        except ValueError:
            sys.stdout.write(res.stdout)
            return
        print(cli_format.format_assistant_status(data))
        return
    if not args:
        args = ['--help']
    os.execvpe('cybexos-assistant', ['cybexos-assistant', *args], env)


def _handle_update(args, *, json_mode):
    global _ERROR_FORMAT
    action = args.action
    if action in ('request', 'retry-failed'):
        _ERROR_FORMAT = 'json'

    if LIVE_MARKER.exists():
        if action == 'check':
            payload = {'available': False, 'reason': LIVE_UPDATE_REASON,
                       'upstream': {'state': 'unavailable'}, 'cybexos': {'state': 'unavailable'}}
            print(json.dumps(payload) if json_mode else cli_format.format_update_check(payload))
            return
        if action == 'status':
            payload = {'available': False, 'state': 'unavailable', 'phase': LIVE_UPDATE_REASON}
            print(json.dumps(payload) if json_mode else cli_format.format_update_status(payload))
            return
        raise Failure(LIVE_UPDATE_REASON)

    if action is None:
        if json_mode:
            print(json.dumps(update_status()))
            return
        cli_flows.interactive_update(scope=args.scope, assume_yes=args.yes, stage_only=args.no_apply)
        return

    if action == 'status':
        data = update_status()
        print(json.dumps(data) if json_mode else cli_format.format_update_status(data))
        return
    if action == 'channel' and not args.name:
        data = release_channel()
        print(json.dumps(data) if json_mode else cli_format.format_channel(data))
        return
    if action == 'automatic' and not args.name:
        data = automatic.policy(Path('/var/lib/cybexos'))
        print(json.dumps(data) if json_mode else cli_format.format_automatic(data))
        return
    if action == 'automatic' and (not args.name or not args.enabled):
        raise Failure('Specify both prepare|confirm and on|off (for example: cybex update automatic prepare on).')
    if action == 'request':
        print(json.dumps(request_status(args.identifier)))
        return
    if action == 'check':
        data = run_check()
        print(json.dumps(data) if json_mode else cli_format.format_update_check(data))
        return
    if action == 'history':
        if json_mode:
            os.execv(PKEXEC, [PKEXEC, REQUEST_BIN, 'history'])
        records = cli_flows.run_privileged('history')
        print(cli_format.format_update_history(records if isinstance(records, list) else []))
        return
    if action == 'log':
        tx = cli_flows.resolve_transaction(args.transaction)
        os.execv(PKEXEC, [PKEXEC, REQUEST_BIN, 'log', tx])

    # JSON / machine-caller async boundary (Updates.qml, tests, scripts)
    if json_mode or action == 'retry-failed':
        if action == 'apply' and (not args.transaction or not args.review_token):
            raise Failure('Applying with --json requires TRANSACTION and REVIEW_TOKEN.')
        if action == 'discard' and not args.transaction:
            raise Failure('Discarding with --json requires TRANSACTION.')
        extra = ([args.scope] if action == 'stage' else
                 [args.name, args.enabled] if action == 'automatic' else
                 [args.name] if action == 'channel' else
                 [args.transaction, args.review_token] if action == 'apply' else
                 [args.transaction] if action in ('rollback', 'retry-failed', 'discard') and args.transaction else [])
        os.execv(PKEXEC, [PKEXEC, REQUEST_BIN, action, *extra])

    # Human-friendly privileged actions
    style = cli_format.Style()
    if action == 'channel':
        data = cli_flows.run_privileged('channel', args.name)
        print(cli_format.format_channel(data.get('channel') or data, style=style))
        return
    if action == 'automatic':
        data = cli_flows.run_privileged('automatic', args.name, args.enabled)
        print(cli_format.format_automatic(data.get('automatic') or data, style=style))
        return
    if action == 'stage':
        if args.no_wait:
            cli_flows.run_privileged('stage', args.scope)
            print(style.ok('✓ Update preparation started.') + " Check progress with 'cybex update status'.")
            return
        cli_flows.interactive_update(scope=args.scope, stage_only=True, style=style)
        return
    if action == 'apply':
        if not args.transaction and not args.review_token:
            current = update_status()
            if current.get('state') != 'ready':
                raise Failure('No prepared update is ready to apply. Run "cybex update" first.')
            cli_flows._apply_ready_status(current, assume_yes=args.yes, prompt_text='Apply this update now?', style=style)
            return
        if not args.transaction or not args.review_token:
            raise Failure('Pass both TRANSACTION and REVIEW_TOKEN, or omit both to apply the current prepared update.')
        accepted = cli_flows.run_privileged('apply', args.transaction, args.review_token)
        result = cli_flows.wait_for_update(accepted.get('requestId'),
                                           target_states=('awaiting-boot', 'awaiting-login', 'done', 'failed', 'rolled-back', 'recovery-failed'))
        if result.get('state') in ('failed', 'rolled-back', 'recovery-failed'):
            raise Failure(result.get('error') or result.get('phase') or 'Applying the update failed.')
        print(style.ok('✓ Update applied.') + (' Restart when convenient to finish.' if result.get('state') == 'awaiting-boot' else ''))
        return
    if action == 'discard':
        tx = cli_flows.resolve_transaction(args.transaction)
        accepted = cli_flows.run_privileged('discard', tx)
        cli_flows.wait_for_update(accepted.get('requestId'), target_states=('idle', 'failed'))
        print(style.ok('✓ Prepared update discarded.'))
        return
    if action == 'confirm':
        accepted = cli_flows.run_privileged('confirm')
        result = cli_flows.wait_for_update(accepted.get('requestId'), target_states=('done', 'failed', 'rolled-back'))
        if result.get('state') != 'done':
            raise Failure(result.get('error') or result.get('phase') or 'Could not confirm this boot.')
        print(style.ok('✓ Deployment confirmed and kept.'))
        return
    if action == 'rollback':
        tx = cli_flows.resolve_transaction(args.transaction) if args.transaction else None
        accepted = cli_flows.run_privileged('rollback', *([tx] if tx else []))
        result = cli_flows.wait_for_update(accepted.get('requestId'), target_states=('rolled-back', 'done', 'failed', 'recovery-failed'))
        if result.get('state') in ('failed', 'recovery-failed'):
            raise Failure(result.get('error') or result.get('phase') or 'Rollback failed.')
        print(style.ok('✓ Restored previous deployment.') + ' Restart if the previous kernel or boot changed.')


def main():
    global _ERROR_FORMAT
    parser = _build_parser()
    args, extra = parser.parse_known_args()
    json_mode = bool(getattr(args, 'json', False))
    _ERROR_FORMAT = 'json' if (json_mode or args.command in PLUMBING) else 'human'

    if args.show_version:
        ver = _release_version() or 'unknown'
        print(json.dumps({'version': ver}) if json_mode else f'Cybex OS {ver}')
        return
    if args.show_help or args.command in (None, 'help'):
        if extra:
            parser.error('unrecognized arguments: ' + ' '.join(extra))
        print(cli_format.format_help(installed=not LIVE_MARKER.exists(), release_version=_release_version()))
        return
    if extra and args.command not in PASSTHROUGH:
        parser.error('unrecognized arguments: ' + ' '.join(extra))

    if args.command == 'version':
        ver = read('/etc/cybexos/release.json')['version']
        print(json.dumps({'version': ver}) if json_mode else ver)
        return
    if args.command == 'status':
        data = cli_flows.collect_status()
        print(json.dumps(data, indent=2) if json_mode else cli_format.format_status_overview(data))
        return
    if args.command == 'hardware':
        from .hardware import report
        data = report()
        print(json.dumps(data, indent=2) if json_mode else cli_format.format_hardware(data))
        return
    if args.command == 'apps':
        cli_flows.handle_apps(args, json_mode=json_mode)
        return
    if args.command == 'cleanup':
        cli_flows.handle_cleanup(args, json_mode=json_mode)
        return
    if args.command == 'region':
        cli_flows.handle_region(args, json_mode=json_mode)
        return
    if args.command == 'ask':
        os.execvp('cybexos-assistant', ['cybexos-assistant', 'ask', '--agent', args.agent, *args.text])
    if args.command == 'install':
        os.execvp('cybexos-install', ['cybexos-install', *(['--terminal'] if args.terminal else [])])

    if args.command == 'shell':
        _handle_shell([*extra, *args.arguments], json_mode=json_mode)
        return
    if args.command == 'plugin':
        _handle_plugin([*extra, *args.arguments], json_mode=json_mode)
        return
    if args.command == 'assistant':
        _handle_assistant([*extra, *args.arguments], json_mode=json_mode)
        return
    if args.command == 'theme':
        forward = [*extra, *args.arguments]
        if json_mode and '--json' not in forward:
            forward.append('--json')
        os.execvp('cybexos-theme', ['cybexos-theme', *forward])
    if args.command in ('agent', 'backup', 'report', 'doctor'):
        forward = [*extra, *args.arguments]
        if json_mode and '--json' not in forward:
            forward.append('--json')
        os.execvp('cybexos-' + args.command, ['cybexos-' + args.command, *forward])

    # ---- Hidden plumbing endpoints (preserve exact JSON contract) -----------
    if args.command == 'software':
        require_installed()
        from . import software as native
        if args.software_action == 'list':
            print(json.dumps(native.inventory())); return
        if args.software_action == 'catalogue':
            print(json.dumps(native.catalogue())); return
        if args.software_action == 'search':
            print(json.dumps(native.search(args.query))); return
        if args.software_action == 'check':
            print(json.dumps(native.check(args.attributes))); return
        if args.software_action == 'request':
            print(json.dumps(request_status(args.identifier))); return
        if args.software_action == 'flathub':
            from . import flathub
            action = args.flathub_action
            if action == 'status':
                print(json.dumps(flathub.status())); return
            if action == 'search':
                print(json.dumps(flathub.search(args.query))); return
            if action == 'app':
                print(json.dumps(flathub.details(args.id))); return
            if action == 'updates':
                print(json.dumps(flathub.updates())); return
            if action == 'run':
                print(json.dumps(flathub.work(args.task))); return
            try:
                names = json.loads(args.names)
            except ValueError:
                raise Failure('Invalid app names') from None
            print(json.dumps(flathub.start(action, args.ids, names=names))); return
        os.execv(PKEXEC, [PKEXEC, REQUEST_BIN, 'software', args.request])

    if args.command == 'maintenance':
        require_installed()
        if args.maintenance_action == 'request':
            print(json.dumps(request_status(args.identifier))); return
        if args.maintenance_action == 'status':
            from .maintenance import public_status
            print(json.dumps(public_status())); return
        extra_args = ([args.review, args.token] if args.maintenance_action == 'clean' else
                      [args.deployment, args.enabled] if args.maintenance_action == 'pin' else
                      [args.request] if args.maintenance_action == 'policy' else [])
        action = 'maintenance-policy' if args.maintenance_action == 'policy' else 'maintenance-' + args.maintenance_action
        os.execv(PKEXEC, [PKEXEC, REQUEST_BIN, action, *extra_args])

    if args.command == 'config':
        from .common import parse
        if len(args.changes) not in (3, 6):
            parser.error('config region takes one or two FIELD VALUE PREVIOUS triples')
        triples = [args.changes[index:index + 3] for index in range(0, len(args.changes), 3)]
        payload = {'changes': [{'field': field, 'value': value, 'previous': parse(previous)}
                               for field, value, previous in triples]}
        from .configuration import changes
        changes(payload)
        os.execv(PKEXEC, [PKEXEC, REQUEST_BIN, 'region', json.dumps(payload)])

    if args.command == 'update':
        _handle_update(args, json_mode=json_mode)


def choose_channel(state, name, policy=channels.DECLARED, engine=None):
    """Follow another release channel; a beta preview is stale once on stable.

    A running operation holds the lock for its whole build, so the choice
    never waits for it: installation checks the channel again before it
    applies anything.
    """
    chosen = channels.choose(state, name, policy)
    with locked(Path(state) / 'operation.lock', skip_busy=True) as held:
        if held:
            (engine or Engine(state=state, policy=policy)).channel_changed()
    return chosen


def request():
    """Small authenticated request boundary; no arbitrary paths or commands."""
    if os.geteuid() != 0:
        raise Failure('Administrator authentication is required')
    require_installed()
    args = sys.argv[1:]
    if not args:
        raise Failure('Missing lifecycle action')
    state = Path('/var/lib/cybexos')
    action, *values = args
    if action in ('software', 'maintenance-policy') and len(values) == 1 and len(values[0]) <= 65536:
        from .common import parse
        payload = parse(values[0])
        if not isinstance(payload, dict):
            raise Failure('Invalid personal declaration request')
        print(json.dumps(enqueue(state, action, payload))); return
    if action.startswith('maintenance-'):
        valid = ((action in ('maintenance-preview', 'maintenance-resume') and not values)
                 or (action == 'maintenance-clean' and len(values) == 2
                     and re.fullmatch('[0-9a-f]{32}', values[0]) and re.fullmatch('[0-9a-f]{64}', values[1]))
                 or (action == 'maintenance-pin' and len(values) == 2
                     and re.fullmatch('[0-9a-f]{32}', values[0]) and values[1] in ('true', 'false')))
        if not valid:
            raise Failure('Invalid storage request')
        print(json.dumps(enqueue(state, action, {'action':action, 'values':values}))); return
    if action == 'region' and len(values) == 1 and len(values[0]) < 4096:
        from .common import parse
        payload = parse(values[0])
        from .configuration import changes
        try:
            changes(payload)
        except Failure:
            raise Failure('Invalid region request') from None
        atomic(state / 'region-request.json', payload)
        subprocess.run(['systemctl', 'start', '--no-block', 'cybexos-region.service'], check=True)
        print(json.dumps({'accepted': True})); return
    if action == 'automatic' and len(values) == 2 and values[1] in ('on', 'off'):
        print(json.dumps({'automatic': automatic.choose(state, values[0], values[1] == 'on')})); return
    if action == 'channel' and len(values) == 1:
        print(json.dumps({'channel': choose_channel(state, values[0])})); return
    if action == 'log' and len(values) == 1:
        if not re.fullmatch('[0-9a-f]{32}', values[0]):
            raise Failure('Invalid deployment identifier')
        path = state / 'transactions' / values[0] / 'build.log'
        if not path.is_file():
            raise Failure('No build log for this deployment')
        # Logs can contain private module diagnostics. Only the authenticated
        # administrator sees them; never copy them to world-readable status.
        with path.open('r', errors='replace') as stream:
            from .progress import log_line
            for line in stream:
                sys.stdout.write(log_line(line))
        return
    if action == 'retry-failed' and len(values) == 1:
        if not re.fullmatch('[0-9a-f]{32}', values[0]):
            raise Failure('Invalid deployment identifier')
        tx = state / 'transactions' / values[0]
        if not (tx / 'failed.json').exists():
            raise Failure('No failed deployment found')
        with locked(state / 'operation.lock'):
            system = read(tx / 'deployment.json')['system']
            authorized = []
            for failed in (state / 'transactions').glob('*/failed.json'):
                if read(failed.parent / 'deployment.json', {}).get('system') == system:
                    atomic(failed.parent / 'retry-authorized.json', {'authorizedAt': time.time()})
                    authorized.append(failed.parent.name)
        print(json.dumps({'retryAuthorized': values[0], 'sameSystemDeployments': authorized})); return
    if action == 'history' and not values:
        records = []
        for tx in sorted((state / 'transactions').glob('*')):
            if (tx / 'deployment.json').exists():
                records.append(read(tx / 'deployment.json') | {'good': (tx / 'good.json').exists(), 'failed': read(tx / 'failed.json'),
                                                               'retired': (tx / 'retired.json').exists(),
                                                               'outcome': read(tx / 'outcome.json')})
        print(json.dumps(records)); return
    print(json.dumps(enqueue_update(state, action, values)))


def admin():
    if os.geteuid() != 0:
        raise Failure('Lifecycle worker requires root')
    require_installed()
    engine = Engine()
    action, *values = sys.argv[1:]
    if action == 'update' and len(values) == 1:
        run_update(engine, values[0])
    elif action in ('update-auto', 'update-confirm') and not values:
        status = lambda: update_status(engine.state, engine.working)
        result = (automatic.prepare(engine, enqueue_update, status, config_digest) if action == 'update-auto'
                  else automatic.confirm(engine, enqueue_update, status))
        print(json.dumps(result))
    elif action in ('software', 'maintenance-policy', 'maintenance') and len(values) == 1:
        if not re.fullmatch('[a-f0-9]{32}', values[0]):
            raise Failure('Invalid request identifier')
        path = engine.state / 'requests' / (values[0] + '.json')
        payload = read(path)
        req_status = engine.state / 'request-status' / (values[0] + '.json')
        atomic(req_status, read(req_status, {}) | {'state':'running', 'unit':f'cybexos-{action}@{values[0]}.service'}, 0o644)
        try:
            if action == 'software':
                engine.stage('local', software=payload, request_id=values[0])
            elif action == 'maintenance-policy':
                engine.stage('local', maintenance=payload, request_id=values[0])
            else:
                from .maintenance import Maintenance
                service = Maintenance(engine, request_id=values[0])
                operation, arguments = payload['action'], payload['values']
                service.publish(state='checking', error='')
                try:
                    if operation == 'maintenance-preview': service.preview()
                    elif operation == 'maintenance-clean': service.clean(*arguments)
                    elif operation == 'maintenance-pin': service.pin(arguments[0], arguments[1] == 'true')
                    elif operation == 'maintenance-resume':
                        with locked(engine.state / 'operation.lock'): service.resume()
                    else: raise Failure('Invalid storage worker request')
                except BaseException as error:
                    service.publish(state='failed', error=str(error) if isinstance(error, Failure) else 'Storage cleanup failed. Inspect the private maintenance log.', reviewToken=None)
                    raise
            atomic(req_status, read(req_status) | {'state':'done', 'finishedAt':time.time()}, 0o644)
        except BaseException as error:
            atomic(req_status, read(req_status) | {'state':'failed', 'finishedAt':time.time(), 'error':str(error) if isinstance(error, Failure) else 'The request failed. Inspect its private system service log.'}, 0o644)
            raise
        finally:
            path.unlink(missing_ok=True)
    elif action == 'maintenance-auto' and not values:
        from .maintenance import Maintenance
        Maintenance(engine).clean(automatic=True)
    elif action == 'region' and not values:
        engine.stage('local', region=read(engine.state / 'region-request.json'))
    elif action == 'recover' and not values:
        engine.recover()
    else:
        raise Failure('Invalid worker action')


def entry(function):
    global _ERROR_FORMAT
    _ERROR_FORMAT = 'json'
    try:
        function()
    except (Failure, ValueError, KeyError, OSError, subprocess.SubprocessError) as error:
        if function is main and _ERROR_FORMAT == 'human':
            print(f'cybex: {error}', file=sys.stderr)
        else:
            print(json.dumps({'error': str(error)}), file=sys.stderr)
        sys.exit(1)
