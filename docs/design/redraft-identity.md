# Redraft identity — "the season race"

Foundation layer for the redraft visual upgrade (2026-10-31). Later phases restyle each tab **on top of
these tokens**; they should not add their own sport colours. Tab-by-tab ownership:
[`redraft-tab-inventory.md`](./redraft-tab-inventory.md).

## Who gets it

`lib/league-media/redraftIdentity.ts` → `resolveRedraftIdentity(league)`; `null` keeps the default look.

| rule | source |
|---|---|
| hosted on AllFantasy (imported leagues keep their provider's look) | `isNativePlatform` |
| `leagueType` is literally `redraft`; no dynasty / best ball / guillotine / keeper-phase flag; no specialty variant | `isRedraftFormatLeague` — the format half of the redraft shell's own gate, split out of `lib/league/is-nfl-redraft-core-dashboard.ts`, not a second copy |
| a `leagueVariant` naming another registered format (dynasty, keeper, best_ball, guillotine, survivor, tournament, devy, c2c, zombie, salary_cap, big_brother) is never redraft | `NON_REDRAFT_FORMATS`, a `Record` keyed on `LeagueFormatId`, so a new format fails the typecheck until placed |
| a sport the native redraft engine runs (`lib/redraft/sportAdapters/`) | `redraftSportTheme` — an unknown sport is **not** NFL, even though `normalizeToSupportedSport` falls back to NFL |
| a guillotine banner wins | `NativeLeagueWorkspace` |

Known conservative exclusion: an **IDP** redraft league (variant `idp` / `dynasty_idp`) keeps the default
look, because the shared gate excludes those variants for the redraft shell. Widening it is a one-line
decision in `isRedraftFormatLeague`'s caller, not a new rule.

## How it is applied

`NativeLeagueWorkspace` (the `/league/[id]` workspace) stamps `data-format="redraft"` and
`data-sport="<theme>"` on its root — the same attribute mechanism Dynasty (`data-dynasty-background`) and
Guillotine (`data-format=guillotine`) use. `components/league/native/redraft-identity.css` does the rest.

**`/core` (AfCoreShell) carries them too** (batch CORE-1): the page passes
`coreShellRedraftSport(selectedLeagueRow, selectedLeaguePlatform)` (`lib/core-app/coreShellRedraftIdentity.ts`,
a wrapper over `resolveRedraftIdentity` — no `?league=` → null) and the shell stamps the same two
attributes on `.af-core.af-shell`. The token blocks here match either root through
`.af-core:is(.nl-workspace,.af-shell)` (same specificity). /core-only chrome — art sizing for a page
that scrolls, the top-bar divider, the switcher frame, the nav-column rule — is in
`components/core-app/af-core-redraft.css`. DB-free harness: `/e2e/redraft-core/shell`
(`scripts/redraft-core-capture.mjs --state before|after`).

## Tokens

Defined on `.af-core.nl-workspace[data-format=redraft][data-sport=<s>]` (dark, also used by the AF theme)
and `html[data-mode='light'] …` (light). Use the `--rd-*` names in new work.

| token | use for | dark | light |
|---|---|---|---|
| `--rd-accent` | solid fills: bars, dots, filled chips, primary buttons | vivid sport colour | text-safe darker sport colour |
| `--rd-accent-text` | accent **text** and icons | = `--rd-accent` | = `--rd-accent` |
| `--rd-accent-ink` | text **on** a `--rd-accent` fill | `#06070f` | `#ffffff` |
| `--rd-accent-soft` | tinted fills: selected rows, chips, avatar wells | accent @ 16% | accent @ 10% |
| `--rd-accent-line` | borders and dividers in the sport colour | accent @ 40% | accent @ 32% |
| `--rd-glow` | the hero wash only | accent @ 8% | accent @ 6% |
| `--rd-surface-elev` | a card lifted toward the sport (`--surface` + 5% accent) | derived | derived |
| `--rd-track` | the unfilled part of a progress bar | `--line2` | `--line2` |
| `--rd-art` | the sport's background line art (`url(…)`) | `background-dark.svg` | `background-light.svg` |

/core's own names are re-pointed for the whole workspace: `--accent` → `--rd-accent-text`,
`--accent-ink`, `--accent-soft`, `--accent-line`, and `--hero`. That is why the nav's active item, the
phone bottom bar, rail tile, primary buttons, focus rings and links all follow the sport with no per-tab
edit.

### Per sport

Every pair is measured by `__tests__/league-media/redraftIdentityContrast.test.ts` from the shipped CSS.

| sport | dark | light | art | why |
|---|---|---|---|---|
| NFL | `#3ddc84` field green | `#136a3a` | yard lines, hash marks, goal frame | the approved mock |
| NBA | `#ff9a3c` hardwood orange | `#934700` | centre circle, keys, three-point arcs, floorboards | the approved mock |
| NHL | `#7cc7ff` ice blue | `#005ea5` | rink boards, blue lines, red centre line + faceoff circles (`#ff5a5f` / `#b70006`) | the approved mock |
| MLB | `#ff5a5f` stitch red | `#b70006` | diamond, infield and outfield arcs in dirt (`#d9a066` / `#815120`), dashed stitch curves | the approved mock |
| NCAAF | `#ffcf4a` goalpost gold | `#775700` | college hash marks, end-zone stripes, a goalpost | goalposts are yellow; gold separates Saturday from the NFL's green so a college and a pro football league never read as one |
| NCAAB | `#ff7ac6` bracket pink | `#b00064` | half court plus a tournament bracket | March is what makes college hoops distinct; pink keeps it clearly apart from the NBA's orange |
| Soccer | `#b5e655` pitch lime | `#48650f` | pitch markings, penalty boxes, corner arcs, mowing stripes | the striped pitch; lime is distinct from NFL green by hue and lightness |

Unknown sport → no theme → the default look.

## Light vs dark

- **Light is not dark inverted.** The vivid accents read 4.9–9.1:1 on dark grounds and 1.4–2.3:1 on
  white. Each light accent holds the hue and saturation and lowers only lightness until it clears
  **5.1:1** on `--surface`, `--surface2`, `--bg`, on its own `-soft` tint over each, and with white text
  on it. 5.1, not 4.5, on purpose: that headroom is what lets the background art exist at all.
- **AF theme** (`<html data-mode="legacy">`) uses the dark palette; the contrast test measures it on the
  AF grounds too.

## Background art

`public/artwork/redraft/<sport>/background-{dark,light}.svg` — line art only, no text, one colour per
`<g>` with an explicit `stroke-opacity` / `fill-opacity` (the contrast test reads those attributes and
refuses any other opacity form).

⚠ **The art is faint because /core's `--faint` is.** `--faint` clears only ~5.0:1 on `--bg` in dark and
~5.4:1 in light, so any ink under it spends that margin. Each file's opacity (2–8%) sits just under the
measured ceiling for **page-ground** text: `--bg` + the hero wash at full strength + every fill + one
stroke (two lines only overlap at a crossing point, smaller than a glyph stem). Raising an opacity is a
contrast regression the test reports, not a taste call.

## Header

- **Chip:** "Redraft · <season>" (filled `--rd-accent`) + the sport chip replace "Native on AllFantasy".
- **Season track** replaces the 5-step `.nl-phase` bar. `lib/league-media/redraftSeasonTrack.ts`;
  real data only, a marker without data is dropped:

| marker | source | dropped when |
|---|---|---|
| Draft ✓ / Draft · live / Draft | `RedraftSeason` exists, else lifecycle phase | never (phase is always known) |
| Week X · now | `RedraftSeason.currentWeek`, else the league row's week | draft not finished, or no valid week |
| "of N", the fill, Championship · Wk N | `RedraftSeason.totalWeeks` | no `RedraftSeason` loaded (today: every non-football league) |
| Trade deadline · Wk N | `League.tradeDeadlineWeek` | unset, or after the last week |
| Playoffs · Wk N | `RedraftSeason.playoffStartWeek`, else `readChosenPlayoffStartWeek` (**never** the sport default) | unset, or after the last week (a no-playoff season) |

Labels sit in a wrapping list under the bar, so two markers in one week never overprint.
The next lineup lock is **not** on the track: it is loaded inside `LeagueYourWeekStrip` on League home,
not on the workspace, and the track does not fetch.

## Do / don't

- **Do** use `--rd-accent-text` for accent text and `--rd-accent` for fills; put `--rd-accent-ink` on fills.
- **Do** use `--rd-accent-soft` for tints and `--rd-accent-line` for borders.
- **Don't** hardcode a sport hex in TSX or a tab stylesheet — add a token here if one is missing.
- **Don't** put text directly on `--rd-accent-soft` over an image or the art without measuring it.
- **Don't** nest a new `@media` block inside an existing one (CLAUDE.md, `af-matchup.css` 2026-08-30).
  `redraft-identity.css` keeps one top-level phone block at the end.

## Visual review

DB-free harness: `/e2e/redraft-identity` (404 in production) renders the real workspace with fixture
props. `scripts/redraft-visual-capture.mjs --base-url <local dev> --out <dir>` shoots
tab × 1440/390 × sport × light/dark(/af), refusing any frame whose `<html data-mode>`, `data-sport`,
`--accent` or /core palette does not match what the file name claims, and writes `report.json`.
No baselines are committed.
