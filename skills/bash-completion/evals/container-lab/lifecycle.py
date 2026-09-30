"""Disposable container lifecycle regression; run as configured nonroot user.
Uses sibling configure.py and skill PTY verifier, no packages or connections.
"""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile


def load(path):
    spec = importlib.util.spec_from_file_location('lab_verify', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    import argparse
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--verifier', required=True)
    p.add_argument('--init-source', required=True)
    args = p.parse_args()
    from configure import absolute, owned_directory, snapshot, Refused
    if os.name != 'posix' or os.getuid() == 0 or os.getuid() != os.geteuid():
        raise Refused('run as a disposable nonroot account')
    home = absolute(os.environ['HOME'])
    owned_directory(home)
    state = home / '.config/bash-completion-skill/state'
    owned_directory(state, private=True)
    for path in (home / '.bashrc', state / 'manifest.json', state / 'bashrc.backup', state.parent / 'init.bash'):
        if snapshot(path) is None:
            raise Refused('apply configuration before lifecycle test')
    v = load(args.verifier)
    checks = {}
    with tempfile.TemporaryDirectory(prefix='bash-lifecycle-') as directory:
        session = v.PtySession('/bin/bash', True, Path(directory), 30)
        try:
            v.prepare(session)
            session.send(b'lab_path=$PATH; lab_prompt=$(declare -p PROMPT_COMMAND 2>/dev/null); source "$HOME/.config/bash-completion-skill/init.bash"; source "$HOME/.config/bash-completion-skill/init.bash"\n')
            session.barrier()
            checks['repeat_source_no_duplicate_path_or_hook'] = session.fixed_check('[[ $PATH == "$lab_path" && $(declare -p PROMPT_COMMAND 2>/dev/null) == "$lab_prompt" ]]')
            checks['cd_not_wrapped'] = session.fixed_check('[[ $(type -t cd) == builtin ]]')
            session.send(b'mkdir -p "$PTY_VERIFY_CWD/zjump_unique"; zoxide add "$PTY_VERIFY_CWD/zjump_unique"; z zjump_unique\n')
            session.barrier()
            checks['zoxide_jump'] = session.fixed_check('[[ $PWD == "$PTY_VERIFY_CWD/zjump_unique" ]]')
        finally:
            session.close()
    noninteractive = {}
    for mode in ('-c', '-lc'):
        r = subprocess.run(['/bin/bash', mode, 'printf noninteractive_ok'], capture_output=True)
        noninteractive[mode] = (r.returncode, r.stdout, r.stderr)
    state = home / '.config/bash-completion-skill/state'
    original = (state / 'bashrc.backup').read_bytes()
    original_exists = json.loads((state / 'manifest.json').read_text())['original_exists']
    rc = home / '.bashrc'
    applied = rc.read_bytes()
    command = ['python3', '-B', str(Path(__file__).with_name('configure.py')), '--home', str(home), '--init-source', args.init_source, '--action', 'rollback']
    rc.write_bytes(applied + b'\n# simulated later user edit\n')
    r = subprocess.run(command, capture_output=True)
    checks['rollback_refuses_later_edit'] = r.returncode != 0 and rc.read_bytes() == applied + b'\n# simulated later user edit\n'
    if not checks['rollback_refuses_later_edit']:
        print(json.dumps(checks, sort_keys=True))
        return 1  # preserve unexpected state for inspection; never overwrite it
    rc.write_bytes(applied)  # restore only the verified controlled edit in this disposable account
    r = subprocess.run(command, capture_output=True)
    restored = (rc.is_file() and rc.read_bytes() == original) if original_exists else not rc.exists()
    checks['rollback_restores_exact_bytes'] = r.returncode == 0 and restored
    checks['rollback_removes_managed_init'] = not (state.parent / 'init.bash').exists()
    for mode, installed in noninteractive.items():
        baseline = subprocess.run(['/bin/bash', mode, 'printf noninteractive_ok'], capture_output=True)
        checks['noninteractive_unchanged_' + mode] = installed == (baseline.returncode, baseline.stdout, baseline.stderr) and baseline.returncode == 0 and baseline.stdout.endswith(b'noninteractive_ok')
    print(json.dumps(checks, sort_keys=True))
    return 0 if all(checks.values()) else 1

if __name__ == '__main__':
    raise SystemExit(main())
