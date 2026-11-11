"""Store screenshots for the Fastlane listing.
Usage: python3 scripts/screenshots.py <site dir> <out dir>
Phone 1080x2340 (360x780 at 3x) upright shots, plus one sideways shot: title, a game, inventory, More list, Help, sideways.
"""
import http.server, socketserver, threading, functools, sys, os
from playwright.sync_api import sync_playwright

site, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)

class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript', '.wasm': 'application/wasm'}
srv = socketserver.TCPServer(('127.0.0.1', 0), functools.partial(Q, directory=site))
threading.Thread(target=srv.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{srv.server_address[1]}/index.html'

def start(pg, role, name):
    pg.goto(url); pg.wait_for_selector('#newgame:not([disabled])', timeout=30000)
    pg.select_option('#prole', role); pg.fill('#pname', name); pg.click('#newgame')
    pg.wait_for_selector('#start', state='hidden', timeout=30000)
    for _ in range(30):
        pg.wait_for_timeout(300)
        if pg.locator('#sheet').is_visible():
            if 'tutorial' in pg.locator('#sheettitle').inner_text().lower():
                pg.locator('#sheetbody .mi', has_text='No, just start').click()
            else:
                pg.locator('#sheetbtns button').last.click()
            continue
        if pg.locator('#veil').is_visible(): pg.locator('#veil').dispatch_event('pointerdown'); continue
        if name in pg.locator('#status').inner_text(): break

def walk(pg, dirs):
    for d in dirs:
        b = pg.locator(f'#dpad button[data-dir="{d}"]')
        b.dispatch_event('pointerdown'); pg.wait_for_timeout(650); b.dispatch_event('pointerup'); pg.wait_for_timeout(500)
        for _ in range(4):
            if pg.locator('#veil').is_visible(): pg.locator('#veil').dispatch_event('pointerdown'); pg.wait_for_timeout(200)
            elif pg.locator('#sheet').is_visible(): pg.locator('#sheetbtns button').last.click(); pg.wait_for_timeout(200)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = b.new_context(viewport={'width': 360, 'height': 780}, is_mobile=True, has_touch=True, device_scale_factor=3)
    pg = ctx.new_page()
    pg.goto(url); pg.wait_for_selector('#newgame:not([disabled])', timeout=30000)
    pg.select_option('#prole', 'valkyrie'); pg.fill('#pname', 'Brunhilde'); pg.wait_for_timeout(300)
    pg.evaluate("document.activeElement.blur(); document.querySelector('#start').scrollTop = 0"); pg.wait_for_timeout(200)
    pg.screenshot(path=f'{out}/1.png')
    start(pg, 'valkyrie', 'Brunhilde')
    walk(pg, 'llllhhhhjjkk')
    pg.screenshot(path=f'{out}/2.png')
    pg.locator('#actions button[data-act="Inventory"]').click(); pg.wait_for_timeout(500)
    pg.screenshot(path=f'{out}/3.png')
    pg.locator('#sheetbtns button').last.click(); pg.wait_for_timeout(300)
    pg.locator('#actions button.more').click(); pg.wait_for_timeout(500)
    pg.screenshot(path=f'{out}/4.png')
    pg.locator('#sheetbody .cmd', has_text='Help').first.click(); pg.wait_for_timeout(400)
    pg.screenshot(path=f'{out}/5.png')
    ctx.close()
    ctx = b.new_context(viewport={'width': 780, 'height': 360}, is_mobile=True, has_touch=True, device_scale_factor=3)
    pg = ctx.new_page()
    start(pg, 'wizard', 'Merlin')
    walk(pg, 'hhhhllllkkjj')
    pg.screenshot(path=f'{out}/6.png')
    b.close()
srv.shutdown()
print('screenshots in', out)
