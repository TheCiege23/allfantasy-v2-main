# Decision OS Milestone 19 — Checkpoint & Discovery Contract (FINAL V2)

**CONTRACT ONLY. NOTHING IMPLEMENTED, MIGRATED, DEPLOYED OR COMMITTED.**
No Prisma file, migration file or service was created or edited. `prisma/schema.prisma`
remains held by another session. **Milestone 19 progress remains 34%.**

**Self-contained.** Supersedes `DECISION_OS_M19_CHECKPOINT_CONTRACT_FINAL.md` in full, and
§8/§18.6 of the proposal plus §§1,4,5,6,7,8 of the errata. Where any disagree, **this wins**.
The proposal is still needed only for table definitions (§2, §13, §14) and the facts
contract (§3).

### Two arithmetic errors in V1, corrected here

- **`playoffStartWeek=15, playoffTeams=4, weeksPerRound=1` ends at week 16, not 17.**
  `ceil(log2(4)) = 2` rounds × 1 = 2 playoff weeks → periods 15, 16.
- **The V1 discovery fixture produced targets `3, 1, 1`**, which does not demonstrate three
  distinct targets. Fixture corrected in §7.

---

## 1. Invariants

1. A stale worker changes **nothing** — not checkpoint state, not one observation row.
2. No partial accepted period survives a rollback.
3. `ON CONFLICT DO NOTHING` is never used on observations unless the conflicting row has been
   **loaded and proven semantically identical**.
4. Advancement follows the **scheduled** period calendar, never the evidence that happens to
   exist. Week 4 never jumps to week 7.
5. A scheduled period with no evidence is targeted, deferred, and eventually closed by exactly
   one durable `SKIP` — then and only then does the checkpoint advance.
6. Schedule settings that are missing or invalid produce a **named refusal**, never `NaN`, an
   empty accidental schedule, or a guessed boundary.
7. Live and historical lanes own **disjoint** period ranges and can never write the same
   observation.
8. Roster-map integrity **fails closed**: SQL null semantics cannot let an empty or malformed
   map pass.
9. Every observation's team belongs to the same league, enforced by a **database** composite
   foreign key, not by application code.
10. Synthetic observations remain forbidden. Backfill from authoritative imported evidence is
    not synthetic; inventing an observation for a period with no settled finality is.

---

## 2. Schema changes this contract introduces

Beyond the four tables in proposal §13. All additive.

| # | Change | Why |
| --- | --- | --- |
| S-1 | `TeamWindowCheckpointState.processingLane VARCHAR(24) NOT NULL` | §4 — live and backfill cannot share one cursor |
| S-2 | `TeamWindowCheckpointState.laneCeilingPeriod INTEGER NULL` | Upper bound of a historical lane's ownership; NULL for `live` |
| S-3 | Replace `uniq_twcs_league_season_contract` with `uniq_twcs_league_season_contract_lane` on `(league_id, season, resolver_contract, processing_lane)` | Lane joins checkpoint identity |
| S-4 | `CHECK (processing_lane IN ('live','historical_backfill'))` | Bounded |
| S-5 | `CHECK ((processing_lane = 'live' AND lane_ceiling_period IS NULL) OR (processing_lane = 'historical_backfill' AND lane_ceiling_period IS NOT NULL))` | A backfill lane without a ceiling would race the live lane |
| S-6 | **`LeagueTeam`: `@@unique([id, leagueId], map: "uniq_league_team_id_league")`** | Candidate key for S-7. `id` is already `@id`, so this is a redundant-but-required unique; it costs one index and changes no behaviour |
| S-7 | **`TeamWindowObservation`: composite FK `(league_team_id, league_id)` → `LeagueTeam(id, league_id)`**, `ON DELETE RESTRICT` | §6 — a cross-league team becomes structurally impossible |
| S-8 | Index `(sport, season, resolver_contract, processing_lane, next_eligible_at)` | Claim ordering |

⚠ S-7 **replaces** the single-column `twobs_team_fk`. Keeping both would be redundant; the
composite subsumes it.

`TeamWindowPeriodOutcome` needs **no** lane column: lanes own disjoint periods (§4.3), so
`(league_id, season, period_type, period_ordinal, resolver_contract)` is still unique per
outcome. That disjointness is itself an invariant (§4.3) and is tested (§7 test 20).

---

## 3. Period calendar — schedule, not evidence

🛑 **V1 fed `scoredWeeks` into `nextExpectedPeriod`. That is the defect.** Advancing over the
weeks that happen to have evidence silently skips weeks 5–6 when they are missing, and
hysteresis then sees an unbroken run that never existed.

### 3.1 Three separate inputs

| Input | Meaning | Source |
| --- | --- | --- |
| `scheduledPeriods` | Every period the league's schedule defines, in order | Derived from `playoffStartWeek`, `playoffTeams`, `playoffWeeksPerRound` |
| `availableEvidencePeriods` | Periods with at least one scored `WeeklyMatchup` | `max(pointsFor) > 0` per week |
| `settledFinalityPeriods` | Periods with an accepted, settled `LeaguePeriodFinality` | `league_period_finality` |

**Advancement uses `scheduledPeriods` only.** The other two decide whether a targeted period
can be *observed*, never which period comes next.

```ts
export type ScheduleResolution =
  | { kind: 'schedule'; periods: readonly number[] }
  | { kind: 'refused'; reason: ScheduleRefusal }

export type ScheduleRefusal =
  | 'playoff_start_week_missing'      | 'playoff_start_week_out_of_range'
  | 'playoff_teams_missing'           | 'playoff_teams_out_of_range'
  | 'weeks_per_round_missing'         | 'weeks_per_round_out_of_range'
  | 'unsupported_bracket_structure'   | 'schedule_exceeds_period_bound'

export function resolveScheduledPeriods(input: {
  playoffStartWeek: number | null
  playoffTeams: number | null
  playoffWeeksPerRound: number | null
}): ScheduleResolution
```

### 3.2 Validation — every branch named, nothing guessed

| Rule | Refusal |
| --- | --- |
| `playoffStartWeek` null | `playoff_start_week_missing` |
| `playoffStartWeek` not an integer in **2..18** | `playoff_start_week_out_of_range` (week 1 cannot start playoffs: no regular season) |
| `playoffTeams` null | `playoff_teams_missing` |
| `playoffTeams` not an integer in **0..16** | `playoff_teams_out_of_range` |
| `playoffWeeksPerRound` null | `weeks_per_round_missing` |
| `playoffWeeksPerRound` not an integer in **1..3** | `weeks_per_round_out_of_range` |
| `playoffTeams` not a power of two **and** > 1 | `unsupported_bracket_structure` — byes and reseeding are not modelled in v1 |
| Last period > **25** (`twobs_ordinal_chk` bound) | `schedule_exceeds_period_bound` |

```
regularSeasonEnd = playoffStartWeek - 1
playoffRounds    = playoffTeams <= 1 ? 0 : log2(playoffTeams)      // exact, else refused
playoffWeeks     = playoffRounds * playoffWeeksPerRound
lastPeriod       = playoffWeeks === 0 ? regularSeasonEnd : playoffStartWeek + playoffWeeks - 1
scheduledPeriods = [1 .. lastPeriod]
```

**Zero/one-team playoffs** (`playoffTeams` 0 or 1) yield zero playoff weeks and the season
ends at `regularSeasonEnd` — a defined outcome, not a refusal.

Worked: `start=15, teams=4, wpr=1` → rounds 2, playoffWeeks 2, `lastPeriod = 16`,
`scheduledPeriods = [1..16]`.

### 3.3 Advancement

```ts
export function nextScheduledPeriod(
  scheduled: readonly number[], current: number | null,
): { kind: 'period'; periodOrdinal: number } | { kind: 'no_period' }
```

The **immediate successor in `scheduledPeriods`**. Never `current + 1`, never the next period
with evidence. When `current` is the last scheduled period → `no_period` → exhaustion.

---

## 4. Processing lanes

### 4.1 Identity

`(leagueId, season, resolverContract, processingLane)`. Every transition in §5 carries all
four.

| Lane | Owns | `laneCeilingPeriod` |
| --- | --- | --- |
| `live` | Periods **≥** `liveFloor` | NULL |
| `historical_backfill` | Periods **<** `liveFloor` | `liveFloor - 1` |

`liveFloor` is the live lane's initial target, fixed at discovery and never moved. Ownership
is therefore disjoint **by construction**, not by convention.

### 4.2 Live initialization — evidence-driven

```
scheduled  = resolveScheduledPeriods(...)            // refuse ⇒ no rows created
settleable = { p in scheduled : settleEligibleAt(p) <= now }
withEvidence = scheduled ∩ availableEvidencePeriods

liveFloor = the earliest p in (settleable ∩ withEvidence) such that
            |{ q in withEvidence : q <= p }| >= WINDOW_PERSISTENCE_WEEKS (3)
          ?? the earliest p in (settleable ∩ withEvidence)      // fewer than 3 available
          ?? the earliest p in scheduled                         // no evidence at all yet
```

The third fallback covers a preseason import: no evidence exists, so the live lane starts at
period 1 and simply defers until finality appears.

### 4.3 Historical lane

**Created by discovery**, automatically, whenever
`withEvidence ∩ { p : p < liveFloor }` is non-empty. No operator trigger — including for a
league imported after the season ended, which is precisely the case V1 got wrong by making it
optional.

- Initial target = the **earliest** period in `withEvidence` below `liveFloor`.
- Advances through `scheduledPeriods` like the live lane, but stops at `laneCeilingPeriod`.
- **Exhausted** when `nextScheduledPeriod` exceeds the ceiling, or returns `no_period`.
- Same defer/skip/complete contract; same finality gates; **no synthetic observations**.

**Claim priority — live first, always:**

```sql
ORDER BY (processing_lane = 'live') DESC, next_eligible_at NULLS FIRST
```

**Rate limiting:** the historical lane is claimed only with leftover batch budget
(`min(remainingBudget, HISTORICAL_MAX_PER_RUN = 5)`), so backfill can never starve the live
lane. Historical deferral backoff is 4× the live interval.

**Why the two lanes cannot write the same observation** — three independent reasons:

1. Disjoint ownership: live targets ≥ `liveFloor`, historical < `liveFloor`, ceiling enforced
   by S-5.
2. `uniq_twobs_accepted` permits one accepted row per `(league, team, period, contract)`
   regardless of lane.
3. §5.6 step (f) loads any conflicting row and proves it identical before proceeding.

**Multiple imported seasons:** discovery iterates `LeagueSeason` rows, so each
`(leagueId, season)` yields its own live lane and, where warranted, its own historical lane.
Seasons never share progress.

---

## 5. Canonical transitions

Order: **CLAIM → HEARTBEAT\* → (DEFER | FAIL | SKIP | COMPLETE) → RELEASE-on-abandon**.

| Affected rows | Meaning |
| --- | --- |
| 1 | Success |
| 0 | Lease lost, state changed, or stale worker. **Abandon; write nothing; report failure.** |
| >1 | Impossible under S-3. **Corruption: abort, alert, halt the worker.** |

Common identity predicate, written `IDENT` below:

```sql
league_id = $1 AND season = $2 AND resolver_contract = $3 AND processing_lane = $4
```

### 5.1 CLAIM (batch — the only transition that may affect ≠ 1 rows)

```sql
WITH claimed AS (
  SELECT id FROM team_window_checkpoint_states
   WHERE sport = $1 AND season = $2 AND resolver_contract = $3
     AND target_period_ordinal IS NOT NULL
     AND (lane_ceiling_period IS NULL OR target_period_ordinal <= lane_ceiling_period)
     AND (next_eligible_at IS NULL OR next_eligible_at <= timezone('UTC', CURRENT_TIMESTAMP))
     AND (lease_owner IS NULL OR lease_expires_at < timezone('UTC', CURRENT_TIMESTAMP))
   ORDER BY (processing_lane = 'live') DESC, next_eligible_at NULLS FIRST
   LIMIT $4
   FOR UPDATE SKIP LOCKED
)
UPDATE team_window_checkpoint_states t
   SET lease_owner = $5,
       lease_expires_at = timezone('UTC', CURRENT_TIMESTAMP) + INTERVAL '10 minutes',
       last_attempted_period = t.target_period_ordinal,
       last_attempted_at = timezone('UTC', CURRENT_TIMESTAMP),
       updated_at = timezone('UTC', CURRENT_TIMESTAMP)
  FROM claimed WHERE t.id = claimed.id
RETURNING t.id, t.league_id, t.season, t.resolver_contract, t.processing_lane,
          t.target_period_ordinal, t.lane_ceiling_period, t.lease_owner;
```

### 5.2 HEARTBEAT

```sql
UPDATE team_window_checkpoint_states
   SET lease_expires_at = timezone('UTC', CURRENT_TIMESTAMP) + INTERVAL '10 minutes',
       updated_at = timezone('UTC', CURRENT_TIMESTAMP)
 WHERE IDENT AND lease_owner = $5
   AND lease_expires_at > timezone('UTC', CURRENT_TIMESTAMP)
RETURNING id;   -- 0 ⇒ lease lost ⇒ abandon, write nothing
```

### 5.3 DEFER / 5.4 FAIL / 5.5 RELEASE

`DEFER` and `FAIL` are unchanged from the errata except that `IDENT` now includes
`processing_lane`, and both additionally require `target_period_ordinal = $N` (DEFER) and an
unexpired lease. All three end with `RETURNING id` and **must affect exactly 1 row**.
`RELEASE` matches the exact token but omits the expiry predicate — releasing a lease you still
own but which has expired is harmless and desirable.

### 5.6 COMPLETE — observations are inserted **inside** this transaction

🛑 **V1's COMPLETE only verified that observations existed; it never inserted them.** There was
no transaction in which a stale worker was prevented from writing them, because no step wrote
them at all.

**Outside the transaction:** claim, then assemble finality and the full precomputed
observation set. No writes, no provider I/O inside the transaction.

```sql
BEGIN;  -- short: verification + inserts only

-- (a) Serialize; target, lane, token and expiry must all still hold.
SELECT target_period_ordinal FROM team_window_checkpoint_states
 WHERE IDENT AND lease_owner = $5
   AND lease_expires_at > timezone('UTC', CURRENT_TIMESTAMP)
   AND target_period_ordinal = $6
   FOR UPDATE;
-- 0 rows -> ROLLBACK. A stale worker stops here, before any insert.

-- (b) Accepted + settled finality, pinned for this exact period.
SELECT id, roster_team_map, expected_roster_ids
  FROM league_period_finality
 WHERE id = $7 AND league_id = $1 AND season = $2
   AND period_type = 'week' AND period_ordinal = $6
   AND lifecycle = 'accepted' AND assessment_state = 'settled'
   FOR SHARE;
-- 0 rows -> ROLLBACK

-- (c) Pinned-map integrity, fail-closed (§6). -> ROLLBACK on any failure.

-- (d) Load ALL existing rows for this period/contract, both lifecycles, and lock them.
SELECT id, league_team_id, lifecycle, idempotency_key, content_hash
  FROM team_window_observations
 WHERE league_id = $1 AND season = $2 AND period_type = 'week'
   AND period_ordinal = $6 AND resolver_contract = $3
   FOR UPDATE;

-- (e) Classify in application code against the precomputed set. See the table below.

-- (f) Insert ONLY the genuinely missing rows, with a plain INSERT.
--     No ON CONFLICT: step (d) already established what exists under this lock, so a
--     conflict here is a real race and MUST raise rather than be swallowed.
INSERT INTO team_window_observations (...) VALUES (...);

-- (g) Re-read and assert set equality against the PINNED expected team set.
SELECT array_agg(league_team_id ORDER BY league_team_id)
  FROM team_window_observations
 WHERE league_id = $1 AND season = $2 AND period_type = 'week'
   AND period_ordinal = $6 AND resolver_contract = $3 AND lifecycle = 'accepted';
-- <> pinned expected team set -> ROLLBACK

-- (h) Advance or exhaust, re-checking identity, token, expiry and target in the predicate.
UPDATE team_window_checkpoint_states
   SET last_completed_period = $6,
       last_completed_at     = timezone('UTC', CURRENT_TIMESTAMP),
       target_period_ordinal = $8,     -- NULL ⇒ exhausted
       next_eligible_at      = $9,     -- NULL when $8 IS NULL
       deferral_first_at = NULL, deferral_attempts = 0, last_deferred_reason = NULL,
       consecutive_failures = 0, last_error_category = NULL,
       lease_owner = NULL, lease_expires_at = NULL,
       updated_at = timezone('UTC', CURRENT_TIMESTAMP)
 WHERE IDENT AND lease_owner = $5
   AND lease_expires_at > timezone('UTC', CURRENT_TIMESTAMP)
   AND target_period_ordinal = $6
RETURNING id;
-- <> 1 -> ROLLBACK  (inserts from (f) are discarded with it)

COMMIT;
```

**Step (e) — the seven cases, exhaustively:**

| Existing state for a team | Action |
| --- | --- |
| **No rows at all** | Insert. Normal first completion. |
| **Complete identical accepted set** (every `idempotencyKey` matches) | Insert nothing. Idempotent re-run: proceed to (g) and (h). The period may still need advancing if a previous attempt died between (f) and (h). |
| **Partially existing accepted set** | Verify each existing row's `idempotencyKey` matches its precomputed counterpart, then insert only the absent teams. |
| **Accepted row with different `idempotencyKey`/`content_hash`** | 🛑 **ROLLBACK.** Record `anomaly_conflicting_evidence`. Never overwrite: replacing accepted evidence requires the §8 correction path with a stated reason. |
| **Superseded predecessor, no accepted successor** | Treat the team as absent and insert — but the new row is a `weekly_close`, so it must **not** cite `supersedes_observation_id` (a correction is a different operation). If a superseded row exists whose successor is missing, that is `anomaly_conflicting_evidence` → ROLLBACK, because a tombstone without a replacement means an earlier correction did not complete. |
| **One insert in (f) fails** | The whole transaction rolls back. No partial accepted period survives. |
| **Advancement (h) fails after inserts** | The whole transaction rolls back, discarding (f)'s inserts. The period is retried cleanly next claim. |

**A stale worker inserts nothing**: step (a) fails first, and (f) is inside the same
transaction as (a).

### 5.7 SKIP — with integrity recovery

`$8` is `nextScheduledPeriod(...)`, resolved before the transaction.

```sql
BEGIN;

-- (a) Serialize; identity, token, expiry, target.
SELECT target_period_ordinal, deferral_first_at, deferral_attempts, last_deferred_reason
  FROM team_window_checkpoint_states
 WHERE IDENT AND lease_owner = $5
   AND lease_expires_at > timezone('UTC', CURRENT_TIMESTAMP)
   AND target_period_ordinal = $6
   FOR UPDATE;
-- 0 rows -> ROLLBACK

-- (b) Exactly one outcome row.
INSERT INTO team_window_period_outcomes (...) VALUES (...)
ON CONFLICT ON CONSTRAINT "uniq_twpo_league_period_contract" DO NOTHING
RETURNING id;

-- (c) 0 rows from (b) is NOT "already done": step (a) proved the checkpoint STILL targets
--     this period, so an existing outcome means the outcome was written and the
--     advancement was not. That is an integrity inconsistency.
--     -> ROLLBACK, alert, and hand to the recovery path in 5.8.

-- (d) Advance or exhaust.
UPDATE team_window_checkpoint_states
   SET target_period_ordinal = $8,
       deferral_first_at = NULL, deferral_attempts = 0, last_deferred_reason = NULL,
       next_eligible_at = $9,
       lease_owner = NULL, lease_expires_at = NULL,
       updated_at = timezone('UTC', CURRENT_TIMESTAMP)
 WHERE IDENT AND lease_owner = $5
   AND lease_expires_at > timezone('UTC', CURRENT_TIMESTAMP)
   AND target_period_ordinal = $6
RETURNING id;
-- <> 1 -> ROLLBACK

COMMIT;
```

⚠ **V1 called the (b)-conflict "already done" and rolled back, leaving the checkpoint pointed
at that period forever** — every future run would repeat the same conflict. Corrected above.

### 5.8 SKIP integrity recovery

Triggered only by 5.7(c). Idempotent, and **cannot double-advance**:

```sql
BEGIN;
-- 1. Re-lock the checkpoint and re-confirm it still targets the disputed period.
SELECT target_period_ordinal FROM team_window_checkpoint_states
 WHERE IDENT AND lease_owner = $5
   AND lease_expires_at > timezone('UTC', CURRENT_TIMESTAMP)
   AND target_period_ordinal = $6
   FOR UPDATE;
-- 0 rows -> ROLLBACK: another worker already resolved it. Nothing to do.

-- 2. Confirm the outcome row exists and is well-formed for THIS period and contract.
SELECT id, outcome, reason FROM team_window_period_outcomes
 WHERE league_id = $1 AND season = $2 AND period_type = 'week'
   AND period_ordinal = $6 AND resolver_contract = $3;
-- 0 rows -> ROLLBACK and alert: the conflict was spurious; this is corruption, not recovery.

-- 3. Confirm no ACCEPTED observation exists for the period. A skipped period must be empty.
SELECT count(*) FROM team_window_observations
 WHERE league_id = $1 AND season = $2 AND period_type = 'week'
   AND period_ordinal = $6 AND resolver_contract = $3 AND lifecycle = 'accepted';
-- > 0 -> ROLLBACK and alert: the period was both skipped and observed. Human review.

-- 4. Advance exactly once, guarded on the same target.
UPDATE team_window_checkpoint_states
   SET target_period_ordinal = $8, deferral_first_at = NULL, deferral_attempts = 0,
       last_deferred_reason = NULL, next_eligible_at = $9,
       lease_owner = NULL, lease_expires_at = NULL,
       updated_at = timezone('UTC', CURRENT_TIMESTAMP)
 WHERE IDENT AND lease_owner = $5 AND target_period_ordinal = $6
RETURNING id;
-- <> 1 -> ROLLBACK
COMMIT;
```

Double-advance is impossible: step 4's predicate pins `target_period_ordinal = $6`, so a
second run finds 0 rows at step 1.

### 5.9 Terminal exhaustion

`$8 = NULL` in 5.6(h), 5.7(d) or 5.8(4) — always atomic with the transition that discovered
it. An exhausted row has `target_period_ordinal IS NULL`, is skipped by CLAIM's
`target_period_ordinal IS NOT NULL`, is retained as history, and is never mutated. The next
season is a **new row** from discovery.

---

## 6. Roster-map integrity — fail closed

🛑 **V1's checks were vulnerable to SQL null semantics.** `array_agg` over an empty JSON
object returns `NULL`, and `NULL = NULL` is `NULL`, not `TRUE` — but it is also not `FALSE`,
so a naive `IF NOT ok THEN rollback` on a `NULL` result does not reliably reject. An empty or
malformed map could pass.

```sql
-- (c) Pinned-map integrity. Every predicate is null-safe (IS DISTINCT FROM / IS TRUE).
SELECT
  jsonb_typeof(f.roster_team_map)     = 'object' AS map_is_object,
  jsonb_typeof(f.expected_roster_ids) = 'array'  AS ids_is_array,
  COALESCE(jsonb_array_length(f.expected_roster_ids), 0) > 0 AS ids_non_empty,
  -- null-safe key equality
  (COALESCE((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(f.roster_team_map) k), '{}')
     IS NOT DISTINCT FROM
   COALESCE((SELECT array_agg(e ORDER BY e) FROM jsonb_array_elements_text(f.expected_roster_ids) e), '{}')
  ) AS keys_match,
  -- injective mapped team ids
  (COALESCE((SELECT count(*)              FROM jsonb_each_text(f.roster_team_map)), 0)
     = COALESCE((SELECT count(DISTINCT value) FROM jsonb_each_text(f.roster_team_map)), -1)
  ) AS injective,
  -- every mapped team exists AND belongs to THIS league
  (COALESCE((SELECT count(*) FROM jsonb_each_text(f.roster_team_map)), 0)
     = COALESCE((SELECT count(*) FROM jsonb_each_text(f.roster_team_map) m
                  JOIN league_teams lt ON lt.id = m.value AND lt."leagueId" = f.league_id), -1)
  ) AS teams_valid_and_same_league
FROM league_period_finality f
WHERE f.id = $7;

-- Proceed ONLY when every column IS TRUE. A NULL is a failure, not a pass:
--   map_is_object IS TRUE AND ids_is_array IS TRUE AND ids_non_empty IS TRUE
--   AND keys_match IS TRUE AND injective IS TRUE AND teams_valid_and_same_league IS TRUE
-- Otherwise ROLLBACK with refusal `pinned_roster_map_invalid`.
```

`COALESCE(..., -1)` on the right-hand side of each count comparison guarantees a `FALSE`
rather than a `NULL` when the subquery yields nothing.

### 6.1 Database-enforced league membership (S-6, S-7)

Application validation is insufficient for durable history. `LeagueTeam` already has
`id @id` and `@@unique([leagueId, externalId])`, so a composite candidate key is addable:

```prisma
model LeagueTeam {
  // …
  @@unique([id, leagueId], map: "uniq_league_team_id_league")
}

model TeamWindowObservation {
  // … replaces the single-column team relation
  leagueTeam LeagueTeam @relation(fields: [leagueTeamId, leagueId], references: [id, leagueId], onDelete: Restrict, map: "twobs_team_league_fk")
}
```

```sql
CREATE UNIQUE INDEX "uniq_league_team_id_league" ON "league_teams" ("id", "leagueId");
ALTER TABLE "team_window_observations"
  ADD CONSTRAINT "twobs_team_league_fk"
  FOREIGN KEY ("league_team_id", "league_id") REFERENCES "league_teams"("id", "leagueId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
```

An observation naming a team from another league is now **impossible to insert**, not merely
rejected by a code path someone might bypass. The same
`teams_valid_and_same_league` predicate is applied to `membership_correction` (§8), so a
repaired mapping cannot introduce a foreign team either.

---

## 7. Test matrix

🛑 **Every concurrency test uses two independent database connections.** Sequential calls on
one connection share a transaction context and cannot observe a lock race.
🛑 **Every negative control must be proven capable of failing** — mutate the guard, confirm
red, restore.
🛑 **Tests 9 and 19 run only against a disposable database** (they drop or corrupt tables).

**Base fixture `F`:** tenant `allfantasy`; `AppUser u1` (`.invalid`); `League L1` (sleeper,
platform `P1`, `sport NFL`, `season 2999`, `playoffStartWeek 15`, `playoffTeams 4`,
`playoffWeeksPerRound 1` → **scheduled 1..16**); `LeagueSeason (L1,2999,'active')`;
`ImportRun (L1, 2999, 'completed', completedAt)`; `LeagueTeam T1..T4`;
`WeeklyMatchup` weeks 1–6 scored; `LeaguePeriodFinality F6` (week 6, accepted, settled,
map `{"1":"T1","2":"T2","3":"T3","4":"T4"}`).

| # | Test | Assertions |
| --- | --- | --- |
| 1 | Two-worker claim race | Exactly one conn returns 1 row, other returns **0**; tokens differ |
| 2 | Lease expiry during assembly | B claims; A's HEARTBEAT **0**; A's COMPLETE **0**; **observation count unchanged**; checkpoint unchanged |
| 3 | Stale completion | A affects **0** rows; `last_completed_period`, `target_period_ordinal` unchanged; **zero observations inserted** |
| 4 | Concurrent finality correction | One commits; other aborts; one accepted revision; `revision = 2` |
| 5 | Rollback during whole-period correction | Prior finality `accepted`, `superseded_at IS NULL`; all 4 priors accepted; zero replacements |
| 6 | Live + historical lanes concurrently | Both claim; each advances its own target; neither sees the other's; disjoint periods |
| 7 | Non-UTC equivalence | **Fixed clock, deterministic ids, deterministic lease tokens injected**; serialized output byte-identical between UTC and `America/Los_Angeles` |
| 8 | Season-boundary exhaustion | Complete period **16** → `target_period_ordinal IS NULL`; CLAIM returns 0; no row with `period_ordinal >= 17` |
| 9 | Import/discovery decoupling *(disposable only)* | Drop checkpoint table → import **succeeds**; recreate, run discovery → row appears with correct target |
| 10 | Stable worker id, unique tokens | Three distinct `lease_owner` values, same 8-char prefix; token 1 satisfies nothing after token 2 exists |
| 11 | Midseason import, earlier settled periods | Weeks 1–9 scored, import at week 10 → live target **exactly 3**; historical lane created with target **1**, ceiling **2** |
| 12 | Duplicate SKIP retry | Exactly one outcome row; second attempt rolls back and enters **recovery** (5.8), not "already done"; after recovery the target has advanced exactly once |
| 13 | Schedule ending before week 18 | `start=15, teams=4, wpr=1` → `scheduledPeriods = [1..16]`, **last period 16**; `nextScheduledPeriod(16) = no_period` |
| 14 | Empty playoff schedule | `playoffTeams = 1` → zero playoff weeks; last period **14**; no refusal |
| 15 | Postseason import | Import after last period → **no live lane** for that season; **historical lane created automatically**; next season's row created on activation |
| 16 | Corrupted pinned map (duplicate) | Two rosters → `T1`; `injective` FALSE → ROLLBACK; nothing completes |
| 17 | Multiple leagues, different targets | **L1** weeks 1–6 → target 3; **L2** weeks 3–8 → target 5; **L3** no evidence → target 1. Three **distinct** targets: 3, 5, 1 |
| 18 | Ineligible / failed import excluded | `ImportRun.status='failed'` and `LeagueSeason.status<>'active'` leagues absent from discovery |
| 19 | Missing scheduled weeks → sequential SKIPs *(disposable)* | Weeks 5–6 absent → target 5 defers to deadline, one SKIP, advance to 6, defers, one SKIP, advance to 7. **Two** outcome rows, ordinals 5 and 6; never a jump from 4 to 7 |
| 20 | Partial observation insert rollback | Force the 3rd of 4 inserts to fail → **zero** accepted rows for the period; checkpoint target unchanged |
| 21 | Conflicting accepted content | Pre-insert T1 with a different `content_hash` → COMPLETE rolls back with `anomaly_conflicting_evidence`; no rows inserted; target unchanged |
| 22 | Empty roster-map JSON | `roster_team_map = '{}'`, `expected_roster_ids = '[]'` → `ids_non_empty` FALSE → ROLLBACK. **Proves null semantics cannot pass** |
| 23 | Mapped team from another league | Map `"1"` → a `LeagueTeam` of `L2` → `teams_valid_and_same_league` FALSE → ROLLBACK; and a direct insert violates `twobs_team_league_fk` |
| 24 | Historical processing of a completed season | Season fully past, evidence for weeks 1–16 → historical lane processes them in order, live lane absent, exhausts at ceiling |
| 25 | Stale worker attempting observation insertion | A's lease expired; A runs COMPLETE → step (a) 0 rows → **zero inserts**, observation table byte-identical before and after |

---

## 8. Finality-correction membership policy

Unchanged from V1 except that `membership_correction` now also runs the full §6 fail-closed
map validation, including `teams_valid_and_same_league`, against the **new** map. Ordinary
`stat_correction` still requires replacement membership to equal predecessor membership;
`membership_correction` is the only reason permitted to change the mapped team set, requires
explicit human authorization in `correction_reason`, preserves lineage through
`supersedes_finality_id`, tombstones rather than edits, and recomputes the whole league
atomically. `expected_roster_ids` remains immutable — what the provider reported is a fact;
only the internal mapping may be repaired.

---

## 9. P-1 and P-2 — decided

**P-1 — RESOLVED, accepted for v1.** `LeagueSeason.status = 'active'` is the discovery
lifecycle authority. It is written by the import commit path and keyed `(leagueId, season)`,
which is the exact grain discovery iterates. **Documented limitation:** it is set only by the
import path, so a league deactivated by another route would not be reflected; the effect is
that discovery may create a checkpoint row for a league nobody is using, which then defers
harmlessly and costs one row. A League-level lifecycle column is **not** a blocker for v1.

**P-2 — RESOLVED, and it turns out not to matter.** V1 used
`MIN(ImportRun.completedAt)` to approximate activation. **Initialization is now
evidence-driven** (§4.2): `liveFloor` derives from `scheduledPeriods`,
`availableEvidencePeriods` and settle-eligibility. **Activation time is not an input to any
correctness decision.** It is retained as **diagnostic metadata only**, recorded in the
discovery `SyncJobRun` summary. No schema requirement, and it is no longer listed as a
blocker anywhere in this contract.

---

## 10. Close-out

**Files the implementation batch will create or modify:**

| File | Action |
| --- | --- |
| `prisma/schema.prisma` | modify — 4 models, 4 reverse relations, S-1…S-8 (**blocked**) |
| `prisma/migrations-pending/<ts>_team_window_observations/migration.sql` | create |
| `lib/decision-os/value-v2/periodCalendar.ts` | create — `resolveScheduledPeriods`, `nextScheduledPeriod`, `resolveLaneInit` |
| `lib/decision-os/value-v2/leaseToken.ts` | create |
| `lib/decision-os/value-v2/checkpointStore.ts` | create — the seven transitions + 5.8 recovery |
| `lib/decision-os/value-v2/observationWriter.ts` | create — §5.6 (d)–(g) classification and insert |
| `lib/decision-os/value-v2/rosterMapIntegrity.ts` | create — §6 |
| `lib/decision-os/value-v2/finalityCorrection.ts` | create — §8 |
| `lib/decision-os/value-v2/windowDiscovery.ts` | create — lanes, per-league targets |
| `app/api/cron/decision-os-window-discovery/route.ts` | create |
| `app/api/cron/decision-os-window-checkpoint/route.ts` | create |
| `lib/decision-os/value-v2/windowDecision.ts` | modify — read stored observations |
| `scripts/check-window-schema-sql-parity.mjs` | create |
| `__tests__/decision-os/value-v2-window-*.test.ts` | create — §7, tests 1–25 |

**Recommended order:** (1) `periodCalendar.ts` + `leaseToken.ts`, pure and testable now;
(2) parity script and unit tests for them; (3) **await schema release**, then models +
migration including S-1…S-8; (4) `checkpointStore.ts` + `observationWriter.ts` with tests
1–3, 6, 8, 10, 12, 19–21, 25; (5) `rosterMapIntegrity.ts` with tests 16, 22, 23;
(6) `windowDiscovery.ts` + cron with tests 9, 11, 15, 17, 18, 24; (7)
`finalityCorrection.ts` with tests 4, 5; (8) checkpoint cron; (9) test 7 across the whole
set; (10) production major-version confirmation, then authority cutover as separate work.

**Unresolved external gates:**

| Gate | Status |
| --- | --- |
| Import Integrity Batch A lands in the target branch | **Open** — `import-integrity-batch-a` @ `a3505ed2b`, not an ancestor of `origin/main` |
| Batch A reader census passes | **Open** |
| `prisma/schema.prisma` released | **Open** |
| Production PostgreSQL major confirmed | **Open** — validated on 18.3 and 17.9, identical; test Neon reports 17.11 |
| IMP-05 period finality implemented | **Open** — contract supplied, no implementation |
| Real concurrency + non-UTC tests pass | **Open** — §7, none implemented |

**Nothing was implemented, committed, migrated or deployed.** No Prisma file was edited, no
migration created, no database modified; both disposable PostgreSQL clusters from earlier
validation were destroyed.

**Milestone 19 progress: 34%.**
