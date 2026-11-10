#!/usr/bin/env bash
# Reproducible NetHack 5.0.0 -> WebAssembly build for Mazes of Menace.
# Usage: tools/build50.sh [workdir]   (default: ./build50)
# Output: <workdir>/out/ nethack.js, nethack.wasm, nh50consts.js, tiles16.png, tiles-dawnlike.png
#   -> copy to vendor50/ (nh50consts.js also to web/js/); tools/assemble.sh 5.0 dist/50 builds the site.
# Note: plain `make` on purpose; parallel make (-j) has produced no output for this build.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mkdir -p "${1:-build50}" && cd "${1:-build50}" && pwd)"
cd "$WORK"

if [ ! -d emsdk ]; then
  git clone --depth 1 https://github.com/emscripten-core/emsdk.git
  (cd emsdk && ./emsdk install 7.0.0 && ./emsdk activate 7.0.0)  # version verified 2026-11-08
fi
# shellcheck disable=SC1091
source emsdk/emsdk_env.sh >/dev/null 2>&1

if [ ! -d NetHack ]; then
  git clone --depth 1 --branch NetHack-5.0.0_Release https://github.com/NetHack/NetHack.git
  (cd NetHack && git apply "$HERE/patches/nethack-5.0.0-wasm.patch")
fi
cd NetHack
(cd sys/unix && sh setup.sh hints/linux.500)   # creates the Makefiles
[ -d lib/lua-5.4.8 ] || make fetch-Lua
# HACKDIR=/ : the data files are embedded at the root of the WASM filesystem.
make CROSS_TO_WASM=1 HACKDIR=/ all
mkdir -p "$WORK/out"
cp targets/wasm/nethack.js targets/wasm/nethack.wasm "$WORK/out/"

# Constants (extended-command order, cmap indices) from cmd.c preprocessed with the build's own flags.
CMD=$(cd src && make -n -B CROSS_TO_WASM=1 HACKDIR=/ ../targets/wasm/cmd.o | grep -- '-c -o ../targets/wasm/cmd.o cmd.c')
(cd src && eval "${CMD/-c -o ..\/targets\/wasm\/cmd.o/-E -o $WORK/cmd.i}")
python3 "$HERE/tools/gen_consts50.py" "$WORK/cmd.i" win/share "$WORK/out/nh50consts.js"
# Tilesheet (1515 tiles) in glyph_info.tileidx order.
python3 "$HERE/tools/build_tiles.py" win/share "$WORK/out/tiles16.png"
# DawnLike tileset (CC BY-SA 3.0), from FIQHack's copy of the NetHack 4 tile files.
[ -d "$WORK/fiqhack" ] || git clone -q --depth 1 --filter=blob:none --sparse https://github.com/FredrIQ/fiqhack.git "$WORK/fiqhack"
(cd "$WORK/fiqhack" && git sparse-checkout set tilesets/dat/tiles >/dev/null)
python3 "$HERE/tools/build_tiles_dawnlike.py" win/share "$WORK/fiqhack/tilesets/dat/tiles" "$WORK/out/tiles-dawnlike.png"
echo "Built: $WORK/out/{nethack.js,nethack.wasm,nh50consts.js,tiles16.png,tiles-dawnlike.png}"
