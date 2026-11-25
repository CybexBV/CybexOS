"""Lock ownership: upstream, vendor graph, and unrelated personal inputs."""
import re
from .common import Failure
from .trust import FORMER_REPOS, REPO


def root_inputs(lock):
    return lock['nodes'][lock['root']]['inputs']


def resolved(lock, name):
    value = root_inputs(lock)[name]
    if not isinstance(value, str):
        raise Failure(f'{name} must be an independently locked root input')
    return lock['nodes'][value]


def branch_order(ref):
    """Where a supported NixOS branch sits in Cybex OS's history, or None.

    nixos-unstable comes first (Cybex OS followed it until NixOS 26.11), then
    the stable branches from 26.11 on in release order. Machines only ever
    move forward in this order.
    """
    if ref == 'nixos-unstable':
        return (0, 0)
    match = re.fullmatch(r'nixos-([0-9]{2})\.(05|11)', ref) if isinstance(ref, str) else None
    if not match or (int(match[1]), int(match[2])) < (26, 11):
        return None
    return (int(match[1]), int(match[2]))


def supported_branch(ref):
    """nixos-unstable, or a stable NixOS branch from 26.11 on (nixos-YY.MM)."""
    return branch_order(ref) is not None


def release_name(ref):
    """A branch's short name, as release/compatibility.json lists it: "unstable" or "26.11"."""
    if not supported_branch(ref):
        raise Failure(f'Unsupported NixOS branch: {ref}')
    return ref.removeprefix('nixos-')


def validate_machine(lock):
    upstream, vendor = resolved(lock, 'nixpkgs'), resolved(lock, 'cybexos')
    original = upstream['original']
    if (set(original) != {'type', 'owner', 'repo', 'ref'} or original.get('type') != 'github'
            or original.get('owner') != 'NixOS' or original.get('repo') != 'nixpkgs'
            or not supported_branch(original.get('ref'))):
        raise Failure('Upstream must follow nixos-unstable or a stable NixOS branch that Cybex OS supports.')
    if vendor['inputs'].get('nixpkgs') != ['nixpkgs']:
        raise Failure('Cybex OS must follow the machine nixpkgs input')
    selected = vendor.get('locked', {})
    origin = vendor.get('original', {})
    if selected.get('type') == 'github':
        names = {tuple(name.split('/')) for name in (REPO, *FORMER_REPOS)}
        if (origin.get('type') != 'github' or (origin.get('owner'), origin.get('repo')) not in names
                or set(origin) != {'type', 'owner', 'repo', 'rev'}
                or (selected.get('owner'), selected.get('repo')) != (origin.get('owner'), origin.get('repo'))
                or not re.fullmatch('[0-9a-f]{40}', origin.get('rev', ''))
                or selected.get('rev') != origin['rev']
                or not re.fullmatch(r'sha256-[A-Za-z0-9+/]{43}=', selected.get('narHash', ''))):
            raise Failure('Cybex OS must be pinned to an exact release revision and content identity')
    elif selected.get('type') != 'path' or not selected.get('narHash'):
        raise Failure('Unsupported vendor source; development paths must be content addressed')
    nixpkgs_nodes = [v for v in lock['nodes'].values() if v.get('locked', {}).get('repo') == 'nixpkgs']
    if len(nixpkgs_nodes) != 1:
        raise Failure('Duplicate Nixpkgs inputs are prohibited; personal dependencies must follow machine nixpkgs.')


def identity(lock, name):
    node = resolved(lock, name)
    return node['locked']


def graph(lock, name):
    """Names and content under an input, leaving follows references external."""
    result = {}
    def visit(node):
        if node in result:
            return
        result[node] = lock['nodes'][node]
        for child in result[node].get('inputs', {}).values():
            if isinstance(child, str):
                visit(child)
    visit(root_inputs(lock)[name])
    return result


def unchanged_graph(old, new, name):
    # Nix may rename a graph's node IDs; compare its structural identities.
    def normalize(lock, value):
        if isinstance(value, list):
            return {'follows': value}
        node = lock['nodes'][value]
        return {k: v for k, v in node.items() if k != 'inputs'} | {
            'inputs': {k: normalize(lock, v) for k, v in node.get('inputs', {}).items()}}
    return normalize(old, root_inputs(old)[name]) == normalize(new, root_inputs(new)[name])


def validate_delta(old, new, scope):
    validate_machine(new)
    if set(root_inputs(old)) != set(root_inputs(new)):
        raise Failure('Update changed the set of personal inputs')
    allowed = {'upstream': {'nixpkgs'}, 'cybexos': {'cybexos'}, 'both': {'nixpkgs', 'cybexos'}, 'local': set()}[scope]
    for name in root_inputs(old):
        if name not in allowed and not unchanged_graph(old, new, name):
            raise Failure(f'Update unexpectedly refreshed {name}; staged configuration rejected')


def pin(value):
    """The Nixpkgs revision a release was checked with.

    `value` is a release's own flake.lock or release.json's "nixpkgs"
    (nix/modules/default.nix). Machines move their Nixpkgs only to such a
    revision, so every update builds a combination Cybex OS already built.
    """
    try:
        if 'nodes' in value:
            node = value['nodes'][value['nodes'][value['root']]['inputs']['nixpkgs']]
            locked, original = node['locked'], node['original']
            if (locked.get('type'), locked.get('owner'), locked.get('repo')) != ('github', 'NixOS', 'nixpkgs'):
                raise ValueError('Not a NixOS/nixpkgs revision')
            value = {name: locked.get(name) for name in ('rev', 'narHash', 'lastModified')} | {'ref': original.get('ref')}
        result = {name: value[name] for name in ('rev', 'narHash', 'lastModified', 'ref')}
    except (KeyError, TypeError, ValueError, AttributeError) as error:
        raise Failure('The release names no valid Nixpkgs revision') from error
    if (not isinstance(result['rev'], str) or not re.fullmatch('[0-9a-f]{40}', result['rev'])
            or not isinstance(result['narHash'], str)
            or not re.fullmatch(r'sha256-[A-Za-z0-9+/]{43}=', result['narHash'])
            or type(result['lastModified']) is not int or result['lastModified'] <= 0
            or not supported_branch(result['ref'])):
        raise Failure('The release names no valid Nixpkgs revision')
    return result


def newer(pinned, lock):
    """Whether the machine lock's Nixpkgs moves to `pinned`. Never back.

    A later revision on the same branch moves it. A release on a later
    branch (branch_order: nixos-unstable, then nixos-26.11, nixos-27.05, ...)
    moves it to that branch's revision, whatever the commit dates: the move to
    a stable release is qualified as its own release. A release on an earlier
    branch never moves it back.
    """
    current = identity(lock, 'nixpkgs')
    modified = current.get('lastModified')
    if type(modified) is not int or modified <= 0:
        # Without the machine's own date nothing proves the release's is later.
        return False
    branch = resolved(lock, 'nixpkgs')['original'].get('ref')
    if pinned['ref'] != branch:
        target, installed = branch_order(pinned['ref']), branch_order(branch)
        # A stable branch's commits can be dated before the machine's
        # unstable revision, so only the branch order decides.
        return target is not None and installed is not None and target > installed
    return pinned['rev'] != current.get('rev') and pinned['lastModified'] > modified


def take(lock, pinned):
    """The machine lock with its Nixpkgs moved to a release's revision."""
    node = lock['nodes'][root_inputs(lock)['nixpkgs']]
    node['locked'] = {'type': 'github', 'owner': 'NixOS', 'repo': 'nixpkgs', 'rev': pinned['rev'],
                      'narHash': pinned['narHash'], 'lastModified': pinned['lastModified']}
    node['original'] = {'type': 'github', 'owner': 'NixOS', 'repo': 'nixpkgs', 'ref': pinned['ref']}
    return lock
