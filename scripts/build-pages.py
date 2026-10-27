#!/usr/bin/env python3
"""Build the static GitHub Pages source consumed by Payload Manager."""
from __future__ import annotations

import argparse
from html import escape
from pathlib import Path
import shutil
from urllib.parse import urljoin

from payload_catalog import generate


DEFAULT_BASE_URL = "https://cpypwn.github.io/elf2jb/"


def build_pages(base_url: str, elf_path: Path, icon_path: Path, output: Path, version: str) -> Path:
    """Generate a checksum-pinned catalog, its files, and a small landing page."""
    if not version.strip():
        raise ValueError("version must not be empty")
    generate(base_url, elf_path, icon_path, output, version)
    shutil.copyfile(icon_path, output / "payload-icon.png")
    base = base_url.rstrip("/") + "/"
    source_url = urljoin(base, "payloads.json")
    source = escape(source_url, quote=True)
    binary = escape(urljoin(base, "elf2jb-host.elf"), quote=True)
    release = escape(version, quote=True)
    page = f"""<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>elf2jb by cpypwn</title>
<link rel="icon" href="payload-icon.png" type="image/png">
<style>
body{{font:17px/1.6 system-ui,sans-serif;max-width:48rem;margin:3rem auto;padding:0 1.2rem;color:#e6f3f2;background:#14262e}}
header{{display:flex;align-items:center;gap:1rem}}img{{width:88px;height:88px}}h1{{margin:0}}a{{color:#64d7cc}}code{{overflow-wrap:anywhere}}.source{{padding:1rem;background:#0d1c23;border:1px solid #41616a;border-radius:.6rem}}.status{{color:#efdb9a}}
</style>
<header><img src="payload-icon.png" alt="mac2jb app icon"><div><h1>elf2jb by cpypwn</h1><p>Version {release}</p></div></header>
<p>Host the ns2jb Switch 2 connection from a jailbroken PS5.</p>
<p class="status">Experimental release. Startup, browser opening and a Switch 2 connection were confirmed on PS5 Pro firmware 13.60. A run stopped at step 2/4; end-to-end execution remains unverified.</p>
<h2>Add to Payload Manager</h2>
<ol>
<li>Open <strong>Settings → Manage Sources → Add Source</strong> in Payload Manager.</li>
<li>Add this catalog URL:</li>
</ol>
<p class="source"><a href="{source}"><code>{source}</code></a></p>
<p>Install <strong>elf2jb Host</strong> from this source to show the mac2jb icon in Payload Manager. Manually uploaded local or USB copies use Payload Manager’s generated icon.</p>
<p>Keep the same source URL and refresh the repository to discover published updates. Each catalog entry includes the ELF’s SHA-256 checksum.</p>
<h2>Use on PS5</h2>
<p>Load <code>elf2jb-host.elf</code>. Once its page is serving on port 8088, it sends an embedded browser helper to the existing local ELF loader on port 9021. The helper requests the PS5 browser at the host page; it does not install a shortcut. Browser-launch failures leave the host running.</p>
<p>After failure, restart the Switch 2 and reopen SmileBASIC, then use <strong>Restart host</strong> on the host page. A fresh pairing attempt starts in the same ELF and previous reports are kept.</p>
<p>No temporary computer server is needed once this site is published.</p>
<p><a href="{binary}">Download the ELF directly</a> · <a href="https://github.com/cpypwn/elf2jb/blob/main/README.md">Setup instructions</a> · <a href="https://github.com/cpypwn/elf2jb">Source code</a></p>
</html>
"""
    (output / "index.html").write_text(page, encoding="utf-8")
    (output / ".nojekyll").write_text("", encoding="utf-8")
    return output


def main() -> None:
    project = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--elf", type=Path, default=project / "build/elf2jb-host.elf")
    parser.add_argument("--icon", type=Path, default=project / "assets/payload-icon.png")
    parser.add_argument("--output", type=Path, default=project / "build/pages")
    parser.add_argument("--version", help="release version; defaults to the repository VERSION file")
    args = parser.parse_args()
    version = args.version if args.version is not None else (project / "VERSION").read_text(encoding="utf-8").strip()
    destination = build_pages(args.base_url, args.elf, args.icon, args.output, version)
    print(destination)


if __name__ == "__main__":
    main()
