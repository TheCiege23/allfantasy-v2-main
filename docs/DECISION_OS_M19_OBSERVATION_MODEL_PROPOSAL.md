# Proposal (rev 2) — `TeamWindowObservation`

**STATUS: PROPOSAL ONLY. NOTHING IMPLEMENTED, MIGRATED OR APPLIED.**

Implementation is gated on `prisma/schema.prisma` being released by its current owner.
Checked 2026-09-09 16:31: the file carries **42 uncommitted insertions**, four `codex.exe`
processes are live, and repo source files were written at 16:28 — three minutes prior. The
gate is therefore **not** satisfied, and this revision stops before implementation as
instructed.

Revision 1 proposed a naive `@@unique([leagueId, teamId, season, week])` written by
whichever request arrived first. Both halves of that were wrong, and are corrected here.

---

## 0. A blocking dependency that must be resolved before the checkpoint can be honest

The checkpoint is specified to run *after* the matchup, forecast, dynasty and injury
refreshes. **Two of those four refreshes do not exist.**

| Input | Producer | Scheduled? |
| --- | --- | --- |
| `WeeklyMatchup` | `/api/cron/import-scores` | ✅ yes |
| `SportsPlayer` injury status | `/api/cron/import-injuries` | ✅ yes |
| `SeasonForecastSnapshot` | `runSeasonForecast` | ❌ **request-triggered only** — `app/api/leagues/[leagueId]/season-forecast/handler.ts` and `SeasonSimulator` |
| `DynastyProjectionSnapshot` | `generateDynastyProjection` | ❌ **request-triggered only** — `app/api/leagues/[leagueId]/dynasty-projections/handler.ts` |

Censused across `@/lib/...`, relative, dynamic and `require` forms. No cron route writes
either snapshot.

**Consequence.** A forecast or dynasty row exists only for a league whose page somebody
happened to open. A weekly checkpoint that "waits for the forecast refresh" would wait for
an event that never fires, and would then either defer forever or record a stale row while
reporting itself healthy. This repo has paid for that shape before — `ingestCFBDStats`
existed for months with no scheduled caller, and the surface reading its table failed
silently while looking correct.

**Two acceptable resolutions, and the choice is the product owner's:**

1. **Schedule the producers first** (recommended). Add cron writers for
   `SeasonForecastSnapshot` and `DynastyProjectionSnapshot`, then build the window
   checkpoint downstream of them. Correct, and the larger piece of work.
2. **Let the checkpoint own its inputs.** The checkpoint invokes `runSeasonForecast` and
   `generateDynastyProjection` for each eligible league before resolving. Self-contained,
   but it makes the window checkpoint responsible for two subsystems it does not own, and
   the simulation cost lands in its runtime budget.

Until one is chosen, the checkpoint below **defers** (does not refuse, does not invent) for
any league lacking a fresh forecast or projection, and reports the deferral count. That is
correct behaviour and it is also why milestone 19 will show low accepted-observation
coverage on day one.

---

## 1. Product policy — disclosed provisional rollout

| Stage | `decisionState` | Shown in Decision OS / Chimmy | Automatic team-fit |
| --- | --- | --- | --- |
| First valid observation | `provisional` | ✅ yes, labelled provisional | **neutral** |
| 2 compatible consecutive periods | `provisional` | ✅ yes | **neutral** |
| 3 compatible consecutive periods, material change | `evidenced` (settled) | ✅ yes | **applied** |
| Settled window, this period disagrees | `held` | ✅ yes, with the pending proposal | applied from the *settled* window |
| Required evidence missing or stale | `refused` | ✅ gaps named | **neutral** |

The first observation is evidence-backed and may be explained immediately; it must never be
rendered or serialized in a way that implies the three-period requirement has been met.
`provisional` is a distinct state, not a flag on `evidenced`, precisely so a consumer cannot
ignore it by omission.

On settlement, Chimmy explains the evidence and **asks** whether the user's chosen strategy
should change. It never changes it.

### User strategy stays separate

An explicitly selected strategy lives in `DecisionStrategyState` (existing, already durable
and owner-scoped) and may influence personalization **immediately**. It is a declared
preference. The window is an objective observation. They are different kinds of thing and
must be separately labelled everywhere they surface:

```ts
personalization: {
  objectiveWindow: { status, decisionState, source: 'team-window-observation' } | null
  declaredStrategy: { strategy, source: 'user-confirmed', confirmedAt } | null
}
```

Never merge them into one "strategy" field. A user who declared *rebuild* while the
objective window says *contender* is a real and interesting state; collapsing it destroys
the only signal that would let Chimmy raise it.

---

## 2. Scheduled checkpoint, and supported sports

**Milestone 19 v1 is NFL-only. Every other sport is rejected honestly**, with gap
`sport_not_supported_for_window`, rather than being scored with NFL assumptions.

That is not a convenience: `LongTermStrengthEstimator` normalizes against NFL-shaped roster
value, `PlayoffOddsCalculator` simulates an NFL-style weekly head-to-head schedule, and the
period model below is weeks. None of that transfers unexamined to a daily-scoring sport.

| Sport | Period model | Checkpoint | Status |
| --- | --- | --- | --- |
| NFL | `week`, ordinal 1–18 | Tuesday 08:00 ET, after `import-scores` closes Monday night | **supported in v1** |
| NBA / NHL / MLB | daily scoring, no natural weekly close | — | rejected; needs its own period model |
| NCAAFB / NCAABB | week-like but different close | — | rejected |
| Soccer | matchweek, competition-dependent | — | rejected |

The checkpoint runs **once per completed NFL week**, after the last Monday game is final and
after the injury refresh. It is `checkpointType: 'weekly_close'`. A live user request may
compute a `provisional` proposal at any time, but a request-computed result is **never**
written as an accepted observation — that is the whole point of correction 1.

A second checkpoint type, `backfill_correction`, exists for a late source correction
(a replayed stat correction landing after the weekly close). No other type is permitted in v1.

---

## 3. The accepted-observation key, and why the naive one was wrong

Revision 1's `@@unique([leagueId, teamId, season, week])` fails in two ways:

- An early incomplete attempt takes the week **permanently**. A checkpoint that ran before
  the forecast landed would own week 7 forever.
- A new resolver contract **cannot record the same period at all**, so a coefficient change
  can never be evaluated against history.

### The design

```sql
-- At most one ACCEPTED observation per team, period and resolver contract.
CREATE UNIQUE INDEX "uniq_twobs_accepted"
  ON "team_window_observations"
     ("league_id", "team_id", "season", "period_type", "period_ordinal", "resolver_contract")
  WHERE "lifecycle" = 'accepted';
```

A **partial** unique index. Postgres enforces it; Prisma cannot express it in the schema
DSL, so it is created in the migration SQL and documented here. That is deliberate and must
not be "simplified" into a plain `@@unique` later.

- **Attempts that fail never enter this table.** A checkpoint that defers or refuses writes
  a `SyncJobRun` row (`jobName: 'decision-os-window-checkpoint'`, existing model, already
  carries `rowsRead`/`rowsWritten`/`rowsSkipped`/`metadata`/`errorMessage`). Telemetry is
  where a failure belongs; it does not occupy the accepted key.
- **Corrections append.** A `backfill_correction` inserts a new row with
  `supersedesObservationId` pointing at the prior accepted row, and flips that row's
  `lifecycle` to `superseded` in the same transaction. The partial index permits this
  because only one row is `accepted` at any instant.
- **Rows are immutable except for one tombstone flip.** `lifecycle` (`accepted` →
  `superseded`) and `supersededAt` are the only columns any update may touch. The facts
  payload is never rewritten. Enforce in the repository layer and state it in the model doc;
  a trigger is available if the team wants it enforced in the database.
- **Idempotency.** `inputsHash` is a stable SHA-256 over the canonicalized resolver inputs
  plus both versions. Concurrent checkpoint runs use
  `INSERT ... ON CONFLICT DO NOTHING` against the partial index, so the loser is a no-op
  rather than a duplicate or an error. A re-run with an identical hash is a proven no-op; a
  re-run with a *different* hash for an already-accepted period is a **detectable anomaly**
  and is logged rather than silently written.

**Repeat page visits cannot advance anything**, because a page visit does not write here at
all. That is now structural, not a rule someone has to remember.

---

## 4. Resolver-version transition policy

Two versions are stored and both are queryable:

- `resolverVersion` — the algorithm (`window-resolver-1`).
- `coefficientsVersion` — the tuned constants (`window-structural-1`).
- `resolverContract` — the concatenation, and the value that participates in the accepted
  key.

**Policy: a change to either version resets the persistence count.** Observations from
different contracts are **never** compared. Hysteresis counts consecutive periods *within a
single `resolverContract`*; a contract change starts a fresh chain, and every decision made
during the rebuild window reports `decisionState: 'provisional'` with gap
`resolver_contract_changed_persistence_reset`.

This is the conservative branch of the two the brief allows. The alternative — a documented
compatibility matrix declaring some version pairs comparable — is deferred, because
declaring two coefficient sets "compatible" is exactly the kind of assertion that needs
calibration evidence that does not yet exist. Revisit at milestone 43.

⚠ The reset must be **tested**, not assumed: a resolver bump on the eve of settlement must
demonstrably produce `provisional`, not `evidenced`.

---

## 5. Identity, relations and delete behaviour

```prisma
leagueId    String  // → League.id
league      League     @relation(fields: [leagueId], references: [id], onDelete: Cascade)
teamId      String  // → LeagueTeam.externalId within the league
```

- **`League` relation: `onDelete: Cascade`.** An observation about a deleted league is not
  evidence of anything, and `LeagueTeam` already cascades from `League`.
- **`LeagueTeam`: no foreign key.** `LeagueTeam`'s natural key here is
  `(leagueId, externalId)`, which is not its primary key, so a real FK would require a
  compound unique that does not exist today. Adding one touches an existing table and is out
  of scope for an additive migration. The team id is stored and **validated server-side at
  write time** instead; the tradeoff is recorded rather than hidden.

Every identity field is resolved **server-side** from the authorized league:

| Field | Server-side source |
| --- | --- |
| `leagueId` | the authorized `League.id` |
| `platform` | `League.platform` |
| `platformLeagueId` | `League.platformLeagueId` |
| `sport` | league sport, validated against the supported list |
| `teamId` | `LeagueTeam.externalId`, verified to belong to that league |
| `sourceRosterId` | the provider roster/franchise id as imported |
| `season`, `periodType`, `periodOrdinal` | league season + resolved scoring period |

🛑 **A browser-supplied platform id or roster id is never authoritative.** The service
accepts a league id and an authenticated session, and derives the rest. This matters
concretely: `WeeklyMatchup.leagueId` holds the *platform* id, so a caller that could supply
it directly could read another league's matchups.

`periodType` + `periodOrdinal` replace a bare `week` so a future sport with a different
period model is representable without a migration — while v1 still rejects those sports.

---

## 6. Lossless facts payload

Queryable **columns** for identity, lifecycle, status, versions, period, scores and
confidence. A versioned **JSON** payload for the full input set, with a TypeScript schema
validated at both read and write boundaries.

```ts
export const WINDOW_FACTS_SCHEMA_VERSION = 1 as const

export interface TeamWindowObservationFactsV1 {
  schemaVersion: typeof WINDOW_FACTS_SCHEMA_VERSION
  record: { wins: number; losses: number; ties: number; pointsFor: number; pointsAgainst: number | null }
  allPlay: { wins: number; losses: number; ties: number; rate: number; weeksCounted: number }
  earned: { luckWins: number; adjustedWinRate: number }
  forecast: { playoffProbabilityPct: number; snapshotId: string | null; generatedAt: string | null; periodOrdinal: number }
  dynasty: {
    strengthNextYearPct: number | null
    strength3YearsPct: number
    strength5YearsPct: number | null
    confidencePct: number | null
    windowStartYear: number | null
    windowEndYear: number | null
    pickCapitalIncluded: true          // literal: the snapshot always contains it
    snapshotId: string | null
    generatedAt: string | null
  }
  injuries: {
    unavailableCount: number
    coveredCount: number
    rosterCount: number
    unavailableShare: number
    coverage: number
    basis: string
    treatment: 'excluded' | 'included-in-playoff-probability'
  }
  roster: { playerIdCount: number; identitySource: string }
  gaps: string[]
  coefficients: Record<string, number | string>   // the full set actually used
}
```

Counts are stored alongside shares, so a share can be re-derived and audited rather than
trusted. **Snapshot IDs are stored, not only timestamps** — `SeasonForecastSnapshot.id` and
`DynastyProjectionSnapshot.id` both exist and pin the exact row that was read.
`pickCapitalIncluded` is a literal `true` because `DynastyProjectionEngine.projectTeam`
calls `estimateLongTermStrength(rosterValue, pickValue, ctx)`; recording it keeps the
double-count protection auditable after the fact.

---

## 7. Constrained statuses

Postgres `CHECK` constraints plus TypeScript unions at every boundary. (Check constraints
rather than native enums: additive, and reversible without a type migration.)

| Field | Permitted values |
| --- | --- |
| `windowStatus` | `contender`, `rising`, `competitive`, `declining`, `rebuilding` |
| `decisionState` | `provisional`, `evidenced`, `held`, `refused` |
| `lifecycle` | `accepted`, `superseded` |
| `pickTreatment` | `included-in-roster-strength`, `separate` |
| `injuryTreatment` | `included-in-playoff-probability`, `excluded` |
| `checkpointType` | `weekly_close`, `backfill_correction` |
| `periodType` | `week` (v1) |

---

## 8. Current evidence never rewrites settled history

Stored observations are read-only inputs to hysteresis. A projection or injury landing today
changes **only** today's provisional `observedStatus`; W-1 and W-2 are read from their rows
exactly as captured.

**Missing-period policy — pause, do not bridge.** If period W-1 has no accepted observation,
the chain from W-2 does **not** connect to W. The count pauses and resumes; it never treats
absence as agreement. A gap of more than two consecutive missing periods resets the chain
entirely and reports `window_history_gap_reset`. This is an explicit policy and must be
tested in all three shapes: no gap, one-period gap, three-period gap.

---

## 9. Scheduled writer

`/api/cron/decision-os-window-checkpoint`, one `SyncJobRun` per invocation.

- Enumerates eligible leagues by sport + season + completed period, over a **resumable
  cursor** with a bounded runtime, inside the repo's shared run budget.
- Resolves every identity server-side (§5).
- **Defers** a league whose forecast or dynasty snapshot is missing or stale — see §0.
- **Refuses** a league whose facts resolve but fail the gates (coverage floor, unit range).
- Inserts at most one accepted observation per team per period per contract, via
  `ON CONFLICT DO NOTHING` on the partial index, so concurrent runs cannot duplicate.
- **No provider call inside a database transaction.** Facts are assembled first; the
  transaction covers the insert and any supersede flip only.
- Reports `processed`, `accepted`, `deferred`, `refused`, `failed` into
  `SyncJobRun.metadata`, with `rowsWritten` = accepted.

---

## 10. Reader and consumer

`resolveWindowDecision` stops reconstructing prior periods. For a live request it:

1. computes **current provisional evidence** from live facts;
2. reads **prior accepted observations** for the same `resolverContract`;
3. resolves `provisional` / `evidenced` / `held` / `refused`;
4. leaves **market value untouched**;
5. applies objective team-fit **only** once the settlement contract is met — otherwise
   neutral;
6. applies declared user strategy **separately and labelled** (§1);
7. resolves each side of a trade independently;
8. runs **once per team per request**, never per asset — currently pinned at 15 reads per
   team, and the stored-observation reader should lower that.

Production consumer path is unchanged: `buildValueV2Shadow`, reached from
`lib/trade-value/snapshot.ts` and the Trade Value Console, with `teamWindowV2` supplied by
the caller that holds the authorized league context.

---

## 11. Migration, rollback, volume, retention

**Additive only.** New table, new indexes, new check constraints. No column altered, no row
written, **no backfill**. Placed in `prisma/migrations-pending/` per the repository's pending
workflow — the same folder that already holds the `rosterId` migration — and **not applied
to production**.

Historical observations cannot be recreated honestly: the injury load and dynasty projection
for a past week no longer exist, which is exactly why reconstruction is being removed.
Synthesising them would launder that guess into a table that looks authoritative.

**Rollback:** `DROP TABLE "team_window_observations" CASCADE;` — safe because nothing else
references it and no existing table is modified. Consumers fall back to neutral team-fit,
which is the documented refusal behaviour, so a rollback degrades honestly rather than
breaking a surface.

**Row volume.**

```
rows/season = leagues × teams/league × periods/season × contracts
```

For NFL v1: 18 regular-season periods, 1 contract, ~12 teams/league.
Per league-season: **~216 rows**. At 1,000 leagues that is ~216k rows/season; at 10,000
leagues, ~2.16M. A row is a few hundred bytes plus the facts JSON, so ~1 KB is a safe
planning figure — order 0.2 GB per 1,000 leagues per season.

⚠ **The league count is deliberately not asserted here.** Obtaining it requires a production
read, which is out of scope; the formula and the per-league figure are exact, and the
multiplier must be filled in from a production count before deployment.

**Retention: keep everything for now.** These rows *are* the evidence base for milestones
40–44 (multi-horizon outcomes, backtests, calibration). Deleting them to save space would
delete the training corpus. Revisit only with product approval and a stated horizon; a
`superseded` row is history too and must not be pruned as "duplicate".

---

## 12. What is still blocked

- **Implementation**, on the schema owner releasing `prisma/schema.prisma`.
- **The checkpoint's correctness**, on §0 — two of its four upstream refreshes do not exist.
- The production caller, on the same shared-foundation boundary as before.

Nothing in this document has been implemented, migrated, applied, or deployed.
