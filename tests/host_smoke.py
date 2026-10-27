"""Run the actual host entrypoint against a deliberately incompatible fake console.

This verifies greeting parsing, qualification request framing, failure cleanup,
UI reporting, result persistence and restarting after failure in the same ELF.
It does not simulate exploit success.
"""
from concurrent.futures import ThreadPoolExecutor
import http.client
import json
from pathlib import Path
import socket
import struct
import subprocess
import tempfile
import time
import threading
import urllib.error
import urllib.request

project = Path(__file__).resolve().parents[1]
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

def status():
    with opener.open('http://127.0.0.1:8088/status', timeout=2) as response:
        return json.load(response)

def read_exact(connection, count):
    result = bytearray()
    while len(result) < count:
        data = connection.recv(count - len(result))
        assert data, f'premature disconnect after {len(result)} bytes'
        result.extend(data)
    return result

def control(method, body=b''):
    connection = http.client.HTTPConnection('127.0.0.1', 8088, timeout=3)
    try:
        connection.request(method, '/restart', body, {'Content-Type':'application/x-www-form-urlencoded'})
        response = connection.getresponse()
        response.read()
        return response.status, response.getheader('Location')
    finally:
        connection.close()

def fail_console(host):
    main, sdk, scratch = 0x7000000000, 0x7100000000, 0x7200000000
    values = [0x31545344, 1, 2, scratch, 0x80000, main, sdk, main+0x9c92f0,
              sdk+0x5872f0, 0x7300000000, 0x7400000000, 0, 0, 0, 0, 3925528160]
    with socket.create_connection((host, 39380), timeout=5) as console:
        console.sendall(struct.pack('<16Q', *values))
        request = read_exact(console, 0x8080)
        assert struct.unpack_from('<5Q', request) == (sdk+0x158314, scratch+0x4040, scratch+0x4080, sdk, 0)
        # Return a mapping which fails the upstream qualification guard.
        console.sendall(bytes(16+0x8000))
        assert read_exact(console, 0x8080) == bytes(0x8080), 'missing upstream stop record'
        assert console.recv(1) == b''

def wait_for_failure(attempt):
    deadline = time.monotonic() + 5
    while True:
        report = status()
        if report['state'] == 'failed' and report['attempt'] == attempt:
            assert report['canRestart'] is True, report
            return report
        assert time.monotonic() < deadline, report
        time.sleep(0.02)

with tempfile.TemporaryDirectory(prefix='elf2jb-host-') as directory:
    loader=socket.socket();loader.bind(('127.0.0.1',0));loader.listen();loader.settimeout(5)
    Path(directory,'config.json').write_text(json.dumps({'openBrowser':True,'loaderPort':loader.getsockname()[1]}))
    handoff={}
    def accept_browser_helper():
        try:
            with loader.accept()[0] as connection:
                connection.settimeout(5)
                # The actual entrypoint must be responding before it launches anything.
                handoff['ui_was_serving']=status()['browser']['state'] in ('connecting-to-loader','sending-helper','helper-sent')
                content=bytearray()
                while chunk:=connection.recv(65536):content.extend(chunk)
                handoff['bytes']=bytes(content)
            Path(directory,'browser-launch.json').write_text(json.dumps({'state':'launch-accepted','systemError':0,'monotonicMs':time.monotonic()*1000}))
        except Exception as error:handoff['error']=str(error)
    browser_thread=threading.Thread(target=accept_browser_helper,daemon=True);browser_thread.start()
    process = subprocess.Popen([str(project/'build/elf2jb-host'), directory], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        deadline = time.monotonic() + 15
        while True:
            if process.poll() is not None:
                raise AssertionError(process.communicate())
            try:
                report = status()
                if report['state'] == 'waiting for Switch 2':
                    break
            except (urllib.error.URLError, KeyError):
                pass
            assert time.monotonic() < deadline, 'host startup deadline'
            time.sleep(0.05)
        host = report['host']
        with opener.open('http://127.0.0.1:8088/', timeout=2) as response:
            page = response.read()
        assert f'V=START(39380,{host.replace(".", ",")})'.encode() in page
        assert b'<title>elf2jb by cpypwn</title><h1>elf2jb by cpypwn</h1>' in page
        assert b'<img' not in page and b'Restart host</button>' not in page
        assert report['attempt'] == 1 and report['canRestart'] is False
        assert control('GET')[0] == 405
        assert control('POST', b'attempt=1')[0] == 409, 'active runs must not restart'
        assert report['mediaShortcut']['titleId'] == 'ELFJ00001'
        assert report['mediaShortcut']['state'] == 'unavailable-on-native-host'
        with opener.open('http://127.0.0.1:8088/icon.png', timeout=2) as response:
            assert response.headers['Content-Type'] == 'image/png'
            assert response.read() == (project/'assets/payload-icon.png').read_bytes()
        # A wrong greeting must be rejected without occupying the pairing slot.
        with socket.create_connection((host, 39380), timeout=3) as console:
            console.sendall(bytes(128))
            assert console.recv(1) == b''
        assert status()['state'] == 'waiting for Switch 2'
        fail_console(host)
        report = wait_for_failure(1)
        assert 'SDK mapping differs' in report['error'], report
        reports = list(Path(directory).glob('packages/*/upstream/runs/switch2-*/result.json'))
        assert len(reports) == 1, reports
        result = json.loads(reports[0].read_text())
        assert result['verified'] is False
        assert result['error'] == 'The SDK mapping differs', result
        saved_report = reports[0].read_bytes()
        with opener.open('http://127.0.0.1:8088/', timeout=2) as response:
            page = response.read()
        assert b'<button type=submit>Restart host</button>' in page
        assert b'name=attempt value="1"' in page
        browser_thread.join(timeout=6)
        assert not browser_thread.is_alive() and 'error' not in handoff,handoff
        assert handoff['ui_was_serving'] is True
        assert handoff['bytes']==(project/'build/elf2jb-open-browser.elf').read_bytes()
        deadline=time.monotonic()+3
        while status()['browser']['state']!='launch-accepted':
            assert time.monotonic()<deadline,status()
            time.sleep(.05)
        browser_status = status()['browser']
        # Two clicks on the same failed page must launch exactly one new run.
        with ThreadPoolExecutor(max_workers=2) as pool:
            restarts = list(pool.map(lambda _:control('POST', b'attempt=1'), range(2)))
        assert sorted(code for code, _ in restarts) == [303, 409], restarts
        assert next(location for code, location in restarts if code == 303) == '/'
        deadline = time.monotonic() + 5
        while True:
            report = status()
            if report['attempt'] == 2 and any(line.startswith('Run folder:') for line in report['log']):
                break
            assert time.monotonic() < deadline, report
            time.sleep(.02)
        assert process.poll() is None
        assert report['state'] == 'waiting for Switch 2' and report['canRestart'] is False
        assert 'error' not in report and 'result' not in report
        assert not any('SDK mapping differs' in line for line in report['log'])
        fail_console(host)
        report = wait_for_failure(2)
        assert 'SDK mapping differs' in report['error']
        assert control('POST', b'attempt=1')[0] == 409, 'stale forms must not restart a later failed run'
        assert control('GET')[0] == 405
        assert status()['attempt'] == 2 and status()['canRestart'] is True
        assert len(list(Path(directory).glob('packages/*/upstream/runs/switch2-*/result.json'))) == 2
        assert reports[0].read_bytes() == saved_report, 'previous reports must be preserved'
        assert status()['browser'] == browser_status, 'restart must not send another browser helper'
        print('PASS: real entrypoint, UI, guarded failure, stop record, saved reports, browser handoff and restart after failure with duplicate/stale-request protection')
    finally:
        loader.close()
        process.terminate()
        try:
            stdout, stderr = process.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            stdout, stderr = process.communicate()
        if process.returncode not in (-15, 0):
            raise AssertionError((process.returncode, stdout.decode(errors='replace'), stderr.decode(errors='replace')))
