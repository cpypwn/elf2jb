"""Verify the generated source uses Payload Manager's accepted icon schema."""
import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import signal
import subprocess
import sys
import tempfile
import unittest
from urllib.parse import urljoin
import urllib.request


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("payload_catalog", ROOT / "scripts/payload_catalog.py")
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


class PayloadCatalogTests(unittest.TestCase):
    def test_bundle_has_exact_elf_hash_and_original_icon(self):
        icon = (ROOT / "assets/payload-icon.png").read_bytes()
        elf = b"\x7fELF" + bytes(range(256))
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            elf_file = root / "candidate.elf"
            elf_file.write_bytes(elf)
            result = module.generate("http://192.0.2.10:8000/elf2jb", elf_file, ROOT / "assets/payload-icon.png", root / "catalog")
            catalog = json.loads(result.read_text())
            icons = json.loads((result.parent / "icons.json").read_text())
            payload = catalog["payloads"][0]
            self.assertEqual(payload["id"], "elf2jb-host")
            self.assertEqual(payload["filename"], "elf2jb-host.elf")
            self.assertEqual(payload["url"], "http://192.0.2.10:8000/elf2jb/elf2jb-host.elf")
            self.assertEqual(payload["checksum"], hashlib.sha256(elf).hexdigest())
            self.assertEqual((result.parent / payload["filename"]).read_bytes(), elf)
            self.assertEqual(urljoin("http://192.0.2.10:8000/elf2jb/payloads.json", catalog["icons_url"]), "http://192.0.2.10:8000/elf2jb/icons.json")
            uri = icons["icons"][payload["icon_key"]]
            self.assertLessEqual(len(uri), 12_288)
            self.assertEqual(uri.split(",", 1)[0], "data:image/png;base64")
            self.assertEqual(base64.b64decode(uri.split(",", 1)[1], validate=True), icon)

    def test_rejects_unsupported_urls_and_oversized_icon(self):
        elf = b"\x7fELF fixture"
        icon = (ROOT / "assets/payload-icon.png").read_bytes()
        for url in ("relative/", "file:///tmp/", "ftp://host/", "http://user:pass@host/", "https://host/?q=1", "https://host/#fragment"):
            with self.subTest(url=url), self.assertRaises(ValueError):
                module.catalogs(url, elf, icon)
        with self.assertRaisesRegex(ValueError, "limit"):
            module.catalogs("https://example.com/", elf, b"\x89PNG\r\n\x1a\n" + b"x" * 10_000)

    def test_http_and_https_paths_resolve_without_downgrade(self):
        icon = (ROOT / "assets/payload-icon.png").read_bytes()
        for base in ("http://192.0.2.10:8000", "https://example.com/releases/v1/"):
            catalog, _ = module.catalogs(base, b"\x7fELF fixture", icon)
            self.assertEqual(catalog["payloads"][0]["url"], base.rstrip("/") + "/elf2jb-host.elf")
            self.assertEqual(catalog["icons_url"], "icons.json")

    def test_helper_serves_isolated_catalog_and_exact_payload(self):
        with tempfile.TemporaryDirectory() as temp:
            fixture = Path(temp) / "fixture.elf"
            payload = b"\x7fELF local server fixture"
            fixture.write_bytes(payload)
            child = subprocess.Popen(
                [sys.executable, str(ROOT / "scripts/serve-payload-catalog.py"),
                 "--elf", str(fixture), "--host", "192.0.2.10", "--bind", "127.0.0.1", "--port", "0"],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
            )
            try:
                first = child.stdout.readline()
                self.assertIn("Manage Sources", first)
                source = child.stdout.readline().strip()
                match = re.fullmatch(r"Source URL: http://192\.0\.2\.10:(\d+)/payloads\.json", source)
                self.assertIsNotNone(match, source)
                local = f"http://127.0.0.1:{match[1]}/"
                opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
                with opener.open(local + "payloads.json", timeout=3) as response:
                    catalog = json.load(response)
                with opener.open(local + catalog["icons_url"], timeout=3) as response:
                    icons = json.load(response)
                self.assertIn(catalog["payloads"][0]["icon_key"], icons["icons"])
                with opener.open(local + "elf2jb-host.elf", timeout=3) as response:
                    self.assertEqual(response.read(), payload)
                self.assertEqual(catalog["payloads"][0]["checksum"], hashlib.sha256(payload).hexdigest())
            finally:
                child.send_signal(signal.SIGINT)
                try:
                    stdout, stderr = child.communicate(timeout=4)
                except subprocess.TimeoutExpired:
                    child.kill()
                    stdout, stderr = child.communicate()
                self.assertEqual(child.returncode, 0, (stdout, stderr))


if __name__ == "__main__":
    unittest.main()
