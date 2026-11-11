"""Phone-viewport test of the Help screens and message hints.
Usage: python3 scripts/help_test.py <site dir> [shots dir]  (5.0 build; ~4 min, it waits for hunger)
"""
import os, sys, re, http.server, socketserver, functools, threading
from playwright.sync_api import sync_playwright
site = sys.argv[1]
shots = sys.argv[2] if len(sys.argv) > 2 else '/tmp/shots'; os.makedirs(shots, exist_ok=True)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript', '.wasm': 'application/wasm'}
srv = socketserver.TCPServer(('127.0.0.1', 0), functools.partial(Q, directory=site)); threading.Thread(target=srv.serve_forever, daemon=True).start()
res = []
def check(n, ok, info=''): res.append(ok); print(('ok   ' if ok else 'FAIL ') + n + ('' if ok else f'  [{info}]'))
def settle(pg, n=8):
    for _ in range(n):
        pg.wait_for_timeout(250)
        if pg.locator('#veil').is_visible(): pg.locator('#veil').dispatch_event('pointerdown')
        elif pg.locator('#sheet').is_visible():
            if 'tutorial' in pg.locator('#sheettitle').inner_text().lower(): pg.locator('#sheetbody .mi', has_text='No, just start').click()
            else: pg.locator('#sheetbtns button').last.click()
        else: break
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = b.new_context(viewport={'width': 393, 'height': 851}, is_mobile=True, has_touch=True, device_scale_factor=2)
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    pg.goto(f'http://127.0.0.1:{srv.server_address[1]}/index.html'); pg.wait_for_selector('#newgame:not([disabled])')
    # title screen: How to play -> topic list -> a topic
    pg.click('#howtoplay')
    topics = pg.locator('#sheetbody .cmd').all_inner_texts()
    check('title: How to play lists the topics', len(topics) == 9 and 'Controls' in topics[0], str(topics))
    pg.screenshot(path=shots + '/h-topics.png')
    pg.locator('#sheetbody .cmd', has_text='Stuck?').click()
    body = pg.locator('#sheetbody').inner_text()
    check('topic opens with bullets and bold', pg.locator('#sheetbody li').count() >= 5 and pg.locator('#sheetbody b').count() >= 2 and 'Kick' in body, body[:200])
    check('help text uses no key letters', not re.search(r"\bpress\b|'[a-zA-Z]'|\^[A-Z]|#\w", body), body)
    pg.screenshot(path=shots + '/h-stuck.png')
    pg.locator('#sheetbtns button', has_text='Topics').click()
    check('Topics goes back to the list', pg.locator('#sheetbody .cmd').count() == 9)
    pg.locator('#sheetbtns button', has_text='Close').click()
    check('Close returns to the title', not pg.locator('#sheet').is_visible() and pg.locator('#start').is_visible())
    # every topic renders without leftover markup
    pg.click('#howtoplay'); bad = []
    for i in range(9):
        pg.locator('#sheetbody .cmd').nth(i).click()
        t = pg.locator('#sheetbody').inner_text()
        if '**' in t or re.search(r'^- ', t, re.M): bad.append(pg.locator('#sheettitle').inner_text())
        pg.locator('#sheetbtns button', has_text='Topics').click()
    check('all topics render cleanly', not bad, str(bad))
    pg.locator('#sheetbtns button', has_text='Close').click()
    # in game: More -> Help, Settings -> Help
    pg.select_option('#prole', 'valkyrie'); pg.fill('#pname', 'Helpy'); pg.click('#newgame'); pg.wait_for_selector('#start', state='hidden')
    settle(pg, 14)
    pg.locator('#actions button.more').click()
    pg.locator('#sheetbody .cmd', has_text='Help').first.click()
    check('More → Help opens the topics', pg.locator('#sheettitle').inner_text() == 'Help' and pg.locator('#sheetbody .cmd').count() == 9)
    pg.locator('#sheetbtns button', has_text='Close').click()
    pg.locator('#actions button.more').click(); pg.locator('#sheetbody .cmd', has_text='Settings').click()
    pg.locator('#sheetbody .cmd', has_text='Help and how to play').click()
    pg.locator('#sheetbody .cmd', has_text='Controls').click()
    pg.locator('#sheetbtns button', has_text='Close').click()
    check('Settings → Help closes back to Settings', pg.locator('#sheettitle').inner_text() == 'Settings')
    pg.locator('#sheetbtns button', has_text='Done').click()
    # hint: wait until hungry (search many turns), then a "? Hunger" button appears
    got = False
    for _ in range(25):
        if pg.locator('#chips button.hint').count(): got = True; break
        for k in '300s': pg.keyboard.press(k)
        n0 = pg.locator('#msgs').inner_text().count('You stop')
        for _ in range(60):
            if pg.evaluate("document.querySelector('#msgs').innerText").count('You stop') > n0 or 'misses' in pg.locator('#msgs').inner_text() or 'hits' in pg.locator('#msgs').inner_text():
                for d in 'hjklyubn': pg.keyboard.press('F'); pg.keyboard.press(d); pg.wait_for_timeout(80)
                break
            pg.wait_for_timeout(250)
            if pg.locator('#veil').is_visible(): pg.locator('#veil').dispatch_event('pointerdown')
            elif pg.locator('#sheet').is_visible(): pg.locator('#sheetbtns button').first.click()
            st = pg.locator('#st1').inner_text()
            if 'Hungry' in st or pg.locator('#chips button.hint').count(): break
        if pg.locator('#chips button.hint').count(): got = True; break
        if 'Hungry' in pg.locator('#st1').inner_text(): break
    hint = pg.locator('#chips button.hint')
    check('hunger message shows a "? Hunger" button', got and hint.inner_text() == '? Hunger', pg.locator('#msgs').inner_text()[-200:])
    if got:
        pg.screenshot(path=shots + '/h-hint.png')
        hint.click()
        check('hint opens the matching topic', pg.locator('#sheettitle').inner_text() == 'Eating and hunger')
        pg.screenshot(path=shots + '/h-hunger.png')
        pg.locator('#sheetbtns button', has_text='Close').click()
        for k in 'ssssssss': pg.keyboard.press(k); pg.wait_for_timeout(120)
        pg.wait_for_timeout(400)
        check('hint goes away after a few moves', pg.locator('#chips button.hint').count() == 0)
    check('no console errors', not errs, str(errs[:3]))
    b.close()
print(f'{sum(res)}/{len(res)} passed'); sys.exit(0 if all(res) else 1)
