#!/bin/sh
# macOS Finder launcher for the adjacent temporary catalog server.
cd -- "$(dirname -- "$0")" || exit 1
exec python3 serve-payload-catalog.py "$@"
