# AllFantasy Redraft Season Rules Contract

**Status:** Living contract · NFL is the reference implementation · NCAAF tracks the
same lifecycle where data exists.
**Scope:** Redraft (single-season) leagues for NFL and NCAAF. Dynasty/keeper/devy,
survivor, zombie, best-ball, and C2C formats have their own engines and are out of
scope here except where they branch off the shared scoring path.

This document is the authoritative description of how a redraft league must behave
from draft day through champion. It is the spec the contract tests
(`__tests__/redraft/season-rules-contract.test.ts`) and the engine E2E
(`scripts/run-nfl-full-season-engine-e2e.ts`) assert against. Where the code does
not yet meet the contract, it is called out under **Known Gaps**.

---

## 1. Required fantasy season lifecycle

A redraft season MUST move through these phases without duplicate scoring,
duplicate rosters, duplicate trades, or partial waivers:

1. **League created** with commissioner settings (`League.settings.sportConfig`).
2. **Managers join teams** (`LeagueTeam`, claimed by users).
3. **Draft** creates initial rosters (live draft room → `DraftPick`).
4. **Draft finalization** bridges picks into redraft tables
   (`syncCompletedDraftToRedraftSeason` → `RedraftSeason` / `RedraftRoster` /
   `RedraftRosterPlayer`). Each drafted player is assigned to exactly one roster.
5. **Undrafted players** remain unowned and available.
6. **Waivers / free agency** make undrafted or dropped players claimable per
   league settings.
7. **Managers set lineups** (`RedraftRosterPlayer.slotType`).
8. **Only starter slots count** toward a matchup score.
9. **Bench / IR / taxi / devy do NOT count** unless the format explicitly says so.
10. **Lineups lock** per the league lock setting (see §10).
11. **Real game stats imported** (`PlayerWeeklyScore.stats`, NFL pipeline).
12. **League scoring settings** convert raw stats → fantasy points.
13. **Live scores** may update during games (cron-driven today — see §10 / Part D).
14. **Final scores lock** when games are final (`PlayerWeeklyScore.isFinalized`).
15. **Weekly winners update standings** (`updateStandings`).
16. **Waivers process** per commissioner settings (§7).
17. **Trades follow league rules** (§8).
18. **Playoff seeds** generated from standings + tiebreakers.
19. **Playoff rounds** advance winners (`advancePlayoffWinners`).
20. **Champion** crowned and stored (`finalizeRedraftSeasonChampion` →
    `LeagueChampionship`).
21. **Season completes** idempotently — re-running any step is a safe no-op.

---

## 2. NFL-specific expectations

- 17-week default season, playoffs default week 15, 4 playoff teams (commissioner
  configurable). Bye weeks honored (`hasBye: true`).
- Scoring presets: PPR / Half-PPR / Standard / Custom. Toggles: IDP, Superflex,
  TE Premium.
- Roster: QB/RB/WR/TE/FLEX/SF/DEF/K plus IDP slots when enabled; bench + IR.
- Lineup lock type: `per_player_kickoff` (each player locks at their game's kickoff).
- Weekly stat sync is **wired and supported** (`syncPlayerWeeklyScoresForRedraftSeason`).
- **NFL is the reference implementation** — it must satisfy the full contract.

## 3. NCAAF-specific expectations

- 13-week default season, playoffs week 12, 4 teams. `hasBye: false`.
- Same lifecycle and engines as NFL (scoring, waivers, trades, playoffs, champion
  all run through the shared redraft engines).
- **Data limitation:** weekly stat sync is wired for **NFL only**. The scoring
  runner (`SCORING_SUPPORTED_SPORTS = {'NFL'}`) **skips** NCAAF seasons with an
  explicit `dataWarning` and never marks them processed/synced. This is a data
  gap, not an engine gap — the engines themselves are sport-agnostic.
- NCAAF therefore satisfies the **structural** contract (draft, roster, lineup,
  waivers, trades, playoffs, champion) but **cannot run live weekly scoring**
  until an NCAAF stat pipeline populates `PlayerWeeklyScore`. Until then NCAAF is
  **beta** for live-scored play and must surface data warnings rather than fake
  scores.

---

## 4. Commissioner settings that MUST be honored

Source of truth: `League.settings.sportConfig` (per-league overrides) layered on
`lib/sportConfig/configs/{nfl,ncaaf}.ts` defaults and the redraft defaults in
`lib/redraft/sportConfig.ts`.

| Setting | Honored today | Notes |
|---|---|---|
| `scoringPreset` (PPR/Half/Standard/Custom) | ✅ | `applyScoringPresetToRecPoints` |
| `categoryPoints` per-stat overrides (e.g. 4 vs 6 pt pass TD) | ✅ | `scoreStatsWithCategories` overrides |
| `enableIDP` / `enableSuperflex` / `enableTEPremium` | ✅ | `expandSportConfigToggles` + category/slot gating |
| Roster slot counts (QB/RB/WR/TE/FLEX/K/IDP/bench/IR) | ✅ | `lineupValidation` capacities |
| `seasonWeeks` / `playoffStartWeek` / `playoffTeams` | ✅ | schedule + playoff generation |
| `medianGame` | ✅ | schedule engine emits median rows |
| FAAB budget + FAAB bidding | ✅ | `RedraftRoster.faabBalance`, waiver engine |
| Waiver **mode** (FAAB / rolling / reverse-standings / FCFS) | ⚠️ Partial | Config defines `defaultWaiverType`; the engine always runs a FAAB+priority hybrid — see Known Gaps |
| Waiver **windows** (process days/time, continuous) | ⚠️ Partial | Cron runs hourly; per-league windows not enforced |
| Trade review mode (instant / commissioner / league vote / veto threshold) | ✅ | `trade-votes` route honors `vetoMode` + `vetoThreshold` |
| Lineup **lock mode** (per-kickoff / first-game / manual) | ✅ | `lib/redraft/lineupLock.ts` derives `isLocked` from the `SportsGame` schedule at request time; roster GET/PATCH enforce it; commissioner mode + emergency unlock honored (see §10) |

---

## 5. Scoring behavior

- **Authoritative scorer:** `scoreStatsWithCategories(categories, rawStats, overrides)`
  in `lib/redraft/scoringEngine.ts`, fed by `calculateScoreFromSportConfig`
  (resolves league sport + `settings.sportConfig` → category list + overrides).
- Points = Σ over resolved categories of `value × (override ?? defaultPoints)`,
  with yardage-threshold **bonuses** (`minForBonus`, e.g. 300+ passing yards).
- **Starters only:** `isScoringStarterSlot` excludes `bench`/`BN`/`IR`/`taxi`/
  `devy`/`reserve`. Bench/IR/taxi/devy points never reach the matchup score.
- **Presets:** PPR = 1.0, Half = 0.5, Standard = 0.0 reception points (unless a
  `categoryPoints.rec` override is present, which always wins).
- **Passing TD value:** default 4; a `categoryPoints.pass_td = 6` override yields
  6-pt passing TDs.
- **TE Premium:** when `enableTEPremium` is on, the `te_premium` category adds
  `0.5 × te_premium` stat. ⚠️ Requires the stat pipeline to emit a `te_premium`
  count per TE reception (data-mapping dependency).
- **Negative scoring:** interceptions thrown (−2), fumbles lost (−2) reduce the
  total; the engine supports arbitrary negative category points.
- **Live vs final:** a matchup is `final` only when every starter has a
  `PlayerWeeklyScore` row AND all are `isFinalized`. Missing scores keep the
  matchup `active` and exclude it from standings (no fake 0-0).
- **Idempotency:** `recalculateMatchupsForSeasonWeek` overwrites (not accumulates)
  matchup scores; `updateStandings` recomputes from scratch each run. Re-running
  the score cron never double-counts.

## 6. Draft behavior

- Live draft persists `DraftPick` rows; `syncCompletedDraftToRedraftSeason`
  bridges them into redraft tables **only when the draft is `completed`**.
- **Single ownership:** each pick maps to exactly one `RedraftRosterPlayer`;
  empty/auto picks are skipped (`isDraftPickRowEmpty`). A stable player id is
  derived for picks lacking a canonical id.
- **Idempotent:** re-running the bridge does not duplicate active roster players
  (`droppedAt: null` existence check) and does not recreate rosters/schedule.
- **Undrafted players** are simply absent from any roster → available to waivers/FA.
- Roster slot assignment is inferred from the draft's lineup sections, defaulting
  to `bench`.

## 7. Waiver behavior

- Claims (`RedraftWaiverClaim`) are submitted with optional FAAB `bidAmount`,
  `priority`, and an optional `dropPlayerId`.
- **Resolution order (`compareWaiverClaims`, mirrored in the DB query):**
  1. higher FAAB bid (null bid treated as 0 → ranks last);
  2. lower priority number;
  3. earlier submission;
  4. stable claim id (total order → deterministic re-runs).
- **Atomic settlement:** drop + add + approve + FAAB deduction run in one
  `prisma.$transaction`. A failed/inactive drop denies the claim with **no
  partial application** (`WaiverDropInactiveError`).
- **FAAB:** insufficient balance → denied; on success balance decremented (floored
  at 0). **Priority:** winning roster moves to the back of the order.
- **Already-rostered guard:** a player already active in the season (any roster)
  is rejected; a player won earlier in the same run is rejected.
- **Free agency / continuous waivers / per-league windows:** see Known Gaps.

## 8. Trade behavior

- Modes via `RedraftTradeProposal.vetoMode`: instant accept (receiver accepts),
  commissioner review (`commissioner_approve/veto`), league vote
  (`vote_approve/veto` with `vetoThreshold`).
- **Concurrency guard:** acceptance settles inside a transaction that first
  conditionally claims the proposal (`updateMany where status='pending'`). Only
  one of two racing finalizers wins; the loser returns
  `PROPOSAL_ALREADY_RESOLVED` (no double settlement).
- Settlement moves `RedraftRosterPlayer` rows + transfers FAAB and IDP cap
  salaries atomically with the status flip.
- Expired proposals auto-transition to `expired` on next action.

## 9. Playoff behavior

- **Seeding:** rosters ordered by wins, then points-for (then points-against in the
  generate route). Top N seeded into a power-of-two bracket with byes for the top
  seeds; standard 1vN / 2v(N−1) pairing.
- **Advancement (`advancePlayoffWinners`):** idempotent; resolves winners from
  scores, auto-advances byes, fills next-round slots, activates the next round
  when the current one is fully resolved. Exact ties with no seed tiebreaker are
  reported in `blocked` for commissioner resolution.
- **Champion (`finalizeRedraftSeasonChampion`):** crowns the winner of the
  no-`nextMatchupId` final matchup, upserts `LeagueChampionship` (unique on
  `leagueId+season`), marks season + bracket `complete`, sets league lifecycle
  `completed`. Idempotent: a finalized season returns `already_finalized`.
- **Status strings** must match DB CHECK constraints: matchup resolved → `final`
  (or `bye`); round complete → `completed`.

### Lineup locking (G1 — implemented)

`lib/redraft/lineupLock.ts` derives the lock at request time from the real game
schedule (`SportsGame`, UTC kickoffs, NFL abbreviations) — `isLocked` is **not** a
flag a cron must remember to set, so it can never be stale or forgotten:

- **`per_player_kickoff`** (default): a player locks once their team's game
  kickoff has passed. Thursday players lock Thursday while Sunday players stay
  movable. London / international / Thanksgiving / Christmas kickoffs need no
  special-casing — they're just different UTC timestamps.
- **`first_game_of_week`**: the whole lineup locks at the week's earliest kickoff.
- **`manual`**: locked only when the commissioner locks the week.
- **Bye / no game / unresolved team:** fail-open (not locked) so a legitimate edit
  is never wrongly blocked; a `dataWarning` is surfaced when the schedule is
  missing.
- **Emergency commissioner unlock:** `POST /api/redraft/lineup-lock` (commissioner
  only) sets mode, manual-locks a week, or emergency-unlocks a roster/player; the
  override always wins (postponements, data errors). Roster-scoped changes are
  audited to `RedraftLeagueTransaction`.
- **Enforcement:** roster `GET` stamps derived `isLocked` for display; roster
  `PATCH` stamps it before `validateRedraftLineup`, which rejects moving a locked
  player. Verified end-to-end vs staging (engine E2E L1–L3).

## 10. Live scoring behavior (current state)

- **Today: cron polling, not real-time.** `GET /api/redraft/score-sync` runs on a
  Vercel cron every **5 minutes** (`vercel.json`). Each run: sync NFL weekly
  cached stats → recalc matchups → update standings, isolating per-season failures.
- There is **no 30-second live scoring** — no streaming/websocket/SSE push, no
  30s polling worker, no live-score cache table. The `stream/[seasonId]` route is
  a request/response roster read, not a live channel.
- **Why cron is insufficient for 30s:** Vercel cron granularity is 1 minute
  minimum (and throttled on lower tiers); it cannot fire every 30 seconds, and
  fanning a full sync across all active seasons every 30s is not viable on cron.
- See **Part D** for the required architecture.

## 11. Known gaps

| # | Gap | Severity | Contract impact |
|---|---|---|---|
| ~~G1~~ | **RESOLVED — lineup lock wired.** `lib/redraft/lineupLock.ts` derives `isLocked` from the `SportsGame` schedule at request time; roster GET/PATCH enforce it; commissioner modes + emergency unlock honored. Verified vs staging (engine E2E 14/0/0). | ✅ Done | §10 lock guarantee now met. |
| G2 | **Waiver mode not honored.** Engine always runs FAAB+priority hybrid; `defaultWaiverType` (rolling / reverse-standings / FCFS) is defined in config but ignored. | Medium | §4/§7 commissioner waiver mode partial. |
| G3 | **No true live scoring (30s).** Cron-only at 5-min granularity. | Medium | §10 / Part D. |
| G4 | **NCAAF weekly stats not wired.** Scoring runner skips NCAAF with a dataWarning. | Medium (NCAAF only) | §3 — NCAAF live scoring is beta. |
| G5 | **Waiver windows / continuous waivers / explicit free-agency mode** not enforced per-league (single hourly cron). | Low/Med | §7 partial. |
| G6 | **Standings tiebreakers** are wins → PF → PA; no head-to-head or division tiebreakers. | Low | §9 acceptable; documented. |
| ~~G7~~ | **RESOLVED — TE Premium now works.** `applyTePremiumStat` injects `te_premium = receptions` for TEs only when enabled; was previously inert (normalizer never emitted the key). See `docs/redraft-commissioner-scoring-contract.md`. | ✅ Done | §5 honored. |
| G8 | **NFL team Defense/ST scoring missing** — no config categories + no team-defense stat pipeline; DEF starters score 0. | High | Most leagues start a DEF. |
| ~~G9~~ | **RESOLVED — return yards/TD scored.** Return TDs via `def_st_td`; added `def_kr_yd`/`def_pr_yd` (default 0, commissioner-enable) + Sleeper mapping + UI bridge. See `docs/redraft-commissioner-scoring-contract.md`. | ✅ Done | §5. |
| ~~G10~~ | **RESOLVED — lineup validation honors commissioner roster config.** `resolveRedraftRosterConfig` reads `settings.roster.config.sections[].slots` → starter capacities (SF/FLEX/K/counts) + flex eligibility + bench/IR/taxi limits + max roster size; roster GET/PATCH pass it to `validateRedraftLineup` (static defaults as fallback). See `docs/redraft-commissioner-scoring-contract.md`. | ✅ Done | §4 roster config. |

## 12. Required tests before launch

**Implemented (pure, DB-free) — `__tests__/redraft/season-rules-contract.test.ts`:**
- Scoring: PPR/Half/Standard; 4 vs 6 pt passing TD; TE premium toggle; negative
  turnovers; yardage + 300-yd bonus; starter-only (bench/IR/taxi/devy/reserve
  excluded).
- Lineup locks: locked player cannot move; unlocked can; validation flags a
  locked slot change.
- Playoffs: seed order (wins→PF), 1v4/2v3 pairing, odd-team bye.
- Waivers: FAAB-first, null-bid-last, priority/time/id tiebreaks, total order.
- NCAAF data honesty: NFL processed, NCAAF skipped with explicit dataWarning.

**Implemented (DB-backed) — `scripts/run-nfl-full-season-engine-e2e.ts`:**
- Single ownership, weekly scoring → standings accumulation, waiver add+drop+FAAB,
  trade race guard, playoff advance → champion crowned + season complete,
  idempotent re-finalize, cascade cleanup.

**Implemented (lineup locks) — `__tests__/redraft/lineup-lock-engine.test.ts`:**
- Lock modes (per-player / first-game / manual), Thursday vs Sunday, London/
  early kickoffs, bye fail-open, emergency unlock wins, settings parsing, team
  normalization. DB join + emergency unlock verified vs staging (engine E2E L1–L3).

**Still required before declaring NFL "true season" complete:**
- T2 (G2): waiver-mode resolution tests once modes are honored.
- T3: draft-finalization idempotency + roster-settings-satisfied test at the DB
  level (currently asserted structurally, not via a seeded full draft).
- T4 (G3): live-score cache + freshness-warning tests once Part D lands.

---

## Part D — Live scoring architecture (decision + plan)

**Decision:** True 30-second live scoring does **not** exist today and should
**not** be force-fit onto Vercel cron. Implementing it fully is out of scope for
this phase (not small/safe). This section defines the target architecture and the
exact missing pieces so it can be built deliberately.

### Target architecture

1. **Live provider adapter** — `lib/redraft/live/<provider>Adapter.ts` exposing
   `fetchLiveStats(sport, week, gameIds)` with timeouts + typed errors. Wraps the
   real-time stats provider (e.g. Rolling Insights live endpoints).
2. **30-second polling worker** — a long-running worker **outside Vercel cron**
   (e.g. a Railway/Fly worker, or a queue-driven consumer). It polls only the
   *active game window* (kickoff → final), not 24/7, and writes to the cache.
3. **Live-score cache table** — `LivePlayerScore` (playerId, sport, week, season,
   stats Json, source, fetchedAt, isFinal) or a Redis-like cache. The matchup
   endpoint reads cache, never the provider directly.
4. **Matchup live-score endpoint** — `GET /api/redraft/matchup/live?matchupId=…`
   computes live fantasy points from the cache via `scoreStatsWithCategories`
   (reuse the authoritative scorer) and returns `dataAsOf` + freshness.
5. **UI polling or realtime channel** — client polls the live endpoint every
   ~20–30s during games, or subscribes to an SSE/websocket fanned from the worker.
6. **Finalization job** — when the provider marks a game final, write
   `PlayerWeeklyScore.isFinalized=true` and let the existing 5-min `score-sync`
   lock standings (no change to the final path).
7. **Freshness warnings + fallback** — every live response carries `dataAsOf`;
   stale (> N seconds) or provider-timeout responses fall back to the **last known
   cached score** and surface a `dataWarning` rather than zeros.

### Exact missing code

- `lib/redraft/live/liveProviderAdapter.ts` (provider fetch + timeout handling).
- `LivePlayerScore` Prisma model + additive migration (or a Redis cache client).
- The polling worker process + its deployment target (not Vercel cron).
- `app/api/redraft/matchup/live/route.ts` (cache-read + live scoring + freshness).
- Client polling/subscription in the matchup UI.
- Reuse (no new code): `scoreStatsWithCategories` for the live math, the existing
  `score-sync` finalization path for lock-in.

Until this lands, the platform is **honest cron-based scoring at 5-minute
granularity**, which is acceptable for launch with the data-freshness caveat
surfaced in the UI — but it is **not** 30-second live scoring.
