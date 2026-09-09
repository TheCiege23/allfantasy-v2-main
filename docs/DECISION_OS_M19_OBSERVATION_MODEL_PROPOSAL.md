# Proposal (rev 3, final) — `TeamWindowObservation`

**STATUS: PROPOSAL ONLY. NOT IMPLEMENTED, NOT MIGRATED, NOT APPLIED, NOT DEPLOYED.**

Implementation stays gated on `prisma/schema.prisma` being released. Re-checked
2026-09-09 16:46: still `M` with uncommitted insertions, owning session live. No schema
file, migration file or service was created for this revision.

## Correction carried from rev 2

Rev 2 claimed a real `LeagueTeam` foreign key "would require a compound unique that does not
exist today." **That was wrong.** The committed schema has both:

```prisma
model LeagueTeam {
  id         String @id @default(uuid())
  @@unique([leagueId, externalId])
}
```

So `leagueTeamId` can reference `LeagueTeam.id` directly, and the compound unique already
supports resolving a team from `(leagueId, externalId)` server-side. The model below uses a
real relation on both sides. Source identifiers become **evidence columns**, never join keys.

---

## 1. Complete Prisma model

```prisma
/// Decision OS milestone 19 — one competitive-window observation per team per scoring period.
///
/// APPEND-ONLY. A row records what was believed AT THAT PERIOD from the facts and model
/// version available then. It is never rewritten when a later projection, injury or stat
/// correction lands. That immutability is the point: a mutable history cannot evidence
/// persistence, and persistence is the entire anti-swoop guarantee.
///
/// The ONLY permitted mutation is the tombstone flip `lifecycle: accepted -> superseded`
/// (with `supersededAt`), performed atomically alongside the replacement insert. The facts
/// payload of a superseded row is retained verbatim.
///
/// ⚠ At most one ACCEPTED row per (league, leagueTeam, season, period, resolverContract) is
/// enforced by a PARTIAL unique index that Prisma cannot express. It lives in the migration
/// SQL. Do not "simplify" it into an @@unique — that reintroduces both defects rev 2 fixed.
model TeamWindowObservation {
  id                    String    @id @default(cuid())

  // ---- Internal identity (foreign keys) ----
  leagueId              String    @map("league_id")
  leagueTeamId          String    @map("league_team_id")

  // ---- Source identity (evidence/provenance only, never a join key) ----
  platform              String    @db.VarChar(32)
  platformLeagueId      String    @map("platform_league_id") @db.VarChar(128)
  sport                 String    @db.VarChar(16)
  /// LeagueTeam.externalId as observed. Verified against the related row at write time.
  sourceTeamId          String    @map("source_team_id") @db.VarChar(64)
  /// Provider roster/franchise id when it differs from externalId; null when identical.
  sourceRosterId        String?   @map("source_roster_id") @db.VarChar(64)

  // ---- Scoring period ----
  season                Int
  periodType            String    @map("period_type") @db.VarChar(16)
  periodOrdinal         Int       @map("period_ordinal")

  // ---- Lifecycle and provenance of this row ----
  lifecycle             String    @db.VarChar(16)
  checkpointType        String    @map("checkpoint_type") @db.VarChar(24)
  resolverVersion       String    @map("resolver_version") @db.VarChar(32)
  coefficientsVersion   String    @map("coefficients_version") @db.VarChar(32)
  /// resolverVersion + ':' + coefficientsVersion. Participates in the accepted key.
  resolverContract      String    @map("resolver_contract") @db.VarChar(80)
  /// SHA-256 over canonicalized resolver inputs + both versions. Idempotency key.
  inputsHash            String    @map("inputs_hash") @db.VarChar(64)

  // ---- Conclusions (queryable) ----
  observedStatus        String?   @map("observed_status") @db.VarChar(16)
  decisionState         String    @map("decision_state") @db.VarChar(16)
  nowScore              Float?    @map("now_score")
  futureScore           Float?    @map("future_score")
  actualWinRate         Float?    @map("actual_win_rate")
  earnedWinRate         Float?    @map("earned_win_rate")
  scheduleLuckDelta     Float?    @map("schedule_luck_delta")
  sourceConfidence      Float?    @map("source_confidence")
  pickTreatment         String    @map("pick_treatment") @db.VarChar(32)
  injuryTreatment       String    @map("injury_treatment") @db.VarChar(48)

  // ---- Lossless inputs ----
  /// TeamWindowObservationFactsV1. Schema version is inside the payload AND in the column.
  facts                 Json
  factsSchemaVersion    Int       @map("facts_schema_version")
  gaps                  Json?

  // ---- Source pinning ----
  forecastSnapshotId    String?   @map("forecast_snapshot_id")
  dynastySnapshotId     String?   @map("dynasty_snapshot_id")
  matchupSourceAt       DateTime? @map("matchup_source_at")
  forecastGeneratedAt   DateTime? @map("forecast_generated_at")
  dynastyGeneratedAt    DateTime? @map("dynasty_generated_at")
  injuryObservedAt      DateTime? @map("injury_observed_at")
  rosterObservedAt      DateTime? @map("roster_observed_at")
  /// ScoringSettingsSnapshot.id — pins the exact effective rules, not a version string.
  scoringSettingsSnapshotId String? @map("scoring_settings_snapshot_id")

  // ---- Correction chain ----
  supersedesObservationId String? @map("supersedes_observation_id")
  supersedes            TeamWindowObservation?  @relation("WindowCorrection", fields: [supersedesObservationId], references: [id], onDelete: Restrict)
  supersededBy          TeamWindowObservation[] @relation("WindowCorrection")
  correctionReason      String?   @map("correction_reason") @db.VarChar(200)
  correctionSourceAt    DateTime? @map("correction_source_at")
  supersededAt          DateTime? @map("superseded_at")

  observedAt            DateTime  @map("observed_at")
  createdAt             DateTime  @default(now()) @map("created_at")

  league     League     @relation(fields: [leagueId],     references: [id], onDelete: Cascade)
  leagueTeam LeagueTeam @relation(fields: [leagueTeamId], references: [id], onDelete: Cascade)

  @@unique([inputsHash], name: "uniq_twobs_inputs_hash")
  @@index([leagueId, season, periodOrdinal])
  @@index([leagueTeamId, season, periodOrdinal])
  @@index([leagueId, leagueTeamId, season, resolverContract, periodOrdinal])
  @@index([lifecycle, decisionState])
  @@index([createdAt])
  @@map("team_window_observations")
}
```

**Reverse relations to add** (the only edits to existing models — both purely additive):

```prisma
model League {
  // …
  windowObservations TeamWindowObservation[]
}

model LeagueTeam {
  // …
  windowObservations TeamWindowObservation[]
}
```

**Delete behaviour, chosen deliberately.**

| Relation | Behaviour | Why |
| --- | --- | --- |
| `league` | `Cascade` | An observation about a deleted league is evidence of nothing, and `LeagueTeam` already cascades from `League`. Leaving orphans would strand rows no query can reach. |
| `leagueTeam` | `Cascade` | Same reasoning, one level down. A team removed from a league takes its window history with it. |
| `supersedes` | `Restrict` | A superseded row must not be deletable while a correction still cites it. The chain is the audit trail; breaking it silently is the failure this design exists to prevent. |

⚠ **Cascade is a real trade-off.** It means a league deletion destroys learning evidence for
milestones 40–44. The alternative (`SetNull` + orphan retention) keeps the corpus but
requires nullable FKs and a separate reaper. Recorded as an unresolved decision in §12.

**Write-time identity verification** (not optional):

1. Load `LeagueTeam` by `leagueTeamId`; require `leagueTeam.leagueId === leagueId`.
2. Require `leagueTeam.externalId === sourceTeamId`.
3. Require `league.platformLeagueId === platformLeagueId` and `league.platform === platform`.
4. Reject the write otherwise. A mismatch is a bug or an attack, never a row to store.

---

## 2. Accepted-observation key

```sql
CREATE UNIQUE INDEX "uniq_twobs_accepted"
  ON "team_window_observations"
     ("league_id", "league_team_id", "season", "period_type", "period_ordinal", "resolver_contract")
  WHERE "lifecycle" = 'accepted';
```

Keyed on `league_team_id` — the internal FK — per correction 1. It is correct because it:

- permits **many attempts and corrections** per period while guaranteeing exactly one
  authoritative row;
- includes `resolver_contract`, so a new model version can record the same period rather
  than being locked out;
- is **partial**, so superseded rows accumulate without colliding;
- is enforced by Postgres, not by application discipline.

Failed or deferred attempts never enter this table at all (§9), so an incomplete attempt
cannot occupy the period.

---

## 3. Producer scheduling — the window checkpoint consumes, never invokes

**Approved: schedule `SeasonForecastSnapshot` and `DynastyProjectionSnapshot` producers
independently first.** The checkpoint reads their outputs and owns neither.

Five durable phases with **explicit readiness gates**, not cron timing:

| # | Phase | Gate it publishes | Gate it requires |
| --- | --- | --- | --- |
| 1 | Finalized matchup/stat ingestion | `matchupsFinal(league, period)` + `sourceObservedAt` | — |
| 2 | Injury refresh | `injuryFresh(sport)` + `observedAt` | — |
| 3 | Due season forecasts | `forecastFresh(league, period)` + `snapshotId` | 1 |
| 4 | Due dynasty projections | `dynastyFresh(league, season)` + `snapshotId` | 1 |
| 5 | **Window checkpoint** | accepted observations | 1, 2, 3, 4 |

Each phase writes its readiness into per-league state (§9) and reads its predecessors'.
Phase 5 **defers** any league whose gates are not all satisfied. A phase never assumes a
predecessor ran because the clock advanced.

**Capacity and safety, per phase:** batch limit (leagues per invocation), resumable cursor
keyed on `(season, leagueId)`, per-league lease with expiry so a dead worker frees its
claim, bounded retries with exponential backoff recorded as `consecutiveFailures`, and a
per-league freshness TTL so a league already fresh is skipped rather than recomputed.
**Active current-season leagues are prioritized**; dormant and past-season leagues are
processed only with remaining budget.

Phases 3 and 4 are Monte-Carlo simulations. They must remain independently schedulable and
independently disableable — folding them into the checkpoint would put two expensive
subsystems inside the window's runtime budget and make one kill switch disable three things.

---

## 4. Finality gates — the clock is necessary, not sufficient

Tuesday 08:00 ET is the **earliest eligibility**, never the completion signal. Before
accepting, all six must hold:

1. Every matchup for `(league, season, period)` is final.
2. No scheduled game in the period is unfinished, postponed or rescheduled out.
3. Matchup ingestion observed the finalized source state — `matchupSourceAt` is at or after
   the last game's final time.
4. `forecastGeneratedAt > matchupSourceAt` — the forecast saw the finished period.
5. Dynasty snapshot satisfies its freshness contract for the season.
6. Injury evidence satisfies both its freshness window and its coverage floor.

**Any gate failing ⇒ defer.** Not refuse. A deferral writes per-league state and a retry
time; it does **not** create an accepted or a refused observation. A refused observation is
reserved for facts that resolved and then failed a *value* gate (unit range, coverage
floor) — a genuine finding about the team, not about the pipeline.

**UTC/DST.** "Tuesday 08:00 America/New_York" is computed **in the zone**, never as a fixed
UTC offset. The NFL season crosses the DST boundary (first Sunday in November), so 08:00 ET
is 12:00 UTC before it and 13:00 UTC after; a constant offset silently shifts the gate by an
hour mid-season. All stored timestamps are UTC (`timestamptz` semantics via Prisma
`DateTime`); only the eligibility calendar is zone-aware. A Monday-night game finishing
after midnight ET lands on Tuesday UTC — which is exactly why gate 3 compares observed
source time and not calendar date.

---

## 5. Missing-period hysteresis — corrected

**Proposing a new classification.** Settle only when all five hold:

1. three **accepted** observations;
2. from three **consecutive expected** scoring periods;
3. under the **same** `resolverContract`;
4. supporting the **same** material proposed status;
5. every deadband requirement satisfied.

A missing, deferred or refused period **breaks** the streak. It does not pause and resume.
Rev 2's pause-and-resume was wrong: it let two observations separated by an unobserved gap
count as consecutive, which is precisely the swoop the requirement forbids.

**Already-settled classification.** A missing current observation may retain the last
settled window as `held`, marked clearly stale, for a **bounded maximum of two consecutive
expected periods**. Beyond that, return `refused` with neutral objective team-fit and gap
`window_settled_hold_expired`.

Missing evidence never changes a settled status and never counts as agreement in either
direction.

**These are tested separately** — the streak rules and the settled-hold rules are different
code paths and a test for one proves nothing about the other.

---

## 6. `stat_correction` — renamed and specified

`backfill_correction` is renamed **`stat_correction`**. "Backfill" implies synthesising
history, which is prohibited; this is a replay of a *real* source correction for a period
that was already observed.

Permitted `checkpointType`: `weekly_close`, `stat_correction`.

A correction must reference the exact prior observation, use the **same** period and
`resolverContract`, carry `correctionReason` and `correctionSourceAt`, supersede and insert
atomically, and retain both immutable fact payloads.

### Transaction algorithm

```sql
BEGIN;

-- 1. Lock the accepted row. A concurrent correction blocks here rather than racing.
SELECT id, lifecycle
  FROM team_window_observations
 WHERE league_id = $1 AND league_team_id = $2 AND season = $3
   AND period_type = $4 AND period_ordinal = $5 AND resolver_contract = $6
   AND lifecycle = 'accepted'
   FOR UPDATE;

-- 2. Zero rows, or lifecycle no longer 'accepted' -> ABORT. Another correction won.
--    This is the check that makes the lock meaningful; taking the lock is not enough.

-- 3. Tombstone it.
UPDATE team_window_observations
   SET lifecycle = 'superseded', superseded_at = NOW()
 WHERE id = $7 AND lifecycle = 'accepted';   -- affected rows must be exactly 1

-- 4. Insert the replacement, citing the row it replaces.
INSERT INTO team_window_observations (..., lifecycle, checkpoint_type, supersedes_observation_id, ...)
VALUES (..., 'accepted', 'stat_correction', $7, ...);

COMMIT;
```

Two concurrent corrections cannot both become accepted: the second blocks on `FOR UPDATE`,
then observes `lifecycle = 'superseded'` at step 2 and aborts. Without step 2 the second
would proceed and the partial unique index would reject its insert — correct, but as an
error rather than a clean no-op, and after wasted work.

---

## 7. Idempotency and concurrency

`inputsHash` is a SHA-256 over canonicalized resolver inputs plus both versions, with a
**global unique constraint** (`uniq_twobs_inputs_hash`). That is the proof identical input
evidence cannot be inserted repeatedly — it holds regardless of lifecycle, so even a
superseded row keeps its hash reserved.

**Normal checkpoint:**

- identical hash, accepted row already present → **no-op** (`ON CONFLICT DO NOTHING`);
- **different** hash for an already-accepted period → **anomaly**, logged with both hashes
  and counted; never a silent replacement. Replacing requires the §6 correction path with an
  explicit reason.

**Postgres/Prisma mechanics.** A partial unique index can be used as an `ON CONFLICT`
target, but the predicate must be restated:

```sql
INSERT INTO team_window_observations (...) VALUES (...)
ON CONFLICT ("league_id","league_team_id","season","period_type","period_ordinal","resolver_contract")
WHERE "lifecycle" = 'accepted'
DO NOTHING;
```

Prisma's `upsert` and `createMany({ skipDuplicates })` **cannot** target a partial index, so
the checkpoint insert must go through `prisma.$executeRaw`. Reads stay on the typed client.
This is a deliberate, contained use of raw SQL and should be documented at the call site
rather than "fixed" later by weakening the index.

---

## 8. Facts contract

Authority rule: **the queryable columns are authoritative** for the fields duplicated
between them and the JSON payload (`observedStatus`, `decisionState`, `nowScore`,
`futureScore`, `actualWinRate`, `earnedWinRate`, `scheduleLuckDelta`, `sourceConfidence`,
`pickTreatment`, `injuryTreatment`, the snapshot ids and timestamps). A validator asserts
equality on write and **rejects** the row on disagreement; disagreement means a construction
bug, and storing a row whose two halves contradict each other is worse than failing.

`pickTreatment` in **v1 is restricted to `included-in-roster-strength`**, enforced by check
constraint. The only runtime source is `DynastyProjectionSnapshot.projectedStrength3Years`,
which already contains pick capital. `'separate'` stays in the resolver's type for a future
pick-free strength source, but no v1 row may use it — so there is no separate pick-capital
input to store and no way to double-count.

Every rate carries a declared unit.

```ts
export const WINDOW_FACTS_SCHEMA_VERSION = 1 as const

/** Units are explicit because two of the stored sources are 0..100 and the resolver takes 0..1. */
export type Unit = 'ratio_0_1' | 'percent_0_100' | 'wins' | 'points' | 'count'

export interface Measured<U extends Unit = Unit> { value: number; unit: U }

export interface TeamWindowObservationFactsV1 {
  schemaVersion: typeof WINDOW_FACTS_SCHEMA_VERSION

  record: {
    wins: number; losses: number; ties: number
    pointsFor: Measured<'points'>
    pointsAgainst: Measured<'points'> | null
    actualWinRate: Measured<'ratio_0_1'>
  }
  allPlay: {
    wins: number; losses: number; ties: number
    rate: Measured<'ratio_0_1'>
    weeksCounted: number
  }
  earned: {
    winRate: Measured<'ratio_0_1'>
    scheduleLuckDelta: Measured<'wins'>   // actual minus earned; positive = kind schedule
  }
  forecast: {
    playoffProbability: Measured<'percent_0_100'>
    snapshotId: string | null
    generatedAt: string | null
    periodOrdinal: number
    freshnessMs: number                    // observedAt - generatedAt
  }
  dynasty: {
    strengthCurrentSeason: Measured<'percent_0_100'> | null
    strengthNextYear: Measured<'percent_0_100'> | null
    strength3Years: Measured<'percent_0_100'>
    strength5Years: Measured<'percent_0_100'> | null
    confidence: Measured<'percent_0_100'> | null
    windowStartYear: number | null
    windowEndYear: number | null
    pickCapitalIncluded: true
    snapshotId: string | null
    generatedAt: string | null
    freshnessMs: number
  }
  injuries: {
    unavailableCount: Measured<'count'>
    coveredCount: Measured<'count'>
    rosterCount: Measured<'count'>
    unavailableShare: Measured<'ratio_0_1'>
    coverage: Measured<'ratio_0_1'>
    basis: string
    treatment: 'excluded' | 'included-in-playoff-probability'
    observedAt: string
    freshnessMs: number
  }
  roster: { playerIdCount: number; identitySource: string; observedAt: string | null }
  matchups: { sourceObservedAt: string | null; sourceDataVersion: string | null; allFinal: true }
  league: { scoringSettingsSnapshotId: string | null; formatKey: string | null; scoringMode: string | null }
  gaps: string[]
  coefficients: Record<string, number | string>
}
```

---

## 9. Per-league checkpoint state — separate from invocation telemetry

`SyncJobRun` stays what it is: **one row per invocation**, with counts
(`processed`/`accepted`/`deferred`/`refused`/`failed`) and a bounded summary. **No unbounded
per-league error array goes in its `metadata`.**

**Existing precedent identified:** `LeagueSyncState` (schema line ~6560) already carries
exactly this shape — `checkpoints Json`, `completedScopes`, `incompleteScopes`,
`lastAttemptedSyncAt`, `lastSuccessfulSyncAt`, `sourceDataTimestamp`,
`consecutiveFailures`, `lastError`, `lastRunId`, keyed by `runKey` / provider + external
league + season.

It is **not** reused, for one reason: it is the *import* subsystem's state, and its
`checkpoints` JSON is already that subsystem's namespace. Overloading it would couple the
window checkpoint's retry behaviour to import sync and make either subsystem's schema change
a hazard for the other. A narrow sibling, modelled on it deliberately:

```prisma
/// Per-league state for the Decision OS window checkpoint. Modelled on LeagueSyncState,
/// deliberately separate so window retries and import retries cannot entangle.
model TeamWindowCheckpointState {
  id                    String    @id @default(cuid())
  leagueId              String    @map("league_id")
  season                Int
  sport                 String    @db.VarChar(16)

  lastAttemptedPeriod   Int?      @map("last_attempted_period")
  lastAttemptedAt       DateTime? @map("last_attempted_at")
  lastAcceptedPeriod    Int?      @map("last_accepted_period")
  lastAcceptedAt        DateTime? @map("last_accepted_at")

  nextEligibleAt        DateTime? @map("next_eligible_at")
  consecutiveFailures   Int       @default(0) @map("consecutive_failures")
  /// Bounded category, never a free-text stack trace.
  lastErrorCategory     String?   @map("last_error_category") @db.VarChar(48)
  lastDeferredReason    String?   @map("last_deferred_reason") @db.VarChar(64)

  /// Worker lease so a dead worker frees its claim rather than blocking the league forever.
  leaseOwner            String?   @map("lease_owner") @db.VarChar(64)
  leaseExpiresAt        DateTime? @map("lease_expires_at")

  createdAt             DateTime  @default(now()) @map("created_at")
  updatedAt             DateTime  @updatedAt @map("updated_at")

  league League @relation(fields: [leagueId], references: [id], onDelete: Cascade)

  @@unique([leagueId, season], name: "uniq_twcs_league_season")
  @@index([nextEligibleAt])
  @@index([sport, season, nextEligibleAt])
  @@map("team_window_checkpoint_states")
}
```

`lastErrorCategory` and `lastDeferredReason` are **bounded enums**, not free text — the
detail belongs in logs, and an unbounded string column on a per-league table is how a table
becomes a log.

---

## 10. Pending migration SQL

`prisma/migrations-pending/<ts>_team_window_observations/migration.sql`. Additive only.
**Not applied. No backfill.**

```sql
-- ---------- team_window_observations ----------
CREATE TABLE "team_window_observations" (
  "id"                        TEXT PRIMARY KEY,
  "league_id"                 TEXT NOT NULL,
  "league_team_id"            TEXT NOT NULL,
  "platform"                  VARCHAR(32) NOT NULL,
  "platform_league_id"        VARCHAR(128) NOT NULL,
  "sport"                     VARCHAR(16) NOT NULL,
  "source_team_id"            VARCHAR(64) NOT NULL,
  "source_roster_id"          VARCHAR(64),
  "season"                    INTEGER NOT NULL,
  "period_type"               VARCHAR(16) NOT NULL,
  "period_ordinal"            INTEGER NOT NULL,
  "lifecycle"                 VARCHAR(16) NOT NULL,
  "checkpoint_type"           VARCHAR(24) NOT NULL,
  "resolver_version"          VARCHAR(32) NOT NULL,
  "coefficients_version"      VARCHAR(32) NOT NULL,
  "resolver_contract"         VARCHAR(80) NOT NULL,
  "inputs_hash"               VARCHAR(64) NOT NULL,
  "observed_status"           VARCHAR(16),
  "decision_state"            VARCHAR(16) NOT NULL,
  "now_score"                 DOUBLE PRECISION,
  "future_score"              DOUBLE PRECISION,
  "actual_win_rate"           DOUBLE PRECISION,
  "earned_win_rate"           DOUBLE PRECISION,
  "schedule_luck_delta"       DOUBLE PRECISION,
  "source_confidence"         DOUBLE PRECISION,
  "pick_treatment"            VARCHAR(32) NOT NULL,
  "injury_treatment"          VARCHAR(48) NOT NULL,
  "facts"                     JSONB NOT NULL,
  "facts_schema_version"      INTEGER NOT NULL,
  "gaps"                      JSONB,
  "forecast_snapshot_id"      TEXT,
  "dynasty_snapshot_id"       TEXT,
  "matchup_source_at"         TIMESTAMP(3),
  "forecast_generated_at"     TIMESTAMP(3),
  "dynasty_generated_at"      TIMESTAMP(3),
  "injury_observed_at"        TIMESTAMP(3),
  "roster_observed_at"        TIMESTAMP(3),
  "scoring_settings_snapshot_id" TEXT,
  "supersedes_observation_id" TEXT,
  "correction_reason"         VARCHAR(200),
  "correction_source_at"      TIMESTAMP(3),
  "superseded_at"             TIMESTAMP(3),
  "observed_at"               TIMESTAMP(3) NOT NULL,
  "created_at"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "twobs_league_fk"     FOREIGN KEY ("league_id")      REFERENCES "leagues"("id")      ON DELETE CASCADE  ON UPDATE CASCADE,
  CONSTRAINT "twobs_team_fk"       FOREIGN KEY ("league_team_id") REFERENCES "league_teams"("id") ON DELETE CASCADE  ON UPDATE CASCADE,
  CONSTRAINT "twobs_supersedes_fk" FOREIGN KEY ("supersedes_observation_id") REFERENCES "team_window_observations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,

  CONSTRAINT "twobs_lifecycle_chk"       CHECK ("lifecycle" IN ('accepted','superseded')),
  CONSTRAINT "twobs_checkpoint_chk"      CHECK ("checkpoint_type" IN ('weekly_close','stat_correction')),
  CONSTRAINT "twobs_decision_state_chk"  CHECK ("decision_state" IN ('provisional','evidenced','held','refused')),
  CONSTRAINT "twobs_status_chk"          CHECK ("observed_status" IS NULL OR "observed_status" IN ('contender','rising','competitive','declining','rebuilding')),
  CONSTRAINT "twobs_period_type_chk"     CHECK ("period_type" IN ('week')),
  CONSTRAINT "twobs_pick_treatment_chk"  CHECK ("pick_treatment" = 'included-in-roster-strength'),
  CONSTRAINT "twobs_injury_treatment_chk" CHECK ("injury_treatment" IN ('excluded','included-in-playoff-probability')),
  CONSTRAINT "twobs_sport_chk"           CHECK ("sport" = 'NFL'),
  CONSTRAINT "twobs_period_ordinal_chk"  CHECK ("period_ordinal" BETWEEN 1 AND 25),
  CONSTRAINT "twobs_correction_chk"      CHECK (
      ("checkpoint_type" <> 'stat_correction')
   OR ("supersedes_observation_id" IS NOT NULL AND "correction_reason" IS NOT NULL)),
  CONSTRAINT "twobs_superseded_chk"      CHECK (
      ("lifecycle" <> 'superseded') OR ("superseded_at" IS NOT NULL))
);

-- Exactly one ACCEPTED row per team, period and resolver contract.
CREATE UNIQUE INDEX "uniq_twobs_accepted"
  ON "team_window_observations"
     ("league_id","league_team_id","season","period_type","period_ordinal","resolver_contract")
  WHERE "lifecycle" = 'accepted';

-- Identical input evidence can never be stored twice, in any lifecycle.
CREATE UNIQUE INDEX "uniq_twobs_inputs_hash" ON "team_window_observations" ("inputs_hash");

CREATE INDEX "twobs_league_season_period_idx"   ON "team_window_observations" ("league_id","season","period_ordinal");
CREATE INDEX "twobs_team_season_period_idx"     ON "team_window_observations" ("league_team_id","season","period_ordinal");
CREATE INDEX "twobs_hysteresis_idx"             ON "team_window_observations" ("league_id","league_team_id","season","resolver_contract","period_ordinal");
CREATE INDEX "twobs_lifecycle_state_idx"        ON "team_window_observations" ("lifecycle","decision_state");
CREATE INDEX "twobs_created_at_idx"             ON "team_window_observations" ("created_at");
CREATE INDEX "twobs_supersedes_idx"             ON "team_window_observations" ("supersedes_observation_id");

-- ---------- team_window_checkpoint_states ----------
CREATE TABLE "team_window_checkpoint_states" (
  "id"                    TEXT PRIMARY KEY,
  "league_id"             TEXT NOT NULL,
  "season"                INTEGER NOT NULL,
  "sport"                 VARCHAR(16) NOT NULL,
  "last_attempted_period" INTEGER,
  "last_attempted_at"     TIMESTAMP(3),
  "last_accepted_period"  INTEGER,
  "last_accepted_at"      TIMESTAMP(3),
  "next_eligible_at"      TIMESTAMP(3),
  "consecutive_failures"  INTEGER NOT NULL DEFAULT 0,
  "last_error_category"   VARCHAR(48),
  "last_deferred_reason"  VARCHAR(64),
  "lease_owner"           VARCHAR(64),
  "lease_expires_at"      TIMESTAMP(3),
  "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "twcs_league_fk" FOREIGN KEY ("league_id") REFERENCES "leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uniq_twcs_league_season" ON "team_window_checkpoint_states" ("league_id","season");
CREATE INDEX "twcs_next_eligible_idx"         ON "team_window_checkpoint_states" ("next_eligible_at");
CREATE INDEX "twcs_sport_season_next_idx"     ON "team_window_checkpoint_states" ("sport","season","next_eligible_at");
```

### Rollback

Guarded and narrowly scoped. **No `CASCADE`** — nothing is expected to depend on these
tables, and `CASCADE` would silently drop anything that unexpectedly did, which is the one
outcome a rollback must not produce.

```sql
-- Refuse rather than destroy if something unexpected references these tables.
DO $$
DECLARE dep_count INT;
BEGIN
  SELECT count(*) INTO dep_count
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.confrelid
   WHERE t.relname IN ('team_window_observations','team_window_checkpoint_states')
     AND c.conrelid NOT IN ('team_window_observations'::regclass,
                            'team_window_checkpoint_states'::regclass);
  IF dep_count > 0 THEN
    RAISE EXCEPTION 'Refusing rollback: % unexpected dependent constraint(s) found', dep_count;
  END IF;
END $$;

DROP INDEX IF EXISTS "twcs_sport_season_next_idx";
DROP INDEX IF EXISTS "twcs_next_eligible_idx";
DROP INDEX IF EXISTS "uniq_twcs_league_season";
DROP TABLE IF EXISTS "team_window_checkpoint_states";

DROP INDEX IF EXISTS "twobs_supersedes_idx";
DROP INDEX IF EXISTS "twobs_created_at_idx";
DROP INDEX IF EXISTS "twobs_lifecycle_state_idx";
DROP INDEX IF EXISTS "twobs_hysteresis_idx";
DROP INDEX IF EXISTS "twobs_team_season_period_idx";
DROP INDEX IF EXISTS "twobs_league_season_period_idx";
DROP INDEX IF EXISTS "uniq_twobs_inputs_hash";
DROP INDEX IF EXISTS "uniq_twobs_accepted";
DROP TABLE IF EXISTS "team_window_observations";
```

**What a rollback loses:** every captured weekly observation and its facts payload, the full
correction/supersession chain, and all per-league checkpoint cursors and lease state. None
of it is recoverable — historical observations cannot be recreated, which is the same reason
backfill is prohibited. Consumers fall back to neutral objective team-fit, which is the
documented refusal behaviour, so the product degrades honestly rather than breaking. **Export
both tables before rolling back** if the evidence is wanted for milestones 40–44.

---

## 11. Capacity — planning estimates requiring measurement

The rev-2 "~1 KB" figure was too confident for a row carrying versioned JSONB plus eight
indexes. Broken out:

| Component | Estimate per accepted row |
| --- | --- |
| Heap tuple (header, null bitmap, ~20 varchar/text, ~10 float/int, 8 timestamps) | 0.6 – 0.9 KB |
| `facts` JSONB (~50 fields incl. `gaps`, `coefficients`) | 1.5 – 4 KB uncompressed; TOAST-compressed above ~2 KB |
| `gaps` JSONB | 0.05 – 0.3 KB |
| Eight indexes (two unique, one partial, six b-tree) | 0.3 – 0.7 KB amortised |
| Postgres page/fillfactor overhead | ~10 – 20% |
| **Total per accepted row** | **≈ 2.5 – 6 KB** |

Multipliers: `+~5%` for `stat_correction` supersessions (assumed, unmeasured), and **×N for
N concurrent resolver contracts** — a version transition doubles a period's rows until the
old contract is retired.

Exact formula, unchanged:

```
accepted rows/season = leagues × teams_per_league × periods_per_season × resolver_contracts
```

NFL v1: 18 periods × ~12 teams × 1 contract = **~216 accepted rows per league-season**, so
**≈ 0.5 – 1.3 MB per league-season**.

| Leagues | Rows/season | Storage/season |
| --- | --- | --- |
| 1,000 | ~216k | ~0.5 – 1.3 GB |
| 5,000 | ~1.08M | ~2.7 – 6.5 GB |
| 10,000 | ~2.16M | ~5.4 – 13 GB |

⚠ **All storage figures are planning estimates and must be measured**, by loading a
representative sample and reading `pg_total_relation_size`. ⚠ **The league count is
deliberately not asserted** — obtaining it needs a production read that is out of scope.

**Retention: keep everything.** These rows are the evidence base for milestones 40–44;
pruning them to save space deletes the training corpus. A `superseded` row is history too
and must not be pruned as a duplicate. Revisit only with product approval and a stated
horizon.

---

## 12. Rollout preserved, and unresolved decisions

Unchanged and approved: **NFL-only v1**; first valid result is `provisional`; provisional
results may be explained immediately by Chimmy; **objective team-fit stays neutral until
three-period settlement**; user-confirmed strategy lives in `DecisionStrategyState`, stays
separately labelled, and may influence personalization immediately; **no historical
backfill**; a resolver or coefficient version change **resets** persistence; **market value
never changes** because of the window; **live requests never write accepted history**.

**Unresolved, needing a decision before implementation:**

1. **`onDelete: Cascade` on `league`/`leagueTeam`** destroys learning evidence when a league
   is deleted. `SetNull` + orphan retention preserves the corpus but needs nullable FKs and
   a reaper. Cascade is proposed; the trade-off is real.
2. **Settled-hold bound of two periods** (§5) is a product judgement, not a measurement.
3. **The ~5% correction rate** in §11 is assumed and unmeasured.
4. **Phase 3/4 scheduling cadence and cost** — how often forecasts and dynasty projections
   are due — belongs to those subsystems and is not decided here.
5. **Resolved during this revision, recorded rather than left open.**
   `ScoringSettingsSnapshot` exists, is keyed `(leagueId, season, week)` and carries `id`,
   `formatKey`, `scoringMode` and `effectiveRules`. The observation therefore pins
   `scoringSettingsSnapshotId` — the exact rules row — rather than an invented version
   string, consistent with how the forecast and dynasty snapshot ids are pinned. ⚠ Its
   `season` and `week` are both nullable, so a league may have no snapshot for the period;
   that stays null and is named as a gap, never approximated from a neighbouring week.

Nothing in this document has been implemented, migrated, applied or deployed.
