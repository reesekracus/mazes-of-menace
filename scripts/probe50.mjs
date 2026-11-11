// Probe a raw NetHack WASM build: log every shim callback, return type-correct defaults.
// Usage: node probe50.mjs /path/to/nethack.js [maxCallbacks]
import { pathToFileURL } from 'url';
import { resolve } from 'path';
const createModule = (await import(pathToFileURL(resolve(process.argv[2])).href)).default;
const max = Number(process.argv[3] || 400);
let n = 0, M;
const pairs = new Map();
const seen = new Map();
const keys = [27, 27, 'S'.charCodeAt(0), 'y'.charCodeAt(0)]; // escape prompts, then save & quit
globalThis.probeCb = async (name, ...a) => {
  seen.set(name, (seen.get(name) || 0) + 1);
  if (++n <= 60 || /putstr|raw_print|exit|getlin|yn_function/.test(name)) {
    const show = a.map((v) => (typeof v === 'string' ? JSON.stringify(v.slice(0, 70)) : v)).join(', ');
    console.log(`${n} ${name}(${show})`);
  }
  if (n > max) { report('max callbacks'); }
  if (name === 'shim_print_glyph') {
    // glyph_info*: glyph@0, ttychar@4, color@16, tileidx@30 (i16). Record char -> tile seen on the map.
    const c = String.fromCharCode(M.getValue(a[3] + 4, 'i32') & 255);
    if (c !== ' ') pairs.set(c, M.getValue(a[3] + 30, 'i16'));
  }
  switch (name) {
    case 'shim_player_selection_or_tty': return false;
    case 'shim_create_nhwindow': return n;
    case 'shim_nhgetch': case 'shim_nh_poskey': return keys.length ? keys.shift() : 27;
    case 'shim_yn_function': return 'y'.charCodeAt(0);
    case 'shim_select_menu': return -1;
    case 'shim_get_ext_cmd': return -1;
    case 'shim_getmsghistory': return '';
    case 'shim_message_menu': return 0;
    default: return 0;
  }
};
function report(why) {
  console.log('== ' + why + '\nCALLBACK COUNTS', [...seen].map(([k, v]) => `${k}:${v}`).join(' '));
  const h = globalThis.nethackGlobal?.helpers || {};
  console.log('HELPERS', Object.keys(h).join(' '), '| CONSTANT SCOPES', Object.keys(globalThis.nethackGlobal?.constants || {}).join(' '));
  console.log('CH->TILE', [...pairs].map(([c, t]) => `${c}:${t}`).join(' '));
  process.exit(0);
}
const origErr = console.error;
console.error = (...x) => { if (x.some((v) => v?.name === 'ExitStatus')) report('exit'); else origErr(...x); };
M = await createModule({ noInitialRun: true, print: (s) => console.log('OUT', s), printErr: (s) => console.log('ERR', s),
  preRun: [(m) => { m.ENV.NETHACKOPTIONS = 'name:Greg,role:Valkyrie,race:human'; m.ENV.USER = 'player'; }] });
try { M.FS.mkdir('/save'); } catch { /* exists */ }
M.ccall('shim_graphics_set_callback', null, ['string'], ['probeCb']);
try { M._main(0, 0); } catch (e) { if (e?.name !== 'ExitStatus') console.log('main threw', e); }
setTimeout(() => report('timeout'), 15000);
