import http.client
import json
from pathlib import Path
import subprocess
import tempfile
import time
import urllib.request


project = Path(__file__).resolve().parents[1]
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def status():
    with opener.open('http://127.0.0.1:8088/status', timeout=2) as response:
        return json.load(response)


def post(path, body):
    connection = http.client.HTTPConnection('127.0.0.1', 8088, timeout=2)
    try:
        connection.request('POST', path, body, {'Content-Type': 'application/x-www-form-urlencoded'})
        response = connection.getresponse()
        response.read()
        return response.status
    finally:
        connection.close()


with tempfile.TemporaryDirectory(prefix='elf2jb-held-') as temporary:
    root = Path(temporary)
    package = root / 'packages' / 'fixture'
    runtime = package / 'runtime'
    upstream = package / 'upstream'
    runtime.mkdir(parents=True)
    upstream.mkdir()
    (root / 'config.json').write_text(json.dumps({'host': '127.0.0.1', 'openBrowser': False}))
    (runtime / 'ps5-entry.cjs').write_bytes((project / 'runtime/ps5-entry.cjs').read_bytes())
    (runtime / 'browser-launch.cjs').write_text('module.exports={launchBrowser(){throw Error("unexpected browser launch")}};')
    (runtime / 'run-diagnostics.cjs').write_text('module.exports={inspectFailure:async()=>null};')
    (runtime / 'switch-gpu-homebrew.cjs').write_text('''
module.exports.start=({runDirectory,onStatus})=>{
  if(runDirectory!=='/fixture/held-session')throw Error('wrong held run');
  onStatus({phase:'running',message:'GPU demo running'});
  let finish;
  const completed=new Promise(resolve=>{finish=resolve});
  return {ready:Promise.resolve(),completed,stop:async()=>{
    onStatus({phase:'stopped',message:'GPU demo stopped'});
    const result={state:'stopped'};finish(result);return result;
  }};
};
''')
    (upstream / 'run.cjs').write_text('''
module.exports.main=async args=>{
  if(args.length!==2||args[0]!=='--rpc')throw Error('host did not enable held RPC');
  console.log('4/4 verified. SmileBASIC RPC and FS memory endpoint remain live while this process and the app stay open.');
  console.log('Run folder: /fixture/held-session');
  await new Promise(resolve=>process.once('SIGINT',resolve));
  return {verified:true,rpc:{mode:'held',state:'closed',reason:'SIGINT'}};
};
''')
    process = subprocess.Popen([str(project / 'build/elf2jb-host'), str(root), str(runtime / 'ps5-entry.cjs')],
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        deadline = time.monotonic() + 5
        while True:
            if process.poll() is not None:
                raise AssertionError(process.communicate())
            try:
                report = status()
                if report['state'] == 'RPC held':
                    break
            except Exception:
                pass
            assert time.monotonic() < deadline, 'held RPC state was not reported'
            time.sleep(.02)
        assert report['hardware_execution_verified'] is True
        assert report['rpc'] == {'state': 'held', 'directory': '/fixture/held-session'}
        assert report['showcase'] == {'phase': 'running', 'message': 'GPU demo running'}
        assert report['canRestart'] is False
        with opener.open('http://127.0.0.1:8088/', timeout=2) as response:
            page = response.read()
        assert b'Finish session</button>' in page
        assert b'Experimental port.' not in page
        assert post('/finish', b'attempt=0') == 409
        assert post('/finish', b'attempt=1') == 303
        deadline = time.monotonic() + 5
        while True:
            report = status()
            if report['state'] == 'completed':
                break
            assert time.monotonic() < deadline, report
            time.sleep(.02)
        assert report['rpc']['state'] == 'closed'
        assert report['showcase'] == {'phase': 'stopped', 'message': 'GPU demo stopped'}
        assert report['canRestart'] is True
        assert post('/finish', b'attempt=1') == 409
        print('PASS: held RPC is reported, finish is guarded, and clean release permits a new attempt')
    finally:
        process.terminate()
        try:
            output = process.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            output = process.communicate()
        if process.returncode not in (-15, 0):
            raise AssertionError(output)
