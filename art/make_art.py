"""Mazes of Menace art: doorway app icon and firelit title wordmark (pixel art, DawnBringer-16 palette).

Usage: python3 art/make_art.py <out dir>
Writes: icon-32.png (master), icon-512.png (store), icon-192.png / favicon-32.png (web), title.png (120x70),
android/<density>/{ic_launcher.png, ic_launcher_round.png, ic_launcher_foreground.png, ic_launcher_background.png}
"""
import math, os, sys
from PIL import Image

P = dict(k='#140c1c', pu='#442434', nv='#30346d', dg='#4e4a4e', br='#854c30', st='#757161',
         or_='#d27d2c', lg='#8595a1', ye='#dad45e', wh='#deeed6')
RGB = {k: tuple(int(v[i:i + 2], 16) for i in (1, 3, 5)) + (255,) for k, v in P.items()}
CLEAR = (0, 0, 0, 0)

# ---------- icon: dungeon doorway, on a 32-cell grid (gx, gy may run outside 0..31 for the adaptive layers)
CX, TOP = 15.5, 13          # arch: semicircle centred (CX, TOP), radius 7, straight sides below
GOLD = (17, 26)

def in_opening(x, y):
    if x < 9 or x > 22:
        return False
    if y >= TOP:
        return True
    return math.hypot(x - CX, y - TOP) <= 7

def near_opening(x, y):
    return not in_opening(x, y) and any(in_opening(x + dx, y + dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1))

def wall(x, y):
    mortar = y % 4 == 3 or (x + (4 if (y // 4) % 2 else 0)) % 8 == 7
    d = math.hypot(x - 15.5, y - 15.5)
    if d < 17:
        return 'dg' if mortar else 'st'
    return 'nv' if mortar else 'dg'

PILE = {(17, 23): 'wh', (16, 24): 'ye', (17, 24): 'ye', (18, 24): 'or_',
        (15, 25): 'ye', (16, 25): 'wh', (17, 25): 'ye', (18, 25): 'ye', (19, 25): 'or_',
        **{(x, 26): ('or_' if x in (14, 20) else 'ye') for x in range(14, 21)},
        **{(x, 27): ('br' if x in (13, 21) else 'or_' if x % 2 else 'ye') for x in range(13, 22)}}
SPARK = {(20, 18): 'ye', (20, 19): 'wh', (20, 20): 'wh', (20, 21): 'wh', (20, 22): 'ye', (19, 20): 'wh', (21, 20): 'wh',
         (18, 20): 'ye', (22, 20): 'ye'}

def inside(x, y):
    """Colour of a pixel inside the arch (door, gold, glow, darkness)."""
    if (x, y) in PILE:
        return PILE[(x, y)]
    if (x, y) in SPARK:
        return SPARK[(x, y)]
    if x in (10, 11, 12) and y >= TOP:                      # open wooden door, lit edge facing the gold
        if (x, y) == (12, 21):
            return 'ye'                                       # ring pull
        if y % 5 == 0 and x < 12:
            return 'k'
        return 'or_' if x == 12 and y > 18 else 'br'
    d = math.hypot((x - GOLD[0]) * 0.8, y - GOLD[1])
    if y >= 28:
        return 'br' if d < 5 and (x + y) % 2 else 'pu'
    if d < 4:
        return 'br' if (x + y) % 2 else 'pu'
    if d < 8:
        return 'pu' if (x + y) % 2 == 0 else 'k'
    return 'k'

def rim(x, y):
    return 'wh' if (y < 8 and abs(x - CX) < 2) else 'lg'

def icon_cell(x, y, layer='full'):
    """layer: full | fg (everything but bricks) | bg (bricks only). Opening continues below the grid."""
    yy = min(y, 31) if in_opening(x, min(y, 31)) else y
    if in_opening(x, yy):
        return CLEAR if layer == 'bg' else RGB[inside(x, y if y < 32 else 31)]
    if near_opening(x, yy):
        return CLEAR if layer == 'bg' else RGB[rim(x, y)]
    return CLEAR if layer == 'fg' else RGB[wall(x, y)]

def render(w, h, cell, ox, oy, layer='full'):
    img = Image.new('RGBA', (w * cell, h * cell))
    for j in range(h):
        for i in range(w):
            c = icon_cell(i - ox, j - oy, layer)
            if c[3]:
                img.paste(c, (i * cell, j * cell, (i + 1) * cell, (j + 1) * cell))
    return img

def round_mask(img):
    w = img.size[0]
    m = Image.new('L', img.size, 0)
    r = w / 2
    for y in range(w):
        for x in range(w):
            if math.hypot(x + 0.5 - r, y + 0.5 - r) <= r:
                m.putpixel((x, y), 255)
    out = Image.new('RGBA', img.size, CLEAR)
    out.paste(img, (0, 0), m)
    return out

# ---------- title wordmark (120x70): stone MAZES / MENACE lit by a gold OF
FONT = dict(M="10001110111010110101100011000110001", A="01110100011000111111100011000110001",
            Z="11111000010001000100010001000011111", E="11111100001000011110100001000011111",
            S="01111100001000001110000010000111110", O="01110100011000110001100011000101110",
            F="11111100001000011110100001000010000", N="10001110011010110011100011000110001",
            C="01111100001000010000100001000001111")
LX, LY = 60, 38

def fire(X, Y, px, py, b, n):
    dx, dy = X - LX, Y - LY
    d = abs(dx) + abs(dy) * 0.7
    top_e, bot_e = py == 0 and not n['up'], py == b - 1 and not n['dn']
    facing = (dx < 0 and px == b - 1 and not n['rt']) or (dx > 0 and px == 0 and not n['lf']) or \
             (dy < 0 and bot_e) or (dy > 0 and top_e)
    s = 'lg' if top_e else 'dg' if bot_e else 'st'
    if facing and d < 22:
        return 'ye' if d < 13 else 'or_'
    if facing and d < 32:
        return 'or_' if (X + Y) % 2 else 'br'
    if s == 'st' and d < 18 and (X + Y) % 3 == 0:
        return 'br'
    if d < 26:
        return s
    if d < 40:
        return 'st' if s == 'lg' else (('st' if (X + Y) % 2 else 'dg') if s == 'st' else 'nv')
    return 'dg' if s in ('lg', 'st') else 'nv'

def gold(X, Y, px, py, b, n):
    if py == 0 and not n['up']:
        return 'wh' if px == 0 else 'ye'
    return 'or_' if py == b - 1 and not n['dn'] else 'ye'

def word(img, text, oy, b, col, shadow):
    w = (len(text) * 6 - 1) * b
    ox = (120 - w) // 2
    on = lambda bm, i, j: 0 <= i < 5 and 0 <= j < 7 and bm[j * 5 + i] == '1'
    for pass_ in (0, 1):
        for li, ch in enumerate(text):
            bm = FONT[ch]
            for j in range(7):
                for i in range(5):
                    if not on(bm, i, j):
                        continue
                    bx, by = ox + (li * 6 + i) * b, oy + j * b
                    if pass_ == 0:
                        for py in range(b):
                            for px in range(b):
                                img.putpixel((bx + px + 1, by + py + 1), RGB[shadow])
                        continue
                    n = dict(up=on(bm, i, j - 1), dn=on(bm, i, j + 1), lf=on(bm, i - 1, j), rt=on(bm, i + 1, j))
                    for py in range(b):
                        for px in range(b):
                            img.putpixel((bx + px, by + py), RGB[col(bx + px, by + py, px, py, b, n)])

def title():
    img = Image.new('RGBA', (120, 70), RGB['k'])
    for Y in range(70):
        for X in range(120):
            d = math.hypot((X - LX) / 1.6, Y - LY)
            if (d < 9 and (X + Y) % 2) or (9 <= d < 14 and X % 2 == 0 and Y % 2 == 0):
                img.putpixel((X, Y), RGB['pu'])
    word(img, 'MAZES', 7, 3, fire, 'pu')
    word(img, 'OF', 31, 2, gold, 'br')
    word(img, 'MENACE', 48, 3, fire, 'pu')
    return img

if __name__ == '__main__':
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    master = render(32, 32, 1, 0, 0)
    master.save(f'{out}/icon-32.png')
    master.resize((512, 512), Image.NEAREST).save(f'{out}/icon-512.png')
    master.resize((192, 192), Image.NEAREST).save(f'{out}/icon-192.png')
    master.save(f'{out}/favicon-32.png')
    title().save(f'{out}/title.png')
    # Android: legacy square + round icons, and adaptive layers on a 54-cell grid (108dp; icon at cells 11..42)
    dens = dict(mdpi=(48, 2), hdpi=(72, 3), xhdpi=(96, 4), xxhdpi=(144, 6), xxxhdpi=(192, 8))
    for name, (size, cell) in dens.items():
        d = f'{out}/android/mipmap-{name}'
        os.makedirs(d, exist_ok=True)
        sq = master.resize((size, size), Image.NEAREST)
        sq.save(f'{d}/ic_launcher.png')
        round_mask(sq).save(f'{d}/ic_launcher_round.png')
        render(54, 54, cell, 11, 11, 'fg').save(f'{d}/ic_launcher_foreground.png')
        render(54, 54, cell, 11, 11, 'bg').save(f'{d}/ic_launcher_background.png')
    print('art written to', out)
