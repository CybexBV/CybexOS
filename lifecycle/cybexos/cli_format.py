"""Human-readable terminal formatting for the `cybex` CLI."""

from __future__ import annotations

from datetime import UTC, datetime
import os
import sys
import time

COMPONENT_LABELS = {
    'cybexos': 'Cybex OS',
    'nixos': 'NixOS',
    'kernel': 'Kernel',
    'graphics': 'Graphics',
    'nvidia': 'NVIDIA',
    'firmware': 'Firmware',
    'hyprland': 'Hyprland',
}

SPINNER = ('⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏')


class Style:
    """Subtle ANSI styling when writing to an interactive color terminal."""

    def __init__(self, stream=None, *, enabled=None):
        stream = sys.stdout if stream is None else stream
        if enabled is None:
            tty = hasattr(stream, 'isatty') and stream.isatty()
            enabled = bool(tty) and 'NO_COLOR' not in os.environ and os.environ.get('TERM') != 'dumb'
        self.enabled = bool(enabled)

    def _wrap(self, code, text):
        return f'\033[{code}m{text}\033[0m' if self.enabled else str(text)

    def bold(self, text): return self._wrap('1', text)
    def dim(self, text): return self._wrap('2', text)
    def ok(self, text): return self._wrap('32', text)
    def warn(self, text): return self._wrap('33', text)
    def err(self, text): return self._wrap('31', text)
    def accent(self, text): return self._wrap('36', text)
    def heading(self, text): return self._wrap('1;36', text)


def human_bytes(value, *, signed=False):
    if value is None:
        return ''
    number = float(value)
    sign = '+' if signed and number > 0 else '-' if number < 0 else ''
    magnitude = abs(number)
    for unit in ('B', 'KiB', 'MiB', 'GiB', 'TiB'):
        if magnitude < 1024 or unit == 'TiB':
            return f'{sign}{int(magnitude)} {unit}' if unit == 'B' else f'{sign}{magnitude:.1f} {unit}'
        magnitude /= 1024.0
    return f'{sign}{magnitude:.1f} TiB'


def parse_timestamp(value):
    if isinstance(value, (int, float)) and value > 0:
        return float(value)
    if isinstance(value, str) and value:
        try:
            text = value[:-1] + '+00:00' if value.endswith('Z') else value
            return datetime.fromisoformat(text).timestamp()
        except ValueError:
            return None
    return None


def relative_time(value, *, now=None):
    ts = parse_timestamp(value)
    if ts is None:
        return 'unknown'
    now = time.time() if now is None else now
    delta = max(0, int(now - ts))
    if delta < 60:
        return 'just now'
    if delta < 3600:
        mins = delta // 60
        return f'{mins} minute{"s" if mins != 1 else ""} ago'
    if delta < 86400:
        hours = delta // 3600
        return f'{hours} hour{"s" if hours != 1 else ""} ago'
    if delta < 14 * 86400:
        days = delta // 86400
        return f'{days} day{"s" if days != 1 else ""} ago'
    return datetime.fromtimestamp(ts, UTC).astimezone().strftime('%Y-%m-%d')


def format_date(value):
    ts = parse_timestamp(value)
    if ts is None:
        return 'unknown'
    return datetime.fromtimestamp(ts, UTC).astimezone().strftime('%Y-%m-%d %H:%M')


def short_id(identifier):
    return identifier[:8] if isinstance(identifier, str) and identifier else '-'


def format_table(headers, rows, *, indent='  ', style=None):
    style = style or Style()
    if not rows:
        return []
    cols = len(headers)
    str_rows = [[str(row[i]) if i < len(row) else '' for i in range(cols)] for row in rows]
    widths = [max(len(headers[i]), *(len(r[i]) for r in str_rows)) for i in range(cols)]
    lines = []
    header_cells = [headers[i].ljust(widths[i]) if i < cols - 1 else headers[i] for i in range(cols)]
    lines.append(indent + style.dim('  '.join(header_cells)))
    for row in str_rows:
        cells = [row[i].ljust(widths[i]) if i < cols - 1 else row[i] for i in range(cols)]
        lines.append(indent + '  '.join(cells))
    return lines


def format_help(*, installed=True, release_version='', style=None):
    style = style or Style()
    title = f'Cybex OS {release_version}' if release_version else 'Cybex OS'
    lines = [f'{style.bold(title)} — System & desktop CLI', '']
    groups = []
    if not installed:
        groups.append(('Installation', [
            ('install', 'Install Cybex OS on this computer'),
        ]))
    groups.extend([
        ('System', [
            ('status', 'Overview of this computer'),
            ('update', 'Check, prepare and apply updates'),
            ('doctor', 'Run a read-only system check'),
            ('cleanup', 'Free space from old generations'),
            ('backup', 'Encrypted home-folder backups'),
            ('report', 'Save a redacted bug report'),
            ('hardware', 'Detected hardware and support status'),
        ]),
        ('Apps & Desktop', [
            ('apps', 'Search, install and remove apps'),
            ('theme', 'Switch or share desktop themes'),
            ('plugin', 'Manage bar widgets and plugins'),
            ('shell', 'Desktop shell health and safe mode'),
            ('region', 'Timezone and language settings'),
        ]),
        ('AI', [
            ('ask', 'Ask Wiz from the terminal'),
            ('agent', 'Open your coding CLI (Claude, Codex, OpenCode)'),
        ]),
    ])
    for heading, entries in groups:
        lines.append(style.heading(heading))
        for name, desc in entries:
            lines.append(f'  {style.ok(name.ljust(10))} {desc}')
        lines.append('')
    lines.append(style.dim("Run 'cybex <command> --help' for details. Add --json for machine output."))
    return '\n'.join(lines)


def format_highlights(highlights, *, changes='', restart='', desktop_restart='', style=None):
    style = style or Style()
    lines = []
    if isinstance(highlights, dict):
        components = highlights.get('components') or []
        apps = highlights.get('apps') or []
        tools = highlights.get('tools') or []
        background = highlights.get('background') or 0
        size_change = highlights.get('sizeChange') or 0

        if components:
            lines.append(style.heading('System components'))
            width = max(len(COMPONENT_LABELS.get(c.get('id', ''), c.get('id', ''))) for c in components)
            for row in components:
                label = COMPONENT_LABELS.get(row.get('id', ''), row.get('id', ''))
                before = row.get('before') or 'none'
                after = row.get('after') or 'removed'
                lines.append(f'  {label.ljust(width)}  {style.dim(before)} → {style.ok(after)}')

        if apps:
            if lines:
                lines.append('')
            lines.append(style.heading('Apps'))
            for row in apps[:20]:
                lines.append('  ' + _format_pkg_change(row, style, use_title=True))
            if len(apps) > 20:
                lines.append(style.dim(f'  … and {len(apps) - 20} more apps'))

        if tools:
            if lines:
                lines.append('')
            lines.append(style.heading('Tools & packages'))
            for row in tools[:15]:
                lines.append('  ' + _format_pkg_change(row, style, use_title=False))
            if len(tools) > 15:
                lines.append(style.dim(f'  … and {len(tools) - 15} more packages'))

        summary_bits = []
        if background:
            summary_bits.append(f'{background} background package{"s" if background != 1 else ""}')
        if size_change:
            summary_bits.append(f'disk {human_bytes(size_change, signed=True)}')
        if summary_bits:
            if lines:
                lines.append('')
            lines.append(style.dim('  ' + ' · '.join(summary_bits)))

    if not lines and changes:
        excerpt = [line for line in changes.splitlines() if line.strip()][:15]
        if excerpt:
            lines.append(style.heading('Changes'))
            lines.extend('  ' + line for line in excerpt)
            total = len([line for line in changes.splitlines() if line.strip()])
            if total > 15:
                lines.append(style.dim(f'  … and {total - 15} more lines'))

    if desktop_restart:
        if lines:
            lines.append('')
        lines.append(style.warn('Note: ' + desktop_restart))

    if restart:
        if lines:
            lines.append('')
        lines.append(style.warn(restart))

    return '\n'.join(lines)


def _format_pkg_change(row, style, *, use_title=False):
    kind = row.get('kind', 'updated')
    label = (row.get('title') or row.get('name') or '') if use_title else (row.get('name') or '')
    before, after = row.get('before'), row.get('after')
    if kind == 'added':
        return f'{style.ok("+")} {label} {style.dim(after or "")}'.rstrip()
    if kind == 'removed':
        return f'{style.err("-")} {label} {style.dim(before or "")}'.rstrip()
    return f'{style.accent("~")} {label} {style.dim(before or "")} → {style.ok(after or "")}'.rstrip()


def format_update_check(data, *, style=None):
    style = style or Style()
    if data.get('available') is False and data.get('reason'):
        return style.warn(data['reason'])
    lines = []
    vendor = data.get('cybexos') or {}
    upstream = data.get('upstream') or {}
    fw = data.get('firmware') or {}
    channel = vendor.get('channel') or ''
    installed = vendor.get('installed') or ''
    header = f'Cybex OS {installed}' if installed else 'Cybex OS'
    if channel:
        header += f' ({channel} channel)'
    lines.append(style.bold(header))
    lines.append('')

    any_available = False
    v_state = vendor.get('state')
    v_avail = vendor.get('available', '')
    if v_state == 'available':
        any_available = True
        lines.append(f'  Cybex OS   {style.ok(f"{installed} → {v_avail}")}')
    elif v_state == 'current':
        lines.append(f'  Cybex OS   {style.ok("Up to date")}')
    elif v_state == 'ahead':
        lines.append(f'  Cybex OS   {style.accent("Ahead of channel")} {style.dim(f"(channel newest: {v_avail})")}')
    elif v_state == 'unpublished':
        lines.append(f'  Cybex OS   {style.dim("No published release on this channel yet")}')
    elif v_state:
        lines.append(f'  Cybex OS   {style.warn(vendor.get("error") or v_state)}')

    u_state = upstream.get('state')
    if u_state == 'available':
        any_available = True
        rel = upstream.get('release')
        detail = f'Available (with Cybex OS {rel})' if rel else 'Available'
        lines.append(f'  Packages   {style.ok(detail)}')
    elif u_state == 'current':
        lines.append(f'  Packages   {style.ok("Up to date")}')
    elif u_state:
        lines.append(f'  Packages   {style.warn(upstream.get("error") or u_state)}')

    fw_state = fw.get('state')
    fw_devices = fw.get('devices') or []
    if fw_state == 'available':
        any_available = True
        names = ', '.join(d.get('name', 'device') for d in fw_devices[:3])
        lines.append(f'  Firmware   {style.ok(f"{len(fw_devices)} update(s) available")} {style.dim(names)}'.rstrip())
    elif fw_state == 'current':
        lines.append(f'  Firmware   {style.ok("Up to date")}')
    elif fw_state and fw_state != 'unavailable':
        lines.append(f'  Firmware   {style.warn(fw.get("error") or fw_state)}')

    if data.get('error'):
        lines.extend(['', style.err(data['error'])])

    lines.append('')
    if any_available:
        lines.append(style.dim("Run 'cybex update' to prepare, review and apply."))
    else:
        lines.append(style.ok('Your system is up to date.'))
    return '\n'.join(lines)


def format_update_status(data, *, style=None):
    style = style or Style()
    if data.get('available') is False and data.get('phase'):
        return style.warn(data['phase'])
    state = data.get('state', 'idle')
    state_labels = {
        'idle': style.ok('Idle (no update in progress)'),
        'done': style.ok('Up to date (last change confirmed)'),
        'ready': style.ok('Ready to apply'),
        'discovering': style.accent('Checking for updates…'),
        'building': style.accent('Building update…'),
        'validating': style.accent('Validating update…'),
        'activating': style.accent('Applying update…'),
        'recovering': style.warn('Recovering previous system…'),
        'firmware': style.accent('Installing device firmware…'),
        'awaiting-boot': style.warn('Waiting for restart'),
        'awaiting-login': style.warn('Waiting for boot confirmation'),
        'stale': style.warn('Prepared update is stale'),
        'failed': style.err('Failed'),
        'interrupted': style.err('Interrupted'),
        'rolled-back': style.warn('Rolled back to previous system'),
        'recovery-failed': style.err('Recovery failed'),
    }
    lines = [f'{style.bold("Update status:")} {state_labels.get(state, state)}']
    phase = data.get('phase')
    if phase:
        lines.append(f'  Phase      {phase}')
    if data.get('transaction'):
        scope = data.get('scope') or ''
        kind = data.get('changeKind') or ''
        meta = ' · '.join(part for part in (kind, scope) if part)
        suffix = f' ({meta})' if meta else ''
        lines.append(f'  Change     {short_id(data["transaction"])}{suffix}')
    if data.get('availableVersion') and data.get('installedVersion'):
        lines.append(f'  Release    {data["installedVersion"]} → {data["availableVersion"]}')

    channel = (data.get('channel') or {}).get('selected')
    auto = data.get('automatic') or {}
    policy_bits = []
    if channel:
        policy_bits.append(f'channel: {channel}')
    if auto:
        policy_bits.append(f'auto-prepare: {"on" if auto.get("prepare") else "off"}')
        policy_bits.append(f'auto-confirm: {"on" if auto.get("confirm") else "off"}')
    if policy_bits:
        lines.append(f'  Policy     {style.dim(" · ".join(policy_bits))}')

    if data.get('error'):
        lines.extend(['', style.err('Error: ' + data['error'])])
    elif (data.get('request') or {}).get('state') == 'failed' and (data.get('request') or {}).get('error'):
        lines.extend(['', style.err('Request error: ' + data['request']['error'])])

    if state == 'ready':
        body = format_highlights(
            data.get('highlights'),
            changes=data.get('changes', ''),
            restart=data.get('restart', ''),
            desktop_restart=data.get('desktopRestart', ''),
            style=style,
        )
        if body:
            lines.extend(['', body])
        lines.extend(['', style.dim("Run 'cybex update' to review and apply, or 'cybex update discard' to cancel.")])
    elif state == 'awaiting-boot':
        lines.extend(['', style.warn('Restart when ready to finish the update.')])
    elif state == 'awaiting-login':
        lines.extend(['', style.dim("Run 'cybex update confirm' to keep this boot, or 'cybex update rollback' to undo.")])
    elif state in ('failed', 'interrupted') and data.get('transaction'):
        lines.extend(['', style.dim("Run 'cybex update log' to inspect the build log.")])
    return '\n'.join(lines)


def format_update_history(records, *, style=None):
    style = style or Style()
    if not records:
        return style.dim('No update history recorded yet.')
    ordered = sorted(records, key=lambda r: r.get('createdAt', 0), reverse=True)
    rows = []
    for rec in ordered:
        when = format_date(rec.get('createdAt'))
        tx = short_id(rec.get('id'))
        kind = rec.get('changeKind') or rec.get('scope') or 'update'
        ver = rec.get('availableVersion') or rec.get('installedVersion') or '-'
        if rec.get('retired'):
            status = 'retired'
        elif rec.get('failed'):
            status = 'failed'
        elif rec.get('good'):
            status = 'confirmed'
        else:
            outcome = (rec.get('outcome') or {}).get('outcome')
            status = outcome or 'pending'
        rows.append([when, tx, kind, ver, status])
    lines = [style.bold(f'Update history ({len(rows)} deployment{"s" if len(rows) != 1 else ""})'), '']
    lines.extend(format_table(['DATE', 'ID', 'KIND', 'VERSION', 'STATUS'], rows, style=style))
    lines.extend(['', style.dim("Rollback: 'cybex update rollback <ID>' · Build log: 'cybex update log <ID>'")])
    return '\n'.join(lines)


def format_channel(data, *, style=None):
    style = style or Style()
    selected = data.get('selected') or 'undeclared'
    declared = data.get('declared') or ''
    if data.get('override') and declared:
        return f'Release channel: {style.ok(selected)} {style.dim(f"(overrides declared {declared})")}'
    return f'Release channel: {style.ok(selected)}'


def format_automatic(data, *, style=None):
    style = style or Style()
    prep = style.ok('on') if data.get('prepare') else style.dim('off')
    conf = style.ok('on') if data.get('confirm') else style.dim('off')
    return '\n'.join([
        style.bold('Automatic updates'),
        f'  Background preparation   {prep}',
        f'  Restart confirmation     {conf}',
    ])


def format_hardware(data, *, style=None):
    style = style or Style()
    support = data.get('support') or {}
    config = data.get('configuration') or {}
    system = data.get('system') or {}
    cpu = data.get('cpu') or {}
    fw = data.get('firmware') or {}
    assessment = data.get('assessment') or {}

    name = support.get('profileName') or 'Generic PC'
    pid = support.get('profileId')
    status = support.get('status') or 'generic'
    identity = f'{name} ({pid})' if pid else name
    badge = style.ok(status) if status == 'qualified' else style.warn(status) if status == 'unsupported' else style.accent(status)

    lines = [f'{style.bold("Hardware:")} {identity} · {badge}']
    if support.get('summary'):
        lines.append('  ' + support['summary'])
    if config.get('summary'):
        lines.append('  ' + style.dim(config['summary']))
    if config.get('guidance'):
        lines.append('  ' + style.warn(config['guidance']))
    for limit in support.get('limitations') or []:
        lines.append('  ' + style.warn('• ' + limit))

    lines.append('')
    model = ' '.join(part for part in (system.get('sys_vendor'), system.get('product_name')) if part) or 'Unknown'
    bios = ' '.join(part for part in (system.get('bios_version'), system.get('bios_date')) if part)
    lines.append(f'  Model       {model}' + (f'  {style.dim("BIOS " + bios)}' if bios else ''))
    if cpu.get('model name'):
        lines.append(f'  CPU         {cpu["model name"]}')
    lines.append(f'  Kernel      {data.get("kernel", "unknown")} ({data.get("architecture", "")})')
    sb = fw.get('secureBoot')
    sb_text = 'enabled' if sb is True else 'disabled' if sb is False else 'unknown'
    lines.append(f'  Firmware    {"UEFI" if fw.get("uefi") else "BIOS"} · Secure Boot: {sb_text}')

    gpus = assessment.get('graphicsDevices') or []
    if gpus:
        desc = ', '.join(f'{g["vendor"]}:{g["device"]} ({g.get("driver") or "no driver"})' for g in gpus)
        lines.append(f'  Graphics    {desc}')
    nets = assessment.get('networkDevices') or []
    if nets:
        desc = ', '.join(
            f'{n["vendor"]}:{n["device"]} ({n.get("driver") or "no driver"})' for n in nets[:4]
        )
        lines.append(f'  Network     {desc}')
    disks = data.get('disks') or []
    if disks:
        desc = ', '.join(
            f'{d["name"]} ({human_bytes(d["sizeBytes"])}{" " + d["model"] if d.get("model") else ""})'
            for d in disks[:4]
        )
        lines.append(f'  Disks       {desc}')

    for issue in (assessment.get('blockers') or []) + (assessment.get('networkIssues') or []):
        lines.append('  ' + style.err('! ' + issue))

    lines.extend(['', style.dim('Detection does not verify that every feature works. Add --json for full inventory.')])
    return '\n'.join(lines)


def format_cleanup_status(data, *, style=None):
    style = style or Style()
    space = data.get('space') or {}
    pol = data.get('policy') or {}
    avail = human_bytes(space.get('available'))
    total = human_bytes(space.get('total'))
    free_text = style.warn(f'{avail} free of {total} (low disk space)') if space.get('low') else f'{avail} free of {total}'

    lines = [style.bold('Storage & cleanup')]
    lines.append(f'  Disk space     {free_text}')
    auto = style.ok('on') if pol.get('automatic') else style.dim('off')
    lines.append(
        f'  Policy         auto: {auto} · keep {pol.get("keepConfirmed", 5)} confirmed · {pol.get("keepDays", 30)} days'
    )
    if data.get('lastCleanup'):
        reclaimed = human_bytes(data.get('reclaimedBytes', 0))
        lines.append(f'  Last cleanup   {relative_time(data["lastCleanup"])} (freed {reclaimed})')
    if data.get('state') == 'ready' and data.get('estimatedBytes') is not None:
        cands = len(data.get('candidates') or [])
        lines.append(f'  Cleanable      {style.ok(human_bytes(data["estimatedBytes"]))} ({cands} old deployment{"s" if cands != 1 else ""})')
    if data.get('recoveryPending'):
        lines.append(style.warn("  Recovery       An interrupted cleanup awaits 'cybex cleanup resume'."))
    if data.get('error'):
        lines.append(style.err('  Error          ' + data['error']))
    lines.extend(['', style.dim("Run 'cybex cleanup' to preview and free space.")])
    return '\n'.join(lines)


def format_cleanup_preview(data, *, style=None):
    style = style or Style()
    est = data.get('estimatedBytes', 0)
    cands = data.get('candidates') or []
    pol = data.get('policy') or {}
    space = data.get('space') or {}
    lines = [style.bold('Storage cleanup preview')]
    lines.append(f'  Can free       {style.ok(human_bytes(est))} ({len(cands)} old deployment{"s" if len(cands) != 1 else ""})')
    if space.get('available') is not None:
        lines.append(f'  Current free   {human_bytes(space["available"])} of {human_bytes(space.get("total", 0))}')
    lines.append(
        f'  Keeping        at least {pol.get("keepConfirmed", 5)} confirmed deployments and {pol.get("keepDays", 30)} days of history'
    )
    return '\n'.join(lines)


def format_apps_list(nix_inv, flathub_state, *, show_all=False, style=None):
    style = style or Style()
    lines = []
    selected = nix_inv.get('desired') or nix_inv.get('selected') or []
    pkg_versions = {}
    for pkg in nix_inv.get('packages') or []:
        for attr in pkg.get('attributes') or []:
            pkg_versions[attr] = pkg.get('version', '')
        pkg_versions.setdefault(pkg.get('name', ''), pkg.get('version', ''))

    fh_installed = (flathub_state or {}).get('installed') or []

    if selected:
        lines.append(style.heading(f'Installed Nix apps ({len(selected)})'))
        rows = [[attr, pkg_versions.get(attr, ''), 'nix'] for attr in sorted(selected)]
        lines.extend(format_table(['APP', 'VERSION', 'SOURCE'], rows, style=style))
    else:
        lines.append(style.dim('No extra Nix apps installed yet.'))

    if fh_installed:
        if lines:
            lines.append('')
        lines.append(style.heading(f'Installed Flathub apps ({len(fh_installed)})'))
        rows = [[row.get('name', ''), row.get('id', ''), row.get('version', '')] for row in fh_installed]
        lines.extend(format_table(['NAME', 'ID', 'VERSION'], rows, style=style))

    if show_all:
        system_pkgs = [p for p in (nix_inv.get('packages') or []) if not (set(p.get('attributes') or []) & set(selected))]
        if system_pkgs:
            lines.extend(['', style.heading(f'Included system & personal packages ({len(system_pkgs)})')])
            rows = [[p.get('name', ''), p.get('version', ''), ', '.join(p.get('origins') or ['system'])] for p in system_pkgs[:60]]
            lines.extend(format_table(['PACKAGE', 'VERSION', 'OWNER'], rows, style=style))
            if len(system_pkgs) > 60:
                lines.append(style.dim(f'  … and {len(system_pkgs) - 60} more'))
    else:
        lines.extend(['', style.dim("Use 'cybex apps list --all' to include built-in Cybex OS packages.")])
    return '\n'.join(lines)


def format_apps_search(nix_rows, flathub_rows, query, *, flathub_note='', style=None):
    style = style or Style()
    lines = []
    if not nix_rows and not flathub_rows:
        msg = f'No apps matching "{query}".' if query else 'No apps found.'
        if flathub_note:
            return msg + '\n' + style.dim(flathub_note)
        return msg

    rows = []
    for item in nix_rows[:25]:
        status = 'installed' if item.get('installed') else ''
        desc = (item.get('description') or '')[:60]
        rows.append([item.get('attribute', ''), 'nix', item.get('version', ''), status, desc])
    for item in flathub_rows[:20]:
        status = 'installed' if item.get('installed') else ('unfree' if item.get('unavailable') else '')
        desc = (item.get('summary') or '')[:60]
        rows.append([item.get('id', ''), 'flathub', '', status, desc])

    lines.append(style.bold(f'Search results for "{query}"' if query else 'Available apps'))
    lines.append('')
    lines.extend(format_table(['ID / PACKAGE', 'SOURCE', 'VERSION', 'STATUS', 'SUMMARY'], rows, style=style))
    if flathub_note:
        lines.extend(['', style.dim(flathub_note)])
    lines.extend(['', style.dim("Install with: cybex apps install <ID or PACKAGE>")])
    return '\n'.join(lines)


def format_app_info(info, *, style=None):
    style = style or Style()
    source = info.get('source', 'nix')
    title = info.get('name') or info.get('id') or info.get('attribute', '')
    lines = [f'{style.bold(title)} {style.dim("(" + source + ")")}']
    if info.get('summary') or info.get('description'):
        summary = info.get('summary') or (info['description'][0] if isinstance(info.get('description'), list) and info['description'] else info.get('description', ''))
        if summary:
            lines.append('  ' + str(summary))
    lines.append('')
    if info.get('id'):
        lines.append(f'  ID          {info["id"]}')
    if info.get('attribute'):
        lines.append(f'  Package     {info["attribute"]}')
    if info.get('version'):
        lines.append(f'  Version     {info["version"]}')
    if info.get('developer'):
        lines.append(f'  Developer   {info["developer"]}')
    if info.get('license'):
        lines.append(f'  License     {info["license"]}')
    if info.get('downloadBytes'):
        lines.append(f'  Download    {human_bytes(info["downloadBytes"])}')
    if info.get('installed') is not None:
        inst = style.ok('yes') if info['installed'] else style.dim('no')
        lines.append(f'  Installed   {inst}')
    if info.get('permissions'):
        lines.append(f'  Sandbox     {", ".join(info["permissions"])}')
    if info.get('homepage'):
        lines.append(f'  Homepage    {info["homepage"]}')
    return '\n'.join(lines)


def format_flathub_updates(data, *, style=None):
    style = style or Style()
    items = data.get('updates') or []
    if not items:
        return style.ok('All Flathub apps are up to date.') + '\n' + style.dim("System apps update with 'cybex update'.")
    rows = [[row.get('name', ''), row.get('id', ''), f'{row.get("before", "")} → {row.get("after", "")}'] for row in items]
    lines = [style.bold(f'Flathub updates available ({len(items)})'), '']
    lines.extend(format_table(['NAME', 'ID', 'VERSION'], rows, style=style))
    lines.extend(['', style.dim("Run 'cybex apps update' to update Flathub apps.")])
    return '\n'.join(lines)


def format_region(data, *, style=None):
    style = style or Style()
    lines = [style.bold('Region settings')]
    lines.append(f'  Timezone   {data.get("timezone") or "unknown"}')
    lines.append(f'  Locale     {data.get("locale") or "unknown"}')
    lines.extend(['', style.dim("Change with: cybex region set --timezone <TZ> --locale <LOCALE>")])
    return '\n'.join(lines)


def format_shell_status(data, *, style=None):
    style = style or Style()
    safe = data.get('safe') is True
    active = data.get('active') is True
    mode = style.warn('safe mode (widgets paused)') if safe else style.ok('normal mode')
    state_note = ' · active' if active else ''
    lines = [f'{style.bold("Desktop shell:")} {mode}{state_note}']
    if data.get('reason'):
        lines.append(f'  Reason     {data["reason"]}')
    failures = data.get('failures') or []
    lines.append(f'  Crashes    {len(failures)} recent')
    if data.get('runtime'):
        lines.append(f'  Runtime    {style.dim(data["runtime"])}')
    if safe:
        lines.extend(['', style.dim("Run 'cybex shell recover' to retry the full desktop.")])
    return '\n'.join(lines)


def format_plugin_list(data, *, style=None):
    style = style or Style()
    plugins = data.get('plugins') or []
    if data.get('error'):
        return style.err('Plugin registry error: ' + str(data['error']))
    if not plugins:
        return style.dim("No plugins installed. Add one with 'cybex plugin add <URL>'.")
    rows = []
    for item in plugins:
        status = 'error' if item.get('error') else ('enabled' if item.get('enabled') else 'disabled')
        rows.append([
            item.get('id', ''),
            item.get('name', ''),
            status,
            item.get('section', '') or '-',
            item.get('format', ''),
        ])
    lines = [style.bold(f'Installed plugins ({len(plugins)})'), '']
    lines.extend(format_table(['ID', 'NAME', 'STATUS', 'SECTION', 'FORMAT'], rows, style=style))
    for item in plugins:
        if item.get('error'):
            lines.append(style.err(f'  ! {item.get("id")}: {item["error"]}'))
    return '\n'.join(lines)


def format_assistant_status(data, *, style=None):
    style = style or Style()
    available = data.get('available')
    agent = data.get('agent') or data.get('selectedAgent') or 'auto'
    lines = [f'{style.bold("Cybex OS Assistant (Wiz):")} {style.ok("running") if available is not False else style.warn("unavailable")}']
    lines.append(f'  Agent      {agent}')
    agents = data.get('agents')
    if isinstance(agents, dict):
        summary = ', '.join(
            f'{name} ({"ready" if isinstance(info, dict) and info.get("available") else "off"})'
            for name, info in agents.items()
        )
        if summary:
            lines.append(f'  Backends   {summary}')
    lines.extend(['', style.dim("Ask a question: cybex ask \"<question>\"")])
    return '\n'.join(lines)


def format_status_overview(data, *, style=None):
    style = style or Style()
    ver = data.get('version') or 'unknown'
    channel = data.get('channel') or ''
    nixos = data.get('nixos') or ''
    meta = ' · '.join(part for part in (channel, f'NixOS {nixos}' if nixos else '') if part)
    header = f'{style.bold(f"Cybex OS {ver}")}' + (f' {style.dim("(" + meta + ")")}' if meta else '')
    lines = [header, '']

    def row(label, text, hint=''):
        lines.append(f'  {style.heading(label.ljust(9))} {text}')
        if hint:
            lines.append(f'  {" " * 9} {style.dim("→ " + hint)}')

    upd = data.get('updates') or {}
    u_state = upd.get('state', 'unknown')
    if u_state == 'ready':
        avail = upd.get('availableVersion')
        msg = f'Ready to apply ({avail})' if avail else 'Prepared change ready to apply'
        row('Updates', style.ok(msg), 'run: cybex update')
    elif u_state == 'awaiting-boot':
        row('Updates', style.warn('Waiting for restart to finish update'))
    elif u_state == 'awaiting-login':
        row('Updates', style.warn('Boot confirmation pending'), 'run: cybex update confirm')
    elif u_state in ('discovering', 'building', 'validating', 'activating', 'firmware'):
        row('Updates', style.accent(upd.get('phase') or f'In progress ({u_state})'), 'run: cybex update status')
    elif u_state in ('failed', 'interrupted', 'recovery-failed'):
        row('Updates', style.err(f'Last update {u_state}'), 'run: cybex update status')
    elif u_state == 'unavailable':
        row('Updates', style.dim('Live environment (available after install)'))
    else:
        row('Updates', style.ok('No pending changes'), 'check: cybex update check')

    stor = data.get('storage') or {}
    if stor.get('available') is not None:
        free = human_bytes(stor['available'])
        parts = [style.warn(f'{free} free (low)') if stor.get('low') else f'{free} free']
        if stor.get('cleanable'):
            parts.append(style.warn(f'{human_bytes(stor["cleanable"])} cleanable'))
            hint = 'run: cybex cleanup'
        else:
            hint = ''
        row('Storage', ' · '.join(parts), hint)

    bkp = data.get('backup') or {}
    b_state = bkp.get('state', 'unconfigured')
    if b_state == 'ok':
        dest = f' ({bkp["destination"]})' if bkp.get('destination') else ''
        row('Backup', f'{style.ok(relative_time(bkp.get("lastTime")))}{style.dim(dest)}')
    elif b_state == 'overdue':
        row('Backup', style.warn(f'Last backup {relative_time(bkp.get("lastTime"))}'), 'run: cybex backup now')
    elif b_state == 'failed':
        row('Backup', style.err('Last backup failed'), 'run: cybex backup status')
    elif b_state == 'unconfirmed':
        row('Backup', style.warn('Recovery key not confirmed yet'), 'run: cybex backup confirm-key')
    elif b_state == 'configured':
        row('Backup', style.dim('Configured, no backups yet'), 'run: cybex backup now')
    else:
        row('Backup', style.dim('Not configured'), 'run: cybex backup setup --help')

    desk = data.get('desktop') or {}
    if desk.get('safeMode'):
        row('Desktop', style.warn('Safe mode (widgets paused)'), 'run: cybex shell recover')
    else:
        count = desk.get('enabledPlugins', 0)
        p_text = f'{count} plugin{"s" if count != 1 else ""} enabled'
        row('Desktop', f'{style.ok("Quickshell OK")} · {p_text}')
    if desk.get('theme'):
        row('Theme', desk['theme'])

    reg = data.get('region') or {}
    if reg.get('timezone') or reg.get('locale'):
        bits = [bit for bit in (reg.get('timezone'), reg.get('locale')) if bit]
        row('Region', ' · '.join(bits))

    return '\n'.join(lines)


class ProgressLine:
    """Single-line live progress indicator on a TTY; plain milestone lines otherwise."""

    def __init__(self, stream=None, *, style=None):
        self.stream = sys.stderr if stream is None else stream
        self.style = style or Style(self.stream)
        self.tty = hasattr(self.stream, 'isatty') and self.stream.isatty()
        self.frame = 0
        self.last_text = ''
        self.started = time.monotonic()

    def update(self, phase, progress=None):
        elapsed = int(time.monotonic() - self.started)
        label = phase or 'Working…'
        bar_text = ''
        if isinstance(progress, dict):
            dl = progress.get('downloads') or {}
            builds = progress.get('builds') or {}
            step = progress.get('step') or ''
            if dl.get('totalKnown') and dl.get('expectedBytes', 0) > 0 and step == 'downloading':
                ratio = min(1.0, max(0.0, dl.get('doneBytes', 0) / dl['expectedBytes']))
                filled = int(ratio * 18)
                bar = self.style.ok('█' * filled) + self.style.dim('░' * (18 - filled))
                pct = int(ratio * 100)
                bar_text = f'{bar} {pct:3d}%  {human_bytes(dl.get("doneBytes", 0))} / {human_bytes(dl["expectedBytes"])}'
            elif builds.get('expected', 0) > 0:
                ratio = min(1.0, max(0.0, builds.get('done', 0) / builds['expected']))
                filled = int(ratio * 18)
                bar = self.style.ok('█' * filled) + self.style.dim('░' * (18 - filled))
                bar_text = f'{bar} {builds.get("done", 0)}/{builds["expected"]} built'

        if self.tty:
            spin = self.style.accent(SPINNER[self.frame % len(SPINNER)])
            self.frame += 1
            body = f'{bar_text}  {label}' if bar_text else f'{spin} {label} ({elapsed}s)'
            self.stream.write('\r\033[K' + body)
            self.stream.flush()
        else:
            if label != self.last_text:
                self.stream.write(label + '\n')
                self.stream.flush()
                self.last_text = label

    def finish(self, message=''):
        if self.tty:
            self.stream.write('\r\033[K')
            if message:
                self.stream.write(message + '\n')
            self.stream.flush()
        elif message:
            self.stream.write(message + '\n')
            self.stream.flush()


def confirm_prompt(question, *, assume_yes=False):
    if assume_yes:
        return True
    if not sys.stdin.isatty():
        from .common import Failure
        raise Failure('Confirmation requires an interactive terminal (or pass --yes).')
    try:
        answer = input(f'{question} [y/N] ').strip().lower()
    except (EOFError, KeyboardInterrupt):
        print('', file=sys.stderr)
        return False
    return answer in ('y', 'yes')
