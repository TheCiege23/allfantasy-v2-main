# Survivor tribe emblems — Codex handoff

> **Shipped.** The mascot sources now live in `lib/survivor/tribe-art/mascots/` (the runtime reads them).
> `compose.py` is ported to `lib/survivor/tribeEmblemComposer.ts` and served by
> `/api/survivor/tribe-emblem/{crest,mark}`; `__tests__/survivor-tribe-emblems.test.ts` checks the
> port against all 350 pre-built crests and 250 marks. Paths below that say `mascots/` refer to the
> handoff layout.

There are 50 tribes, each with an original Survivor-style name and a mascot. The crest is a sports badge whose **gear changes with the league's sport**:

- **NFL / NCAAF:** helmet, facemask, eye black, football
- **NBA / NCAAB:** headband, wristband, basketball
- **MLB:** cap, bat
- **NHL:** cage or helmet, stick, puck
- **Soccer:** captain armband, ball

College crests (NCAAF, NCAAB) add a varsity trim: dashed inner line and double banner rules.

The sheets in `sheets/` are the visual source of truth.

## What's in here

| Path | What |
|---|---|
| `tribes.json` | the 50 tribes: `id`, `name`, `mascot`, `primary`, `secondary`, `frame` (shield / roundel / hex / pennant) |
| `mascots/<id>.svg` | **Source art.** One mascot per file with 11 layers: `back-<kit>`, `body`, `front-<kit>` for kits football, basketball, baseball, hockey, soccer. Fills use colour **classes** (`p`, `pd`, `s`, `l`, `k`, …); see `MASCOT-SPEC.md`. |
| `tools/compose.py` | Reference composer: frame + sport ornament + mascot layers + name banner, which resolves the colour classes to hex. Read this to port it. |
| `crests/<sport>/<id>.svg` | Pre-built crests, 50 × 7 sports (explicit fills, banner text already outlined to paths). |
| `marks/<id>-<kit>.svg` | Round avatar marks (mascot only, no banner), 50 × 5 kits. Used for board headers, the tribe list, tribe chat and avatars. |
| `sheets/*.png` | Contact sheets for every sport plus the marks. |

> In the repo copy (`design-refs/native-league-handoff/tribes/`) only the sources and sheets are committed. The 600 pre-built `crests/` and `marks/` SVGs are in `tribe-emblems.zip`. You can also regenerate them with `python3 tools/compose.py`, which needs `fontTools` and `archivo-latin-800-normal.woff` from `@fontsource/archivo` at the `FONT` path set in the script.

## How to ship it (recommended)

1. **Port `compose.py` to a TS function:** `buildTribeCrest({ tribe, sport, colors? }): string` and `buildTribeMark({ tribe, kit, colors? })`. Run it server-side, cache the SVG string (keyed by tribe, sport and colours), and serve it with `Content-Type: image/svg+xml`.
   - The commissioner can change a tribe's colours in Tribe setup, so compose at runtime from `mascots/*.svg` rather than shipping only the pre-built files.
   - The palette derivation (`pd`, `pl`, `sd`, `sl`, field colours) is in `palette()`. Port it exactly.
   - Put the mascot sources in the repo, for example `public/tribes/mascots/` or a server-side assets folder. Parse each layer as `<g id="X">…</g><!-- /X -->`.
2. **Banner text:** the reference outlines the name with fontTools (Archivo 800). In TS, use `opentype.js` with the Archivo 800 font file to outline the name to paths, so the SVG renders the same in `<img>`, email and OG images. Auto-shrink to fit a 168px width, as the reference does.
3. **The pre-built `crests/` and `marks/` are a fallback.** Use them for seeding, tests and visual-regression baselines (snapshot your TS output against them).
4. **Data:**
   - Store the catalogue (`id`, `name`, `mascot`, default colours, frame) in a `survivor_tribe_catalog` table or a constant.
   - `survivor_tribe` (from the main handoff) gets `catalog_id`, plus optional `primary` and `secondary` overrides.
   - The tribe name stays editable. If the commissioner renames it, the banner uses the new name.
5. **Where it shows up:**
   - **Tribe setup:** a picker grid with a sport preview. See the `TribeEmblems` artboard: the grid and the selected-tribe panel.
   - **Draft room:** the team header tribe underline gets a 20px mark, and the ◆ Survivor tab tribe list uses marks.
   - **Tribe chat:** the channel icon.
   - **League home:** tribe cards.
   - **Tribe reveal announcement:** the full crest.
6. **Accessibility:** `alt="<Name> tribe crest, <mascot>"`. Decorative marks next to a visible tribe name use `alt=""`.

## Rules

- All names are **original**. None are Survivor TV-show tribe names. The mockups' old "Tika" (a real show tribe name) has been renamed **Tiki**. Run a quick trademark search on the final list before launch.
- No real team logos, marks or wordmarks are used. Keep it that way when adding tribes.
- New mascots follow `MASCOT-SPEC.md` exactly: all 11 layers and class-based colours only.
