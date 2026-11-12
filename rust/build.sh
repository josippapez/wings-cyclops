#!/bin/sh
# Builds Cyclops' three frames in Rust and puts them in dist/native/, where Wings runs a .wasm in place of the .js of
# the same name. Needs the target: rustup target add wasm32-unknown-unknown. `sh rust/build.sh fake` builds them over
# made-up Cyclops answers, for screenshots, into rust/target/fake/ and leaves dist/ alone.
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
