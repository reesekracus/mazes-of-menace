// NetHack 5.0.0 WASM bridge. Same interface as engine.js (3.6.7), so app.js can use either.
// Turns the shim window-port callbacks into a small, UI-agnostic interface.
// The UI object supplies async methods (getKey, yn, menu, text, getline, extcmd, more)
// and sync notifications (onGlyph, onMessage, onStatus, ...).
//
// 5.0 differences handled here (see claude/BUILD-5.0-TRIAL.md):
// - Every callback's return value is type-checked by the glue, so each case returns the right JS type
//   ('b' boolean, 'i' integer, 'c' char code 0..128, 's' string, 'v' anything).
// - print_glyph passes glyph_info* (no mapglyph call); add_menu passes glyph_info* plus clr/itemflags.
// - menu_item is 16 bytes (anything item @0 [8], long count @8, unsigned itemflags @12).
// - nh_poskey coordinates are int16 (coordxy).
// - The game's final exit() is reported through Module.onExit (build uses -sEXIT_RUNTIME=1).

import { EXT_CMDS, MAXPCHARS } from './nh50consts.js';

export { EXT_CMDS };
export const COLNO = 80;
export const ROWNO = 21;
export const NH_VERSION = '5.0.0';

const BUFSZ = 256;
const MENU_ITEM_SIZE = 16;
const MENU_ITEMFLAGS_SELECTED = 1;
const MENU_BEHAVE_PERMINV = 1; // start_menu behavior for the persistent-inventory panel

export async function startNetHack({ createModule, ui, options, files = {} }) {
  let M;
  let exited = false;
  const fireExit = (msg) => {
    if (exited) return;
    exited = true;
    ui.onExit?.(msg);
  };
  const windows = new Map();
  let nextWin = 1;
  let lastType = '';
  let invenWin = 0; // WIN_INVEN: the first NHW_MENU created right after the map (display_gamewindows order)
  // 'i' in 5.0 uses a separate cached menu window; recognise it as an untitled menu that lists objects.
  const isObjGlyph = (g) => { const G = C().GLYPH; return (g >= G.GLYPH_OBJ_OFF && g < G.GLYPH_CMAP_OFF) || (g >= G.GLYPH_BODY_OFF && g < G.GLYPH_RIDDEN_OFF); };
  const status = {};
  let statusQueued = false;
  let flushQueued = false;

  const C = () => globalThis.nethackGlobal.constants;
  const winType = (id) => windows.get(id)?.type;

  // glyph_info (36 bytes): glyph@0 ttychar@4 framecolor@8 glyphflags@12 color@16 symidx@20
  // customcolor@24 color256idx@28 (i16) tileidx@30 (i16). Offsets checked with emcc offsetof.
  function readGlyphInfo(p) {
    const symidx = M.getValue(p + 20, 'i32');
    const glyph = M.getValue(p, 'i32');
    return {
      glyph,
      ch: String.fromCharCode(M.getValue(p + 4, 'i32') & 0xff),
      framecolor: M.getValue(p + 8, 'i32'),
      special: M.getValue(p + 12, 'i32') >>> 0, // MG_* flags (MG_PET, MG_DETECT, MG_OBJPILE, ...)
      color: M.getValue(p + 16, 'i32'),
      tile: M.getValue(p + 30, 'i16'),
      // Map feature index (S_* in nh50consts CMAP) when this glyph is a dungeon feature, else -1.
      cmap: isCmapGlyph(glyph) && symidx >= 0 && symidx < MAXPCHARS ? symidx : -1,
    };
  }
  function isCmapGlyph(g) {
    const G = C().GLYPH;
    return g >= G.GLYPH_CMAP_OFF && g < G.GLYPH_EXPLODE_OFF;
  }
  function queueMapFlush() {
    if (flushQueued) return;
    flushQueued = true;
    queueMicrotask(() => { flushQueued = false; ui.onMapFlush?.(); });
  }
  const str = (p) => (p ? M.UTF8ToString(p) : '');

  async function cb(name, ...a) {
    switch (name) {
      // ---- lifecycle / no-ops ----
      case 'shim_init_nhwindows':
      case 'shim_get_nh_event':
      case 'shim_suspend_nhwindows':
      case 'shim_resume_nhwindows':
      case 'shim_mark_synch':
      case 'shim_wait_synch':
      case 'shim_number_pad':
      case 'shim_preference_update':
      case 'shim_status_init':
      case 'shim_status_enablefield':
      case 'shim_update_positionbar':
      case 'shim_change_color':
      case 'shim_change_background':
      case 'shim_putmsghistory':
        return undefined;

      // Role, race, gender and alignment come from NETHACKOPTIONS; skip the text-mode selection.
      case 'shim_player_selection_or_tty':
        return false;

      case 'shim_askname':
        // Only reached when the name is missing or generic. 5.0's libnh exposes no way to set
        // plname from JS, so the UI must always pass a real name: options "name:...".
        ui.onConsole?.('askname called: pass a non-generic name in options');
        return undefined;

      case 'shim_exit_nhwindows':
        fireExit(a[0]);
        return undefined;

      // ---- windows ----
      case 'shim_create_nhwindow': {
        const id = nextWin++;
        const type = C().WIN_TYPE[a[0]] || String(a[0]);
        if (!invenWin && type === 'NHW_MENU' && lastType === 'NHW_MAP') invenWin = id;
        lastType = type;
        windows.set(id, { type, lines: [], items: [], prompt: '' });
        return id;
      }
      case 'shim_destroy_nhwindow':
        windows.delete(a[0]);
        return undefined;
      case 'shim_clear_nhwindow': {
        const w = windows.get(a[0]);
        if (!w) return undefined;
        if (w.type === 'NHW_MAP') ui.onClearMap();
        else if (w.type === 'NHW_MESSAGE') ui.onClearMessages?.();
        w.lines = [];
        return undefined;
      }
      case 'shim_curs':
        if (winType(a[0]) === 'NHW_MAP') ui.onCursor?.(a[1], a[2]);
        return undefined;
      case 'shim_cliparound':
        ui.onCliparound?.(a[0], a[1]);
        return undefined;
      case 'shim_putstr': {
        const [win, attr, s] = a;
        const w = windows.get(win);
        if (!w) return undefined;
        if (w.type === 'NHW_MESSAGE') ui.onMessage(s, attr);
        else w.lines.push({ attr, str: s });
        return undefined;
      }
      case 'shim_raw_print':
      case 'shim_raw_print_bold':
        ui.onMessage(a[0], name === 'shim_raw_print_bold' ? 1 : 0);
        return undefined;
      case 'shim_getmsghistory':
        // The glue writes a returned string straight into the char* slot, so only '' (NULL) is safe.
        return '';
      case 'shim_get_color_string':
        return '';

      case 'shim_display_nhwindow': {
        const [win, blocking] = a;
        const w = windows.get(win);
        if (!w) return undefined;
        if (w.type === 'NHW_MESSAGE') {
          if (blocking) { ui.onMapFlush?.(); await ui.more(); }
        } else if (w.type === 'NHW_MAP') {
          ui.onMapFlush?.();
        } else if (w.lines.length) {
          ui.onMapFlush?.();
          await ui.text(w.lines);
          w.lines = [];
        }
        return undefined;
      }
      case 'shim_display_file':
        ui.onDisplayFile?.(a[0], a[1]);
        return undefined;

      // ---- menus ----
      case 'shim_start_menu': {
        const w = windows.get(a[0]);
        if (w) { w.items = []; w.lines = []; w.prompt = ''; w.behavior = a[1]; }
        return undefined;
      }
      case 'shim_add_menu': {
        // (win, glyph_info*, identifier [a_int, read by the glue], ch, gch, attr, clr, str, itemflags)
        const [win, gip, id, ch, gch, attr, clr, s, itemflags] = a;
        const w = windows.get(win);
        if (!w) return undefined;
        const gi = gip ? readGlyphInfo(gip) : null;
        const G = C().GLYPH;
        const real = gi && gi.glyph !== G.NO_GLYPH && gi.glyph >= 0 && gi.glyph < G.MAX_GLYPH; // non-item rows use nul_glyphinfo
        w.items.push({
          id,
          glyph: real ? gi.glyph : -1,
          tile: real ? gi.tile : -1,
          ch: ch ? String.fromCharCode(ch & 0xff) : '',
          gch: gch ? String.fromCharCode(gch & 0xff) : '',
          attr,
          clr,
          str: s,
          selected: !!(itemflags & MENU_ITEMFLAGS_SELECTED),
        });
        return undefined;
      }
      case 'shim_end_menu': {
        const w = windows.get(a[0]);
        if (w) w.prompt = a[1] || '';
        return undefined;
      }
      case 'shim_select_menu': {
        const [win, howNum, listPtr] = a;
        const w = windows.get(win);
        const how = C().MENU_SELECT[howNum] || 'PICK_NONE';
        if (listPtr) M.setValue(listPtr, 0, '*');
        if (!w) return -1;
        // 5.0 refreshes a persistent-inventory panel this way (at start, after restore, when inventory
        // changes). It isn't a question for the player: hand the list to the UI and return at once.
        if (w.behavior === MENU_BEHAVE_PERMINV) {
          ui.onPermInventory?.(w.items);
          return 0;
        }
        ui.onMapFlush?.();
        const isInventory = win === invenWin || (!w.prompt && w.items.some((it) => it.id && isObjGlyph(it.glyph)));
        const picked = await ui.menu({ how, prompt: w.prompt, items: w.items, isInventory });
        if (picked == null) return -1;
        if (how === 'PICK_NONE' || picked.length === 0) return 0;
        const buf = M._malloc(picked.length * MENU_ITEM_SIZE); // NetHack frees it
        picked.forEach((p, i) => {
          const e = buf + i * MENU_ITEM_SIZE;
          M.setValue(e, p.id, 'i32');       // item.a_int
          M.setValue(e + 4, 0, 'i32');      // rest of the 8-byte union
          M.setValue(e + 8, p.count ?? -1, 'i32');
          M.setValue(e + 12, 0, 'i32');     // itemflags
        });
        M.setValue(listPtr, buf, '*');
        return picked.length;
      }
      case 'shim_message_menu': {
        // One-line "menu" NetHack uses when only one item fits (e.g. "d - an uncursed food ration").
        // Returning 0 makes getobj ask again, so offer it as a one-item menu: its letter, or ESC to cancel.
        // The glue reads the char argument as a 32-bit word, so the letter can land in any byte
        // (seen: 0x64000004 for 'd'). The message itself starts with it ("d - 2 food rations"), so use that.
        const [letArg, , mesg] = a;
        const m = /^(\S) - /.exec(mesg || '');
        let code = m ? m[1].charCodeAt(0) : 0;
        for (let sh = 0; !code && sh < 32; sh += 8) { const b = ((letArg >>> sh) & 0xff); if (b > 32 && b < 127) code = b; }
        ui.onMapFlush?.();
        const picked = await ui.menu({ how: 'PICK_ONE', prompt: '', items: [{ id: code || 1, ch: String.fromCharCode(code), str: (mesg || '').replace(/^.\s-\s/, '').replace(/\.$/, ''), tile: -1, glyph: -1 }], isInventory: false });
        return picked && picked.length && code ? code : 27;
      }

      // ---- map ----
      case 'shim_print_glyph': {
        const [win, x, y, gip, bkp] = a;
        if (winType(win) !== 'NHW_MAP') return undefined;
        const c = readGlyphInfo(gip);
        if (bkp) { const bk = readGlyphInfo(bkp); c.bkCmap = bk.cmap; c.bkTile = bk.tile; }
        ui.onGlyph(x, y, c);
        queueMapFlush();
        return undefined;
      }

      // ---- input ----
      case 'shim_nhgetch': {
        ui.onMapFlush?.();
        for (;;) {
          const k = await ui.getKey({ allowClick: false });
          if (k.key != null) return k.key | 0;
        }
      }
      case 'shim_nh_poskey': {
        const [xp, yp, modp] = a;
        ui.onMapFlush?.();
        const k = await ui.getKey({ allowClick: true });
        if (k.key != null) return k.key | 0;
        M.setValue(xp, k.click.x, 'i16'); // coordxy is int16 in 5.0
        M.setValue(yp, k.click.y, 'i16');
        M.setValue(modp, k.click.mod || 1, 'i32');
        return 0;
      }
      case 'shim_yn_function': {
        const [query, resp, def] = a;
        ui.onMapFlush?.();
        const r = await ui.yn(query || '', resp || '', def ? String.fromCharCode(def & 0xff) : '');
        return Math.max(0, Math.min(127, r | 0));
      }
      case 'shim_getlin': {
        const [query, bufp] = a;
        ui.onMapFlush?.();
        const s = await ui.getline(query || '');
        M.stringToUTF8(s == null ? '\x1b' : s.slice(0, BUFSZ - 6), bufp, BUFSZ);
        return undefined;
      }
      case 'shim_get_ext_cmd': {
        ui.onMapFlush?.();
        const nm = await ui.extcmd(EXT_CMDS);
        return nm ? EXT_CMDS.indexOf(nm) : -1;
      }
      case 'shim_doprev_message':
        return 0;
      case 'shim_nhbell':
        ui.onBell?.();
        return undefined;
      case 'shim_delay_output':
        ui.onMapFlush?.();
        await (ui.delay ? ui.delay() : new Promise((r) => setTimeout(r, 40)));
        return undefined;

      // ---- status ----
      case 'shim_status_update': {
        const [fld, ptr, , percent, color] = a;
        const nm = C().STATUS_FIELD[fld] ?? String(fld);
        if (!statusQueued) {
          statusQueued = true;
          queueMicrotask(() => { statusQueued = false; ui.onStatus({ ...status }); });
        }
        if (nm === 'BL_FLUSH' || nm === 'BL_RESET' || nm === 'BL_CHARACTERISTICS') return undefined;
        if (nm === 'BL_CONDITION') {
          const mask = ptr ? M.getValue(ptr, 'i32') >>> 0 : 0;
          const names = Object.entries(C().BL_MASK).filter(([k, v]) => isNaN(k) && k !== 'BL_MASK_BITS' && typeof v === 'number' && v && (mask & v) === v)
            .map(([k]) => k.replace('BL_MASK_', ''));
          status.CONDITION = { value: names, color };
          return undefined;
        }
        // Gold arrives as "\GXXXXXXXX:123" (an encoded glyph); show it as "$:123".
        status[nm.replace('BL_', '')] = { value: str(ptr).replace(/\\G[0-9A-Fa-f]{8}/g, '$'), color: color & 0xff, percent };
        return undefined;
      }
    }
    ui.onConsole?.('unhandled callback ' + name);
    return undefined;
  }

  if (globalThis.nethackGlobal) globalThis.nethackGlobal.shimFunctionRunning = null; // fresh start after a previous game exited

  // Return types are checked by the glue; a wrong default would crash, so errors return a per-type safe value.
  const SAFE = { shim_player_selection_or_tty: false, shim_getmsghistory: '', shim_get_color_string: '', shim_select_menu: -1, shim_get_ext_cmd: -1, shim_yn_function: 27, shim_nhgetch: 27, shim_nh_poskey: 27 };
  globalThis.nethackCallback = async (name, ...args) => {
    try {
      return await cb(name, ...args);
    } catch (e) {
      console.error('callback error', name, e);
      return name in SAFE ? SAFE[name] : 0;
    }
  };

  M = await createModule({
    noInitialRun: true,
    onExit: () => fireExit(),             // built with -sEXIT_RUNTIME=1; fires on death, quit and save
    print: (s) => ui.onConsole?.(s),
    printErr: (s) => ui.onConsole?.(s),
    preRun: [(mod) => {
      mod.ENV.NETHACKOPTIONS = options;
      mod.ENV.USER = 'player';
    }],
    ...(globalThis.NH_LOCATE ? { locateFile: globalThis.NH_LOCATE } : {}),
  });
  try { M.FS.mkdir('/save'); } catch (e) { /* exists */ }
  for (const [path, data] of Object.entries(files)) {
    try { M.FS.writeFile(path, data); } catch (e) { console.warn('restore failed', path, e); }
  }
  M.ccall('shim_graphics_set_callback', null, ['string'], ['nethackCallback']);
  try {
    M._main(0, 0);
  } catch (e) {
    if (!(e && e.name === 'ExitStatus')) ui.onConsole?.('main threw: ' + e);
  }
  return M;
}

// Files worth persisting between sessions (saves, scores, logs).
export function collectPersistentFiles(M) {
  // Everything at the top level except system dirs, embedded game data and level/lock files (e.g. "/0Greg.3").
  const SKIP = new Set(['/dev', '/proc', '/tmp', '/home', '/nhdat', '/sysconf', '/symbols', '/license']);
  const out = {};
  const walk = (dir) => {
    for (const n of M.FS.readdir(dir)) {
      if (n === '.' || n === '..') continue;
      const p = (dir === '/' ? '' : dir) + '/' + n;
      if (SKIP.has(p)) continue;
      const st = M.FS.stat(p);
      if (M.FS.isDir(st.mode)) walk(p);
      else if (!/^\/\d/.test(p)) out[p] = M.FS.readFile(p);
    }
  };
  walk('/');
  return out;
}
