# Draft Board Deep Audit — 2026-09-19

## Verdict

The live draft system has a substantial, shared engine and a usable NFL-first interface, but it is **not ready to launch NBA or NHL paid/competitive leagues for the 2026-27 seasons**. The board can render multi-sport rows and the snake/linear/auction mechanics exist, yet the production NBA pool is materially wrong, NHL has no production league/draft-session proof, external ADP is empty for both sports, AllFantasy AI ADP is stale and polluted, and the season runtime explicitly supports NFL only.

The right release language today is:

- **NFL snake/linear:** beta-ready after the known create-league and draft-order regressions are fixed.
- **NFL auction:** feature-complete enough for continued QA; requires a clean end-to-end certification run.
- **Offline/auto/slow/mock:** implemented as modes around the core pick engine, but not all have clean persistence or passing regression proof.
- **NBA/NHL draft board:** prototype/data-QA stage, not season-ready.
- **NBA/NHL full league:** blocked because scoring, matchup finalization, playoffs, and offseason cannot run end to end.

## What was audited

- All 12 create-league concepts: redraft, dynasty, keeper, best ball, guillotine, survivor, tournament, devy, Campus-to-Canton, zombie, salary cap, and Big Brother.
- Core and execution draft modes: snake, linear, auction/salary cap, slow, mock, offline, auto, team/co-managed, rookie, supplemental, and dispersal.
- Board state, timer, pick order, commissioner edits, auction nomination/bidding, queues, autopick, keepers, devy/C2C pools, completion-to-roster sync, and responsive UI.
- Player pool identity, headshots, team logos, external ADP, AllFantasy AI ADP, sport-specific statistics, Chimmy context, Live Draft Brain, and Decision OS.
- Production database coverage for NBA and NHL, read-only.
- Current 2026-27 NBA and NHL calendar urgency.

## Architecture that is working

1. **One canonical live board exists.** `/drafts/[draftId]` resolves a live session and renders `DraftBoard` → `DraftRoomPageClient`. Snake and linear use the same board with centralized pick-order math. Auction routes into the same client with the auction spotlight and dedicated nominate, bid, and resolve endpoints.
2. **Sport-aware presentation exists.** The pool supports NFL, NBA, NHL, MLB, NCAAF, NCAAB, and soccer. NBA gets PTS/REB/AST/STL/BLK/3PM columns; NHL switches between skater and goalie columns.
3. **Core draft operations are real.** Persistent sessions, picks, queues, timer state, pause/resume, undo/correction logs, keeper selections, traded-pick ownership, C2C/devy configuration, auction budgets, and commissioner AI manager settings exist in the database and API surface.
4. **Images and logos are carried through one normalized display model.** Player headshot and team-logo fields reach the player table, cards, queue, drafted cells, and detail modal, with fallbacks.
5. **Chimmy has a live draft context path.** The board loads league-specific news and non-stale injuries from `/draft/assistant-context`; the client builds a prompt containing sport, format, draft type, roster needs, recent news, and injuries.
6. **Live Draft Brain is wired.** It receives the current round/pick, available players, external and AI ADP, roster construction, scarcity, recent picks, next teams, and auction budgets. Its endpoint is deterministic and membership-gated.
7. **Safety controls are good.** The Playwright server refused to run E2E tests against the production database. The audit did not override that protection.

## Critical findings

### P0 — The production NBA draft pool is not a valid 2026-27 fantasy player pool

Read-only production resolution for league `0c06473d-9509-47ec-bc69-f372a5644c86` returned:

| Measure | Result |
|---|---:|
| Requested resolver limit | 500 |
| Returned entries | 1,811 |
| Entries with system/external ADP | 0 |
| Entries with matched AI ADP | 0 |
| Entries with fantasy PPG | 0 |
| Headshots using an NFL Sleeper CDN path | 856 |
| Duplicate display names | 64 |

Examples at the top of the returned board included retired or irrelevant players such as A.J. Hammons, Aaron Brooks, Aaron Harrison, and Aaron Jackson. Aaron Gordon appeared twice at different positions. Several NBA rows used URLs shaped like `sleepercdn.com/content/nfl/players/thumb/...`, so the URL classifier marked them as real headshots even though the asset namespace was wrong for the sport.

Root causes:

- `SportPlayerPoolResolver` does not restrict rows to a current/active 2026-27 roster.
- When no usable ADP exists, the fallback order is effectively provider/alphabetical order.
- Deduplication keys include position and team, which preserves conflicting identities as separate players.
- The final resolved list is not capped to the caller's requested limit after the merge/enrichment steps.
- Image validation checks that a URL looks like a headshot, but does not validate that its provider namespace matches the player's sport/identity.

**Release gate:** build a season-scoped active-player eligibility table, canonicalize multi-position identity without duplicating the athlete, enforce the final limit, reject cross-sport image namespaces, and certify a top-300 NBA board manually and automatically.

### P0 — NBA and NHL have no current external ADP

Production `AdpDataRecord` contains **zero NBA rows and zero NHL rows**. The board therefore cannot show the requested external/system ADP or rank a fallback pool by a credible market source.

There are AllFantasy snapshots, but they are not usable release data:

- NBA: 93 `real` rows, last updated May 7, 2026.
- NHL: 86 `real` rows, last updated May 7, 2026.
- The sample is clearly synthetic/polluted: NBA ranks A.J. Hammons at 1.84, Aaron Brooks at 6.12, and retired Andrew Bogut at 10.36, all labeled as 2026 redraft snake data.
- The existing NBA league context matched zero AI ADP rows in the resolved board.
- Snapshot scoring is labeled `ppr`, an NFL concept, for NBA.

**Release gate:** ingest a licensed/current NBA and NHL ADP source, purge synthetic rows from the `real` cohort, use sport-valid scoring context keys, require freshness and minimum-sample checks, and make the board show an explicit “ADP unavailable” state instead of treating alphabetical order as rank.

### P0 — NHL is unproven in production

Production contains 5,502 raw NHL `SportsPlayer` rows and 4,701 unique name/position/team combinations, but only 1,000 of those unique rows carry an `Active` status. There are retired players with current team affiliations in the source data. Production has **zero NHL leagues and zero NHL draft sessions**, so there is no resolved NHL board, pick, auction, completion, or roster-sync proof.

The raw image coverage is also weak: 1,961 of 5,502 raw NHL rows have an image URL (35.6%). The UI fallback prevents broken layout, but it does not meet the requested real-headshot standard.

**Release gate:** create a safe NHL test league in staging, resolve an active-only pool, verify a complete snake and auction draft, and measure headshot/team-logo/ADP coverage on the final board rather than on raw source rows.

### P0 — NBA/NHL seasons cannot run after the draft

`lib/sport-scope.ts` explicitly defines `SEASON_CAPABLE_SPORTS = ['NFL']`. Its source comment states that non-NFL leagues can be created and drafted, but weekly score sync throws, matchups never finalize, week advancement stops, and playoffs/offseason never arrive.

This blocks any claim that NBA or NHL is ready merely because its draft board renders.

**Release gate:** implement and certify provider-backed player-game stats, scoring calculation, lineup locks, matchup finalization, schedule/week resolution, standings, playoff advancement, champion finalization, and offseason transition for each sport.

### P0 — Decision OS is not connected to live draft decisions

The draft room has Live Draft Brain, draft helper logic, and shared-services draft shadow/backtest modules. It does **not** call a live Decision OS draft slice. The repository's own shared-services documentation says “draft (no slice at all).” Decision OS ADP enrichment tests cover canonical world data, not a live draft decision route or board card.

**Release gate:** add a provider-neutral draft decision slice, feed it the canonical draft context, persist evidence/provenance, expose read-only recommendations in the board, and shadow-compare it with Live Draft Brain before enabling automation.

### P1 — Chimmy is connected, but readiness is overstated when player data is bad

Chimmy's assistant context endpoint and prompt wiring are real. The UI marks “Chimmy Ready” from entitlement/provider availability, not from player-pool, news, injury, or ADP quality. For NBA/NHL, Chimmy can therefore be visibly “ready” while the pool contains inactive players and no valid ADP or projections.

**Fix:** gate sport-specific recommendation readiness on pool eligibility, identity confidence, ADP freshness, projection coverage, and feed freshness. Allow chat when degraded, but label advice as limited and do not present high-confidence draft recommendations.

### P1 — Draft mode truth is fragmented

The registry, create wizard, settings screen, and live engine describe overlapping but different concepts:

- `slow_draft` is registered for redraft but intentionally removed from the redraft create wizard.
- `mock_draft` is registered as a create-league choice even though mock drafts should not create or mutate a real league roster.
- Offline, auto, and team/co-managed are stored as execution modes but also accepted as draft type IDs and mapped to snake internally.
- Salary cap correctly forces auction at create time, but it still shares the generic auction core and needs contract/cap lifecycle certification after completion.
- The live route only distinguishes snake, auction, and lottery. Linear uses the snake URL family, which is acceptable mechanically but makes URL/type diagnostics less explicit.

The focused test suite found a current contract disagreement: `draft-type-startup-allowlist.test.ts` expects redraft to expose only snake/linear/auction, while the registry returns snake/linear/auction/slow/mock.

**Fix:** store `pickOrderType` (`snake|linear|auction`) separately from `executionMode` (`live|slow|offline|auto|mock|team`) everywhere, and derive routing/capabilities from those two fields. Do not create a league for a mock draft.

### P1 — Two draft-order/autopick regressions are present

The focused Vitest run produced 1,857 passes and 4 failures:

1. Redraft startup allowlist differs from its contract test.
2. Slow-draft queue autopick timed out while attempting to skip a non-starter-eligible queued player.
3. Automatic rookie draft order timed out.
4. The manual rookie draft order test shows the automatic resolver is still called even when the manual order should win.

These are release blockers for slow drafts and dynasty rookie drafts until reproduced in isolation and fixed.

## Draft type and league-format status

| Format/mode | Current status | Main remaining proof/gap |
|---|---|---|
| Snake | Strongest path | Fix create/session date persistence and complete a production-like full-draft certification. |
| Linear | Core order math exists | Add dedicated full-draft E2E and visible format verification. |
| Auction / salary cap | Nominate, bid, resolve, budgets exist | Certify simultaneous bids, timer expiry, minimum roster completion, salary/contract handoff. |
| Slow | Timer/overnight pause and queue autopick exist | Current queue-autopick regression times out; clarify wizard exposure. |
| Offline | Commissioner entry capability contract exists | Verify the UI prevents normal user picks and that manual entry completes rosters correctly. |
| Auto | CPU/AI autopick exists | Verify all-team completion, unavailable players, queue exhaustion, and deterministic recovery. |
| Mock | Separate mock engine exists | Remove it from real league creation; guarantee zero league-roster mutation. |
| Keeper | Keeper selections and round costs exist | Full keepers-to-board-to-final-roster certification. |
| Dynasty rookie | Lifecycle support exists | Current order precedence tests fail/time out. |
| Devy | Mixed college/pro pool and round config exist | NBA college/pro identity, current ADP, promotion, and image coverage remain unproven. |
| C2C | Mixed pool and filters exist | Same data risks as devy; verify both rosters receive correct assets. |
| Best ball | Draft modes exist | Post-draft optimal-lineup scoring is outside the board and must be sport-certified. |
| Guillotine/survivor/zombie/Big Brother | Share the board engine | Specialty elimination/infection/social lifecycle needs separate post-draft certification. |
| Tournament | Can create child drafts | Verify draft completion advances tournament rosters without duplicate identities. |
| Supplemental/dispersal | Separate lifecycle paths exist | Not fully unified with the canonical room; certify eligibility and completion sync. |

## Images, logos, and statistics

### Player headshots

- The UI wiring and fallback behavior work.
- Production NBA resolution reported 96.6% URL-classified headshots, but 856 of 1,811 were NFL Sleeper CDN URLs and therefore cannot be trusted.
- Raw production source coverage is 1,395/2,482 NBA rows (56.2%) and 1,961/5,502 NHL rows (35.6%).
- A fallback silhouette is preferable to a wrong athlete image; cross-sport and identity validation must happen before setting `headshotUrl`.

### Team logos

- The resolved NBA audit reported 100% non-null team-logo fields, showing the display pipeline is wired.
- This measures a URL/fallback field, not a visual identity match. Add a canonical team-ID audit to catch stale relocations, full-name/abbreviation mismatches, and wrong-league badges.

### Sport statistics

- Column definitions are correctly sport-specific.
- Production NBA resolution had 0/1,811 fantasy PPG values. NBA PTS/REB/AST/STL/BLK columns have definitions, but current resolved rows do not prove populated data.
- NHL stat definitions exist for skaters and goalies, but there is no production resolved-board proof.

## NBA and NHL 2026-27 urgency

- The NHL regular season begins **September 29, 2026**, only 10 days after this audit, and expands to 84 games per club. Source: [NHL official schedule announcement](https://www.nhl.com/news/nhl-announces-2026-27-regular-season-schedule).
- The NBA regular season begins **October 20, 2026**. Training camps open September 29 and preseason begins October 3. Sources: [NBA official schedule release](https://www.nba.com/news/2026-27-schedule-announced) and [NBA key dates](https://www.nba.com/news/key-dates).

Readiness assessment:

| Sport | Draft UI | Player pool | ADP | AI | Full season | Launch call |
|---|---|---|---|---|---|---|
| NBA | Renderable | Failing eligibility/identity | Missing | Connected but ungrounded | Not implemented end to end | Do not launch competitive leagues. |
| NHL | Renderable by code | Uncertified; no league/session proof | Missing | Connected by generic path only | Not implemented end to end | Do not launch; NHL date makes this immediate. |

## Required release plan

### Immediate P0 — before any NBA/NHL draft is offered

1. Freeze NBA/NHL production league creation or label it preview-only.
2. Build current-season active eligibility for NBA and NHL and purge/ignore retired/inactive rows.
3. Fix canonical identity and cross-sport headshot validation.
4. Import current external ADP and quarantine the May synthetic AllFantasy snapshots.
5. Enforce pool limit and add coverage gates: active identity, unique athlete, ADP, headshot, team logo, projections.
6. Create staging NBA and NHL leagues and complete snake plus auction drafts through roster finalization.

### P1 — draft engine certification

1. Separate pick order from execution mode in persistence and API contracts.
2. Resolve the four focused-suite failures.
3. Add full-draft E2E for linear, offline, auto, slow, rookie, keeper, devy, C2C, and salary-cap completion.
4. Add race tests for auction bids and timer expiry.
5. Add commissioner/co-commissioner negative authorization tests to every mutation route.

### P1 — intelligence certification

1. Add draft data-readiness gates to Chimmy and Live Draft Brain.
2. Build a Decision OS draft slice in shadow mode with evidence/provenance.
3. Require current ADP/projection coverage before showing confident recommendations.
4. Track recommendation inputs so post-draft grading can distinguish model error from missing data.

### P0/P1 — full NBA and NHL season engines

Implement provider-backed scoring and schedule pipelines separately for NBA and NHL, then certify lineup locks, waivers, trades, standings, playoffs, champion, offseason, and Commissioner Hub/Chimmy/Decision OS consumption. The current multi-sport configuration modules are settings services; they are not season execution engines.

## Verification record

- Focused Vitest: **121 files; 118 passed, 3 failed. 1,861 tests; 1,857 passed, 4 failed.**
- Production database audit: read-only NBA/NHL league, player, image, ADP, AI ADP, and resolved NBA pool measurements.
- Browser: authenticated deployed AllFantasy navigation was inspected read-only.
- Playwright: production execution was blocked by the repository's safety guard. A safe `.env.test` run started 19 draft-room tests; external PostHog requests were blocked by the sandbox and are unrelated to draft behavior. Record the final result separately if that long-running run completes.

