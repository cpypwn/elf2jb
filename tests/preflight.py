"""Exercise the native server; this does not establish PS5 hardware compatibility."""
import json
import pathlib
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

root = pathlib.Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory() as directory:
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        port = reservation.getsockname()[1]
    process = subprocess.Popen(
        [str(root / "build/elf2jb-preflight"), str(port), directory],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        base = f"http://127.0.0.1:{port}"
        deadline = time.monotonic() + 5
        while True:
            if process.poll() is not None:
                raise AssertionError(process.communicate())
            try:
                with opener.open(base + "/status", timeout=1) as response:
                    report = json.load(response)
                break
            except urllib.error.URLError:
                if time.monotonic() >= deadline:
                    raise
                time.sleep(0.02)
        assert report["ns2jb_host_implemented"] is False
        for key in ("tcp_listen", "pthread", "temporary_file_roundtrip", "monotonic_clock", "uname"):
            assert report[key] is True, report
        assert report["pointer_bits"] == 64
        assert list(pathlib.Path(directory).iterdir()) == []
        with opener.open(base, timeout=2) as response:
            assert b"not the working ns2jb host" in response.read()
        try:
            opener.open(base + "/missing", timeout=2)
            raise AssertionError("unknown route accepted")
        except urllib.error.HTTPError as error:
            assert error.code == 404
        # Fragment HTTP headers across writes, as real TCP permits.
        with socket.create_connection(("127.0.0.1", port), timeout=2) as client:
            client.sendall(b"GET /sta")
            client.sendall(b"tus HTTP/1.1\r\nHost: test\r\n\r\n")
            data = bytearray()
            while chunk := client.recv(4096):
                data.extend(chunk)
            assert data.startswith(b"HTTP/1.1 200 OK\r\n"), data
            assert json.loads(data.split(b"\r\n\r\n", 1)[1]) == report
        print("PASS: report, storage cleanup, HTTP page, 404, fragmented request")
    finally:
        process.terminate()
        try:
            process.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.communicate()
        assert process.returncode == 0, process.returncode
