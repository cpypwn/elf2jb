"""Exercise the production helper; PS5 system-service calls are recorded stubs."""
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import threading
import time

root=Path(__file__).resolve().parents[1]
helper=root/'build/browser-helper-native'

def run(directory,port,error=0):
    return subprocess.Popen([str(helper),str(directory),str(port)],
        env={**os.environ,'ELF2JB_BROWSER_TEST_CALLS':str(directory/'calls'),'ELF2JB_BROWSER_TEST_ERROR':str(error)},
        stdout=subprocess.PIPE,stderr=subprocess.PIPE)

with tempfile.TemporaryDirectory(prefix='elf2jb-browser-helper-') as temporary:
    directory=Path(temporary)
    # Bind now; do not listen until after asserting that the API was not called.
    listener=socket.socket();listener.bind(('127.0.0.1',0));port=listener.getsockname()[1]
    process=run(directory,port)
    time.sleep(.10)
    assert not (directory/'calls').exists(), 'browser API called before UI readiness'
    listener.listen()
    def serve():
        with listener.accept()[0] as connection:
            connection.settimeout(2)
            assert b'GET / HTTP/1.1' in connection.recv(4096)
            connection.sendall(b'HTTP/1.1 ')
            time.sleep(.02)
            connection.sendall(b'200 OK\r\nContent-Length: 0\r\n\r\n')
    thread=threading.Thread(target=serve);thread.start()
    out,err=process.communicate(timeout=4);thread.join(timeout=3);listener.close()
    assert process.returncode==0,(process.returncode,out,err)
    assert (directory/'calls').read_text()==f'http://127.0.0.1:{port}/\n'
    assert json.loads((directory/'browser-launch.json').read_text())['state']=='launch-accepted'
    print('PASS: browser API called once only after the fragmented HTTP readiness response')

    with socket.socket() as listener:
        listener.bind(('127.0.0.1',0));listener.listen();port=listener.getsockname()[1]
        thread=threading.Thread(target=serve);thread.start()
        process=run(directory,port,error=-123)
        out,err=process.communicate(timeout=4);thread.join(timeout=3)
    assert process.returncode==1,(out,err)
    report=json.loads((directory/'browser-launch.json').read_text())
    assert report['state']=='launch-failed' and report['systemError']==-123,report
    assert len((directory/'calls').read_text().splitlines())==2
    print('PASS: system-service rejection reported without retrying browser launch')

    (directory/'calls').unlink()
    with socket.socket() as reservation:
        reservation.bind(('127.0.0.1',0));port=reservation.getsockname()[1]
    process=run(directory,port);out,err=process.communicate(timeout=4)
    assert process.returncode==1,(out,err)
    assert not (directory/'calls').exists()
    assert json.loads((directory/'browser-launch.json').read_text())['state']=='ui-not-ready'
    print('PASS: unavailable UI prevents the browser API call')
