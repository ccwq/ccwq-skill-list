#!/usr/bin/env python3
"""Test-only fixture for an explicitly selected disposable-container account.

Not a package installer, account switcher, production installer or crash-recovery
engine. The parent supplies a trusted init source and installs dependencies. Run
as the existing nonroot HOME owner; never infer HOME from an elevated session.
Only .bashrc and .config/bash-completion-skill are touched, never profiles.
Identical reapply is a no-op; source changes require rollback first. Interrupted
multi-file operations leave private evidence and fail closed on the next run.
A cooperative lock and optimistic snapshots reject observed concurrent drift;
this is not a security boundary against a hostile process running as the owner.
The Python API's private _allow_root switch exists solely for temporary-HOME
unit tests; the CLI never exposes it. Requires local Unix Python and Bash.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import tempfile

BEGIN = b"# >>> bash-completion-skill container-lab >>>"
END = b"# <<< bash-completion-skill container-lab <<<"
BLOCK = (BEGIN + b'\nif [ -n "${BASH_VERSION-}" ]; then\n'
         b'    case $- in\n        *i*) . "$HOME/.config/bash-completion-skill/init.bash" ;;\n'
         b'    esac\nfi\n' + END + b'\n')


class Refused(RuntimeError):
    """A safety precondition failed; do not overwrite user changes."""


def digest(data):
    return hashlib.sha256(data).hexdigest()


def absolute(value):
    path = Path(value)
    if not path.is_absolute() or '..' in path.parts:
        raise Refused('an absolute path without parent traversal is required')
    return path


def safe_path(path):
    """Reject links in every existing ancestor, including dangling links."""
    for part in reversed((path, *path.parents)):
        try:
            info = part.lstat()
        except FileNotFoundError:
            continue
        if stat.S_ISLNK(info.st_mode):
            raise Refused('symlink path: ' + str(part))
        if part != path and not stat.S_ISDIR(info.st_mode):
            raise Refused('non-directory ancestor: ' + str(part))


def snapshot(path):
    safe_path(path)
    try:
        info = path.lstat()
    except FileNotFoundError:
        return None
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        raise Refused('expected an unlinked regular file: ' + str(path))
    if info.st_uid != os.getuid():
        raise Refused('file owner differs from current UID: ' + str(path))
    data = path.read_bytes()
    after = path.lstat()
    key = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns,
                     s.st_ctime_ns, stat.S_IMODE(s.st_mode), s.st_uid)
    if key(info) != key(after):
        raise Refused('concurrent read drift: ' + str(path))
    return (data, stat.S_IMODE(info.st_mode), key(info))


def unchanged(path, expected):
    if snapshot(path) != expected:
        raise Refused('concurrent drift: ' + str(path))


def record(snap):
    return None if snap is None else {'sha256': digest(snap[0]), 'mode': snap[1]}


def atomic(path, data, mode, expected):
    safe_path(path.parent)
    fd, name = tempfile.mkstemp(prefix='.fixture-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as out:
            os.fchmod(out.fileno(), mode)
            out.write(data)
            out.flush()
            os.fsync(out.fileno())
        unchanged(path, expected)
        os.replace(name, path)
    finally:
        if os.path.lexists(name):
            os.unlink(name)


def validate_markers(data, managed=False):
    # Partial, reordered, duplicated and edited marker lines all fail closed.
    lines = data.splitlines()
    related = [line for line in lines
               if b'bash-completion-skill container-lab' in line
               or b'>>> bash-completion-skill' in line
               or b'<<< bash-completion-skill' in line]
    if not managed:
        if related:
            raise Refused('pre-existing or malformed managed markers')
    elif related != [BEGIN, END] or data.count(BLOCK) != 1:
        raise Refused('malformed or duplicate managed block')


def syntax(data, label):
    bash = shutil.which('bash')
    if not bash:
        raise Refused('local bash is required for syntax validation')
    env = dict(os.environ)
    for key in ('BASH_ENV', 'ENV', 'SHELLOPTS', 'BASHOPTS'):
        env.pop(key, None)
    result = subprocess.run([bash, '--noprofile', '--norc', '-n'], input=data,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            env=env, check=False)
    if result.returncode:
        raise Refused('bash -n rejected ' + label)


def owned_directory(path, private=False):
    safe_path(path)
    info = path.stat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid():
        raise Refused('directory must belong to current UID: ' + str(path))
    mode = stat.S_IMODE(info.st_mode)
    if mode & 0o022 or (private and mode != 0o700):
        raise Refused('unsafe directory permissions: ' + str(path))


def configure(home, init_source, action, *, _allow_root=False):
    if os.name != 'posix' or not hasattr(os, 'getuid'):
        raise Refused('unsupported: this fixture requires Unix UID semantics')
    if os.getuid() != os.geteuid() or (os.getuid() == 0 and not _allow_root):
        raise Refused('run as the existing nonroot target account')
    if action not in ('apply', 'rollback'):
        raise Refused('unknown action')
    home, source = absolute(home), absolute(init_source)
    owned_directory(home)
    # Source path is explicit even on rollback, but rollback needs no source file.
    safe_path(source)
    config = home / '.config'
    base = config / 'bash-completion-skill'
    state = base / 'state'
    rc, init = home / '.bashrc', base / 'init.bash'
    manifest, backup = state / 'manifest.json', state / 'bashrc.backup'
    lock = home / '.bash-completion-skill-container-lab.lock'
    safe_path(lock)
    try:
        lock.mkdir(mode=0o700)
    except FileExistsError:
        raise Refused('another operation or stale lock exists') from None
    try:
        for directory in (config, base, state):
            safe_path(directory)
            if directory.exists():
                owned_directory(directory, private=(directory == state))
        old_rc, old_init = snapshot(rc), snapshot(init)
        old_manifest, old_backup = snapshot(manifest), snapshot(backup)
        if old_manifest is not None:
            if {entry.name for entry in state.iterdir()} != {'manifest.json', 'bashrc.backup'}:
                raise Refused('unexpected private state contents')
            if old_manifest[1] != 0o600 or old_backup is None or old_backup[1] != 0o600:
                raise Refused('unsafe manifest or backup mode')
            try:
                meta = json.loads(old_manifest[0])
                valid = (meta['version'] == 1 and meta['home'] == str(home)
                         and meta['uid'] == os.getuid()
                         and meta['bashrc'] == record(old_rc)
                         and meta['init'] == record(old_init)
                         and meta['backup_sha256'] == digest(old_backup[0])
                         and type(meta['original_mode']) is int
                         and 0 <= meta['original_mode'] <= 0o777
                         and type(meta['original_exists']) is bool)
            except (ValueError, KeyError, TypeError):
                valid = False
            if not valid or old_rc is None or old_init is None:
                raise Refused('managed files differ from manifest')
            validate_markers(old_rc[0], managed=True)
            original = old_backup[0]
            expected_rc = original + (b'\n' if original and not original.endswith(b'\n') else b'') + BLOCK
            if old_rc[0] != expected_rc:
                raise Refused('backup does not describe the installed bashrc')
            if action == 'apply':
                incoming = snapshot(source)
                if incoming is None or incoming[0] != old_init[0]:
                    raise Refused('changed source; rollback before replacing init')
                for path, snap in ((source, incoming), (rc, old_rc), (init, old_init),
                                   (manifest, old_manifest), (backup, old_backup)):
                    unchanged(path, snap)
                return 'unchanged'
            syntax(original, 'rollback bashrc')
            for path, snap in ((rc, old_rc), (init, old_init),
                               (manifest, old_manifest), (backup, old_backup)):
                unchanged(path, snap)
            if meta['original_exists']:
                atomic(rc, original, meta['original_mode'], old_rc)
            else:
                unchanged(rc, old_rc)
                rc.unlink()
            for path, snap in ((init, old_init), (manifest, old_manifest), (backup, old_backup)):
                unchanged(path, snap)
                path.unlink()
            state.rmdir()
            return 'rolled back'
        if action == 'rollback':
            raise Refused('no valid manifest to roll back')
        if old_init is not None or old_backup is not None or state.exists():
            raise Refused('prior init or incomplete state conflicts with installation')
        original = b'' if old_rc is None else old_rc[0]
        mode = 0o644 if old_rc is None else old_rc[1]
        if mode & ~0o777:
            raise Refused('special bashrc permission bits are unsupported')
        validate_markers(original)
        incoming = snapshot(source)
        if incoming is None:
            raise Refused('init source does not exist')
        candidate = original + (b'\n' if original and not original.endswith(b'\n') else b'') + BLOCK
        syntax(incoming[0], 'init source')
        syntax(candidate, 'candidate bashrc')
        for path, snap in ((rc, old_rc), (init, old_init), (source, incoming),
                           (manifest, old_manifest), (backup, old_backup)):
            unchanged(path, snap)
        for directory in (config, base, state):
            if not directory.exists():
                directory.mkdir(mode=0o700)
                # mkdir inherits setgid from some distro-created homes. Only
                # normalize directories created by this operation, never existing ones.
                directory.chmod(0o700)
            owned_directory(directory, private=(directory == state))
        atomic(backup, original, 0o600, None)
        atomic(init, incoming[0], 0o600, None)
        meta = {'version': 1, 'home': str(home), 'uid': os.getuid(),
                'original_exists': old_rc is not None, 'original_mode': mode,
                'backup_sha256': digest(original),
                'bashrc': {'sha256': digest(candidate), 'mode': mode},
                'init': {'sha256': digest(incoming[0]), 'mode': 0o600}}
        atomic(manifest, (json.dumps(meta, sort_keys=True) + '\n').encode(), 0o600, None)
        atomic(rc, candidate, mode, old_rc)
        return 'applied'
    finally:
        lock.rmdir()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--home', required=True)
    parser.add_argument('--init-source', required=True)
    parser.add_argument('--action', required=True, choices=('apply', 'rollback'))
    args = parser.parse_args(argv)
    try:
        print(configure(args.home, args.init_source, args.action))
    except (Refused, OSError) as error:
        parser.exit(1, 'refused: ' + str(error) + '\n')


if __name__ == '__main__':
    main()
