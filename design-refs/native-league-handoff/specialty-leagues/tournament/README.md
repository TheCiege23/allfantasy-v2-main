# Tournament

**Rules source:** `docs/TOURNAMENT_LEAGUES_BUILDOUT.md` (2026-10-12), the confirmed format. The older Black vs Gold docs (`PROMPT1_TOURNAMENT_MODE_ARCHITECTURE_PLAN.md`, `TOURNAMENT_MODE_QA_AND_DELIVERY.md`) are only used for division names and the stage-2 draft order.

**Theme:** `--acc #e8b84a`, `--acc2 #ffd98a`, `--accInk #1a1204`. The display font is Archivo 800/900.

## How the format works

The screens show a 64-entrant NFL tournament.

1. **Stage 1, weeks 1–6:** 8 separate draft leagues of 8. Everyone is in one global points race.
2. **Cut 1:** the top 32 by total stage points advance. Pools don't reserve spots.
3. **Stage 2, weeks 7–13:**
   - Advancers are reseeded by points.
   - They're placed into 4 leagues of 8 in a snake: seeds 1–4, then 4–1, and so on.
   - Everyone redrafts and scores reset to zero.
   - The old seed is kept only to break ties.
4. **Cut 2:** the top 16 advance. They redraft into 2 final leagues.
5. **Bracket, weeks 14–17:**
   - One cross-league head-to-head matchup each week, and every matchup uses the same scoring week.
   - Each final league has its own player pool, so both opponents can roster the same player.
   - After the final draft, nobody redrafts again. An eliminated manager's roster locks.

Other rules:

- Trading is off.
- Rosters aren't released between stages.
- Division names, such as Black and Gold, are cosmetic only.

The bracket size depends on the field size:

| Field | Opening leagues | Stage 2 | Finalists | Bracket weeks | Byes |
|---|---|---|---|---|---|
| 64 | 8 | 32 / 4 | 16 / 2 | 4 | 0 |
| 96 | 12 | 48 / 6 | 24 / 3 | 5 | 8 |
| 128 | 16 | 64 / 8 | 32 / 4 | 5 | 0 |
| 160 | 20 | 80 / 10 | 40 / 5 | 6 | 24 |
| 192 | 24 | 96 / 12 | 48 / 6 | 6 | 16 |

`TournamentCreate` derives these values live:

- Bracket weeks = ceil(log2(finalists)).
- Byes = 2^weeks − finalists.
- The bracket always ends one week before the season does: NFL week 17 (18-week season), NBA period 24 (example 25-period season).

## Screens

| Screen | What it shows | States in `screens/` |
|---|---|---|
| `TournamentHub` | Stage strip; global standings with the cut line and bubble tags; your cushion and chance to advance; how advancing works; tournament feed | Around the cut (default), My league |
| `TournamentCutDay` | The mass-cut reveal with staggered rows, cut line, tie-at-the-line card and your result card | Pending, revealed (advanced), revealed (eliminated) |
| `TournamentRedraft` | 32 advancers dealt into 4 pools by snake seeding; your new league; stage 2 rules | Before deal, dealt |
| `TournamentBracket` | 16-seed cross-league bracket with absolute-positioned cards and connectors; live QF; your matchup detail; same-player note | Full bracket, My path |
| `TournamentCreate` | Commissioner planner: sport, field size, live funnel, frozen rules, calendar preview, reviewers. Saves a blueprint only | 64 NFL, 160 NBA |
| `TournamentControl` | Guarded stage transition: scores final, corrections closed, resolve tie, preview, commit; setup jobs with retry; audit log | Before, committed |
| `MobileTournament` | Phone hub: rank, cushion, stage bar, around-the-line list | — |
| `MobileTournamentCut` | Phone cut result | Advanced, eliminated |

## Assets

`emblem.svg`, `banner.svg`, `icon-advance`, `icon-out`, `icon-cut`, `icon-bracket`, `icon-redraft`, `icon-seed`, `icon-cup` and `icon-bye`. To regenerate them, run `python3 tools/gen_d.py <outdir>`.

## Build notes

- **Calculated on the backend only:** the cut line, seeds, tiebreaks and bracket placement. The UI only displays them, and AI copy only explains them.
- **Missing scores:** a missing score is not the same as a zero. Don't show the "Commit cut" button while any required score is missing or provisional.
- **Tiebreak reasons:** show the reason on the row (`In · tiebreak` / `Out · tiebreak`) and log every use.
- **Blueprint plans:** while a plan is still a blueprint, block league building, invites and launch, as the setup endpoint already does.

## Decided rules (from the commissioner, Oct 2026)

1. **Tiebreakers**, applied in order at the cut line and in bracket games. Every use is logged.
   1. Higher seed.
   2. Better record.
   3. Higher single-week score.
   4. Commissioner review.

   Stage 1 has no seeds yet, so at cut 1 the order starts at record. In a tied bracket game the higher seed advances.
2. **Redraft order.** The default is by seed: the best seed picks first in every redraft. The commissioner can switch to **Random** (shuffled when the buffer week starts, and logged) or **Set manually** (drag into order before the draft locks).
3. **Calendar.** The tournament ends one week before the sport's season ends. The last week is season length − 1: NFL 18 weeks gives week 17. NBA length comes from the calendar adapter (the example uses 25 periods, ending in period 24).
4. **Buffer week between rounds.** Each redraft gets one full week with no tournament scoring. During it:
   1. Load the new leagues by seed.
   2. Set the draft date and time (the commissioner picks it).
   3. Run the draft.
   4. Post the next week's matchups.

   The NFL 64 example works out to:

| Weeks | What happens |
|---|---|
| 1–6 | Stage 1 |
| 7 | Cut 1 and buffer week: stage 2 redraft |
| 8–12 | Stage 2 |
| 13 | Cut 2 and buffer week: final redraft |
| 14–17 | Bracket (16 teams, 4 rounds) |

   General formula, used by `TournamentCreate`:
   - end = season − 1
   - bracket weeks = ceil(log2(finalists))
   - available = end − bracket weeks − 2
   - stage 1 = ceil(available / 2) weeks, then buffer 1, then stage 2 up to (end − bracket weeks − 1), then buffer 2, then the bracket
5. **Spelling.** King Buffalo (not "Bufflo").
6. **Scoring and roster:** the planner now shows real labels. Every option (12 scoring, 9 rosters) is in `../../scoring-roster-labels`.

### What changed on screen

- **`TournamentCreate`:**
  - new tiebreaker chips
  - Redraft order control (By seed / Random / Set manually)
  - "Buffer between rounds · 1 week · locked"
  - "Draft date and time · set per round"
  - the calendar is calculated from season length
- **`TournamentCutDay`:** the tie at #32 is now decided on record (4–2 vs 3–3).
- **`TournamentRedraft`:** draft order is by seed, and the draft falls in buffer week 7.
- **`TournamentControl`:** the tie table shows seed, record and best week, and drafts are scheduled within the buffer week.
- **`TournamentHub` and `MobileTournamentCut`:** copy updated to match.

## Update: league names and crests

The points race now uses the division identity system from `../division-identity`. The example uses the Rookie vs Vet preset.

- **Stage 1 leagues** are named and have crests: Beast, Goat, Grizz and Kings are in the Rookie division; Rebels, Smoke, Stealth and Swamp are in Vet. You're in **Grizz Rookie**. Divisions are cosmetic in this format and don't reserve advancement spots.
- **Stage 2 leagues:** Thunder, Warrior, Inferno and Glacier. You're in Inferno.
- **Final leagues:** Summit and Eclipse. Each drafts from its own player pool.
- **Where the crests appear:** in the standings, cut day, redraft columns and bracket matchups (small conference icon), and as a "Your stage 1 league" crest card on the hub.
