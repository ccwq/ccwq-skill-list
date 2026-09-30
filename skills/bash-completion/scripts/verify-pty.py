#!/usr/bin/env python3
"""Standard-library bounded PTY checks. stdout contains JSON, never screen text.

--user-config executes bash -il (no -c) with real HOME. This is NOT a sandbox:
startup hooks can write files, ignore isolation variables, or launch programs.
Clean mode skips profiles/rc and uses temporary HOME/XDG directories.
"""
from __future__ import annotations
import argparse
import errno
import json
import math
import os
from pathlib import Path
import re
import secrets
import shutil
import signal
import tempfile
import time

TESTS = ('readiness', 'tab', 'fzf-history', 'fzf-files', 'fzf-dirs', 'ble')
OUTPUT_LIMIT = 1024 * 1024
STRINGS = re.compile(rb'\x1b(?:\][^\x07\x1b]*(?:\x07|\x1b\\)|[PX^_].*?\x1b\\)', re.S)
CSI = re.compile(rb'\x1b\[[0-?]*[ -/]*[@-~]')
ESC = re.compile(rb'\x1b(?:[()][0-2A-Z]|[@-_])')


def visible(data):
    """Control stripping for evidence, not a full visual terminal emulator."""
    data = STRINGS.sub(b'', data)
    data = re.split(rb'\x1b[\]PX^_]', data, maxsplit=1)[0]
    return ESC.sub(b'', CSI.sub(b'', data)).replace(b'\r', b'\n')


def has_line(data, token):
    return token.encode('ascii') in visible(data).splitlines()


def marker_command(token):
    if not re.fullmatch(r'[A-Za-z0-9_]+', token):
        raise ValueError('unsafe marker')
    middle = len(token) // 2
    # Never include the entire output token in echoed input.
    return ("builtin printf '\\n%s%s\\n' '" + token[:middle] + "' '" + token[middle:] + "'\n").encode()


class ProbeError(Exception):
    def __init__(self, reason):
        super().__init__(reason)
        self.reason = reason


def isolated_env(root, user_config):
    env = {k: v for k, v in os.environ.items() if not k.startswith('BASH_FUNC_') and k not in
           ('BASH_ENV', 'ENV', 'PROMPT_COMMAND', 'SHELLOPTS', 'BASHOPTS')}
    for name in ('home', 'config', 'cache', 'state', 'data', 'runtime', 'zoxide', 'cwd'):
        (root / name).mkdir(mode=0o700, exist_ok=True)
    for key, name in (('XDG_CONFIG_HOME', 'config'), ('XDG_CACHE_HOME', 'cache'),
                      ('XDG_STATE_HOME', 'state'), ('XDG_DATA_HOME', 'data'), ('XDG_RUNTIME_DIR', 'runtime')):
        env[key] = str(root / name)
    if not user_config:
        env.update(HOME=str(root / 'home'), INPUTRC='/dev/null')
    env.update(TERM='xterm-256color', HISTFILE='/dev/null', _ZO_DATA_DIR=str(root / 'zoxide'),
               PTY_VERIFY_CWD=str(root / 'cwd'), PS1='pty> ', PS2='pty+ ')
    return env


class PtySession:
    """Each instance owns a new controlling PTY and session/process group."""
    def __init__(self, shell, user_config, root, timeout):
        import fcntl
        import pty
        import struct
        import termios
        self.deadline = time.monotonic() + timeout
        self.data = bytearray()
        self.dsr_tail = b''
        self.dsr_replies = 0
        self.closed = False
        self.pid = self.fd = None
        env = isolated_env(root, user_config)
        argv = [shell, '-il'] if user_config else [shell, '--noprofile', '--norc', '-i']
        pid, fd = pty.fork()
        if pid == 0:
            try:
                os.chdir(root / 'cwd')
                fcntl.ioctl(0, termios.TIOCSWINSZ, struct.pack('HHHH', 32, 120, 0, 0))
                os.execve(shell, argv, env)
            except BaseException:
                os._exit(127)
        self.pid, self.fd = pid, fd
        try:
            os.set_blocking(fd, False)
            fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 32, 120, 0, 0))
        except BaseException:
            self.close()
            raise

    def send(self, value):
        import select
        remaining = memoryview(value)
        while remaining:
            if time.monotonic() >= self.deadline:
                raise ProbeError('timeout')
            try:
                remaining = remaining[os.write(self.fd, remaining):]
            except BlockingIOError:
                select.select([], [self.fd], [], min(0.05, max(0, self.deadline - time.monotonic())))
            except OSError:
                raise ProbeError('pty_closed') from None

    def _ingest(self, block):
        if len(self.data) + len(block) > OUTPUT_LIMIT:
            raise ProbeError('output_limit')
        self.data.extend(block)
        pending = self.dsr_tail + block
        for match in re.finditer(rb'\x1b\[(\??)([56])n', pending):
            private, kind = match.groups()
            self.send(b'\x1b[' + private + (b'1;1R' if kind == b'6' else b'0n'))
            self.dsr_replies += 1
        tail = re.search(rb'\x1b(?:\[(?:\??[56]?)?)?$', pending)
        self.dsr_tail = tail.group() if tail else b''

    def expect(self, predicate, start=0):
        import select
        while True:
            if predicate(bytes(self.data[start:])):
                return
            remaining = self.deadline - time.monotonic()
            if remaining <= 0:
                raise ProbeError('timeout')
            ready, _, _ = select.select([self.fd], [], [], remaining)
            if not ready:
                raise ProbeError('timeout')
            try:
                block = os.read(self.fd, 16384)
            except BlockingIOError:
                continue
            except OSError as exc:
                if exc.errno == errno.EIO:
                    raise ProbeError('pty_closed') from None
                raise
            if not block:
                raise ProbeError('pty_closed')
            self._ingest(block)

    def barrier(self, retry=False):
        token = 'PTY_' + secrets.token_hex(20)
        start = len(self.data)
        deadline = self.deadline
        try:
            while True:
                self.deadline = min(deadline, time.monotonic() + 1.0) if retry else deadline
                self.send(marker_command(token))
                try:
                    self.expect(lambda data: has_line(data, token), start)
                    prompt = getattr(self, 'prompt_token', None)
                    if prompt:
                        def prompt_after_ack(data):
                            text = visible(data)
                            at = text.find(token.encode())
                            return at >= 0 and prompt.encode() in text[at + len(token):]
                        self.expect(prompt_after_ack, start)
                    return
                except ProbeError as exc:
                    if exc.reason != 'timeout' or not retry or time.monotonic() >= deadline:
                        raise
        finally:
            self.deadline = deadline

    def fixed_check(self, expression):
        """Internal only: all callers supply fixed literals, never CLI strings."""
        token = 'CHECK_' + secrets.token_hex(20)
        yes, no = token + '_YES', token + '_NO'
        command = b'if ' + expression.encode('ascii') + b'; then ' + marker_command(yes).rstrip(b'\n')
        command += b'; else ' + marker_command(no).rstrip(b'\n') + b'; fi\n'
        start = len(self.data)
        self.send(command)
        self.expect(lambda data: has_line(data, yes) or has_line(data, no), start)
        return has_line(bytes(self.data[start:]), yes)

    def close(self):
        if self.closed:
            return
        self.closed = True
        try:
            if self.fd is not None and self.pid is not None:
                # Snapshot before Ctrl-C: an interactive job may own a different
                # foreground pgrp. Verify its session before signalling it.
                foreground = None
                try:
                    group = os.tcgetpgrp(self.fd)
                    if group > 1 and group != os.getpgrp() and os.getsid(group) == self.pid:
                        foreground = group
                except (OSError, ProcessLookupError):
                    pass
                # A separate bounded cleanup budget even after probe timeout.
                self.deadline = time.monotonic() + 0.5
                try:
                    self.send(b"\x03\x15builtin history -c; builtin history -s 'pty_safe_seed'; HISTFILE=/dev/null\n")
                    self.barrier()
                except (ProbeError, OSError):
                    pass
                # forkpty creates a new session/group; kill only our group. Kill
                # before waitpid so its PID cannot be recycled in this interval.
                if foreground is not None and foreground != self.pid:
                    try:
                        if os.getsid(foreground) == self.pid:
                            os.killpg(foreground, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                try:
                    os.killpg(self.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
        finally:
            if self.fd is not None:
                os.close(self.fd)
                self.fd = None
            if self.pid is not None:
                while True:
                    try:
                        os.waitpid(self.pid, 0)
                        break
                    except InterruptedError:
                        continue
                    except ChildProcessError:
                        break
            self.data.clear()


def prepare(session):
    session.phase = 'ready'
    session.barrier()
    session.phase = 'setup'
    session.prompt_token = 'PROMPT_' + secrets.token_hex(12)
    middle = len(session.prompt_token) // 2
    session.send(("PS1='" + session.prompt_token[:middle] + "''" + session.prompt_token[middle:] + " '; PS2='continuation> '\n").encode())
    session.barrier()
    session.send(b" HISTFILE=/dev/null; builtin history -c; builtin history -s 'pty_safe_seed'; builtin cd -- \"$PTY_VERIFY_CWD\"\n")
    session.barrier()
    if not session.fixed_check('[[ -n ${BASH_VERSION-} && $- == *i* && -z ${BASH_EXECUTION_STRING-} && $PWD == "$PTY_VERIFY_CWD" && $HISTFILE == /dev/null ]]'):
        raise ProbeError('session_invariants_failed')


def run_probe(name, session, root):
    prepare(session)
    evidence = {'ready_marker': True, 'interactive_without_c': True}
    status = 'pass'
    if name == 'tab':
        session.barrier()
        target = 'pty_tab_' + secrets.token_hex(10)
        output_marker = 'TAB_' + secrets.token_hex(20)
        (root / 'cwd' / target).write_text(output_marker + '\n', encoding='ascii')
        start = len(session.data)
        session.phase = 'candidate'
        session.send(b'command cat ./pty_tab_\t')
        # Editors may defer completion while input is queued. Observe the unique
        # completed path before Enter; success still requires file CONTENT output.
        session.expect(lambda data: target.encode() in visible(data), start)
        session.send(b'\n')
        session.expect(lambda data: has_line(data, output_marker), start)
        session.phase = 'recovery'
        session.barrier()
        passed = True
        evidence.update(capability='unique_controlled_path_completion', key='single_tab', completed_existing_path=passed,
                        git_subcommands='not_tested', option_completion='not_tested')
        status = 'pass' if passed else 'fail'
    elif name.startswith('fzf-'):
        candidate = 'pty_candidate_' + secrets.token_hex(12)
        if name == 'fzf-history':
            # A real harmless command traverses the editor's history tracking;
            # builtin history -s alone may bypass ble's history cache.
            session.send((': ' + candidate + '\n').encode())
            key = b'\x12'
        elif name == 'fzf-files':
            (root / 'cwd' / candidate).touch()
            key = b'\x14'
        else:
            (root / 'cwd' / candidate).mkdir()
            key = b'\x1bc'
        # Restrict providers/candidates; do not claim custom provider verification.
        session.send(b"export FZF_DEFAULT_OPTS='' FZF_DEFAULT_OPTS_FILE=/dev/null FZF_CTRL_R_OPTS='' FZF_CTRL_T_OPTS='' FZF_ALT_C_OPTS=''; export FZF_CTRL_T_COMMAND='command find . -type f' FZF_ALT_C_COMMAND='command find . -mindepth 1 -type d'\n")
        session.barrier()
        ui_marker = 'pty_ui_' + secrets.token_hex(12)
        session.send(("export FZF_DEFAULT_OPTS='--header=" + ui_marker + "'\n").encode())
        session.barrier()
        # Without a loaded widget, Ctrl-R would merely show readline history.
        # A command existence check is not UI evidence, only a prerequisite.
        if not session.fixed_check('builtin declare -F fzf-history-widget >/dev/null || builtin declare -F fzf-file-widget >/dev/null || builtin declare -F fzf-cd-widget >/dev/null'):
            return {'test': name, 'status': 'unsupported', 'reason': 'fzf_widgets_not_detected', 'evidence': evidence}
        session.barrier()
        start = len(session.data)
        session.phase = 'candidate'
        session.send(key)
        session.expect(lambda data: candidate.encode() in visible(data) and ui_marker.encode() in visible(data) and bool(re.search(rb'\x1b\[[0-?]*[ -/]*[HfJKABCD]|\x1b\[\?1049h', data)), start)
        evidence['ui_candidate_marker'] = True
        session.phase = 'cancellation'
        session.send(b'\x03\x15')
        session.barrier(retry=True)
        evidence.update(cancel_recovery_marker=True, capability=name, controlled_provider=True,
                        fuzzy_completion_trigger='not_tested')
    elif name == 'ble':
        session.phase = 'state_checks'
        loaded = session.fixed_check('[[ -n ${BLE_VERSION-} ]]')
        attached = session.fixed_check('[[ ${_ble_attached-} == 1 ]]')
        options = session.fixed_check('builtin declare -p bleopt_complete_auto_complete bleopt_complete_auto_history bleopt_highlight_syntax >/dev/null 2>&1')
        auto_complete = session.fixed_check('[[ ${bleopt_complete_auto_complete-} == 1 ]]')
        auto_history = session.fixed_check('[[ ${bleopt_complete_auto_history-} == 1 ]]')
        highlight = session.fixed_check('[[ ${bleopt_highlight_syntax-} == 1 ]]')
        evidence.update(BLE_VERSION_nonempty=loaded, _ble_attached_equals_1=attached, option_variables_present=options,
                        auto_complete_enabled=auto_complete, auto_history_enabled=auto_history,
                        highlight_syntax_enabled=highlight, suggestions='not_tested', visual_highlighting='not_tested',
                        capability='ble_load_attach_option_state_only')
        status = ('unsupported' if not loaded or (attached and not options)
                  else ('pass' if attached else 'fail'))
    else:
        session.phase = 'recovery'
        session.barrier()
        evidence['recovery_marker'] = True
    evidence['dsr_replies'] = session.dsr_replies
    return {'test': name, 'status': status, 'evidence': evidence}


def parse_tests(value):
    result = value.split(',')
    if not result or any(name not in TESTS for name in result) or len(set(result)) != len(result):
        raise argparse.ArgumentTypeError('tests must be comma-separated unique names: ' + ','.join(TESTS))
    return result


def positive_timeout(value):
    try:
        number = float(value)
    except ValueError:
        raise argparse.ArgumentTypeError('timeout must be finite and positive') from None
    if not math.isfinite(number) or number <= 0 or number > 300:
        raise argparse.ArgumentTypeError('timeout must be > 0 and <= 300 seconds')
    return number


def parser():
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument('--shell', help='absolute executable Bash path (no arguments)')
    result.add_argument('--user-config', action='store_true', help='execute real user bash -il startup code; not a sandbox')
    result.add_argument('--tests', type=parse_tests, default=list(TESTS), help='comma-separated test names')
    result.add_argument('--timeout', type=positive_timeout, default=8.0, help='per-test wall-clock seconds plus bounded cleanup')
    return result


def exit_code(results):
    if any(item['status'] == 'fail' for item in results):
        return 1
    return 0 if all(item['status'] == 'pass' for item in results) else 2


def main(argv=None):
    args = parser().parse_args(argv)
    report = {'schema_version': 1, 'mode': 'user-config' if args.user_config else 'clean',
              'raw_screen_included': False, 'results': [],
              'limitations': ['PTY evidence is not human visual approval.',
                              'user-config runs startup code with real HOME; temporary cwd/XDG/history settings are not a sandbox.',
                              'Startup hooks may override isolation; history is never intentionally written back.',
                              'fzf uses controlled providers; git completion and fzf ** are not tested.']}
    if os.name != 'posix':
        report['results'] = [{'test': name, 'status': 'unsupported', 'reason': 'native_unix_pty_required'} for name in args.tests]
    else:
        shell = args.shell or shutil.which('bash')
        if not shell or not os.path.isabs(shell) or not os.path.isfile(shell) or not os.access(shell, os.X_OK):
            report['results'] = [{'test': name, 'status': 'fail', 'reason': 'shell_must_be_absolute_executable_path'} for name in args.tests]
        else:
            for name in args.tests:
                session = None
                result = {}
                try:
                    temporary = tempfile.TemporaryDirectory(prefix='bash-pty-')
                except OSError:
                    report['results'].append({'test': name, 'status': 'fail',
                                              'reason': 'temporary_directory_unavailable', 'phase': 'setup'})
                    continue
                with temporary as directory:
                    try:
                        root = Path(directory)
                        session = PtySession(shell, args.user_config, root, args.timeout)
                        result = run_probe(name, session, root)
                    except ProbeError as exc:
                        result = {'test': name, 'status': 'fail', 'reason': exc.reason}
                    except (OSError, ValueError):
                        result = {'test': name, 'status': 'fail', 'reason': 'pty_setup_or_io_error'}
                    finally:
                        if session is not None:
                            phase = getattr(session, 'phase', 'setup')
                            result['phase'] = phase if phase in ('ready', 'setup', 'candidate', 'recovery', 'cancellation', 'state_checks') else 'setup'
                            session.close()
                        else:
                            result['phase'] = 'setup'
                report['results'].append(result)
    report['exit_code'] = exit_code(report['results'])
    print(json.dumps(report, ensure_ascii=True))
    return report['exit_code']


if __name__ == '__main__':
    raise SystemExit(main())
