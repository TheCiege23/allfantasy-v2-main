# Decision OS Milestone 19 — `TeamWindowObservation` (Revision 5.2)

**STATUS: PROPOSAL ONLY. NOT IMPLEMENTED, NOT COMMITTED, NOT MIGRATED, NOT APPLIED.**
No schema file, migration file or service was created or edited. `prisma/schema.prisma`
remains held by another session.

**This document is self-contained.** It supersedes revisions 1–4 entirely. An implementer
needs nothing else.

## Revision 5.2 changelog

Narrow consistency correction. The valuation architecture is unchanged.

**Sections 13 and 14 were regenerated, not patched.** Every line of revision 5's handwritten
SQL was discarded. The forward migration is now `prisma migrate diff --script` output from
the exact schema that passed `prisma validate`, with only Prisma-inexpressible objects
layered afterwards.

**The migration was executed against a real, disposable PostgreSQL 18.3 cluster** — created
with `initdb`, trust auth, port 55432, destroyed afterwards. Base schema → migration →
23 constraint/trigger assertions → rollback → verify gone → reapply → re-run. §19.

| # | Change |
| --- | --- |
| 1 | Forward SQL regenerated from the validated schema; automated field↔column parity check added, with a self-test proving it detects missing, extra and renamed columns |
| 2 | `league_period_finality` SQL corrected: `pairing_valid`, `status`, `updated_at` and `uniq_lpf_league_period` removed; partial accepted-uniqueness, identity+content uniqueness, linear supersession and 17 CHECKs added |
| 3 | Finality corrections are identity-bound by composite self-relation, with `revision_reason` distinguishing progression from a true stat correction |
| 4 | Atomic finality-correction transaction supplied — it recomputes **every** team, because all-play changes league-wide |
| 5 | All four tables created in dependency order; no `ALTER` precedes its `CREATE` |
| 6 | Every checkpoint query carries `leagueId + season + resolverContract`; explicit claim/heartbeat/defer/fail/skip/complete/release SQL |
| 7 | `roster_team_map` persists the roster-ID → LeagueTeam-ID mapping used for that assessment |
| 8 | New leagues initialize at the first eligible close **at or after import**, never period 1 |
| 9 | Deferral horizon shortened to `min(deferralFirstAt + 7 days, nextPeriodSettleEligibleAt)` |
| 10 | Import Batch A.1 blocker status corrected to "implemented on an unmerged branch" |

⚠ **One test in the first run was wrong, not the constraint.** It asserted that identical
evidence could not repeat, using a *different* team — which the constraint correctly permits,
since `contentHash` is deliberately not globally unique. The test now uses the same team, and
a control asserts that two different teams **may** share evidence.

## Revision 5.1 changelog

Patched in place. The schema in §2 has been **validated by Prisma against an isolated copy
of the committed `origin/main` schema** — see §18 for exit codes and the diagnostics that
changed the design.

| # | Change |
| --- | --- |
| 1 | `LeaguePeriodFinality` is now append-only and revisioned; only a lifecycle tombstone may change |
| 2 | `finalityId` is **non-null** and identity-bound by composite FK; observations require a `settled` assessment |
| 3 | `supersededBy` corrected to **singular**; composite self-relation expressed in Prisma, not only in SQL; every constraint carries an explicit `map:` |
| 4 | Work queue keyed on `leagueId + season + resolverContract` with `targetPeriodOrdinal`; `FOR UPDATE SKIP LOCKED` claim supplied |
| 5 | Bounded deferral deadline; new `TeamWindowPeriodOutcome` records a skipped period durably |
| 6 | Format-aware pairing outcomes; expected/observed roster **ID sets and hashes** persisted, captured as of the period |
| 7 | `correctionEligible` boolean removed; eligibility computed from immutable timestamps |
| 8 | Immutability enforced by database trigger, not by prose |
| 9 | Completion compares **team ID sets**, not counts, and re-verifies lease ownership inside the transaction |

⚠ **A literal NUL byte was found and removed from this document** at offset 19622: revision 5
wrote an actual `\u0000` into the `SEP` example instead of describing one, which made `grep`
report the file as binary. The separator is now written as an escape.

---

## 1. What this is

A durable, append-only weekly record of each fantasy team's competitive window, replacing
the retroactive reconstruction that let a projection landing today rewrite what weeks W-1
and W-2 are computed to have been.

**Approved policy, preserved:**

- NFL-only in v1. Other sports are refused with a named gap, never scored with NFL
  assumptions.
- The first valid observation is **`provisional`** — evidence-backed, explainable by Chimmy
  immediately, and explicitly not a claim that the three-period requirement is met.
- **Objective team-fit stays neutral until settlement.** Three compatible consecutive
  periods under one resolver contract.
- A user's confirmed strategy lives in `DecisionStrategyState`, is labelled separately, and
  may influence personalization immediately.
- **No historical backfill.** No fabricated observations.
- A resolver or coefficient version change **resets** persistence.
- **Market value never changes** because of the window.
- **Live requests never write accepted history.**

---

## 2. Complete Prisma models

### 2.1 `TeamWindowObservation`

```prisma
/// One competitive-window observation per team per scoring period.
///
/// APPEND-ONLY. A row records what was believed AT THAT PERIOD from the facts and model
/// version available then. It is never rewritten when a later projection, injury or stat
/// correction lands. A mutable history cannot evidence persistence, and persistence is the
/// entire anti-swoop guarantee. Enforced by the `twobs_immutable` trigger.
///
/// At most one ACCEPTED row per (league, leagueTeam, season, period, resolverContract) is
/// enforced by a PARTIAL unique index Prisma cannot express; it is layered in the migration.
/// Do not "simplify" it into an @@unique: that would let an early incomplete attempt own the
/// period permanently, and would stop a new resolver contract recording the period at all.
model TeamWindowObservation {
  id               String  @id @default(cuid())
  leagueId         String  @map("league_id")
  leagueTeamId     String  @map("league_team_id")
  platform         String  @db.VarChar(32)
  platformLeagueId String  @map("platform_league_id") @db.VarChar(128)
  sport            String  @db.VarChar(16)
  sourceTeamId     String  @map("source_team_id") @db.VarChar(64)
  sourceRosterId   String? @map("source_roster_id") @db.VarChar(64)
  season           Int
  periodType       String  @map("period_type") @db.VarChar(16)
  periodOrdinal    Int     @map("period_ordinal")

  lifecycle           String @db.VarChar(16)
  checkpointType      String @map("checkpoint_type") @db.VarChar(24)
  resolverVersion     String @map("resolver_version") @db.VarChar(32)
  coefficientsVersion String @map("coefficients_version") @db.VarChar(32)
  resolverContract    String @map("resolver_contract") @db.VarChar(80)
  /// RFC 8785 canonical hash of facts + contract. NOT unique: two teams may share evidence.
  contentHash         String @map("content_hash") @db.VarChar(64)
  /// Globally unique: identity envelope + contentHash.
  idempotencyKey      String @map("idempotency_key") @db.VarChar(64)

  observedStatus    String? @map("observed_status") @db.VarChar(16)
  decisionState     String  @map("decision_state") @db.VarChar(16)
  nowScore          Float?  @map("now_score")
  futureScore       Float?  @map("future_score")
  actualWinRate     Float?  @map("actual_win_rate")
  earnedWinRate     Float?  @map("earned_win_rate")
  scheduleLuckDelta Float?  @map("schedule_luck_delta")
  sourceConfidence  Float?  @map("source_confidence")
  pickTreatment     String  @map("pick_treatment") @db.VarChar(32)
  injuryTreatment   String  @map("injury_treatment") @db.VarChar(48)

  facts              Json
  factsSchemaVersion Int   @map("facts_schema_version")
  gaps               Json?

  /// NON-NULL: unavailable finality defers the league, so no observation can exist without one.
  finalityId                String    @map("finality_id")
  forecastSnapshotId        String?   @map("forecast_snapshot_id")
  dynastySnapshotId         String?   @map("dynasty_snapshot_id")
  scoringSettingsSnapshotId String?   @map("scoring_settings_snapshot_id")
  matchupSourceAt           DateTime? @map("matchup_source_at")
  forecastGeneratedAt       DateTime? @map("forecast_generated_at")
  dynastyGeneratedAt        DateTime? @map("dynasty_generated_at")
  injuryObservedAt          DateTime? @map("injury_observed_at")
  rosterObservedAt          DateTime? @map("roster_observed_at")

  supersedesObservationId String?                @unique(map: "uniq_twobs_supersedes") @map("supersedes_observation_id")
  supersedes              TeamWindowObservation? @relation("WindowCorrection", fields: [supersedesObservationId, leagueId, leagueTeamId, season, periodType, periodOrdinal, resolverContract], references: [id, leagueId, leagueTeamId, season, periodType, periodOrdinal, resolverContract], onDelete: Restrict, map: "twobs_supersedes_identity_fk")
  supersededBy            TeamWindowObservation? @relation("WindowCorrection")
  correctionReason        String?                @map("correction_reason") @db.VarChar(200)
  correctionSourceAt      DateTime?              @map("correction_source_at")
  supersededAt            DateTime?              @map("superseded_at")

  observedAt DateTime @map("observed_at")
  createdAt  DateTime @default(now()) @map("created_at")

  league     League               @relation(fields: [leagueId], references: [id], onDelete: Restrict, map: "twobs_league_fk")
  leagueTeam LeagueTeam           @relation(fields: [leagueTeamId], references: [id], onDelete: Restrict, map: "twobs_team_fk")
  finality   LeaguePeriodFinality @relation(fields: [finalityId, leagueId, season, periodType, periodOrdinal], references: [id, leagueId, season, periodType, periodOrdinal], onDelete: Restrict, map: "twobs_finality_identity_fk")

  @@unique([supersedesObservationId, leagueId, leagueTeamId, season, periodType, periodOrdinal, resolverContract], map: "uniq_twobs_supersedes_identity")
  @@unique([idempotencyKey], map: "uniq_twobs_idempotency_key")
  @@unique([leagueId, leagueTeamId, season, periodType, periodOrdinal, resolverContract, contentHash], map: "uniq_twobs_identity_content")
  @@unique([id, leagueId, leagueTeamId, season, periodType, periodOrdinal, resolverContract], map: "uniq_twobs_identity_row")
  @@index([leagueId, season, periodOrdinal], map: "twobs_league_season_period_idx")
  @@index([leagueTeamId, season, periodOrdinal], map: "twobs_team_season_period_idx")
  @@index([leagueId, leagueTeamId, season, resolverContract, periodOrdinal], map: "twobs_hysteresis_idx")
  @@index([lifecycle, decisionState], map: "twobs_lifecycle_state_idx")
  @@index([finalityId], map: "twobs_finality_idx")
  @@index([createdAt], map: "twobs_created_at_idx")
  @@map("team_window_observations")
}
```

### 2.2 `LeaguePeriodFinality`

```prisma
/// Provider-aware, PERIOD-level finality for one league's scoring period. APPEND-ONLY and
/// REVISIONED: an assessment is never mutated from provisional to settled or corrected,
/// because observations reference it and an update would rewrite their historical evidence.
///
/// The ONLY permitted mutation is the tombstone flip `lifecycle: accepted -> superseded`,
/// enforced by the `lpf_immutable` trigger.
///
/// FINALITY IS A PROPERTY OF THE PERIOD, NOT OF A ROW IN `WeeklyMatchup`. One fantasy roster
/// draws players from many NFL games, so a real-game status on a fantasy matchup row is a
/// category error.
///
/// SLEEPER REPORTS NO FINALITY. Its matchup response carries roster_id, matchup_id, points,
/// players and starters, and nothing that says the week is over. Every Sleeper assessment is
/// therefore `provenance: 'inferred'`, enforced by `lpf_method_provenance_chk`.
model LeaguePeriodFinality {
  id               String @id @default(cuid())
  leagueId         String @map("league_id")
  platform         String @db.VarChar(32)
  platformLeagueId String @map("platform_league_id") @db.VarChar(128)
  sport            String @db.VarChar(16)
  season           Int
  periodType       String @map("period_type") @db.VarChar(16)
  periodOrdinal    Int    @map("period_ordinal")

  lifecycle       String @db.VarChar(16)
  assessmentState String @map("assessment_state") @db.VarChar(16)
  revision        Int
  /// source_refresh | became_settled | stat_correction | commissioner_correction | manual_review.
  /// A provisional assessment becoming settled is NOT a stat correction.
  revisionReason  String @map("revision_reason") @db.VarChar(32)

  expectedRosterIds     Json   @map("expected_roster_ids")
  observedRosterIds     Json   @map("observed_roster_ids")
  expectedRosterSetHash String @map("expected_roster_set_hash") @db.VarChar(64)
  observedRosterSetHash String @map("observed_roster_set_hash") @db.VarChar(64)
  expectedRosterCount   Int    @map("expected_roster_count")
  observedRosterCount   Int    @map("observed_roster_count")
  missingRosterIds      Json   @map("missing_roster_ids")
  /// Provider roster id -> LeagueTeam id, AS USED for this assessment. Never reconstructed
  /// later from current rows: a renamed, restored or orphaned team must not reinterpret
  /// historical completeness.
  rosterTeamMap         Json   @map("roster_team_map")

  pairingOutcome   String @map("pairing_outcome") @db.VarChar(32)
  pairingAnomalies Json?  @map("pairing_anomalies")

  providerSeason     String?  @map("provider_season") @db.VarChar(16)
  providerWeek       Int?     @map("provider_week")
  providerLeg        Int?     @map("provider_leg")
  providerSeasonType String?  @map("provider_season_type") @db.VarChar(24)
  platformAdvanced   Boolean? @map("platform_advanced")

  scheduledEventsTotal    Int?    @map("scheduled_events_total")
  scheduledEventsComplete Int?    @map("scheduled_events_complete")
  scheduledEventsStatus   String? @map("scheduled_events_status") @db.VarChar(24)

  finalityMethod String  @map("finality_method") @db.VarChar(40)
  provenance     String  @db.VarChar(24)
  refusalReason  String? @map("refusal_reason") @db.VarChar(64)

  sourceObservedAt       DateTime  @map("source_observed_at")
  settleEligibleAt       DateTime? @map("settle_eligible_at")
  correctionWindowEndsAt DateTime? @map("correction_window_ends_at")

  contentHash String @map("content_hash") @db.VarChar(64)

  supersedesFinalityId String?               @unique(map: "uniq_lpf_supersedes") @map("supersedes_finality_id")
  supersedes           LeaguePeriodFinality? @relation("FinalityCorrection", fields: [supersedesFinalityId, leagueId, season, periodType, periodOrdinal], references: [id, leagueId, season, periodType, periodOrdinal], onDelete: Restrict, map: "lpf_supersedes_identity_fk")
  supersededBy         LeaguePeriodFinality? @relation("FinalityCorrection")
  correctionReason     String?               @map("correction_reason") @db.VarChar(200)
  correctionSourceAt   DateTime?             @map("correction_source_at")
  supersededAt         DateTime?             @map("superseded_at")

  createdAt DateTime @default(now()) @map("created_at")

  league       League                  @relation(fields: [leagueId], references: [id], onDelete: Restrict, map: "lpf_league_fk")
  observations TeamWindowObservation[]

  @@unique([supersedesFinalityId, leagueId, season, periodType, periodOrdinal], map: "uniq_lpf_supersedes_identity")
  @@unique([leagueId, season, periodType, periodOrdinal, contentHash], map: "uniq_lpf_identity_content")
  @@unique([id, leagueId, season, periodType, periodOrdinal], map: "uniq_lpf_identity_row")
  @@index([assessmentState, sourceObservedAt], map: "lpf_state_observed_idx")
  @@index([sport, season, periodOrdinal], map: "lpf_sport_season_idx")
  @@map("league_period_finality")
}
```

### 2.3 `TeamWindowCheckpointState`

```prisma
/// Lease-backed work-queue row for the window checkpoint. Owned EXCLUSIVELY by the
/// checkpoint worker: producer readiness is read from the producers' own output tables, and
/// no producer writes here.
///
/// Identity includes `resolverContract`, so an active and a shadow contract never share
/// progress. There is no enumeration cursor: the queue IS the cursor.
model TeamWindowCheckpointState {
  id               String @id @default(cuid())
  leagueId         String @map("league_id")
  season           Int
  sport            String @db.VarChar(16)
  resolverContract String @map("resolver_contract") @db.VarChar(80)

  targetPeriodOrdinal Int?      @map("target_period_ordinal")
  lastAttemptedPeriod Int?      @map("last_attempted_period")
  lastAttemptedAt     DateTime? @map("last_attempted_at")
  lastCompletedPeriod Int?      @map("last_completed_period")
  lastCompletedAt     DateTime? @map("last_completed_at")
  lastDeferredPeriod  Int?      @map("last_deferred_period")
  lastDeferredReason  String?   @map("last_deferred_reason") @db.VarChar(64)
  deferralFirstAt     DateTime? @map("deferral_first_at")
  deferralAttempts    Int       @default(0) @map("deferral_attempts")
  lastFailedAt        DateTime? @map("last_failed_at")
  lastErrorCategory   String?   @map("last_error_category") @db.VarChar(48)

  nextEligibleAt      DateTime? @map("next_eligible_at")
  consecutiveFailures Int       @default(0) @map("consecutive_failures")

  leaseOwner     String?   @map("lease_owner") @db.VarChar(64)
  leaseExpiresAt DateTime? @map("lease_expires_at")

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  league League @relation(fields: [leagueId], references: [id], onDelete: Restrict, map: "twcs_league_fk")

  @@unique([leagueId, season, resolverContract], map: "uniq_twcs_league_season_contract")
  @@index([nextEligibleAt], map: "twcs_next_eligible_idx")
  @@index([sport, season, nextEligibleAt], map: "twcs_sport_season_next_idx")
  @@map("team_window_checkpoint_states")
}
```

**State meanings, exactly:**

| State | Meaning | Sets |
| --- | --- | --- |
| **attempted** | The worker claimed the league and ran the assessment | `lastAttemptedPeriod`, `lastAttemptedAt` |
| **deferred** | Upstream evidence missing or stale. **No observation written.** Retry later | `lastDeferredPeriod`, `lastDeferredReason`, `nextEligibleAt` |
| **completed** | Every active team has exactly one terminal observation for the period | `lastCompletedPeriod`, `lastCompletedAt` |
| **failed** | An unexpected error (not a deferral). Backoff applies | `lastFailedAt`, `lastErrorCategory`, `consecutiveFailures++`, `nextEligibleAt` |
| **next-eligible** | Earliest time this league may be claimed again | `nextEligibleAt` |

### 2.5 `TeamWindowPeriodOutcome`

A period whose evidence never arrives must not block the league forever. When the deferral
deadline passes, the queue records a durable outcome and advances.

```prisma
/// Durable record that a scoring period was closed WITHOUT an observation, and why.
/// Hysteresis reads this as a missing period, which BREAKS the streak. It is never an
/// observation and never carries a classification.
model TeamWindowPeriodOutcome {
  id               String   @id @default(cuid())
  leagueId         String   @map("league_id")
  season           Int
  periodType       String   @map("period_type") @db.VarChar(16)
  periodOrdinal    Int      @map("period_ordinal")
  resolverContract String   @map("resolver_contract") @db.VarChar(80)
  outcome          String   @db.VarChar(24)
  reason           String   @db.VarChar(64)
  attempts         Int
  firstAttemptedAt DateTime @map("first_attempted_at")
  closedAt         DateTime @map("closed_at")
  createdAt        DateTime @default(now()) @map("created_at")

  league League @relation(fields: [leagueId], references: [id], onDelete: Restrict, map: "twpo_league_fk")

  @@unique([leagueId, season, periodType, periodOrdinal, resolverContract], map: "uniq_twpo_league_period_contract")
  @@index([outcome, closedAt], map: "twpo_outcome_closed_idx")
  @@map("team_window_period_outcomes")
}
```

### 2.6 Finality is required, identity-bound, and must be settled

`TeamWindowObservation.finalityId` is **non-null**: unavailable finality defers the league,
so an observation without one cannot exist. The composite foreign key
`twobs_finality_identity_fk` proves the referenced assessment belongs to the same league,
season, period type and period ordinal — a cross-period reference is structurally
impossible, not merely validated.

**"Must reference a `settled` assessment" is enforced transactionally**, because a foreign
key cannot constrain a column's *value* in the parent row. The checkpoint transaction (§8)
re-reads the finality row `FOR SHARE` and aborts unless
`lifecycle = 'accepted' AND assessment_state = 'settled'`. `FOR SHARE` blocks a concurrent
correction from tombstoning that row before the observations commit.

**A finality correction corrects every team's observation for that period.** Completeness,
pairing and schedule-luck inputs are league-wide: an all-play rate changes for **every**
team when any one matchup's points change, so correcting only the directly affected teams
would leave the rest citing evidence that no longer holds. The correction path therefore
supersedes the whole period's observation set under one transaction, each new row citing
its own predecessor.

### 2.7 Immutability, enforced by the database

Prose is not enforcement. Both tables get a trigger permitting **only** the tombstone flip:

```sql
CREATE OR REPLACE FUNCTION twobs_reject_mutation() RETURNS trigger AS $$
BEGIN
  IF OLD.lifecycle <> 'accepted' OR NEW.lifecycle <> 'superseded' THEN
    RAISE EXCEPTION 'team_window_observations is append-only: only accepted -> superseded is permitted';
  END IF;
  IF OLD.superseded_at IS NOT NULL OR NEW.superseded_at IS NULL THEN
    RAISE EXCEPTION 'superseded_at must transition from NULL to a timestamp exactly once';
  END IF;
  -- Every other column must be byte-identical. Comparing the whole row minus the two
  -- permitted columns catches a new column added later without updating this trigger.
  IF to_jsonb(OLD) - 'lifecycle' - 'superseded_at'
     IS DISTINCT FROM
     to_jsonb(NEW) - 'lifecycle' - 'superseded_at' THEN
    RAISE EXCEPTION 'team_window_observations evidence columns are immutable';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER twobs_immutable BEFORE UPDATE ON "team_window_observations"
  FOR EACH ROW EXECUTE FUNCTION twobs_reject_mutation();
```

An identical `lpf_reject_mutation` / `lpf_immutable` pair guards `league_period_finality`.

⚠ The `to_jsonb(OLD) - ... IS DISTINCT FROM to_jsonb(NEW) - ...` comparison is deliberate:
enumerating columns would silently stop protecting any column added later. **Tested
directly** — an `UPDATE` of `facts`, `now_score`, `content_hash`, `league_team_id` or
`observed_at` must raise, and the legal tombstone flip must succeed.

### 2.4 Reverse relations on existing models

```prisma
model League {
  // …
  windowObservations TeamWindowObservation[]
  periodFinality     LeaguePeriodFinality[]
  windowCheckpoints  TeamWindowCheckpointState[]
}

model LeagueTeam {
  // …
  windowObservations TeamWindowObservation[]
}
```

---

## 3. TypeScript facts contract

**V1 is retained throughout.** Revision 4 referenced a `TeamWindowObservationFactsV2` that
was never defined; there is no V2 and no migration rationale for one. `factsSchemaVersion`
exists so a future V2 can be introduced deliberately, with its own document.

```ts
export const WINDOW_FACTS_SCHEMA_VERSION = 1 as const

/** Declared unit for every rate and count. Two stored sources are 0..100; the resolver takes 0..1. */
export type Unit = 'ratio_0_1' | 'percent_0_100' | 'wins' | 'points' | 'count' | 'milliseconds'

export interface Measured<U extends Unit = Unit> {
  value: number
  unit: U
  /** Decimal places this field is quantized to BEFORE canonicalization. */
  precision: number
}

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
    periodsCounted: number
  }
  earned: {
    winRate: Measured<'ratio_0_1'>
    /** Actual minus earned. Positive means the schedule has been kind. */
    scheduleLuckDelta: Measured<'wins'>
  }
  forecast: {
    playoffProbability: Measured<'percent_0_100'>
    snapshotId: string | null
    generatedAt: string | null
    periodOrdinal: number
    freshness: Measured<'milliseconds'>
  }
  dynasty: {
    strengthCurrentSeason: Measured<'percent_0_100'> | null
    strengthNextYear: Measured<'percent_0_100'> | null
    strength3Years: Measured<'percent_0_100'>
    strength5Years: Measured<'percent_0_100'> | null
    confidence: Measured<'percent_0_100'> | null
    windowStartYear: number | null
    windowEndYear: number | null
    /** Literal: DynastyProjectionEngine folds pickValue into projectedStrength3Years. */
    pickCapitalIncluded: true
    snapshotId: string | null
    generatedAt: string | null
    freshness: Measured<'milliseconds'>
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
    freshness: Measured<'milliseconds'>
  }
  roster: { playerIdCount: number; identitySource: string; observedAt: string | null }
  finality: {
    finalityId: string
    method: FinalityMethod
    provenance: FinalityProvenance
    sourceObservedAt: string
  }
  league: {
    scoringSettingsSnapshotId: string | null
    formatKey: string | null
    scoringMode: string | null
  }
  /** Set-like. Sorted inside normalization, never relied on to arrive sorted. */
  gaps: string[]
  coefficients: Record<string, number | string>
}
```

**Authority rule.** The queryable columns are authoritative for every field duplicated
between them and the payload (`observedStatus`, `decisionState`, `nowScore`, `futureScore`,
`actualWinRate`, `earnedWinRate`, `scheduleLuckDelta`, `sourceConfidence`, `pickTreatment`,
`injuryTreatment`, the snapshot ids and timestamps). A validator asserts equality on write
and **rejects the row** on disagreement — a row whose two halves contradict each other is
worse than a failed write.

**`pickTreatment` in v1 is `included-in-roster-strength` only**, enforced by CHECK. The only
runtime source already contains pick capital, so there is no separate pick input and no way
to double-count.

---

## 4. Canonical hashing

**RFC 8785 (JCS)** after typed runtime validation. No blanket rounding.

```ts
/**
 * ⚠ NO GENERIC toFixed(). Rounding every float to a fixed width can collapse distinct
 * evidence — two teams 1e-11 apart in playoff probability are genuinely different rows, and
 * a blanket quantizer would hash them identically.
 *
 * Precision is declared PER FIELD in the facts contract (`Measured.precision`) and applied
 * during validation, before canonicalization. Canonicalization itself never rounds.
 */
export function normalizeFacts(input: unknown): TeamWindowObservationFactsV1 {
  // 1. Typed runtime validation. Rejects, never coerces.
  const facts = TeamWindowObservationFactsV1Schema.parse(input)   // zod or equivalent

  // 2. Reject values JCS cannot represent, rather than silently dropping them.
  assertNoUndefined(facts)          // `undefined` is not JSON; a dropped key changes the hash
  assertAllFinite(facts)            // NaN / ±Infinity are rejected, never stringified
  assertNoNonPlainObjects(facts)    // Date, Map, Set, BigInt, class instances -> reject
  assertUnitsValid(facts)           // every Measured carries a known unit and integer precision

  // 3. Apply the DECLARED per-field precision. Nothing is rounded that did not ask to be.
  quantizeMeasuredFields(facts)     // value = round(value, precision) for each Measured

  // 4. Sort set-like fields HERE, in code — not as an instruction in prose.
  facts.gaps = [...new Set(facts.gaps)].sort()

  return facts
}

/** RFC 8785 JSON Canonicalization Scheme: sorted keys, defined number/string forms. */
export function canonicalJson(value: unknown): string   // e.g. `canonicalize` from a JCS library

const SEP = '\u0000'   // cannot occur in any component, so joins are unambiguous

export function computeContentHash(facts: TeamWindowObservationFactsV1, resolverContract: string): string {
  return sha256Hex([canonicalJson(normalizeFacts(facts)), resolverContract].join(SEP))
}

export function computeIdempotencyKey(identity: {
  leagueId: string; leagueTeamId: string; season: number
  periodType: string; periodOrdinal: number; resolverContract: string
}, contentHash: string): string {
  return sha256Hex([
    identity.leagueId, identity.leagueTeamId, String(identity.season),
    identity.periodType, String(identity.periodOrdinal), identity.resolverContract,
    contentHash,
  ].join(SEP))
}
```

`contentHash` answers *"has the evidence changed?"* and is **not unique** — two teams may
legitimately share evidence. `idempotencyKey` binds evidence to identity and **is** unique,
so identical facts under different teams or periods can never collide. A composite database
constraint (`uniq_twobs_identity_content`) enforces the same guarantee independently, so a
hashing bug is caught by the database rather than accepted.

---

## 5. Matchup finality — provider-aware, period-level

### 5.1 Why `WeeklyMatchup` is the wrong home

Sleeper's matchup response is a list of **fantasy-team records** — `roster_id`,
`matchup_id`, `points`, `players`, `starters`, `custom_points`. It carries **no**
`isFinal` and no `gameStatus`. Confirmed against
`lib/league-import/sleeper/SleeperHistoricalMatchupSyncService.ts`, which pairs teams by
sorting `roster_id` within a `matchup_id`.

A single fantasy roster draws players from many NFL games, so a real-game status column on a
fantasy matchup row is a category error. Finality is a property of the **period**.

### 5.2 The four Sleeper signals, kept distinct

| Signal | Source | What it proves | What it does not |
| --- | --- | --- | --- |
| **Matchup-response completeness** | `/league/{id}/matchups/{week}` | Every **active roster id** produced a record | Nothing about whether scoring is done |
| **Platform advancement** | `getNflState()` → `week` / `leg` / `season_type` | Sleeper has moved past this leg | Nothing about stat corrections |
| **Scheduled-event completion** | `SportsGame` where `sport='NFL'`, `season`, `week`, `status` | Every underlying NFL game is complete | Nothing about Sleeper's ingest |
| **Later corrections** | Sleeper stat corrections; commissioner `custom_points` | — | These land *after* the other three pass |

**Completeness compares observed fantasy-team records against the active roster id SET**,
captured **as of that scoring period** and persisted as `expectedRosterIds` plus
`expectedRosterSetHash`. Never `league size / 2`, which assumes even pairing and breaks on
byes and odd-sized leagues.

⚠ **The expected set is stored, not recomputed.** Reconstructing it later from current
`isOrphan` values would let a team added or orphaned in week 12 change whether week 6 is
judged complete. A retry re-reads the stored set; only a genuine correction may supersede it.

**Pairing is format-aware, not a boolean.** `pairingOutcome` is one of:

| Outcome | Meaning |
| --- | --- |
| `valid_pair` | The `matchup_id` groups exactly two active rosters |
| `valid_bye` | Exactly one active roster, and the format schedules a bye/unpaired week |
| `invalid_duplicate_roster` | The same roster id appears twice in one group |
| `invalid_oversized_group` | Three or more rosters share a `matchup_id` |
| `invalid_missing_roster` | An active roster produced no record at all |
| `unsupported_structure` | The grouping does not match any known format — refuse, never guess |

Only `valid_pair` and `valid_bye` permit settlement. Everything else refuses the period with
the outcome as `refusalReason`, so the reason survives in the record.

### 5.3 Correction grace policy — stated, not open-ended

`correctionEligible` was a boolean that goes stale purely because time passes. It is
**removed**. Two immutable timestamps are stored and eligibility is computed at evaluation
time:

- **`settleEligibleAt`** — earliest instant the assessment may become `settled`. For NFL
  Sleeper this is the Tuesday 08:00 `America/New_York` close, computed in the zone.
- **`correctionWindowEndsAt`** — `settleEligibleAt + 7 days`, the point after which a late
  change is unusual enough to warrant review rather than automatic acceptance.

```ts
const settleable  = now >= finality.settleEligibleAt
const correctable = finality.correctionWindowEndsAt === null || now <= finality.correctionWindowEndsAt
```

**The policy, stated explicitly:** the system **accepts Tuesday's close** and settles then.
It does **not** wait an undefined period for Sleeper stat corrections or commissioner
`custom_points` edits. Anything landing afterwards is handled as a `stat_correction` — a new
finality revision plus a superseding observation set — for as long as
`correctionWindowEndsAt` permits. Beyond that window a correction still may be applied, but
only through the audited path with a stated reason; it is not automatic.

⚠ **Sleeper finality is always `provenance: 'inferred'`.** Labelling an inference as
provider-reported would be a false statement in a durable audit record.

⚠ `SportsGame` carries multiple rows per fixture in this database — dedupe by fixture before
counting `scheduledEventsComplete`, or the completion ratio is wrong.

### 5.3 Provider adapter contract

```ts
export type FinalityMethod =
  | 'sleeper_inferred_composite'      // completeness + advancement + schedule
  | 'sleeper_inferred_partial'        // some signals unavailable
  | 'provider_reported'               // a provider that genuinely reports finality
  | 'schedule_only'
  | 'unavailable'

export type FinalityProvenance = 'provider_reported' | 'inferred' | 'mixed'
export type FinalityAssessmentState = 'provisional' | 'settled' | 'refused'
// 'corrected' is NOT a state: a correction is a new REVISION whose predecessor is tombstoned.

export interface PeriodFinalityRequest {
  leagueId: string; platform: string; platformLeagueId: string
  sport: string; season: number; periodType: 'week'; periodOrdinal: number
  /** Active roster ids: LeagueTeam.externalId where isOrphan = false. */
  activeRosterIds: readonly string[]
}

export interface PeriodFinalityAssessment {
  expectedRosterCount: number
  observedRosterCount: number
  missingRosterIds: string[]
  pairingValid: boolean
  pairingAnomalies: string[] | null
  providerSeason: string | null
  providerWeek: number | null
  providerLeg: number | null
  providerSeasonType: string | null
  platformAdvanced: boolean | null
  scheduledEventsTotal: number | null
  scheduledEventsComplete: number | null
  scheduledEventsStatus: string | null
  finalityMethod: FinalityMethod
  provenance: FinalityProvenance
  /** Matches LeaguePeriodFinality.assessmentState. */
  assessmentState: FinalityAssessmentState
  refusalReason: string | null
  sourceObservedAt: Date
  /// Immutable instants. Eligibility is COMPUTED at evaluation time, never stored as a boolean.
  settleEligibleAt: Date
  correctionWindowEndsAt: Date | null
}

export interface PeriodFinalityAdapter {
  readonly provider: 'sleeper' | 'espn' | 'yahoo' | 'mfl' | 'fleaflicker' | 'fantrax'
  assess(request: PeriodFinalityRequest): Promise<PeriodFinalityAssessment>
}
```

ESPN, Yahoo, MFL, Fleaflicker and Fantrax each implement this differently and are **out of
scope for v1**; an unimplemented provider returns `finalityMethod: 'unavailable'`,
`status: 'refused'`, and the checkpoint defers that league.

**Sleeper settles only when all three hold**, and a correction window has passed:
completeness (no missing active rosters), platform advancement past the leg, and every
deduped NFL game for the week complete. Any one failing ⇒ `provisional` ⇒ the checkpoint
**defers**.

**This is IMP-05.** No IMP-05 specification exists in `docs/` today; §5 is its requirement.
Until it ships, the checkpoint defers every league with
`lastDeferredReason = 'matchup_finality_unavailable'`.

---

## 6. Producer ownership and readiness

| Concern | Owner | Authoritative readiness source |
| --- | --- | --- |
| Period finality | IMP-05 finality service | `LeaguePeriodFinality` |
| Matchup facts | import subsystem | `WeeklyMatchup` |
| Injury readiness | injury cron | `SportsPlayer.fetchedAt` / `expiresAt` |
| Forecast readiness | forecast producer | `SeasonForecastSnapshot.generatedAt` |
| Dynasty readiness | dynasty producer | `DynastyProjectionSnapshot.generatedAt` |
| Lease, retry, completion | **checkpoint worker only** | `TeamWindowCheckpointState` |

Producer output tables are the authoritative readiness source. The window worker **reads**
them and writes only its own tables. **No producer writes `TeamWindowCheckpointState`**, so
five subsystems never contend on one row.

⚠ `SeasonForecastSnapshot` and `DynastyProjectionSnapshot` are still **request-triggered
only** — `runSeasonForecast` from `app/api/leagues/[leagueId]/season-forecast/handler.ts`,
`generateDynastyProjection` from the dynasty-projections handler. No cron writes either.
Both need scheduled producers before the checkpoint can accept anything.

---

## 7. UTC safety

The repository convention is plain `DateTime` → `timestamp(3)` **without** time zone:
`Timestamptz` appears **0 times** across **1,544** `DateTime` fields in the committed
schema. Revision 5 keeps that convention — one `timestamptz` table would make every
comparison against `SeasonForecastSnapshot.generatedAt` a mixed-type comparison resolved
through the session time zone.

**Writer discipline alone is insufficient**, because raw SQL using `NOW()` is evaluated
through the session time zone and written into a naive column. **Both** measures are
required:

1. **Session/role time zone pinned to UTC and verified.**

```sql
ALTER ROLE <app_role> SET timezone TO 'UTC';
```

Verified at startup and at test setup — fail closed:

```ts
const [{ tz }] = await prisma.$queryRaw<{ tz: string }[]>`SHOW timezone`
if (tz !== 'UTC') throw new Error(`Refusing to start: database session timezone is ${tz}, expected UTC`)
```

2. **UTC-safe expressions in every raw statement.** Never bare `NOW()` or
   `CURRENT_TIMESTAMP` into a naive column:

```sql
timezone('UTC', CURRENT_TIMESTAMP)     -- correct
NOW()                                  -- banned in this subsystem
```

**Tested under a deliberately non-UTC session** (`SET timezone = 'America/Los_Angeles'`):
finality gates, freshness comparisons, lease expiry and correction ordering must produce
byte-identical results. This is a real test, not a note — it is how the pinning is proven
rather than assumed.

---

## 8. Checkpoint transaction — conflict-safe

Fact assembly happens **outside** the transaction (no provider calls inside a transaction).
The transaction is short and verifies rather than assumes.

```
claim lease  →  assemble facts for ALL active teams (outside tx, heartbeat renews lease)
             →  one transaction: verify, insert missing, assert, complete
             →  release lease
```

**Claiming work.** `FOR UPDATE SKIP LOCKED` lets N workers drain the queue without
blocking each other — a locked league is skipped, not waited on:

```sql
WITH claimed AS (
  SELECT id
    FROM team_window_checkpoint_states
   WHERE sport = 'NFL'
     AND season = $1
     AND resolver_contract = $2
     AND (next_eligible_at IS NULL OR next_eligible_at <= timezone('UTC', CURRENT_TIMESTAMP))
     AND (lease_owner IS NULL OR lease_expires_at < timezone('UTC', CURRENT_TIMESTAMP))
   ORDER BY next_eligible_at NULLS FIRST
   LIMIT $3
   FOR UPDATE SKIP LOCKED
)
UPDATE team_window_checkpoint_states t
   SET lease_owner      = $4,
       lease_expires_at = timezone('UTC', CURRENT_TIMESTAMP) + INTERVAL '10 minutes'
  FROM claimed
 WHERE t.id = claimed.id
RETURNING t.id, t.league_id, t.season, t.resolver_contract, t.target_period_ordinal;
```

**Checkpoint rows for newly imported leagues.**

🛑 **Never period 1.** "No historical backfill" is not only about observations: a league
imported in week 10 that initializes at week 1 would spend nine periods deferring and then
recording nine skipped outcomes for weeks it was never present for. That is manufactured
history in the operational record.

```
targetPeriodOrdinal = first period whose settleEligibleAt >= league.activatedAt
```

- **New import:** the import commit path upserts one row per
  `(leagueId, season, activeContract)` on first successful commit, with the target computed
  as above and `nextEligibleAt` set to that period's `settleEligibleAt`.
- **Pre-existing leagues:** a one-time bootstrap creates rows at the **current or next**
  eligible period — never period 1.
- Upsert on `uniq_twcs_league_season_contract`, so a repeated import is a no-op.

**Cases requiring tests:** preseason import (target = period 1, legitimately); midseason
import (target = the next close, not period 1); postseason import (target = first period of
the *next* season); and a league first imported **after** the season ended (no row for the
finished season at all — there is nothing to observe).

**Lease renewal.** Assembly may exceed the lease. A heartbeat renews it every 60s while
assembling:

```sql
UPDATE team_window_checkpoint_states
   SET lease_expires_at = timezone('UTC', CURRENT_TIMESTAMP) + INTERVAL '10 minutes'
 WHERE league_id = $1 AND season = $2 AND lease_owner = $3 AND lease_expires_at > timezone('UTC', CURRENT_TIMESTAMP)
RETURNING id;   -- zero rows ⇒ lease lost ⇒ ABANDON, do not write
```

If the heartbeat returns zero rows the worker **abandons without writing**. Another worker
owns the league, and two writers producing the same period is what the transaction below
would otherwise have to sort out.

```sql
BEGIN;

-- 1. Serialize this league-period. Every writer takes this lock first.
SELECT id FROM team_window_checkpoint_states
 WHERE league_id = $1 AND season = $2
   FOR UPDATE;

-- 2. Inspect what is already accepted for this period and contract.
SELECT league_team_id, idempotency_key, content_hash
  FROM team_window_observations
 WHERE league_id = $1 AND season = $2
   AND period_type = $3 AND period_ordinal = $4
   AND resolver_contract = $5
   AND lifecycle = 'accepted';

-- 3. Compare against the expected rows, in application code:
--      same leagueTeamId + same idempotencyKey  -> IDEMPOTENT, skip
--      same leagueTeamId + DIFFERENT key/hash   -> ANOMALY: abort the whole transaction,
--                                                  record it, do NOT overwrite. A correction
--                                                  requires the §9 path and a stated reason.
--      absent                                    -> insert below

-- 4. Insert only the missing rows. Plain INSERT: step 2 already established what exists,
--    so a conflict here is a genuine race and SHOULD raise rather than be swallowed.
INSERT INTO team_window_observations (...) VALUES (...);

-- 4b. The referenced finality must still be accepted AND settled. FOR SHARE stops a
--     concurrent correction tombstoning it between this check and COMMIT.
SELECT id FROM league_period_finality
 WHERE id = $6 AND lifecycle = 'accepted' AND assessment_state = 'settled'
   FOR SHARE;
-- Zero rows -> ROLLBACK.

-- 5. Assert completeness by SET EQUALITY, not by count. Equal counts can still contain the
--    wrong team, which is exactly what a count check cannot see.
SELECT array_agg(league_team_id ORDER BY league_team_id) AS observed
  FROM team_window_observations
 WHERE league_id = $1 AND season = $2 AND period_type = $3 AND period_ordinal = $4
   AND resolver_contract = $5 AND lifecycle = 'accepted';
-- observed set <> expected active leagueTeamId set -> ROLLBACK. Compare the SETS.

-- 5b. Re-verify lease ownership INSIDE the transaction. A heartbeat before the transaction
--     proves nothing about ownership at COMMIT.
SELECT id FROM team_window_checkpoint_states
 WHERE league_id = $1 AND season = $2 AND resolver_contract = $5
   AND lease_owner = $7
   AND lease_expires_at > timezone('UTC', CURRENT_TIMESTAMP);
-- Zero rows -> ROLLBACK. Another worker owns this league.

-- 6. Only now mark the period complete, in the SAME transaction as the observations.
UPDATE team_window_checkpoint_states
   SET last_completed_period = $4,
       last_completed_at     = timezone('UTC', CURRENT_TIMESTAMP),
       consecutive_failures  = 0
 WHERE league_id = $1 AND season = $2;

COMMIT;
```

⚠ **`ON CONFLICT DO NOTHING` is deliberately not used here.** Swallowing a conflict and then
marking the period complete would mark it complete without knowing what caused the conflict
— which is exactly the case where an accepted row with *different* evidence exists and must
raise an anomaly instead.

---

## 9. Correction transaction

```sql
BEGIN;

-- 1. Lock the EXACT row the correction was built against, and only while it is accepted.
--    Including $7 is what makes a stale correction abort rather than supersede a newer one.
SELECT id
  FROM team_window_observations
 WHERE id                = $7          -- expectedPriorObservationId, supplied by the request
   AND league_id         = $1
   AND league_team_id    = $2
   AND season            = $3
   AND period_type       = $4
   AND period_ordinal    = $5
   AND resolver_contract = $6
   AND lifecycle         = 'accepted'
   FOR UPDATE;
-- Zero rows -> ABORT. Never existed, identity mismatch, or already superseded.

-- 2. Tombstone. Affected row count MUST be exactly 1; anything else aborts.
UPDATE team_window_observations
   SET lifecycle = 'superseded', superseded_at = timezone('UTC', CURRENT_TIMESTAMP)
 WHERE id = $7 AND lifecycle = 'accepted';

-- 3. Insert the replacement citing the superseded row.
INSERT INTO team_window_observations
       (..., lifecycle, checkpoint_type, supersedes_observation_id, correction_reason, correction_source_at, ...)
VALUES (..., 'accepted', 'stat_correction', $7, $8, $9, ...);

COMMIT;
```

| Scenario | Outcome |
| --- | --- |
| Two simultaneous corrections citing the same original | First commits. Second blocks on `FOR UPDATE`, then matches zero rows at step 1 and **aborts cleanly**. Unique `supersedes_observation_id` is the backstop. |
| Stale correction arriving after another commits | `$7` no longer accepted ⇒ zero rows ⇒ **abort**. Cannot supersede the newer correction. |
| Legitimate second correction citing the replacement | `$7` is the replacement's id, which is accepted ⇒ proceeds. Chain extends linearly. |
| Rollback after tombstone, before insert | One transaction; `ROLLBACK` restores `accepted` and `superseded_at = NULL`. **No period is ever left with zero accepted rows.** |

---

## 10. Deletion policy

**Audited call sites:**

| Path | Behaviour | Risk |
| --- | --- | --- |
| `lib/import-os/collector/applySleeperLeagueSync.ts:414` | **Hard-deletes unclaimed teams** absent from a complete authoritative response, during ordinary reconciliation | 🛑 A cascade would erase window history on a routine sync |
| Same file, ~line 400 | **Claimed** teams are never deleted — marked `isOrphan: true`, *"preserved, not deleted"* | none |
| `app/api/league/[leagueId]/route.ts:73` | User-initiated league deletion | privacy purge path |
| `lib/admin-dashboard/DuplicateManagerVerificationService.ts` | Admin dedupe cleanup | admin path |

`.eslintrc.json` **invariant 4** already states the convention — *"Hard delete is banned
outside the purge path. Deletable models carry `deletedAt`/`deletedBy`/`deleteReason`/
`purgeAfter`; only `commish_purge` deletes"* — but is scoped to `lib/domain/**`, which is
why the import collector still hard-deletes.

**Final design:**

1. **Prerequisite:** reconciliation **soft-deletes / archives** a missing `LeagueTeam`
   instead of erasing it. The mechanism (`isOrphan`), the column and the stated principle
   already exist for claimed teams; the change widens the branch to all teams.
2. **All three observation foreign keys use `onDelete: Restrict`** once that lands.
   Referential integrity is kept, and a delete that would destroy evidence fails loudly.
3. **Privacy deletion is an explicit audited purge transaction** — not a cascade. It
   deliberately deletes derived observations, in a stated order, with an audit record.
4. **No unconditional `League` or `LeagueTeam` cascade.** A database cascade cannot tell the
   privacy route from admin dedupe from a bug, and must not stand in for purge authorization.

🛑 **Until the reconciliation soft-delete ships, this migration is BLOCKED.** `Restrict`
against a path that hard-deletes would break Sleeper reconciliation with a foreign-key
error. Revision 4 resolved this by dropping the foreign key; that permanently removed
referential integrity to work around a temporary gap, and is not carried forward.

---

## 11. Active resolver contract

```ts
export const RESOLVER_VERSIONS = ['window-resolver-1'] as const
export const COEFFICIENT_VERSIONS = ['window-structural-1'] as const

export type ResolverVersion = typeof RESOLVER_VERSIONS[number]
export type CoefficientsVersion = typeof COEFFICIENT_VERSIONS[number]
export type ResolverContract = `${ResolverVersion}:${CoefficientsVersion}`

export const VALID_CONTRACTS: ReadonlySet<string> = new Set(
  RESOLVER_VERSIONS.flatMap(r => COEFFICIENT_VERSIONS.map(c => `${r}:${c}`)),
)

/** Fails closed at startup. An unknown contract must never reach a query. */
export function resolveActiveContract(env: NodeJS.ProcessEnv): ResolverContract {
  const configured = env.DECISION_OS_WINDOW_ACTIVE_CONTRACT
  if (!configured || !VALID_CONTRACTS.has(configured)) {
    throw new Error(`Refusing to start: unknown window resolver contract ${configured ?? '<unset>'}`)
  }
  return configured as ResolverContract
}
```

- One authoritative active contract **per environment**, resolved server-side, never from a
  caller.
- Every consumer query filters `WHERE resolver_contract = $active AND lifecycle = 'accepted'`.
  **Never** `ORDER BY created_at DESC LIMIT 1`.
- Zero rows for the active contract ⇒ **refusal**, never a row from another contract.
- A shadow contract may be written for comparison; it is never read while inactive.
- Promotion is an explicit configuration change and **resets persistence** — the new contract
  starts at zero consecutive periods, every decision `provisional` until three accumulate.

---

## 11.5 Bounded deferral — a league never retries one week forever

A period whose finality or projection evidence never arrives must not block every later
week. `deferralFirstAt` and `deferralAttempts` on the checkpoint row bound it:

| Bound | Value |
| --- | --- |
| Deadline | **`min(deferralFirstAt + 7 days, nextPeriodSettleEligibleAt)`** |
| Backoff | 1h, 2h, 4h … capped at 12h, written to `nextEligibleAt` |

⚠ **Shortened from 14 days.** A 14-day deadline holds the whole competitive-window system two
scoring periods behind on one missing week. The deadline now never outlives the *next*
period's settlement eligibility, so a league is at most one period behind before the queue
advances.

On the deadline, in one transaction:

1. Insert a `TeamWindowPeriodOutcome` — `outcome: 'skipped_unavailable'`, the terminal
   `reason` (e.g. `matchup_finality_unavailable`), `attempts`, `firstAttemptedAt`, `closedAt`.
2. Advance `targetPeriodOrdinal` to the next expected period.
3. Clear `deferralFirstAt` / `deferralAttempts`; set `nextEligibleAt` for the new target.
4. **Write no observation.** Nothing is fabricated.

Hysteresis then sees a period with no accepted observation and **breaks the streak** — the
same treatment as any missing period. Chimmy explains the gap from the outcome row: which
period, which reason, how many attempts, over what window. The operational history survives
even though no observation exists.

## 12. Hysteresis

**Settling a new classification** requires all five: three **accepted** observations; from
three **consecutive expected** periods; under the **same** `resolverContract`; supporting the
**same** material proposed status; with all deadband requirements satisfied.

A missing, deferred or refused period **breaks** the streak. It does not pause and resume.

**An already-settled classification** may be held as `held` — clearly stale — for at most
**two consecutive expected periods**. Beyond that: `refused`, neutral objective team-fit, gap
`window_settled_hold_expired`. Missing evidence never changes a settled status and never
counts as agreement.

**Refusal vs deferral:**

| Situation | Result |
| --- | --- |
| Missing / stale / **global upstream** evidence | **Defer the league. No observation.** |
| Upstream complete, **one team** fails a value/identity/coverage gate | **Accepted-lifecycle row**, `decisionState = 'refused'`, `observedStatus = NULL`, named gaps |

A refused observation is terminal: it occupies the accepted key, preserves why, and breaks
the streak. A period is complete only when **every active team** has a terminal observation.

---

## 13. Forward migration SQL

`prisma/migrations-pending/<ts>_team_window_observations/migration.sql`.
🛑 **BLOCKED** on §10's reconciliation soft-delete landing in the target branch (§20).
Additive. **Not applied to production. No backfill.**

**Layer 1 is generated, not written.** Produced by
`prisma migrate diff --from-schema-datamodel <base> --to-schema-datamodel <iso> --script`
against the schema that passed `prisma validate` (§18). No revision-5 SQL survives.
All four tables are created before any `ALTER`, so dependency order is safe by construction.

**Layer 2 is only what Prisma cannot express**: partial unique indexes, CHECK constraints and
the immutability triggers.

```sql
-- CreateTable
CREATE TABLE "league_period_finality" (
    "id" TEXT NOT NULL,
    "league_id" TEXT NOT NULL,
    "platform" VARCHAR(32) NOT NULL,
    "platform_league_id" VARCHAR(128) NOT NULL,
    "sport" VARCHAR(16) NOT NULL,
    "season" INTEGER NOT NULL,
    "period_type" VARCHAR(16) NOT NULL,
    "period_ordinal" INTEGER NOT NULL,
    "lifecycle" VARCHAR(16) NOT NULL,
    "assessment_state" VARCHAR(16) NOT NULL,
    "revision" INTEGER NOT NULL,
    "revision_reason" VARCHAR(32) NOT NULL,
    "expected_roster_ids" JSONB NOT NULL,
    "observed_roster_ids" JSONB NOT NULL,
    "expected_roster_set_hash" VARCHAR(64) NOT NULL,
    "observed_roster_set_hash" VARCHAR(64) NOT NULL,
    "expected_roster_count" INTEGER NOT NULL,
    "observed_roster_count" INTEGER NOT NULL,
    "missing_roster_ids" JSONB NOT NULL,
    "roster_team_map" JSONB NOT NULL,
    "pairing_outcome" VARCHAR(32) NOT NULL,
    "pairing_anomalies" JSONB,
    "provider_season" VARCHAR(16),
    "provider_week" INTEGER,
    "provider_leg" INTEGER,
    "provider_season_type" VARCHAR(24),
    "platform_advanced" BOOLEAN,
    "scheduled_events_total" INTEGER,
    "scheduled_events_complete" INTEGER,
    "scheduled_events_status" VARCHAR(24),
    "finality_method" VARCHAR(40) NOT NULL,
    "provenance" VARCHAR(24) NOT NULL,
    "refusal_reason" VARCHAR(64),
    "source_observed_at" TIMESTAMP(3) NOT NULL,
    "settle_eligible_at" TIMESTAMP(3),
    "correction_window_ends_at" TIMESTAMP(3),
    "content_hash" VARCHAR(64) NOT NULL,
    "supersedes_finality_id" TEXT,
    "correction_reason" VARCHAR(200),
    "correction_source_at" TIMESTAMP(3),
    "superseded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "league_period_finality_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_window_observations" (
    "id" TEXT NOT NULL,
    "league_id" TEXT NOT NULL,
    "league_team_id" TEXT NOT NULL,
    "platform" VARCHAR(32) NOT NULL,
    "platform_league_id" VARCHAR(128) NOT NULL,
    "sport" VARCHAR(16) NOT NULL,
    "source_team_id" VARCHAR(64) NOT NULL,
    "source_roster_id" VARCHAR(64),
    "season" INTEGER NOT NULL,
    "period_type" VARCHAR(16) NOT NULL,
    "period_ordinal" INTEGER NOT NULL,
    "lifecycle" VARCHAR(16) NOT NULL,
    "checkpoint_type" VARCHAR(24) NOT NULL,
    "resolver_version" VARCHAR(32) NOT NULL,
    "coefficients_version" VARCHAR(32) NOT NULL,
    "resolver_contract" VARCHAR(80) NOT NULL,
    "content_hash" VARCHAR(64) NOT NULL,
    "idempotency_key" VARCHAR(64) NOT NULL,
    "observed_status" VARCHAR(16),
    "decision_state" VARCHAR(16) NOT NULL,
    "now_score" DOUBLE PRECISION,
    "future_score" DOUBLE PRECISION,
    "actual_win_rate" DOUBLE PRECISION,
    "earned_win_rate" DOUBLE PRECISION,
    "schedule_luck_delta" DOUBLE PRECISION,
    "source_confidence" DOUBLE PRECISION,
    "pick_treatment" VARCHAR(32) NOT NULL,
    "injury_treatment" VARCHAR(48) NOT NULL,
    "facts" JSONB NOT NULL,
    "facts_schema_version" INTEGER NOT NULL,
    "gaps" JSONB,
    "finality_id" TEXT NOT NULL,
    "forecast_snapshot_id" TEXT,
    "dynasty_snapshot_id" TEXT,
    "scoring_settings_snapshot_id" TEXT,
    "matchup_source_at" TIMESTAMP(3),
    "forecast_generated_at" TIMESTAMP(3),
    "dynasty_generated_at" TIMESTAMP(3),
    "injury_observed_at" TIMESTAMP(3),
    "roster_observed_at" TIMESTAMP(3),
    "supersedes_observation_id" TEXT,
    "correction_reason" VARCHAR(200),
    "correction_source_at" TIMESTAMP(3),
    "superseded_at" TIMESTAMP(3),
    "observed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_window_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_window_checkpoint_states" (
    "id" TEXT NOT NULL,
    "league_id" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "sport" VARCHAR(16) NOT NULL,
    "resolver_contract" VARCHAR(80) NOT NULL,
    "target_period_ordinal" INTEGER,
    "last_attempted_period" INTEGER,
    "last_attempted_at" TIMESTAMP(3),
    "last_completed_period" INTEGER,
    "last_completed_at" TIMESTAMP(3),
    "last_deferred_period" INTEGER,
    "last_deferred_reason" VARCHAR(64),
    "deferral_first_at" TIMESTAMP(3),
    "deferral_attempts" INTEGER NOT NULL DEFAULT 0,
    "last_failed_at" TIMESTAMP(3),
    "last_error_category" VARCHAR(48),
    "next_eligible_at" TIMESTAMP(3),
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "lease_owner" VARCHAR(64),
    "lease_expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "team_window_checkpoint_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_window_period_outcomes" (
    "id" TEXT NOT NULL,
    "league_id" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "period_type" VARCHAR(16) NOT NULL,
    "period_ordinal" INTEGER NOT NULL,
    "resolver_contract" VARCHAR(80) NOT NULL,
    "outcome" VARCHAR(24) NOT NULL,
    "reason" VARCHAR(64) NOT NULL,
    "attempts" INTEGER NOT NULL,
    "first_attempted_at" TIMESTAMP(3) NOT NULL,
    "closed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_window_period_outcomes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uniq_lpf_supersedes" ON "league_period_finality"("supersedes_finality_id");

-- CreateIndex
CREATE INDEX "lpf_state_observed_idx" ON "league_period_finality"("assessment_state", "source_observed_at");

-- CreateIndex
CREATE INDEX "lpf_sport_season_idx" ON "league_period_finality"("sport", "season", "period_ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "uniq_lpf_supersedes_identity" ON "league_period_finality"("supersedes_finality_id", "league_id", "season", "period_type", "period_ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "uniq_lpf_identity_content" ON "league_period_finality"("league_id", "season", "period_type", "period_ordinal", "content_hash");

-- CreateIndex
CREATE UNIQUE INDEX "uniq_lpf_identity_row" ON "league_period_finality"("id", "league_id", "season", "period_type", "period_ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "uniq_twobs_supersedes" ON "team_window_observations"("supersedes_observation_id");

-- CreateIndex
CREATE INDEX "twobs_league_season_period_idx" ON "team_window_observations"("league_id", "season", "period_ordinal");

-- CreateIndex
CREATE INDEX "twobs_team_season_period_idx" ON "team_window_observations"("league_team_id", "season", "period_ordinal");

-- CreateIndex
CREATE INDEX "twobs_hysteresis_idx" ON "team_window_observations"("league_id", "league_team_id", "season", "resolver_contract", "period_ordinal");

-- CreateIndex
CREATE INDEX "twobs_lifecycle_state_idx" ON "team_window_observations"("lifecycle", "decision_state");

-- CreateIndex
CREATE INDEX "twobs_finality_idx" ON "team_window_observations"("finality_id");

-- CreateIndex
CREATE INDEX "twobs_created_at_idx" ON "team_window_observations"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "uniq_twobs_supersedes_identity" ON "team_window_observations"("supersedes_observation_id", "league_id", "league_team_id", "season", "period_type", "period_ordinal", "resolver_contract");

-- CreateIndex
CREATE UNIQUE INDEX "uniq_twobs_idempotency_key" ON "team_window_observations"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "uniq_twobs_identity_content" ON "team_window_observations"("league_id", "league_team_id", "season", "period_type", "period_ordinal", "resolver_contract", "content_hash");

-- CreateIndex
CREATE UNIQUE INDEX "uniq_twobs_identity_row" ON "team_window_observations"("id", "league_id", "league_team_id", "season", "period_type", "period_ordinal", "resolver_contract");

-- CreateIndex
CREATE INDEX "twcs_next_eligible_idx" ON "team_window_checkpoint_states"("next_eligible_at");

-- CreateIndex
CREATE INDEX "twcs_sport_season_next_idx" ON "team_window_checkpoint_states"("sport", "season", "next_eligible_at");

-- CreateIndex
CREATE UNIQUE INDEX "uniq_twcs_league_season_contract" ON "team_window_checkpoint_states"("league_id", "season", "resolver_contract");

-- CreateIndex
CREATE INDEX "twpo_outcome_closed_idx" ON "team_window_period_outcomes"("outcome", "closed_at");

-- CreateIndex
CREATE UNIQUE INDEX "uniq_twpo_league_period_contract" ON "team_window_period_outcomes"("league_id", "season", "period_type", "period_ordinal", "resolver_contract");

-- AddForeignKey
ALTER TABLE "league_period_finality" ADD CONSTRAINT "lpf_supersedes_identity_fk" FOREIGN KEY ("supersedes_finality_id", "league_id", "season", "period_type", "period_ordinal") REFERENCES "league_period_finality"("id", "league_id", "season", "period_type", "period_ordinal") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "league_period_finality" ADD CONSTRAINT "lpf_league_fk" FOREIGN KEY ("league_id") REFERENCES "leagues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_window_observations" ADD CONSTRAINT "twobs_supersedes_identity_fk" FOREIGN KEY ("supersedes_observation_id", "league_id", "league_team_id", "season", "period_type", "period_ordinal", "resolver_contract") REFERENCES "team_window_observations"("id", "league_id", "league_team_id", "season", "period_type", "period_ordinal", "resolver_contract") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_window_observations" ADD CONSTRAINT "twobs_league_fk" FOREIGN KEY ("league_id") REFERENCES "leagues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_window_observations" ADD CONSTRAINT "twobs_team_fk" FOREIGN KEY ("league_team_id") REFERENCES "league_teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_window_observations" ADD CONSTRAINT "twobs_finality_identity_fk" FOREIGN KEY ("finality_id", "league_id", "season", "period_type", "period_ordinal") REFERENCES "league_period_finality"("id", "league_id", "season", "period_type", "period_ordinal") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_window_checkpoint_states" ADD CONSTRAINT "twcs_league_fk" FOREIGN KEY ("league_id") REFERENCES "leagues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_window_period_outcomes" ADD CONSTRAINT "twpo_league_fk" FOREIGN KEY ("league_id") REFERENCES "leagues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- Layer 2: objects Prisma cannot express. Applied AFTER the generated DDL.
-- Partial unique indexes, CHECK constraints, immutability triggers.
-- ============================================================================

-- ---------------------------------------------------------------- finality
CREATE UNIQUE INDEX "uniq_lpf_accepted"
  ON "league_period_finality" ("league_id","season","period_type","period_ordinal")
  WHERE "lifecycle" = 'accepted';

ALTER TABLE "league_period_finality"
  ADD CONSTRAINT "lpf_lifecycle_chk"         CHECK ("lifecycle" IN ('accepted','superseded')),
  ADD CONSTRAINT "lpf_state_chk"             CHECK ("assessment_state" IN ('provisional','settled','refused')),
  ADD CONSTRAINT "lpf_revision_chk"          CHECK ("revision" >= 1),
  ADD CONSTRAINT "lpf_revision_reason_chk"   CHECK ("revision_reason" IN
      ('source_refresh','became_settled','stat_correction','commissioner_correction','manual_review')),
  ADD CONSTRAINT "lpf_pairing_outcome_chk"   CHECK ("pairing_outcome" IN
      ('valid_pair','valid_bye','invalid_duplicate_roster','invalid_oversized_group',
       'invalid_missing_roster','unsupported_structure')),
  ADD CONSTRAINT "lpf_period_type_chk"       CHECK ("period_type" IN ('week')),
  ADD CONSTRAINT "lpf_sport_chk"             CHECK ("sport" = 'NFL'),
  ADD CONSTRAINT "lpf_ordinal_chk"           CHECK ("period_ordinal" BETWEEN 1 AND 25),
  ADD CONSTRAINT "lpf_counts_chk"            CHECK ("expected_roster_count" >= 0 AND "observed_roster_count" >= 0),
  ADD CONSTRAINT "lpf_provenance_chk"        CHECK ("provenance" IN ('provider_reported','inferred','mixed')),
  ADD CONSTRAINT "lpf_method_chk"            CHECK ("finality_method" IN
      ('sleeper_inferred_composite','sleeper_inferred_partial','provider_reported','schedule_only','unavailable')),
  -- Sleeper reports no finality; an inferred method may never claim provider provenance.
  ADD CONSTRAINT "lpf_method_provenance_chk" CHECK (
      ("finality_method" NOT LIKE 'sleeper_inferred%') OR ("provenance" = 'inferred')),
  ADD CONSTRAINT "lpf_refusal_chk"           CHECK (("assessment_state" <> 'refused') OR ("refusal_reason" IS NOT NULL)),
  ADD CONSTRAINT "lpf_accepted_chk"          CHECK (("lifecycle" <> 'accepted')   OR ("superseded_at" IS NULL)),
  ADD CONSTRAINT "lpf_superseded_chk"        CHECK (("lifecycle" <> 'superseded') OR ("superseded_at" IS NOT NULL)),
  ADD CONSTRAINT "lpf_no_self_supersede_chk" CHECK ("supersedes_finality_id" IS NULL OR "supersedes_finality_id" <> "id"),
  -- Revision 1 originates; every later revision must cite its predecessor.
  ADD CONSTRAINT "lpf_correction_chk"        CHECK (
      ("revision" = 1 AND "supersedes_finality_id" IS NULL AND "revision_reason" = 'source_refresh')
   OR ("revision" > 1 AND "supersedes_finality_id" IS NOT NULL)),
  -- A true correction carries a reason and a source timestamp; progression does not.
  ADD CONSTRAINT "lpf_correction_meta_chk"   CHECK (
      ("revision_reason" NOT IN ('stat_correction','commissioner_correction','manual_review'))
   OR ("correction_reason" IS NOT NULL AND "correction_source_at" IS NOT NULL));

-- ---------------------------------------------------------------- observations
CREATE UNIQUE INDEX "uniq_twobs_accepted"
  ON "team_window_observations"
     ("league_id","league_team_id","season","period_type","period_ordinal","resolver_contract")
  WHERE "lifecycle" = 'accepted';

ALTER TABLE "team_window_observations"
  ADD CONSTRAINT "twobs_lifecycle_chk"        CHECK ("lifecycle" IN ('accepted','superseded')),
  ADD CONSTRAINT "twobs_checkpoint_chk"       CHECK ("checkpoint_type" IN ('weekly_close','stat_correction')),
  ADD CONSTRAINT "twobs_decision_state_chk"   CHECK ("decision_state" IN ('provisional','evidenced','held','refused')),
  ADD CONSTRAINT "twobs_status_chk"           CHECK ("observed_status" IS NULL OR "observed_status" IN
      ('contender','rising','competitive','declining','rebuilding')),
  ADD CONSTRAINT "twobs_refused_status_chk"   CHECK (("decision_state" <> 'refused') OR ("observed_status" IS NULL)),
  ADD CONSTRAINT "twobs_period_type_chk"      CHECK ("period_type" IN ('week')),
  ADD CONSTRAINT "twobs_sport_chk"            CHECK ("sport" = 'NFL'),
  ADD CONSTRAINT "twobs_ordinal_chk"          CHECK ("period_ordinal" BETWEEN 1 AND 25),
  ADD CONSTRAINT "twobs_pick_treatment_chk"   CHECK ("pick_treatment" = 'included-in-roster-strength'),
  ADD CONSTRAINT "twobs_injury_treatment_chk" CHECK ("injury_treatment" IN ('excluded','included-in-playoff-probability')),
  ADD CONSTRAINT "twobs_facts_version_chk"    CHECK ("facts_schema_version" = 1),
  ADD CONSTRAINT "twobs_correction_required_chk" CHECK (
      ("checkpoint_type" <> 'stat_correction')
   OR ("supersedes_observation_id" IS NOT NULL
       AND "correction_reason" IS NOT NULL
       AND "correction_source_at" IS NOT NULL)),
  ADD CONSTRAINT "twobs_weekly_close_clean_chk" CHECK (
      ("checkpoint_type" <> 'weekly_close')
   OR ("supersedes_observation_id" IS NULL
       AND "correction_reason" IS NULL
       AND "correction_source_at" IS NULL)),
  ADD CONSTRAINT "twobs_accepted_not_superseded_chk" CHECK (("lifecycle" <> 'accepted')   OR ("superseded_at" IS NULL)),
  ADD CONSTRAINT "twobs_superseded_chk"              CHECK (("lifecycle" <> 'superseded') OR ("superseded_at" IS NOT NULL)),
  ADD CONSTRAINT "twobs_no_self_supersede_chk"       CHECK ("supersedes_observation_id" IS NULL OR "supersedes_observation_id" <> "id");

-- ---------------------------------------------------------------- checkpoint state
ALTER TABLE "team_window_checkpoint_states"
  ADD CONSTRAINT "twcs_sport_chk"    CHECK ("sport" = 'NFL'),
  ADD CONSTRAINT "twcs_failures_chk" CHECK ("consecutive_failures" >= 0),
  ADD CONSTRAINT "twcs_deferral_attempts_chk" CHECK ("deferral_attempts" >= 0),
  ADD CONSTRAINT "twcs_deferred_reason_chk" CHECK ("last_deferred_reason" IS NULL OR "last_deferred_reason" IN
      ('matchup_finality_unavailable','matchup_not_final','forecast_missing','forecast_stale',
       'dynasty_missing','dynasty_stale','injury_stale','injury_coverage_low',
       'sport_not_supported','no_active_teams','lease_lost')),
  ADD CONSTRAINT "twcs_error_category_chk" CHECK ("last_error_category" IS NULL OR "last_error_category" IN
      ('db_error','assembly_error','validation_error','anomaly_conflicting_evidence','timeout','unknown'));

-- ---------------------------------------------------------------- period outcomes
ALTER TABLE "team_window_period_outcomes"
  ADD CONSTRAINT "twpo_outcome_chk"     CHECK ("outcome" IN ('skipped_unavailable','skipped_no_active_teams')),
  ADD CONSTRAINT "twpo_attempts_chk"    CHECK ("attempts" >= 1),
  ADD CONSTRAINT "twpo_period_type_chk" CHECK ("period_type" IN ('week'));

-- ---------------------------------------------------------------- immutability
CREATE OR REPLACE FUNCTION twobs_reject_mutation() RETURNS trigger AS $$
BEGIN
  IF OLD.lifecycle <> 'accepted' OR NEW.lifecycle <> 'superseded' THEN
    RAISE EXCEPTION 'team_window_observations is append-only: only accepted -> superseded is permitted';
  END IF;
  IF OLD.superseded_at IS NOT NULL OR NEW.superseded_at IS NULL THEN
    RAISE EXCEPTION 'superseded_at must transition from NULL to a timestamp exactly once';
  END IF;
  IF to_jsonb(OLD) - 'lifecycle' - 'superseded_at'
     IS DISTINCT FROM to_jsonb(NEW) - 'lifecycle' - 'superseded_at' THEN
    RAISE EXCEPTION 'team_window_observations evidence columns are immutable';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER "twobs_immutable" BEFORE UPDATE ON "team_window_observations"
  FOR EACH ROW EXECUTE FUNCTION twobs_reject_mutation();

CREATE OR REPLACE FUNCTION lpf_reject_mutation() RETURNS trigger AS $$
BEGIN
  IF OLD.lifecycle <> 'accepted' OR NEW.lifecycle <> 'superseded' THEN
    RAISE EXCEPTION 'league_period_finality is append-only: only accepted -> superseded is permitted';
  END IF;
  IF OLD.superseded_at IS NOT NULL OR NEW.superseded_at IS NULL THEN
    RAISE EXCEPTION 'superseded_at must transition from NULL to a timestamp exactly once';
  END IF;
  IF to_jsonb(OLD) - 'lifecycle' - 'superseded_at'
     IS DISTINCT FROM to_jsonb(NEW) - 'lifecycle' - 'superseded_at' THEN
    RAISE EXCEPTION 'league_period_finality evidence columns are immutable';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER "lpf_immutable" BEFORE UPDATE ON "league_period_finality"
  FOR EACH ROW EXECUTE FUNCTION lpf_reject_mutation();
```

---

## 14. Rollback SQL

Guarded, dependency-ordered, **no `CASCADE`**. Drops triggers before their functions, and the
dependent `team_window_observations` before `league_period_finality`.

```sql
-- ============================================================================
-- Rollback for the milestone 19 observation migration.
-- Guarded, narrowly scoped, dependency-ordered. NO `CASCADE` anywhere.
-- ============================================================================

-- Refuse rather than destroy if anything unexpected references these tables.
DO $$
DECLARE dep_count INT;
BEGIN
  SELECT count(*) INTO dep_count
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.confrelid
   WHERE t.relname IN ('team_window_observations','team_window_checkpoint_states',
                       'team_window_period_outcomes','league_period_finality')
     AND c.conrelid NOT IN ('team_window_observations'::regclass,
                            'team_window_checkpoint_states'::regclass,
                            'team_window_period_outcomes'::regclass,
                            'league_period_finality'::regclass);
  IF dep_count > 0 THEN
    RAISE EXCEPTION 'Refusing rollback: % unexpected dependent constraint(s) found', dep_count;
  END IF;
END $$;

-- Triggers first: they reference the functions dropped below.
DROP TRIGGER IF EXISTS "twobs_immutable" ON "team_window_observations";
DROP TRIGGER IF EXISTS "lpf_immutable"   ON "league_period_finality";
DROP FUNCTION IF EXISTS twobs_reject_mutation();
DROP FUNCTION IF EXISTS lpf_reject_mutation();

-- Partial unique indexes (layered separately from the generated DDL).
DROP INDEX IF EXISTS "uniq_twobs_accepted";
DROP INDEX IF EXISTS "uniq_lpf_accepted";

-- Dependent table first: observations reference finality, leagues and league_teams.
DROP TABLE IF EXISTS "team_window_observations";
DROP TABLE IF EXISTS "team_window_period_outcomes";
DROP TABLE IF EXISTS "team_window_checkpoint_states";
DROP TABLE IF EXISTS "league_period_finality";

-- Test helpers, when the disposable-database harness created them.
DROP FUNCTION IF EXISTS must_fail(text, text);
DROP FUNCTION IF EXISTS must_pass(text, text);
```

**What a rollback loses:** every observation and facts payload, every finality assessment and
its revision chain, all checkpoint cursors and lease state, and every recorded skipped-period
outcome. None is recoverable — historical observations cannot be recreated, which is the same
reason backfill is prohibited. **Export all four tables first** if the evidence is wanted for
milestones 40–44. Consumers fall back to neutral objective team-fit, so the product degrades
honestly rather than breaking.

**Verified on a real database** (§19): after rollback, all four tables, both partial indexes,
both triggers, both trigger functions and all 42 CHECK constraints are gone, and all 717 base
tables remain.

---

## 15. Capacity

```
accepted rows/season = leagues × active_teams × periods × resolver_contracts
```

NFL v1: 18 periods × ~12 teams × 1 contract ≈ **216 accepted observations per
league-season**, plus **18 finality rows** and **1 checkpoint-state row**.

| Component | Per accepted row |
| --- | --- |
| Heap tuple | 0.6 – 0.9 KB |
| `facts` JSONB (~55 fields) | 1.5 – 4 KB; TOAST-compressed above ~2 KB |
| `gaps` JSONB | 0.05 – 0.3 KB |
| Eleven indexes | 0.4 – 0.9 KB amortised |
| Page/fillfactor overhead | +10 – 20% |
| **Total** | **≈ 2.5 – 6 KB** |

Multipliers: +~5% for corrections (assumed, unmeasured); **×N for N concurrent resolver
contracts**.

| Leagues | Observations/season | Storage/season |
| --- | --- | --- |
| 1,000 | ~216k | ~0.5 – 1.3 GB |
| 10,000 | ~2.16M | ~5.4 – 13 GB |

⚠ **Planning estimates requiring measurement** via `pg_total_relation_size` on a
representative load. ⚠ **The league count is not asserted** — that needs a production read,
out of scope here.

**Retention: keep everything**, including superseded rows. These are the evidence base for
milestones 40–44; pruning them deletes the training corpus. Revisit only with product
approval and a stated horizon.

---

## 16. Tests

**Unit (pure, implementable now):** JCS canonicalization stability across runs and machines;
rejection of `undefined`, `NaN`, `±Infinity`, `Date`/`Map`/`Set`/`BigInt`, unknown units;
per-field quantization applied and no blanket rounding; `gaps` sorted inside normalization;
`contentHash` collision between two teams with identical evidence; `idempotencyKey`
distinguishing them; active-contract validation failing closed on an unknown value; consumer
never falling back to another contract; refusal vs deferral classification; period
completeness with a refused team; streak break on a missing period; settled-hold expiry at
two periods; persistence reset on contract change; provisional-not-settled on first
observation; neutral team-fit before settlement; user strategy separate and immediate.

**Finality (unit + adapter):** completeness measured against active roster ids, not
`size / 2`; pairing validation independent of completeness; odd-sized league; a bye/orphaned
team excluded from expected; Sleeper never labelled `provider_reported`; unimplemented
provider yields `unavailable` + defer; `SportsGame` deduped per fixture before counting.

**Concurrency (real test database):** two simultaneous corrections on one original; stale
correction after commit; legitimate second correction on the replacement; rollback after
tombstone before insert leaves exactly one accepted row; two workers racing a lease claim;
lease lost mid-assembly ⇒ abandon without writing; duplicate checkpoint run inserts nothing
and does not re-complete; accepted row with **different** evidence raises an anomaly and
rolls back rather than overwriting.

**Timezone (real test database):** every one of the above re-run under
`SET timezone = 'America/Los_Angeles'` — finality gates, freshness, lease expiry and
correction ordering must be byte-identical to the UTC run; startup check rejects a non-UTC
session.

**Migration (real test database):** partial unique index permits many superseded rows and
exactly one accepted; `uniq_twobs_supersedes` rejects a branch; composite identity FK rejects
a cross-identity correction; every CHECK rejects its violation; `RESTRICT` blocks a
`LeagueTeam` delete that would orphan observations; guarded rollback refuses on an unexpected
dependent; `timestamp(3)` comparisons against `SeasonForecastSnapshot.generatedAt` behave as
intended.

**Consumer:** two sides of one trade receive different windows; market-value payload
byte-identical across opposite windows; resolver runs once per team per request, not per
asset; refusal yields neutral team-fit with named gaps.

---

## 18. Prisma validation evidence

Run against an **isolated temporary schema assembled from committed `origin/main`**, never
the active modified file. Base: `git show origin/main:prisma/schema.prisma` (739,602 bytes,
0 occurrences of `Timestamptz`). The four proposed models and the four reverse-relation
fields were appended to that copy in a scratch directory outside the repository.

Prisma CLI 5.22.0 / `@prisma/client` 5.22.0.

| Command | Exit |
| --- | --- |
| `prisma validate --schema <iso>` (first attempt) | **1** |
| `prisma validate --schema <iso>` (after fix) | **0** |
| `prisma format --schema <iso>` | **0** |
| `prisma migrate diff --from-schema-datamodel <base> --to-schema-datamodel <iso> --script` | **0** |
| `prisma migrate diff` base → base (control) | **0**, `-- This is an empty migration.` |

### 18.1 The diagnostic that changed the design

The first validate failed, and its message is the reason `uniq_twobs_supersedes_identity`
exists:

```
Error code: P1012
error: Error parsing attribute "@relation": A one-to-one relation must use unique fields on
the defining side. Either add an `@@unique([supersedesObservationId, leagueId, leagueTeamId,
season, periodType, periodOrdinal, resolverContract])` attribute to the model, or change the
relation to one-to-many.
Validation Error Count: 1
```

Revision 5 declared a **simple** relation in Prisma and a **composite** foreign key in SQL —
the two did not describe the same thing. Expressing the composite self-relation in Prisma
surfaced the requirement immediately. `supersededBy` is now singular
(`TeamWindowObservation?`), matching the one-to-one that `@unique` on the foreign key
already implied.

### 18.2 Generated DDL matches the handwritten migration

Without `map:`, Prisma names foreign keys and single-column uniques itself, and **truncates
at Postgres's 63-character identifier limit**:

```
team_window_observations_finality_id_league_id_season_peri_fkey
team_window_observations_supersedes_observation_id_league__fkey
```

Both composite keys were truncated mid-word — a collision hazard as well as a mismatch with
the handwritten SQL. With explicit `map:` on every relation and unique, all 29 generated
identifiers are the intended names:

```
lpf_league_fk · lpf_supersedes_fk · lpf_sport_season_idx · lpf_state_observed_idx
twobs_league_fk · twobs_team_fk · twobs_finality_identity_fk · twobs_supersedes_identity_fk
twcs_league_fk · twpo_league_fk
uniq_lpf_identity_content · uniq_lpf_identity_row · uniq_lpf_supersedes
uniq_twobs_idempotency_key · uniq_twobs_identity_content · uniq_twobs_identity_row
uniq_twobs_supersedes · uniq_twobs_supersedes_identity
uniq_twcs_league_season_contract · uniq_twpo_league_period_contract
twobs_created_at_idx · twobs_finality_idx · twobs_hysteresis_idx
twobs_league_season_period_idx · twobs_lifecycle_state_idx · twobs_team_season_period_idx
twcs_next_eligible_idx · twcs_sport_season_next_idx · twpo_outcome_closed_idx
```

Composite foreign keys, exactly as generated:

```sql
ALTER TABLE "team_window_observations" ADD CONSTRAINT "twobs_finality_identity_fk"
  FOREIGN KEY ("finality_id","league_id","season","period_type","period_ordinal")
  REFERENCES "league_period_finality"("id","league_id","season","period_type","period_ordinal")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "team_window_observations" ADD CONSTRAINT "twobs_supersedes_identity_fk"
  FOREIGN KEY ("supersedes_observation_id","league_id","league_team_id","season","period_type","period_ordinal","resolver_contract")
  REFERENCES "team_window_observations"("id","league_id","league_team_id","season","period_type","period_ordinal","resolver_contract")
  ON DELETE RESTRICT ON UPDATE CASCADE;
```

### 18.3 Drift

The diff is **purely additive**: 4 `CREATE TABLE`, 11 `CREATE INDEX`, 10
`CREATE UNIQUE INDEX`, 8 `ALTER TABLE ... ADD CONSTRAINT` — every one against a new table.
**Zero** statements touch an existing table.

The base-against-itself control returns `-- This is an empty migration.`, which is what
proves the diff would have reported drift had any existed. A diff tool that has never
reported a difference is not evidence.

### 18.4 What this does and does not prove

**Proves:** the Prisma models parse, validate and format; the composite relations are
expressible in Prisma rather than only in SQL; generated constraint names match the
handwritten migration; the change is additive against committed `origin/main`.

**Does not prove:** anything about partial unique indexes, CHECK constraints or the
immutability triggers — Prisma cannot express these, so they are hand-written in the
migration and remain **unvalidated until executed against a real test database**. Nor does
it prove behaviour: no row was written and no database was touched.

---

## 18.5 Finality-correction transaction

An accepted, settled finality revision whose evidence changes cannot simply be updated: it is
referenced by observations, and rewriting it would rewrite their evidence.

🛑 **Every team is recomputed, not only the corrected matchup.** All-play and schedule-luck
are league-wide: change one matchup's points and the earned record moves for **every** team
in the period. Correcting only the directly affected teams would leave the rest citing an
assessment that no longer holds.

```sql
BEGIN;

-- 1. Lock the EXACT accepted finality revision the correction was built against.
SELECT id, revision
  FROM league_period_finality
 WHERE id = $1                      -- expectedPriorFinalityId, from the request
   AND league_id = $2 AND season = $3 AND period_type = $4 AND period_ordinal = $5
   AND lifecycle = 'accepted'
   FOR UPDATE;
-- Zero rows -> ABORT. Already superseded, or identity mismatch. A stale correction ends here.

-- 2. Tombstone it. Affected rows MUST be exactly 1.
UPDATE league_period_finality
   SET lifecycle = 'superseded', superseded_at = timezone('UTC', CURRENT_TIMESTAMP)
 WHERE id = $1 AND lifecycle = 'accepted';

-- 3. Insert the replacement revision. `revision` MUST be prior.revision + 1, and the
--    composite FK forces the same league/season/period.
INSERT INTO league_period_finality
       (id, league_id, season, period_type, period_ordinal, lifecycle, assessment_state,
        revision, revision_reason, supersedes_finality_id, correction_reason,
        correction_source_at, ...)
VALUES ($6, $2, $3, $4, $5, 'accepted', $7,
        $8 /* = prior.revision + 1 */, $9 /* stat_correction | commissioner_correction | ... */,
        $1, $10, $11, ...);

-- 4. Load every accepted observation for this league-period under the active contract, and
--    capture the team set for the equality check in step 7.
SELECT id, league_team_id
  FROM team_window_observations
 WHERE league_id = $2 AND season = $3 AND period_type = $4 AND period_ordinal = $5
   AND resolver_contract = $12 AND lifecycle = 'accepted'
   FOR UPDATE;

-- 5. Recompute EVERY team against the new finality evidence (application code, no I/O here).

-- 6. Tombstone all priors, then insert one replacement per team, each citing its own
--    predecessor and the NEW finality id.
UPDATE team_window_observations
   SET lifecycle = 'superseded', superseded_at = timezone('UTC', CURRENT_TIMESTAMP)
 WHERE id = ANY($13) AND lifecycle = 'accepted';
-- affected rows MUST equal array_length($13)

INSERT INTO team_window_observations
       (..., lifecycle, checkpoint_type, supersedes_observation_id, finality_id,
        correction_reason, correction_source_at, ...)
VALUES (..., 'accepted', 'stat_correction', <its own predecessor>, $6, $10, $11, ...);

-- 7. The new team set must equal the old team set. A correction changes evidence, never
--    membership; a differing set means the recompute lost or invented a team.
--    old set <> new set -> ROLLBACK.

COMMIT;
```

Any failure rolls the whole thing back: the prior finality returns to `accepted` with
`superseded_at` null, and every prior observation with it. There is never an instant where a
period has no accepted finality or a partially corrected observation set.

**`revision_reason` separates progression from correction**, so a provisional assessment
becoming settled is not mislabelled as a stat correction:

| Reason | Meaning | Correction metadata |
| --- | --- | --- |
| `source_refresh` | Revision 1, or a re-read with no state change | not required |
| `became_settled` | `provisional` → `settled`; the gates now pass | not required |
| `stat_correction` | The provider restated statistics | **required** |
| `commissioner_correction` | A commissioner edited `custom_points` | **required** |
| `manual_review` | An operator intervened | **required** |

Enforced by `lpf_correction_meta_chk`: the last three demand `correction_reason` and
`correction_source_at`; the first two do not.

---

## 18.6 Checkpoint state transitions

⚠ **Every statement carries the full checkpoint identity** — `league_id`, `season` and
`resolver_contract`. An active and a shadow contract have separate rows and must never
share progress.

```sql
-- ============ CLAIM (N workers, non-blocking) ============
WITH claimed AS (
  SELECT id FROM team_window_checkpoint_states
   WHERE sport = 'NFL' AND season = $1 AND resolver_contract = $2
     AND (next_eligible_at IS NULL OR next_eligible_at <= timezone('UTC', CURRENT_TIMESTAMP))
     AND (lease_owner IS NULL OR lease_expires_at < timezone('UTC', CURRENT_TIMESTAMP))
   ORDER BY next_eligible_at NULLS FIRST
   LIMIT $3
   FOR UPDATE SKIP LOCKED
)
UPDATE team_window_checkpoint_states t
   SET lease_owner = $4,
       lease_expires_at = timezone('UTC', CURRENT_TIMESTAMP) + INTERVAL '10 minutes',
       last_attempted_period = t.target_period_ordinal,
       last_attempted_at = timezone('UTC', CURRENT_TIMESTAMP),
       updated_at = timezone('UTC', CURRENT_TIMESTAMP)
  FROM claimed
 WHERE t.id = claimed.id
RETURNING t.id, t.league_id, t.season, t.resolver_contract, t.target_period_ordinal;

-- ============ HEARTBEAT ============
UPDATE team_window_checkpoint_states
   SET lease_expires_at = timezone('UTC', CURRENT_TIMESTAMP) + INTERVAL '10 minutes',
       updated_at = timezone('UTC', CURRENT_TIMESTAMP)
 WHERE league_id = $1 AND season = $2 AND resolver_contract = $3
   AND lease_owner = $4
   AND lease_expires_at > timezone('UTC', CURRENT_TIMESTAMP)
RETURNING id;   -- zero rows ⇒ lease lost ⇒ ABANDON WITHOUT WRITING

-- ============ DEFER (upstream evidence missing/stale) ============
UPDATE team_window_checkpoint_states
   SET last_deferred_period = target_period_ordinal,
       last_deferred_reason = $5,
       deferral_first_at    = COALESCE(deferral_first_at, timezone('UTC', CURRENT_TIMESTAMP)),
       deferral_attempts    = deferral_attempts + 1,
       next_eligible_at     = timezone('UTC', CURRENT_TIMESTAMP) + $6::interval,
       lease_owner = NULL, lease_expires_at = NULL,
       updated_at = timezone('UTC', CURRENT_TIMESTAMP)
 WHERE league_id = $1 AND season = $2 AND resolver_contract = $3 AND lease_owner = $4;

-- ============ FAIL (unexpected error, not a deferral) ============
UPDATE team_window_checkpoint_states
   SET last_failed_at = timezone('UTC', CURRENT_TIMESTAMP),
       last_error_category = $5,
       consecutive_failures = consecutive_failures + 1,
       next_eligible_at = timezone('UTC', CURRENT_TIMESTAMP) + $6::interval,
       lease_owner = NULL, lease_expires_at = NULL,
       updated_at = timezone('UTC', CURRENT_TIMESTAMP)
 WHERE league_id = $1 AND season = $2 AND resolver_contract = $3 AND lease_owner = $4;

-- ============ SKIP (deferral deadline reached) — one transaction ============
BEGIN;
INSERT INTO team_window_period_outcomes
       (id, league_id, season, period_type, period_ordinal, resolver_contract,
        outcome, reason, attempts, first_attempted_at, closed_at, created_at)
SELECT $7, league_id, season, 'week', target_period_ordinal, resolver_contract,
       'skipped_unavailable', last_deferred_reason, deferral_attempts,
       deferral_first_at, timezone('UTC', CURRENT_TIMESTAMP), timezone('UTC', CURRENT_TIMESTAMP)
  FROM team_window_checkpoint_states
 WHERE league_id = $1 AND season = $2 AND resolver_contract = $3 AND lease_owner = $4;

UPDATE team_window_checkpoint_states
   SET target_period_ordinal = target_period_ordinal + 1,
       deferral_first_at = NULL, deferral_attempts = 0, last_deferred_reason = NULL,
       next_eligible_at = $8,          -- next period's settleEligibleAt
       lease_owner = NULL, lease_expires_at = NULL,
       updated_at = timezone('UTC', CURRENT_TIMESTAMP)
 WHERE league_id = $1 AND season = $2 AND resolver_contract = $3 AND lease_owner = $4;
-- affected rows <> 1 -> ROLLBACK
COMMIT;

-- ============ COMPLETE — one transaction ============
BEGIN;
-- (a) serialize this checkpoint row and confirm the target period
SELECT target_period_ordinal FROM team_window_checkpoint_states
 WHERE league_id = $1 AND season = $2 AND resolver_contract = $3
   FOR UPDATE;
-- target_period_ordinal <> $9 -> ROLLBACK (working on a different period)

-- (b) the finality revision must still be accepted AND settled
SELECT id FROM league_period_finality
 WHERE id = $10 AND league_id = $1 AND season = $2
   AND period_type = 'week' AND period_ordinal = $9
   AND lifecycle = 'accepted' AND assessment_state = 'settled'
   FOR SHARE;
-- zero rows -> ROLLBACK

-- (c) compare the observed team ID SET against the expected active set (not counts)
SELECT array_agg(league_team_id ORDER BY league_team_id)
  FROM team_window_observations
 WHERE league_id = $1 AND season = $2 AND period_type = 'week' AND period_ordinal = $9
   AND resolver_contract = $3 AND lifecycle = 'accepted';
-- set <> expected active LeagueTeam id set -> ROLLBACK

-- (d) still own an unexpired lease, and (e)-(i) complete in one statement
UPDATE team_window_checkpoint_states
   SET last_completed_period = $9,
       last_completed_at     = timezone('UTC', CURRENT_TIMESTAMP),
       target_period_ordinal = $9 + 1,
       deferral_first_at = NULL, deferral_attempts = 0, last_deferred_reason = NULL,
       consecutive_failures = 0, last_error_category = NULL,
       next_eligible_at  = $11,        -- next period's settleEligibleAt
       lease_owner = NULL, lease_expires_at = NULL,
       updated_at = timezone('UTC', CURRENT_TIMESTAMP)
 WHERE league_id = $1 AND season = $2 AND resolver_contract = $3
   AND lease_owner = $4
   AND lease_expires_at > timezone('UTC', CURRENT_TIMESTAMP)
   AND target_period_ordinal = $9;
-- affected rows <> 1 -> ROLLBACK
COMMIT;

-- ============ RELEASE (no work done) ============
UPDATE team_window_checkpoint_states
   SET lease_owner = NULL, lease_expires_at = NULL,
       updated_at = timezone('UTC', CURRENT_TIMESTAMP)
 WHERE league_id = $1 AND season = $2 AND resolver_contract = $3 AND lease_owner = $4;
```

⚠ The lease is re-verified **inside** the completion UPDATE, not before it. A heartbeat that
passed a second earlier proves nothing about ownership at `COMMIT`.

---

## 18.7 Schema-versus-SQL parity

`scripts/check-window-schema-sql-parity` (proposed) parses every Prisma scalar field and its
`@map`, parses the `CREATE TABLE` columns, and **exits 1** on any missing, extra, renamed or
duplicated column. Relation fields are excluded as navigation properties.

```
OK   LeaguePeriodFinality         -> league_period_finality           prisma= 42 sql= 42
OK   TeamWindowObservation        -> team_window_observations         prisma= 46 sql= 46
OK   TeamWindowCheckpointState    -> team_window_checkpoint_states    prisma= 22 sql= 22
OK   TeamWindowPeriodOutcome      -> team_window_period_outcomes      prisma= 12 sql= 12

PARITY OK: every Prisma scalar field maps to exactly one SQL column.
exit 0
```

**Proven capable of failing before its pass was believed** — `--self-test` injects each fault
class into a copy of the SQL and asserts detection:

```
self-test renamed : DETECTED (2 finding(s))
self-test missing : DETECTED (1 finding(s))
self-test extra   : DETECTED (1 finding(s))
```

122 columns across four tables.

---

## 19. Disposable-database execution

A disposable cluster **was** available and was used. PostgreSQL 18 is installed locally; the
existing service on 5432 required a password that is not held, so a **separate cluster** was
created with `initdb` (trust auth, port 55432, user `m19`) in a scratch directory, used, and
destroyed. No shared database was touched, and no production credential was read.

⚠ The Neon test database was deliberately **not** used: it is shared with other sessions, and
it carries known schema drift (`WeeklyMatchup.rosterId` is still `integer` there).

| Step | Result |
| --- | --- |
| 1. Apply committed base schema (`origin/main`) | exit **0** — 717 tables |
| 2. Apply proposed migration | exit **0** — 4 tables, 2 partial indexes, 2 triggers, 2 functions, 42 CHECKs |
| 3. Constraint + trigger tests | exit **0** — **23 assertions passed** |
| 4. Rollback | exit **0** |
| 5. Verify objects gone | **0 tables / 0 partial indexes / 0 triggers / 0 functions / 0 CHECKs**; 717 base tables intact |
| 6. Reapply | exit **0** — 4 / 2 / 2 / 2 / 42 |
| 7. Re-run tests | exit **0** — **23 assertions passed** |

Assertions cover: one accepted finality revision per league-period; an inferred method cannot
claim provider provenance; finality immutability; one accepted observation per
team-period-contract; the composite finality FK rejecting a cross-period reference; refused
carrying a null status; observation immutability across facts, scores and identity; the legal
tombstone flip succeeding; `superseded → accepted` rejected; a correction citing its
predecessor accepted; linear-chain uniqueness rejecting a branch; identity+content uniqueness
rejecting a same-team repeat **and permitting two different teams to share evidence**;
`RESTRICT` blocking deletes of a referenced team and finality; one checkpoint row per
league-season-contract with a shadow contract getting its own; bounded deferral reasons; and
durable skipped-period outcomes.

⚠ **Every expected-failure assertion raises if the statement unexpectedly succeeds.** A test
that merely "did not crash" would prove nothing — which is exactly how the wrong test in the
first run was caught.

---

## 17. Readiness checklist

| # | Prerequisite | State |
| --- | --- | --- |
| 1 | Window resolver, hysteresis, deadband, decision states | **Implemented** — `lib/decision-os/value-v2/window.ts`, 32 tests |
| 2 | Fact assembler and refusal gates | **Implemented** — `windowFacts.ts`, 16 tests |
| 3 | Prisma fact port over existing models | **Implemented** — `windowFactsPrismaPort.ts`, 30 tests |
| 4 | Decision layer, team-fit weighting, query-cost bound | **Implemented** — `windowDecision.ts` |
| 5 | Consumer seam on `buildValueV2Shadow` | **Implemented, uncommitted** — blocked by shared-foundation ownership |
| 6 | Prisma models parse, validate, format | **Implemented (validated)** — §18, exit 0 |
| 7 | Generated DDL matches handwritten names | **Implemented (validated)** — §18.2, all 29 identifiers |
| 8 | Additive-only drift against `origin/main` | **Implemented (validated)** — §18.3, with control |
| 9 | `TeamWindowObservation` migration | **Generated, executed and rolled back on a disposable database** — §19. Shipping still blocked by #17 |
| 10 | `LeaguePeriodFinality` append-only model | **Specified but unimplemented** |
| 11 | `TeamWindowPeriodOutcome` + bounded deferral | **Specified but unimplemented** — §11.5 |
| 12 | Immutability triggers | **Validated on a disposable database** — §19, both triggers, 23 assertions |
| 13 | Partial unique indexes and CHECK constraints | **Validated on a disposable database** — §19, 2 partial indexes + 42 CHECKs |
| 14 | Lease claim (`FOR UPDATE SKIP LOCKED`) and completion transaction | **Specified but unimplemented** · **Requires real-database validation** |
| 15 | Correction concurrency, four scenarios | **Specified but unimplemented** · **Requires real-database validation** |
| 16 | UTC session pinning; non-UTC equivalence | **Specified but unimplemented** · **Requires real-database validation** |
| 17 | Reconciliation soft-delete for `LeagueTeam` | **Implemented on an unmerged branch** — `import-integrity-batch-a` @ `a3505ed2b` ("archive teams instead of deleting them"). Verified present locally and on `origin`, and **not** an ancestor of `origin/main`. The prerequisite clears only once that branch lands in the migration's target branch |
| 18 | IMP-05 matchup finality | **Externally blocked** — no spec exists; §5 is its requirement |
| 19 | Scheduled `SeasonForecastSnapshot` producer | **Externally blocked** — request-triggered only |
| 20 | Scheduled `DynastyProjectionSnapshot` producer | **Externally blocked** — request-triggered only |
| 21 | `prisma/schema.prisma` release | **Externally blocked** — held by another session |
| 22 | Privacy purge transaction | **Specified but unimplemented** — §10 |
| 23 | Scheduled checkpoint writer | **Specified but unimplemented** — §8 |
| 24 | Reader over stored observations | **Specified but unimplemented** — §12 |
| 25 | Production checkpoint population | **Externally blocked** by #18, #19, #20 |
| 26 | Production caller wiring | **Externally blocked** by #21 |

**Milestone 19 is incomplete. Progress remains 34%.** Completion requires matchup finality,
scheduled forecast and dynasty producers, observation persistence, production caller wiring,
and real-database execution. The schema is now validated; nothing about its runtime
behaviour is.
