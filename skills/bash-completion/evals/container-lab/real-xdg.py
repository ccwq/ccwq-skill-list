"""Test-only real-XDG startup check for disposable container accounts.
Unlike the verifier's isolated default this permits cache/state writes to HOME.
"""
import importlib.util
import os
import sys
from configure import absolute, owned_directory, Refused
if os.name != 'posix' or os.getuid() == 0 or os.getuid() != os.geteuid():
    raise Refused('run as a disposable nonroot account')
owned_directory(absolute(os.environ['HOME']))
spec = importlib.util.spec_from_file_location('verify', sys.argv[1])
v = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v)
original = v.isolated_env

def real_xdg(root, user_config):
    env = original(root, user_config)
    for key in ('XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_STATE_HOME', 'XDG_DATA_HOME', 'XDG_RUNTIME_DIR'):
        if key in os.environ:
            env[key] = os.environ[key]
        else:
            env.pop(key, None)
    return env

v.isolated_env = real_xdg
raise SystemExit(v.main(['--user-config', '--tests', 'readiness,ble', '--timeout', '30']))
