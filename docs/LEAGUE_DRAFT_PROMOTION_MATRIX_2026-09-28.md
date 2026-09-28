# League and draft promotion matrix — 2026-09-28

Base: `origin/main` = `12e4f6277f9f17597185975dd9fb5a1de844638d`. Production
`/api/af-debug/sha` returned that exact SHA at 2026-09-28 02:28 UTC, health 200.
Code was read from the ref, not a working tree. Production observations are
aggregate, `BEGIN READ ONLY`, no identifiers printed, no writes.

This is a readiness ledger, not a launch claim. A cell is only as strong as its
label.

| Label | Meaning |
|---|---|
| **DB** | proven against the guarded known test database (real services, real writes, exact cleanup) |
| **E2E** | proven in an authenticated browser journey against the test database |
| **mock** | unit/integration test with mocked Prisma or providers only |
| **prod-ro** | observed read-only in production |
| **unverified** | code exists; no evidence that it runs correctly |
| **not built** | no code path, or code with no scheduled caller |
| **vendor** | blocked on licensed or provider data we do not have |

## 1. What the public wizard actually offers

`components/create-league-v2/CreateLeagueWizard.tsx` → `SIMPLE_LEAGUE_TYPES` =
**redraft, dynasty, keeper, best ball, guillotine**. Nothing else is reachable
from the button.

- Redraft, dynasty, keeper, best ball: all seven sports.
- Guillotine: NFL, NCAAF, NBA, NHL, MLB (seed data). ⚠ `lib/league-rules/conceptCatalog.ts`
  lists NFL/NBA/NHL/MLB only — the wizard offers **NCAAF guillotine**, which the
  catalog does not, in a sport that cannot run a season at all (§3).
- Survivor, zombie, salary cap, Big Brother: **not offered**. The API still
  accepts them from a hand-built payload. Tournament creation is refused
  (`lib/league-creation/retiredConcepts.ts`).

Anything in this ledger about the four unoffered concepts is scoped out of the
promotion; see §6 for why they must stay unoffered.

## 2. Concept × stage (sport-agnostic machinery)

| Concept | Create + settings | Join / seat | Draft | Roster finalize | Weekly score + median | Format job (scheduled?) | Endgame / champion | Offseason → next draft |
|---|---|---|---|---|---|---|---|---|
| Redraft | DB, E2E | DB (concurrent last seat 200/409) | DB, E2E (7 sports, 1-round + default depth) | DB | DB (4-team season, 15 wks + median) | n/a | DB (`rollPostseason` → `finalizeSeasonAndEnterOffseason`, hourly) | DB — **manual** commissioner action |
| Dynasty | DB | DB | DB | DB | DB | n/a | DB (same path) | DB (80 carried, rookie draft, traded pick) — manual; offseason **UI** unverified |
| Keeper | DB | DB | DB (locked keeper placed) | DB | DB | keeper window, `/api/keeper/session` hourly — mock | DB | DB — manual; keeper selection **UI** unverified |
| Best ball | DB | DB | E2E | DB | DB (optimal lineup inside `updateMatchupScores`) | `runNativeTournamentWeek` via score-sync */5 — DB | DB (`finalizeNativeTournamentSeason`) | unverified |
| Guillotine | mock | DB | DB | mock | DB (via `runElimination` directly) | chop via `runNativeGuillotineWeek` in score-sync */5 — **mock only**; the DB smokes bypass it | **DB** (this PR): `finishGuillotineSeason` crowns the last team standing, archives by survival order, enters offseason; score-sync retries an unarchived finish for 7 days | **DB** (this PR): next draft created, year-two shell clears last season's chops, eliminations kept |

**Draft modes.** Snake / linear: DB + E2E, and the server tick autopicks them (§4).
**Auction:** the server tick skipped auctions (`auction_not_supported`), so a bid
only closed while someone had the room open — fixed in #1479, DB-proven with two
ticks racing (exactly one sale). **Slow drafts:** covered by the server tick (§4).

## 3. Sport × stage

| Sport | Draft pool + identity | Market ADP | Headshots / logos | Stat ingestion (scheduled) | Native weekly score | Lineup lock | Can run a season |
|---|---|---|---|---|---|---|---|
| NFL | E2E | prod-ro (`adp_data` NFL only) | prod-ro, 1 sample undecodable | Sleeper live + `import-scores` */2 | DB; prod-ro running (`cron-redraft-score-sync` */5) | per kickoff | **yes** |
| NHL | E2E (synthetic pool) | **vendor** | partial, identity unverified | RI game logs daily 07:00 (prod-ro ran 2026-09-27) | wired; opener 2026-09-29 — **unverified live** | TSDB slate | yes (per `SEASON_CAPABLE_SPORTS`) |
| NBA | E2E (synthetic pool) | **vendor** | partial | RI game logs daily | wired; opener 2026-10-20 — unverified | slate; fails open on team-name mismatch | yes, unexercised |
| NCAAB | E2E (synthetic pool) | **vendor** | weakest coverage | RI game logs daily | wired | **none** | blocked: RI 2026-27 schedule unpublished (GAPS N-16) |
| NCAAF | E2E (synthetic pool) | **vendor** | partial; `cron-sync-player-images-ncaaf` runs end `partial`, no error recorded (prod-ro) | CFBD `import-stat-lines` 30 */6 | **not built** — `playerWeeklyScoreService.ts:190` throws for `NCAAFB` | none | **no** — held at week 1 |
| MLB | E2E (synthetic pool) | **vendor** | partial | RI game logs daily (~66k rows) | **not built** — throws; no normalizer, no singles/doubles/triples/holds/batter-K categories | none | **no** |
| SOCCER | E2E (synthetic pool) | **vendor** | partial | RI game logs daily | **not built** — throws; finalizer `sport_not_week_keyed` | none | **no** |

The wizard **labels** NCAAF / MLB / SOCCER "Draft and league tools only — weekly
scoring is not wired" at the sport step (deliberately labelled, not disabled).
Production has one NCAAF redraft season sitting in `in_season` (prod-ro) — it
belongs to an imported league, which the native scorer does not run. There is
no native NCAAF league in production (prod-ro, Sep 28).

**The seven-sport promotion claim is therefore at most four sports for a
season**, and one of those four (NCAAB) cannot seal a week until its vendor
schedule publishes. NBA and NHL have never finalized a real week.

## 4. Schedulers (prod-ro, `sync_job_runs`, 24 h window)

Dispatch: GitHub Actions fast/slow tiers → HTTP to the worker service, from
`cron-schedule.json` (60/60 budget, ~56 fire). No BullMQ worker is launched;
`scripts/start-worker.ts` has no launcher, so the separate league-engine scorer
(#1207) never runs.

| Job | Runs / 24 h | Non-success | Note |
|---|---|---|---|
| `cron-redraft-score-sync` | 248 | 2 | the production scorer |
| `cron-season-week-roll` | 24 | 0 | week roll + postseason |
| `cron-draft-tick` | 1214 | 1 | server autopick **on**: a run with `DRAFT_TICK_CRON_ENABLED` off writes `autopickDisabled`, and 0 of 9,181 runs in 7 days did (prod-ro, Sep 28) |
| `cron-live-score-tick` | 512 | 6 | NFL only |
| `cron-keeper-session` / `cron-waivers` / `cron-redraft-waiver-process` | 24 / 260 / 24 | 0 | |
| `cron-tournament-automation` | 24 | 0 | |
| `cron-import-player-game-stats-multisport` | 1 | 0 | daily |
| `cron-sync-player-images-ncaaf` | 1 | 1 | `partial`, no error recorded (last 3 runs, Sep 26–28) |

Open draft sessions (prod-ro): 38 total, 1 in progress, 0 with a pick clock
expired more than 10 minutes. With the flag on, an expired snake/linear clock
resolves on the server within a minute (the tick made 0 picks in 7 days only
because no native clock expired). Auctions were the exception — the tick
skipped them — until #1479. Native auction drafts in production today: 0.

## 5. Unscheduled writers (the fatal-and-silent class)

Offered concepts: **none** have an unscheduled core job. Guillotine's
end-of-season hand-off (§2) was the same shape — a step that existed
(`finalizeSeasonAndEnterOffseason`) and was never reached — and is closed by
this PR.

Unoffered concepts: Big Brother (`runBigBrotherAutomationTick`, reminders,
stat-correction), Survivor (tribal open/deadline, eliminations, phase advance,
`/week-start`), zombie full tick, C2C and devy automation,
`/api/bestball/weekly-winners`, `/api/guillotine/stat-correction`,
`processAllActiveLeaguesForWeek`. The cron budget is full (60/60), so wiring
any of these means folding, not adding.

## 6. Promotion verdict by cell

- **Promotable now (with the stated evidence):** NFL × redraft / dynasty /
  keeper / best ball, snake or linear draft, create → draft → season → playoffs →
  next draft. Market ADP, stats and scoring are real for NFL.
- **Promotable as draft-only:** every sport's draft room, with market ADP shown
  as missing outside NFL (never an internal rank dressed as ADP).
- **Not promotable yet:**
  - guillotine, any sport — the season end and year two are now DB-proven (§2), but the weekly chop through the scheduled `runNativeGuillotineWeek` path (sealing, scoring, cutoff) is still mock-only; and NCAAF/MLB guillotine is offered in sports that cannot score a week (§3);
  - any season claim for NCAAF / MLB / SOCCER (§3);
  - NBA / NHL / NCAAB season claims until a real week has finalized in production;
  - auction drafts, until #1479 lands (slow snake/linear drafts are covered by the server tick);
  - Survivor / zombie / salary cap / Big Brother — correctly unoffered; keep them so until their jobs are scheduled.
- **Blocked on vendor data:** market ADP for six sports; the licensed-export
  path is built and tested with a synthetic fixture only.

## 7. Engineering gaps closable without vendor data, ranked

1. ~~**Guillotine end-of-season**~~ — done in this PR, proven on the test DB by
   `scripts/smoke-guillotine-season-end-testdb.ts`.
2. **Guillotine in NCAAF and MLB** — offered by the seed data, absent from
   `conceptCatalog`, and neither sport can score a week. A product call: NCAAF
   guillotine has deliberate defaults and tests, so this is "which sports do we
   offer", not a bug fix. Same question applies to every concept in those sports.
3. ~~**Server-side draft clock**~~ — the flag was already on (§4); auction
   resolution added to the tick in #1479.
4. ~~**NCAAF weekly scoring**~~ — #1468; its lineup lock is #1474. Dry-run on
   production's CFBD rows (20,000): zero unmapped stat keys.
5. ~~**NCAAF image sync failure**~~ — its last three runs are `partial` with no
   error recorded, not failed.
6. Survivor / Big Brother scheduling — only if the product decides to offer them.
