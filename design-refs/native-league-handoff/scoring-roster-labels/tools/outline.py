"""Turn text into SVG paths so label art never depends on installed fonts."""
import os
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

FD = os.environ.get('AF_FONTS', os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'fonts'))
FILES = {'archivo-900': 'fontsource-archivo/files/archivo-latin-900-normal.woff', 'archivo-800': 'fontsource-archivo/files/archivo-latin-800-normal.woff',
         'archivo-700': 'fontsource-archivo/files/archivo-latin-700-normal.woff', 'caveat-700': 'fontsource-caveat/files/caveat-latin-700-normal.woff'}
_cache = {}

def _font(name):
    if name not in _cache:
        f = TTFont(os.path.join(FD, FILES[name]))
        _cache[name] = (f, f.getGlyphSet(), f.getBestCmap(), f['head'].unitsPerEm, f['hmtx'])
    return _cache[name]

def width(text, name, size, spacing=0):
    f, gs, cmap, upm, hm = _font(name)
    w = sum(hm[cmap.get(ord(ch), '.notdef')][0] for ch in text) * size / upm
    return w + spacing * max(0, len(text) - 1)

def text(t, x, y, name, size, fill, anchor='start', spacing=0, opacity=1):
    f, gs, cmap, upm, hm = _font(name)
    w = width(t, name, size, spacing)
    x0 = x - (w if anchor == 'end' else w / 2 if anchor == 'middle' else 0)
    s = size / upm
    pen = SVGPathPen(gs); cx = x0
    for ch in t:
        g = cmap.get(ord(ch), '.notdef')
        gs[g].draw(TransformPen(pen, (s, 0, 0, -s, cx, y)))
        cx += hm[g][0] * s + spacing
    op = f' opacity="{opacity}"' if opacity != 1 else ''
    return f'<path d="{pen.getCommands()}" fill="{fill}"{op}/>'
