# Mazes of Menace

NetHack 5.0 for phones: the real, unmodified game with a touch-only interface (no keyboard needed).
Android app plus a web version. Free and open source under the NetHack General Public License.

## Install
**Android, with automatic updates (recommended):** use [Obtainium](https://github.com/ImranR98/Obtainium), a free app that installs and updates apps straight from their GitHub releases.
1. Install Obtainium (from its GitHub releases page or F-Droid).
2. In Obtainium, tap **Add App**, paste `https://github.com/reesekracus/mazes-of-menace` and tap **Add**.
3. Tap **Install**. Obtainium will offer each new version as it is released.

**Android, by hand:** download the `.apk` from the latest [release](../../releases/latest) and open it on your phone. To update, install the newer `.apk` over it; your saves stay.

**Web (any browser, including iPhone and desktop):** https://reesekracus.github.io/mazes-of-menace/

## Build from source
Releases are built by GitHub Actions (`.github/workflows/build.yml`): change `VERSION` (e.g. to 1.0.1) and push to main, and the workflow tags the commit and publishes a signed APK. To build by hand (Linux, Python 3 with Pillow, Node 22, JDK 21, Android SDK 36):

```sh
tools/build50.sh build50                     # emsdk + NetHack 5.0 -> WebAssembly, constants, tilesheets
mkdir -p vendor50 && cp build50/out/{nethack.js,nethack.wasm,tiles16.png,tiles-dawnlike.png} vendor50/
cp build50/out/nh50consts.js web/js/
python3 art/make_art.py art/out              # icon and title art
tools/assemble.sh 5.0 dist/50                # web app in dist/50 (serve it with any static server)
npm ci && npx cap sync android && (cd android && ./gradlew assembleRelease)
```

## Tests
Browser tests use Playwright with Chrome (`pip install playwright`); build the site first (`tools/assemble.sh 5.0 dist/50`).

| Command | Checks |
|---|---|
| `scripts/test50.sh` | NetHack 5.0 bridge in Node: boot, menus, commands, travel, save/restore, quit (12) |
| `python3 scripts/ui_test.py dist/50 5.0` | A full game on a phone screen: intro, d-pad, here-buttons, inventory, prompts, settings, auto-save, quit, summary (36) |
| `python3 scripts/features_test.py dist/50` | Starting options, custom action buttons, save backup and restore (10) |
| `python3 scripts/help_test.py dist/50` | Help screens and message hints; takes about 4 minutes (12) |
| `python3 scripts/layout_test.py dist/50` | Phone and tablet, upright and sideways; side-panel menus; swap sides (44) |
| `python3 scripts/android_test.py dist/50` | Title art and the Android bridge with a stand-in Capacitor: Back button, vibration, screen direction (21) |

`scripts/screenshots.py dist/50 <dir>` makes the store screenshots; `scripts/probe50.mjs` logs every callback of a raw NetHack build.

## Layout
- `web/` – the app (HTML, CSS, JS); `web/js/engine50.js` talks to NetHack, `web/js/app.js` is the touch UI.
- `patches/` – the small patch that builds NetHack 5.0 for WebAssembly.
- `tools/` – build scripts; `art/` – icon and title art generator; `scripts/` – browser tests (Playwright).
- `android/` – the Capacitor Android project (app id `io.github.reesekracus.mazesofmenace`).

See `CREDITS.md` for the people and projects this is built on.
