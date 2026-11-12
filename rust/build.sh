#!/bin/sh
# Builds Cyclops' three frames and puts them in dist/native/, where the manifest names them, then packs
# cyclops.wings-plugin, the file Wings installs: the manifest, the README and the three modules.
# Needs the target: rustup target add wasm32-unknown-unknown. `sh rust/build.sh fake` builds the frames over made-up
# Cyclops answers, for screenshots, into rust/target/fake/, and leaves dist/ and the package alone.
set -eu
cd "$(dirname "$0")"
out=../dist/native
dir=target
features=""
if [ "${1:-}" = fake ]; then
  out=target/fake/native
  dir=target/fake
  features="fake"
fi
mkdir -p "$out"
for frame in sidebar popover main; do
  case $frame in sidebar) extra="" ;; *) extra="$frame" ;; esac
  cargo build --release --target wasm32-unknown-unknown --target-dir "$dir/$frame" --features "$features $extra"
  cp "$dir/$frame/wasm32-unknown-unknown/release/cyclops.wasm" "$out/$frame.wasm"
done
ls -l "$out"/*.wasm
if [ -z "$features" ]; then
  cd ..
  rm -f cyclops.wings-plugin
  zip -q -9 cyclops.wings-plugin wings-plugin.json README.md dist/native/main.wasm dist/native/sidebar.wasm dist/native/popover.wasm
  ls -l cyclops.wings-plugin
fi
