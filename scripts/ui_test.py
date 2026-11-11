"""Phone-viewport UI test for an assembled site (tools/assemble.sh).
Usage: python3 scripts/ui_test.py <site dir> <label> [shots dir]
Plays: new game -> intro -> move -> inventory/item actions -> settings -> auto-save+resume -> quit -> game over.
"""
import http.server, socketserver, threading, functools, sys, os, re, time
from playwright.sync_api import sync_playwright

site, label = sys.argv[1], sys.argv[2]
shots = sys.argv[3] if len(sys.argv) > 3 else '/tmp/shots'
os.makedirs(shots, exist_ok=True)

class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript', '.wasm': 'application/wasm'}
srv = socketserver.TCPServer(('127.0.0.1', 0), functools.partial(Q, directory=site))
threading.Thread(target=srv.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{srv.server_address[1]}/index.html'

results, errors = [], []
def check(name, ok, info=''):
    results.append((name, bool(ok)))
    print(('ok   ' if ok else 'FAIL ') + name + (f'  [{info}]' if info and not ok else ''))

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = b.new_context(viewport={'width': 393, 'height': 851}, is_mobile=True, has_touch=True, device_scale_factor=2)
    pg = ctx.new_page()
    pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errors.append(str(e)))

    def sheet_open(): return pg.locator('#sheet').is_visible()
    def sheet_title(): return pg.locator('#sheettitle').inner_text() if sheet_open() else ''
    def st(): return pg.locator('#status').inner_text()
    def msgs(): return pg.locator('#msgs').inner_text()
    def settle(max_steps=12, stop=None):
        """Dismiss --More-- and text/OK sheets until the game waits for a command (or stop() is true)."""
        for _ in range(max_steps):
            pg.wait_for_timeout(250)
            if stop and stop(): return
            if pg.locator('#veil').is_visible():
                pg.locator('#veil').dispatch_event('pointerdown'); continue
            if sheet_open():
                btns = pg.locator('#sheetbtns button')
                names = [btns.nth(i).inner_text() for i in range(btns.count())]
                for want in ('OK', 'Close', 'Done'):
                    if want in names:
                        btns.nth(names.index(want)).click(); break
                else:
                    return
                continue
            return

    def dismiss_any(where):
        """Close a game question left open by scripted steps (e.g. 'Really attack?'), logging it."""
        for _ in range(4):
            if pg.locator('#veil').is_visible():
                pg.locator('#veil').dispatch_event('pointerdown'); pg.wait_for_timeout(250); continue
            if not sheet_open(): return
            print(f'  ({where}) closing sheet: {sheet_title()!r}')
            for want in ('Not now', 'No', 'Cancel', 'Close', 'OK', 'Done'):
                loc = pg.locator('#sheetbtns button, #sheetbody .choices button', has_text=re.compile('^' + want + '$'))
                if loc.count():
                    loc.first.click(); break
            pg.wait_for_timeout(300)

    pg.goto(url)
    pg.wait_for_selector('#newgame:not([disabled])', timeout=30000)
    check('title shows version', label in pg.locator('#start .sub:not(#loadmsg)').inner_text(), pg.locator('#start .sub:not(#loadmsg)').inner_text())
    pg.select_option('#prole', 'valkyrie')
    pg.fill('#pname', 'Tester')
    pg.click('#newgame')
    pg.wait_for_selector('#start', state='hidden', timeout=30000)
    # Intro text, then the game waits for a command. 5.0 asks about the tutorial (on by default); answer No.
    saw_tutorial = False
    for _ in range(15):
        pg.wait_for_timeout(300)
        if 'tutorial' in sheet_title().lower():
            saw_tutorial = True
            body = pg.locator('#sheetbody').inner_text()
            check('tutorial question has no config-file hint', 'nethackrc' not in body and 'OPTIONS' not in body, body)
            pg.locator('#sheetbody .mi', has_text='No, just start').click()
            continue
        if not sheet_open() and not pg.locator('#veil').is_visible() and 'Tester' in st(): break
        settle(1)
    check('tutorial prompt ' + ('asked (on by default)' if label == '5.0' else 'absent'), saw_tutorial == (label == '5.0'))
    check('status line shows hero', re.search(r'Tester the Stripling', st()), st())
    check('welcome message', 'welcome to NetHack' in msgs(), msgs())
    fit = pg.evaluate("[...document.querySelectorAll('#status .stline')].map(e => e.scrollWidth <= e.clientWidth + 1)")
    check('status: three lines, none cut off', len(fit) == 3 and all(fit), str(fit))
    check('status shows all six attributes', all(k in st() for k in ('St:', 'Dx:', 'Co:', 'In:', 'Wi:', 'Ch:')), st())
    pg.wait_for_timeout(500)
    pg.screenshot(path=f'{shots}/{label}-1-start.png')

    # here-buttons: step off the starting up-staircase and back onto it; buttons appear, no pop-up
    def step(d):
        btn = pg.locator(f'#dpad button[data-dir="{d}"]')
        btn.dispatch_event('pointerdown'); btn.dispatch_event('pointerup'); pg.wait_for_timeout(450)
    def cap(): return pg.locator('#chips .cap').inner_text() if pg.locator('#chips .cap').count() else ''
    opp = {'l': 'h', 'h': 'l', 'j': 'k', 'k': 'j', 'y': 'n', 'n': 'y', 'u': 'b', 'b': 'u'}
    back_on = False; popped = False
    for d in ('l', 'h', 'j', 'k', 'y', 'u', 'b', 'n'):
        t0 = re.search(r'T:(\d+)', st()).group(1)
        step(d); settle(2)
        if re.search(r'T:(\d+)', st()).group(1) == t0:
            continue  # blocked, try another direction
        step(opp[d])
        popped = sheet_open()
        settle(2)
        if 'Stairs up' in cap(): back_on = True; break
    check('stairs show here-buttons', back_on, cap())
    check('no pop-up when stopping on stairs', not popped, sheet_title())
    if back_on:
        chips = pg.locator('#chips button').all_inner_texts()
        check('here-buttons offer Go up and More', any('Go up' in x for x in chips) and any('More' in x for x in chips), str(chips))
        pg.screenshot(path=f'{shots}/{label}-2c-here-buttons.png')

    dismiss_any('after here-buttons test')
    # move with the d-pad (tap each direction once; at least one should succeed)
    t0 = re.search(r'T:(\d+)', st()).group(1)
    for k in ('l', 'h', 'j', 'k'):
        btn = pg.locator(f'#dpad button[data-dir="{k}"]')
        btn.dispatch_event('pointerdown'); btn.dispatch_event('pointerup'); settle(3)
        if sheet_open() and 'Not now' in pg.locator('#sheetbtns').inner_text():
            pg.locator('#sheetbtns button', has_text='Not now').click()
    t1 = re.search(r'T:(\d+)', st()).group(1)
    check('d-pad moves (turn counter advanced)', int(t1) > int(t0), f'{t0}->{t1} sheet={sheet_title()!r} msgs={msgs()[-120:]!r}')
    if sheet_open():
        pg.screenshot(path=f'{shots}/{label}-x-unexpected-sheet.png')
        print('  open sheet after d-pad:', repr(sheet_title()), pg.locator('#sheetbtns').inner_text().replace(chr(10), ' | '))

    dismiss_any('after d-pad test')
    # touch-only UI: no keyboard symbols on buttons
    acts = [pg.locator('#actions button').nth(i).inner_text().strip() for i in range(pg.locator('#actions button').count())]
    check('action buttons show words, not keys', all(len(a) > 2 and not re.search(r"\^|^[#,:<>]", a) for a in acts), str(acts))
    dpad_mid = pg.locator('#dpad .mid').inner_text().strip()
    check('d-pad centre says Search', dpad_mid == 'Search', dpad_mid)

    # inventory -> item actions
    pg.locator('#actions button[data-act="Inventory"]').click()
    pg.wait_for_selector('#sheet:not([hidden])', timeout=5000)
    check('inventory sheet title', 'Inventory' in sheet_title(), sheet_title())
    check('no item letters in menus', pg.locator('#sheetbody .acc').count() == 0)
    if label == '5.0':
        icons = pg.locator('#sheetbody .mi .ico[style*="tiles"]').count()
        check('inventory rows show item pictures', icons >= 3, str(icons))
    pg.locator('#sheetbody .mi').first.click()
    pg.wait_for_timeout(500)
    t = sheet_title()
    if label == '5.0':
        check("5.0: NetHack's own item menu", t.startswith('Do what with'), t)
        body_txt = pg.locator('#sheetbody').inner_text()
        check('item menu has no key references', not re.search(r"'.'|assigning new letter", body_txt), body_txt[:300])
        check('rows without pictures have no gap', pg.locator('#sheetbody .ico').count() == 0)
    else:
        check('3.6.7: app item action sheet (no letter in title)', pg.locator('#sheetbody .acts').count() == 1 and not re.match(r'^[a-zA-Z] – ', t), t)
    pg.screenshot(path=f'{shots}/{label}-2-item-actions.png')
    # back out
    btns = pg.locator('#sheetbtns button')
    names = [btns.nth(i).inner_text() for i in range(btns.count())]
    btns.nth(names.index('Cancel') if 'Cancel' in names else names.index('Close')).click()
    settle(4)
    check('back to map after cancel', not sheet_open(), sheet_title())

    # item prompt goes straight to a list of items (no letter buttons)
    pg.locator('#actions button[data-act="Eat"]').click()
    pg.wait_for_timeout(700)
    t = sheet_title()
    rows = pg.locator('#sheetbody .mi').count()
    check('"what to eat" opens the item list', 'eat' in t.lower() and rows >= 1 and pg.locator('#sheetbody .choices').count() == 0, f'{t} rows={rows}')
    pg.screenshot(path=f'{shots}/{label}-2b-eat-list.png')
    pg.locator('#sheetbtns button', has_text='Cancel').click()
    settle(4)

    # direction prompt uses words for self/up/down
    pg.locator('#actions button[data-act="Kick"]').click()
    pg.wait_for_timeout(500)
    grid = pg.locator('#sheetbody .dirgrid').inner_text() if pg.locator('#sheetbody .dirgrid').count() else ''
    check('direction grid: Self/Up/Down words', all(w in grid for w in ('Self', 'Up', 'Down')), grid)
    pg.locator('#sheetbtns button', has_text='Cancel').click()
    settle(4)

    # settings (More -> Settings)
    pg.locator('#actions button.more').click()
    pg.locator('#sheetbody .cmd', has_text='Settings').click()
    body = pg.locator('#sheetbody').inner_text()
    has_tut = 'tutorial' in body.lower()
    check('settings tutorial toggle ' + ('present' if label == '5.0' else 'absent'), has_tut == (label == '5.0'), body)
    pg.screenshot(path=f'{shots}/{label}-3-settings.png')
    pg.locator('#sheetbtns button', has_text='Done').click()

    # palette shows commands, hides internal ones
    pg.locator('#actions button.more').click()
    pal = pg.locator('#sheetbody').inner_text()
    check('palette lists Pray by name', re.search(r'^Pray', pal, re.M) is not None, pal[:300])
    check('palette shows no #commands or key hints', '#' not in pal and not re.search(r'\^[A-Z]', pal), pal[:300])
    check('palette hides internal cmds', not re.search(r'(?i)^(movewest|clicklook|mouseaction|wizwish|debugfuzzer)\b', pal, re.M))
    pg.locator('#sheetbtns button', has_text='Close').click()

    # auto-save + seamless resume (pagehide while visible -> save, then resume immediately)
    before = st()
    pg.evaluate("window.dispatchEvent(new Event('pagehide'))")
    ok = False
    for _ in range(40):
        pg.wait_for_timeout(250)
        if not pg.locator('#start').is_visible() and 'Tester' in st() and not sheet_open():
            ok = True
            break
    pg.wait_for_timeout(800)
    check('auto-save + resume returns to the game', ok and 'Tester' in st(), sheet_title() or st())
    check('resume hides restore chatter', 'welcome back' not in msgs(), msgs())
    moon = re.findall(r'(?:New|Full) moon tonight', pg.evaluate("document.querySelector('#msgs').innerText"))
    check('resume does not repeat the moon message', len(moon) <= 1, str(moon))

    # quit via the extended command palette
    pg.locator('#actions button.more').click()
    pg.wait_for_selector('#sheet:not([hidden])')
    pg.fill('#sheetbody input.search', 'quit')
    pg.locator('#sheetbody .cmd', has_text=re.compile(r'^Quit')).first.click()
    over = False
    for _ in range(40):
        pg.wait_for_timeout(300)
        t = sheet_title()
        if t == 'Game over': over = True; break
        if 'Really quit' in t: pg.locator('#sheetbtns button, #sheetbody button', has_text='Yes').first.click(); continue
        if 'possessions identified' in t: pg.locator('#sheetbody button', has_text='Quit').first.click(); continue
        settle(1)
    check('quit reaches Game over screen', over, sheet_title())
    pg.screenshot(path=f'{shots}/{label}-4-game-over.png')
    if over and label == '5.0':
        go = pg.locator('#sheetbody').inner_text()
        check('game over says how it ended', go.startswith('You quit in'), go[:120])
        check('no summary headers in messages', not re.search(r'^(Spells|Skills):$', msgs(), re.M), msgs())
        pg.locator('#sheetbtns button', has_text='Full summary').click(); pg.wait_for_timeout(300)
        dump = pg.locator('#sheetbody').inner_text()
        check('full summary shows NetHack dumplog', 'Inventory:' in dump and 'Tester the Valkyrie...' in dump, dump[-900:])
        pg.locator('#sheetbtns button', has_text='Back').click(); pg.wait_for_timeout(200)
    if over:
        pg.locator('#sheetbtns button', has_text='Back to title').click()
        pg.wait_for_selector('#newgame:not([disabled])', timeout=10000)
        check('back to title', pg.locator('#start').is_visible())
        if label == '5.0':
            pg.wait_for_timeout(300)
            pg.click('#pastgames'); pg.wait_for_timeout(300)
            check('past games lists the game', 'Tester' in pg.locator('#sheetbody').inner_text(), pg.locator('#sheetbody').inner_text())
            pg.locator('#sheetbtns button', has_text='Close').click()

    real_errors = [e for e in errors if 'favicon' not in e]
    check('no console errors', not real_errors, ' | '.join(real_errors[:5]))
    b.close()
srv.shutdown()
print(f"{label}: {sum(ok for _, ok in results)} passed, {sum(not ok for _, ok in results)} failed")
sys.exit(0 if all(ok for _, ok in results) else 1)
