"""Local tests; Unix integration uses temporary HOMEs, never a real account HOME.

Run: python -B -m unittest discover -s <this directory> -p test_configure.py -v
Windows runs portable tests and reports Unix tests skipped; never invoke WSL.
Root is allowed only through the internal API in these temporary-HOME tests.
"""
import contextlib
import io
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import tempfile
import unittest
from unittest import mock

import configure as fixture


class PortableTests(unittest.TestCase):
    def test_markers_reject_partial_duplicate_and_reordered(self):
        for data in (fixture.BEGIN, fixture.END, fixture.BLOCK * 2,
                     fixture.END + b'\n' + fixture.BEGIN,
                     b'# malformed bash-completion-skill container-lab'):
            with self.subTest(data=data):
                with self.assertRaises(fixture.Refused):
                    fixture.validate_markers(data)
                with self.assertRaises(fixture.Refused):
                    fixture.validate_markers(data, managed=True)

    def test_valid_marker_block_and_unrelated_bytes(self):
        fixture.validate_markers(b'# unrelated\xff\n')
        fixture.validate_markers(b'# unrelated\xff\n' + fixture.BLOCK, managed=True)

    def test_absolute_paths_and_spaces(self):
        path = Path(tempfile.gettempdir()) / 'fixture home with spaces'
        self.assertEqual(fixture.absolute(path), path)
        for value in ('relative', path / '..' / 'escape'):
            with self.assertRaises(fixture.Refused):
                fixture.absolute(value)

    def test_manifest_records_content_and_mode(self):
        self.assertIsNone(fixture.record(None))
        self.assertEqual(fixture.record((b'abc', 0o640, ())),
                         {'sha256': fixture.digest(b'abc'), 'mode': 0o640})

    def test_optimistic_check_refuses_byte_or_mode_drift(self):
        expected = (b'a', 0o600, ('old',))
        for actual in (None, (b'b', 0o600, ('old',)), (b'a', 0o644, ('old',))):
            with mock.patch.object(fixture, 'snapshot', return_value=actual):
                with self.assertRaises(fixture.Refused):
                    fixture.unchanged(Path('unused'), expected)

    def test_syntax_uses_stdin_no_shell_and_scrubs_startup_environment(self):
        with mock.patch.object(fixture.shutil, 'which', return_value='/local/bash'), \
             mock.patch.object(fixture.subprocess, 'run') as run, \
             mock.patch.dict(os.environ, {'BASH_ENV': 'evil', 'ENV': 'evil'}):
            run.return_value.returncode = 0
            fixture.syntax(b':\n', 'test')
            args, kwargs = run.call_args
            self.assertEqual(args[0], ['/local/bash', '--noprofile', '--norc', '-n'])
            self.assertEqual(kwargs['input'], b':\n')
            self.assertNotIn('shell', kwargs)
            self.assertNotIn('BASH_ENV', kwargs['env'])
            self.assertNotIn('ENV', kwargs['env'])
            run.return_value.returncode = 2
            with self.assertRaises(fixture.Refused):
                fixture.syntax(b'if', 'broken')

    def test_missing_bash_fails_closed(self):
        with mock.patch.object(fixture.shutil, 'which', return_value=None):
            with self.assertRaises(fixture.Refused):
                fixture.syntax(b':', 'test')

    def test_cli_parameters_forwarded_without_root_override(self):
        with mock.patch.object(fixture, 'configure', return_value='unchanged') as call, \
             contextlib.redirect_stdout(io.StringIO()):
            fixture.main(['--home', '/a home', '--init-source', '/a source', '--action', 'apply'])
            call.assert_called_once_with('/a home', '/a source', 'apply')

    @unittest.skipIf(os.name == 'posix', 'Windows-only unsupported contract')
    def test_windows_refuses_before_any_bash_execution(self):
        with mock.patch.object(fixture.subprocess, 'run') as run:
            with self.assertRaisesRegex(fixture.Refused, 'unsupported'):
                fixture.configure('/home', '/init', 'apply')
            run.assert_not_called()


@unittest.skipUnless(os.name == 'posix', 'requires Unix UID and mode semantics; no WSL execution')
class UnixFixtureTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='completion fixture ')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.home = self.root / 'account home'
        self.home.mkdir(mode=0o700)
        self.source = self.root / 'source init.bash'
        self.source.write_bytes(b'# trusted test source\n:\n')
        self.rc = self.home / '.bashrc'
        self.original = b'# unrelated bytes \xff\nexport KEEP=yes'  # no final newline
        self.rc.write_bytes(self.original)
        self.rc.chmod(0o640)
        self.base = self.home / '.config/bash-completion-skill'
        self.init = self.base / 'init.bash'
        self.state = self.base / 'state'
        self.manifest = self.state / 'manifest.json'
        self.backup = self.state / 'bashrc.backup'
        # Most tests isolate filesystem behavior. A separate test uses real bash -n.
        patch = mock.patch.object(fixture, 'syntax')
        self.syntax = patch.start()
        self.addCleanup(patch.stop)

    def run_fixture(self, action='apply'):
        return fixture.configure(self.home, self.source, action, _allow_root=True)

    def test_apply_reapply_rollback_exact_bytes_modes_and_profile_untouched(self):
        profile = self.home / '.profile'
        profile.write_bytes(b'# leave profile alone\n')
        self.assertEqual(self.run_fixture(), 'applied')
        self.assertEqual(self.backup.read_bytes(), self.original)
        self.assertEqual(self.rc.read_bytes(), self.original + b'\n' + fixture.BLOCK)
        meta = json.loads(self.manifest.read_bytes())
        for path, key in ((self.rc, 'bashrc'), (self.init, 'init')):
            self.assertEqual(meta[key], fixture.record(fixture.snapshot(path)))
        self.assertEqual(stat.S_IMODE(self.state.stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE(self.manifest.stat().st_mode), 0o600)
        before = {p: fixture.snapshot(p) for p in (self.rc, self.init, self.manifest, self.backup)}
        self.assertEqual(self.run_fixture(), 'unchanged')
        self.assertEqual(before, {p: fixture.snapshot(p) for p in before})
        self.source.unlink()  # rollback is independent of the source's continued presence
        self.assertEqual(self.run_fixture('rollback'), 'rolled back')
        self.assertEqual(self.rc.read_bytes(), self.original)
        self.assertEqual(stat.S_IMODE(self.rc.stat().st_mode), 0o640)
        self.assertFalse(self.init.exists())
        self.assertFalse(self.state.exists())
        self.assertEqual(profile.read_bytes(), b'# leave profile alone\n')

    def test_new_private_state_under_setgid_home(self):
        home = self.rc.parent
        home.chmod(0o2700)
        self.run_fixture()
        self.assertEqual(stat.S_IMODE(self.state.stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE(home.stat().st_mode), 0o2700)
        self.run_fixture('rollback')

    def test_missing_bashrc_is_removed_on_rollback(self):
        self.rc.unlink()
        self.run_fixture()
        self.run_fixture('rollback')
        self.assertFalse(self.rc.exists())

    def test_user_edits_or_mode_changes_block_reapply_and_rollback(self):
        for target_name in ('rc', 'init', 'backup', 'manifest'):
            for drift in ('bytes', 'mode'):
                with self.subTest(target=target_name, drift=drift):
                    self.run_fixture()
                    target = getattr(self, target_name)
                    old = target.read_bytes(), stat.S_IMODE(target.stat().st_mode)
                    if drift == 'bytes':
                        target.write_bytes(old[0] + b'# edit\n')
                    else:
                        target.chmod(old[1] ^ 0o040)
                    changed = fixture.snapshot(target)
                    for action in ('apply', 'rollback'):
                        with self.assertRaises(fixture.Refused):
                            self.run_fixture(action)
                        self.assertEqual(fixture.snapshot(target), changed)
                    target.write_bytes(old[0])
                    target.chmod(old[1])
                    self.run_fixture('rollback')

    def test_changed_source_refused(self):
        self.run_fixture()
        self.source.write_bytes(b'# changed\n')
        with self.assertRaisesRegex(fixture.Refused, 'changed source'):
            self.run_fixture()
        self.run_fixture('rollback')

    def test_prior_init_conflict_preserved(self):
        self.base.mkdir(parents=True)
        self.init.write_bytes(b'# preexisting\n')
        with self.assertRaises(fixture.Refused):
            self.run_fixture()
        self.assertEqual(self.init.read_bytes(), b'# preexisting\n')
        self.assertEqual(self.rc.read_bytes(), self.original)

    def test_prior_manifest_conflict_preserved(self):
        self.state.mkdir(parents=True, mode=0o700)
        self.manifest.write_bytes(b'{}')
        with self.assertRaises(fixture.Refused):
            self.run_fixture()
        self.assertEqual(self.manifest.read_bytes(), b'{}')
        self.assertFalse(self.init.exists())

    def test_existing_unrelated_directory_content_preserved(self):
        self.base.mkdir(parents=True)
        other = self.base / 'notes'
        other.write_bytes(b'keep')
        self.run_fixture()
        self.run_fixture('rollback')
        self.assertEqual(other.read_bytes(), b'keep')

    def test_existing_marker_rejected_without_publication(self):
        for marker in (fixture.BEGIN, fixture.END, fixture.BLOCK, fixture.BLOCK * 2):
            self.rc.write_bytes(self.original + b'\n' + marker)
            with self.assertRaises(fixture.Refused):
                self.run_fixture()
            self.assertFalse(self.init.exists())

    def test_symlink_files_and_directories_rejected(self):
        outside = self.root / 'outside'
        outside.mkdir()
        for relative in ('.bashrc', '.config', '.config/bash-completion-skill',
                         '.config/bash-completion-skill/init.bash',
                         '.config/bash-completion-skill/state'):
            with self.subTest(relative=relative):
                target = self.home / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                if target == self.rc:
                    target.unlink()
                target.symlink_to(outside)
                with self.assertRaises(fixture.Refused):
                    self.run_fixture()
                target.unlink()
                if target == self.rc:
                    self.rc.write_bytes(self.original)
        self.assertEqual(list(outside.iterdir()), [])

    def test_symlink_source_rejected(self):
        real = self.root / 'real-source'
        self.source.rename(real)
        self.source.symlink_to(real)
        with self.assertRaises(fixture.Refused):
            self.run_fixture()

    def test_wrong_home_owner_and_root_cli_rejected(self):
        with mock.patch.object(fixture.os, 'getuid', return_value=self.home.stat().st_uid + 1), \
             mock.patch.object(fixture.os, 'geteuid', return_value=self.home.stat().st_uid + 1):
            with self.assertRaises(fixture.Refused):
                self.run_fixture()
        with mock.patch.object(fixture.os, 'getuid', return_value=0), \
             mock.patch.object(fixture.os, 'geteuid', return_value=0):
            with self.assertRaisesRegex(fixture.Refused, 'nonroot'):
                fixture.configure(self.home, self.source, 'apply')

    def test_lock_conflict_preserved(self):
        lock = self.home / '.bash-completion-skill-container-lab.lock'
        lock.mkdir()
        with self.assertRaisesRegex(fixture.Refused, 'lock'):
            self.run_fixture()
        self.assertTrue(lock.is_dir())

    def test_syntax_failure_publishes_nothing(self):
        self.syntax.side_effect = fixture.Refused('syntax failure')
        with self.assertRaises(fixture.Refused):
            self.run_fixture()
        self.assertEqual(self.rc.read_bytes(), self.original)
        self.assertFalse(self.base.exists())

    def test_drift_during_validation_preserves_edit(self):
        def editor(*args):
            self.rc.write_bytes(b'# concurrent edit\n')
        self.syntax.side_effect = editor
        with self.assertRaisesRegex(fixture.Refused, 'drift'):
            self.run_fixture()
        self.assertEqual(self.rc.read_bytes(), b'# concurrent edit\n')
        self.assertFalse(self.init.exists())

    def test_atomic_replace_is_same_directory_and_detects_final_drift(self):
        old = fixture.snapshot(self.rc)
        real_replace = os.replace
        def checked_replace(src, dst):
            self.assertEqual(Path(src).parent, Path(dst).parent)
            return real_replace(src, dst)
        with mock.patch.object(fixture.os, 'replace', side_effect=checked_replace):
            fixture.atomic(self.rc, b'# changed\n', 0o640, old)
        with self.assertRaisesRegex(fixture.Refused, 'drift'):
            fixture.atomic(self.rc, b'overwrite', 0o640, old)
        self.assertEqual(self.rc.read_bytes(), b'# changed\n')
        self.assertEqual(list(self.home.glob('.fixture-*')), [])

    @unittest.skipUnless(os.name == 'posix' and shutil.which('bash'), 'local Unix bash unavailable')
    def test_real_bash_syntax_and_noninteractive_guard(self):
        # Invoke only the local Unix tool; never a remote or WSL runtime.
        bash = shutil.which('bash')
        for data, success in ((fixture.BLOCK, True), (b'if then\n', False)):
            result = subprocess.run([bash, '--noprofile', '--norc', '-n'], input=data,
                                    capture_output=True, check=False)
            self.assertEqual(result.returncode == 0, success)
        self.run_fixture()
        self.init.write_bytes(b'echo SHOULD_NOT_LOAD\n')
        env = dict(os.environ, HOME=str(self.home))
        env.pop('BASH_ENV', None)
        result = subprocess.run([bash, '--noprofile', '--norc'], input=fixture.BLOCK,
                                env=env, capture_output=True, check=False)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, b'')


if __name__ == '__main__':
    unittest.main()
