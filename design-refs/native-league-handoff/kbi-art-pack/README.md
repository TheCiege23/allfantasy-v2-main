# Black & Gold leagues art pack (created by KB)

This pack has 50 reusable images for any Black & Gold tournament:

- **20 league crests:** one per conference in each division.
- **20 league banners:** one per conference in each division.
- **10 tournament marks.**

The structure is 2 divisions (Black, Gold) × 10 conferences × 12 teams. It is modeled on the KBI Black & Gold 2026 seed sheet, but the art carries no KBI name, so any commissioner can use it. Every image has a small "created by KB" signature.

## Files

| Folder | What | Size | Naming |
|---|---|---|---|
| `svg/crests/`, `png/crests/` | League crest (shield, mascot, "BLACK/GOLD DIVISION" tab, conference ribbon, "created by KB") | 300×340 (PNG 600×680) | `<conference>-<division>`, e.g. `smoke-black`, `smoke-gold` |
| `svg/banners/`, `png/banners/` | League banner, text-free so the UI can lay a name over it on the left | 1600×500 (PNG 3200×1000) | `<conference>-<division>` |
| `svg/marks/`, `png/marks/` | `kbi` (King Buffalo, the KB signature mark), `black-buffalo` / `gold-buffalo` (Black/Gold division marks), `region-north/east/south/west`, `conference-finals`, `wildcard-bubble`, `championship` (Black v Gold). File names keep the old ids; on-image text no longer says KBI | 300×340, 300×300, 600×340 | as listed |

The conferences are BEAST, GOAT, GRIZZ, KINGS, REBELS, SMOKE, STEALTH, SWAMP, THUNDER and WARRIOR.

**Division look:**
- Black division: steel and silver metal on a black shield, with a dark ribbon.
- Gold division: gold metal on a gold shield, with a gold ribbon.

**Conference accent colours** (used for eye glow, details and the banner glow):

| Conference | Accent |
|---|---|
| Beast | #e5432f |
| Goat | #9b6bff |
| Grizz | #e08a3c |
| Kings | #3d7dff |
| Rebels | #e0334f |
| Smoke | #7fd6d0 |
| Stealth | #b06bff |
| Swamp | #4fcf6a |
| Thunder | #ffd23f |
| Warrior | #ff7a2f |

## Notes for Codex

- Every SVG has unique, prefixed ids (`kbi-<file>-…`), so they're safe to inline together on one page.
- **Text inside the SVGs** (ribbons, tabs, seals) is set in Archivo Black with an Arial Black fallback. The "created by KB" signature uses Caveat with a cursive fallback:
  - The PNGs were rendered with Archivo.
  - If you use the SVGs through `<img>` without the font loaded, the text falls back to Arial Black.
  - If that matters, use the PNGs.
- **Image lookup:** `imageFor(conference, division)` = `crests/${conf.toLowerCase()}-${div.toLowerCase()}.svg`.
- **Regenerating:** `python3 tools/gen_kbi.py <outdir>` (needs `gen_a.py` next to it).
- **Preview board:** `KbiArtPack.dc.html` lets you switch division and conference, and shows each league with its top 3 from the KBI 2026 sample sheet.
- **Smoke:** the Smoke crest and banner use SVG filters (`feTurbulence` + `feDisplacementMap` + blur) for a soft, real smoke look. All modern browsers render it; use the PNGs where filters aren't supported (some email clients, older native SVG renderers).


## Update: signature

The "created by KB" signature is now drawn as vector paths, not live text. It looks the same everywhere, even where the Caveat font isn't installed. To regenerate, run `tools/gen_kbi.py`. It uses `tools/outline.py` and needs the Caveat woff file; set `AF_FONTS` to its folder.
