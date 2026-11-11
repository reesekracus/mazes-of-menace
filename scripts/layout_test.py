"""Layout check at phone and tablet sizes, upright and sideways (1.1.0).
Usage: python3 scripts/layout_test.py <site dir> [shots dir]
Starts one game per screen size, checks where the status, messages, map, d-pad and action buttons
sit, that nothing is off-screen or overlapping, and saves a screenshot of each.
"""
import http.server, socketserver, threading, functools, sys, os
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

SIZES = {'phone-up': (393, 851), 'narrow-up': (360, 780), 'phone-side': (851, 393), 'tablet-up': (800, 1280), 'tablet-side': (1280, 800)}
results = []
def check(name, ok, info=''):
    results.append(bool(ok))
    print(('ok   ' if ok else 'FAIL ') + name + (f'  [{info}]' if info and not ok else ''))

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    for label, (w, h) in SIZES.items():
        ctx = b.new_context(viewport={'width': w, 'height': h}, is_mobile=True, has_touch=True, device_scale_factor=2)
        pg = ctx.new_page(); errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto(url); pg.wait_for_selector('#newgame:not([disabled])', timeout=30000)
        lt = pg.evaluate("document.querySelector('#logo').getBoundingClientRect().top + document.querySelector('#start').scrollTop")
        check(f'{label}: title art reachable (not above the top)', lt >= 0, str(lt))
        pg.fill('#pname', 'Layout'); pg.click('#newgame'); pg.wait_for_selector('#start', state='hidden', timeout=30000)
        for _ in range(30):
            pg.wait_for_timeout(300)
            if pg.locator('#sheet').is_visible():
                if 'tutorial' in pg.locator('#sheettitle').inner_text().lower():
                    pg.locator('#sheetbody .mi', has_text='No, just start').click()
                else:
                    pg.locator('#sheetbtns button').last.click()
                continue
            if pg.locator('#veil').is_visible(): pg.locator('#veil').dispatch_event('pointerdown'); continue
            if 'Layout' in pg.locator('#status').inner_text(): break
        pg.wait_for_timeout(600)
        r = pg.evaluate("""() => Object.fromEntries(['#status', '#msgs', '#mapwrap', '#dpad', '#actions'].map(s => {
            const b = document.querySelector(s).getBoundingClientRect();
            return [s.slice(1), {l: Math.round(b.left), t: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom)}]; }))""")
        inside = all(v['l'] >= 0 and v['t'] >= 0 and v['r'] <= w + 1 and v['b'] <= h + 1 and v['r'] > v['l'] and v['b'] > v['t'] for v in r.values())
        check(f'{label}: every part on screen', inside, str(r))
        m, d, a, s, g = r['mapwrap'], r['dpad'], r['actions'], r['status'], r['msgs']
        overlap = lambda x, y: x['l'] < y['r'] and y['l'] < x['r'] and x['t'] < y['b'] and y['t'] < x['b']
        check(f'{label}: map overlaps nothing', not any(overlap(m, o) for o in (d, a, s, g)), str(r))
        btns = pg.locator('#actions button').count()
        hidden = pg.evaluate("[...document.querySelectorAll('#actions button')].filter(b => { const r = b.getBoundingClientRect(); return r.bottom > innerHeight || r.right > innerWidth; }).length")
        check(f'{label}: all {btns} action buttons visible', hidden == 0, f'{hidden} off-screen')
        pg.screenshot(path=f'{shots}/layout-{label}.png')
        if label == 'phone-side':
            check('phone-side: d-pad left of map, buttons right of map', d['r'] <= m['l'] and a['l'] >= m['r'], str(r))
            check('phone-side: status and messages above the map', s['b'] <= g['t'] + 1 and g['b'] <= m['t'] + 1 and s['l'] >= d['r'] - 1, str(r))
            check('phone-side: map gets most of the height', m['b'] - m['t'] > h * 0.6, str(m))
        if label == 'tablet-side':
            check('tablet-side: status and messages left of the map', s['r'] <= m['l'] and g['r'] <= m['l'] and s['b'] <= g['t'] + 1, str(r))
            check('tablet-side: buttons above d-pad, right of the map', a['l'] >= m['r'] and d['l'] >= m['r'] and a['b'] <= d['t'] + 1, str(r))
            check('tablet-side: tall message log', g['b'] - g['t'] > h * 0.5, str(g))
            check('tablet-side: status panel fits its text', s['b'] - s['t'] < 200, str(s))
        clipped = pg.evaluate("[...document.querySelectorAll('#actions button')].filter(b => b.scrollWidth > b.clientWidth + 1).map(b => b.textContent)")
        check(f'{label}: action button labels fit', not clipped, str(clipped))
        if label in ('phone-up', 'narrow-up', 'tablet-up'):
            check(f'{label}: upright stack (status, messages, map, controls)', s['b'] <= g['t'] + 1 and g['b'] <= m['t'] + 1 and m['b'] <= min(d['t'], a['t']) + 1, str(r))
        if label.endswith('side'):
            pg.locator('#actions button[data-act="Inventory"]').click(); pg.wait_for_selector('#sheet:not([hidden])')
            c = pg.evaluate("(() => { const b = document.querySelector('#sheetcard').getBoundingClientRect(); return [Math.round(b.left), Math.round(b.right), Math.round(b.top), Math.round(b.bottom)]; })()")
            check(f'{label}: menus open as a right-side panel', c[0] >= w * 0.35 and c[1] >= w - 1 and c[2] <= 1 and c[3] >= h - 1, str(c))
            pg.locator('#sheetbtns button', has_text='Close').first.click() if pg.locator('#sheetbtns button', has_text='Close').count() else pg.locator('#sheetbtns button').last.click()
            pg.wait_for_timeout(300)
            pg.evaluate("document.body.classList.add('swap')"); pg.wait_for_timeout(200)
            r2 = pg.evaluate("(() => Object.fromEntries(['#mapwrap', '#dpad', '#actions'].map(s => { const b = document.querySelector(s).getBoundingClientRect(); return [s.slice(1), [Math.round(b.left), Math.round(b.right)]]; })))()")
            if label == 'phone-side':
                check('phone-side: Swap sides puts the d-pad right, buttons left', r2['dpad'][0] >= r2['mapwrap'][1] and r2['actions'][1] <= r2['mapwrap'][0], str(r2))
            else:
                check('tablet-side: Swap sides moves the controls to the left', r2['dpad'][1] <= r2['mapwrap'][0] and r2['actions'][1] <= r2['mapwrap'][0], str(r2))
            pg.screenshot(path=f'{shots}/layout-{label}-swap.png')
            pg.evaluate("document.body.classList.remove('swap')")
        check(f'{label}: no page errors', not errors, ' | '.join(errors[:3]))
        ctx.close()
    b.close()
srv.shutdown()
print(f'{sum(results)} passed, {len(results) - sum(results)} failed')
sys.exit(0 if all(results) else 1)
