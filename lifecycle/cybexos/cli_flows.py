"""Guided interactive flows and high-level subcommands for `cybex`."""

from __future__ import annotations

import json
import os
from pathlib import Path
import re
import subprocess
import time

from . import cli_format as fmt
from .common import Failure, read

REQUEST_BIN = '/run/current-system/sw/bin/cybexos-request'
POLL_INTERVAL = 0.5
BUSY_STATES = ('discovering', 'building', 'validating', 'activating', 'recovering', 'firmware')


def run_privileged(action, *extra, pkexec=None, expect_json=True):
    """Run one validated `cybexos-request` action through NixOS's setuid pkexec."""
    from . import cli
    wrapper = pkexec or cli.PKEXEC
    result = subprocess.run(
        [wrapper, REQUEST_BIN, action, *extra],
        text=True,
        capture_output=True,
    )
    if result.returncode != 0:
        message = _extract_error(result.stderr) or _extract_error(result.stdout)
        if not message:
            if result.returncode in (126, 127):
                message = 'Administrator authorization was cancelled.'
            else:
                message = f'The request failed (exit {result.returncode}).'
        raise Failure(message)
    if not expect_json:
        return result.stdout
    text = result.stdout.strip()
    if not text:
        return {}
    try:
        return json.loads(text)
    except ValueError:
        return {'raw': text}


def _extract_error(text):
    text = (text or '').strip()
    if not text:
        return ''
    for line in reversed(text.splitlines()):
        line = line.strip()
        if line.startswith('{') and line.endswith('}'):
            try:
                parsed = json.loads(line)
                if isinstance(parsed, dict) and isinstance(parsed.get('error'), str):
                    return parsed['error']
            except ValueError:
                pass
    return text


def wait_for_update(request_id=None, *, previous_tx=None, target_states=None, progress=None):
    """Follow a supervised update/stage/apply worker until it reaches a terminal state."""
    from . import cli
    progress = progress or fmt.ProgressLine()
    terminal = set(target_states or (
        'ready', 'awaiting-boot', 'awaiting-login', 'done',
        'failed', 'interrupted', 'stale', 'rolled-back', 'recovery-failed',
    ))
    try:
        while True:
            status = cli.update_status()
            req = None
            if request_id:
                try:
                    req = cli.request_status(request_id)
                except Failure:
                    req = status.get('request') or {}
            else:
                req = status.get('request') or {}

            state = status.get('state', 'idle')
            phase = status.get('phase') or f'Working ({state})…'
            progress.update(phase, status.get('progress'))

            req_state = req.get('state') if isinstance(req, dict) else None
            if req_state == 'failed' and state not in ('failed', 'interrupted', 'stale', 'recovery-failed'):
                error = req.get('error') or 'The operation failed.'
                progress.finish()
                raise Failure(error)

            same_old = previous_tx is not None and status.get('transaction') == previous_tx and req_state in ('queued', 'running', None)
            if not same_old and state in terminal:
                if request_id is None or req_state in ('done', 'failed', None):
                    progress.finish()
                    return status

            if request_id and req_state == 'done' and state not in BUSY_STATES:
                progress.finish()
                return status

            time.sleep(POLL_INTERVAL)
    except KeyboardInterrupt:
        progress.finish('Still running in the background. Check progress with: cybex update status')
        raise SystemExit(130) from None


def wait_for_maintenance(request_id, *, target_states=('ready', 'done', 'failed', 'skipped'), progress=None):
    """Follow a supervised storage cleanup worker until it settles."""
    from . import cli
    from .maintenance import public_status
    progress = progress or fmt.ProgressLine()
    try:
        while True:
            req = cli.request_status(request_id)
            status = public_status()
            state = status.get('state', 'idle')
            phase = 'Scanning old generations…' if state == 'checking' else 'Cleaning disk space…' if state == 'cleaning' else f'Working ({state})…'
            progress.update(phase)
            if req.get('state') == 'failed':
                progress.finish()
                raise Failure(req.get('error') or status.get('error') or 'Storage cleanup failed.')
            if req.get('state') == 'done' or state in target_states:
                if req.get('state') in ('done', None) and state not in ('checking', 'cleaning'):
                    progress.finish()
                    return status
            time.sleep(POLL_INTERVAL)
    except KeyboardInterrupt:
        progress.finish('Cleanup continues in the background. Check with: cybex cleanup status')
        raise SystemExit(130) from None


def wait_for_flathub(task_id, *, label='Updating Flathub app…', progress=None):
    """Follow a transient user Flathub task until completion."""
    from . import flathub
    progress = progress or fmt.ProgressLine()
    try:
        while True:
            state = flathub.status()
            task = state.get('task') or {}
            if task.get('id') == task_id:
                t_state = task.get('state')
                progress.update(label)
                if t_state == 'done':
                    progress.finish()
                    return task
                if t_state == 'failed':
                    progress.finish()
                    raise Failure(task.get('error') or 'The Flathub change failed.')
            else:
                progress.finish()
                return task
            time.sleep(POLL_INTERVAL)
    except KeyboardInterrupt:
        progress.finish('Flathub change continues in the background.')
        raise SystemExit(130) from None


def resolve_transaction(prefix=None):
    """Resolve an omitted or abbreviated transaction ID to a full 32-hex identifier."""
    from . import cli
    if isinstance(prefix, str) and re.fullmatch(r'[0-9a-f]{32}', prefix):
        return prefix
    current = cli.update_status().get('transaction')
    if not prefix:
        if current:
            return current
        raise Failure('No active transaction found. Specify an ID from "cybex update history".')
    if not re.fullmatch(r'[0-9a-f]{4,31}', prefix):
        raise Failure('Invalid deployment identifier.')
    if isinstance(current, str) and current.startswith(prefix):
        return current
    records = run_privileged('history')
    matches = [r['id'] for r in (records if isinstance(records, list) else []) if isinstance(r, dict) and str(r.get('id', '')).startswith(prefix)]
    if len(matches) == 1:
        return matches[0]
    if len(matches) > 1:
        raise Failure(f'Ambiguous deployment ID "{prefix}". Give more characters.')
    raise Failure(f'No deployment found starting with "{prefix}".')


def _apply_ready_status(status, *, assume_yes=False, prompt_text='Apply this change now?', style=None):
    """Show the prepared review highlights, confirm with the user, and apply."""
    style = style or fmt.Style()
    body = fmt.format_highlights(
        status.get('highlights'),
        changes=status.get('changes', ''),
        restart=status.get('restart', ''),
        desktop_restart=status.get('desktopRestart', ''),
        style=style,
    )
    if body:
        print(body)
        print()
    if not fmt.confirm_prompt(prompt_text, assume_yes=assume_yes):
        print(style.dim("Prepared change kept. Run 'cybex update' to apply later, or 'cybex update discard' to cancel."))
        return status
    tx = status.get('transaction')
    token = status.get('reviewToken')
    if not tx or not token:
        raise Failure('The prepared change has no valid review token. Prepare it again.')
    print(style.dim('Applying change (administrator authorization may be required)…'))
    accepted = run_privileged('apply', tx, token)
    result = wait_for_update(accepted.get('requestId'), target_states=('awaiting-boot', 'awaiting-login', 'done', 'failed', 'rolled-back', 'recovery-failed'))
    state = result.get('state')
    if state in ('failed', 'rolled-back', 'recovery-failed'):
        raise Failure(result.get('error') or result.get('phase') or 'Applying the change failed.')
    if state == 'awaiting-boot':
        print(style.ok('✓ Ready.') + ' Restart when convenient to finish.')
        print(style.dim('  Undo anytime: cybex update rollback'))
    elif state == 'done':
        print(style.ok('✓ Applied and active.'))
        print(style.dim('  Undo anytime: cybex update rollback'))
    else:
        print(style.ok('✓ Applied.') + f' ({result.get("phase") or state})')
    return result


def interactive_update(*, scope=None, assume_yes=False, stage_only=False, style=None):
    """Guided `cybex update`: check, stage with live progress, review, confirm, apply."""
    from . import cli
    style = style or fmt.Style()
    cli.require_installed()

    current = cli.update_status()
    state = current.get('state', 'idle')

    if state in BUSY_STATES:
        print(style.accent('An update is already running. Following progress…'))
        current = wait_for_update((current.get('request') or {}).get('id'))
        state = current.get('state', 'idle')

    if state == 'awaiting-boot':
        print(style.warn('An update is already applied and waiting for a restart.'))
        print(style.dim('Restart when convenient to finish.'))
        return
    if state == 'awaiting-login':
        print(style.warn('This boot is waiting for confirmation.'))
        print(style.dim("Run 'cybex update confirm' to keep it, or 'cybex update rollback' to restore the previous system."))
        return

    if state == 'ready' and not scope:
        print(style.bold('A prepared change is ready to apply.'))
        print()
        if stage_only:
            print(fmt.format_update_status(current, style=style))
            return
        _apply_ready_status(current, assume_yes=assume_yes, prompt_text='Apply this update now?', style=style)
        return

    chosen_scope = scope
    if not chosen_scope:
        print(style.dim('Checking for updates…'))
        discovery = cli.run_check()
        vendor = discovery.get('cybexos') or {}
        upstream = discovery.get('upstream') or {}
        fw = discovery.get('firmware') or {}
        has_vendor = vendor.get('state') == 'available'
        has_upstream = upstream.get('state') == 'available'
        has_fw = fw.get('state') == 'available'
        if not (has_vendor or has_upstream or has_fw):
            print(fmt.format_update_check(discovery, style=style))
            return
        if has_vendor and has_upstream:
            chosen_scope = 'both'
        elif has_vendor:
            chosen_scope = 'cybexos'
        elif has_upstream:
            chosen_scope = 'upstream'
        else:
            chosen_scope = 'firmware'
        if has_vendor:
            print(f'{style.ok("Update available:")} Cybex OS {vendor.get("installed", "")} → {style.ok(vendor.get("available", ""))}')
        elif has_upstream:
            print(style.ok('NixOS package updates available.'))
        elif has_fw:
            print(style.ok('Device firmware updates available.'))
        print()

    print(style.dim(f'Preparing {chosen_scope} update (administrator authorization required)…'))
    previous_tx = current.get('transaction')
    accepted = run_privileged('stage', chosen_scope)
    prepared = wait_for_update(accepted.get('requestId'), previous_tx=previous_tx)
    if prepared.get('state') != 'ready':
        raise Failure(prepared.get('error') or prepared.get('phase') or 'Update preparation did not finish.')
    print()
    if stage_only:
        body = fmt.format_highlights(
            prepared.get('highlights'),
            changes=prepared.get('changes', ''),
            restart=prepared.get('restart', ''),
            desktop_restart=prepared.get('desktopRestart', ''),
            style=style,
        )
        if body:
            print(body)
            print()
        print(style.ok('✓ Prepared.') + " Run 'cybex update' to apply, or 'cybex update discard' to cancel.")
        return
    _apply_ready_status(prepared, assume_yes=assume_yes, prompt_text='Apply this update now?', style=style)


# ---- `cybex status` ---------------------------------------------------------

def _read_backup_overview():
    config_root = Path(os.environ.get('XDG_CONFIG_HOME', str(Path.home() / '.config'))) / 'cybexos'
    state_root = Path(os.environ.get('XDG_STATE_HOME', str(Path.home() / '.local/state'))) / 'cybexos'
    cfg = read(config_root / 'backup.json', None)
    if not isinstance(cfg, dict) or not cfg.get('destination'):
        return {'state': 'unconfigured'}
    dest = cfg['destination'].get('display') if isinstance(cfg['destination'], dict) else ''
    if not cfg.get('recoveryKeyConfirmed'):
        return {'state': 'unconfirmed', 'destination': dest}
    st = read(state_root / 'backup-state.json', {}) or {}
    last = st.get('lastBackup') if isinstance(st, dict) else None
    if not isinstance(last, dict) or not last.get('time'):
        return {'state': 'configured', 'destination': dest}
    if last.get('ok') is False:
        return {'state': 'failed', 'destination': dest, 'lastTime': last.get('time'), 'error': last.get('error', '')}
    ts = fmt.parse_timestamp(last.get('time'))
    overdue = ts is not None and (time.time() - ts) > 7 * 86400
    return {'state': 'overdue' if overdue else 'ok', 'destination': dest, 'lastTime': last.get('time')}


def _read_desktop_overview():
    config_root = Path(os.environ.get('XDG_CONFIG_HOME', str(Path.home() / '.config'))) / 'cybexos'
    state_root = Path(os.environ.get('XDG_STATE_HOME', str(Path.home() / '.local/state'))) / 'cybexos'
    recovery = read(state_root / 'shell-recovery.json', {}) or {}
    plugins = read(config_root / 'plugins.json', {}) or {}
    plugin_map = plugins.get('plugins') if isinstance(plugins.get('plugins'), dict) else {}
    enabled = sum(1 for item in plugin_map.values() if isinstance(item, dict) and item.get('enabled') is True)
    shell_cfg = read(config_root / 'shell.json', {}) or {}
    theme = shell_cfg.get('theme') or shell_cfg.get('themeId') or ''
    return {
        'safeMode': bool(recovery.get('safe')),
        'reason': recovery.get('reason', ''),
        'enabledPlugins': enabled,
        'theme': theme if isinstance(theme, str) else '',
    }


def read_region_state():
    """Read current timezone and system locale without requiring root."""
    timezone = ''
    try:
        res = subprocess.run(
            ['timedatectl', 'show', '--property=Timezone', '--value'],
            text=True, capture_output=True, timeout=5, check=False,
        )
        if res.returncode == 0:
            timezone = res.stdout.strip()
    except (OSError, subprocess.SubprocessError):
        pass
    if not timezone:
        try:
            target = str(Path('/etc/localtime').resolve())
            if 'zoneinfo/' in target:
                timezone = target.split('zoneinfo/', 1)[1]
        except OSError:
            pass

    locale_values = []
    try:
        res = subprocess.run(
            ['busctl', '--system', '--json=short', 'get-property',
             'org.freedesktop.locale1', '/org/freedesktop/locale1',
             'org.freedesktop.locale1', 'Locale'],
            text=True, capture_output=True, timeout=5, check=False,
        )
        if res.returncode == 0:
            parsed = json.loads(res.stdout)
            if isinstance(parsed, dict) and isinstance(parsed.get('data'), list):
                locale_values = [x for x in parsed['data'] if isinstance(x, str)]
    except (OSError, subprocess.SubprocessError, ValueError):
        pass

    locale = next((v[5:] for v in locale_values if v.startswith('LANG=')), '')
    if not locale:
        locale = os.environ.get('LANG', '')
    return {'timezone': timezone, 'locale': locale, 'localeValues': locale_values}


def collect_status():
    """Fast, read-only local overview for `cybex status`."""
    from . import cli
    release = read('/etc/cybexos/release.json', {}) or {}
    components = (read('/etc/cybexos/components.json', {}) or {}).get('components') or {}
    channel = cli.release_channel().get('selected', '')

    if cli.LIVE_MARKER.exists():
        upd = {'state': 'unavailable', 'phase': cli.LIVE_UPDATE_REASON}
        stor = {}
    else:
        try:
            upd = cli.update_status()
        except Failure:
            upd = {'state': 'unknown'}
        try:
            from .maintenance import public_status
            maint = public_status()
            space = maint.get('space') or {}
            stor = {
                'available': space.get('available'),
                'total': space.get('total'),
                'low': bool(space.get('low')),
                'cleanable': maint.get('estimatedBytes') if maint.get('state') == 'ready' else 0,
            }
        except (Failure, OSError):
            stor = {}

    return {
        'version': release.get('version', ''),
        'channel': channel,
        'nixos': components.get('nixos', ''),
        'updates': {
            'state': upd.get('state', 'unknown'),
            'phase': upd.get('phase', ''),
            'availableVersion': upd.get('availableVersion', ''),
            'transaction': upd.get('transaction'),
        },
        'storage': stor,
        'backup': _read_backup_overview(),
        'desktop': _read_desktop_overview(),
        'region': {k: v for k, v in read_region_state().items() if k in ('timezone', 'locale')},
    }


# ---- `cybex apps` -----------------------------------------------------------

def _resolve_catalogue_app(query):
    """Match a curated catalogue app by ID, attribute, or case-insensitive name."""
    from . import software
    try:
        _, apps = software.shipped_catalogue(software.SHIPPED)
    except (Failure, OSError):
        return None
    needle = query.casefold()
    for key in ('id', 'attribute', 'name'):
        for app in apps:
            if str(app.get(key, '')).casefold() == needle:
                return app
    return None


def _resolve_install_target(name, source):
    """Classify an app target into ('flathub', id, label) or ('nix', attr, label)."""
    from . import flathub, software
    if source == 'flathub':
        if not flathub.valid_id(name):
            raise Failure(f"'{name}' is not a valid Flathub app ID (for example org.gimp.GIMP). Run 'cybex apps search {name}'.")
        return ('flathub', name, name)
    if source == 'auto' and flathub.valid_id(name):
        return ('flathub', name, name)
    matched = _resolve_catalogue_app(name)
    if matched:
        return ('nix', matched['attribute'], matched.get('name') or matched['attribute'])
    if software.ATTRIBUTE.fullmatch(name):
        return ('nix', name, name)
    raise Failure(f"Could not find app '{name}'. Run 'cybex apps search {name}' to search.")


def handle_apps(args, *, json_mode=False, style=None):
    from . import cli, flathub, software
    style = style or fmt.Style()
    cli.require_installed()
    action = args.apps_action

    if action == 'list':
        nix_inv = software.inventory() if args.source in ('all', 'nix') else {'selected': [], 'desired': [], 'packages': []}
        fh_state = flathub.status() if args.source in ('all', 'flathub') else {'installed': []}
        if json_mode:
            print(json.dumps({'nix': nix_inv, 'flathub': fh_state}))
            return
        print(fmt.format_apps_list(nix_inv, fh_state, show_all=args.all, style=style))
        return

    if action == 'search':
        query = ' '.join(args.query).strip()
        nix_rows, fh_rows, fh_note = [], [], ''
        if args.source in ('all', 'nix'):
            found = software.search(query)
            selected = set(found.get('desired') or found.get('selected') or [])
            installed_names = {p.get('name') for p in found.get('packages') or []}
            nix_rows = [
                row | {'installed': row['attribute'] in selected or row['name'] in installed_names}
                for row in found.get('results') or []
            ]
        if args.source in ('all', 'flathub') and query:
            if flathub.enabled():
                try:
                    fh_rows = (flathub.search(query).get('results') or [])
                except Failure as error:
                    if args.source == 'flathub':
                        raise
                    fh_note = f'Flathub search skipped: {error}'
            elif args.source == 'flathub':
                raise Failure('Flathub is turned off on this computer.')
        if json_mode:
            print(json.dumps({'query': query, 'nix': nix_rows, 'flathub': fh_rows}))
            return
        print(fmt.format_apps_search(nix_rows, fh_rows, query, flathub_note=fh_note, style=style))
        return

    if action == 'info':
        target_kind, target_id, label = _resolve_install_target(args.name, args.source)
        if target_kind == 'flathub':
            info = flathub.details(target_id) | {'source': 'flathub'}
        else:
            matched = _resolve_catalogue_app(args.name) or {}
            checked = software.check([target_id])
            pkg = (checked.get('packages') or {}).get(target_id) or {}
            inv = software.inventory()
            is_inst = target_id in (inv.get('desired') or []) or any(
                target_id in (p.get('attributes') or []) or p.get('name') == target_id
                for p in inv.get('packages') or []
            )
            info = {
                'source': 'nix',
                'name': matched.get('name') or label,
                'attribute': target_id,
                'version': pkg.get('version', ''),
                'summary': matched.get('summary', ''),
                'downloadBytes': checked.get('downloadBytes', 0),
                'prebuilt': pkg.get('state') == 'prebuilt',
                'installed': is_inst,
            }
        if json_mode:
            print(json.dumps(info))
            return
        print(fmt.format_app_info(info, style=style))
        return

    if action == 'updates':
        data = flathub.updates()
        if json_mode:
            print(json.dumps(data))
            return
        print(fmt.format_flathub_updates(data, style=style))
        return

    if action == 'update':
        started = flathub.start('update', args.ids)
        if json_mode:
            print(json.dumps(started))
            return
        wait_for_flathub(started['task'], label='Updating Flathub apps…')
        print(style.ok('✓ Flathub apps updated.'))
        return

    if action == 'install':
        resolved = [_resolve_install_target(name, args.source) for name in args.names]
        fh_targets = [(tid, label) for kind, tid, label in resolved if kind == 'flathub']
        nix_targets = [(tid, label) for kind, tid, label in resolved if kind == 'nix']

        results = {}
        if fh_targets:
            fh_ids = [tid for tid, _ in fh_targets]
            fh_names = dict(fh_targets)
            started = flathub.start('install', fh_ids, names=fh_names)
            if json_mode and not nix_targets:
                print(json.dumps(started))
                return
            wait_for_flathub(started['task'], label=f'Installing {", ".join(fh_ids)} from Flathub…')
            results['flathub'] = fh_ids
            if not json_mode:
                print(style.ok(f'✓ Installed {", ".join(fh_ids)} from Flathub.'))

        if nix_targets:
            inv = software.inventory()
            current_desired = list(inv.get('desired') or [])
            wanted_attrs = [tid for tid, _ in nix_targets]
            to_add = [attr for attr in wanted_attrs if attr not in current_desired]
            if not to_add:
                if json_mode:
                    print(json.dumps({'installed': wanted_attrs, 'changed': False}))
                    return
                print(style.ok('Already installed: ') + ', '.join(wanted_attrs))
                return

            if not json_mode:
                print(style.dim(f'Checking prebuilt availability for {", ".join(to_add)}…'))
            checked = software.check(to_add)
            problems = []
            for attr in to_add:
                pkg = (checked.get('packages') or {}).get(attr) or {}
                if pkg.get('state') == 'unavailable':
                    reason = pkg.get('reason') or 'unavailable'
                    if reason == 'unfree':
                        problems.append(f'{attr}: proprietary package (enable cybexos.features.proprietary first)')
                    elif reason == 'missing':
                        problems.append(f"{attr}: not found in this machine's NixOS packages")
                    else:
                        problems.append(f'{attr}: {reason}')
                elif pkg.get('state') == 'compiles':
                    comp = ', '.join((pkg.get('compiles') or [])[:4])
                    problems.append(f'{attr}: would compile locally ({comp})')
            if problems:
                raise Failure('Cannot install: ' + '; '.join(problems))

            new_packages = sorted(set(current_desired) | set(to_add))
            payload = json.dumps({'packages': new_packages, 'previous': current_desired})
            if not json_mode:
                labels = ', '.join(label for _, label in nix_targets)
                print(style.dim(f'Preparing {labels} (administrator authorization required)…'))
            previous_tx = cli.update_status().get('transaction')
            accepted = run_privileged('software', payload)
            if json_mode:
                print(json.dumps(accepted))
                return
            prepared = wait_for_update(accepted.get('requestId'), previous_tx=previous_tx)
            if prepared.get('state') != 'ready':
                raise Failure(prepared.get('error') or prepared.get('phase') or 'Preparation failed.')
            print()
            _apply_ready_status(prepared, assume_yes=args.yes, prompt_text='Install now?', style=style)
        return

    if action == 'remove':
        inv = software.inventory()
        current_desired = list(inv.get('desired') or [])
        fh_installed = {row['id']: row for row in (flathub.status().get('installed') or [])}
        fh_by_name = {row.get('name', '').casefold(): row['id'] for row in fh_installed.values() if row.get('name')}

        fh_remove, nix_remove = [], []
        for raw in args.names:
            if args.source in ('auto', 'flathub') and raw in fh_installed:
                fh_remove.append(raw)
                continue
            if args.source == 'flathub' and raw.casefold() in fh_by_name:
                fh_remove.append(fh_by_name[raw.casefold()])
                continue
            matched = _resolve_catalogue_app(raw)
            attr = matched['attribute'] if matched else raw
            if args.source in ('auto', 'nix') and attr in current_desired:
                nix_remove.append(attr)
                continue
            if args.source == 'auto' and raw.casefold() in fh_by_name:
                fh_remove.append(fh_by_name[raw.casefold()])
                continue
            owned = next(
                (p for p in inv.get('packages') or []
                 if attr in (p.get('attributes') or []) or p.get('name') == attr),
                None,
            )
            if owned:
                owner = software.owner(owned)
                raise Failure(
                    f"'{raw}' is managed by {owner} (not Software) and cannot be removed with 'cybex apps remove'."
                )
            raise Failure(f"'{raw}' is not installed via Software or Flathub.")

        if fh_remove:
            started = flathub.start('remove', fh_remove)
            if json_mode and not nix_remove:
                print(json.dumps(started))
                return
            wait_for_flathub(started['task'], label=f'Removing {", ".join(fh_remove)}…')
            if not json_mode:
                print(style.ok(f'✓ Removed {", ".join(fh_remove)} from Flathub.'))

        if nix_remove:
            remaining = [pkg for pkg in current_desired if pkg not in set(nix_remove)]
            payload = json.dumps({'packages': remaining, 'previous': current_desired})
            if not json_mode:
                print(style.dim(f'Preparing removal of {", ".join(nix_remove)} (administrator authorization required)…'))
            previous_tx = cli.update_status().get('transaction')
            accepted = run_privileged('software', payload)
            if json_mode:
                print(json.dumps(accepted))
                return
            prepared = wait_for_update(accepted.get('requestId'), previous_tx=previous_tx)
            if prepared.get('state') != 'ready':
                raise Failure(prepared.get('error') or prepared.get('phase') or 'Preparation failed.')
            print()
            _apply_ready_status(prepared, assume_yes=args.yes, prompt_text='Remove now?', style=style)


# ---- `cybex cleanup` --------------------------------------------------------

def handle_cleanup(args, *, json_mode=False, style=None):
    from . import cli
    from .maintenance import public_status
    style = style or fmt.Style()
    cli.require_installed()
    action = getattr(args, 'cleanup_action', None)

    if action == 'status':
        data = public_status()
        print(json.dumps(data) if json_mode else fmt.format_cleanup_status(data, style=style))
        return

    if action == 'preview':
        if not json_mode:
            print(style.dim('Checking reclaimable disk space (administrator authorization required)…'))
        accepted = run_privileged('maintenance-preview')
        if json_mode:
            print(json.dumps(accepted))
            return
        preview = wait_for_maintenance(accepted.get('requestId'), target_states=('ready', 'failed'))
        if preview.get('state') != 'ready':
            raise Failure(preview.get('error') or 'Cleanup preview failed.')
        print(fmt.format_cleanup_preview(preview, style=style))
        return

    if action == 'resume':
        accepted = run_privileged('maintenance-resume')
        if json_mode:
            print(json.dumps(accepted))
            return
        result = wait_for_maintenance(accepted.get('requestId'), target_states=('done', 'failed'))
        if result.get('state') != 'done':
            raise Failure(result.get('error') or 'Resuming cleanup failed.')
        print(style.ok(f'✓ Cleanup finished (freed {fmt.human_bytes(result.get("reclaimedBytes", 0))}).'))
        return

    if action == 'pin':
        deployment = resolve_transaction(args.deployment)
        enabled = 'true' if args.state in ('on', 'true') else 'false'
        accepted = run_privileged('maintenance-pin', deployment, enabled)
        if json_mode:
            print(json.dumps(accepted))
            return
        wait_for_maintenance(accepted.get('requestId'), target_states=('idle', 'done', 'failed'))
        verb = 'Pinned' if enabled == 'true' else 'Unpinned'
        print(style.ok(f'✓ {verb} deployment {fmt.short_id(deployment)}.'))
        return

    if action == 'policy':
        current = public_status()
        previous = current.get('desiredPolicy') or current.get('policy')
        updated = dict(previous)
        changed = False
        if args.automatic is not None:
            updated['automatic'] = args.automatic == 'on'
            changed = True
        if args.keep_confirmed is not None:
            updated['keepConfirmed'] = args.keep_confirmed
            changed = True
        if args.keep_days is not None:
            updated['keepDays'] = args.keep_days
            changed = True
        if not changed:
            print(json.dumps(previous) if json_mode else fmt.format_cleanup_status(current, style=style))
            return
        from .maintenance import policy as validate_policy
        validate_policy(updated)
        payload = json.dumps({'previous': previous, 'policy': updated})
        previous_tx = cli.update_status().get('transaction')
        accepted = run_privileged('maintenance-policy', payload)
        if json_mode:
            print(json.dumps(accepted))
            return
        prepared = wait_for_update(accepted.get('requestId'), previous_tx=previous_tx)
        if prepared.get('state') != 'ready':
            raise Failure(prepared.get('error') or 'Preparing policy change failed.')
        print()
        _apply_ready_status(prepared, assume_yes=args.yes, prompt_text='Apply cleanup policy?', style=style)
        return

    # Default: `cybex cleanup` or `cybex cleanup run`: preview -> confirm -> clean
    if not json_mode:
        print(style.dim('Checking reclaimable disk space (administrator authorization required)…'))
    accepted = run_privileged('maintenance-preview')
    preview = wait_for_maintenance(accepted.get('requestId'), target_states=('ready', 'failed'))
    if preview.get('state') != 'ready':
        raise Failure(preview.get('error') or 'Cleanup preview failed.')

    est = preview.get('estimatedBytes', 0)
    cands = preview.get('candidates') or []
    if json_mode:
        print(json.dumps(preview))
        return
    print(fmt.format_cleanup_preview(preview, style=style))
    print()
    if est == 0 and not cands:
        print(style.ok('Nothing to clean up — disk space is already tidy.'))
        return
    if not fmt.confirm_prompt('Clean up now?', assume_yes=getattr(args, 'yes', False)):
        print(style.dim('Cancelled. Nothing was deleted.'))
        return
    review_id = preview.get('reviewId')
    token = preview.get('reviewToken')
    if not review_id or not token:
        raise Failure('The cleanup review has no valid token. Try again.')
    clean_req = run_privileged('maintenance-clean', review_id, token)
    done = wait_for_maintenance(clean_req.get('requestId'), target_states=('done', 'failed'))
    if done.get('state') != 'done':
        raise Failure(done.get('error') or 'Storage cleanup failed.')
    print(style.ok(f'✓ Freed {fmt.human_bytes(done.get("reclaimedBytes", 0))}.'))


# ---- `cybex region` ---------------------------------------------------------

def _list_timezones():
    res = subprocess.run(['timedatectl', 'list-timezones', '--no-pager'], text=True, capture_output=True, timeout=10, check=False)
    if res.returncode != 0:
        raise Failure('Could not list system timezones.')
    return sorted(line.strip() for line in res.stdout.splitlines() if line.strip())


def _list_locales():
    res = subprocess.run(['locale', '-a'], text=True, capture_output=True, timeout=10, check=False)
    if res.returncode != 0:
        raise Failure('Could not list installed locales.')
    return sorted({line.strip().replace('.utf8', '.UTF-8') for line in res.stdout.splitlines() if line.strip().endswith(('.utf8', '.UTF-8'))})


def handle_region(args, *, json_mode=False, style=None):
    from . import cli, configuration
    style = style or fmt.Style()
    action = getattr(args, 'region_action', None)

    if action in (None, 'status'):
        data = read_region_state()
        out = {'timezone': data['timezone'], 'locale': data['locale']}
        print(json.dumps(out) if json_mode else fmt.format_region(out, style=style))
        return

    if action == 'timezones':
        items = _list_timezones()
        if args.filter:
            needle = args.filter.casefold()
            items = [z for z in items if needle in z.casefold()]
        if json_mode:
            print(json.dumps(items))
        else:
            for item in items:
                print(item)
        return

    if action == 'locales':
        items = _list_locales()
        if args.filter:
            needle = args.filter.casefold()
            items = [loc for loc in items if needle in loc.casefold()]
        if json_mode:
            print(json.dumps(items))
        else:
            for item in items:
                print(item)
        return

    if action == 'set':
        cli.require_installed()
        if not args.timezone and not args.locale:
            raise Failure('Specify --timezone and/or --locale.')
        current = read_region_state()
        items = []
        preview_lines = []
        if args.timezone:
            if args.timezone not in _list_timezones():
                raise Failure(f"Unknown timezone '{args.timezone}'. Run 'cybex region timezones' to list valid ones.")
            items.append({'field': 'timezone', 'value': args.timezone, 'previous': current['timezone']})
            preview_lines.append(f'  Timezone   {style.dim(current["timezone"] or "unset")} → {style.ok(args.timezone)}')
        if args.locale:
            normalized = args.locale.replace('.utf8', '.UTF-8')
            if normalized not in _list_locales():
                raise Failure(f"Unknown locale '{args.locale}'. Run 'cybex region locales' to list installed locales.")
            items.append({'field': 'locale', 'value': normalized, 'previous': current['localeValues']})
            preview_lines.append(f'  Locale     {style.dim(current["locale"] or "unset")} → {style.ok(normalized)}')

        payload = {'changes': items}
        configuration.changes(payload)
        if not json_mode:
            print(style.bold('Region change'))
            for line in preview_lines:
                print(line)
            print()
            print(style.dim('Preparing change (administrator authorization required)…'))

        previous_tx = cli.update_status().get('transaction')
        accepted = run_privileged('region', json.dumps(payload))
        if json_mode:
            print(json.dumps(accepted))
            return
        prepared = wait_for_update(previous_tx=previous_tx)
        if prepared.get('state') != 'ready':
            raise Failure(prepared.get('error') or prepared.get('phase') or 'Regional change preparation failed.')
        print()
        _apply_ready_status(prepared, assume_yes=args.yes, prompt_text='Apply region change now?', style=style)
