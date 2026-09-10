# Decision OS Milestone 19 — Revision 5.2 errata

**ERRATA ONLY. NOT IMPLEMENTED, NOT COMMITTED, NOT MIGRATED, NOT APPLIED.**
No Prisma file, migration file or service was created or edited. `prisma/schema.prisma`
remains held by another session.

Applies to `DECISION_OS_M19_OBSERVATION_MODEL_PROPOSAL.md` (Revision 5.2). Nothing in the
valuation architecture changes.

## Sections of Revision 5.2 that this errata replaces

| Revision 5.2 section | Status |
| --- | --- |
| **§8 "Checkpoint transaction — conflict-safe"** (proposal lines 796–930) | **DELETED — superseded in full by §18.6.** It omits `resolverContract`, lease release, target advancement and deferral clearing. It must not be implemented. |
| §14 rollback, final two `DROP FUNCTION` lines | **REPLACED** — errata §2 |
| §2.4 reverse-relations snippet | **REPLACED** — errata §3 |
| §8 "Checkpoint rows for newly imported leagues" | **REPLACED** — errata §4 |
| §18.6 `SKIP` and `COMPLETE`, target advancement | **REPLACED** — errata §5 |
| §18.6 `DEFER`, `FAIL`, `RELEASE` | **REPLACED** — errata §6 |
| §18.6 `COMPLETE` step (c) | **REPLACED** — errata §7 |
| §18.5 finality-correction transaction | **REPLACED** — errata §8 |
| §18.4 "What this does and does not prove" (lines 1715–1725) | **REPLACED** — errata §9 |
| §17 readiness rows | **REPLACED** — errata §12 |

**§18.6, as corrected by this errata, is the only authoritative checkpoint SQL.**

---

## 1. One canonical checkpoint transaction

Revision 5.2 contains two executable checkpoint transactions. §8 predates the work-queue
redesign: it locks on `(league_id, season)` only, never releases the lease, never advances
`targetPeriodOrdinal`, and never clears deferral state. A worker built from it would hold a
lease forever and reprocess one period indefinitely.

🛑 **§8 is deleted.** §18.6 as corrected below is authoritative. Where the two disagree,
§18.6 wins; where §8 has no counterpart, it has no authority either.

---

## 2. Production rollback must not drop test helpers

Revision 5.2's rollback ends with two lines that must be removed:

```sql
-- REMOVE — these are disposable-test helpers, not migration-owned objects.
DROP FUNCTION IF EXISTS must_fail(text, text);
DROP FUNCTION IF EXISTS must_pass(text, text);
```

`must_fail` and `must_pass` are generic names created by the disposable-database harness. A
production rollback that drops a function it did not create can silently remove an unrelated
object belonging to someone else. Their creation and cleanup belong in the test script:

```sql
-- tests52.sql, at the end
DROP FUNCTION IF EXISTS must_fail(text, text);
DROP FUNCTION IF EXISTS must_pass(text, text);
```

Everything above those two lines in §14 stands unchanged.

---

## 3. Reverse relations — corrected, and the omission reported

⚠ **Two errors, reported rather than quietly fixed.**

1. **Revision 5.1 omitted `windowPeriodOutcomes` entirely.** `prisma format` generated it on
   `League`; the document did not show it.
2. **Revision 5.2 added it by hand and got the whitespace wrong.** The displayed snippet used
   single-space padding; `prisma format` aligns to the widest field name in `League`, which
   is far wider. So the snippet was **not** byte-equivalent to the validated schema, even
   though the four new model blocks were.

Exact post-`prisma format` text, copied from the schema that passed validation:

```prisma
model League {
  // …
  windowObservations                    TeamWindowObservation[]
  periodFinality                        LeaguePeriodFinality[]
  windowCheckpoints                     TeamWindowCheckpointState[]
  windowPeriodOutcomes                  TeamWindowPeriodOutcome[]
}

model LeagueTeam {
  // …
  windowObservations TeamWindowObservation[]
}
```

**Re-run byte-equivalence comparison** (line-based extraction, not visual review):

```
LeaguePeriodFinality         BYTE-EQUAL
TeamWindowObservation        BYTE-EQUAL
TeamWindowCheckpointState    BYTE-EQUAL
TeamWindowPeriodOutcome      BYTE-EQUAL
ALL BYTE-EQUAL          exit 0
```

The four model blocks are byte-identical. The reverse-relations snippet is a hand-written
excerpt of an existing model and is corrected above.

---

## 4. Checkpoint discovery is decoupled from import

🛑 **Do not create checkpoint state inside the league-import transaction.** Import success
must never depend on Decision OS configuration, the active resolver contract, checkpoint
table availability, or checkpoint worker health. A Decision OS misconfiguration would
otherwise fail a user's league import.

**`/api/cron/decision-os-window-discovery`** — independently scheduled, idempotent, hourly.

```sql
-- Create missing checkpoint rows for active, successfully imported leagues, for EVERY
-- configured contract. Idempotent: safe to rerun hourly, and a new contract is picked up on
-- the next pass with no backfill job.
INSERT INTO team_window_checkpoint_states
       (id, league_id, season, sport, resolver_contract, target_period_ordinal,
        deferral_attempts, consecutive_failures, next_eligible_at, created_at, updated_at)
SELECT gen_random_uuid()::text, l.id, $1, 'NFL', c.contract,
       $2,          -- nextExpectedPeriod(season, league, activatedAt) — errata §5
       0, 0, $3,
       timezone('UTC', CURRENT_TIMESTAMP), timezone('UTC', CURRENT_TIMESTAMP)
  FROM leagues l
  CROSS JOIN (SELECT unnest($4::text[]) AS contract) c
 WHERE l.platform = 'sleeper'
   AND l."platformLeagueId" IS NOT NULL
ON CONFLICT ON CONSTRAINT "uniq_twcs_league_season_contract" DO NOTHING;
```

- **Never modifies import success state** — it only inserts into its own table.
- **Records its own failures** in `SyncJobRun` (`jobName: 'decision-os-window-discovery'`).
- An outbox event may *accelerate* discovery, but **the periodic scanner is the recovery
  authority**: an event that is lost, dropped or never emitted is repaired on the next scan.

---

## 5. Period-calendar resolver replaces blind increment

🛑 **Every `targetPeriodOrdinal = targetPeriodOrdinal + 1` is replaced.** A blind increment
creates period 19, 20 … 26 after the league's schedule ends, then trips
`twobs_ordinal_chk`, or silently rolls into another season.

```ts
/** Null means the season has no remaining period for this league. */
export function nextExpectedPeriod(input: {
  season: number
  currentPeriod: number | null
  regularSeasonEndWeek: number      // league setting, often < 18
  playoffWeeks: readonly number[]   // league playoff schedule, may be empty
  activatedAt: Date | null          // for initialization
}): number | null
```

It must handle: regular-season end; fantasy playoff weeks; a league whose schedule ends
before NFL week 18; a postseason import; **no remaining period**; and next-season
initialization as a separate discovery-job concern, never an in-place roll.

**When no period remains**, the season checkpoint is exhausted — target cleared, never
advanced:

```sql
UPDATE team_window_checkpoint_states
   SET target_period_ordinal = NULL,
       next_eligible_at      = NULL,
       lease_owner = NULL, lease_expires_at = NULL,
       updated_at = timezone('UTC', CURRENT_TIMESTAMP)
 WHERE league_id = $1 AND season = $2 AND resolver_contract = $3 AND lease_owner = $4
RETURNING id;   -- affected rows must equal exactly 1
```

A row with `target_period_ordinal IS NULL` is skipped by the claim query
(`AND target_period_ordinal IS NOT NULL` is added to its `WHERE`). The next season's row is
created by discovery (§4), not by mutating this one.

**Initialization** uses the same resolver: `targetPeriodOrdinal` = the first period whose
`settleEligibleAt >= league.activatedAt`. Never period 1 for a midseason import.

---

## 6. Every transition is compare-and-set

`DEFER`, `FAIL` and `RELEASE` in Revision 5.2 lack `RETURNING`. All three are corrected:
**every transition other than the batch claim must return the affected row**, and no caller
may report success without checking.

| Affected rows | Meaning |
| --- | --- |
| **1** | Success |
| **0** | Lease lost, state changed, or a stale worker. **Abandon; do not report success.** |
| **>1** | Structurally impossible under `uniq_twcs_league_season_contract`. Treat as corruption: abort, alert, do not continue. |

```sql
-- ============ DEFER ============
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
RETURNING id;

-- ============ FAIL ============
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
RETURNING id;

-- ============ RELEASE ============
UPDATE team_window_checkpoint_states
   SET lease_owner = NULL, lease_expires_at = NULL,
       updated_at = timezone('UTC', CURRENT_TIMESTAMP)
 WHERE league_id = $1 AND season = $2 AND resolver_contract = $3
   AND lease_owner = $4
RETURNING id;
```

⚠ `DEFER` and `FAIL` now also require an **unexpired** lease. Without that, a worker whose
lease expired mid-assembly could still write deferral state over a newer worker's progress.

---

## 7. Completion uses the pinned roster mapping

🛑 **The expected team set comes from the accepted finality revision's immutable
`rosterTeamMap`, never from current `LeagueTeam` rows.** Otherwise a team orphaned,
restored or renamed in week 12 changes whether week 6 is judged complete — which is exactly
the retroactive reinterpretation this whole model exists to prevent.

`COMPLETE` step (c) becomes four checks:

```sql
-- (c) Expected set is PINNED, taken from the finality revision being completed against.
--     f.roster_team_map :: {"<providerRosterId>": "<leagueTeamId>"}
--     f.expected_roster_ids :: ["<providerRosterId>", ...]
SELECT
  -- c1: the mapping's provider keys must exactly equal the pinned expected roster ids
  (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(f.roster_team_map) k)
    = (SELECT array_agg(e ORDER BY e) FROM jsonb_array_elements_text(f.expected_roster_ids) e)
    AS keys_match,
  -- c2: mapped LeagueTeam ids must be unique — two rosters cannot map to one team
  (SELECT count(*) FROM jsonb_each_text(f.roster_team_map))
    = (SELECT count(DISTINCT value) FROM jsonb_each_text(f.roster_team_map))
    AS mapping_injective,
  -- c3: the pinned mapped team set
  (SELECT array_agg(value ORDER BY value) FROM jsonb_each_text(f.roster_team_map)) AS expected_teams
FROM league_period_finality f
WHERE f.id = $10;
-- keys_match false OR mapping_injective false -> ROLLBACK

-- c4: observed accepted observations must equal the pinned mapped set, exactly.
SELECT array_agg(league_team_id ORDER BY league_team_id)
  FROM team_window_observations
 WHERE league_id = $1 AND season = $2 AND period_type = 'week' AND period_ordinal = $9
   AND resolver_contract = $3 AND lifecycle = 'accepted';
-- <> expected_teams -> ROLLBACK
```

No query in the completion path reads `league_teams.isOrphan`, or `league_teams` at all.

---

## 8. Finality correction — short transaction, snapshot inputs

Revision 5.2 recomputed every team *inside* the lock (its step 5). Recomputation is
proportional to team count and holds a lock the whole time. Corrected:

**Outside the transaction**, from immutable input snapshots only:

1. Read the prior finality revision and record `id`, `revision`, `contentHash`, `lifecycle`
   and period identity.
2. Read the prior accepted observation set and record their ids and team set.
3. Compute the replacement finality row and **all** replacement observations.
4. No provider I/O, no database writes.

**Inside the transaction** — verification and writes only:

```sql
BEGIN;

-- 1. Lock the exact expected prior revision, and verify nothing moved since the snapshot.
SELECT id FROM league_period_finality
 WHERE id = $1 AND revision = $2 AND content_hash = $3
   AND lifecycle = 'accepted'
   AND league_id = $4 AND season = $5 AND period_type = $6 AND period_ordinal = $7
   FOR UPDATE;
-- Zero rows -> ABORT. Superseded, revised, or identity mismatch since the snapshot.

-- 2. Lock the exact prior observation set and verify it is unchanged.
SELECT id, league_team_id FROM team_window_observations
 WHERE league_id = $4 AND season = $5 AND period_type = $6 AND period_ordinal = $7
   AND resolver_contract = $8 AND lifecycle = 'accepted'
   FOR UPDATE;
-- id set <> precomputed predecessor ids -> ABORT
-- team set <> precomputed team set     -> ABORT

-- 3. Tombstone finality; affected rows must equal exactly 1.
UPDATE league_period_finality
   SET lifecycle='superseded', superseded_at = timezone('UTC', CURRENT_TIMESTAMP)
 WHERE id = $1 AND lifecycle='accepted' RETURNING id;

-- 4. Insert the replacement revision: revision = $2 + 1, composite FK pins the period.
INSERT INTO league_period_finality (...) VALUES (...);

-- 5. Tombstone all prior observations; affected rows must equal the snapshot count.
UPDATE team_window_observations
   SET lifecycle='superseded', superseded_at = timezone('UTC', CURRENT_TIMESTAMP)
 WHERE id = ANY($9) AND lifecycle='accepted' RETURNING id;

-- 6. Insert the precomputed replacements, each citing its own predecessor and the new
--    finality id.
INSERT INTO team_window_observations (...) VALUES (...);

-- 7. Replacement team set must equal the prior team set. A correction changes evidence,
--    never membership.  Mismatch -> ROLLBACK.

COMMIT;
```

Every team is still recomputed — all-play and schedule-luck move league-wide — but the
recomputation happens before the lock is taken, and the transaction only verifies that the
world it snapshotted still holds.

---

## 9. Validation status — corrected

Revision 5.2 §18.4 still says partial indexes, CHECK constraints and triggers "remain
**unvalidated until executed against a real test database**." That was true when written and
is now stale: §19 executed them. Replace with:

| Aspect | Status |
| --- | --- |
| Schema structure, relations, constraint naming | **Validated by Prisma** — `validate`/`format`/`migrate diff` exit 0 |
| Migration apply, CHECK constraints, partial unique indexes, immutability triggers, rollback, reapply | **Validated on disposable PostgreSQL** — 23 assertions, PG 18.3 **and** PG 17.9 |
| **Concurrency behaviour** | **NOT validated** — lease races, stale workers, concurrent corrections. §11 |
| **Non-UTC session equivalence** | **NOT validated** |
| Production major-version parity | **See §10** |

---

## 10. PostgreSQL version parity

**Production major version is not determinable from repository configuration.** The Prisma
datasource is a generic `provider = "postgresql"`; no `railway.json`, `nixpacks.toml`,
Dockerfile or doc pins a version. **No production connection was made** — production
credentials remain out of scope.

**Authoritative non-production evidence:** the approved test endpoint named in `.env.test`
(`ep-muddy-leaf-adigvvph…neon.tech`) reports `server_version` **17.11**. Production is a
different Neon endpoint (`ep-curly-block-…`) in the same provider, so **17.x is the
strongly-indicated production major** — indicated, not confirmed.

⚠ Revision 5.2 §19 validated on **PostgreSQL 18.3 only**, which does not prove behaviour on
17.x. PostgreSQL 17 was available locally, so **the full sequence was re-run on 17.9**:

| Step | PG 18.3 | PG 17.9 |
| --- | --- | --- |
| Base schema | exit 0 — 717 tables | exit 0 — 717 tables |
| Forward migration | exit 0 — 4/2/2/2/42 | exit 0 — 4/2/2/2/42 |
| Assertions | exit 0 — 23 | exit 0 — **23** |
| Rollback | exit 0 | exit 0 |
| Objects gone | 0/0/0/0/0; 717 intact | 0/0/0/0/0; 717 intact |
| Reapply | exit 0 — 4/2/2/2/42 | exit 0 — 4/2/2/2/42 |
| Re-run assertions | exit 0 — 23 | exit 0 — **23** |

Identical on both majors. Both clusters were created with `initdb` (trust auth, ports 55432
and 55433), used, and destroyed. Nothing shared was touched.

🛑 **Release gate, still open:** confirm the production major from deployment configuration
or a read-only server-version check before shipping. If it is neither 17 nor 18, re-run the
sequence on that major.

---

## 11. Remaining real-database test plan

None of these is implemented. All require a real database and a running worker.

| # | Test |
| --- | --- |
| 1 | Two workers racing the same lease — exactly one claims, the other skips |
| 2 | Lease expiry during assembly — the worker abandons without writing |
| 3 | Stale worker attempting completion — affected rows 0, no state change |
| 4 | Concurrent finality corrections on one revision — one commits, the other aborts |
| 5 | Rollback during whole-period observation correction — prior finality **and** every prior observation restored |
| 6 | Active and shadow contracts processing concurrently — separate rows, no shared progress |
| 7 | Non-UTC session equivalence — `SET timezone='America/Los_Angeles'`, results byte-identical |
| 8 | Season-boundary target advancement — exhausted season clears the target, creates no period 26 |
| 9 | Discovery/import decoupling — import succeeds with the checkpoint table absent, discovery repairs later |

---

## 12. Readiness status

| Item | State |
| --- | --- |
| Migration and schema foundation | **Design-approved; executed on disposable PostgreSQL 18.3 and 17.9** — apply, 23 assertions, rollback, reapply, re-run |
| Reconciliation soft-delete (`LeagueTeam`) | **Implemented on unmerged branch** — `import-integrity-batch-a` @ `a3505ed2b`; verified not an ancestor of `origin/main` (rc=1). Clears only when that branch lands in the migration's target branch |
| Canonical checkpoint worker | **Specified, not implemented** — §18.6 as corrected by this errata |
| Checkpoint discovery job | **Specified, not implemented** — errata §4 |
| Period-calendar resolver | **Specified, not implemented** — errata §5 |
| Concurrency and timezone tests | **Not implemented** — errata §11 |
| Production major-version parity | **Open release gate** — errata §10 |
| IMP-05 matchup finality | **Externally blocked** — no specification exists |
| Scheduled forecast / dynasty producers | **Externally blocked** — request-triggered only |
| `prisma/schema.prisma` release | **Externally blocked** — held by another session |
| **Milestone 19** | **34%** |
