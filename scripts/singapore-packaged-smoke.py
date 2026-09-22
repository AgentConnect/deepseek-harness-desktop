"""Start an exact Singapore packaged application in a disposable profile.

No identity is registered and no model or payment request is made. Only the
redacted lifecycle receipt is exported; profile data and process logs stay local.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import time

parser = argparse.ArgumentParser()
parser.add_argument('--exe', type=Path, required=True)
parser.add_argument('--receipt', type=Path, required=True)
args = parser.parse_args()
assert args.exe.is_file()

with tempfile.TemporaryDirectory(prefix='singapore-desktop-smoke-') as scratch:
    root = Path(scratch)
    home = root / 'profile'
    home.mkdir()
    (home / 'settings.yaml').write_text('dsh-desktop:\n  mode: advanced\n', encoding='utf-8')
    user_data = root / 'electron-data'
    env = dict(os.environ, DSH_HOME=str(home), DSH_TELEMETRY_DISABLED='1',
               DSH_AWIKI_STATE_ROOT=str(home/'awiki'),
               DSH_ANP_IDENTITY_STATE_ROOT=str(home/'identity'),
               DSH_ANP_IDENTITY_ROOT_KEY_PROVIDER='local-file',
               DSH_ANP_IDENTITY_ROOT_KEY_PROVIDER_ID='singapore-packaged-smoke')
    evidence = user_data / 'lifecycle-events/startup.jsonl'
    process = None
    events = []
    try:
        with (root/'process.log').open('wb') as log:
            process = subprocess.Popen([str(args.exe.resolve()), '--user-data-dir='+str(user_data)],
                                       env=env, stdout=log, stderr=log,
                                       start_new_session=os.name != 'nt')
            for _ in range(120):
                if process.poll() is not None:
                    raise RuntimeError(f'packaged app exited before healthy startup: {process.returncode}')
                if evidence.exists():
                    events = [json.loads(line) for line in evidence.read_text(encoding='utf-8').splitlines() if line]
                    if any(e['eventName'] == 'startup.run.failed' for e in events):
                        raise RuntimeError('packaged startup failed: '+','.join(e['eventName'] for e in events))
                    if any(e['eventName'] == 'startup.run.completed' and e['details'].get('rendererStatus') == 'healthy' for e in events):
                        break
                time.sleep(1)
            else:
                raise RuntimeError('no healthy packaged renderer receipt: '+','.join(e['eventName'] for e in events))
            time.sleep(3)
            assert process.poll() is None, 'packaged application exited after startup'
        args.receipt.parent.mkdir(parents=True, exist_ok=True)
        args.receipt.write_text(json.dumps({'ok':True, 'platform':os.name,
            'executableSha256':hashlib.sha256(args.exe.read_bytes()).hexdigest(),
            'modelCalls':0, 'payments':0, 'events':events}, indent=2)+'\n', encoding='utf-8')
        print('Packaged Desktop reached a healthy advanced renderer.')
    finally:
        if process is not None:
            if os.name == 'nt':
                subprocess.run(['taskkill','/PID',str(process.pid),'/T','/F'],capture_output=True)
            else:
                try:
                    os.killpg(process.pid, signal.SIGTERM)
                    process.wait(timeout=10)
                except ProcessLookupError:
                    pass
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=15)
