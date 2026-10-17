# Scoring and roster labels

Every scoring option and every roster option has a label image, for both NFL and NBA. These replace the "Half PPR" and "16 slots · 9 start" placeholders in the tournament planner. They work for any league type, not only tournaments.

**Defaults:**
- NFL: Half PPR scoring with the Standard roster.
- NBA: Points scoring with the Standard roster.

The rules are the same in every league and every stage of a tournament, and they lock when registration opens.

## Scoring options (12)

| Id | Plate | Sport | Name | In one line | Best for |
|---|---|---|---|---|---|
| `std` | STD | NFL | Standard | No points for catches | Classic leagues, run-first value |
| `half` | HALF | NFL | Half PPR | 0.5 per catch | The balanced default |
| `ppr` | PPR | NFL | Full PPR | 1 per catch | Pass-catchers rise |
| `te` | TE+ | NFL | TE Premium | PPR + 0.5 per TE catch | Makes tight ends matter |
| `six` | 6PT | NFL | 6-pt passing TD | Half PPR, pass TD = 6 | Quarterbacks score like everyone else |
| `fd` | 1ST | NFL | First downs | Half PPR + 0.5 per first down | Rewards volume, not just TDs |
| `bonus` | BONUS | NFL | Big-play bonus | Half PPR + yardage bonuses | Boom weeks pay extra |
| `pts` | PTS | NBA | Points | Every stat is worth points | Simple weekly totals |
| `ptsb` | PTS+ | NBA | Points + bonuses | Points + double-double and triple-double | Stat-sheet stuffers |
| `cat9` | 9CAT | NBA | 9-category | Win categories, not points | Balanced builds |
| `cat8` | 8CAT | NBA | 8-category | 9-cat without turnovers | Lets you play high-usage stars |
| `custom` | CUSTOM | NFL · NBA | Custom | Commissioner sets every value | Unique house rules |

**Categories:**
- 9CAT: FG%, FT%, 3PM, PTS, REB, AST, STL, BLK, TO.
- 8CAT: the same, without TO.

**Custom** starts from Half PPR (NFL) or Points (NBA), and the commissioner can edit any value. Its label always reads CUSTOM.

### NFL point values

| Stat | STD | HALF | PPR | TE+ | 6PT | 1ST | BONUS |
|---|---|---|---|---|---|---|---|
| Passing yard | +0.04 | +0.04 | +0.04 | +0.04 | +0.04 | +0.04 | +0.04 |
| Passing TD | +4 | +4 | +4 | +4 | +6 | +4 | +4 |
| Interception | -2 | -2 | -2 | -2 | -2 | -2 | -2 |
| Rushing yard | +0.1 | +0.1 | +0.1 | +0.1 | +0.1 | +0.1 | +0.1 |
| Rushing TD | +6 | +6 | +6 | +6 | +6 | +6 | +6 |
| Reception | — | +0.5 | +1 | +1 | +0.5 | +0.5 | +0.5 |
| Receiving yard | +0.1 | +0.1 | +0.1 | +0.1 | +0.1 | +0.1 | +0.1 |
| Receiving TD | +6 | +6 | +6 | +6 | +6 | +6 | +6 |
| Fumble lost | -2 | -2 | -2 | -2 | -2 | -2 | -2 |
| 2-pt conversion | +2 | +2 | +2 | +2 | +2 | +2 | +2 |
| TE reception bonus | — | — | — | +0.5 | — | — | — |
| Rush/rec first down | — | — | — | — | — | +0.5 | — |
| 100+ rush or rec yards | — | — | — | — | — | — | +3 |
| 300+ passing yards | — | — | — | — | — | — | +3 |
| 40+ yard TD | — | — | — | — | — | — | +2 |

K and DST use the AF standard tables in every NFL preset. Yard values are per yard: 0.04 means 1 point per 25 passing yards, and 0.1 means 1 point per 10 yards.

### NBA point values

| Stat | PTS | PTS+ |
|---|---|---|
| Point | +1 | +1 |
| Rebound | +1.2 | +1.2 |
| Assist | +1.5 | +1.5 |
| Steal | +3 | +3 |
| Block | +3 | +3 |
| Turnover | -1 | -1 |
| 3-pointer made | +0.5 | +0.5 |
| Double-double | — | +1.5 |
| Triple-double | — | +3 |

## Roster options (9)

| Id | Sport | Name | Starters | Start | Bench | IR/IL | Best for |
|---|---|---|---|---|---|---|---|
| `nfl-std` | NFL | Standard | QB · RB · RB · WR · WR · TE · FLEX · K · DST | 9 | 7 | 1 | Most leagues |
| `nfl-sf` | NFL | Superflex | QB · RB · RB · WR · WR · TE · FLEX · SFLEX · K · DST | 10 | 7 | 1 | Quarterbacks get valuable |
| `nfl-2qb` | NFL | 2QB | QB · QB · RB · RB · WR · WR · TE · FLEX · K · DST | 10 | 7 | 1 | Deep quarterback strategy |
| `nfl-3wr` | NFL | 3WR | QB · RB · RB · WR · WR · WR · TE · FLEX · K · DST | 10 | 7 | 1 | Pairs well with PPR |
| `nfl-skill` | NFL | Skill only | QB · RB · RB · WR · WR · WR · TE · FLEX · FLEX | 9 | 6 | 1 | No kickers or defenses |
| `nfl-idp` | NFL | IDP | QB · RB · RB · WR · WR · TE · FLEX · K · DST · DL · LB · DB · IDP | 13 | 8 | 1 | Defensive players too |
| `nba-std` | NBA | Standard | PG · SG · SF · PF · C · G · F · UTIL · UTIL · UTIL | 10 | 3 | 1 | Most leagues |
| `nba-small` | NBA | Lean | PG · SG · SF · PF · C · UTIL · UTIL | 7 | 3 | 1 | Fast drafts, bigger stars |
| `nba-deep` | NBA | Deep | PG · SG · SF · PF · C · G · F · UTIL · UTIL · UTIL | 10 | 6 | 2 | Bench depth matters |

## Files

| Path | What it is | Size |
|---|---|---|
| `svg/scoring/<id>.svg` | Scoring plate: family colour, glyph, code and sport · name | 280×112 |
| `svg/roster/<id>.svg` | Roster strip: sport · name, start and slot count, a coloured chip for every starter, then BN ×n and IR/IL ×n | Width varies, 136 tall |
| `svg/positions/<pos>.svg` | 23 position chips, NFL and NBA | 64×64 |
| `png/...` | Every SVG at 2× | — |
| `rules.json` | The full catalog: every scoring value, every roster slot, position colours and the defaults per sport | — |
| `tools/gen_rules.py` | Regenerates everything: `python3 tools/gen_rules.py <outdir>` (needs the Archivo woff files; set `AF_FONTS`) | — |

All text in the label art is converted to vector paths, so the images look the same everywhere without needing the fonts.

## Screens

- **`source/ScoringRoster.dc.html`:** plan a tournament, step 3. It has:
  - a sport toggle
  - a grid of scoring plates with a detail panel: the value table, the category chips, or editable inputs for Custom
  - roster rows built from the position chips
  - a "Your tournament label" panel that shows how the label appears on the hub chips, the invite page and the draft room
- **`source/RulesLabels.dc.html`:** a gallery of every plate, the small pills, every roster strip and the position colour key.
- **`screens/`:** ScoringRoster (NFL default), `--nba-9cat`, `--custom` (Custom with Superflex), and RulesLabels.
- **`TournamentCreate`** (in `../specialty-leagues/tournament`) now shows the Half PPR plate and the Standard roster chips, each with a "Change" button that opens this step.

## Build notes

- **Rendering in the app:**
  - Use the position colours from `rules.json` (`positions`) everywhere: draft room, lineups, waivers and labels.
  - For small spaces (chips, tables, league cards), draw the small pill in code: the family gradient from `scoring[].colors` plus the code. Use the plate SVG only where there's room for it.
- **Storage:** save the tournament's choice as `{ scoringId, rosterId, overrides? }`. Overrides are allowed only when `scoringId` is `custom`. Lock both when registration opens.
- **Text label:** the plain text is `<scoring name> · <roster name> roster`, for example "Half PPR · Standard roster".
