"""Generate Payload Manager's supported repository and icon catalogs.

The ELF itself does not carry Payload Manager dashboard metadata. Install from
this source to create a repository-kind slot with the original mac2jb icon.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
from pathlib import Path
import shutil
from urllib.parse import urljoin, urlsplit


PAYLOAD_ID = "elf2jb-host"
PAYLOAD_FILENAME = "elf2jb-host.elf"
ICON_KEY = "mac2jb"
MAX_ICON_URI = 12_288


def catalogs(base_url: str, elf: bytes, icon: bytes, version: str = "0.1.1") -> tuple[dict, dict]:
    """Return catalog objects using an absolute ELF URL and relative icons URL."""
    parsed = urlsplit(base_url)
    if (
        parsed.scheme not in ("http", "https")
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("base URL must be an HTTP(S) directory URL without credentials, query, or fragment")
    if not elf.startswith(b"\x7fELF"):
        raise ValueError("payload is not an ELF file")
    if not icon.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError("icon must be an original PNG representation")
    image_uri = "data:image/png;base64," + base64.b64encode(icon).decode("ascii")
    if len(image_uri) > MAX_ICON_URI:
        raise ValueError(f"icon data URI exceeds Payload Manager's {MAX_ICON_URI}-character limit")
    base = base_url.rstrip("/") + "/"
    payload = {
        "id": PAYLOAD_ID,
        "name": "elf2jb Host",
        "filename": PAYLOAD_FILENAME,
        "url": urljoin(base, PAYLOAD_FILENAME),
        "description": "Experimental PS5 host for the pinned ns2jb Switch 2 connection workflow.",
        "version": version,
        "category": "Networking",
        "checksum": hashlib.sha256(elf).hexdigest(),
        "author": "cpypwn",
        "icon_key": ICON_KEY,
        "source": "https://github.com/cpypwn/elf2jb",
    }
    return (
        {"name": "elf2jb", "icons_url": "icons.json", "payloads": [payload]},
        {"icons": {ICON_KEY: image_uri}},
    )


def generate(base_url: str, elf_path: Path, icon_path: Path, output: Path, version: str = "0.1.1") -> Path:
    catalog, icons = catalogs(base_url, elf_path.read_bytes(), icon_path.read_bytes(), version)
    output.mkdir(parents=True, exist_ok=True)
    (output / "payloads.json").write_text(json.dumps(catalog, indent=2) + "\n", encoding="utf-8")
    (output / "icons.json").write_text(json.dumps(icons, indent=2) + "\n", encoding="utf-8")
    destination = output / PAYLOAD_FILENAME
    if elf_path.resolve() != destination.resolve():
        shutil.copyfile(elf_path, destination)
    source_url = urljoin(base_url.rstrip("/") + "/", "payloads.json")
    (output / "source-url.txt").write_text(source_url + "\n", encoding="utf-8")
    return output / "payloads.json"


def main() -> None:
    project = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", required=True, help="HTTP(S) directory serving the generated files, reachable from the PS5")
    parser.add_argument("--elf", type=Path, default=project / "build/elf2jb-host.elf")
    parser.add_argument("--icon", type=Path, default=project / "assets/payload-icon.png")
    parser.add_argument("--output", type=Path, default=project / "build/payload-manager")
    parser.add_argument("--version", default="0.1.1")
    args = parser.parse_args()
    destination = generate(args.base_url, args.elf, args.icon, args.output, args.version)
    print(destination)


if __name__ == "__main__":
    main()
