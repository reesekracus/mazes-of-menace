"""Phone-viewport test of the title-screen options, quick bar, settings and save backup/restore.
Usage: python3 scripts/features_test.py <site dir> [shots dir]  (5.0 build)
"""
import os
import sys,re,json,http.server,socketserver,functools,threading
from playwright.sync_api import sync_playwright
site=sys.argv[1]
shots=sys.argv[2] if len(sys.argv)>2 else '/tmp/shots'; os.makedirs(shots, exist_ok=True)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*a):pass
    extensions_map={**http.server.SimpleHTTPRequestHandler.extensions_map,'.js':'text/javascript','.wasm':'application/wasm'}
srv=socketserver.TCPServer(('127.0.0.1',0),functools.partial(Q,directory=site));threading.Thread(target=srv.serve_forever,daemon=True).start()
res=[]
def check(n,ok,info=''): res.append(ok); print(('ok   ' if ok else 'FAIL ')+n+('' if ok else f'  [{info}]'))
with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox'])
    ctx=b.new_context(viewport={'width':393,'height':851},is_mobile=True,has_touch=True,device_scale_factor=2,accept_downloads=True)
    pg=ctx.new_page(); errs=[]
    pg.on('pageerror',lambda e: errs.append(str(e))); pg.on('console',lambda m: errs.append(m.text) if m.type=='error' else None)
    pg.add_init_script("window.__vib=[]; navigator.vibrate = (p) => { window.__vib.push(p); return true; };")
    pg.goto(f'http://127.0.0.1:{srv.server_address[1]}/index.html'); pg.wait_for_selector('#newgame:not([disabled])')
    pg.click('#moreopts summary')
    pg.screenshot(path=shots + '/f-title-options.png', full_page=True)
    pg.select_option('#prole','valkyrie'); pg.fill('#pname','Opty')
    pg.select_option('#ppet','dog'); pg.fill('#ppetname','Rex, the: Great'); pg.fill('#pfruit','mango'); pg.select_option('#ppickup','off')
    pg.click('#newgame'); pg.wait_for_selector('#start',state='hidden')
    for _ in range(14):
        pg.wait_for_timeout(300)
        if pg.locator('#veil').is_visible(): pg.locator('#veil').dispatch_event('pointerdown')
        elif pg.locator('#sheet').is_visible():
            if 'tutorial' in pg.locator('#sheettitle').inner_text().lower(): pg.locator('#sheetbody .mi',has_text='No, just start').click()
            else: pg.locator('#sheetbtns button').first.click()
    d=pg.evaluate('__pyDebug()')
    check('options passed', 'pettype:dog' in d['opts'] and 'dogname:Rex the Great' in d['opts'] and 'fruit:mango' in d['opts'] and '!autopickup' in d['opts'], d['opts'])
    # look at the pet: farlook (;), move the cursor onto it, select (.)
    if d['pets']:
        px,py=d['pets'][0]
        pg.keyboard.press(';')
        pg.wait_for_timeout(300)
        # move cursor from hero to pet with direction keys
        hx,hy=d['hero']; dx,dy=px-hx,py-hy
        keys={(1,0):'l',(-1,0):'h',(0,1):'j',(0,-1):'k',(1,1):'n',(-1,-1):'y',(1,-1):'u',(-1,1):'b'}
        while dx or dy:
            sx=(dx>0)-(dx<0); sy=(dy>0)-(dy<0); pg.keyboard.press(keys[(sx,sy)]); dx-=sx; dy-=sy
        pg.keyboard.press('.'); pg.wait_for_timeout(600)
        txt=pg.locator('#msgs').inner_text()+pg.locator('#sheet').inner_text()
        check('pet is a little dog named Rex', re.search(r'little dog.*Rex', txt) is not None, txt[-300:])
        for _ in range(3):
            if pg.locator('#veil').is_visible(): pg.locator('#veil').dispatch_event('pointerdown'); pg.wait_for_timeout(200)
            if pg.locator('#sheet').is_visible(): pg.locator('#sheetbtns button').first.click(); pg.wait_for_timeout(200)
    else: check('pet visible', False, 'no pet glyph')
    # quick bar: change slot 'Wield' to 'Pray'
    pg.locator('#actions button.more').click(); pg.locator('#sheetbody .cmd',has_text='Settings').click()
    pg.locator('#sheetbody .cmd',has_text='Customize the action buttons').click()
    pg.screenshot(path=shots + '/f-quickbar.png')
    pg.locator('#sheetbody .qgrid button',has_text=re.compile('^Wield$')).click()
    pg.fill('#sheetbody input.search','pray'); pg.locator('#sheetbody .cmd',has_text=re.compile('^Pray')).first.click()
    pg.locator('#sheetbtns button',has_text='Done').click(); pg.locator('#sheetbtns button',has_text='Done').click()
    acts=pg.locator('#actions button').all_inner_texts()
    check('quick bar shows Pray instead of Wield', 'Pray' in acts and 'Wield' not in acts and acts[-1]=='More' and len(acts)==12, str(acts))
    pg.locator('#actions button[data-act="Pray"]').click(); pg.wait_for_timeout(500)
    t=pg.locator('#sheettitle').inner_text() if pg.locator('#sheet').is_visible() else ''
    check('Pray button asks to pray', 'pray' in t.lower(), t)
    if pg.locator('#sheet').is_visible(): pg.locator('#sheetbody button, #sheetbtns button',has_text=re.compile('^(No|Cancel)$')).first.click()
    pg.wait_for_timeout(300)
    # vibrate switch present (vibration on damage itself was checked by kicking a wall: one 35 ms pulse)
    pg.locator('#actions button.more').click(); pg.locator('#sheetbody .cmd',has_text='Settings').click()
    body=pg.locator('#sheetbody').inner_text()
    check('settings has vibrate switch', 'Vibrate when you take damage' in body, body)
    pg.locator('#sheetbtns button',has_text='Done').click()
    # quit and check backup
    pg.locator('#actions button.more').click(); pg.fill('#sheetbody input.search','save and quit'); pg.locator('#sheetbody .cmd',has_text='Save and quit').first.click()
    for _ in range(20):
        pg.wait_for_timeout(300)
        t=pg.locator('#sheettitle').inner_text() if pg.locator('#sheet').is_visible() else ''
        if 'Really save' in t: pg.locator('#sheet button',has_text='Yes').first.click()
        if pg.locator('#veil').is_visible(): pg.locator('#veil').dispatch_event('pointerdown')
        if t=='Game saved': break
    pg.locator('#sheetbtns button',has_text='Back to title').click(); pg.wait_for_selector('#newgame:not([disabled])')
    with pg.expect_download() as dl:
        pg.click('#exportsaves')
    path=dl.value.path(); data=json.load(open(path))
    check('backup holds the save', any(k.startswith('/save/') and 'Opty' in k for k in data['files']), list(data['files']))
    # delete the save, then restore from backup
    pg.locator('#saves .del').first.click(); pg.locator('#sheetbtns button',has_text='Delete').click(); pg.wait_for_timeout(500)
    check('save deleted', pg.locator('#saves .row').count()==0)
    pg.set_input_files('#importfile', path); pg.wait_for_timeout(500)
    t=pg.locator('#sheettitle').inner_text()
    check('restore asks first', 'Opty' in t, t)
    pg.locator('#sheetbtns button',has_text='Restore').click(); pg.wait_for_timeout(800)
    check('save is back', 'Continue Opty' in pg.locator('#saves').inner_text(), pg.locator('#saves').inner_text())
    pg.screenshot(path=shots + '/f-title-restored.png', full_page=True)
    check('no page errors', not errs, errs[:3])
    b.close()
srv.shutdown()
print('features: passed',sum(res),'of',len(res)); sys.exit(0 if all(res) else 1)
