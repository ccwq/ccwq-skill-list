"""Offline verifier tests; never start a user's configured shell.
Run: python3 -B -m unittest discover -s .agents/skills/bash-completion/evals -p test_verify_pty.py -v
"""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import tempfile
import time
import unittest
from unittest import mock

SOURCE = Path(__file__).resolve().parents[1] / 'scripts/verify-pty.py'
spec = importlib.util.spec_from_file_location('verify_pty', SOURCE)
v = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v)


class ProtocolTests(unittest.TestCase):
    def test_defaults_and_explicit_options(self):
        args = v.parser().parse_args([])
        self.assertFalse(args.user_config)
        self.assertEqual(args.tests, list(v.TESTS))
        args = v.parser().parse_args(['--user-config', '--shell', '/bin/bash', '--tests', 'readiness,tab', '--timeout', '2'])
        self.assertTrue(args.user_config)
        self.assertEqual(args.timeout, 2)
        self.assertEqual(args.tests, ['readiness', 'tab'])

    def test_barrier_retains_delayed_ack_and_default_budget(self):
        session = v.PtySession.__new__(v.PtySession)
        session.data = bytearray()
        session.deadline = time.monotonic() + 10
        original_deadline = session.deadline
        session.send = mock.Mock()
        starts = []
        def delayed(predicate, start):
            starts.append(start)
            if len(starts) == 1:
                session.data.extend(b'late startup bytes')
                raise v.ProbeError('timeout')
        session.expect = mock.Mock(side_effect=delayed)
        session.barrier(retry=True)
        self.assertEqual(starts, [0, 0])
        self.assertEqual(session.send.call_args_list[0], session.send.call_args_list[1])
        self.assertEqual(session.deadline, original_deadline)
        session.send.reset_mock()
        session.expect = mock.Mock(side_effect=lambda *args: self.assertEqual(session.deadline, original_deadline))
        session.barrier()
        session.send.assert_called_once()

    def test_barrier_requires_prompt_after_ack(self):
        session = v.PtySession.__new__(v.PtySession)
        session.data = bytearray()
        session.deadline = time.monotonic() + 10
        session.prompt_token = 'PROMPT_unique'
        session.send = mock.Mock()
        predicates = []
        session.expect = mock.Mock(side_effect=lambda predicate, start: predicates.append(predicate))
        with mock.patch.object(v.secrets, 'token_hex', return_value='abc'):
            session.barrier()
        self.assertEqual(len(predicates), 2)
        ack, prompt = predicates
        self.assertFalse(ack(v.marker_command('PTY_abc')))
        self.assertTrue(ack(b'\nPTY_abc\n'))
        self.assertFalse(prompt(b'PROMPT_unique \nPTY_abc\n'))
        self.assertFalse(prompt(b'\nPTY_abc\n'))
        self.assertTrue(prompt(b'\nPTY_abc\nPROMPT_unique '))

    def test_tab_stages_enter_and_requires_content(self):
        for content in (False, True):
            with self.subTest(content=content), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                (root / 'cwd').mkdir()
                session = mock.Mock(data=bytearray(), dsr_replies=0)
                events = []
                def send(value):
                    if value == b'\n':
                        self.assertEqual(events, ['tab', 'completed'])
                        events.append('enter')
                    else:
                        self.assertEqual(value, b'command cat ./pty_tab_\t')
                        events.append('tab')
                def expect(predicate, start):
                    target = next((root / 'cwd').iterdir())
                    echo = ('command cat ./' + target.name + '\n').encode()
                    if events == ['tab']:
                        self.assertTrue(predicate(echo))
                        self.assertFalse(predicate(b'command cat ./pty_tab_'))
                        events.append('completed')
                    else:
                        self.assertEqual(events, ['tab', 'completed', 'enter'])
                        self.assertFalse(predicate(echo))
                        if not content:
                            raise v.ProbeError('timeout')
                        self.assertTrue(predicate(target.read_bytes()))
                session.send.side_effect = send
                session.expect.side_effect = expect
                with mock.patch.object(v, 'prepare'):
                    if content:
                        self.assertEqual(v.run_probe('tab', session, root)['status'], 'pass')
                        self.assertEqual(session.barrier.call_count, 2)  # before input and after execution
                    else:
                        with self.assertRaisesRegex(v.ProbeError, 'timeout'):
                            v.run_probe('tab', session, root)
                        session.barrier.assert_called_once_with()  # before input only

    def test_history_key_waits_for_post_check_barrier(self):
        session = mock.Mock(data=bytearray(), dsr_replies=0)
        events = []
        session.barrier.side_effect = lambda **kwargs: events.append('barrier')
        def check(expression):
            events.append('check')
            return True
        session.fixed_check.side_effect = check
        def send(value):
            if value == b'\x12':
                self.assertEqual(events[-2:], ['check', 'barrier'])
                events.append('key')
            elif value.startswith(b': pty_candidate_'):
                events.append('seed')
        session.send.side_effect = send
        def expect(predicate, start):
            self.assertEqual(events[-1], 'key')
            self.assertTrue(predicate(b'\x1b[2Jpty_candidate_fixture\npty_ui_fixture\n'))
        session.expect.side_effect = expect
        with mock.patch.object(v, 'prepare'), mock.patch.object(v.secrets, 'token_hex', return_value='fixture'):
            self.assertEqual(v.run_probe('fzf-history', session, Path('.'))['status'], 'pass')
        self.assertEqual(events[0], 'seed')
        session.barrier.assert_called_with(retry=True)

    def test_bad_arguments(self):
        for args in (['--tests', 'readiness,readiness'], ['--tests', 'wat'], ['--tests', ''],
                     ['--timeout', 'nan'], ['--timeout', 'inf'], ['--timeout', '-1'],
                     ['--timeout', '0'], ['--timeout', '301'], ['--command', 'id']):
            with self.subTest(args=args), contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit):
                    v.parser().parse_args(args)

    def test_markers_are_not_echoes(self):
        token = 'PTY_0123456789abcdef'
        command = v.marker_command(token)
        self.assertNotIn(token.encode(), command)
        self.assertFalse(v.has_line(command, token))
        self.assertFalse(v.has_line(b'prefix ' + token.encode() + b' suffix\n', token))
        self.assertTrue(v.has_line(b'\x1b[32m' + token.encode() + b'\x1b[0m\r\n', token))
        with self.assertRaises(ValueError):
            v.marker_command("'; touch /tmp/oops")

    def test_hidden_ansi_payload_is_not_evidence(self):
        for data in (b'\x1b]0;\nSECRET\n\x07', b'\x1bP\nSECRET\n\x1b\\',
                     b'\x1b]0;\nSECRET\n', b'\x1b_\nSECRET\n\x1b\\'):
            self.assertFalse(v.has_line(data, 'SECRET'))
        self.assertEqual(v.visible(b'\x1b[2J\x1b[1;1Hhello'), b'hello')

    def test_dsr_across_chunks(self):
        session = v.PtySession.__new__(v.PtySession)
        session.data, session.dsr_tail, session.dsr_replies = bytearray(), b'', 0
        session.send = mock.Mock()
        session._ingest(b'x\x1b[')
        session._ingest(b'6n\x1b[?6n\x1b[5n')
        self.assertEqual(session.send.call_args_list,
                         [mock.call(b'\x1b[1;1R'), mock.call(b'\x1b[?1;1R'), mock.call(b'\x1b[0n')])
        self.assertEqual(session.dsr_replies, 3)

    def test_output_limit(self):
        session = v.PtySession.__new__(v.PtySession)
        session.data = bytearray()
        with mock.patch.object(v, 'OUTPUT_LIMIT', 5):
            with self.assertRaisesRegex(v.ProbeError, 'output_limit'):
                session._ingest(b'123456')
        self.assertEqual(session.data, b'')

    def test_exit_codes(self):
        self.assertEqual(v.exit_code([{'status': 'pass'}]), 0)
        self.assertEqual(v.exit_code([{'status': 'pass'}, {'status': 'unsupported'}]), 2)
        self.assertEqual(v.exit_code([{'status': 'not_tested'}]), 2)
        self.assertEqual(v.exit_code([{'status': 'fail'}, {'status': 'unsupported'}]), 1)

    def test_native_windows_json(self):
        out = io.StringIO()
        with mock.patch.object(v.os, 'name', 'nt'), contextlib.redirect_stdout(out):
            code = v.main(['--tests', 'readiness,tab'])
        report = json.loads(out.getvalue())
        self.assertEqual(code, 2)
        self.assertFalse(report['raw_screen_included'])
        self.assertTrue(all(item['status'] == 'unsupported' for item in report['results']))

    def test_invalid_shell_is_structured(self):
        out = io.StringIO()
        with mock.patch.object(v.os, 'name', 'posix'), contextlib.redirect_stdout(out):
            code = v.main(['--shell', 'bash; echo nope', '--tests', 'readiness'])
        self.assertEqual(code, 1)
        self.assertEqual(json.loads(out.getvalue())['results'][0]['reason'], 'shell_must_be_absolute_executable_path')

    def test_environment_isolation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            clean = v.isolated_env(root, False)
            configured = v.isolated_env(root, True)
            self.assertEqual(clean['HOME'], str(root / 'home'))
            self.assertEqual(configured.get('HOME'), os.environ.get('HOME'))
            self.assertEqual(clean['HISTFILE'], '/dev/null')
            self.assertEqual(configured['_ZO_DATA_DIR'], str(root / 'zoxide'))
            self.assertNotIn('BASH_ENV', clean)
            self.assertNotIn('PROMPT_COMMAND', clean)
            self.assertEqual(clean['TERM'], 'xterm-256color')

    def test_foreground_cleanup_excludes_caller_group(self):
        for foreground, own, expected in ((321, 99, [321, 123]), (99, 99, [123])):
            session = v.PtySession.__new__(v.PtySession)
            session.closed, session.pid, session.fd = False, 123, 8
            session.data = bytearray(b'secret')
            session.send, session.barrier = mock.Mock(), mock.Mock()
            with mock.patch.object(v.os, 'tcgetpgrp', return_value=foreground, create=True), \
                 mock.patch.object(v.os, 'getpgrp', return_value=own, create=True), \
                 mock.patch.object(v.os, 'getsid', return_value=123, create=True), \
                 mock.patch.object(v.os, 'killpg', create=True) as kill, \
                 mock.patch.object(v.os, 'waitpid', create=True) as wait, \
                 mock.patch.object(v.signal, 'SIGKILL', 9, create=True), mock.patch.object(v.os, 'close'):
                session.close()
            self.assertEqual([call.args[0] for call in kill.call_args_list], expected)
            wait.assert_called_once_with(123, 0)
            self.assertEqual(session.data, b'')

    def test_timeout_phase_is_structured_and_preserved(self):
        session = mock.Mock()
        session.phase = 'candidate'
        session.close.side_effect = lambda: setattr(session, 'phase', 'cleanup')
        out = io.StringIO()
        with mock.patch.object(v.os, 'name', 'posix'), mock.patch.object(v.os.path, 'isabs', return_value=True), mock.patch.object(v.os.path, 'isfile', return_value=True), \
             mock.patch.object(v.os, 'access', return_value=True), mock.patch.object(v, 'PtySession', return_value=session), \
             mock.patch.object(v, 'run_probe', side_effect=v.ProbeError('timeout')), contextlib.redirect_stdout(out):
            self.assertEqual(v.main(['--shell', '/fixture/bash', '--tests', 'tab']), 1)
        result = json.loads(out.getvalue())['results'][0]
        self.assertEqual(result['phase'], 'candidate')
        self.assertEqual(result['reason'], 'timeout')
        self.assertEqual(result['status'], 'fail')

    def test_unavailable_temp_directory_is_structured_without_starting_shell(self):
        for error in (FileNotFoundError('private path'), PermissionError('private path'), OSError('disk full')):
            with self.subTest(error=type(error).__name__):
                out = io.StringIO()
                with mock.patch.object(v.os, 'name', 'posix'), \
                     mock.patch.object(v.os.path, 'isabs', return_value=True), mock.patch.object(v.os.path, 'isfile', return_value=True), \
                     mock.patch.object(v.os, 'access', return_value=True), \
                     mock.patch.object(v.tempfile, 'TemporaryDirectory', side_effect=error), \
                     mock.patch.object(v, 'PtySession') as start, contextlib.redirect_stdout(out):
                    self.assertEqual(v.main(['--shell', '/fixture/bash', '--tests', 'readiness,tab']), 1)
                start.assert_not_called()
                report = json.loads(out.getvalue())
                self.assertEqual(len(report['results']), 2)
                for result in report['results']:
                    self.assertEqual(result['reason'], 'temporary_directory_unavailable')
                    self.assertEqual(result['phase'], 'setup')
                    self.assertEqual(result['status'], 'fail')
                self.assertNotIn('private path', out.getvalue())

    def test_sessions_are_independent_and_cleanup_runs(self):
        sessions = []
        def factory(*args):
            item = mock.Mock()
            sessions.append(item)
            return item
        out = io.StringIO()
        with mock.patch.object(v.os, 'name', 'posix'), mock.patch.object(v.os.path, 'isabs', return_value=True), mock.patch.object(v.os.path, 'isfile', return_value=True), \
             mock.patch.object(v.os, 'access', return_value=True), mock.patch.object(v, 'PtySession', side_effect=factory), \
             mock.patch.object(v, 'run_probe', side_effect=v.ProbeError('timeout')), contextlib.redirect_stdout(out):
            self.assertEqual(v.main(['--shell', '/fixture/bash', '--tests', 'readiness,tab']), 1)
        self.assertEqual(len(sessions), 2)
        for session in sessions:
            session.close.assert_called_once()
        self.assertEqual([r['reason'] for r in json.loads(out.getvalue())['results']], ['timeout', 'timeout'])


@unittest.skipUnless(os.name == 'posix' and shutil.which('bash'), 'requires Unix PTY and clean Bash')
class CleanIntegrationTests(unittest.TestCase):
    def test_clean_readiness_tab_and_missing_plugins(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = v.main(['--shell', shutil.which('bash'), '--timeout', '5'])
        report = json.loads(out.getvalue())
        statuses = {item['test']: item['status'] for item in report['results']}
        self.assertEqual(code, 2, report)
        self.assertEqual(statuses['readiness'], 'pass', report)
        self.assertEqual(statuses['tab'], 'pass', report)
        self.assertTrue(all(statuses[name] == 'unsupported' for name in ('ble', 'fzf-history', 'fzf-files', 'fzf-dirs')), report)

    def test_timeout_reaps_process_and_closes_fd(self):
        with tempfile.TemporaryDirectory() as directory:
            session = v.PtySession(shutil.which('bash'), False, Path(directory), 2)
            try:
                session.barrier()
                session.deadline = time.monotonic() + 0.05
                with self.assertRaisesRegex(v.ProbeError, 'timeout'):
                    session.expect(lambda data: False, len(session.data))
            finally:
                session.close()
            self.assertIsNone(session.fd)
            self.assertEqual(session.data, b'')
            with self.assertRaises(ChildProcessError):
                os.waitpid(session.pid, os.WNOHANG)
            session.close()  # idempotent

    def test_safe_controlled_fzf_widget_fixture(self):
        # Inline shell fixture emulates only the UI protocol, not real fzf.
        # Never source configuration or create a persistent helper script.
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            session = v.PtySession(shutil.which('bash'), False, root, 5)
            try:
                session.barrier()
                session.send(b'''fzf-file-widget() { builtin printf '\\033[2J\\n%s\\n' "${FZF_DEFAULT_OPTS#--header=}"; builtin printf '%s\\n' pty_candidate_*; }; bind -x '"\\C-t":fzf-file-widget'\n''')
                session.barrier()
                result = v.run_probe('fzf-files', session, root)
                self.assertEqual(result['status'], 'pass', result)
                self.assertTrue(result['evidence']['cancel_recovery_marker'])
            finally:
                session.close()

    def test_tab_without_completion_cannot_pass_from_echo(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            session = v.PtySession(shutil.which('bash'), False, root, 2)
            try:
                session.barrier()
                session.send(b'''bind '"\\C-i":self-insert'\n''')
                session.barrier()
                with self.assertRaisesRegex(v.ProbeError, 'timeout'):
                    v.run_probe('tab', session, root)
            finally:
                session.close()

    def test_history_widget_fixture_uses_real_history_event(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            session = v.PtySession(shutil.which('bash'), False, root, 5)
            try:
                session.barrier()
                session.send(b'''fzf-history-widget() { builtin printf '\\033[2J\\n%s\\n' "${FZF_DEFAULT_OPTS#--header=}"; builtin history; }; bind -x '"\\C-r":fzf-history-widget'\n''')
                session.barrier()
                result = v.run_probe('fzf-history', session, root)
                self.assertEqual(result['status'], 'pass', result)
                self.assertTrue(result['evidence']['ui_candidate_marker'])
            finally:
                session.close()

    def test_ble_state_fixture_does_not_claim_visuals(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            session = v.PtySession(shutil.which('bash'), False, root, 5)
            try:
                session.send(b'BLE_VERSION=fixture; _ble_attached=1; bleopt_complete_auto_complete=1; bleopt_complete_auto_history=; bleopt_highlight_syntax=1\n')
                session.barrier()
                result = v.run_probe('ble', session, root)
                self.assertEqual(result['status'], 'pass')
                self.assertEqual(result['evidence']['suggestions'], 'not_tested')
                self.assertEqual(result['evidence']['visual_highlighting'], 'not_tested')
                self.assertFalse(result['evidence']['auto_history_enabled'])
            finally:
                session.close()


if __name__ == '__main__':
    unittest.main()
