# Core pages visual upgrade — gap analysis (2026-09-07)

Source: `corepages.zip` → `design_handoff_core_pages/` (15 `.dc.html` files + screenshots).

Run before building, per the standing rule: *every page that changes visually gets a gap
analysis first; less functionality is acceptable, unwired functionality is not.*

## What the batch actually targets

Every `core/*` route already has a full **per-league** screen. What the designs replace is the
**no-league-selected** state, which today is `PickALeague` (a "Needs you first" queue + a grid of
every league). The one exception is Career, whose Seasons / Hall of Fame / Records tabs render a
literal "not built yet" panel.

So this is not a rebuild of the per-league screens. It is: *build the cross-league board that each
route lacks, and restyle the ones that already have one.*

## Per-screen: data backing, and what is kept vs dropped

| Screen | Backing data | Verdict |
|---|---|---|
| My Team | `getMyTeamPulse` — severity, lock time, empty/out/questionable, starters, league art | **Full build.** Every field the design asks for exists. |
| Matchup | `getMatchupPulse` — leading/trailing, margin, basis, starters left, opponent avatar | **Full build.** `isProj` maps to `basis === 'projected'`. |
| Draft HQ | `getDraftHqAll` — phase, status, rounds, your slot, picks made, pick clock | **Build, minus queue count.** No draft queue is stored for imported leagues (`warRoom.ts` says so explicitly). Queue count is **dropped**, not faked. |
| War Room | `DraftSession` + `DraftPick` | **Build live drafts + recent picks.** "Your queue targets" is **dropped** — same missing table. Starting-soon list kept. |
| Week | `getWeekBoard` (margin) + `getSeasonOutlook` (`you.playoffPct`) | **Full build.** Playoff-path exclusion uses real simulated odds. |
| Standings | `getSeasonOutlook` — `you.seed`, record, `playoffPct`, `whatDecidesIt` | **Full build.** Ranked by seed exactly as the design specifies. |
| Live | `getLivePageData` — games, `leaguesAffected`, `tieIns`, per-sport counts, team logos | **Full build.** Already carries every field. |
| Portfolio | `getPortfolio` — claimed teams, league avatar, commissioner flag, roster count | **Full build** + platform tabs. ⚠ Portfolio lists **claimed teams**, not leagues — the design's "65 leagues" framing is corrected in copy. |
| Waivers | `LeagueWaiverSettings`, `Roster.faabRemaining`, `WaiverClaim`, `lookupProjections`, `getRosteredMarket` | **Build, ranked by waiver-run urgency.** Add/drop pair + AF projection + own%/start% are real. The design's per-row prose reasoning is replaced by a **derived** one-liner (position, projection delta, own%) — no LLM call, because AI spend is ratcheted to zero. |
| Trades | `LeagueTrade` (7,781 completed), `getTradesData` grades, `trade_deadline_week`, `AfLeagueTrade` (pending) | **Re-aimed, deliberately.** ⚠ **There are no pending trades to rank.** `af_league_trades` and `redraft_trade_proposals` are both empty in production, and Sleeper's pending state is transient — measured, 247 trades across 31 leagues, all `complete`. Ranking "top 10 pending trades by deadline" would render an empty screen forever. The board keeps the design's exact row anatomy (both sides flattened, fairness grade, reasoning line) and the deadline ranking, but the subject is **your trade windows closing** — the leagues whose deadline is nearest, each showing its latest real trade and grade. A pending section renders above it the moment `AfLeagueTrade` has rows. |
| Career · Seasons | `CareerData.seasons` | **Full build.** |
| Career · Hall of Fame | `CareerData.titles` | **Build, minus the championship-week score.** No stored championship box score; the row shows season, league, platform, record. Score is **dropped**. |
| Career · Records | `WeeklyMatchup` (points for/against per week), `LeagueTrade`, `WaiverPickup` | **Build the records the data supports.** Highest/lowest week, best season total, longest win/lose streak, biggest blowout, closest win, most trades, most waiver adds, most leagues rostering one player. A record with no rows renders as absent rather than as a zero. |
| Share | `toShareCard` + `CareerData` | **Full build** — real premium card, filled caption, stated token cost. |
| League list (rail) | rail rows + `getMatchupPulse` | **Full build.** Desktop expands to a matchup rail; mobile becomes a pull-out tray. |

## Decisions taken (each a deliberate drop, not an accident)

1. **The league-picker grid is not deleted — it moves behind the footer link.** Every board ends
   with "N more leagues are set — View all N →", which lands on the same route with `?all=1` and
   renders the existing picker. This preserves the only route in for a manager with nothing urgent,
   which was the explicit reason (2026-08-30) the board was made additive rather than a replacement.
2. **"Needs you first" is folded into the boards.** Its rows are the same severity signal the
   boards now rank on, so it is no longer rendered twice. It remains on `?all=1`.
3. **Draft queue counts and War Room queue targets are dropped**, not fabricated. No queue is
   stored for imported drafts.
4. **Per-row prose is derived, never generated.** Every "reasoning" line is computed from the same
   numbers on the row.
5. **Trades is re-aimed at trade windows.** See table.

## Images

- **League art** — `imageOf()` (`logoUrl`, else Sleeper avatar id expanded to its CDN URL), with a
  platform-tinted monogram fallback. Never a broken `<img>`.
- **Player headshots** — `SportsPlayer.imageUrl`, with initials fallback.
- **NFL / club logos** — `teamLogoUrl(sport, team)`, which returns null rather than guessing.
- **Manager avatars** — already on `PulseRow.opponentAvatarUrl`.

---

## What was actually built (2026-09-07), and what rendering found

Every board below was rendered signed-in against real data before being called done. Four defects
were found that way and none of them by a test — the same pattern the `/core` shell handoff already
recorded.

### New files

| file | what |
|---|---|
| `components/core-app/af-core-boards.css` | the shared board design system |
| `components/core-app/boards/BoardKit.tsx` | head, section header, footer, crest, headshot, monograms |
| `components/core-app/boards/StandingsBoard.tsx` | ranked by seed |
| `components/core-app/boards/WeekBoard.tsx` | leading / trailing-with-a-path |
| `components/core-app/boards/DraftHqBoard.tsx` | ranked by clock |
| `components/core-app/boards/WarRoomBoard.tsx` | live drafts only |
| `components/core-app/boards/WaiversBoard.tsx` | ranked by net gain |
| `components/core-app/boards/TradesBoard.tsx` | trade windows closing |
| `components/core-app/boards/CareerViews.tsx` | Seasons / Hall of Fame / Records |
| `components/core-app/boards/DraftClock.tsx` | the one live number on a draft card |
| `lib/core-app/leagueArt.ts` | one avatar-id expansion, replacing three private copies |
| `lib/core-app/waiversBoard.ts` · `tradesBoard.ts` · `warRoomBoard.ts` · `careerRecords.ts` · `railMatchups.ts` | the new loaders |

### The `?all=1` escape hatch

Every board's footer links to `/core/<screen>?all=1`, which renders the existing `PickALeague`.
**It renders unconditionally**, including when nothing is hidden. That is deliberate and reverses a
2026-08-30 decision on purpose: the boards were made additive back then precisely so a manager with
nothing urgent would still have a route into a league. The footer link is that route.

### Four bugs a render found and a test would not have

1. **My Team said "every lineup we could read is set" when it had read none.** With `checked === 0`
   that sentence is vacuously true and reads as "your lineups are fine" — the single most damaging
   thing this board could say. Now a distinct branch.
2. **Matchup said "No claimed team yet" to an account holding four.** `matchupPulse` drops a claimed
   team whose `externalId` is not numeric (an ESPN SWID, a Fantrax slug) because the WeeklyMatchup
   join needs Sleeper's roster_id — and reported `considered: 0`. Now counted as
   `notRanked.unidentifiedRoster` and said out loud as our gap.
3. **Three footers offered "View all 0".** The denominator was the loader's own count (claimed teams,
   simulated leagues, scheduled matchups), not leagues held. On the only remaining route to the
   picker that stranded every other league.
4. **Trades headed a list "ranked by deadline" over four rows all reading DEADLINE UNKNOWN.**

### One CSS bug worth remembering

`.af-shell[data-rail-open='true'] { grid-template-columns: 300px 232px 1fr }` was written unscoped.
Below 720px the shell is a single column with the rail as a fixed overlay, so that rule made the grid
566px wide on a 375px viewport — and the fixed rail then sized itself against **that** box rather
than the viewport, so `translateX(-100%)` moved it 566px and the open state left it at −191px, still
off screen. `visibility` flipped, the tray did not appear, and nothing threw. Scoped to
`@media (min-width: 721px)`.

⚠ And a measuring trap alongside it: `getComputedStyle(el).transform` **freezes mid-transition while
the Browser pane is hidden**, because the page is not painted. It reported `translateX(-100%)` for
an element whose rule said `transform: none`, even against an inline override. Setting
`el.style.transition = 'none'` before measuring is what settled it.
