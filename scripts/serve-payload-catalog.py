#!/usr/bin/env python3
"""Temporarily serve the checksum-verified elf2jb source to local Payload Manager.

Run this helper only on a trusted LAN. It exposes only a temporary directory
containing the candidate ELF and its generated catalogs; it does not modify
Payload Manager's files or publish anything online.
"""
from __future__ import annotations

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import ipaddress
from pathlib import Path
import socket
import sys
import tempfile

from payload_catalog import generate


def lan_ipv4() -> str:
    # UDP connect selects a local route without sending a datagram.
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as route:
        route.connect(("192.0.2.1", 9))
        return route.getsockname()[0]


def default_file(filename: str, source_relative: str) -> Path:
    folder = Path(__file__).resolve().parent
    packaged = folder / filename
    return packaged if packaged.is_file() else folder.parent / source_relative


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--elf", type=Path, default=default_file("elf2jb-host.elf", "build/elf2jb-host.elf"))
    parser.add_argument("--icon", type=Path, default=default_file("payload-icon.png", "assets/payload-icon.png"))
    parser.add_argument("--host", help="computer LAN IPv4 shown in the source URL; inferred from the active route by default")
    parser.add_argument("--bind", default="0.0.0.0", help="listen address (default: all IPv4 interfaces)")
    parser.add_argument("--port", type=int, default=8000, help="HTTP port (default: 8000)")
    parser.add_argument("--version", help="catalog version; defaults to the adjacent/project VERSION file")
    args = parser.parse_args()
    if not 0 <= args.port <= 65535:
        parser.error("--port must be between 0 and 65535")
    try:
        host = args.host or lan_ipv4()
        version = args.version or default_file("VERSION", "VERSION").read_text(encoding="utf-8").strip()
        if not version:
            raise ValueError("VERSION must not be empty")
        address = ipaddress.IPv4Address(host)
        if address.is_loopback or address.is_unspecified or address.is_multicast:
            raise ValueError("choose the computer's LAN IPv4 address")
        with tempfile.TemporaryDirectory(prefix="elf2jb-catalog-") as temporary:
            output = Path(temporary)
            handler = partial(SimpleHTTPRequestHandler, directory=str(output))
            with ThreadingHTTPServer((args.bind, args.port), handler) as server:
                port = server.server_address[1]
                generate(f"http://{host}:{port}/", args.elf, args.icon, output, version)
                print("In Payload Manager, open Settings → Manage Sources → Add Source.", flush=True)
                print(f"Source URL: http://{host}:{port}/payloads.json", flush=True)
                print("Install elf2jb Host from this source to show the mac2jb icon.", flush=True)
                print("A manually uploaded local/USB copy keeps Payload Manager's generated icon.", flush=True)
                print("Keep this terminal open until installation finishes; press Ctrl-C to stop.", flush=True)
                try:
                    server.serve_forever()
                except KeyboardInterrupt:
                    print("\nStopped the local catalog server.", flush=True)
        return 0
    except (OSError, ValueError) as error:
        print(f"Cannot serve elf2jb catalog: {error}", file=sys.stderr)
        if not args.host:
            print("If address selection failed, rerun with --host YOUR-COMPUTER-LAN-IP.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
