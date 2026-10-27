"""Verify persistent Pages catalogs and escaped landing-page metadata."""
import base64
from html import escape
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
SPEC = importlib.util.spec_from_file_location("build_pages", ROOT / "scripts/build-pages.py")
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


class PagesTests(unittest.TestCase):
    def test_site_contains_exact_payload_hash_and_original_icon(self):
        icon_file = ROOT / "assets/payload-icon.png"
        icon = icon_file.read_bytes()
        payload = b"\x7fELF Pages fixture"
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            fixture = root / "candidate.elf"
            fixture.write_bytes(payload)
            site = module.build_pages(module.DEFAULT_BASE_URL, fixture, icon_file, root / "pages", "0.1.1")
            catalog = json.loads((site / "payloads.json").read_text())
            entry = catalog["payloads"][0]
            self.assertEqual(entry["version"], "0.1.1")
            self.assertEqual(entry["url"], "https://cpypwn.github.io/elf2jb/elf2jb-host.elf")
            self.assertEqual(entry["checksum"], hashlib.sha256(payload).hexdigest())
            self.assertEqual((site / "elf2jb-host.elf").read_bytes(), payload)
            self.assertEqual((site / "payload-icon.png").read_bytes(), icon)
            uri = json.loads((site / catalog["icons_url"]).read_text())["icons"][entry["icon_key"]]
            self.assertEqual(base64.b64decode(uri.split(",", 1)[1], validate=True), icon)
            self.assertEqual((site / "source-url.txt").read_text(), "https://cpypwn.github.io/elf2jb/payloads.json\n")
            page = (site / "index.html").read_text()
            self.assertIn("https://cpypwn.github.io/elf2jb/payloads.json", page)
            self.assertIn("end-to-end execution remains unverified", page)
            self.assertTrue((site / ".nojekyll").is_file())

    def test_landing_page_escapes_configured_url_and_version(self):
        base = 'https://example.com/a/" onmouseover="alert(1)/'
        version = '<script>alert("version")</script>'
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            fixture = root / "fixture.elf"
            fixture.write_bytes(b"\x7fELF fixture")
            site = module.build_pages(base, fixture, ROOT / "assets/payload-icon.png", root / "site", version)
            page = (site / "index.html").read_text()
            self.assertNotIn(version, page)
            self.assertNotIn('href="https://example.com/a/" onmouseover=', page)
            self.assertIn(escape(version, quote=True), page)
            self.assertIn('&quot; onmouseover=&quot;alert(1)', page)

    def test_empty_version_is_rejected_before_writing(self):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / "site"
            with self.assertRaisesRegex(ValueError, "version"):
                module.build_pages(module.DEFAULT_BASE_URL, Path("missing"), Path("missing"), output, "  ")
            self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
