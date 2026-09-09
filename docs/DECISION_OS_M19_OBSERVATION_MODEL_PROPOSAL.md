# Proposal — `TeamWindowObservation`, and why no existing model can hold it

**Status: PROPOSAL ONLY. Nothing here has been implemented, migrated or applied.**
`prisma/schema.prisma` is currently modified-uncommitted by an active Codex session, so
no schema edit was made. This document is the artifact requested before implementation.

## The defect being fixed

`resolveWindowDecision` today reconstructs weeks W-2 and W-1 by re-resolving them from
current facts. `WeeklyMatchup` and `SeasonForecastSnapshot` are genuinely weekly, so those
two inputs are real history — but `DynastyProjectionSnapshot` is keyed per **season** and
the injury load is **current-only**, so both historical observations carry today's figures.

That is not merely imprecise, it defeats the anti-swoop guarantee. A dynasty projection
that drops today **rewrites what weeks W-2 and W-1 are computed to have been**, so a
condition that has existed for minutes can present as three weeks of persistence and settle
immediately. The hysteresis contract requires three *independently observed* weeks; a
reconstruction cannot supply them.

## Why no existing model fits

| Model | Why not |
| --- | --- |
| `TeamWindowProfile` | Unique on `(leagueId, teamId, season)` — **no week column**. Holds one current classification per season, which is the thing being replaced, not a history of observations. |
| `CanonicalDecision` | No `week` integer and no `(league, team, season, week)` uniqueness; week would have to be smuggled into `period`/`subjectKey`. Its required fields are user-facing (`headline` VarChar(300), `explanation` Text, `severity`, `urgency`, `audience`, `entitlementTier`), so storing a machine observation means **inventing recommendation copy for every week**. Its own doc calls it "DORMANT in Phase 3A — read by nothing live." |
| `DecisionLog` | Keyed on `userId` + `leagueId`; no `teamId`, `season` or `week`, and **no uniqueness constraint at all**. Duplicate observations are exactly what must be impossible — a repeat visit in the same week must not advance a proposal. |
| `SeasonForecastSnapshot` | Correct `(leagueId, season, week)` grain, but it is the playoff-probability producer. Writing window classifications into a forecast payload conflates an input with a conclusion drawn from it. |
| `DecisionStrategyState` | Codex's new table, and the closest shape (`lastObservedWeek`, a `pending` JSON) — but it is one row per `(userId, leagueId, season)` holding *current* state, scoped to a user's declared strategy. A window is a property of a **team**, not a user, and needs one row per week retained. |

**Conclusion: a narrowly scoped new model is required.**

## Proposed model

Append-only. One row per league/team/season/week. Never updated, never backfilled.

```prisma
/// Decision OS milestone 19 — one competitive-window observation per team per week.
/// APPEND-ONLY. A row records what was believed AT THAT WEEK using the facts and model
/// version available then; it is never rewritten when a later projection or injury lands.
/// That immutability is the whole point — a mutable history cannot evidence persistence.
model TeamWindowObservation {
  id                     String   @id @default(cuid())

  // Identity. Both league ids are stored because they are different namespaces and
  // confusing them is a known live defect: WeeklyMatchup.leagueId holds the PLATFORM id.
  leagueId               String   @map("league_id") @db.VarChar(64)
  platformLeagueId       String   @map("platform_league_id") @db.VarChar(64)
  teamId                 String   @map("team_id") @db.VarChar(64)
  sourceRosterId         String   @map("source_roster_id") @db.VarChar(64)
  season                 Int
  week                   Int

  // Facts as observed. Nullable only where the producer legitimately had nothing.
  wins                   Int
  losses                 Int
  ties                   Int
  luckWins               Float    @map("luck_wins")
  weeksCounted           Int      @map("weeks_counted")
  pointsFor              Float    @map("points_for")
  playoffProbabilityPct  Float?   @map("playoff_probability_pct")
  strengthNextYearPct    Float?   @map("strength_next_year_pct")
  strength3YearsPct      Float?   @map("strength_3_years_pct")
  unavailableShare       Float?   @map("unavailable_share")
  injuryCoverage         Float?   @map("injury_coverage")
  injuryBasis            String?  @map("injury_basis") @db.VarChar(128)

  // Discriminators, stored so a later reader cannot mistake which contract produced the row.
  pickTreatment          String   @map("pick_treatment") @db.VarChar(32)
  injuryTreatment        String   @map("injury_treatment") @db.VarChar(48)

  // Conclusions.
  observedStatus         String?  @map("observed_status") @db.VarChar(16)
  settledStatus          String?  @map("settled_status") @db.VarChar(16)
  decisionState          String   @map("decision_state") @db.VarChar(16)
  nowScore               Float?   @map("now_score")
  futureScore            Float?   @map("future_score")
  sourceConfidence       Float?   @map("source_confidence")
  gaps                   Json?

  // Provenance. Producer timestamps are distinct from when this row was written.
  forecastGeneratedAt    DateTime? @map("forecast_generated_at")
  forecastWeek           Int?      @map("forecast_week")
  dynastyGeneratedAt     DateTime? @map("dynasty_generated_at")
  assembledAt            DateTime  @map("assembled_at")
  resolverVersion        String    @map("resolver_version") @db.VarChar(32)
  coefficientsVersion    String    @map("coefficients_version") @db.VarChar(32)
  createdAt              DateTime  @default(now()) @map("created_at")

  @@unique([leagueId, teamId, season, week], name: "uniq_team_window_observation_league_team_season_week")
  @@index([leagueId, season, week])
  @@index([leagueId, teamId, season])
  @@map("team_window_observations")
}
```

The unique constraint is the load-bearing part: it is what makes a duplicate visit in the
same week a no-op at the database level rather than a matter of application discipline.

## Proposed migration

Additive only. No column is altered, no row is written, nothing is backfilled.

```sql
-- migrations-pending/<ts>_team_window_observations/migration.sql
CREATE TABLE "team_window_observations" (
  "id"                       TEXT PRIMARY KEY,
  "league_id"                VARCHAR(64) NOT NULL,
  "platform_league_id"       VARCHAR(64) NOT NULL,
  "team_id"                  VARCHAR(64) NOT NULL,
  "source_roster_id"         VARCHAR(64) NOT NULL,
  "season"                   INTEGER NOT NULL,
  "week"                     INTEGER NOT NULL,
  "wins"                     INTEGER NOT NULL,
  "losses"                   INTEGER NOT NULL,
  "ties"                     INTEGER NOT NULL,
  "luck_wins"                DOUBLE PRECISION NOT NULL,
  "weeks_counted"            INTEGER NOT NULL,
  "points_for"               DOUBLE PRECISION NOT NULL,
  "playoff_probability_pct"  DOUBLE PRECISION,
  "strength_next_year_pct"   DOUBLE PRECISION,
  "strength_3_years_pct"     DOUBLE PRECISION,
  "unavailable_share"        DOUBLE PRECISION,
  "injury_coverage"          DOUBLE PRECISION,
  "injury_basis"             VARCHAR(128),
  "pick_treatment"           VARCHAR(32) NOT NULL,
  "injury_treatment"         VARCHAR(48) NOT NULL,
  "observed_status"          VARCHAR(16),
  "settled_status"           VARCHAR(16),
  "decision_state"           VARCHAR(16) NOT NULL,
  "now_score"                DOUBLE PRECISION,
  "future_score"             DOUBLE PRECISION,
  "source_confidence"        DOUBLE PRECISION,
  "gaps"                     JSONB,
  "forecast_generated_at"    TIMESTAMP(3),
  "forecast_week"            INTEGER,
  "dynasty_generated_at"     TIMESTAMP(3),
  "assembled_at"             TIMESTAMP(3) NOT NULL,
  "resolver_version"         VARCHAR(32) NOT NULL,
  "coefficients_version"     VARCHAR(32) NOT NULL,
  "created_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "uniq_team_window_observation_league_team_season_week"
  ON "team_window_observations" ("league_id", "team_id", "season", "week");
CREATE INDEX "team_window_observations_league_season_week_idx"
  ON "team_window_observations" ("league_id", "season", "week");
CREATE INDEX "team_window_observations_league_team_season_idx"
  ON "team_window_observations" ("league_id", "team_id", "season");
```

## Rollout policy — no fabricated history

**No backfill.** Historical observations cannot be recreated honestly: the injury load and
the dynasty projection for a past week no longer exist, which is precisely why the current
reconstruction is being removed. Writing synthesised rows would launder that same guess
into a table that looks authoritative.

On first deployment a team therefore has **zero** stored observations, and the resolver
must report that state rather than hide it. Two acceptable policies, and the choice belongs
to the product owner:

1. **Strict (recommended).** Until three real weekly observations exist, `state` is
   `refused` with gap `window_history_insufficient`, and team fit stays neutral. Nothing is
   claimed that was not observed. Cost: no window for the first three weeks after rollout.
2. **Disclosed bootstrap.** Seed the settled window from the first real observation and
   label every decision `bootstrap: true` with gap `window_bootstrapped_from_single_week`
   until three exist. Cheaper, but a consumer that ignores the flag gets a
   one-week-old window presenting as settled — so the flag must be surfaced, not just
   stored.

`resolveWindowDecision` would then read stored observations instead of reconstructing, and
write exactly one row per team per week, guarded by the unique constraint.

## What this does not cover

Migrating the existing `TeamWindowProfile` readers, and any authority cutover, are out of
scope. This proposal adds a history table and changes nothing that already reads a window.
