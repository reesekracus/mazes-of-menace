// Headless test: play a few scripted turns and print what the UI would see.
// Usage: node headless.mjs "<comma script>" [files.json] [out.json]
// Env: NH=50 to test the NetHack 5.0 bridge; NH_MODULE = path to a nethack.js build (overrides the default)
import fs from 'fs';
import { pathToFileURL } from 'url';
import { resolve } from 'path';

// NH=50 tests the 5.0 bridge (engine50.js + vendor50/nethack.js); otherwise 3.6.7 (engine.js, not in this repo).
const V50 = process.env.NH === '50';
const { startNetHack, collectPersistentFiles, COLNO, ROWNO } = await import(V50 ? '../web/js/engine50.js' : '../web/js/engine.js');
const modPath = process.env.NH_MODULE || (V50 ? new URL('../vendor50/nethack.js', import.meta.url).pathname : null);
const createModule = (await import(modPath ? pathToFileURL(resolve(modPath)).href : '@neth4ck/wasm-367')).default;
const script = (process.argv[2] || 'l,h,s,i,#pray,n,S,y').split(',');
const files = process.argv[3] ? JSON.parse(fs.readFileSync(process.argv[3], 'utf8')) : {};
for (const k in files) files[k] = Uint8Array.from(Buffer.from(files[k], 'base64'));
const grid = Array.from({ length: ROWNO }, () => Array(COLNO).fill(' '));
const msgs = [];
let lastStatus = {};
let M;
let done = false;

function nextInput(kind) {
  const s = script.shift();
  if (s === undefined) {
    if (!done) { done = true; report('script exhausted at ' + kind); }
    return null;
  }
  console.log(`  <${kind}> -> ${s}`);
  return s;
}
function report(why) {
  console.log('== ' + why);
  console.log(grid.map((r) => r.join('')).filter((l) => l.trim()).join('\n'));
  console.log('STATUS', Object.entries(lastStatus).map(([k, v]) => `${k}=${Array.isArray(v.value) ? v.value.join('+') : v.value.trim()}`).join(' '));
  console.log('MSGS', msgs.slice(-12).join(' | '));
  process.exit(0);
}

const ui = {
  onGlyph(x, y, c) { grid[y][x] = c.ch; if (c.ch === '@') globalThis.hero = [x, y]; },
  onClearMap() { for (const r of grid) r.fill(' '); },
  onMessage(s) { msgs.push(s); },
  onStatus(s) { lastStatus = s; },
  onConsole(s) { console.log('CONSOLE', s); },
  onExit(s) {
    console.log('EXIT', s);
    setTimeout(() => {
      const f = collectPersistentFiles(M);
      console.log('FILES', Object.keys(f).map((k) => `${k}(${f[k].length})`).join(' '));
      if (process.argv[4]) {
        const enc = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, Buffer.from(v).toString('base64')]));
        fs.writeFileSync(process.argv[4], JSON.stringify(enc));
      }
      report('exited');
    }, 50);
  },
  async getKey() {
    const s = nextInput('key');
    if (s == null) return new Promise(() => {});
    if (s === 'farclick') { const [hx, hy] = globalThis.hero; console.log('  hero at', hx, hy); return { click: { x: hx + 3, y: hy, mod: 1 } }; }
    if (s === 'clickfloor') { // click the nearest floor '.' at distance >= 2 from the hero
      const [hx, hy] = globalThis.hero;
      let best = null;
      for (let y = 0; y < ROWNO; y++) for (let x = 0; x < COLNO; x++) {
        const d = Math.max(Math.abs(x - hx), Math.abs(y - hy));
        if (grid[y][x] === '.' && d >= 2 && (!best || d < best.d)) best = { x, y, d };
      }
      if (!best) return this.getKey();
      globalThis.clickTarget = [best.x, best.y];
      console.log('  hero at', hx, hy, '-> click floor', best.x, best.y);
      return { click: { x: best.x, y: best.y, mod: 1 } };
    }
    if (s === 'where') { console.log('  hero now', globalThis.hero); return this.getKey(); }
    if (s.startsWith('click:')) { const [x, y] = s.slice(6).split('/').map(Number); return { click: { x, y, mod: 1 } }; }
    if (s.startsWith('#')) { script.unshift('ext:' + s.slice(1)); return { key: 35 }; }
    return { key: s === 'ESC' ? 27 : s === 'RET' ? 13 : s.charCodeAt(0) };
  },
  async more() { msgs.push('--More--'); },
  async yn(q, resp, def) {
    msgs.push(`[yn] ${q} (${resp}) def=${def}`);
    const s = nextInput('yn');
    if (s == null) return new Promise(() => {});
    return s === 'ESC' ? 27 : s.charCodeAt(0);
  },
  async menu({ how, prompt, items }) {
    console.log(`  MENU ${how} "${prompt}"\n` + items.slice(0, Number(process.env.NH_MENUMAX || 14)).map((i) => `    ${i.ch || ' '} ${i.id ? '' : '#'} ${i.str}`).join('\n'));
    if (how === 'PICK_NONE') return [];
    const s = nextInput('menu');
    if (s == null) return new Promise(() => {});
    if (s === 'ESC') return null;
    return items.filter((i) => i.id && i.ch === s).map((i) => ({ id: i.id, count: -1 }));
  },
  onDisplayFile(f) { console.log('  DISPLAY_FILE', f); },
  async text(lines) { if (process.env.NH_FULLTEXT) { console.log(lines.map((l) => 'T| ' + l.str).join('\n')); return; } console.log('  TEXT: ' + lines.slice(0, 3).map((l) => l.str).join(' / ') + ` ... (${lines.length} lines)`); },
  async getline(q) { msgs.push(`[getline] ${q}`); const s = nextInput('getline'); return s; },
  async extcmd(names) {
    const s = nextInput('ext');
    const nm = s?.replace(/^ext:/, '');
    console.log('  EXT ->', nm, names.includes(nm));
    return nm;
  },
};

M = await startNetHack({ createModule, ui, options: 'name:Greg,role:Valkyrie,mouse_support,hilite_pet,time,showexp,autopickup,pickup_types:$' + (V50 ? ',!tutorial' : ''), files });
setTimeout(() => report('timeout'), 20000);
