# AF — from ingested data to a decision a manager can act on

Scoped 2026-08-11. Every count below was **measured against production**, not inferred.

The providers are healthy and the inputs are landing. Three build steps sit between that data and
a manager actually making a better decision. This scopes all three.

**Motivating scenarios** (the acceptance bar, not hypotheticals):

- **A. Sunday 12:05pm ET** — a starter is ruled OUT, kickoff is 1:00pm. Tell the manager *which*
  platform/league/team, his current slot, and what to do about it.
- **B. Trade viability** — assess a 2+ manager trade using each manager's trade psychology, player
  values, team needs and league settings.

Today: **A fails at notify and recommend. B fails at psychology and needs.**

---

## Current capability, traced end to end

| Scenario A step | Status | Backing |
|---|---|---|
| Know the player is OUT | ✅ | `sportsInjury` 3,892 rows, refreshed `*/15`, measured 0.27h fresh |
| Which platform / league / team | ✅ | `crossLeaguePlayerPortfolio` spans imported leagues |
| Starter / bench / IR | ✅ | `RosterStatus` = starter/bench/ir/taxi/reserve, from Sleeper `starters`/`players` |
| **Notify the manager** | ❌ | no scheduler, no transport — §1 |
| **Recommend swap or waiver add** | ❌ | projections are seed fixtures — §2 |

| Scenario B input | Status | Backing |
|---|---|---|
| League settings | ✅ | available |
| Player values | ✅ | FantasyCalc (live external) |
| Team needs | ⚠️ | rosters known; ranking "need" requires projections — §2 |
| **Manager trade psychology** | ❌ | `managerPsychProfile` 0 rows — §3 |

---

## §1 — Proactive alerting (unblocks scenario A's "notify")

### What already exists — more than expected

- `lib/chimmy-alerts/` is a complete engine: `ChimmyAlertDetectors`, `ChimmyAlertDeliveryRouter`,
  `ChimmyAlertSuppressionEngine`, `ChimmyAlertPreferencesService`.
- `hydrateSignalBundle()` and `loadActiveLeagueMembers()` already exist — the iteration scaffolding
  a scheduled sweep needs is written.
- Push transport exists: `WebPushSubscription` model, `lib/push-notifications/push-service.ts`,
  `app/api/push/subscribe/route.ts`.

### What is actually missing

1. **Nothing runs it on a schedule.** `runUnifiedAlertEngine` has exactly one caller:
   `app/api/ai/alerts/route.ts`, fetched by `components/chimmy-surfaces/ChimmyUnifiedAlertFeed.tsx`.
   No cron in `vercel.json`. The system is pull-only and can never reach a manager at 12:05.
2. **Nothing transmits.** `ChimmyAlertDeliveryRouter` computes channel labels including
   `push_notification`, `email`, `sms` — but a grep of the whole alert path for web-push / Resend /
   Twilio / any outbound fetch returns **zero**. Those are labels on an object.
3. **No injury signal is hydrated.** `hydrateSignalBundle` queries only `draftRoomStateRow`,
   `leagueStoryline` and `tradeOfferEvent`. It never sets `lineupIncomplete` or `lineupLockAt`, and
   there is no injury field at all — so even the detectors that exist cannot fire on this scenario.
4. **No injured-starter detector.** Detectors cover lineup / waiver / trade / draft. None keys on
   "rostered starter has an OUT designation before lock".
5. VAPID keys unset; `WebPushSubscription` = **0 rows**. No user has ever subscribed.

### Work

| # | Item | Notes |
|---|---|---|
| 1.1 | Hydrate injury + lineup signals | Join `sportsInjury` → portfolio `rosterStatus`; source `lineupLockAt` (see `AfLineupLockState`) |
| 1.2 | `detectInjuredStarterAlerts` | Fires on OUT/Doubtful in a **starter** slot inside the lock window |
| 1.3 | Scheduled sweep | Iterate via existing `loadActiveLeagueMembers`; **route budget is at Vercel's 2048 ceiling — use a query param on an existing route** (precedent: `import-news?full=1`) |
| 1.4 | Wire real transport | Connect `push-service` to the delivery router; set VAPID; add subscription opt-in UX |
| 1.5 | Cadence + suppression | Game-day tight (~5 min) inside the lock window, idle otherwise; `ChimmyAlertSuppressionEngine` already exists — use it |

### Acceptance
A test user with an OUT starter receives a push **before** lock naming the league, platform, slot,
and designation. Verified against a real league, not a fixture.

### Risks
- **Fan-out cost**: users × leagues × 5-min cadence. Scope the sweep to leagues with a lock in the
  next N minutes, not all leagues.
- **Notification spam is a product risk, not a technical one.** Suppression and preferences must be
  on from day one.
- Lock-time correctness across timezones and Sunday/Monday/Thursday slates.
- 20% of RI injury rows (63 of 311) carry designation prose we deliberately refuse to parse, so
  some genuinely-out players produce no status. Accept, or widen `parseInjuryDesignation` carefully.

### Estimate
Largest of the three. 1.1–1.3 are self-contained; **1.4 needs a product decision from you** on
channels (push only vs email/SMS) before it can be built.

---

## §2 — Projection engine (unblocks "recommend", and scenario B's "team needs")

Phase 2 of the existing `AF_PROJECTIONS_ENGINE_BRIEF.md`. **That brief's plan still stands** — this
section only records what changed now that Phase 1 has actually landed.

### Inputs now in production

| Input | State | Use |
|---|---|---|
| `fantasyStatLine` | **1,933 rows, 100% join-back** (loaded 2026-08-11) | prior-season production base |
| `playerGameStat` | 40,473 rows, 2025 weeks 1–18 | per-week recency weighting |
| `depthChart` | 1,708 rows | role / opportunity share |
| `sportsInjury` | 3,892, minutes fresh | availability |
| `sportsGame` | 4,283 | opponent, venue, timing |
| weather cache | live | `weatherAdjustment` |
| `AFProjectionSnapshot` | schema ready, 0 rows | output target |

### Shape facts discovered on load — read before writing the engine

- Rows are **`week = 0`, a season-aggregate sentinel**, not weekly. Weekly granularity lives in
  `playerGameStat`.
- `stats` is **nested**: `{ riTeam, position, riPlayerId, riPlayerName, regular_season: {...}, postseason }`.
  Components are under `regular_season`, not at the top level.
- ✅ `position` is present inside `stats` — `AFProjectionSnapshot.position` is required, and this
  satisfies it without another join.
- ✅ `games_played` is inside `regular_season` — per-game rates are directly computable.
- ⚠️ **`fantasyPointsByScoringPreset` is `{}` — empty on every row.** Nothing computes per-preset
  points yet. This is exactly the Phase 4 lever, and it is currently dead weight.
- ⚠️ `opponent` is null (a season aggregate has no opponent — expected, but don't read it).
- ⚠️ **Only 2025 exists.** No multi-year history for career-trend or dynasty-aging work.

### ⚠️ CORRECTION 2026-08-11 (after tracing the live read path) — a projection chain ALREADY EXISTS

My first draft of this section said the engine had to be built from scratch and should be read by
`replacementOptions` / `crossLeaguePlayerPortfolio`. **Both were wrong.** Tracing the actual
consumers found a real, well-built projection layer already in production:

`lib/sports-data-normalization/resolveNormalizedPlayerSportsProfiles.ts` produces
`NormalizedPlayerSportsProfile`, consumed through `lib/projection-engine/` (`effectiveFantasyPoints`,
`collectProjectionNotes`) by **start/sit, waivers, injury-impact and trade-value** today. Note this
is the directory `lib/projection-engine/`, NOT `lib/projections/projection-engine.ts` — the latter is
a 344-line class with **zero callers**. Do not extend the wrong one.

It already implements most of what this brief demanded:

- **Four-tier precedence with honest basis labels**: `weeklyFromDb` → `weeklyFromClearSports` →
  `riFppg` (`season_fppg_proxy`) → `dbFppg` (`season_avg_actual_proxy`), and the proxy tiers
  self-describe: *"Using Rolling Insights season fantasy points per game as a period proxy — not a
  provider weekly projection."*
- `confidenceFromSources()` — confidence already derived from which inputs were present.
- `adjustProjectionForLeagueScoring()` with a `draftkings_fppg` basis, plus weather and injury layers
  and a low/high range from volatility.

**Measured state of its inputs (production, NFL):**

| Tier | Source | State |
|---|---|---|
| 1 `weeklyFromDb` | `SportsPlayerRecord.projections` | **inert** — see below |
| 2 `weeklyFromClearSports` | ClearSports | dead (401 / TLS) |
| 3 `riFppg` | RI season FPPG | proxy, self-labelled |
| 4 `dbFppg` | `SportsPlayerRecord.stats` | 3,035 of 11,587 rows |

**The tier-1 finding, stated precisely.** 1,035 NFL rows have a non-empty `projections` value, and
its content is RI **historical season actuals** (`regular_season: {sacks, tackles, games_played…}`) —
completed results sitting in a field named `projections`, which tier 1 labels
`weekly_provider_projection`. That reads like an active fabrication, **but it is not**:
`extractProjectionPoints()` only inspects TOP-LEVEL keys (`fantasyPoints`, `points`, `pts`, …) and
the RI payload's top level is `team` / `player` / `player_id` / `regular_season`. It returns `null`,
so tier 1 never fires. **The field is inert, not lying.** Verify this before any refactor of
`extractNumeric.ts` — teaching that extractor to descend into `regular_season` would silently turn a
dormant field into last season's totals presented as this week's forecast, at the highest-confidence
basis. That is the single most dangerous edit in this area.

**So §2 is narrower than first scoped:** the work is to add `AFProjectionSnapshot` as a genuine
**tier 0** ahead of `weeklyFromDb`, replacing proxy-derived numbers with a real computed projection.
Every live consumer then inherits it through machinery that already exists. Do not build a parallel
read path.

### Additional measured constraint — the weekly input reaches only half the pool

`fantasyStatLine.playerId` is a canonical uuid; `playerGameStat.playerId` is a **Sleeper numeric id**;
`depthChart.players[].id` is an **RI id**. Bridging is `PlayerIdentityMap` (NFL, 1,933 rows):

- `rollingInsightsId` present: **1,933 / 1,933 (100%)** → stat lines join cleanly
- `sleeperId` present: **1,026 / 1,933 (53.1%)** → only half can reach weekly game logs

So recency weighting (2.2) is available for ~53% of players; the rest have the season aggregate only.
This is not a blocker — it is exactly what `confidenceLevel` must encode.

Useful shape facts: `playerGameStat.normalizedStatMap` already carries **`pts_ppr` and `pts_std`
precomputed**, plus `rec_tgt`, `rec_air_yd`, `rec_rz_tgt`, `off_snp`. NFL `depthChart` gives ordinal
role directly (`WR1`/`WR2`/`WR3`, `RB`, `QB`, `TE`) for 581 rows at season `"2026-2027"` — note that
season string format differs from `fantasyStatLine`'s `"2025"`.

### Work

| # | Item |
|---|---|
| 2.0 | ~~Delete the 43 `runtime-seed` rows~~ — **DONE 2026-08-11**, 43 deleted, backed up to scratchpad |
| 2.1 | Compute per-game rates: `regular_season` components ÷ `games_played` |
| 2.2 | Recency-weight against `playerGameStat` weekly rows |
| 2.3 | Apply role (`depthChart`), availability (`sportsInjury`), opponent/venue (`sportsGame`), weather |
| 2.4 | Write `AFProjectionSnapshot` with the brief's honesty rules: `confidenceLevel` derived from real input coverage, missing inputs **excluded not defaulted**, `adjustmentReason` naming actual adjustments, and **refuse to emit rather than emit a guess** |
| 2.5 | Read port: add `AFProjectionSnapshot` as **tier 0** in `resolveNormalizedPlayerSportsProfiles`, with its own `ProjectionBasis` (e.g. `af_engine`) so provenance stays visible. Every existing consumer inherits it. **Do not** build a parallel path through `replacementOptions` |
| 2.6 | Phase 4: score components per league rules (PPR / standard / TE-premium / superflex / **IDP**) |

### Acceptance
Taken from the existing brief: snapshots non-empty and advancing daily; Player Command Center shows
a real projection with a visible source label; `replacementOptions` returns ranked bench and
free-agent candidates in a live league; **IDP positions produce projections** (both live test
leagues are IDP dynasty); zero-row runs return `ok:false`.

### Risks
- Only one prior season means low confidence for rookies and role-changers. `confidenceLevel` must
  reflect that honestly rather than smoothing it over.
- 145 of 500 sampled rows carry offensive volume — plausible for skill-position share of a ~1,900
  player pool, but confirm before assuming QB/RB/WR/TE coverage is adequate.
- Phase 4 is where the real product differentiation is, and it is nearly free once 2.4 stores
  components rather than a scalar. Don't shortcut 2.4 into a single number.

---

## §3 — Manager psychology (unblocks scenario B) — **cheapest of the three**

### The engine is written; it has simply never been run

Present: `PsychologicalProfileEngine`, `BehaviorSignalAggregator`, `ProfileEvidenceBuilder`,
`ProfileLabelResolver`, `ManagerBehaviorQueryService`.

### The raw material already exists in production

| Table | Rows |
|---|---|
| `LeagueTrade` | **6,813** |
| `LeagueTradeHistory` | 1,760 (all `status=complete`) |
| `draftFact` | 32,173 |
| `rosterSnapshot` | 3,506 |

### What is empty

| Table | Rows | Why |
|---|---|---|
| `managerPsychProfile` | 0 | generation step never ran |
| `profileEvidenceRecord` | 0 | same |
| `transactionFact` | 0 | writers exist for **ESPN / Fantrax / MFL / Yahoo — but not Sleeper**, which is where the leagues are |

Also note: `LeagueTradeHistory.tradingStyle`, `favoriteTargets`, `avoidedAssets` are **0 populated**
across all 1,760 rows, and `tradesLoaded` / `totalTradesFound` sum to **0** while every row reads
`status = complete`. That is the same silent-success shape as the news cron — a completion flag
that means nothing was loaded. The 6,813 `LeagueTrade` rows landed by some other path.

### Work

| # | Item |
|---|---|
| 3.1 | Decide the source of truth: add a **Sleeper → `transactionFact`** writer, or point the engine at `LeagueTrade` directly. Prefer whichever avoids a second parallel history model |
| 3.2 | Profile generation job → `managerPsychProfile` + `profileEvidenceRecord` |
| 3.3 | Backfill from the existing 6,813 trades (no new ingestion required) |
| 3.4 | Populate the derived `LeagueTradeHistory` fields, or drop them if `managerPsychProfile` supersedes them — do not maintain both |
| 3.5 | Wire profiles into trade evaluation |

### Acceptance
Real profiles for the managers in the two live IDP dynasty leagues, each backed by
`profileEvidenceRecord` rows citing specific trades. **No profile without evidence** — an
unevidenced psychology label is a fabrication.

### Risks
- Small-sample managers. A profile from 3 trades must be labelled low-confidence or withheld.
- This is inference about **real people**. Labels are user-visible and should be defensible from
  cited trades, not vibes.

---

## Recommended sequence

1. **§2 projections** — unblocks the most surfaces at once (war room, AI Brain, Decision OS trade +
   lineup, Player Command Center replacements), and has no external dependency. Start with **2.0**,
   which is a one-line data fix for a live honesty bug.
2. **§3 psychology** — independent of §2 and the cheapest real win; the data is already sitting there.
   Can run in parallel.
3. **§1 alerting** — highest user-visible payoff but needs a product decision from you on channels,
   plus VAPID keys and subscription UX. Also the only one with recurring per-user cost.

§2 makes recommendations *correct*. §1 makes them *arrive*. Doing §1 first would deliver a
notification that says "your starter is OUT" with nothing to recommend.

---

## §4 — Immediate, unblocked by any of the above

**Delete the 43 `runtime-seed` rows in `fantasyProjection`.** They are season 2026 / week 6 / NFL,
with player ids (`rwr-member-qb-1`, …) that join to **neither** player table.

Because they exist, `replacementOptions` resolves a "latest projection week" of 6 for any NFL 2026
league and returns `projectionWeek: 6` with empty options — implying data exists. With the rows
gone it correctly returns `limitation: 'no_projection_data'`. One is a lie of omission; the other
is a refusal. Cheap fix, and it makes every downstream surface honest until §2 lands.
