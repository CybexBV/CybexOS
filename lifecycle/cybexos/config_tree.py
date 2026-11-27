"""Staged configuration copying, content digests and Git metadata preservation."""
import configparser
import hashlib
import os
from pathlib import Path
import shutil
import sys
from tempfile import TemporaryDirectory
import uuid

from .common import Failure, atomic, link, read, syncdir


def _syncdir(path):
    """Look up syncdir via cybexos.engine so tests patching engine.syncdir intercept config copies too."""
    engine = sys.modules.get('cybexos.engine')
    return (getattr(engine, 'syncdir', syncdir) if engine is not None else syncdir)(path)

# The login screen: its unit, configuration and authentication (including the
# encryption-gated automatic login). Activation does not restart it, so only a
# boot shows that a changed one still works.
LOGIN_SCREEN = (
    'etc/systemd/system/display-manager.service',
    'etc/sddm.conf.d',
    'etc/pam.d/login',
    'etc/pam.d/sddm',
    'etc/pam.d/sddm-autologin',
    'etc/pam.d/sddm-greeter',
)


def configuration_paths(source):
    # Repository bookkeeping is not part of the selected Nix configuration.
    # Copying and review identities must apply precisely the same exclusion.
    source = Path(source)

    def unreadable(error):
        raise error

    for directory, folders, files in os.walk(source, onerror=unreadable):
        # Prune before descending: a personal repository's object database can
        # dwarf its actual configuration, and identities are checked repeatedly.
        folders[:] = [name for name in folders if name != '.git']
        for name in folders + files:
            if name != '.git':
                yield Path(directory) / name


def copy_config(source, target):
    source = Path(source).resolve()
    target = Path(target)
    for path in configuration_paths(source):
        if path.is_symlink() or (not path.is_file() and not path.is_dir()):
            raise Failure('Configuration contains a link or special file. Use runtime secret paths and plain local modules.')
        if path.is_file():
            if path.stat().st_size > 8 * 1024 * 1024:
                raise Failure('Configuration contains a large state file. Keep state and secrets outside the flake.')
            if b'PRIVATE KEY-----' in path.read_bytes():
                raise Failure('Private key found in configuration. Move it to /var/lib/cybexos/secrets before staging.')
    if target.exists() or target.is_symlink():
        raise FileExistsError(f'Configuration copy target already exists: {target}')
    # Recovery uses the presence of a retained configuration as its completion
    # boundary. Never publish a partial backup or working selection on failure.
    target.parent.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(prefix='.copy-config-', dir=target.parent) as directory:
        staged = Path(directory) / 'config'
        shutil.copytree(source, staged, ignore=shutil.ignore_patterns('.git'))
        paths = [staged, *staged.rglob('*')]
        for path in paths:
            # NAR identities distinguish executable files. Personal package/service
            # sources must keep that behavior when their staged tree is selected.
            executable = path.is_file() and bool(path.stat().st_mode & 0o111)
            path.chmod(0o755 if path.is_dir() or executable else 0o644)
            if path.is_file():
                with path.open('rb') as stream:
                    os.fsync(stream.fileno())
        for path in reversed(paths):
            if path.is_dir():
                _syncdir(path)
        os.rename(staged, target)
        _syncdir(target.parent)


def boot_path(system):
    """What starting the computer and logging in use beyond activation and health.

    The kernel, its modules, early-boot image and boot options, the login
    screen, and the session script it starts, compared by content: its
    desktop-environment wrapper names each release's packages, the script
    itself does not. Modules count because the running kernel keeps the ones
    it loaded: a new NVIDIA driver's libraries need its new module, which only
    a boot loads.
    """
    system = Path(system)
    modules = system / 'kernel-modules'

    def content(path):
        if path.is_dir():
            return {child.name: content(child) for child in sorted(path.iterdir())}
        return path.read_bytes() if path.exists() else None

    session = Path(os.path.realpath(system / 'sw/bin/cybexos-session'))
    script = session.with_name('.cybexos-session-wrapped')
    return [
        os.path.realpath(system / 'kernel'),
        os.path.realpath(system / 'initrd'),
        os.path.realpath(modules) if modules.exists() else None,
        content(system / 'kernel-params'),
        *(content(system / name) for name in LOGIN_SCREEN),
        content(script if script.exists() else session),
    ]


def config_digest(path):
    h = hashlib.sha256()
    for p in sorted(configuration_paths(path)):
        if p.is_symlink() or (not p.is_file() and not p.is_dir()):
            raise Failure('Configuration contains a link or special file. Use runtime secret paths and plain local modules.')
        relative = str(p.relative_to(path)).encode()
        h.update(len(relative).to_bytes(8, 'big') + relative)
        if p.is_file():
            h.update(b'x' if p.stat().st_mode & 0o111 else b'f')
            with p.open('rb') as stream:
                size = os.fstat(stream.fileno()).st_size
                h.update(size.to_bytes(8, 'big'))
                consumed = 0
                while data := stream.read(1024 * 1024):
                    consumed += len(data)
                    h.update(data)
                if consumed != size:
                    raise Failure('Personal configuration changed while its identity was being checked. Stage again.')
        elif p.is_dir():
            h.update(b'd')
    return h.hexdigest()


class ConfigTreeMixin:
    """Working-configuration selection and authenticated Git metadata links."""

    def git_metadata_record(self, root):
        key = hashlib.sha256(str(Path(root).resolve()).encode()).hexdigest()
        return self.state / 'configuration-git' / (key + '.json')

    def git_metadata(self, source):
        """Reference persistent Git data without archiving it or invoking Git."""
        root = Path(source).resolve()
        declaration = read(self.git_metadata_record(root), {})
        managed = declaration.get('references', {}) if declaration.get('root') == str(root) else {}
        references = {}
        for metadata in root.rglob('.git'):
            relative = str(metadata.relative_to(root))
            if '.git' in metadata.relative_to(root).parts[:-1]:
                continue
            target = metadata
            if metadata.is_symlink():
                expected = managed.get(relative)
                if not expected or str(metadata.readlink()) != expected:
                    raise Failure('Unmanaged .git symlink cannot be preserved safely. Keep a regular Git metadata directory or use a separate personal repository; no configuration was selected.')
                target = Path(expected)
            if target.is_symlink() or not target.is_dir() or (target / 'commondir').exists():
                raise Failure('Linked-worktree or pointer-file .git layout cannot be preserved safely. Keep a regular Git metadata directory or use a separate personal repository; no configuration was selected.')
            # An explicit Git worktree override would keep directing Git at the
            # old physical tree after selection. Do not rewrite user metadata.
            try:
                settings = configparser.RawConfigParser(strict=False)
                settings.read(target / 'config')
            except configparser.Error as error:
                raise Failure('Git metadata configuration cannot be safely preserved. Use a regular Git repository without worktree overrides; no configuration was selected.') from error
            if any(settings.has_option(section, 'worktree') for section in settings.sections() if section.lower() == 'core'):
                raise Failure('Git core.worktree overrides cannot be preserved safely. Use a regular Git repository without worktree overrides; no configuration was selected.')
            if any(section.lower() == 'include' or section.lower().startswith('includeif ') for section in settings.sections()):
                raise Failure('Git included configuration may override the worktree and cannot be preserved safely. Use a regular Git repository without configuration includes or a separate personal repository; no configuration was selected.')
            references[relative] = str(target.resolve())
        return references

    def select_config(self, source, identifier, fresh=False):
        references = self.git_metadata(self.working)
        working = self.state / 'working' / identifier
        working.parent.mkdir(exist_ok=True, mode=0o755)
        if working.exists() and fresh:
            # Repeated rollback must select the exact retained configuration,
            # while keeping edits made in an earlier working selection intact.
            working = working.with_name(identifier + '-' + uuid.uuid4().hex)
        if working.exists() and config_digest(working) != config_digest(source):
            raise Failure('An existing working selection was edited. Stage a new deployment; its files were preserved.')
        if not working.exists():
            copy_config(source, working)
        if not self.working.is_symlink():
            raise Failure('/etc/nixos must be the installer-owned working-configuration symlink')
        existing = self.git_metadata(working)
        if existing and existing != references:
            raise Failure('An existing working selection contains different Git metadata. Stage a new deployment; its repository was preserved.')
        # The declaration authenticates only the updater's internal references;
        # ordinary personal links elsewhere in configuration remain prohibited.
        atomic(self.git_metadata_record(working), {'root': str(working), 'references': references})
        for relative, target in references.items():
            metadata = working / relative
            if metadata.parent.is_dir() and not metadata.exists() and not metadata.is_symlink():
                link(target, metadata)
        link(working, self.working)
