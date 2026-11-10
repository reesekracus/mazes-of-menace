"""Build a DawnLike (DawnHack) tilesheet in NetHack 5.0 tile order.

DawnLike/DawnHack by DragonDePlatino (Andrew Rios), DawnBringer palette; NetHack-format tile files and
names from NetHack 4 / FIQHack (tilesets/dat/tiles/dawnlike-*.txt). License: CC BY-SA 3.0.
Tiles are matched to 5.0's tiles by name; anything without a DawnLike equivalent keeps the default tile.

Usage: python3 tools/build_tiles_dawnlike.py <NetHack-5.0>/win/share <fiqhack>/tilesets/dat/tiles out.png [report.txt]
"""
import re, sys, collections
from PIL import Image

share, dawn, out = sys.argv[1:4]
report = sys.argv[4] if len(sys.argv) > 4 else None
BG = (71, 108, 108)  # NetHack tile-format background colour -> transparent

def parse(path):
    text = open(path).read()
    pal, tiles, tname, rows = {}, [], None, None
    for line in text.splitlines():
        s = line.strip()
        m = re.match(r'^(\S) = \((\d+),\s*(\d+),\s*(\d+)\)', s)
        if m and rows is None:
            pal[m.group(1)] = tuple(int(m.group(i)) for i in (2, 3, 4)); continue
        m = re.match(r'# tile \d+ \((.*)\)$', s)
        if m: tname = m.group(1); continue
        if s == '{' and tname is not None: rows = []; continue
        if s == '}' and rows is not None:
            tiles.append((tname, [[pal[c] for c in r] for r in rows])); tname = rows = None; continue
        if rows is not None and s: rows.append(s)
    return tiles

# DawnLike tiles by name. A tile can carry several names separated by ';'. "sub X" names are
# variants (female forms, special-level walls); they are kept with the "sub " removed.
dl = {}
for f in ('dawnlike-16', 'dawnlike-343', 'dawnlike-4', 'dawnlike-dragons', 'dawnlike-fourk-extras'):
    for name, px in parse(f'{dawn}/{f}.txt'):
        for alt in (a.strip() for a in name.split(';')):
            key = re.sub(r'^sub ', '', alt)
            dl.setdefault(key, px)

# 5.0 renamed some monsters.
MON = {'dwarf leader': 'dwarf lord', 'dwarf ruler': 'dwarf king', 'kobold leader': 'kobold lord', 'gnome leader': 'gnome lord',
       'gnome ruler': 'gnome king', 'ogre leader': 'ogre lord', 'ogre tyrant': 'ogre king', 'vampire leader': 'vampire lord',
       'elf-noble': 'elf-lord', 'elven monarch': 'Elvenking', 'aligned cleric': 'aligned priest', 'high cleric': 'high priest',
       'cave dweller': 'caveman', 'cleric': 'priest', 'amorous demon': 'incubus'}
# Object classes, by the first object of each class in objects.h order; DawnLike names unidentified
# items "<appearance> <class>" (ruby potion, maple wand) and same-looking items "<appearance>s <n>".
CLASS_START = {'adornment': 'ring', 'amulet of ESP': 'amulet', 'large box': 'tool', 'tripe ration': 'food',
               'gain ability': 'potion', 'enchant armor': 'scroll', 'dig': 'spellbook', 'glass / light': 'wand',
               'gold piece': 'coin', 'dilithium crystal': 'gems', 'luckstone': 'stones'}
POS = ['top left', 'top center', 'top right', 'middle left', 'middle center', 'middle right', 'bottom left', 'bottom center', 'bottom right']
WALLS = ['vertical', 'horizontal', 'tlcorn', 'trcorn', 'blcorn', 'brcorn', 'cross wall', 'tuwall', 'tdwall', 'tlwall', 'trwall']
OTHER = {'no door': 'doorway', 'vertical open door': 'open doors 0', 'horizontal open door': 'open doors 1',
         'vertical closed door': 'closed doors 0', 'horizontal closed door': 'closed doors 1', 'floor of a room': 'the floor of a room',
         'dark part of a room': 'unlit the floor of a room', 'branch staircase up': 'staircase up', 'branch staircase down': 'staircase down',
         'branch ladder up': 'ladder up', 'branch ladder down': 'ladder down', 'other altar': 'altar', 'throne': 'opulent throne'}
ALIAS = {'silver mace': 'mace', 'enormous meatball': 'meatball'}
KEEP_DEFAULT = re.compile(r'^(stone|unexplored|nothing)$')  # map background stays black

def candidates(section, name, state):
    if section == 'monsters':
        base, _, sex = name.partition(',')
        base = MON.get(base, base)
        return ([f'female {base}'] if sex == 'female' else []) + [base]
    if section == 'objects':
        parts = [p.strip() for p in name.split(' / ')]
        desc, ident = parts[0], parts[-1]
        start = CLASS_START.get(name) or (CLASS_START.get(ident) if ident != 'light' else None)
        if start and start not in state['done']:
            state['cls'] = start; state['done'].add(start)
        cls = state['cls']
        k = state['seen'][(cls, desc)]; state['seen'][(cls, desc)] += 1
        c = []
        if cls in ('ring', 'amulet', 'potion', 'spellbook', 'wand', 'gems', 'stones'):
            word = 'gems' if cls in ('gems', 'stones') else cls
            c += [f'{desc} {word}', f'{desc} {word} {k}', f'{desc} {word}s {k}']
        c += parts + [f'{desc}s {k}'] + [ALIAS[p] for p in parts if p in ALIAS]
        # Scroll labels new in 5.0 (and mail): any DawnLike scroll, they differ only by label.
        if cls == 'scroll': c.append('ZELGO MER')
        return c
    if KEEP_DEFAULT.match(name): return []
    m = re.match(r'^(main|mines|gehennom|knox|sokoban) walls (.+)$', name)
    if m and m.group(2) in WALLS:
        i = WALLS.index(m.group(2))
        pre = {'main': '', 'mines': 'mine ', 'gehennom': 'gehennom ', 'knox': 'knox ', 'sokoban': 'sokoban '}[m.group(1)]
        return [f'{pre}walls {i}', f'walls {i}']
    m = re.match(r'^explosion (\w+) (.+)$', name)
    if m and m.group(2) in POS: return [f'explosion {m.group(1)} {POS.index(m.group(2))}']
    m = re.match(r'^shield(\d)$', name)
    if m: return [f'magic shield {m.group(1)}']
    return [OTHER.get(name, name)] + (['gas cloud'] if name == 'poison cloud' else [])

tiles, used, missing = [], 0, collections.defaultdict(list)
state = {'cls': 'weapon', 'seen': collections.Counter(), 'done': set()}
for section in ('monsters', 'objects', 'other'):
    for name, px in parse(f'{share}/{section}.txt'):
        hit = next((c for c in candidates(section, name, state) if c in dl), None)
        if hit: used += 1; tiles.append(('dl', dl[hit], name))
        else: missing[section].append(name); tiles.append(('def', px, name))

# Same transparency rule as build_tiles.py for features drawn on the floor.
ON_FLOOR = re.compile(r'staircase|ladder|altar|grave|throne|sink|fountain|trap|^pit$|spiked pit|^hole$'
                      r'|level teleporter|magic portal|^web$|anti-magic field|squeaky board|land mine|vibrating square')
COLS = 40
img = Image.new('RGBA', (COLS * 16, ((len(tiles) + COLS - 1) // COLS) * 16))
for i, (src, px, name) in enumerate(tiles):
    clear_black = src == 'def' and ON_FLOOR.search(name)
    for y, row in enumerate(px):
        for x, c in enumerate(row):
            if c == BG or (clear_black and c == (0, 0, 0)):
                continue
            img.putpixel(((i % COLS) * 16 + x, (i // COLS) * 16 + y), c + (255,))
img.save(out, optimize=True)
print(f'{len(tiles)} tiles, {used} from DawnLike, {len(tiles) - used} default')
if report:
    with open(report, 'w') as f:
        for s, names in missing.items(): f.write(f'## {s} ({len(names)} default)\n' + '\n'.join(names) + '\n')
