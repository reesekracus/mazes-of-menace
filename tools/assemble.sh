#!/usr/bin/env bash
# Assemble a publishable site for one NetHack version.
# Usage: tools/assemble.sh 3.6.7|5.0 <outdir> [vendor dir]
#   3.6.7 vendor default: web/vendor   (from @neth4ck/wasm-367 + build_tiles.py)
#   5.0   vendor default: vendor50     (from tools/build50.sh out/: nethack.js, nethack.wasm, tiles16.png, tiles-dawnlike.png)
# Art (title, icons) comes from art/out (python3 art/make_art.py art/out).
set -euo pipefail
cd "$(dirname "$0")/.."
VER="$1"; OUT="$2"
case "$VER" in
  3.6.7) VENDOR="${3:-web/vendor}"; ENGINE=(web/js/engine.js) ;;
  5.0)   VENDOR="${3:-vendor50}";   ENGINE=(web/js/engine50.js web/js/nh50consts.js) ;;
  *) echo "version must be 3.6.7 or 5.0" >&2; exit 1 ;;
esac
[ -f art/out/title.png ] || python3 art/make_art.py art/out
rm -rf "$OUT"; mkdir -p "$OUT/js" "$OUT/vendor"
cp web/style.css "$OUT/"
cp art/out/title.png art/out/favicon-32.png art/out/icon-192.png "$OUT/"
LONG=$([ "$VER" = 5.0 ] && echo 5.0.0 || echo 3.6.7)
sed "s|<title>.*</title>|<title>Mazes of Menace — NetHack $LONG</title>|" web/index.html > "$OUT/index.html"
cp web/js/app.js web/js/help.js "${ENGINE[@]}" "$OUT/js/"
printf "// Which NetHack this build runs: '3.6.7' or '5.0'. Written by tools/assemble.sh.\nexport const NH_VERSION = '%s';\n" "$VER" > "$OUT/js/config.js"
cp "$VENDOR/nethack.js" "$VENDOR/nethack.wasm" "$VENDOR/tiles16.png" "$OUT/vendor/"
[ -f "$VENDOR/tiles-dawnlike.png" ] && cp "$VENDOR/tiles-dawnlike.png" "$OUT/vendor/"
echo "Assembled NetHack $VER site in $OUT:"; (cd "$OUT" && find . -type f | sort)
