# Tournament formats: the commissioner picks one

At step 1 of **Plan a tournament**, the commissioner chooses between two formats. Both use the division identity system: preset or custom names, colours and crests (see `../division-identity`).

## Format 1: Points race (already designed)

Screens are in `../specialty-leagues/tournament/`: hub, cut day, redraft, bracket, planner and stage control.

1. Everyone is in one global points race across 8-team leagues.
2. The top half advances at each cut: 64 → 32 → 16.
3. Advancers redraft into new leagues and scores reset.
4. A cross-league bracket decides the champion.

**Field sizes:** 64, 96, 128, 160 or 192 entrants.

## Format 2: Divisions & conferences (new, modelled on the KBI Black & Gold sheet)

1. **Divisions.** There are two named divisions (A vs B). Each has N conference leagues of 8–14 teams; the default is 10 × 12, so 120 teams per division and 240 in total.
2. **Drafts.** Each league drafts once. There are no redrafts, and rosters carry into the bracket.
3. **Regular season.** Weeks 1–10 by default. Every team in a division is ranked by **wins, then points**.
4. **Automatic bids.** Ranks 1–52 take seeds 1–13, four per seed line.
5. **Wildcard pool.** Ranks 53–64 plus the 12 highest scorers from ranks 65–120, re-ranked by **points only**. The top 12 take seeds 14–16.
6. **Brackets.** The 64 teams in each division form 4 regions of 16 (North, East, South, West). Seed lines snake across the regions:
   - Odd seed lines go N, E, S, W.
   - Even seed lines go W, S, E, N.
7. **Weekly schedule:**

| Week | Round |
|---|---|
| 11 | Round of 64 |
| 12 | Round of 32 |
| 13 | Sweet 16 |
| 14 | Region finals |
| 15 | Division final four |
| 16 | Division final |
| 17 | **Championship:** Division A champion vs Division B champion |

8. **Conference points.** Each conference's total points is shown for bragging rights. It doesn't affect seeding.

**Commissioner settings** (`TournamentFormat`):

| Setting | Options |
|---|---|
| Sport | NFL, NBA |
| Conferences per division | 4–10 |
| Teams per conference | 8–14 |
| Automatic bids | 24–56 |
| Wildcard spots | 4–16 |
| Regions | 4 |
| Championship week | Season length − 1 (fixed) |
| Tiebreakers | Seed › record › best week › commissioner |

Automatic bids plus wildcard spots must equal a bracket size of 32, 64 or 128 per division. The screen warns the commissioner when they don't.

## Screens

| File | What | States in `screens/` |
|---|---|---|
| `TournamentFormat` | Pick between the two formats: flow diagram, rules, best-for line, settings and a live summary | Divisions selected (default), Points race selected |
| `DivisionStandings` | Hub with the league crest. Division toggle; views: Around the lines (automatic-bid line at 52, bubble line at 64), Top 16, My conference, Conferences (crest grid with conference points and teams in). Right rail: your wildcard status and how seeding works | Default, Conferences |
| `DivisionWildcard` | The 24-team pool ranked by points, showing how each team got in (bubble or top scorer), the line at 12, and the gap to the line | Default |
| `DivisionBracket` | Division and region switch. 16-team region bracket with conference icons, plus the road to the title | Angelic North (default, your path), Demonic East |
| `DivisionChampionship` | The cross-division final: both champions' crests in their division colours, live scores, trophy, division pride stats | Default |
| `MobileDivision` | Phone: league crest, your rank and wildcard status, the wildcard line | Default |

The sample data is generated (seeded and repeatable) with the Angelic vs Demonic preset. You are #58, in the wildcard pool at #4 of 24.

## Decided rules

- **Tiebreakers:**
  1. Higher seed.
  2. Better record.
  3. Best single week.
  4. Commissioner review.

  Seeds don't exist until the bracket. In the standings and the wildcard pool, ties go to record, then best single week. In bracket games the higher seed advances.
- **Calendar.** The championship is one week before the season ends: NFL week 17. The bracket fills the 7 weeks before that.
- **No buffer weeks in this format.** Each league drafts once and rosters carry into the bracket. The 1-week buffer applies only to points-race redrafts.
- **Spelling.** King Buffalo.
- **Commissioner control.** Seeding lock, tie review and round advancement are in `../tournament-extras` (`DivisionControl`).
