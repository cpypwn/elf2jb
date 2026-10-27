#!/usr/bin/env bash
# Install a verified Debian LLVM toolchain without modifying the system image.
set -euo pipefail
project=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
tools_root=/workspace/toolchains
sdk_source=/workspace/ps5-sdk-reference
sdk_commit=a7685ce8e97ce1f8a4f38253a41d54241c9124f1
mkdir -p "$tools_root/apt/state/lists/partial" "$tools_root/apt/cache/archives/partial" "$tools_root/llvm"
cat > "$tools_root/apt/apt.conf" <<'EOF'
Dir::Etc::parts "-";
Dir::Etc::main "-";
Dir::Etc::sourcelist "/workspace/toolchains/apt/sources.list";
Dir::Etc::sourceparts "-";
Dir::State "/workspace/toolchains/apt/state";
Dir::State::status "/var/lib/dpkg/status";
Dir::Cache "/workspace/toolchains/apt/cache";
APT::Sandbox::User "agent";
EOF
cat > "$tools_root/apt/sources.list" <<'EOF'
deb [signed-by=/usr/share/keyrings/debian-archive-keyring.gpg] https://deb.debian.org/debian trixie main
EOF
export APT_CONFIG="$tools_root/apt/apt.conf"
apt-get update
# Only workspace-owned APT state is changed; no system packages are installed.
apt-get -o Debug::NoLocking=1 -y --download-only --no-install-recommends install clang-19 llvm-19 lld-19
for package in "$tools_root"/apt/cache/archives/*.deb; do
    dpkg-deb -x "$package" "$tools_root/llvm"
done
export PATH="$tools_root/llvm/usr/lib/llvm-19/bin:$PATH"
export LD_LIBRARY_PATH="$tools_root/llvm/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
if [ ! -e "$sdk_source" ]; then
    git clone --no-checkout https://github.com/ps5-payload-dev/sdk.git "$sdk_source"
    git -C "$sdk_source" checkout --detach "$sdk_commit"
fi
test "$(git -C "$sdk_source" rev-parse HEAD)" = "$sdk_commit"
make -j4 -C "$sdk_source" DESTDIR="$tools_root/ps5-payload-sdk" install
make -j4 -C "$project" all test runtime-test browser-test catalog-test pages-test
