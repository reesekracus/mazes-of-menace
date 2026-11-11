import createModule from '../vendor/nethack.js';
import { NH_VERSION } from './config.js';
import { HELP } from './help.js';

// One UI for both engines. vendor/ holds the matching nethack.js/.wasm and tiles16.png for each build.
const V50 = NH_VERSION === '5.0';
const { startNetHack, collectPersistentFiles, COLNO, ROWNO, EXT_CMDS } = await import(V50 ? './engine50.js' : './engine.js');
// Map feature (cmap) indices by name. 5.0's come from the build (nh50consts.js); 3.6.7's are its defsyms order.
const C50 = V50 ? await import('./nh50consts.js') : {};
const EXT_DESC = C50.EXT_DESC || {}; // NetHack's one-line description of each extended command (5.0 build)
const CM = V50 ? C50.CMAP : {
  S_ndoor: 12, S_vodoor: 13, S_hodoor: 14, S_vcdoor: 15, S_hcdoor: 16, S_room: 19, S_darkroom: 20, S_corr: 21, S_litcorr: 22,
  S_upstair: 23, S_dnstair: 24, S_upladder: 25, S_dnladder: 26, S_altar: 27, S_throne: 29, S_sink: 30, S_fountain: 31, S_arrow_trap: 42,
};

const $ = (s) => document.querySelector(s);
const el = (tag, props = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'text') e.textContent = v;
    else e.setAttribute(k, v);
  }
  for (const kid of kids) if (kid != null) e.append(kid);
  return e;
};
const ctrl = (c) => c.toUpperCase().charCodeAt(0) - 64;
const ESC = 27;

/* ---------------- storage (IndexedDB) ---------------- */
// Separate storage per engine: 3.6.7 and 5.0 save files are not compatible.
const DB = V50 ? 'pocket-yendor-50' : 'pocket-yendor';
const PREFS_KEY = V50 ? 'py-prefs-50' : 'py-prefs';
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function kvGet(k) {
  const db = await idb();
  return new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
}
async function kvSet(k, v) {
  const db = await idb();
  return new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
}
const prefs = (() => { try { return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'); } catch { return {}; } })();
const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* private mode */ } };

/* ---------------- colors ---------------- */
const COLORS = ['#6b7480', '#e04848', '#3fb24a', '#b97a2e', '#4a72e0', '#b04ac0', '#3aaab0', '#c3c8ce',
  '#c3c8ce', '#ff8f1f', '#6cf06c', '#f5e050', '#6fa0ff', '#ff70f0', '#70f0f0', '#ffffff'];

/* ---------------- map rendering ---------------- */
const cells = Array.from({ length: ROWNO }, () => Array(COLNO).fill(null));
const cv = $('#map');
const ctx = cv.getContext('2d');
const wrap = $('#mapwrap');
const MONO = getComputedStyle(document.documentElement).getPropertyValue('--mono');
let fontPx = prefs.fontPx || 18;
let tilePx = prefs.tilePx || 0; // 0 = fit to screen height on start
let useTiles = prefs.tiles ?? true;
let cw = 10, chh = 20;
const tileSheet = new Image();
tileSheet.onload = () => requestDraw();
// Tilesets: NetHack's own, or DawnLike (5.0 builds only; tools/build_tiles_dawnlike.py).
const TILESETS = V50 ? [['default', 'NetHack', 'vendor/tiles16.png'], ['dawnlike', 'DawnLike', 'vendor/tiles-dawnlike.png']] : [['default', 'NetHack', 'vendor/tiles16.png']];
// DawnLike is the default where it exists (Greg, 2026-11-10).
const curTileset = () => TILESETS.find(([k]) => k === prefs.tileset) || TILESETS[TILESETS.length - 1];
const tileUrl = () => curTileset()[2];
tileSheet.src = tileUrl();
const TILE_COLS = 40;
// Remembered terrain/objects per square (monsters excluded), used for context actions:
// mem = glyph, memCm = its map-feature index (-1 if not a feature).
const mem = Array.from({ length: ROWNO }, () => Array(COLNO).fill(-1));
const memCm = Array.from({ length: ROWNO }, () => Array(COLNO).fill(-1));
let G = {}; // glyph offsets
// Last map feature (cmap index) seen per square, so floor can be drawn under monsters and items.
const terrain = Array.from({ length: ROWNO }, () => Array(COLNO).fill(-1));

/* ---------------- filled ground (replaces the dotted floor/corridor tiles) ---------------- */
// Built as 16x16 pixel-art swatches, scaled up like the tiles. 4 variants each so floors aren't uniform.
function makeSwatches(base, { grid = 0, speck = 10, joints = false } = {}) {
  const out = [];
  for (let v = 0; v < 4; v++) {
    const c = document.createElement('canvas');
    c.width = c.height = 16;
    const g = c.getContext('2d');
    const img = g.createImageData(16, 16);
    let seed = (v + 1) * 2654435761 >>> 0;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        let d = (rnd() - 0.5) * speck;
        if (rnd() < 0.05) d += 14;                         // light flecks
        if (joints && (y === 7 || (x === (y < 8 ? 5 : 12)))) d -= 16; // flagstone seams
        if (grid && (x === 15 || y === 15)) d -= grid;     // faint square edges
        const i = (y * 16 + x) * 4;
        img.data[i] = Math.max(0, Math.min(255, base[0] + d));
        img.data[i + 1] = Math.max(0, Math.min(255, base[1] + d));
        img.data[i + 2] = Math.max(0, Math.min(255, base[2] + d));
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    out.push(c);
  }
  return out;
}
const GROUND = {
  room: makeSwatches([58, 86, 90], { grid: 18, speck: 12, joints: true }),
  dark: makeSwatches([30, 45, 48], { grid: 10, speck: 8, joints: true }),
  corr: makeSwatches([78, 122, 124], { speck: 10 }),
  litcorr: makeSwatches([92, 140, 142], { speck: 10 }),
};
// cmap index -> ground type. Doorways (no door / broken) read as floor.
const GROUND_OF = { [CM.S_ndoor]: 'room', [CM.S_room]: 'room', [CM.S_darkroom]: 'dark', [CM.S_corr]: 'corr', [CM.S_litcorr]: 'litcorr' };
// Features drawn as a tile on top of floor: open/closed doors, and (5.0) engravings.
const UNDER = { [CM.S_vodoor]: 'room', [CM.S_hodoor]: 'room', [CM.S_vcdoor]: 'room', [CM.S_hcdoor]: 'room' };
if (V50) { UNDER[CM.S_engroom] = 'room'; UNDER[CM.S_engrcorr] = 'corr'; }
// Stairs, ladders, altar, grave, throne, sink, fountain and traps sit on floor (their tiles have clear backgrounds).
const onFloorFeature = (cm) => (cm >= CM.S_upstair && cm <= CM.S_fountain) || cm >= CM.S_arrow_trap;
const hash2 = (x, y) => ((x * 73856093) ^ (y * 19349663)) & 3;
let ox = 0, oy = 0;
let follow = true;
let cursor = [0, 0];
let lastInputCursor = null;
let drawQueued = false;
let MG = {};

function measure() {
  if (useTiles) {
    cw = chh = tilePx;
  } else {
    ctx.font = `${fontPx}px ${MONO}`;
    cw = Math.ceil(ctx.measureText('M').width);
    chh = Math.ceil(fontPx * 1.22);
  }
  const dpr = window.devicePixelRatio || 1;
  cv.width = COLNO * cw * dpr;
  cv.height = ROWNO * chh * dpr;
  cv.style.width = COLNO * cw + 'px';
  cv.style.height = ROWNO * chh + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
}
function requestDraw() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(draw);
}
function draw() {
  drawQueued = false;
  if (follow) placeCamera();
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, COLNO * cw, ROWNO * chh);
  ctx.font = `${fontPx}px ${MONO}`;
  ctx.imageSmoothingEnabled = false;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  for (let y = 0; y < ROWNO; y++) {
    for (let x = 0; x < COLNO; x++) {
      const c = cells[y][x];
      if (!c || c.ch === ' ') continue;
      const px = x * cw, py = y * chh;
      if (useTiles && tileSheet.complete && tileSheet.naturalWidth && c.tile >= 0) {
        if (prefs.ground !== 'classic' && G.GLYPH_CMAP_OFF != null) {
          const gt = groundType(x, y, c);
          if (gt) ctx.drawImage(GROUND[gt][hash2(x, y)], px, py, cw, chh);
          if (GROUND_OF[c.cmap]) continue; // the swatch replaces the dotted tile
        }
        ctx.drawImage(tileSheet, (c.tile % TILE_COLS) * 16, Math.floor(c.tile / TILE_COLS) * 16, 16, 16, px, py, cw, chh);
        if (c.special & MG.MG_PET) { ctx.fillStyle = '#ff5a7a'; ctx.font = `${Math.max(8, cw * 0.4)}px sans-serif`; ctx.fillText('♥', px + cw * 0.82, py + chh * 0.2); }
        if (c.special & MG.MG_DETECT) { ctx.strokeStyle = '#e0b354'; ctx.strokeRect(px + 1, py + 1, cw - 2, chh - 2); }
        continue;
      }
      let fg = COLORS[c.color] || COLORS[7];
      if (c.special & MG.MG_DETECT) { ctx.fillStyle = fg; ctx.fillRect(px, py, cw, chh); fg = '#000'; }
      ctx.fillStyle = fg;
      ctx.fillText(c.ch, px + cw / 2, py + chh / 2 + 1);
      if (c.special & MG.MG_PET) { ctx.fillRect(px + 1, py + chh - 2, cw - 2, 2); }
      if (c.special & MG.MG_OBJPILE) { ctx.fillRect(px + cw - 3, py + 1, 2, 2); }
    }
  }
  const [cx, cy] = cursor;
  if (cx > 0) {
    ctx.strokeStyle = 'rgba(224,179,84,.75)';
    ctx.lineWidth = 1;
    ctx.strokeRect(cx * cw + 0.5, cy * chh + 0.5, cw - 1, chh - 1);
  }
}
function groundType(x, y, c) {
  const cm = c.cmap;
  if (cm >= 0) {
    if (GROUND_OF[cm]) return GROUND_OF[cm];
    if (UNDER[cm]) return UNDER[cm];
    if (!onFloorFeature(cm)) return null;
  } else if (!isMonGlyph(c.glyph) && !isObjGlyph(c.glyph)) return null; // effects, warnings: leave as is
  // A monster or item: use the floor NetHack reports under it (5.0), or the terrain remembered there,
  // else guess from the neighbours.
  for (const t of [c.bkCmap ?? -1, terrain[y][x]]) {
    if (GROUND_OF[t]) return GROUND_OF[t];
    if (UNDER[t]) return UNDER[t];
  }
  const votes = {};
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const xx = x + dx, yy = y + dy;
    if (yy < 0 || yy >= ROWNO || xx < 0 || xx >= COLNO) continue;
    const k = GROUND_OF[terrain[yy][xx]];
    if (k) votes[k] = (votes[k] || 0) + 1;
  }
  let best = null, n = 0;
  for (const k in votes) if (votes[k] > n) { best = k; n = votes[k]; }
  return best || (cm >= 0 ? 'room' : null);
}
function placeCamera() {
  const W = wrap.clientWidth, H = wrap.clientHeight;
  const mw = COLNO * cw, mh = ROWNO * chh;
  if (follow && cursor[0] > 0) {
    ox = W / 2 - (cursor[0] + 0.5) * cw;
    oy = H / 2 - (cursor[1] + 0.5) * chh;
  }
  ox = mw <= W ? (W - mw) / 2 : Math.min(cw, Math.max(W - mw - cw, ox));
  oy = mh <= H ? (H - mh) / 2 : Math.min(chh, Math.max(H - mh - chh, oy));
  cv.style.transform = `translate(${Math.round(ox)}px, ${Math.round(oy)}px)`;
}
const zoomValue = () => (useTiles ? tilePx : fontPx);
const ZOOM_STEP = () => (useTiles ? 4 : 2);
function fitZoom() {
  const h = wrap.clientHeight || 500;
  if (!tilePx) tilePx = Math.max(16, Math.min(48, Math.floor(h / ROWNO)));
  if (!prefs.fontPx) fontPx = Math.max(12, Math.min(26, Math.floor(h / ROWNO / 1.22)));
}
function setFont(px, anchorX, anchorY) {
  px = useTiles ? Math.max(10, Math.min(64, Math.round(px))) : Math.max(8, Math.min(40, Math.round(px)));
  if (px === zoomValue()) return;
  const W = wrap.clientWidth, H = wrap.clientHeight;
  anchorX ??= W / 2; anchorY ??= H / 2;
  const mx = (anchorX - ox) / cw, my = (anchorY - oy) / chh;
  if (useTiles) { tilePx = px; prefs.tilePx = px; } else { fontPx = px; prefs.fontPx = px; }
  savePrefs();
  measure();
  ox = anchorX - mx * cw;
  oy = anchorY - my * chh;
  placeCamera();
  requestDraw();
}
window.addEventListener('resize', () => { placeCamera(); requestDraw(); });

/* ---------------- input queue ---------------- */
const inputQ = [];
let keyWaiter = null;
let pendingExt = null;
function pushInput(inp) {
  if (keyWaiter) { const w = keyWaiter; keyWaiter = null; w(inp); } else inputQ.push(inp);
}
function pushKeys(str) { for (const ch of str) pushInput({ key: typeof ch === 'number' ? ch : ch.charCodeAt(0) }); }

/* map gestures: tap = travel/click, long-press = look, drag = pan, pinch = zoom */
const ptrs = new Map();
let gesture = null;
wrap.addEventListener('pointerdown', (e) => {
  if (e.target.closest('#mapctl, #chips button')) return;
  try { wrap.setPointerCapture(e.pointerId); } catch { /* synthetic or already released */ }
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (ptrs.size === 1) {
    gesture = { type: 'maybe-tap', sx: e.clientX, sy: e.clientY, lx: e.clientX, ly: e.clientY, t: Date.now() };
    gesture.timer = setTimeout(() => {
      if (gesture?.type === 'maybe-tap') { gesture.type = 'done'; tapAt(gesture.sx, gesture.sy, true); buzz(15); }
    }, 480);
  } else if (ptrs.size === 2) {
    clearTimeout(gesture?.timer);
    const [a, b] = [...ptrs.values()];
    gesture = { type: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y), f0: zoomValue() };
  }
});
wrap.addEventListener('pointermove', (e) => {
  if (!ptrs.has(e.pointerId)) return;
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (!gesture) return;
  if (gesture.type === 'pinch' && ptrs.size === 2) {
    const [a, b] = [...ptrs.values()];
    const r = wrap.getBoundingClientRect();
    setFont(gesture.f0 * Math.hypot(a.x - b.x, a.y - b.y) / gesture.d0, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
    return;
  }
  if (gesture.type === 'maybe-tap' && Math.hypot(e.clientX - gesture.sx, e.clientY - gesture.sy) > 10) {
    clearTimeout(gesture.timer);
    gesture.type = 'pan';
    follow = false;
  }
  if (gesture.type === 'pan') {
    ox += e.clientX - gesture.lx;
    oy += e.clientY - gesture.ly;
    gesture.lx = e.clientX; gesture.ly = e.clientY;
    placeCamera();
  }
});
function endPtr(e) {
  if (!ptrs.has(e.pointerId)) return;
  ptrs.delete(e.pointerId);
  if (gesture?.type === 'maybe-tap' && ptrs.size === 0) {
    clearTimeout(gesture.timer);
    tapAt(gesture.sx, gesture.sy, false);
  }
  if (ptrs.size === 0) gesture = null;
}
wrap.addEventListener('pointerup', endPtr);
wrap.addEventListener('pointercancel', (e) => { ptrs.delete(e.pointerId); clearTimeout(gesture?.timer); if (!ptrs.size) gesture = null; });

function tapAt(clientX, clientY, long) {
  const r = wrap.getBoundingClientRect();
  const x = Math.floor((clientX - r.left - ox) / cw);
  const y = Math.floor((clientY - r.top - oy) / chh);
  if (x < 1 || x >= COLNO || y < 0 || y >= ROWNO) return;
  if (long) { pushKeys(';'); pushInput({ click: { x, y, mod: 1 } }); }
  else pushInput({ click: { x, y, mod: 1 } });
}

$('#mapctl').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.zoom) setFont(zoomValue() + Number(b.dataset.zoom) * ZOOM_STEP());
  else { follow = true; placeCamera(); }
});

/* d-pad */
const DIRS = [['y', '↖'], ['k', '↑'], ['u', '↗'], ['h', '←'], ['s', 'Search'], ['l', '→'], ['b', '↙'], ['j', '↓'], ['n', '↘']];
for (const [k, label] of DIRS) {
  const b = el('button', { 'aria-label': k === 's' ? 'Search (hold: search 20 turns)' : `Move ${label} (hold to run)`, 'data-dir': k, class: k === 's' ? 'mid' : '' }, label);
  let t = null, long = false, armed = false;
  b.addEventListener('pointerdown', () => { armed = true; long = false; t = setTimeout(() => { long = true; buzz(15); pushKeys(k === 's' ? '20s' : k.toUpperCase()); }, 420); });
  b.addEventListener('pointerup', () => { clearTimeout(t); if (armed && !long) pushKeys(k); armed = false; });
  b.addEventListener('pointerleave', () => { clearTimeout(t); armed = false; });
  b.addEventListener('contextmenu', (e) => e.preventDefault());
  $('#dpad').append(b);
}

/* action bar: built by renderActions() once the command lists below exist */

/* physical keyboard */
let sheetKey = null;
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  let code = null;
  const arrows = { ArrowUp: 'k', ArrowDown: 'j', ArrowLeft: 'h', ArrowRight: 'l', Home: 'y', PageUp: 'u', End: 'b', PageDown: 'n' };
  if (arrows[e.key]) code = arrows[e.key].charCodeAt(0);
  else if (e.key === 'Escape') code = ESC;
  else if (e.key === 'Enter') code = 13;
  else if (e.key === 'Backspace') code = 8;
  else if (e.key.length === 1) {
    code = e.key.charCodeAt(0);
    if (e.ctrlKey && /[a-z]/i.test(e.key)) code = ctrl(e.key);
    else if (e.altKey && code < 128) code |= 0x80;
  }
  if (code == null) return;
  e.preventDefault();
  if (moreWaiter) { resolveMore(); return; }
  if (sheetKey) { sheetKey(code, e.key); return; }
  pushInput({ key: code });
});

/* ---------------- status & messages ---------------- */
const msgLog = [];
let msgCut = 0;
// Tablets held sideways show a tall message log on the left (same query as style.css).
const TALL_LOG = matchMedia('(orientation: landscape) and (min-height: 541px)');
TALL_LOG.addEventListener?.('change', () => renderMsgs());
function renderMsgs() {
  const box = $('#msgs');
  box.replaceChildren(...msgLog.slice(TALL_LOG.matches ? -60 : -4).map((m, i, arr) => el('div', { class: 'm' + (msgLog.length - arr.length + i < msgCut ? ' old' : '') }, m)));
  if (TALL_LOG.matches) box.scrollTop = box.scrollHeight;
}
function addMsg(s) {
  if (!s) return;
  msgLog.push(s);
  if (msgLog.length > 600) { msgLog.splice(0, 100); msgCut = Math.max(0, msgCut - 100); }
  renderMsgs();
}
$('#msgs').addEventListener('click', () => {
  if (keyWaiter == null) return;
  openSheet({
    title: 'Message history',
    body: el('div', {}, ...msgLog.slice(-200).map((m) => el('div', { class: 'hist' }, m))),
    buttons: [['Close', () => closeSheet(), 'primary']],
    onOpen: (body) => { body.scrollTop = body.scrollHeight; },
  });
});

let lastStatus = {};
let prevHp = null; // HP at the last status update, to notice damage (null right after start/restore)
function hpFeedback(hp, hpmax) {
  const low = hp > 0 && hp < Math.max(6, hpmax / 3);
  const st = $('#status');
  if (prevHp != null && hp < prevHp) {
    const wasLow = st.classList.contains('lowhp');
    if (prefs.haptics !== false) buzz(low ? [70, 50, 70] : 35);
    if (low && !wasLow) { st.classList.remove('lowflash'); void st.offsetWidth; st.classList.add('lowflash'); }
  }
  st.classList.toggle('lowhp', low);
  prevHp = hp;
}
function renderStatus(s) {
  lastStatus = s;
  const v = (k) => (s[k]?.value ?? '').toString().trim();
  const hp = +v('HP'), hpmax = +v('HPMAX') || 1;
  if (v('HP') !== '') hpFeedback(hp, hpmax);
  const hpColor = hp < hpmax / 3 ? 'var(--danger)' : hp < (hpmax * 2) / 3 ? 'var(--accent)' : 'var(--ok)';
  // Three short lines so nothing is cut off on a phone: who you are (+ status badges), attributes + level,
  // then the combat numbers. A line that still doesn't fit wraps rather than being hidden.
  const hpSpan = el('span', { style: `color:${hpColor};font-weight:600` }, `HP:${v('HP')}(${v('HPMAX')})`);
  const extras = [];
  if (v('HUNGER')) extras.push(el('span', { class: 'cond hunger' }, v('HUNGER')));
  if (v('CAP')) extras.push(el('span', { class: 'cond hunger' }, v('CAP')));
  for (const c of s.CONDITION?.value || []) extras.push(el('span', { class: 'cond' }, c[0] + c.slice(1).toLowerCase()));
  $('#st1').replaceChildren(el('b', {}, v('TITLE')), v('ALIGN') ? ` · ${v('ALIGN')} ` : ' ', ...extras);
  $('#st2').replaceChildren(`St:${v('STR')} Dx:${v('DX')} Co:${v('CO')} In:${v('IN')} Wi:${v('WI')} Ch:${v('CH')}  ${v('LEVELDESC')}`);
  $('#st3').replaceChildren(hpSpan, ` Pw:${v('ENE')}(${v('ENEMAX')}) AC:${v('AC')} Xp:${v('XP')}/${v('EXP')} T:${v('TIME')} ${v('GOLD')}`);
}

/* ---------------- sheets ---------------- */
let sheetCleanup = null;
function openSheet({ title, body, buttons = [], onKey = null, onOpen }) {
  $('#sheettitle').textContent = title || '';
  const b = $('#sheetbody');
  b.replaceChildren(body || '');
  $('#sheetbtns').replaceChildren(...buttons.map(([label, fn, cls]) => el('button', { class: cls || '', onclick: fn }, label)));
  $('#sheet').hidden = false;
  sheetKey = onKey;
  onOpen?.(b);
}
function closeSheet() {
  $('#sheet').hidden = true;
  sheetKey = null;
  sheetCleanup?.(); sheetCleanup = null;
}

/* --More-- */
let moreWaiter = null;
function resolveMore() {
  const w = moreWaiter; moreWaiter = null;
  $('#morehint').hidden = true;
  $('#veil').hidden = true;
  w?.();
}
$('#veil').addEventListener('pointerdown', (e) => { e.preventDefault(); resolveMore(); });

/* yn / single-key prompts */
const YN_LABELS = { y: 'Yes', n: 'No', q: 'Quit', a: 'All' };
let autoItem = { q: '', t: 0 }; // last item question answered automatically with '?'
// NetHack 5.0's item-action menu names keys in a few labels; show the action instead (display only).
const MENU_TEXT_FIXES = [
  [/^(?:Wield|Ready) '-' to (un-\w+) /, (m, act) => act[0].toUpperCase() + act.slice(1) + ' '],
  [/ with 'f'ire$/, ' with Fire'],
  [/ \(same as 'f'\)$/, ' (same as Fire)'],
  [/^Adjust inventory by splitting this stack$/, 'Split this stack'],
];
const MENU_HIDE = /^Adjust inventory by assigning new letter$/; // letters aren't shown, so this means nothing
// Text lines in menus meant for keyboard players' config files (e.g. the tutorial question's "Put OPTIONS=!tutorial in .nethackrc").
const MENU_TEXT_HIDE = /\.nethackrc|OPTIONS=/;
const touchText = (str) => touchMsg(MENU_TEXT_FIXES.reduce((t, [re, to]) => t.replace(re, to), str || '')) ?? '';
// Game text that names keys (mostly the 5.0 tutorial's signs, plus a few messages): show the button instead.
// Display only. Keys are NetHack 5.0's defaults as the tutorial prints them (tut_key: ^X -> "Ctrl-X").
const KEY_NAMES = {
  s: 'Search', ',': 'Pick up', W: 'Wear', w: 'Wield', T: 'Take off', r: 'Read', d: 'Drop', t: 'Throw', f: 'Fire',
  Q: 'Set quiver', e: 'Eat', z: 'Zap', x: 'Swap weapons', X: 'Two-weapon combat', P: 'Put on', R: 'Remove',
  '>': 'Go down', '<': 'Go up', c: 'Close door', o: 'Open door', a: 'Apply', q: 'Drink', 'Ctrl-D': 'Kick', '^D': 'Kick',
  'M-l': 'Loot', '#loot': 'Loot', 'M-T': 'Empty a container', 'Alt-T': 'Empty a container', '#tip': 'Empty a container', 'M-j': 'Jump', '#jump': 'Jump',
  'M-u': 'Disarm a trap', '#untrap': 'Disarm a trap', '#enhance': 'Enhance', E: 'Engrave', Z: 'Cast', p: 'Pay',
};
// "the Kick button" when it's on the action bar (or the d-pad's Search), otherwise "Loot (in More)".
function keyWord(k) {
  if (k === ';') return 'a long-press on the map';
  if (k === '_') return 'a tap on the map';
  const n = KEY_NAMES[k];
  if (!n) return null;
  return n === 'Search' || quickbar().some((a) => a.label === n) ? `the ${n} button` : `${n} (in More)`;
}

const MSG_HIDE = /^\(For instructions type a |Outside the tutorial, Ctrl-key|^Count: \d+$/;
const MSG_FIXES = [
  [/Move around with [^"]+/, 'Move around with the arrow pad'],
  [/Move diagonally with [^"]+/, 'Move diagonally with the corner arrows'],
  [/Look around the map with '[^']+', press ESC when you're done/, 'Look around the map: long-press any square'],
  [/You can run by prefixing a movement key with '[^']+'/, 'You can run by holding an arrow'],
  [/You can drop partial stacks by prefixing the item slot letter with a number/, 'You can drop part of a stack: hold it in the Drop list and choose how many'],
  [/You can wait a turn with '[^']+'/, 'You can wait a turn with the Search button'],
  [/Travel across the level with '[^']+'/, 'Travel across the level by tapping where you want to go'],
  [/Choose an item; use ESC to decline\./, 'Choose an item, or tap Cancel.'],
  [/Use the '([^']+)' command to/, (m, k) => `Use ${keyWord(k) || 'the right command'} to`],
  [/'([^']{1,7})'/g, (m, k) => keyWord(k) || m],
];
function touchMsg(s) {
  if (!s || MSG_HIDE.test(s) || /^You read: "Note: Outside the tutorial/.test(s)) return s ? null : s;
  return MSG_FIXES.reduce((t, [re, to]) => t.replace(re, to), s);
}
// The question behind the item list NetHack shows next (its list has no title of its own).
// Used once, by the next menu only.
const itemQuestion = () => { if (!autoItem.pending) return ''; autoItem.pending = false; return autoItem.q.replace(/\s*\[[^\]]*\]\s*$/, ''); };
function expandLetters(spec) {
  const out = [];
  for (let i = 0; i < spec.length; i++) {
    const c = spec[i];
    if (spec[i + 1] === '-' && spec[i + 2]) {
      for (let k = c.charCodeAt(0); k <= spec.charCodeAt(i + 2); k++) out.push(String.fromCharCode(k));
      i += 2;
    } else if (c !== ' ') out.push(c);
  }
  return out;
}
function dirGrid(done) {
  const g = el('div', { class: 'dirgrid' });
  for (const [k, label] of [['y', '↖'], ['k', '↑'], ['u', '↗'], ['h', '←'], ['.', 'Self'], ['l', '→'], ['b', '↙'], ['j', '↓'], ['n', '↘'], ['<', 'Up'], ['>', 'Down']]) {
    g.append(el('button', { onclick: () => done(k.charCodeAt(0)), class: label.length > 1 ? 'word' : '' }, label));
  }
  return g;
}
// Small picture of an item from the tile sheet, shown in menus where NetHack would show a letter.
const ICON = 24;
function tileIcon(t) {
  if (t == null || t < 0 || !useTiles) return null; // no picture: no gap either
  return el('span', { class: 'ico', style: `background-image:url(${tileUrl()});background-size:${TILE_COLS * ICON}px auto;background-position:-${(t % TILE_COLS) * ICON}px -${Math.floor(t / TILE_COLS) * ICON}px` });
}

/* command palette */
const COMMANDS = [
  ['s', 'Search'], [',', 'Pick up'], ['d', 'Drop'], ['D', 'Drop several'], ['i', 'Inventory'], ['I', 'Inventory by type'],
  ['e', 'Eat'], ['q', 'Quaff (drink)'], ['r', 'Read'], ['z', 'Zap a wand'], ['Z', 'Cast a spell'], ['+', 'Known spells'],
  ['a', 'Apply (use) a tool'], ['w', 'Wield weapon'], ['x', 'Swap weapons'], ['W', 'Wear armor'], ['T', 'Take off armor'],
  ['P', 'Put on ring/amulet'], ['R', 'Remove ring/amulet'], ['A', 'Take off several'], ['Q', 'Set quiver'],
  ['f', 'Fire from quiver'], ['t', 'Throw'], ['F', 'Fight in a direction'], [ctrl('d'), 'Kick', '^D'],
  ['o', 'Open door'], ['c', 'Close door'], ['<', 'Go up stairs'], ['>', 'Go down stairs'], ['_', 'Travel to…'],
  [':', 'Look here'], [';', 'Look at a spot'], ['^', 'Identify trap'], ['p', 'Pay shopkeeper'], ['E', 'Engrave'],
  ['C', 'Name a monster'], [ctrl('x'), 'Attributes', '^X'], [ctrl('o'), 'Dungeon overview', '^O'], ['\\', 'Discoveries'],
  ['$', 'Count gold'], [')', 'Current weapon'], ['[', 'Current armor'], ['=', 'Current rings'], ['"', 'Current amulet'],
  ['(', 'Current tools'], ['*', 'All equipment'], ['O', 'Options'], [ctrl('a'), 'Repeat last command', '^A'],
  ['S', 'Save and quit'],
];
// Hidden from the palette: debug/wizard, shell/suspend, and 5.0's internal prefix/movement/mouse commands
// (the d-pad, F, ^A and taps already cover those).
const EXT_HIDE = /^(wiz|#|\?|shell|suspend|panic|stats|lightsources|timeout|vision|seenv|levelchange|polyself|migratemons|debugfuzzer|move|rush|run|alt|clicklook|mouseaction|reqmenu|repeat|fight|perminv|adjust|whatdoes|toggle|saveoptions|optionsfull|help|history|version|redraw|prevmsg)/;
// Extended commands that duplicate an entry in COMMANDS or an on-screen button: listed once only.
const EXT_DUP = new Set(['apply', 'attributes', 'call', 'cast', 'close', 'down', 'drop', 'droptype', 'eat', 'engrave', 'fire', 'glance',
  'inventory', 'inventtype', 'kick', 'look', 'open', 'overview', 'pay', 'pickup', 'puton', 'quaff', 'quiver', 'read', 'remove', 'save',
  'search', 'seeall', 'seeamulet', 'seearmor', 'seerings', 'seetools', 'seeweapon', 'showgold', 'showspells', 'showtrap', 'swap',
  'takeoff', 'takeoffall', 'throw', 'travel', 'up', 'wear', 'wield', 'zap', 'known', 'options', 'seegold', 'seespells', 'seetrap']);
const EXT_VISIBLE = EXT_CMDS.filter((n) => !EXT_HIDE.test(n) && !EXT_DUP.has(n));
const EXT_FIRST = ['pray', 'offer', 'loot', 'force', 'enhance', 'chat', 'dip', 'jump', 'sit', 'untrap', 'ride', 'turn', 'monster', 'wipe', 'name', 'conduct', 'quit'];
// Plain names for extended commands (NetHack's names are terse); anything not listed is just capitalised.
const EXT_LABEL = { herecmdmenu: 'Actions here', therecmdmenu: 'Actions at a spot', exploremode: 'Explore mode', lookaround: 'Look around',
  retravel: 'Travel again', twoweapon: 'Two-weapon combat', vanquished: 'Vanquished monsters', genocided: 'Genocided monsters',
  annotate: 'Name this level', chronicle: 'Chronicle', untrap: 'Disarm a trap', monster: 'Monster ability', tip: 'Empty a container' };
const extLabel = (n) => EXT_LABEL[n] || n[0].toUpperCase() + n.slice(1);
const extEntries = () => [...EXT_FIRST, ...EXT_VISIBLE.filter((n) => !EXT_FIRST.includes(n))]
  .filter((n) => EXT_CMDS.includes(n))
  .map((n) => ({ label: extLabel(n), desc: EXT_DESC[n] || '', ext: n }));

/* ---------------- action bar (customizable quick bar) ---------------- */
// Touch-only: buttons show what they do, not which key NetHack uses for it. The last button (More) is fixed;
// the other 11 can be changed in Settings. Stored as labels (prefs.quickbar).
const DEFAULT_QUICKBAR = ['Pick up', 'Inventory', 'Look here', 'Go up', 'Apply', 'Eat', 'Fire', 'Go down', 'Kick', 'Repeat', 'Wield'];
const QUICK_EXTRA = [[',', 'Pick up'], [':', 'Look here'], ['<', 'Go up'], ['>', 'Go down'], ['a', 'Apply'], ['f', 'Fire'], ['w', 'Wield'],
  [ctrl('a'), 'Repeat'], ['q', 'Drink'], ['z', 'Zap'], ['Z', 'Cast'], ['t', 'Throw'], ['r', 'Read'], ['W', 'Wear'], ['T', 'Take off'],
  ['P', 'Put on'], ['R', 'Remove'], ['d', 'Drop'], ['x', 'Swap weapons'], ['o', 'Open door'], ['c', 'Close door'], ['_', 'Travel'],
  [';', 'Look at…'], ['s', 'Search'], ['p', 'Pay'], ['E', 'Engrave']];
// Everything that can go on a button: short names first, then the full command list.
function quickCatalog() {
  const out = new Map();
  for (const [send, label] of QUICK_EXTRA) out.set(label, { label, send });
  for (const [send, label] of COMMANDS) if (!out.has(label)) out.set(label, { label, send });
  for (const e of extEntries()) if (!out.has(e.label)) out.set(e.label, { label: e.label, ext: e.ext, desc: e.desc });
  return out;
}
function quickbar() {
  const cat = quickCatalog();
  const list = Array.isArray(prefs.quickbar) && prefs.quickbar.length === DEFAULT_QUICKBAR.length ? prefs.quickbar : DEFAULT_QUICKBAR;
  return list.map((l, i) => cat.get(l) || cat.get(DEFAULT_QUICKBAR[i]));
}
function runAction(a) {
  if (a.ext) sendCmd({ ext: a.ext }); else pushKeys(typeof a.send === 'number' ? [a.send] : a.send);
}
function renderActions() {
  const box = $('#actions');
  box.replaceChildren(...quickbar().map((a) => el('button', { 'data-act': a.label, onclick: () => runAction(a) }, a.label)),
    el('button', { class: 'more', 'data-act': 'More', onclick: () => openPalette() }, 'More'));
}
function openQuickbarEditor() {
  const bar = quickbar().map((a) => a.label);
  const grid = el('div', { class: 'qgrid' }, ...bar.map((label, i) => el('button', { onclick: () => {
    const cat = [...quickCatalog().values()];
    openSheet({
      title: `Replace “${label}” with…`,
      body: listSheet({ entries: cat, onPick: (e) => { bar[i] = e.label; prefs.quickbar = bar; savePrefs(); renderActions(); openQuickbarEditor(); } }),
      buttons: [['Back', () => openQuickbarEditor()]],
    });
  } }, label)), el('button', { class: 'fixed', disabled: '' }, 'More'));
  openSheet({
    title: 'Action buttons — tap one to change it',
    body: grid,
    buttons: [['Reset', () => { delete prefs.quickbar; savePrefs(); renderActions(); openQuickbarEditor(); }], ['Done', () => openSettings(), 'primary']],
  });
}

function listSheet({ title, entries, onPick, placeholder }) {
  const input = el('input', { class: 'search', placeholder: placeholder || 'Search…', type: 'search', autocomplete: 'off' });
  const list = el('div');
  const render = () => {
    const q = input.value.trim().toLowerCase();
    list.replaceChildren(...entries.filter((e) => !q || e.label.toLowerCase().includes(q) || (e.desc || '').toLowerCase().includes(q))
      .map((e) => el('div', { class: 'cmd', onclick: () => onPick(e) }, el('span', {}, e.label), e.desc ? el('span', { class: 'desc' }, e.desc) : null)));
  };
  input.addEventListener('input', render);
  render();
  return el('div', {}, input, list);
}
// The More list, most useful first (Greg, 2026-11-10): Save and quit, Help, Settings; then everyday commands
// that aren't on the action bar; then everything else; commands already on the bar near the end; Quit last.
const PALETTE_FIRST = ['Wear armor', 'Take off armor', 'Put on ring/amulet', 'Remove ring/amulet', 'Quaff (drink)', 'Read',
  'Zap a wand', 'Cast a spell', 'Throw', 'Drop', 'Drop several', 'Pray', 'Loot', 'Open door', 'Close door', 'Travel to…',
  'Look at a spot', 'Set quiver', 'Swap weapons', 'Pay shopkeeper', 'Offer', 'Chat', 'Actions here', 'Engrave', 'Enhance',
  'Force', 'Disarm a trap', 'Dip', 'Sit', 'Jump', 'Known spells', 'Dungeon overview', 'Attributes', 'Discoveries',
  'Inventory by type', 'All equipment', 'Count gold', 'Name', 'Name a monster', 'Identify trap', 'Ride', 'Two-weapon combat',
  'Take off several', 'Fight in a direction', 'Conduct'];
function paletteEntries() {
  const all = [...COMMANDS.map(([k, label]) => ({ label, send: k })), ...extEntries()];
  const key = (e) => (e.ext ? '#' + e.ext : String(e.send));
  const onBar = new Set([...quickbar().map(key), 's']); // 's' = the d-pad's Search
  const rank = (e) => {
    if (e.label === 'Save and quit') return -1;
    if (e.ext === 'quit') return 3000;
    if (onBar.has(key(e))) return 2000;
    const i = PALETTE_FIRST.indexOf(e.label);
    return i >= 0 ? i : 1000;
  };
  const sorted = all.map((e, i) => [rank(e), i, e]).sort((x, y) => x[0] - y[0] || x[1] - y[1]).map(([, , e]) => e);
  return [sorted[0], { label: '? Help', help: true }, { label: '⚙ Settings', settings: true }, ...sorted.slice(1)];
}
function openPalette() {
  if (keyWaiter == null) return;
  const entries = paletteEntries();
  openSheet({
    title: 'Commands',
    body: listSheet({ title: 'Commands', entries, onPick: (e) => {
      closeSheet();
      if (e.settings) { openSettings(); return; }
      if (e.help) { openHelp(); return; }
      if (e.ext) { pendingExt = e.ext; pushKeys('#'); } else pushKeys(typeof e.send === 'number' ? [e.send] : e.send);
    } }),
    buttons: [['Close', () => closeSheet()]],
  });
}

/* ---------------- glyph classification ---------------- */
const isMonGlyph = (g) => (g >= G.GLYPH_MON_OFF && g < G.GLYPH_BODY_OFF) || (g >= G.GLYPH_RIDDEN_OFF && g < G.GLYPH_OBJ_OFF) || (g >= G.GLYPH_EXPLODE_OFF && g < G.GLYPH_STATUE_OFF);
// Statues run up to the unexplored/nothing glyphs (5.0 adds those after them).
const isObjGlyph = (g) => (g >= G.GLYPH_BODY_OFF && g < G.GLYPH_RIDDEN_OFF) || (g >= G.GLYPH_OBJ_OFF && g < G.GLYPH_CMAP_OFF) || (g >= G.GLYPH_STATUE_OFF && g < (G.GLYPH_UNEXPLORED_OFF ?? G.MAX_GLYPH));
// 3.6.7: a feature glyph is GLYPH_CMAP_OFF + index. 5.0's engine reports the index itself (glyph_info symidx).
const cmapOf = (g) => (g >= G.GLYPH_CMAP_OFF && g < G.GLYPH_EXPLODE_OFF ? g - G.GLYPH_CMAP_OFF : -1);
const { S_vcdoor, S_hcdoor, S_upstair, S_dnstair, S_upladder, S_dnladder, S_altar, S_throne, S_sink, S_fountain } = CM;
// 5.0 draws stairs/ladders that lead to another branch (Mines, out of the dungeon...) with their own symbols.
const UP_STAIRS = new Set([S_upstair, CM.S_brupstair].filter((v) => v != null));
const DN_STAIRS = new Set([S_dnstair, CM.S_brdnstair].filter((v) => v != null));
const UP_LADDERS = new Set([S_upladder, CM.S_brupladder].filter((v) => v != null));
const DN_LADDERS = new Set([S_dnladder, CM.S_brdnladder].filter((v) => v != null));

/* ---------------- context chips ---------------- */
let objSeenAt = null; // "x,y" where a "You see here" style message was last shown
let seenHereMsg = ''; // that message, reused as the stop prompt's text
// Hero tracking for the here-buttons: the hero's square at the last command prompt, and whether the map was just reset
// (new level, game start, restore), when arriving on stairs should not ask anything.
let heroXY = null;      // from glyphs flagged MG_HERO (5.0); null -> use the cursor
let promptedAt = null;  // "x,y" of the last command prompt
let freshLevel = true;
let lastKey = 0;
let arrivedOn = -1; // cmap index you are standing on after arriving on a level (stairs are hidden under you)
// Squares whose remembered object is gold: when auto-pickup takes gold, there's no Pick up button for it.
const memGold = Array.from({ length: ROWNO }, () => Array(COLNO).fill(false));
function sendCmd(cmd, letter = '') {
  if (typeof cmd === 'object') { pendingExt = cmd.ext; pushKeys('#' + letter); } else pushKeys(cmd + letter);
}
// What can be done on the square you're standing on: [{ what, acts: [[cmd, label], ...] }].
function hereInfo(hx, hy) {
  const acts = [];
  let what = '';
  if (hx <= 0 || G.GLYPH_CMAP_OFF == null) return { what, acts };
  const g = mem[hy][hx];
  const cm = memCm[hy][hx];
  if (DN_STAIRS.has(cm)) { what = 'Stairs down'; acts.push(['>', '▼ Go down']); }
  if (DN_LADDERS.has(cm)) { what = 'Ladder down'; acts.push(['>', '▼ Go down']); }
  if (UP_STAIRS.has(cm)) { what = 'Stairs up'; acts.push(['<', '▲ Go up']); }
  if (UP_LADDERS.has(cm)) { what = 'Ladder up'; acts.push(['<', '▲ Go up']); }
  if (cm === S_fountain) { what = 'Fountain'; acts.push(['q', 'Drink'], [{ ext: 'dip' }, 'Dip']); }
  if (cm === S_sink) { what = 'Sink'; acts.push(['q', 'Drink']); }
  if (cm === S_altar) { what = 'Altar'; acts.push([{ ext: 'offer' }, 'Offer'], [{ ext: 'pray' }, 'Pray']); }
  if (cm === S_throne) { what = 'Throne'; acts.push([{ ext: 'sit' }, 'Sit']); }
  const goldAuto = (prefs.pickup || 'gold') !== 'off';
  if ((isObjGlyph(g) && !(memGold[hy][hx] && goldAuto)) || objSeenAt === `${hx},${hy}`) {
    // What's here, from NetHack's own "You see here ..." line when there was one.
    const one = /^You see here (.+?)\.?$/.exec(seenHereMsg || '');
    const items = one ? one[1] : 'Items here';
    what = what ? `${what} · ${items}` : items;
    if (/\bcorpses?\b/.test(seenHereMsg)) acts.push(['e', 'Eat']);
    if (/\b(box|chest|bag|sack)\b/.test(seenHereMsg)) acts.push([{ ext: 'loot' }, 'Open']);
    acts.push([',', 'Pick up']);
  }
  // NetHack's own list of everything you can do on this square.
  if (acts.length) acts.push([{ ext: 'herecmdmenu' }, 'More…']);
  return { what, acts };
}
// Read-only snapshot for automated UI tests (scripts/ui_test.py).
globalThis.__pyDebug = () => {
  const [x, y] = heroXY || cursor;
  const pets = [];
  cells.forEach((row, yy) => row.forEach((c, xx) => { if (c && (c.special & MG.MG_PET)) pets.push([xx, yy]); }));
  return { hero: [x, y], cursor, cm: memCm[y]?.[x], promptedAt, freshLevel, here: hereInfo(x, y), pets, opts: lastOpts };
};
let lastOpts = ''; // the NETHACKOPTIONS string of the running game (debug/tests only)
function updateChips() {
  const box = $('#chips');
  const [hx, hy] = heroXY || cursor;
  const here = hereInfo(hx, hy);
  const chips = [...here.acts];
  if (hx > 0 && G.GLYPH_CMAP_OFF != null) {
    const around = [[-1, -1, 'y', '↖'], [0, -1, 'k', '↑'], [1, -1, 'u', '↗'], [-1, 0, 'h', '←'], [1, 0, 'l', '→'], [-1, 1, 'b', '↙'], [0, 1, 'j', '↓'], [1, 1, 'n', '↘']];
    let doors = 0;
    for (const [dx, dy, k, arrow] of around) {
      const x = hx + dx, y = hy + dy;
      if (y < 0 || y >= ROWNO || x < 1 || x >= COLNO) continue;
      const c = memCm[y][x];
      if ((c === S_vcdoor || c === S_hcdoor) && doors++ < 2) chips.push(['o' + k, `Open door ${arrow}`]);
    }
  }
  // Buttons for what you're standing on, captioned with what it is. Nothing pops up; just tap or keep moving.
  box.replaceChildren(...(here.acts.length ? [el('span', { class: 'cap' }, here.what)] : []),
    ...chips.map(([cmd, label]) => el('button', { onclick: () => sendCmd(cmd) }, label)),
    ...(hint ? [el('button', { class: 'hint', onclick: () => openHelp(hint.id) }, '? ' + hint.label)] : []));
}
// Briefly highlight the buttons when you arrive on something new.
function pulseChips() {
  const box = $('#chips');
  if (!box.querySelector('.cap')) return;
  box.classList.remove('pulse'); void box.offsetWidth; box.classList.add('pulse');
}
function noteMessage(s) {
  for (const [re, id, label] of HINTS) if (re.test(s)) hint = { id, label, left: 6 };
  const [hx, hy] = cursor;
  if (/^You see here [^.]*gold pieces?\.$/.test(s) && (prefs.pickup || 'gold') !== 'off') return;
  if (/^You see here |^There (?:are|is) (?:several|many|a few )?(?:objects?|things?) here|^Things that are here/.test(s)) {
    objSeenAt = `${hx},${hy}`;
    seenHereMsg = /^Things that are here/.test(s) ? 'There are things here.' : s;
  }
  if (/^[a-zA-Z$] - |^There is nothing here to pick up/.test(s)) {
    objSeenAt = null;
    seenHereMsg = '';
    if (hx > 0 && isObjGlyph(mem[hy][hx])) { mem[hy][hx] = -1; memCm[hy][hx] = -1; }
  }
}

/* ---------------- game state, auto-save ---------------- */
let gameState = 'title'; // title | playing | saving | suspended | ended
let autoSaving = false;
let autoSaveKeys = 0;
let resuming = false;
let activeCancel = null; // cancels whatever prompt is open
let curName = null;
let ending = false; // end-of-game screens are showing
let endingAt = 0;   // message index when they started

function startAutoSave() {
  if (gameState !== 'playing' || prefs.autosave === false) return;
  gameState = 'saving';
  autoSaving = true;
  autoSaveKeys = 0;
  inputQ.length = 0;
  pendingExt = null;
  const c = activeCancel; activeCancel = null;
  c?.();
  if (keyWaiter) pushInput({ key: 'S'.charCodeAt(0) });
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) startAutoSave();
  else if (gameState === 'suspended') resumeGame();
});
window.addEventListener('pagehide', startAutoSave);

function escMap(visible, def) {
  return (visible.includes('q') ? 'q' : visible.includes('n') ? 'n' : def || '\x1b').charCodeAt(0);
}

/* ---------------- inventory actions ---------------- */
const CLASS_ACTIONS = {
  Weapons: [['w', 'Wield'], ['t', 'Throw'], ['Q', 'Quiver']],
  Armor: [['W', 'Wear'], ['T', 'Take off']],
  Comestibles: [['e', 'Eat'], ['t', 'Throw']],
  Scrolls: [['r', 'Read']],
  Spellbooks: [['r', 'Read']],
  Potions: [['q', 'Quaff'], [{ ext: 'dip' }, 'Dip into…'], ['t', 'Throw']],
  Rings: [['P', 'Put on'], ['R', 'Remove']],
  Amulets: [['P', 'Put on'], ['R', 'Remove']],
  Wands: [['z', 'Zap'], ['E', 'Engrave with'], ['a', 'Break (apply)']],
  Tools: [['a', 'Apply'], ['P', 'Put on'], ['R', 'Remove']],
  'Gems/Stones': [['t', 'Throw'], ['a', 'Apply']],
  Coins: [],
};
function itemActions(item, cls) {
  let acts = [...(CLASS_ACTIONS[cls] || [['a', 'Apply'], ['t', 'Throw']])];
  const s = item.str;
  const first = [];
  if (/\(weapon in hands?\)|\(wielded/.test(s)) { first.push(['w-', 'Unwield', true]); acts = acts.filter(([k]) => k !== 'w'); }
  if (/\(alternate weapon/.test(s)) first.push(['x', 'Swap to it', true]);
  if (/\(in quiver/.test(s)) first.push(['f', 'Fire', true]);
  if (/\(being worn\)/.test(s) && cls === 'Armor') { first.push(['T', 'Take off']); acts = acts.filter(([k]) => k !== 'W' && k !== 'T'); }
  if (/\(on (left|right) hand|\(being worn\)/.test(s) && cls !== 'Armor') { first.push(['R', 'Remove']); acts = acts.filter(([k]) => k !== 'P' && k !== 'R'); }
  return [...first, ...acts, ['d', 'Drop'], [{ ext: 'adjust' }, 'Change letter']];
}
function inventorySheet(items, finish) {
  const body = el('div');
  let cls = '';
  for (const it of items) {
    if (!it.id) { cls = it.str.trim(); body.append(el('div', { class: it.attr ? 'mh' : 'mtext' }, it.str)); continue; }
    const itemCls = cls;
    body.append(el('div', { class: 'mi tap', onclick: () => {
      const acts = itemActions(it, itemCls);
      openSheet({
        title: it.str,
        body: el('div', { class: 'acts' }, ...acts.map(([cmd, label, noLetter]) => el('button', { onclick: () => {
          finish([]);
          sendCmd(cmd, noLetter ? '' : it.ch);
        } }, label))),
        buttons: [['Back', () => inventorySheet(items, finish)], ['Close', () => finish([])]],
        onKey: (c) => { if (c === ESC) inventorySheet(items, finish); },
      });
    } }, tileIcon(it.tile), el('span', {}, it.str), el('span', { class: 'chev' }, '›')));
  }
  openSheet({ title: 'Inventory — tap an item', body, buttons: [['Close', () => finish([]), 'primary']], onKey: (c) => { if (c === ESC || c === 13 || c === 32) finish([]); } });
}

/* ---------------- text windows ---------------- */
// NetHack hard-wraps long text near 80 columns. On a phone that wraps twice and looks ragged, so
// rejoin wrapped prose into paragraphs. Short-line content (attributes, lists, tables) stays as-is.
function renderText(lines) {
  const box = el('div', { class: 'textwin' });
  const body = lines.filter((l) => l.trim());
  const avg = body.reduce((n, l) => n + l.trim().length, 0) / (body.length || 1);
  // Lists and tables (attributes, overview, conduct) use a 1-2 space indent or short lines: keep them.
  const isList = body.some((l) => /^ {1,2}\S/.test(l)) || avg < 40;
  if (isList) { box.append(el('pre', { class: 'text' }, lines.join('\n'))); return box; }
  // Prose: blank lines separate paragraphs; deeper-indented runs are quoted passages.
  let para = null;
  const flush = () => { if (para) box.append(el('p', { class: para.indent ? 'quote' : '' }, para.text)); para = null; };
  for (const raw of lines) {
    const t = raw.trim();
    if (!t) { flush(); continue; }
    const indent = /^\s{3,}/.test(raw);
    if (para && para.indent === indent) para.text += ' ' + t;
    else { flush(); para = { text: t, indent }; }
  }
  flush();
  return box;
}

/* ---------------- help ---------------- */
// Topics live in help.js. Simple markup: blank line = paragraph, "- " = bullet, **bold**.
function richText(s) {
  return s.split('**').map((part, i) => (i % 2 ? el('b', {}, part) : part));
}
function renderHelp(text) {
  const box = el('div', { class: 'textwin help' });
  for (const block of text.trim().split(/\n\s*\n/)) {
    const lines = block.split('\n');
    let ul = null;
    for (const line of lines) {
      if (line.startsWith('- ')) { if (!ul) box.append(ul = el('ul')); ul.append(el('li', {}, ...richText(line.slice(2)))); }
      else { ul = null; box.append(el('p', {}, ...richText(line))); }
    }
  }
  return box;
}
function openHelp(id, back) {
  const close = back || (() => closeSheet());
  const t = HELP.find((h) => h.id === id);
  if (t) {
    openSheet({ title: t.title, body: renderHelp(t.text), buttons: [['Topics', () => openHelp(null, back)], ['Close', close, 'primary']], onKey: (c) => { if (c === ESC) close(); } });
    return;
  }
  openSheet({
    title: 'Help',
    body: el('div', {}, ...HELP.map((h) => el('div', { class: 'cmd', onclick: () => openHelp(h.id, back) }, el('span', {}, h.title), el('span', { class: 'key' }, '›')))),
    buttons: [['Close', close, 'primary']],
    onKey: (c) => { if (c === ESC) close(); },
  });
}
// A message that a Help topic explains shows a "?" button over the map for a few moves.
const HINTS = [[/^This door is locked\./, 'stuck', 'Locked doors'], [/^You are beginning to feel (hungry|weak)\./, 'hunger', 'Hunger'],
  [/^You (have a little trouble lifting|can barely move)/, 'items', 'Carrying too much']];
let hint = null; // { id, left }

/* ---------------- settings ---------------- */
function openSettings() {
  const row = (label, on, toggle) => el('div', { class: 'cmd', onclick: () => { toggle(); openSettings(); } }, el('span', {}, label), el('span', { class: 'key' }, on ? 'On' : 'Off'));
  openSheet({
    title: 'Settings',
    body: el('div', {},
      row('Graphical tiles (off = classic ASCII)', useTiles, () => {
        useTiles = !useTiles; prefs.tiles = useTiles; savePrefs();
        fitZoom(); measure(); follow = true; placeCamera(); requestDraw();
      }),
      TILESETS.length > 1 ? el('div', { class: 'cmd', onclick: () => {
        const i = TILESETS.indexOf(curTileset());
        prefs.tileset = TILESETS[(i + 1) % TILESETS.length][0]; savePrefs();
        tileSheet.src = tileUrl(); openSettings();
      } }, el('span', {}, 'Tile pictures (tap to switch)'), el('span', { class: 'key' }, curTileset()[1])) : null,
      row('Filled floors and corridors (tiles mode)', prefs.ground !== 'classic', () => {
        prefs.ground = prefs.ground === 'classic' ? 'filled' : 'classic'; savePrefs(); requestDraw();
      }),
      el('div', { class: 'cmd', onclick: () => openHelp(null, openSettings) }, el('span', {}, 'Help and how to play'), el('span', { class: 'key' }, '›')),
      el('div', { class: 'cmd', onclick: () => openQuickbarEditor() }, el('span', {}, 'Customize the action buttons'), el('span', { class: 'key' }, '›')),
      row('Vibrate when you take damage', prefs.haptics !== false, () => { prefs.haptics = prefs.haptics === false; savePrefs(); }),
      row('Auto-save when the app is hidden', prefs.autosave !== false, () => { prefs.autosave = prefs.autosave === false; savePrefs(); }),
      V50 ? row('Offer the NetHack tutorial at new game', prefs.tutorial !== false, () => { prefs.tutorial = prefs.tutorial === false; savePrefs(); }) : null,
      el('div', { class: 'mtext', style: 'color:var(--dim)' }, 'Map: tap to travel, long-press to look, drag to pan, pinch to zoom. Arrows: hold to run. Search: hold to search 20 times.')),
    buttons: [['Done', () => closeSheet(), 'primary']],
  });
}

/* ---------------- UI object for the engine ---------------- */
const ui = {
  onGlyph(x, y, c) {
    if (G.GLYPH_CMAP_OFF == null) { G = globalThis.nethackGlobal.constants.GLYPH || {}; MG = globalThis.nethackGlobal.constants.MG || {}; }
    if (c.cmap == null) c.cmap = cmapOf(c.glyph); // 3.6.7 engine: derive it from the glyph
    if (MG.MG_HERO && (c.special & MG.MG_HERO)) heroXY = [x, y];
    cells[y][x] = c;
    if (!isMonGlyph(c.glyph)) { mem[y][x] = c.glyph; memCm[y][x] = c.cmap; memGold[y][x] = c.ch === '$' && isObjGlyph(c.glyph); }
    if (c.cmap >= 0) terrain[y][x] = c.cmap;
  },
  onMapFlush() { requestDraw(); },
  onClearMap() {
    for (const r of cells) r.fill(null);
    for (const r of mem) r.fill(-1);
    for (const r of memCm) r.fill(-1);
    for (const r of terrain) r.fill(-1);
    for (const r of memGold) r.fill(false);
    objSeenAt = null;
    seenHereMsg = '';
    freshLevel = true; // arriving somewhere new: don't ask about the stairs you arrived on
    if (lastKey === 62) arrivedOn = S_upstair; else if (lastKey === 60) arrivedOn = S_dnstair;
    requestDraw();
  },
  onCursor(x, y) { cursor = [x, y]; requestDraw(); },
  onCliparound() {},
  onMessage(s) {
    if (autoSaving && /^Saving/.test(s)) return;
    // Silent auto-resume: hide the restore greeting and the moon/Friday-13th notice NetHack repeats on
    // restore (the player never left). Ends at the first prompt for input (see getKey).
    if (resuming && /^Restoring save file|welcome back to NetHack|^(Be careful!|You are lucky!|Watch out!).*(moon|Friday)/.test(s)) return;
    // While NetHack writes its end-of-game summary, two of its section headers also reach the message line.
    if (ending && /^(Spells|Skills):$/.test(s)) return;
    s = touchMsg(s);
    if (s == null) return;
    noteMessage(s);
    addMsg(s);
  },
  onHistory() {},
  onClearMessages() { msgCut = msgLog.length; renderMsgs(); },
  onStatus(s) { renderStatus(s); },
  onBell() { buzz(40); },
  delay() {
    // Called between steps of running/travel (runmode:walk) so you see the hero move.
    if (autoSaving || document.hidden) return Promise.resolve();
    return new Promise((r) => setTimeout(r, 35));
  },
  onConsole(s) { console.log('[nethack]', s); },
  onExit(msg) { if (msg && !autoSaving) addMsg(msg); setTimeout(finishGame, 150); },

  getKey() {
    if (autoSaving) {
      if (++autoSaveKeys > 6) { autoSaving = false; gameState = 'playing'; } // give up rather than spin
      else return Promise.resolve({ key: 'S'.charCodeAt(0) });
    }
    resuming = false; // the restore is complete once NetHack asks for a command
    autoItem.pending = false;
    if (lastInputCursor?.[0] !== cursor[0] || lastInputCursor?.[1] !== cursor[1]) { follow = true; if (objSeenAt && objSeenAt !== `${cursor[0]},${cursor[1]}`) objSeenAt = null; }
    lastInputCursor = [...cursor];
    if (arrivedOn >= 0 && cursor[0] > 0) {
      if (memCm[cursor[1]][cursor[0]] === -1 && G.GLYPH_CMAP_OFF != null) memCm[cursor[1]][cursor[0]] = arrivedOn;
      arrivedOn = -1;
    }
    if (hint && !inputQ.length && --hint.left < 0) hint = null;
    placeCamera();
    requestDraw();
    updateChips();
    // Once the hero comes to rest on a new square, flash the buttons for what's there (not on arrival at a new level).
    if (!inputQ.length) {
      const pos = String(heroXY || cursor);
      if (freshLevel || promptedAt == null) { freshLevel = false; promptedAt = pos; }
      else if (pos !== promptedAt) { promptedAt = pos; pulseChips(); }
    }
    const note = (k) => { if (k.key != null) lastKey = k.key; return k; };
    if (inputQ.length) return Promise.resolve(note(inputQ.shift()));
    return new Promise((r) => { keyWaiter = r; }).then(note);
  },

  more() {
    if (autoSaving) return Promise.resolve();
    requestDraw();
    return new Promise((r) => {
      moreWaiter = r;
      activeCancel = resolveMore;
      $('#morehint').hidden = false;
      $('#veil').hidden = false;
    });
  },

  yn(query, resp, def) {
    const visible = resp.split('\x1b')[0].replace('#', '');
    if (autoSaving) return Promise.resolve(/really save/i.test(query) ? 'y'.charCodeAt(0) : escMap(visible, def));
    // Type-ahead (keyboard, or a command sent with its item letter) answers prompts directly.
    if (/possessions identified|Really quit/i.test(query) && !ending) { ending = true; endingAt = msgLog.length; }
    if (inputQ.length && inputQ[0].key != null) return Promise.resolve(inputQ.shift().key);
    inputQ.length = 0;
    // "What do you want to eat? [d or ?*]": item letters mean nothing on a phone, so go straight to
    // NetHack's own list of suitable items ('?'), or all items ('*') if that's the only list offered.
    const itemSpec = query.match(/\[([^\]]*) or ([?*]+)\]\s*$/);
    // Safety: if the same question comes straight back, don't answer it automatically again.
    const now = Date.now();
    const repeat = autoItem.q === query && now - autoItem.t < 1500;
    if (itemSpec && !repeat) {
      autoItem = { q: query, t: now, pending: true };
      return Promise.resolve((itemSpec[2].includes('?') ? '?' : '*').charCodeAt(0));
    }
    requestDraw();
    return new Promise((resolve) => {
      const done = (code) => {
        activeCancel = null;
        if (code === ESC && visible) code = escMap(visible, def);
        closeSheet();
        if (query) addMsg(`${query} ${code === ESC ? '' : String.fromCharCode(code)}`);
        resolve(code);
      };
      activeCancel = () => done(ESC);
      let body, buttons = [['Cancel', () => done(ESC)]];
      if (visible) {
        const names = /^[rl]{2}$/.test(visible) ? { r: 'Right', l: 'Left' } : visible.length <= 4 ? YN_LABELS : {};
        body = el('div', { class: 'choices' }, ...[...visible].map((c) => el('button', { class: c === def ? 'primary' : '', onclick: () => done(c.charCodeAt(0)) }, names[c] || c)));
      } else if (/direction/i.test(query)) {
        body = dirGrid(done);
      } else {
        const m = query.match(/\[([^\]]*)\]\s*$/);
        if (m) {
          const [letters, extra = ''] = m[1].split(' or ');
          const listBtns = [];
          if (extra.includes('?')) listBtns.push(['Show list', () => done(63), 'primary']);
          if (extra.includes('*')) listBtns.push(['All items', () => done(42)]);
          buttons = [...listBtns, ...buttons];
          body = el('div', { class: 'choices' }, ...expandLetters(letters).map((c) => el('button', { onclick: () => done(c.charCodeAt(0)) }, c)));
        } else {
          const inp = el('input', { class: 'search', placeholder: 'Your answer', maxlength: '1', autocomplete: 'off', autocapitalize: 'off' });
          inp.addEventListener('input', () => { if (inp.value) done(inp.value.charCodeAt(0)); });
          body = el('div', {}, inp, el('div', { class: 'choices' }, ...['y', 'n', '.', ','].map((c) => el('button', { onclick: () => done(c.charCodeAt(0)) }, c))));
        }
      }
      openSheet({ title: query.replace(/\s*\[[^\]]*\]\s*$/, ''), body, buttons, onKey: (code) => done(code) });
    });
  },

  menu({ how, prompt, items, isInventory }) {
    if (autoSaving) return Promise.resolve(how === 'PICK_NONE' ? [] : null);
    inputQ.length = 0;
    return new Promise((resolve) => {
      const finish = (val) => { activeCancel = null; closeSheet(); resolve(val); };
      activeCancel = () => finish(how === 'PICK_NONE' ? [] : null);
      // 3.6.7: our own item-action sheet. 5.0 has its own ("Do what with the X?"), so its inventory is a plain pick list.
      if (!V50 && isInventory && how === 'PICK_NONE' && !ending) { inventorySheet(items, finish); return; }

      items = items.filter((i) => !(i.id ? MENU_HIDE.test(i.str) : MENU_TEXT_HIDE.test(i.str))).map((i) => ({ ...i, str: touchText(i.str) }));
      const sel = new Map(items.filter((i) => i.id && i.selected).map((i) => [i.id, -1])); // id -> count (-1 = all)
      const rows = [];
      const ok = () => finish(items.filter((i) => i.id && sel.has(i.id)).map((i) => ({ id: i.id, count: sel.get(i.id) })));
      const paint = (it, row) => {
        row.classList.toggle('sel', sel.has(it.id));
        const n = sel.get(it.id);
        row.querySelector('.cnt').textContent = n > 0 ? `×${n}` : '';
      };
      const toggle = (item, row) => {
        if (how === 'PICK_ONE') { finish([{ id: item.id, count: -1 }]); return; }
        if (sel.has(item.id)) sel.delete(item.id); else sel.set(item.id, -1);
        paint(item, row);
      };
      const askCount = (item, row) => {
        const inp = el('input', { class: 'count', type: 'number', inputmode: 'numeric', min: '1', placeholder: 'how many' });
        const commit = () => { const n = parseInt(inp.value, 10); if (n > 0) sel.set(item.id, n); inp.replaceWith(cntSpan()); paint(item, row); };
        row.querySelector('.cnt').replaceWith(inp);
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); e.stopPropagation(); });
        inp.addEventListener('blur', commit);
        inp.addEventListener('click', (e) => e.stopPropagation());
        setTimeout(() => inp.focus(), 30);
      };
      const cntSpan = () => el('span', { class: 'cnt' });
      const body = el('div');
      for (const it of items) {
        if (!it.id) { body.append(el('div', { class: it.attr ? 'mh' : 'mtext' }, it.str)); continue; }
        const row = el('div', { class: 'mi' + (sel.has(it.id) ? ' sel' : '') },
          how === 'PICK_ANY' ? el('span', { class: 'box' }) : null,
          tileIcon(it.tile), el('span', { class: 'txt' }, it.str), cntSpan());
        if (how !== 'PICK_NONE') {
          let t = null, long = false;
          row.addEventListener('pointerdown', () => { long = false; if (how === 'PICK_ANY' && /^\d+ /.test(it.str)) t = setTimeout(() => { long = true; buzz(15); askCount(it, row); }, 450); });
          row.addEventListener('pointerup', () => clearTimeout(t));
          row.addEventListener('pointerleave', () => clearTimeout(t));
          row.addEventListener('click', () => { if (!long) toggle(it, row); });
        }
        rows.push([it, row]);
        body.append(row);
      }
      let buttons;
      if (how === 'PICK_NONE') buttons = [['Close', () => finish([]), 'primary']];
      else if (how === 'PICK_ONE') buttons = [['Cancel', () => finish(null)]];
      else buttons = [['Cancel', () => finish(null)], ['All', () => { for (const [it, row] of rows) { sel.set(it.id, -1); paint(it, row); } }], ['OK', ok, 'primary']];
      const hint = how === 'PICK_ANY' && items.some((i) => /^\d+ /.test(i.str)) ? '\nHold a stack to choose how many.' : '';
      openSheet({
        title: (prompt || itemQuestion() || (isInventory ? (how === 'PICK_ONE' ? 'Inventory — tap an item' : 'Inventory') : how === 'PICK_NONE' ? '' : 'Choose')) + hint,
        body,
        buttons,
        onKey: (code) => {
          if (code === ESC) return finish(how === 'PICK_NONE' ? [] : null);
          if (code === 13 || code === 32) return how === 'PICK_NONE' ? finish([]) : how === 'PICK_ANY' ? ok() : null;
          const hit = rows.find(([it]) => it.ch === String.fromCharCode(code));
          if (hit) toggle(hit[0], hit[1]);
        },
      });
    });
  },

  text(lines) {
    if (autoSaving) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => { activeCancel = null; closeSheet(); resolve(); };
      activeCancel = done;
      openSheet({ title: '', body: renderText(lines.map((l) => touchMsg(l.str)).filter((l) => l != null)), buttons: [['OK', done, 'primary']], onKey: done });
    });
  },

  getline(query) {
    if (autoSaving) return Promise.resolve(null);
    inputQ.length = 0;
    return new Promise((resolve) => {
      const inp = el('input', { class: 'search', autocomplete: 'off' });
      const done = (v) => { activeCancel = null; closeSheet(); resolve(v); };
      activeCancel = () => done(null);
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(inp.value); if (e.key === 'Escape') done(null); });
      openSheet({ title: query, body: inp, buttons: [['Cancel', () => done(null)], ['OK', () => done(inp.value), 'primary']], onOpen: () => setTimeout(() => inp.focus(), 50) });
    });
  },

  extcmd() {
    if (autoSaving) return Promise.resolve(null);
    if (pendingExt) { const n = pendingExt; pendingExt = null; return Promise.resolve(n); }
    return new Promise((resolve) => {
      const done = (n) => { activeCancel = null; closeSheet(); resolve(n); };
      activeCancel = () => done(null);
      openSheet({ title: 'Commands', body: listSheet({ entries: extEntries(), onPick: (e) => done(e.ext) }), buttons: [['Cancel', () => done(null)]], onKey: (c) => { if (c === ESC) done(null); } });
    });
  },
};

/* ---------------- game lifecycle ---------------- */
let M = null;
let stored = {};

async function finishGame() {
  try {
    stored = collectPersistentFiles(M);
    await kvSet('files', stored);
  } catch (e) { console.error('persist failed', e); }
  const hasSave = Object.keys(stored).some((p) => p.startsWith('/save/'));
  $('#chips').replaceChildren();
  if (autoSaving && hasSave) {
    autoSaving = false;
    gameState = 'suspended';
    prefs.resume = curName; savePrefs();
    if (!document.hidden) resumeGame();
    return;
  }
  autoSaving = false;
  gameState = 'ended';
  prefs.resume = null; savePrefs();
  const dump = hasSave ? null : await keepDumplog();
  openSheet({
    title: hasSave ? 'Game saved' : 'Game over',
    body: el('div', { class: 'mtext', style: 'white-space:pre-wrap' }, hasSave ? 'Your game is saved on this device. Continue it from the title screen.'
      : (dump?.how ? `${dump.how}\n\n` : '') + gameOverSummary()),
    buttons: [...(dump ? [['Full summary', () => showDumplog(dump, () => finishSheetAgain(dump))]] : []), ['Back to title', backToTitle, 'primary']],
  });
}
function finishSheetAgain(dump) {
  openSheet({
    title: 'Game over',
    body: el('div', { class: 'mtext', style: 'white-space:pre-wrap' }, (dump.how ? `${dump.how}\n\n` : '') + gameOverSummary()),
    buttons: [['Full summary', () => showDumplog(dump, () => finishSheetAgain(dump))], ['Back to title', backToTitle, 'primary']],
  });
}

/* ---------------- end-of-game summaries (NetHack's dumplog) ---------------- */
// The 5.0 build writes a full end-of-game report (DUMPLOGFILE=/tmp/dumplog.txt in its sysconf). It is read
// once the game ends and kept on the device (last MAX_DUMPS), so it can be read again or shared later.
const MAX_DUMPS = 30;
async function loadDumps() { try { return (await kvGet('dumplogs')) || []; } catch { return []; } }
async function keepDumplog() {
  let text;
  try { text = M.FS.readFile('/tmp/dumplog.txt', { encoding: 'utf8' }); M.FS.unlink('/tmp/dumplog.txt'); } catch { return null; }
  if (!text?.trim()) return null;
  // How the game ended: the paragraph after NetHack's farewell line ("Goodbye/Farvel/Sayonara ... the Valkyrie..."),
  // first sentence ("You died in The Dungeons of Doom on dungeon level 3 with 120 points, and 15 pieces of gold, after 900 moves.").
  const para = [...text.matchAll(/(?:^|\n)[^\n]*\.\.\.\n\s*\n(You [\s\S]*?)(?:\n\s*\n|$)/g)].pop()?.[1] || '';
  const how = (para.replace(/\s+/g, ' ').trim().match(/^.*?\.(?=\s|$)/) || [''])[0];
  const dump = { name: curName, date: new Date().toISOString(), title: (lastStatus.TITLE?.value || curName || '').toString().trim(), how, text };
  const all = await loadDumps();
  all.unshift(dump);
  try { await kvSet('dumplogs', all.slice(0, MAX_DUMPS)); } catch (e) { console.error('keeping summary failed', e); }
  return dump;
}
function shareText(name, text, title) {
  const file = new File([text], name, { type: 'text/plain' });
  (async () => {
    try {
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title }); return; }
    } catch (e) { if (e?.name === 'AbortError') return; }
    const a = el('a', { href: URL.createObjectURL(file), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  })();
}
function showDumplog(d, back) {
  const fname = `mazes-of-menace-${(d.name || 'game').toLowerCase()}-${d.date.slice(0, 10)}.txt`;
  openSheet({
    title: `${d.title || d.name} · ${d.date.slice(0, 10)}`,
    body: el('pre', { class: 'text dump' }, d.text),
    buttons: [['Share', () => shareText(fname, d.text, `${d.name}'s game`)], ['Back', back, 'primary']],
  });
}
async function pastGames() {
  const all = await loadDumps();
  const body = all.length ? el('div', {}, ...all.map((d, i) => el('div', { class: 'cmd', onclick: () => showDumplog(d, pastGames) },
    el('span', {}, `${d.title || d.name}`), el('span', { class: 'desc' }, `${d.date.slice(0, 10)}${d.how ? ' · ' + d.how.replace(/^You /, '').replace(/\.$/, '') : ''}`))))
    : el('div', { class: 'mtext' }, 'Finished games appear here, with NetHack\'s full end-of-game summary.');
  openSheet({ title: 'Past games', body, buttons: [['Close', () => closeSheet(), 'primary']] });
}

function gameOverSummary() {
  const v = (k) => (lastStatus[k]?.value ?? '').toString().trim();
  const before = msgLog.slice(0, endingAt || msgLog.length).slice(-4);
  return [`${v('TITLE')}`, `${v('LEVELDESC')} · Turn ${v('TIME')} · Level ${v('XP')}`, '', ...before].join('\n');
}

// Return to the title screen without reloading (reloads can be blocked where the page is embedded).
function backToTitle() {
  closeSheet();
  resolveMore();
  gameState = 'title';
  autoSaving = false;
  ending = false;
  inputQ.length = 0;
  keyWaiter = null;
  for (const r of cells) r.fill(null);
  for (const r of mem) r.fill(-1);
  for (const r of memCm) r.fill(-1);
  msgLog.length = 0; msgCut = 0; renderMsgs();
  $('#st1').replaceChildren(); $('#st2').replaceChildren(); $('#st3').replaceChildren();
  $('#chips').replaceChildren();
  requestDraw();
  $('#loadmsg').textContent = '';
  $('#start').hidden = false;
  titleScreen();
}

function resumeGame() {
  if (gameState !== 'suspended') return;
  resuming = true;
  begin(curName, true);
}

function ask(question, yes = 'Yes') {
  return new Promise((resolve) => openSheet({
    title: question,
    buttons: [['Cancel', () => { closeSheet(); resolve(false); }], [yes, () => { closeSheet(); resolve(true); }, 'primary']],
  }));
}

// Valid role/race/alignment/gender combinations from NetHack 3.6 role.c.
const ROLE_RULES = {
  archeologist: ['human dwarf gnome', 'lawful neutral'], barbarian: ['human orc', 'neutral chaotic'],
  caveman: ['human dwarf gnome', 'lawful neutral'], healer: ['human gnome', 'neutral'], knight: ['human', 'lawful'],
  monk: ['human', 'lawful neutral chaotic'], priest: ['human elf', 'lawful neutral chaotic'], rogue: ['human orc', 'chaotic'],
  ranger: ['human elf gnome orc', 'neutral chaotic'], samurai: ['human', 'lawful'], tourist: ['human', 'neutral'],
  valkyrie: ['human dwarf', 'lawful neutral'], wizard: ['human elf gnome orc', 'neutral chaotic'],
};
const RACE_ALIGN = { human: 'lawful neutral chaotic', elf: 'chaotic', dwarf: 'lawful', gnome: 'neutral', orc: 'chaotic' };
function pickRole({ race, align, gender }) {
  const ok = Object.entries(ROLE_RULES).filter(([role, [races, aligns]]) =>
    (!race || races.split(' ').includes(race)) &&
    (!align || (aligns.split(' ').includes(align) && (!race || RACE_ALIGN[race].includes(align)))) &&
    !(role === 'valkyrie' && gender === 'male'));
  const pool = ok.length ? ok : Object.entries(ROLE_RULES);
  return pool[Math.floor(Math.random() * pool.length)][0];
}

const ROLES = ['Archeologist', 'Barbarian', 'Caveman', 'Healer', 'Knight', 'Monk', 'Priest', 'Rogue', 'Ranger', 'Samurai', 'Tourist', 'Valkyrie', 'Wizard'];
function fillSelect(sel, vals, cur) {
  sel.replaceChildren(el('option', { value: '' }, 'Random'), ...vals.map((v) => el('option', { value: v.toLowerCase() }, v)));
  sel.value = cur || '';
}
const GENERIC = /^(play|player|game|games|nethack|nethacker)$/i; // sysconf GENERICUSERS
const cleanName = (s) => {
  const n = (s || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 20);
  return GENERIC.test(n) ? '' : n;
};
// Free text that goes into the NetHack options string: no commas/colons (option separators), trimmed.
const cleanText = (s, n) => (s || '').replace(/[,:=\\"]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
// Auto-pickup choices: value -> NetHack options.
const PICKUP = [['off', 'Off'], ['gold', 'Gold only'], ['magic', 'Gold and small magic items']];
const PICKUP_OPTS = { off: ['!autopickup'], gold: ['autopickup', 'pickup_types:$'], magic: ['autopickup', 'pickup_types:$?!/="+'] };
const saveNames = () => Object.keys(stored).filter((p) => p.startsWith('/save/')).map((p) => p.replace(/^\/save\/\d*/, ''));

async function titleScreen() {
  try { stored = (await kvGet('files')) || {}; } catch { stored = {}; }
  const saves = saveNames();
  // The app was closed while auto-saved: drop straight back into the game.
  if (prefs.resume && saves.includes(prefs.resume)) { resuming = true; begin(prefs.resume, true); return; }
  fillSelect($('#prole'), ROLES, prefs.role);
  fillSelect($('#prace'), ['Human', 'Elf', 'Dwarf', 'Gnome', 'Orc'], prefs.race);
  fillSelect($('#pgender'), ['Male', 'Female'], prefs.gender);
  fillSelect($('#palign'), ['Lawful', 'Neutral', 'Chaotic'], prefs.align);
  $('#ppet').replaceChildren(...[['', 'Random'], ['cat', 'Kitten'], ['dog', 'Little dog'], ['horse', 'Pony'], ['none', 'No pet']].map(([v, l]) => el('option', { value: v }, l)));
  $('#ppet').value = prefs.pet || '';
  $('#ppetname').value = prefs.petname || '';
  $('#pfruit').value = prefs.fruit || '';
  $('#ppickup').replaceChildren(...PICKUP.map(([v, l]) => el('option', { value: v }, l)));
  $('#ppickup').value = prefs.pickup || 'gold';
  $('#exportsaves').onclick = exportSaves;
  $('#pastgames').onclick = pastGames;
  $('#howtoplay').onclick = () => openHelp();
  $('#importsaves').onclick = () => $('#importfile').click();
  $('#importfile').onchange = (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) importSaves(f); };
  $('#exportsaves').disabled = !Object.keys(stored).length;
  loadDumps().then((d) => { $('#pastgames').hidden = !d.length; });
  $('#pname').value = prefs.name || 'Adventurer';
  $('#saves').replaceChildren(...saves.map((n) => el('div', { class: 'row' },
    el('button', { class: 'primary', onclick: () => begin(n, true) }, `Continue ${n}`),
    el('button', { class: 'del', 'aria-label': `Delete save ${n}`, onclick: async () => {
      if (!(await ask(`Delete the saved game for ${n}?`, 'Delete'))) return;
      for (const p of Object.keys(stored)) if (p.startsWith('/save/') && p.endsWith(n)) delete stored[p];
      await kvSet('files', stored);
      titleScreen();
    } }, '✕'))));
  $('#newgame').onclick = async () => {
    const name = cleanName($('#pname').value) || 'Adventurer';
    Object.assign(prefs, { name, role: $('#prole').value, race: $('#prace').value, gender: $('#pgender').value, align: $('#palign').value,
      pet: $('#ppet').value, petname: cleanText($('#ppetname').value, 20), fruit: cleanText($('#pfruit').value, 30), pickup: $('#ppickup').value });
    savePrefs();
    if (saves.includes(name) && !(await ask(`${name} already has a saved game, so this will continue it. Use a different name to start fresh.`, 'Continue it'))) return;
    begin(name, false);
  };
  $('#newgame').disabled = false;
}

/* ---------------- Android app (Capacitor) ----------------
   In the Play/F-Droid app these use Capacitor's plugins; in a browser they fall back or do nothing. */
const CAP = globalThis.Capacitor?.isNativePlatform?.() ? globalThis.Capacitor.Plugins : null;
function buzz(p) {
  if (!CAP?.Haptics) { navigator.vibrate?.(p); return; }
  const seq = Array.isArray(p) ? p : [p];
  let t = 0;
  seq.forEach((d, i) => { if (i % 2 === 0) setTimeout(() => CAP.Haptics.vibrate({ duration: d }).catch(() => {}), t); t += d; });
}
// Phone Back button: works like Escape. Closes --More--, menus and dialogs first; in play it offers Save and quit;
// on the title screen it leaves the app.
function androidBack() {
  if (moreWaiter) { resolveMore(); return; }
  if (!$('#sheet').hidden) {
    if (sheetKey) { sheetKey(ESC, 'Escape'); return; }
    const btn = [...$('#sheetbtns').querySelectorAll('button')].find((b) => /^(Cancel|Close|Back|Back to title|No|Done|OK)$/.test(b.textContent));
    if (btn) btn.click(); else closeSheet();
    return;
  }
  if (!$('#start').hidden) { CAP?.App?.exitApp(); return; }
  if (gameState === 'playing' && keyWaiter) pushKeys('S');
}
function androidSetup() {
  if (!CAP) return;
  CAP.App?.addListener('backButton', androidBack);
  CAP.StatusBar?.setOverlaysWebView({ overlay: false }).catch(() => {});
  CAP.StatusBar?.setBackgroundColor({ color: '#0d0f12' }).catch(() => {});
  CAP.StatusBar?.setStyle({ style: 'DARK' }).catch(() => {});
}

/* ---------------- save backup ---------------- */
// One JSON file with every stored file (saves, scores, logs), base64-encoded. Restoring merges it in.
const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function exportSaves() {
  const files = Object.fromEntries(Object.entries(stored).map(([p, d]) => [p, b64(d instanceof Uint8Array ? d : new Uint8Array(d))]));
  const json = JSON.stringify({ app: 'pocket-yendor', nethack: V50 ? '5.0.0' : '3.6.7', saved: new Date().toISOString(), files, dumplogs: await loadDumps() });
  const name = `mazes-of-menace-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([json], name, { type: 'application/json' });
  try {
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: 'Mazes of Menace backup' }); return; }
  } catch (e) { if (e?.name === 'AbortError') return; }
  const a = el('a', { href: URL.createObjectURL(file), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
async function importSaves(f) {
  let data;
  try { data = JSON.parse(await f.text()); } catch { data = null; }
  if (!data || data.app !== 'pocket-yendor' || typeof data.files !== 'object') { await ask('That file is not a Mazes of Menace backup.', 'OK'); return; }
  if (data.nethack !== (V50 ? '5.0.0' : '3.6.7')) { await ask(`That backup is from NetHack ${data.nethack}, which this version can't load.`, 'OK'); return; }
  const incoming = Object.entries(data.files).filter(([p]) => p.startsWith('/'));
  const names = incoming.filter(([p]) => p.startsWith('/save/')).map(([p]) => p.replace(/^\/save\/\d*/, ''));
  const clash = names.filter((n) => saveNames().includes(n));
  const msg = `Restore ${names.length ? `saved game${names.length > 1 ? 's' : ''} for ${names.join(', ')}` : 'scores and logs'} from ${data.saved?.slice(0, 10) || 'this backup'}?`
    + (clash.length ? `\n\nThis replaces the game${clash.length > 1 ? 's' : ''} saved here for ${clash.join(', ')}.` : '');
  if (!(await ask(msg, 'Restore'))) return;
  for (const [p, d] of incoming) stored[p] = unb64(d);
  await kvSet('files', stored);
  if (Array.isArray(data.dumplogs) && data.dumplogs.length) {
    const have = await loadDumps();
    const seen = new Set(have.map((d) => d.date + d.name));
    const merged = [...have, ...data.dumplogs.filter((d) => d?.text && !seen.has(d.date + d.name))].sort((a, b) => (a.date < b.date ? 1 : -1));
    await kvSet('dumplogs', merged.slice(0, MAX_DUMPS));
  }
  titleScreen();
}

async function begin(name, cont) {
  curName = name;
  $('#newgame').disabled = true;
  $('#loadmsg').textContent = 'Loading NetHack…';
  const opts = [`name:${name}`, 'mouse_support', 'hilite_pet', 'hilite_pile', 'time', 'showexp', 'lit_corridor', 'runmode:walk',
    ...(PICKUP_OPTS[prefs.pickup] || PICKUP_OPTS.gold)];
  // 5.0 asks "Do you want a tutorial?" at every new game. On unless turned off in Settings.
  if (V50 && prefs.tutorial === false) opts.push('!tutorial');
  // 5.0 "tips" are keyboard instructions (e.g. how to leave farlook with ESC); they don't apply to touch.
  if (V50) opts.push('!tips');
  if (!cont) {
    // NetHack's own random role pick is unreliable in this build, so choose a valid one here.
    opts.push(`role:${prefs.role || pickRole(prefs)}`);
    if (prefs.race) opts.push(`race:${prefs.race}`);
    if (prefs.gender) opts.push(`gender:${prefs.gender}`);
    if (prefs.align) opts.push(`align:${prefs.align}`);
    if (prefs.pet) opts.push(`pettype:${prefs.pet}`);
    if (prefs.petname) {
      const kinds = { cat: ['catname'], dog: ['dogname'], horse: ['horsename'] }[prefs.pet] || (prefs.pet === 'none' ? [] : ['catname', 'dogname', 'horsename']);
      for (const k of kinds) opts.push(`${k}:${prefs.petname}`);
    }
    if (prefs.fruit) opts.push(`fruit:${prefs.fruit}`);
  }
  for (const r of cells) r.fill(null);
  for (const r of mem) r.fill(-1);
  for (const r of memCm) r.fill(-1);
  for (const r of terrain) r.fill(-1);
  lastInputCursor = null;
  lastKey = 0;
  ending = false;
  hint = null;
  heroXY = null; promptedAt = null; freshLevel = true; seenHereMsg = ''; prevHp = null;
  arrivedOn = cont ? -1 : S_upstair; // a new game always starts on the up staircase
  fitZoom();
  measure();
  placeCamera();
  gameState = 'playing';
  try {
    M = await startNetHack({
      createModule,
      ui,
      options: (lastOpts = opts.join(',')),
      files: stored,
    });
  } catch (e) {
    gameState = 'title';
    $('#start').hidden = false;
    $('#loadmsg').textContent = 'Failed to load: ' + e;
    return;
  }
  $('#start').hidden = true;
}

renderActions();
document.title = `Mazes of Menace — NetHack ${V50 ? '5.0.0' : '3.6.7'}`;
$('#start .sub').textContent = `NetHack ${V50 ? '5.0' : '3.6.7'}`;
androidSetup();
titleScreen();
