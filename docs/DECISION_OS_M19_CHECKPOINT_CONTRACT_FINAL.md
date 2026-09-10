# Decision OS Milestone 19 — Checkpoint & Discovery Contract (FINAL)

**CONTRACT ONLY. NOTHING IMPLEMENTED, MIGRATED, DEPLOYED OR COMMITTED.**
No Prisma file, migration file or service was created or edited. `prisma/schema.prisma`
remains held by another session. **Milestone 19 progress remains 34%.**

**Self-contained.** This document supersedes §8 and §18.6 of
`DECISION_OS_M19_OBSERVATION_MODEL_PROPOSAL.md` (rev 5.2) and §§1, 4, 5, 6, 7, 8 of
`DECISION_OS_M19_REV_5_2_ERRATA.md`. Where any of those disagree with this document, **this
document wins**. An implementer needs the proposal only for the table definitions (§2, §13,
§14) and the facts contract (§3).

---

## 1. Repository-grounded eligibility

Every field below was read from the committed `origin/main` schema or from committed source.
Nothing here is assumed.

| Signal | Source | Evidence |
| --- | --- | --- |
| Successful import | `ImportRun.status = 'completed'` **and** `leagueId IS NOT NULL` **and** `completedAt IS NOT NULL` | `lib/league-import/importPersistenceService.ts:210` sets `status: 'completed'`, `leagueId`, `completedAt` after `persistImportedLeagueFromNormalization` succeeds. Statuses observed: `running`, `completed`, `failed`. |
| Active league-season | `LeagueSeason.status = 'active'` on `(leagueId, season)` | `lib/league-import/ImportedLeagueCommitService.ts:1058` writes it on the season upsert. `@@unique([leagueId, season])`. |
| Sport | `League.sport` (`enum LeagueSport`) | Enum: `NFL, NBA, MLB, NHL, NCAAF, NCAAB, SOCCER`. **Never hardcode `'NFL'`** — filter `sport = 'NFL'` because v1 supports only NFL, and let every other sport fall out of the scan rather than be mislabelled. |
| Season | `LeagueSeason.season`, cross-checked against `League.season` | Both exist; `LeagueSeason` is per-season and is the one discovery iterates. |
| Platform league id | `League.platformLeagueId` | Required by `WeeklyMatchup.leagueId`, which holds the **platform** id. |
| Playoff schedule | `League.playoffStartWeek` (default 14), `playoffTeams` (4), `playoffWeeksPerRound` (1) | Committed columns with defaults. |
| Regular-season end | `playoffStartWeek - 1` | Derived; there is no explicit column. |
| Imported period availability | `DISTINCT WeeklyMatchup.week` where `leagueId = platformLeagueId` and `seasonYear = season` and at least one row has `pointsFor > 0` | The scored-week gate `lib/core-app/allPlay.ts` already uses: *"nobody scored means nobody played."* |
| Configured contracts | `DECISION_OS_WINDOW_ACTIVE_CONTRACT` + registry | Application config, validated at startup, fails closed. |

### 🛑 Two prerequisites, because the repository does not supply them

**P-1. `League` has no soft-delete or activity column.** It carries no `deletedAt`,
`archivedAt`, `isActive` or `purgeAfter`; the schema comment on the tenancy fragment states
plainly that `deletedAt` *"have no analogue at all"* on this model. Discovery therefore uses
**`LeagueSeason.status = 'active'`** as the activity signal. That is a real, written signal,
but it is per-season and set only by the import commit path — a league deactivated by some
other route would not be reflected. **Do not invent a League-level flag.** If a
league-level lifecycle signal is wanted, it is separate work.

**P-2. There is no `League.activatedAt`.** Activation time is approximated by
`MIN(ImportRun.completedAt)` for that `(leagueId, season)`. That is the first moment the
league demonstrably existed in this system. It is an approximation and is labelled as one.

---

## 2. Discovery job

`/api/cron/decision-os-window-discovery` — independently scheduled, hourly, idempotent.

🛑 **It runs nowhere near the import transaction.** Import success must never depend on
Decision OS configuration, the resolver registry, checkpoint-table availability or worker
health. A Decision OS misconfiguration must not fail a user's league import.

⚠ **Revision 5.2's discovery SQL was defective and is deleted.** It passed a single `$2`
target period to every discovered league in one `INSERT … SELECT`. The initial target
depends on per-league facts — playoff start week, imported period availability, activation
time — so one value cannot be correct for more than one league by coincidence.

### 2.1 Two phases: read, then insert per league

```ts
/** Phase 1 — read. No writes. Nothing here can affect an import. */
async function discoverEligibleLeagues(season: number): Promise<DiscoveryCandidate[]> {
  const rows = await prisma.leagueSeason.findMany({
    where: {
      season,
      status: 'active',                                   // P-1: the activity signal
      league: {
        sport: 'NFL',                                     // v1 scope; never hardcoded downstream
        platformLeagueId: { not: null },
        importRuns: { some: {                             // successful-import proof
          status: 'completed', season, completedAt: { not: null },
        } },
      },
    },
    select: {
      season: true,
      league: {
        select: {
          id: true, sport: true, platform: true, platformLeagueId: true,
          playoffStartWeek: true, playoffTeams: true, playoffWeeksPerRound: true,
          importRuns: {
            where: { status: 'completed', season, completedAt: { not: null } },
            orderBy: { completedAt: 'asc' }, take: 1,
            select: { completedAt: true },                // P-2: activation approximation
          },
        },
      },
    },
  })

  // Imported period availability, per league, from the platform-keyed matchup table.
  // ⚠ WeeklyMatchup.leagueId holds the PLATFORM id, not League.id.
  const platformIds = rows.map(r => r.league.platformLeagueId!).filter(Boolean)
  const scored = await prisma.weeklyMatchup.groupBy({
    by: ['leagueId', 'week'],
    where: { leagueId: { in: platformIds }, seasonYear: season },
    _max: { pointsFor: true },
  })
  const scoredWeeksByPlatformId = groupScoredWeeks(scored)   // keeps only weeks with max(pointsFor) > 0

  return rows.map(r => ({
    leagueId: r.league.id,
    sport: r.league.sport,                                  // authoritative, not a literal
    season: r.season,
    platform: r.league.platform,
    platformLeagueId: r.league.platformLeagueId!,
    playoffStartWeek: r.league.playoffStartWeek,            // may be null -> §3 missing-settings rule
    playoffTeams: r.league.playoffTeams,
    playoffWeeksPerRound: r.league.playoffWeeksPerRound,
    activationApproxAt: r.league.importRuns[0]?.completedAt ?? null,
    scoredWeeks: scoredWeeksByPlatformId.get(r.league.platformLeagueId!) ?? [],
  }))
}

/** Phase 2 — insert, per league, with its OWN computed target. */
async function ensureCheckpointRows(candidates: DiscoveryCandidate[], contracts: readonly ResolverContract[]) {
  const records = candidates.flatMap(c => {
    const init = resolveInitialTarget(c)                    // §3 — per league, never shared
    if (init.kind === 'no_period') return []                // nothing to observe this season
    return contracts.map(contract => ({
      leagueId: c.leagueId, season: c.season, sport: c.sport, resolverContract: contract,
      targetPeriodOrdinal: init.targetPeriod,
      nextEligibleAt: init.settleEligibleAt,
      deferralAttempts: 0, consecutiveFailures: 0,
    }))
  })

  // Idempotent. Existing rows are left exactly as they are — discovery never rewinds a
  // checkpoint that a worker has already advanced.
  const result = await prisma.teamWindowCheckpointState.createMany({
    data: records, skipDuplicates: true,                    // uniq_twcs_league_season_contract
  })
  return { considered: records.length, created: result.count }
}
```

`skipDuplicates` maps to `ON CONFLICT DO NOTHING`, which is correct **here** and only here:
discovery's job is "create if absent", and a conflict means the row already exists. That is
the opposite of the checkpoint transaction, where a conflict must be investigated (§4).

### 2.2 Failure recording, and why the scanner is the authority

Discovery writes one `SyncJobRun` per invocation
(`jobName: 'decision-os-window-discovery'`) with `rowsRead`, `rowsWritten` and a bounded
summary. **A discovery failure never touches import state** — it only inserts into its own
table, so the worst outcome is that a league is discovered on the next pass.

An outbox event on import completion may *accelerate* discovery. **The hourly scan remains
the recovery authority:** an event that is lost, dropped, emitted before commit, or never
emitted at all is repaired within the hour, with no backfill job and no manual step.
Acceleration is an optimisation; correctness never depends on it.

---

## 3. Initialization and historical catch-up

⚠ **Errata §5's rule — "first period whose `settleEligibleAt >= activatedAt`" — is
insufficient and is replaced.** A midseason import commonly arrives carrying authoritative
settled matchups for earlier weeks. Starting at the import week discards evidence the
resolver needs: all-play strength, schedule-luck, rolling performance, three-period
hysteresis, competitive-window classification and retrospective analysis all require
lookback.

### 3.1 Two policies, deliberately separate

**Policy L — live initialization.** The target starts at the earliest period for which the
resolver's required lookback and hysteresis history can be populated from **authoritative
imported periods**, so that the first live recommendation is not itself starved.

```
requiredLookback = WINDOW_PERSISTENCE_WEEKS (3)   // hysteresis
availablePeriods = scoredWeeks, ascending
latestSettled    = max(p in availablePeriods where settleEligibleAt(p) <= now)

targetPeriod = the earliest p in availablePeriods such that
               count(q in availablePeriods : q <= p) >= requiredLookback
               and p <= latestSettled
               // i.e. the first period that can be observed WITH its own history present
```

If fewer than `requiredLookback` periods are available, the target is the **earliest**
available period and every early decision is `provisional` — which is exactly what
`provisional` is for. Nothing is fabricated.

**Policy H — historical backfill.** Older authoritative imported periods are processed by a
**separate, lower-priority pass** that never blocks current-period recommendations. It uses
the same `weekly_close` checkpoint contract and the same finality gates; it differs only in
ordering and in running behind the live target. It creates real observations from real
imported evidence — this is **not** the prohibited synthetic backfill, which invents
observations for periods with no evidence.

🛑 The distinction that matters: **backfilling from authoritative imported matchups is
permitted; inventing an observation for a period with no settled finality is not.** Policy H
defers exactly like Policy L when finality is unavailable.

### 3.2 Deterministic cases

| Case | Behaviour |
| --- | --- |
| **Preseason import** (no scored weeks) | Target = period 1. `nextEligibleAt` = period 1's `settleEligibleAt`. Legitimate, because period 1 is genuinely next. |
| **Midseason import** (scored weeks 1–9, imported week 10) | Policy L target = the first period with ≥3 periods of history available, capped at the latest settled period. Policy H queues the remainder. **Never week 10 by default, and never week 1 blindly.** |
| **Postseason import** (season's periods all past) | No live target for that season. Policy H may process the completed season; discovery creates the **next** season's row when that season becomes active. |
| **Import after the fantasy season ends** | No row is created for the finished season. There is nothing to observe going forward, and Policy H is optional operator-triggered work, not automatic. |
| **Partial historical data** (weeks 3, 4, 7 scored; 5–6 absent) | Only scored weeks are available periods. Absent periods break the hysteresis streak (they are missing, not agreeing) and are candidates for a `SKIP` outcome once their deadline passes. |
| **Multiple imported seasons** | One checkpoint row per `(leagueId, season, resolverContract)`. Seasons never share progress and never roll into one another. |
| **Missing league schedule settings** (`playoffStartWeek IS NULL`) | **Refuse to initialize.** Discovery skips the league and records `no_schedule_settings` in its `SyncJobRun` summary. A guessed regular-season end would silently mis-scope every period boundary. |
| **No remaining periods** | `resolveInitialTarget` returns `no_period`; no row is created. An existing row reaching this state is **exhausted** (§4.8). |
| **Next-season discovery** | A new `(leagueId, season)` row appears in `LeagueSeason` with `status = 'active'`, and the hourly scan creates its checkpoint row. **No in-place season roll.** |

### 3.3 The period calendar

```ts
export type PeriodResolution =
  | { kind: 'period'; periodOrdinal: number; settleEligibleAt: Date }
  | { kind: 'no_period' }                 // season exhausted for this league
  | { kind: 'unresolvable'; reason: 'no_schedule_settings' }

export function nextExpectedPeriod(input: {
  season: number
  currentPeriod: number | null
  playoffStartWeek: number | null         // League.playoffStartWeek
  playoffTeams: number | null
  playoffWeeksPerRound: number | null
  availablePeriods: readonly number[]     // scored weeks, ascending
}): PeriodResolution
```

- `regularSeasonEndWeek = playoffStartWeek - 1`.
- `playoffWeeks = ceil(log2(playoffTeams)) * playoffWeeksPerRound`, starting at
  `playoffStartWeek`. **An empty or 1-team playoff schedule yields zero playoff weeks**, and
  the season ends at `regularSeasonEndWeek`.
- `lastPeriod = playoffStartWeek + playoffWeeks - 1`, which may be **less than NFL week 18**
  and frequently is.
- Beyond `lastPeriod`: `no_period`.
- `playoffStartWeek IS NULL`: `unresolvable`.

🛑 **`targetPeriodOrdinal + 1` appears nowhere in this contract.** Every advancement is a
`nextExpectedPeriod(...)` result, and a `no_period` result triggers exhaustion (§4.8), never
period 19 … 26 and never a silent roll into the next season.

---

## 4. Canonical transition specification

The **only** authoritative checkpoint SQL. Every statement carries the full identity
`(league_id, season, resolver_contract)`. Every state-changing transition returns the
affected row, and **no caller may report success without checking the count**.

| Affected rows | Meaning |
| --- | --- |
| **1** | Success |
| **0** | Lease lost, state changed, or a stale worker. **Abandon; report failure.** |
| **>1** | Impossible under `uniq_twcs_league_season_contract`. **Corruption: abort, alert, halt the worker.** |

### 4.1 CLAIM (batch; the only transition permitted to affect ≠ 1 rows)

```sql
WITH claimed AS (
  SELECT id FROM team_window_checkpoint_states
   WHERE sport = $1 AND season = $2 AND resolver_contract = $3
     AND target_period_ordinal IS NOT NULL              -- exhausted rows are not work
     AND (next_eligible_at IS NULL OR next_eligible_at <= timezone('UTC', CURRENT_TIMESTAMP))
     AND (lease_owner IS NULL OR lease_expires_at < timezone('UTC', CURRENT_TIMESTAMP))
   ORDER BY next_eligible_at NULLS FIRST
   LIMIT $4
   FOR UPDATE SKIP LOCKED
)
UPDATE team_window_checkpoint_states t
   SET lease_owner = $5,                                 -- §5: unique per claim ATTEMPT
       lease_expires_at = timezone('UTC', CURRENT_TIMESTAMP) + INTERVAL '10 minutes',
       last_attempted_period = t.target_period_ordinal,
       last_attempted_at = timezone('UTC', CURRENT_TIMESTAMP),
       updated_at = timezone('UTC', CURRENT_TIMESTAMP)
  FROM claimed
 WHERE t.id = claimed.id
RETURNING t.id, t.league_id, t.season, t.resolver_contract, t.target_period_ordinal, t.lease_owner;
```

Returning 0 rows is normal (no work due). Each returned row carries its own token.

### 4.2 HEARTBEAT

```sql
UPDATE team_window_checkpoint_states
   SET lease_expires_at = timezone('UTC', CURRENT_TIMESTAMP) + INTERVAL '10 minutes',
       updated_at = timezone('UTC', CURRENT_TIMESTAMP)
 WHERE league_id = $1 AND season = $2 AND resolver_contract = $3
   AND lease_owner = $4
   AND lease_expires_at > timezone('UTC', CURRENT_TIMESTAMP)
RETURNING id;
```

**0 rows ⇒ the lease is lost. Abandon immediately and write nothing.** Not an error to retry.

### 4.3 DEFER

```sql
UPDATE team_window_checkpoint_states
   SET last_deferred_period = target_period_ordinal,
       last_deferred_reason = $5,
       deferral_first_at    = COALESCE(deferral_first_at, timezone('UTC', CURRENT_TIMESTAMP)),
       deferral_attempts    = deferral_attempts + 1,
       next_eligible_at     = timezone('UTC', CURRENT_TIMESTAMP) + $6::interval,
       lease_owner = NULL, lease_expires_at = NULL,
       updated_at = timezone('UTC', CURRENT_TIMESTAMP)
 WHERE league_id = $1 AND season = $2 AND resolver_contract = $3
   AND lease_owner = $4
   AND lease_expires_at > timezone('UTC', CURRENT_TIMESTAMP)
   AND target_period_ordinal = $7
RETURNING id;   -- must be exactly 1
```

### 4.4 FAIL

```sql
UPDATE team_window_checkpoint_states
   SET last_failed_at = timezone('UTC', CURRENT_TIMESTAMP),
       last_error_category = $5,
       consecutive_failures = consecutive_failures + 1,
       next_eligible_at = timezone('UTC', CURRENT_TIMESTAMP) + $6::interval,
       lease_owner = NULL, lease_expires_at = NULL,
       updated_at = timezone('UTC', CURRENT_TIMESTAMP)
 WHERE league_id = $1 AND season = $2 AND resolver_contract = $3
   AND lease_owner = $4
   AND lease_expires_at > timezone('UTC', CURRENT_TIMESTAMP)
RETURNING id;   -- must be exactly 1
```

### 4.5 SKIP — atomic outcome + advancement

Fired when `now >= min(deferral_first_at + 7 days, nextPeriodSettleEligibleAt)`.
`$8` is `nextExpectedPeriod(...)`, resolved **before** the transaction.

```sql
BEGIN;

-- (a) Serialize and re-verify identity, lease and target in one lock.
SELECT target_period_ordinal, deferral_first_at, deferral_attempts, last_deferred_reason
  FROM team_window_checkpoint_states
 WHERE league_id = $1 AND season = $2 AND resolver_contract = $3
   AND lease_owner = $4
   AND lease_expires_at > timezone('UTC', CURRENT_TIMESTAMP)
   AND target_period_ordinal = $7
   FOR UPDATE;
-- 0 rows -> ROLLBACK. Lease lost, or another worker already advanced this period.

-- (b) Exactly one outcome row. A retry cannot duplicate it: the unique constraint
--     uniq_twpo_league_period_contract makes a second insert a conflict, and DO NOTHING
--     combined with the (a) target check means the retry simply finds nothing to do.
INSERT INTO team_window_period_outcomes
       (id, league_id, season, period_type, period_ordinal, resolver_contract,
        outcome, reason, attempts, first_attempted_at, closed_at, created_at)
VALUES ($9, $1, $2, 'week', $7, $3,
        'skipped_unavailable', $10, $11, $12,
        timezone('UTC', CURRENT_TIMESTAMP), timezone('UTC', CURRENT_TIMESTAMP))
ON CONFLICT ON CONSTRAINT "uniq_twpo_league_period_contract" DO NOTHING
RETURNING id;
-- 0 rows -> an outcome for this period already exists. ROLLBACK and treat as already done:
--          do NOT advance twice.

-- (c) Advance, or exhaust. $8 IS NULL when nextExpectedPeriod returned no_period.
UPDATE team_window_checkpoint_states
   SET target_period_ordinal = $8,                 -- NULL ⇒ season exhausted (§4.8)
       deferral_first_at = NULL, deferral_attempts = 0, last_deferred_reason = NULL,
       next_eligible_at = $13,                     -- NULL when $8 IS NULL
       lease_owner = NULL, lease_expires_at = NULL,
       updated_at = timezone('UTC', CURRENT_TIMESTAMP)
 WHERE league_id = $1 AND season = $2 AND resolver_contract = $3
   AND lease_owner = $4
   AND target_period_ordinal = $7
RETURNING id;
-- <> 1 -> ROLLBACK

COMMIT;
```

**Proved by construction:** (b) and (c) are one transaction, so the outcome and the
advancement are atomic; (a) enforces unexpired lease ownership and the exact target; (b)'s
unique constraint plus its 0-row rollback makes a duplicate `SKIP` a no-op; (c) takes its
next target from the calendar; and `$8 IS NULL` clears the target rather than inventing a
period.

### 4.6 COMPLETE

`$10` is the accepted settled finality id; `$8`/`$13` are the calendar's next period and its
`settleEligibleAt`, resolved before the transaction.

```sql
BEGIN;

-- (a) Serialize; the target must be unchanged and the lease still ours.
SELECT target_period_ordinal FROM team_window_checkpoint_states
 WHERE league_id = $1 AND season = $2 AND resolver_contract = $3
   AND lease_owner = $4
   AND lease_expires_at > timezone('UTC', CURRENT_TIMESTAMP)
   AND target_period_ordinal = $9
   FOR UPDATE;
-- 0 rows -> ROLLBACK (stale worker changes nothing)

-- (b) The finality revision must still be accepted AND settled. FOR SHARE blocks a
--     concurrent correction from tombstoning it before this commits.
SELECT id, roster_team_map, expected_roster_ids
  FROM league_period_finality
 WHERE id = $10 AND league_id = $1 AND season = $2
   AND period_type = 'week' AND period_ordinal = $9
   AND lifecycle = 'accepted' AND assessment_state = 'settled'
   FOR SHARE;
-- 0 rows -> ROLLBACK

-- (c) The PINNED mapping must be internally valid.
--     c1: mapping keys == expected provider roster ids
--     c2: mapped LeagueTeam ids are unique (injective)
SELECT
  (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(f.roster_team_map) k)
    = (SELECT array_agg(e ORDER BY e) FROM jsonb_array_elements_text(f.expected_roster_ids) e) AS keys_match,
  (SELECT count(*)          FROM jsonb_each_text(f.roster_team_map))
    = (SELECT count(DISTINCT value) FROM jsonb_each_text(f.roster_team_map))                   AS injective,
  (SELECT array_agg(value ORDER BY value) FROM jsonb_each_text(f.roster_team_map))             AS expected_teams
  FROM league_period_finality f WHERE f.id = $10;
-- keys_match false OR injective false -> ROLLBACK  (corrupt pinned map; see §6)

-- (d) Accepted observation team ids must EQUAL the pinned mapped set. Nothing in this
--     path reads league_teams: current orphan/restore state cannot reinterpret history.
SELECT array_agg(league_team_id ORDER BY league_team_id)
  FROM team_window_observations
 WHERE league_id = $1 AND season = $2 AND period_type = 'week' AND period_ordinal = $9
   AND resolver_contract = $3 AND lifecycle = 'accepted';
-- <> expected_teams -> ROLLBACK

-- (e) Complete and advance atomically, re-checking lease and target in the predicate.
UPDATE team_window_checkpoint_states
   SET last_completed_period = $9,
       last_completed_at     = timezone('UTC', CURRENT_TIMESTAMP),
       target_period_ordinal = $8,                  -- NULL ⇒ exhausted
       next_eligible_at      = $13,                 -- NULL when $8 IS NULL
       deferral_first_at = NULL, deferral_attempts = 0, last_deferred_reason = NULL,
       consecutive_failures = 0, last_error_category = NULL,
       lease_owner = NULL, lease_expires_at = NULL,
       updated_at = timezone('UTC', CURRENT_TIMESTAMP)
 WHERE league_id = $1 AND season = $2 AND resolver_contract = $3
   AND lease_owner = $4
   AND lease_expires_at > timezone('UTC', CURRENT_TIMESTAMP)
   AND target_period_ordinal = $9
RETURNING id;
-- <> 1 -> ROLLBACK

COMMIT;
```

### 4.7 RELEASE (no work done)

```sql
UPDATE team_window_checkpoint_states
   SET lease_owner = NULL, lease_expires_at = NULL,
       updated_at = timezone('UTC', CURRENT_TIMESTAMP)
 WHERE league_id = $1 AND season = $2 AND resolver_contract = $3
   AND lease_owner = $4
RETURNING id;   -- must be exactly 1
```

RELEASE deliberately omits the expiry predicate: releasing an already-expired lease you still
own is harmless and desirable. It still matches on the exact token, so it cannot clear
another worker's lease.

### 4.8 Terminal season exhaustion

Reached when `nextExpectedPeriod` returns `no_period`. Expressed by `$8 = NULL` in `SKIP`
(c) or `COMPLETE` (e) — there is no separate statement, so exhaustion is always atomic with
the transition that discovered it.

An exhausted row has `target_period_ordinal IS NULL` and `next_eligible_at IS NULL`, and the
`CLAIM` predicate `target_period_ordinal IS NOT NULL` skips it forever. The next season is a
**new row** created by discovery. The exhausted row is retained as history and never mutated.

---

## 5. Lease tokens — no ABA ambiguity

🛑 **`lease_owner` stores a per-claim-attempt token, never a worker or host identity.** With
a stable id, this sequence silently corrupts state: worker A claims, A stalls, the lease
expires, worker A **re-claims** (or B claims and A resumes), and A's in-flight `COMPLETE`
matches `lease_owner = 'worker-A'` against a lease it no longer conceptually holds.

**Format** — 55 characters, comfortably inside `VARCHAR(64)`; **no schema change required**:

```
<workerId:8><'-'><epochMillisBase36:9><'-'><random128Base64Url:22>   →  8+1+9+1+22 = 41
```

Worked example: `wkr-a3f1-m8k2p0q7x-Zk3sJ1nQpR7vL9wA2bXyTg` (41 chars).
The reserved headroom to 64 allows a longer worker prefix without migration.

```ts
export function newLeaseToken(workerId: string): string {
  const worker = workerId.slice(0, 8)
  const when = Date.now().toString(36)                       // 9 chars until year 5138
  const rand = crypto.randomBytes(16).toString('base64url')  // 128 bits, 22 chars
  const token = `${worker}-${when}-${rand}`
  if (token.length > 64) throw new Error('lease token exceeds VARCHAR(64)')
  return token
}
```

| Question | Answer |
| --- | --- |
| Generation | `crypto.randomBytes(16)` — 128 bits, never a counter or timestamp alone |
| Uniqueness | **Per claim attempt**, not per worker, per process or per batch |
| One token per row or per batch? | **One token per CLAIM invocation**, applied to every row that batch claimed. Rows claimed together share a token; a *later* claim by the same worker gets a **new** token. |
| Heartbeat | Matches the exact token **and** requires an unexpired lease; 0 rows ⇒ abandon |
| Stale attempt | Its token no longer matches, so every transition affects 0 rows and it writes nothing |
| Reacquisition after expiry | Produces a **new** token, so the previous execution's token can never match again |
| Why ABA cannot occur | The old token is never regenerated: 128 random bits make reuse infeasible, and reacquisition always mints a fresh value |

The worker id is kept only for diagnostics — it is a prefix, never the identity.

---

## 6. Finality-correction membership policy

**Ordinary corrections preserve membership.** A `stat_correction` changes evidence, not who
played. Its replacement observation set **must** equal its predecessor set; a mismatch means
the recompute lost or invented a team and is a rollback.

🛑 **But a pinned `roster_team_map` can itself be wrong**, and an accepted snapshot must not
become unrepairable. A mapping is materially wrong when it maps a provider roster to the
incorrect `LeagueTeam` — an identity fault, not an evidence fault.

**`membership_correction` — a separate, controlled operation.**

- **Distinct `revision_reason`.** `membership_correction` is added to `lpf_revision_reason_chk`
  alongside `source_refresh`, `became_settled`, `stat_correction`,
  `commissioner_correction`, `manual_review`. It is the **only** reason permitted to change
  the mapped team set, and like the other correction reasons it requires
  `correction_reason` and `correction_source_at`.
- **Requires explicit human authorization**, recorded in `correction_reason`. It is never
  automatic and never triggered by a provider refresh.
- **Preserves lineage:** the new revision cites its predecessor through
  `supersedes_finality_id`, identity-bound by the composite FK, and the chain stays linear.
- **Preserves historical observations:** predecessors are tombstoned, never deleted or
  edited. Both facts payloads survive verbatim.
- **Atomic league-wide recomputation:** every team is recomputed and replaced in the same
  transaction as the finality revision, exactly as §8 of the errata specifies.
- **Membership equality is asserted against the NEW pinned map**, not the predecessor's — the
  one place the equality check is deliberately relaxed, and only for this reason code.
- **No silent mutation:** the immutability trigger still forbids every update except the
  tombstone flip.

⚠ `expected_roster_ids` is **immutable across a membership correction**. What the provider
reported for that period is a fact; only the internal mapping of those ids to `LeagueTeam`
rows may be repaired.

---

## 7. Runnable test designs

🛑 **Every concurrency test uses two independent database connections.** Sequential calls on
one connection share a transaction context and cannot observe a lock race — such a test
passes without exercising anything.

**Shared fixture** (`F`): tenant `allfantasy`; `AppUser u1` (`@…​.invalid`); `League L1`
(sleeper, platform `P1`, `sport NFL`, `season 2999`, `playoffStartWeek 15`, `playoffTeams 4`,
`playoffWeeksPerRound 1`); `LeagueSeason (L1,2999,status='active')`;
`ImportRun (leagueId=L1, season=2999, status='completed', completedAt=…)`;
`LeagueTeam T1..T4`; `WeeklyMatchup` weeks 1–6 scored; `LeaguePeriodFinality F1`
(week 6, accepted, settled, `roster_team_map {"1":"T1","2":"T2","3":"T3","4":"T4"}`).

| # | Test | Fixture delta | Assertions |
| --- | --- | --- | --- |
| 1 | **Two-worker claim race** | 1 checkpoint row; conns A and B `CLAIM` simultaneously | Exactly one conn returns 1 row; the other returns **0** (SKIP LOCKED, not blocked). Tokens differ. `lease_owner` equals the winner's token |
| 2 | **Lease expiry during assembly** | A claims; force `lease_expires_at = now - 1s`; B claims | B's claim returns 1 row; A's `HEARTBEAT` returns **0**; A's `COMPLETE` returns **0** and writes nothing; observation count unchanged |
| 3 | **Stale completion** | A claims, B re-claims after expiry; A attempts `COMPLETE` with its old token | A affects **0** rows; `last_completed_period` unchanged; `target_period_ordinal` unchanged; no observation written |
| 4 | **Concurrent finality correction** | Two conns correct `F1` citing the same prior id | One commits; the other aborts at the `FOR UPDATE` re-check. Exactly one accepted revision; `revision = 2`; `uniq_lpf_supersedes` holds |
| 5 | **Rollback during whole-period correction** | Correction transaction; force the final observation insert to fail | Prior finality back to `accepted` with `superseded_at IS NULL`; all 4 prior observations `accepted`; zero replacement rows; accepted count still 4 |
| 6 | **Active + shadow contracts concurrently** | Two checkpoint rows, contracts `…-1` and `…-2`; both claimed at once | Both claim successfully; each advances its **own** `last_completed_period`; neither sees the other's; `uniq_twobs_accepted` permits one accepted row per contract for the same team-period |
| 7 | **Non-UTC session equivalence** | Run 1–6 with `SET timezone='America/Los_Angeles'` | Every stored timestamp, lease expiry decision, deferral deadline and correction ordering **byte-identical** to the UTC run |
| 8 | **Season-boundary exhaustion** | Target = last period (week 17 with the fixture's playoff settings); `COMPLETE` it | `target_period_ordinal IS NULL`; `next_eligible_at IS NULL`; a subsequent `CLAIM` returns **0 rows**; no row with `period_ordinal >= 18` exists anywhere |
| 9 | **Import/discovery decoupling** | Drop `team_window_checkpoint_states`; run a league import | Import **succeeds**; then recreate the table, run discovery, and the checkpoint row appears with the correct per-league target |
| 10 | **Stable worker id, unique tokens** | One worker claims, releases, re-claims 3× | Three distinct `lease_owner` values sharing the same 8-char prefix; token 1 cannot satisfy any transition after token 2 exists |
| 11 | **Midseason import with earlier settled periods** | Weeks 1–9 scored, `ImportRun.completedAt` in week 10 | Policy L target ≥ period 3 (lookback satisfied) and ≤ latest settled; **not** period 1, **not** period 10; Policy H queue contains the earlier periods |
| 12 | **Duplicate SKIP retry** | Run `SKIP` for period 6 twice | Exactly **one** `team_window_period_outcomes` row; second attempt affects 0 rows and does **not** advance the target a second time |
| 13 | **Schedule ending before NFL week 18** | `playoffStartWeek = 15`, `playoffTeams = 4`, `weeksPerRound = 1` → last period 16 | `nextExpectedPeriod(16)` = `no_period`; exhaustion at 16, not 18 |
| 14 | **Empty playoff schedule** | `playoffTeams = 1` (or 0) | Zero playoff weeks; season ends at `playoffStartWeek - 1`; no invalid period created |
| 15 | **Postseason import** | Import completes after the last period | No live checkpoint row for that season; discovery creates the next season's row when it activates |
| 16 | **Corrupted pinned roster map** | `F1.roster_team_map` maps two rosters to `T1` | `COMPLETE` step (c) `injective` false → **ROLLBACK**; nothing completes; the fault is visible, not absorbed |
| 17 | **Multiple leagues, different targets** | L1 (weeks 1–6), L2 (weeks 1–2), L3 (no scored weeks) | Discovery inserts three rows with **three different** `target_period_ordinal` values; L3 initializes at period 1 |
| 18 | **Ineligible / failed import excluded** | L4 with `ImportRun.status='failed'`; L5 with `LeagueSeason.status <> 'active'` | Neither appears in discovery output; no checkpoint row created for either |

---

## 8. Release gates

| Gate | Status |
| --- | --- |
| Import Integrity Batch A lands in the target integration branch | **Open** — `import-integrity-batch-a` @ `a3505ed2b`; verified **not** an ancestor of `origin/main` (rc=1) |
| Full reader census from the Batch A integration audit passes | **Open** |
| `prisma/schema.prisma` released by the other session | **Open** — still modified-uncommitted |
| Production PostgreSQL major confirmed | **Open** — not pinned in repo config; test Neon reports **17.11**; validated on 18.3 **and** 17.9, identical |
| IMP-05 period finality implemented, or its exact contract supplied | **Open** — contract supplied in proposal §5; no implementation |
| Real concurrency and non-UTC tests pass | **Open** — §7, none implemented |

---

## 9. Close-out

**Resolved by this document:** the defective one-size-fits-all discovery SQL; unproven
eligibility filters (now grounded in `ImportRun.status`, `LeagueSeason.status`, `League.sport`);
hardcoded `'NFL'`; the insufficient activation-only initialization rule; missing historical
catch-up policy; two competing checkpoint transactions; missing `RETURNING`/affected-row
validation on `DEFER`/`FAIL`/`RELEASE`; blind `period + 1`; lease-owner ABA ambiguity; the
unrepairable pinned roster map; and the absence of runnable test designs.

**Remaining blockers:** the six release gates in §8, plus prerequisites **P-1** (no
League-level activity signal) and **P-2** (no `League.activatedAt`).

**Files the implementation batch will create or modify:**

| File | Action |
| --- | --- |
| `prisma/schema.prisma` | modify — 4 models + 4 reverse relations (**blocked**) |
| `prisma/migrations-pending/<ts>_team_window_observations/migration.sql` | create |
| `lib/decision-os/value-v2/periodCalendar.ts` | create — `nextExpectedPeriod`, `resolveInitialTarget` |
| `lib/decision-os/value-v2/leaseToken.ts` | create — `newLeaseToken` |
| `lib/decision-os/value-v2/checkpointStore.ts` | create — the seven transitions |
| `lib/decision-os/value-v2/observationStore.ts` | create — reader + writer over stored observations |
| `lib/decision-os/value-v2/finalityCorrection.ts` | create — §6 |
| `lib/decision-os/value-v2/windowDiscovery.ts` | create — §2 |
| `app/api/cron/decision-os-window-discovery/route.ts` | create |
| `app/api/cron/decision-os-window-checkpoint/route.ts` | create |
| `lib/decision-os/value-v2/windowDecision.ts` | modify — read stored observations instead of reconstructing |
| `scripts/check-window-schema-sql-parity.mjs` | create |
| `__tests__/decision-os/value-v2-window-*.test.ts` | create — §7 |

**Recommended implementation order:**

1. `periodCalendar.ts` + `leaseToken.ts` — pure, testable now, no schema needed.
2. Parity script + unit tests for 1.
3. **Wait for the schema release**, then land models + migration.
4. `checkpointStore.ts` with tests 1–3, 6, 8, 10, 12 on a real database.
5. `windowDiscovery.ts` + cron, with tests 9, 11, 15, 17, 18.
6. `finalityCorrection.ts` with tests 4, 5, 16.
7. `observationStore.ts`; repoint `windowDecision.ts`.
8. Checkpoint cron; non-UTC suite (test 7) across the whole set.
9. Production major-version confirmation, then authority cutover as separate work.

**Nothing was implemented, migrated, deployed or committed.** No Prisma file was edited, no
migration was created, no database was modified. The two disposable PostgreSQL clusters used
for earlier validation were destroyed.

**Milestone 19 progress: 34%.**
