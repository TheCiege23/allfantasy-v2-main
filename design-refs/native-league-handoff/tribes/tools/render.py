#!/usr/bin/env python3
"""Render a contact sheet of SVG files to PNG.
Usage: render.py out.png cols cell_px file1.svg file2.svg ...
   or: render.py --mascot <id> out.png   (7 sport crests + 5 kit marks for one mascot, after compose.py <id>)
"""
import sys, os, asyncio, html
from playwright.async_api import async_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SPORTS = ['nfl', 'ncaaf', 'nba', 'ncaab', 'mlb', 'nhl', 'soccer']
KITS = ['football', 'basketball', 'baseball', 'hockey', 'soccer']

async def shoot(out, cols, cell, files):
    cells = ''.join(f'<figure><div style="height:{cell}px;display:flex;align-items:center;justify-content:center">{open(f).read()}</div>'
                    f'<figcaption>{html.escape(os.path.relpath(f, HERE))}</figcaption></figure>' for f in files)
    page_html = f'''<!doctype html><html><body style="margin:0;background:#07080d;color:#a3a9c2;font:12px monospace">
<style>figure{{margin:0;padding:10px}} svg{{max-width:{cell}px;max-height:{cell}px;width:100%;height:100%}}
.g{{display:grid;grid-template-columns:repeat({cols},{cell + 20}px)}} figcaption{{text-align:center;margin-top:4px}}</style>
<div class="g">{cells}</div></body></html>'''
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={'width': cols * (cell + 20), 'height': 400})
        await pg.set_content(page_html)
        await pg.screenshot(path=out, full_page=True)
        await b.close()

if __name__ == '__main__':
    a = sys.argv[1:]
    if a[0] == '--mascot':
        mid, out = a[1], a[2]
        files = [os.path.join(HERE, 'build', s, f'{mid}.svg') for s in SPORTS] + \
                [os.path.join(HERE, 'build', 'marks', f'{mid}-{k}.svg') for k in KITS]
        asyncio.run(shoot(out, 6, 260, files))
    else:
        asyncio.run(shoot(a[0], int(a[1]), int(a[2]), a[3:]))
    print('wrote', out if a[0] == '--mascot' else a[0])
