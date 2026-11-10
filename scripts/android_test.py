"""Checks the Android (Capacitor) bridge and the new title screen with a fake Capacitor object.
Usage: python3 scripts/android_test.py <site dir> [shots dir]
Back button: closes menus, offers Save and quit in play, leaves the app on the title screen. Haptics go to the plugin.
"""
import http.server, socketserver, threading, functools, sys, os, re
from playwright.sync_api import sync_playwright

site = sys.argv[1]
shots = sys.argv[2] if len(sys.argv) > 2 else '/tmp/shots'
os.makedirs(shots, exist_ok=True)

class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript', '.wasm': 'application/wasm'}
srv = socketserver.TCPServer(('127.0.0.1', 0), functools.partial(Q, directory=site))
threading.Thread(target=srv.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{srv.server_address[1]}/index.html'

FAKE = """
window.__hap = []; window.__exited = false; window.__sb = [];
const ok = () => Promise.resolve();
window.Capacitor = { isNativePlatform: () => true, Plugins: {
  Haptics: { vibrate: (o) => { window.__hap.push(o.duration); return ok(); } },
  App: { addListener: (n, f) => { if (n === 'backButton') window.__back = f; }, exitApp: () => { window.__exited = true; } },
  StatusBar: { setOverlaysWebView: (o) => { window.__sb.push('overlay'); return ok(); },
               setBackgroundColor: (o) => { window.__sb.push(o.color); return ok(); }, setStyle: (o) => { window.__sb.push(o.style); return ok(); } } } };
"""
results, errors = [], []
def check(name, ok, info=''):
    results.append(bool(ok))
    print(('ok   ' if ok else 'FAIL ') + name + (f'  [{info}]' if info and not ok else ''))

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = b.new_context(viewport={'width': 393, 'height': 851}, is_mobile=True, has_touch=True, device_scale_factor=2)
    ctx.add_init_script(FAKE)
    pg = ctx.new_page()
    pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errors.append(str(e)))
    sheet_open = lambda: pg.locator('#sheet').is_visible()
    title = lambda: pg.locator('#sheettitle').inner_text() if sheet_open() else ''
    st = lambda: pg.locator('#status').inner_text()
    back = lambda: (pg.evaluate('window.__back && window.__back()'), pg.wait_for_timeout(400))

    pg.goto(url)
    pg.wait_for_selector('#newgame:not([disabled])', timeout=30000)
    check('page title renamed', pg.title().startswith('Mazes of Menace'), pg.title())
    logo = pg.evaluate("(() => { const i = document.querySelector('#logo'); return [i.complete, i.naturalWidth, Math.round(i.getBoundingClientRect().width)]; })()")
    check('title art loads', logo[0] and logo[1] == 120 and logo[2] >= 300, str(logo))
    check('subtitle says NetHack 5.0', pg.locator('#start .sub:not(#loadmsg)').inner_text() == 'NetHack 5.0')
    check('no "Pocket Yendor" on the title screen', 'Pocket' not in pg.locator('#start').inner_text())
    check('back button listener registered', pg.evaluate('typeof window.__back') == 'function')
    check('status bar set up', pg.evaluate('window.__sb').count('#0d0f12') == 1, str(pg.evaluate('window.__sb')))
    pg.screenshot(path=f'{shots}/android-0-title.png')

    pg.select_option('#prole', 'valkyrie'); pg.fill('#pname', 'Droid'); pg.click('#newgame')
    pg.wait_for_selector('#start', state='hidden', timeout=30000)
    for _ in range(30):
        pg.wait_for_timeout(300)
        if 'tutorial' in title().lower():
            pg.locator('#sheetbody .mi', has_text='No, just start').click(); continue
        if pg.locator('#veil').is_visible():
            back(); continue                      # Back dismisses --More--
        if sheet_open():
            back(); continue                      # Back closes text windows
        if 'Droid' in st(): break
    check('game started; Back cleared intro screens', 'Droid' in st() and not sheet_open(), title() or st()[:80])

    pg.locator('#actions button[data-act="Inventory"]').click(); pg.wait_for_selector('#sheet:not([hidden])')
    back(); pg.wait_for_timeout(300)
    check('Back closes the inventory', not sheet_open(), title())
    pg.locator('#actions button.more').click(); pg.wait_for_selector('#sheet:not([hidden])')
    back()
    check('Back closes the More list', not sheet_open(), title())
    pg.locator('#actions button[data-act="Kick"]').click(); pg.wait_for_timeout(500)
    back(); pg.wait_for_timeout(300)
    check('Back cancels a direction question', not sheet_open(), title())

    btn = pg.locator('#dpad button[data-dir="l"]')
    btn.dispatch_event('pointerdown'); pg.wait_for_timeout(700); btn.dispatch_event('pointerup'); pg.wait_for_timeout(800)
    check('haptics go to the Capacitor plugin', 15 in pg.evaluate('window.__hap'), str(pg.evaluate('window.__hap')))
    for _ in range(6):
        if pg.locator('#veil').is_visible() or sheet_open(): back()

    back(); pg.wait_for_timeout(500)
    t = title()
    check('Back in play offers Save and quit', 'save' in t.lower(), t)
    pg.screenshot(path=f'{shots}/android-1-back-save.png')
    for _ in range(20):
        yes = pg.locator('#sheet button', has_text='Yes')
        if 'save' in title().lower() and yes.count():
            yes.first.click()
        elif title() == 'Game saved':
            back()                                # Back on "Game saved" returns to the title screen
        pg.wait_for_timeout(400)
        if pg.locator('#start').is_visible(): break
        if pg.locator('#veil').is_visible(): pg.locator('#veil').dispatch_event('pointerdown')
    pg.wait_for_selector('#newgame:not([disabled])', timeout=15000)
    check('saved and back on the title screen', 'Droid' in pg.locator('#saves').inner_text(), pg.locator('#saves').inner_text())
    back()
    check('Back on the title screen leaves the app', pg.evaluate('window.__exited'))
    check('no console errors', not errors, ' | '.join(errors[:4]))
    b.close()
srv.shutdown()
print(f'{sum(results)} passed, {len(results) - sum(results)} failed')
sys.exit(0 if all(results) else 1)
