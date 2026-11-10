"""Build a tilesheet PNG from NetHack win/share/*.txt (order: monsters, objects, other = glyph_to_tile order).

Works for 3.6.7 (1082 tiles) and 5.0 (1515 tiles).
Usage: python3 tools/build_tiles.py <NetHack>/win/share out.png
"""
import re, sys
from PIL import Image
src, out = sys.argv[1], sys.argv[2]

# Dungeon features and traps are drawn on solid black in the default set; make that black
# transparent so the app's floor shows through. Chosen by tile name so it holds across versions.
ON_FLOOR = re.compile(r'staircase|ladder|altar|grave|throne|sink|fountain|trap|^pit$|spiked pit|^hole$'
                      r'|level teleporter|magic portal|^web$|anti-magic field|squeaky board|land mine|vibrating square')

tiles = []
for name in ('monsters.txt', 'objects.txt', 'other.txt'):
    text = open(f'{src}/{name}').read()
    pal = {}
    for k, r, g, b in re.findall(r'^(\S) = \((\d+),\s*(\d+),\s*(\d+)\)', text, re.M):
        pal[k] = (int(r), int(g), int(b), 255)
    pal['.'] = (0, 0, 0, 0)  # background -> transparent
    # Line-based: 5.0 puts comment lines ("#_ ...") between some headers and their pixel block.
    tname, rows = None, None
    for line in text.splitlines():
        s = line.strip()
        m = re.match(r'# tile \d+ \((.*)\)$', s)
        if m:
            tname = m.group(1)
        elif s == '{' and tname is not None:
            rows = []
        elif s == '}' and rows is not None:
            p2 = dict(pal)
            if name == 'other.txt' and ON_FLOOR.search(tname):
                p2['A'] = (0, 0, 0, 0)
            if len(rows) != 16 or any(len(r) != 16 for r in rows):
                sys.exit(f'{name}: tile "{tname}" is not 16x16')
            tiles.append([[p2[c] for c in row] for row in rows])
            tname, rows = None, None
        elif rows is not None and s:
            rows.append(s)
COLS = 40
n = len(tiles)
img = Image.new('RGBA', (COLS * 16, ((n + COLS - 1) // COLS) * 16))
for i, t in enumerate(tiles):
    for y, row in enumerate(t):
        for x, px in enumerate(row):
            img.putpixel(((i % COLS) * 16 + x, (i // COLS) * 16 + y), px)
img.save(out, optimize=True)
print(n, 'tiles', img.size)
