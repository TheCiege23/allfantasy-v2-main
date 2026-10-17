# Division identity: presets and custom names (created by KB)

Any multi-division tournament (two divisions, each with conferences) can start from one of **20 contrasting division pairs**. The commissioner can also type their own names and pick images from an **unnamed image library**.

No image has text baked in. The app sets every name, so renaming never needs new art.

## The 20 preset pairs

| Pair | Pair | Pair | Pair |
|---|---|---|---|
| Rookie vs Vet | Blue vs Red | Angelic vs Demonic | Surf vs Turf |
| Black vs Gold | Fire vs Ice | Heroes vs Villains | Day vs Night |
| Earth vs Sky | Old School vs New School | Knights vs Dragons | Hunters vs Hunted |
| Order vs Chaos | Robots vs Aliens | Pirates vs Ninjas | Vikings vs Spartans |
| Jungle vs Desert | Gridiron vs Hardwood | East Coast vs West Coast | Underdogs vs Top Dogs |

Each side (40 in total) has:

- a palette (light, mid, dark and accent)
- an ink colour for text on its ribbon
- a default emblem

Everything is listed in `manifest.json`.

## Files

| Folder | What | Size | Use |
|---|---|---|---|
| `svg/medallions/<side>` | Finished division medallion: palette ring plus the default emblem | 300×300 | Preset gallery, chips |
| `svg/rings/<side>` | Blank medallion ring in the side's palette | 300×300 | Division badge with a **custom** emblem: overlay the emblem at left/top 19.3% and width 61.3% |
| `svg/frames/<side>` | Blank crest frame: empty tab and ribbon, with the "created by KB" signature | 300×340 | League crest. Overlay the emblem at left 19.3%, top 18.2%, width 61.3%. Put the division name in the tab (top 5.6%, height 7.4%) and the conference name on the ribbon (top 79%, height 10.4%) |
| `svg/library/<image>` | **50 unnamed images**, neutral silver finish: 38 division emblems, 10 conference mascots and 2 extras (`anchor`, `rocket`) | 200×200 | Picker for division emblems and conference images |
| `png/` | 2× PNGs of the medallions and library images | — | Places that can't render SVG |
| `manifest.json` | `pairs[]`, `sides{}` (names, colours, ink, file paths) and `library[]` | — | Single source for the presets |

**League names:** a league's display name is `{Conference} {Division}`, for example "Smoke Angelic" or "Riptide Sharks".

## Screens

- **`source/DivisionPresets.dc.html`:** a gallery of all 20 pairs. Selecting a pair shows both medallions and sample crests side by side.
- **`source/TournamentIdentity.dc.html`:** plan a tournament, step 2 of 4.
  1. Start from a preset, or press "Clear for custom names".
  2. **Divisions.** For each division the commissioner can:
     - type a name (up to 16 characters)
     - pick a colour from the side palettes
     - tap the emblem and choose any library image
  3. **Conferences.** Choose 2, 4, 6, 8 or 10 per division. Each conference row has an image button and a name field (up to 14 characters).
  4. **Image library grid.** It always shows which slot it is choosing for.
  5. **Live preview.** Shows both division crests for the selected conference with the typed names, the two division badges, and the "A vs B" title.

**Screens in `screens/`:**

- `TournamentIdentity.png`: the default (Rookie vs Vet with 10 conferences)
- `--angelic`: the Angelic vs Demonic preset
- `--custom`: custom names ("Sharks" vs "Minnows", conference "Riptide") with custom emblems and colour
- `DivisionPresets.png`: the preset gallery

## Build notes

- **What to store per tournament:**
  - for each division: `{ name, sideId (palette), emblem (library path) }`
  - for each conference: `{ name, image }`
- **Names:**
  - Names must be unique within the tournament.
  - Run them through the same content filter used for team names.
  - Names lock when registration opens.
- **Composing crests and badges:** in the app, as layered SVG and text. Don't bake text into images.
- **Fonts:** the KB signature uses Caveat (cursive fallback). Crest text uses Archivo 800/900.
- **Regenerating art:** run `python3 tools/gen_div.py <outdir>`. It needs `gen_kbi.py` and `gen_a.py` in the same folder.

## Update: signature

The signature on the blank crest frames (`svg/frames/`) is now drawn as vector paths, so it looks the same everywhere. To regenerate, run `tools/gen_div.py`. It needs `gen_kbi.py`, `outline.py` and `gen_a.py` in the same folder.
