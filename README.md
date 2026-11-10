# Mazes of Menace

NetHack 5.0 for phones: the real, unmodified game with a touch-only interface (no keyboard needed).
Android app plus a web version. Free and open source under the NetHack General Public License.

## Install
- **Android:** download the APK from [Releases](../../releases) and open it on your phone.
- **Web:** the GitHub Pages link in the repository's About box (when enabled).

## Build from source
Releases are built by GitHub Actions (`.github/workflows/build.yml`). To build by hand (Linux, Python 3 with Pillow, Node 22, JDK 21, Android SDK 36):

```sh
tools/build50.sh build50                     # emsdk + NetHack 5.0 -> WebAssembly, constants, tilesheets
mkdir -p vendor50 && cp build50/out/{nethack.js,nethack.wasm,tiles16.png,tiles-dawnlike.png} vendor50/
cp build50/out/nh50consts.js web/js/
python3 art/make_art.py art/out              # icon and title art
tools/assemble.sh 5.0 dist/50                # web app in dist/50 (serve it with any static server)
npm ci && npx cap sync android && (cd android && ./gradlew assembleRelease)
```

## Layout
- `web/` – the app (HTML, CSS, JS); `web/js/engine50.js` talks to NetHack, `web/js/app.js` is the touch UI.
- `patches/` – the small patch that builds NetHack 5.0 for WebAssembly.
- `tools/` – build scripts; `art/` – icon and title art generator; `scripts/` – browser tests (Playwright).
- `android/` – the Capacitor Android project (app id `io.github.reesekracus.mazesofmenace`).

See `CREDITS.md` for the people and projects this is built on.
