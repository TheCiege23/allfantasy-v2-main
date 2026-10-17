# Survivor idol art spec (AllFantasy)

Hidden idols are drafted with players in Survivor fantasy leagues. Each idol type needs premium "game item" art.

## Files per idol (write in this folder)
- `<id>.svg` — hero art. `viewBox="0 0 240 300"`, transparent background. The carved object centred, filling ~80% of the height, with a soft dark contact shadow ellipse under it. Used at 96–300px on cards, DMs and the reveal.
- `<id>-icon.svg` — simplified mark, `viewBox="0 0 64 64"`, transparent. Same silhouette + key glow colour, chunkier, fewer details, must read at 20–32px.

## Style
- Premium collectible-card / game-item quality (think top mobile-game item icons): carved materials with real form — wood grain, stone texture, bone, jade, obsidian, gold inlay, woven cord, beads, feathers.
- Lighting from top-left: highlights, mid-tones, deep shadows, rim light. Use SVG gradients freely (linear/radial). Prefix every gradient/filter id with the idol id (e.g. `immunity-wood`) so files can share a page.
- Dark ink outline (#120c06 or similar) 2.5–4px on silhouettes for readability on dark UI (#07080d) and on light UI.
- Each idol has ONE magic accent glow colour (given below) used on inlays/eyes/aura — a soft outer glow (radial gradient or feGaussianBlur filter) behind the object.
- Not childish, not cartoon-cute, not gory. Original designs — no copying the TV show's idol designs or any real logo.
- No words. A carved numeral/symbol is OK where noted.
- Distinct silhouettes across the set so players can tell them apart at a glance.

## Workflow
1. Write the SVGs.
2. Render: `cd /tmp/claude-0/-home-claude/dbcd9031-77a2-54b8-ace2-0caa58575426/scratchpad/tribes && python3 render.py ../idols/review/<name>.png <cols> <cellpx> <svg files...>` (e.g. hero at 300px and icons at 64px and 32px), then Read the PNG.
3. Critique honestly and iterate at least twice. Check the icon at 32px.
4. Only write files for your own idols (`<id>.svg`, `<id>-icon.svg`, `review/<id>*.png`).
