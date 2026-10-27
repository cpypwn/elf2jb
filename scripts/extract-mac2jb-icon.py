"""Extract the authentic, unchanged icon representations from mac2jb v0.4.3.

Usage: python3 scripts/extract-mac2jb-icon.py /path/to/mac2jb-v0.4.3-macos-arm64.zip
The ZIP must come from the release URL in assets/ICON_PROVENANCE.md.
This script does not download files or edit artwork.
"""
from pathlib import Path
import hashlib
import struct
import sys
import zipfile

ARCHIVE_SHA256 = "a46b7c2037e9bb29d5cb78702f5dc11a4314cae7ed245636a2427f4522a9a161"
ENTRIES = {
    b"ic10": ("icon0.png", (1024, 1024), "2fafb82fedd02609670b9b7f207ef66ebacafb01b01176325b3076a5abfb02a2"),
    b"ic07": ("payload-icon.png", (128, 128), "994906559f31a4fac36b8e15a69a8e3a0a3f00978a7aefc501aa6abccc18fd48"),
}

def main():
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    archive = Path(sys.argv[1])
    if hashlib.sha256(archive.read_bytes()).hexdigest() != ARCHIVE_SHA256:
        raise SystemExit("The release archive hash differs from the pinned v0.4.3 download.")
    with zipfile.ZipFile(archive) as package:
        icon = package.read("mac2jb.app/Contents/Resources/mac2jb.icns")
    if icon[:4] != b"icns" or struct.unpack(">I", icon[4:8])[0] != len(icon):
        raise SystemExit("Invalid ICNS container.")
    found = {}
    offset = 8
    while offset < len(icon):
        if offset + 8 > len(icon):
            raise SystemExit("Truncated ICNS record header.")
        kind = icon[offset:offset + 4]
        size = struct.unpack(">I", icon[offset + 4:offset + 8])[0]
        if size < 8 or offset + size > len(icon):
            raise SystemExit("Invalid ICNS record length.")
        if kind in ENTRIES:
            if kind in found:
                raise SystemExit("Duplicate expected ICNS representation.")
            data = icon[offset + 8:offset + size]
            name, dimensions, checksum = ENTRIES[kind]
            if not data.startswith(b"\x89PNG\r\n\x1a\n") or struct.unpack(">II", data[16:24]) != dimensions:
                raise SystemExit("Unexpected PNG representation.")
            if hashlib.sha256(data).hexdigest() != checksum:
                raise SystemExit("Unexpected icon PNG hash.")
            found[kind] = (name, data)
        offset += size
    if set(found) != set(ENTRIES):
        raise SystemExit("The icon lacks an expected PNG representation.")
    output = Path(__file__).resolve().parents[1] / "assets"
    output.mkdir(exist_ok=True)
    for name, data in found.values():
        destination = output / name
        if destination.exists() and destination.read_bytes() != data:
            raise SystemExit("Refusing to replace a different existing icon: " + str(destination))
        destination.write_bytes(data)
        print(destination)

if __name__ == "__main__":
    main()
