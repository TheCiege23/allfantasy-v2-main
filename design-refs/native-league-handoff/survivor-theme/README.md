# Survivor league theme and idol art: Codex handoff

This package has two pieces for Survivor leagues: **island backgrounds** behind the league header, and **20 idol types** with art and a commissioner selection system. The screenshots in `screens/` are the visual source of truth. The `.dc.html` files in `source/` are design mockups: read them for layout and copy, but don't ship them. The SVGs in `backgrounds/` and `idols/` are production assets you can ship as-is (e.g. `public/survivor/`).

## 1. Island backgrounds (`backgrounds/<mood>-<sport>.svg`)

There are 20 scenes at 1600×600: 4 moods × 5 sport kits.

- **Moods:**
  - `day`: draft and regular weeks
  - `dusk`: the vote-deadline day
  - `night`: Tribal Council, with tiki torches and a council fire
  - `exile`: storm, rain and lightning, for Exile Island screens
- **Sport kits** (NFL/NCAAF use `football`, NBA/NCAAB use `basketball`):
  - `football`: bamboo goalposts and yard lines raked into the sand
  - `basketball`: a hoop nailed to a palm
  - `baseball`: sandbag bases and a bamboo backstop
  - `hockey`: a driftwood net and sticks
  - `soccer`: a driftwood goal with fishing net

**Choosing the mood.** Pick it automatically from league state; don't make it a user setting:

| League state | Mood |
|---|---|
| `voteDeadlineAt` is today and still in the future | dusk |
| Between `revealStartsAt` and the end of the reveal | night |
| Any Exile Island screen | exile |
| Everything else | day |

**Layout rules (important for readability):**

- The scene sits **only behind the league header**: 420px tall on desktop, 330px on phone. Use `object-fit: cover`, with `object-position: 62% 60%` on desktop and `66% 60%` on phone so the sport prop stays in frame.
- Put two overlays on top of the scene:
  - a vertical gradient that fades into the page colour at the bottom
  - a left-to-right dark gradient behind the title text
  - Copy them from `SurvivorTheme.dc.html`.
- Content cards overlap the bottom of the header by about 64px. They are **solid** (92% opaque, light blur), so stats never sit directly on the artwork.
- **Light mode:** same scenes, with the page colour `#f3eee3` and cream cards. The header text stays white over the dark-left gradient. In light mode, gold accent text darkens to `#946a0c`.
- `prefers-reduced-motion`: no parallax. If you add parallax later, keep it under 20px.
- Cross-fade when the mood changes (opacity, 0.5s).

`tools/gen_bg.py` regenerates every scene, so you can tweak palettes or composition in one place.

## 2. Idols: 20 types, art and selection (`idols/`)

`idols/catalog.json` is the source of truth for every idol type. Each entry has:

- `id`, `name`, `glow` (accent colour)
- `cat`: Protection, Votes, Scoring, Roster, Game or Bluff
- `tier`: power level 1–3
- `always`: true if the idol is in every league
- `short`, `power`, `when`, `target`: card copy

Seed it into an `idol_type` table so new idols can be added as rows, not code. Each type has hero art `idols/<id>.svg` (240×300) and an icon `idols/<id>-icon.svg` (64×64, readable at 20px).

| Group | Idols |
|---|---|
| Protection (always in) | **Immunity idol**, **Tribe immunity** |
| Votes | Vote steal, Extra vote, Idol nullifier, Silence, Spyglass, Revote |
| Scoring | Point surge, Lineup lock, Captain's mark, Safety net, Injury shield, Bye cover, Tribute |
| Roster | Steal 3, First claim |
| Game | Second chance, Defector |
| Bluff | Decoy |

### Selection system (commissioner screen: `IdolSetup`)

- **Count:** 6, 7 or 8 idols per league (`survivorIdolCount`, default 7). **Immunity and Tribe immunity are always included and can't be removed.** The remaining 4 to 6 come from the other 18 types.
- **Mode, `random`** (default): a *balanced* draw on the server at draft lock, using a secure RNG. Constraints:
  - at most one tier-3 idol among the random picks
  - at most two from the same group
  - at least one Votes idol, and at least one Scoring or Roster idol
  - The setup screen shows a preview draw with Re-roll, but the real draw happens at lock.
- **"Hide the draw from me too":** for commissioners who are also playing. Their setup screen then shows sealed "?" cards, and the drawn types are revealed to everyone only as idols are played.
- **Mode, `pick`:** the commissioner picks exactly `count − 2` types. Category filter chips are shown; "Lock" is disabled until the count is exact.
- **What the commissioner never sees:** which *players* hide the idols. Those are always assigned randomly to likely-drafted players and sealed, as described in the main handoff.
- **Settings lock** when the draft starts.

**Suggested storage:**

- `survivor_idol_config { league_id, mode: random|pick, count, hide_from_commish, picked_type_ids[] }`
- The resolved types for the league are stored with the sealed idol assignments.

### Art and play rules

- **Where the art goes:**
  - **Hero art:** idol cards, the AF Host DM, the "Play idol" sheet and the post-draft reveal.
  - **Icons:** the draft room's Survivor tab, roster rows, chat and the scroll stamp.
- **Idol cards:** a radial glow in the idol's colour behind the art. Titles use Cinzel 700 in the glow colour. The tag shows `Category · ●●○`, or "Always in".
- **Play flow** (`IdolVault`):
  1. The manager taps Play.
  2. They choose a target if the idol needs one.
  3. They confirm.
  4. The idol is "Played in secret", and is revealed during the Tribal Council read-out. Owner-only visibility and secrecy rules are in the main handoff.
- **Values for the commissioner to set:** Point surge size and the Tribute percentage are league settings. The defaults are +15% and 10%.

## Screens

| PNG | Shows |
|---|---|
| `SurvivorTheme.png` | Desktop league home: dusk, NFL |
| `SurvivorTheme--day-mlb.png` | Day, MLB |
| `SurvivorTheme--night-soccer.png` | Tribal night, soccer |
| `SurvivorTheme--exile-nhl.png` | Exile storm, NHL |
| `SurvivorTheme--light-day-nba.png` | Light mode, day, NBA |
| `IdolVault.png` | Idol vault, all 20 idols |
| `IdolSetup.png` / `--pick.png` / `--sealed.png` | Commissioner idol setup: random draw, picking, and the draw hidden from the commissioner |
| `MobileSurvivorHome.png` / `--night.png` | Phone league home |

All art is original. It uses no show logos or real team marks.
