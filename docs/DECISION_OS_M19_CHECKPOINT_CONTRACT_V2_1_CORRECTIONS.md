# Decision OS Milestone 19 — Checkpoint Contract V2.1 corrections

**ADDENDUM ONLY. NOTHING IMPLEMENTED, MIGRATED, DEPLOYED, COMMITTED. NO PRISMA EDIT.**
**Milestone 19 progress remains 34%.**

Amends `DECISION_OS_M19_CHECKPOINT_CONTRACT_FINAL_V2.md`. Everything not amended below
stands. Where this addendum and V2 disagree, **this wins**.

## Amendments at a glance

| # | V2 section | Amendment |
| --- | --- | --- |
| 1 | §3.2 | Non-power-of-two playoff fields are **supported**, not refused. Upper bound taken from the repository contract |
| 2 | §2 S-2, §4.1 | `laneFloorPeriod` added and persisted; bounds immutable; CHECKs; atomic sibling creation |
| 3 | §4.3 | Historical lane starts at the first **scheduled** period in range, not the first with evidence |
| 4 | §4.2, new | Seed barrier: a live lane cannot claim non-provisional history it does not have |
| 5 | §2 (V1 removal) | Repository-grounded discovery algorithm restored in full |
| 6 | §5.3–5.5, §5.1, §5.8 | Complete DEFER/FAIL/RELEASE SQL; CLAIM parameters disambiguated; recovery re-checks lease expiry |
| 7 | §6 | Two-stage JSON validation — malformed JSON returns a refusal, not a PostgreSQL exception |
| 8 | §7 | Tests corrected and extended |

---

## 1. Playoff brackets — support the ordinary cases

🛑 **V2 refused every non-power-of-two field via `unsupported_bracket_structure`.** Six-team
playoffs with two first-round byes are the most common configuration in this sport; refusing
them would refuse a large share of real leagues.

**Rounds are `ceil(log2(playoffTeams))`**, which is already correct for byes: a 6-team field
plays 3 rounds (2 games / semis / final), the two top seeds simply idle in round 1. The
provider's own `playoffStartWeek` and `playoffWeeksPerRound` are preserved exactly and never
inferred.

```
playoffRounds = playoffTeams <= 1 ? 0 : ceil(log2(playoffTeams))
playoffWeeks  = playoffRounds * playoffWeeksPerRound
lastPeriod    = playoffWeeks === 0 ? playoffStartWeek - 1
                                   : playoffStartWeek + playoffWeeks - 1
```

### 1.1 The upper bound is repository-grounded, not assumed

**`lib/ai/sim/simulateApiCore.ts:37`** — the only validated playoff-field bound in the
repository:

```ts
playoffTeams: z.number().min(2).max(16).optional(),
```

So `PLAYOFF_TEAMS_REPO_MAX = 16`, and the effective bound is
`min(League.leagueSize ?? PLAYOFF_TEAMS_REPO_MAX, PLAYOFF_TEAMS_REPO_MAX)` — a playoff field
cannot exceed the league. `League.playoffTeams` defaults to 4; `playoffWeeksPerRound`
defaults to 1.

⚠ **A 32-team playoff field is outside the repository contract today.** The arithmetic works
(`ceil(log2(32)) = 5` rounds) and nothing in this design prevents it, but admitting it means
raising that zod bound — a deliberate repository-contract change, not something this addendum
assumes. Until then a 32-team field returns `playoff_teams_exceeds_repo_bound`, which names
the reason rather than pretending the bracket is unknowable.

### 1.2 Refusals, narrowed

| Condition | Result |
| --- | --- |
| `playoffTeams` 0 or 1 | **Supported** — zero playoff weeks; season ends at `playoffStartWeek - 1` |
| `2 <= playoffTeams <= bound`, any integer | **Supported** — `ceil(log2(n))` rounds, byes included |
| `playoffTeams > bound` | `playoff_teams_exceeds_repo_bound` |
| `playoffTeams` > `League.leagueSize` | `playoff_teams_exceeds_league_size` |
| `playoffTeams` null / non-integer / negative | `playoff_teams_missing` / `playoff_teams_out_of_range` |
| `lastPeriod > 25` | `schedule_exceeds_period_bound` |

**`unsupported_bracket_structure` is retained but narrowed** to structures genuinely not
inferable from `(playoffTeams, playoffWeeksPerRound)` — for example a provider flag
indicating a re-seeding or double-elimination format. It is never returned merely because a
count is not a power of two.

### 1.3 Verified arithmetic

| teams | rounds | `wpr=1`, `start=15` → periods | last |
| --- | --- | --- | --- |
| 1 | 0 | none | 14 |
| 2 | 1 | 15 | 15 |
| 4 | 2 | 15–16 | 16 |
| **6** | **3** | 15–17 | **17** |
| 7 | 3 | 15–17 | 17 |
| 8 | 3 | 15–17 | 17 |
| 12 | 4 | 15–18 | 18 |
| 16 | 4 | 15–18 | 18 |
| 32 | 5 | — | refused (`playoff_teams_exceeds_repo_bound`) |

---

## 2. Lane bounds — persist both, make them immutable

V2 persisted only `laneCeilingPeriod`, so the live lane's floor existed nowhere and
disjointness could not be verified after creation.

### 2.1 Revised schema delta (replaces V2 S-2, S-5)

| # | Change |
| --- | --- |
| S-2a | `TeamWindowCheckpointState.laneFloorPeriod INTEGER NOT NULL` |
| S-2b | `TeamWindowCheckpointState.laneCeilingPeriod INTEGER NOT NULL` |
| S-5a | `CHECK ("lane_floor_period" >= 1 AND "lane_ceiling_period" >= "lane_floor_period")` |
| S-5b | `CHECK ("target_period_ordinal" IS NULL OR ("target_period_ordinal" BETWEEN "lane_floor_period" AND "lane_ceiling_period"))` |
| S-5c | `CHECK ("lane_ceiling_period" <= 25)` |

Both bounds are **NOT NULL for every lane** — the live lane's ceiling is the final scheduled
period, not null. Bounds are **immutable**: no transition in §5 of V2 or §6 here writes
either column, and an exhausted lane retains them with `target_period_ordinal IS NULL`.

### 2.2 Lane initialization table

| Situation | Lane | floor | ceiling | initial target |
| --- | --- | --- | --- | --- |
| Ongoing season | `live` | `liveFloor` | `lastScheduled` | `liveFloor` |
| Ongoing season, evidence below `liveFloor` | `historical_backfill` (seed) | `firstScheduled` | `liveFloor - 1` | `firstScheduled` |
| Ongoing season, `liveFloor == firstScheduled` | — | — | — | **no historical lane** (nothing below the floor) |
| Completed season | `historical_backfill` | `firstScheduled` | `lastScheduled` | `firstScheduled` |
| Completed season | `live` | — | — | **none created** |

`liveFloor` is computed exactly as V2 §4.2 and then **frozen** as the live row's
`laneFloorPeriod`.

### 2.3 Atomic sibling creation, with disjointness validated first

```ts
// Validate BEFORE insert. Two rows that overlap must never reach the database.
function assertDisjoint(live: LaneSpec | null, hist: LaneSpec | null): void {
  for (const l of [live, hist]) {
    if (!l) continue
    if (!(l.floor >= 1 && l.ceiling >= l.floor && l.ceiling <= 25)) throw new Error('lane_bounds_invalid')
    if (!(l.target >= l.floor && l.target <= l.ceiling)) throw new Error('lane_target_out_of_bounds')
  }
  if (live && hist && !(hist.ceiling < live.floor)) throw new Error('lane_overlap')
}

await prisma.$transaction(async tx => {
  assertDisjoint(live, hist)
  await tx.teamWindowCheckpointState.createMany({
    data: [live, hist].filter(Boolean).map(toRow), skipDuplicates: true,
  })
})
```

Siblings are created in **one transaction**, so a league never exists with a live lane and no
seed lane — the state the §4 barrier depends on. `skipDuplicates` is correct here and only
here: discovery's job is "create if absent" (V2 §2.1).

---

## 3. Historical lanes process the schedule, not the evidence

🛑 **V2 initialized the historical lane at "the earliest period in `withEvidence`". Wrong.**
A missing week 1 would vanish from history simply because no `WeeklyMatchup` row exists, and
hysteresis would then see weeks 2,3,4 as three consecutive periods when week 1 was never
accounted for.

**Historical initial target = `laneFloorPeriod` = `firstScheduled`**, regardless of evidence.

A historical period with no evidence follows the ordinary contract: target it → defer →
deadline → **one durable `SKIP`** → advance. Because its deadline
(`min(deferralFirstAt + 7d, nextPeriodSettleEligibleAt)`) is already long past for an elapsed
period, the deadline is satisfied on the **first** attempt and the `SKIP` is written
immediately — backfill is not slowed by seven days per missing week.

**Completed season:** no live lane; an automatic historical lane spanning
`firstScheduled..lastScheduled`; every scheduled period processed in order; observations only
where accepted settled finality exists; otherwise defer/skip normally. **No synthetic
observations, ever.**

---

## 4. Seed barrier — do not claim history you do not have

An ongoing live lane starting at `liveFloor = 4` has no stored outcomes for periods 1–3 until
its seed lane produces them. Without a barrier, its first observation would be recorded as
`evidenced` while the three-period predecessor chain is empty.

**The barrier:**

1. While a league's seed lane exists and is **unexhausted**, the sibling live lane **cannot
   complete a non-provisional first observation** for that league.
2. **Seed-first within that league:** the seed lane is claimed ahead of its own live sibling
   until it exhausts. Global ordering is unchanged for every other league — this is a
   per-league reordering, not a global one, so one league's backfill cannot starve another
   league's live work (V2 §4.3 rate limits still apply).
3. Elapsed missing periods reach `SKIP` on the first attempt (§3), so seeding completes in a
   few claim cycles, not days.
4. Once the seed lane exhausts, normal global live-first priority resumes.

**Provisional recommendations during seeding are ALLOWED**, and are the point of the
`provisional` state:

- The live lane may complete observations while seeding, with
  `decisionState = 'provisional'`.
- **They do not count toward persistence.** The hysteresis reader counts only stored outcomes
  for consecutive scheduled predecessor periods; a provisional observation with an incomplete
  predecessor chain contributes nothing to a settle decision.
- **Eligibility for recomputation after seeding:** when the seed lane exhausts, discovery
  marks the live lane's completed provisional periods for re-evaluation. Recomputation goes
  through the **existing correction mechanism** — a `stat_correction`-shaped supersession
  with `revision_reason = 'source_refresh'` — so history stays append-only and the earlier
  provisional row is tombstoned, never edited.

🛑 **The first live result is never described as three-period-hysteresis-backed unless three
consecutive scheduled predecessor outcomes are actually stored and usable.** A `SKIP` outcome
counts as *stored and usable*: it is a real, durable statement that the period could not be
observed, and it **breaks** the streak rather than supporting it.

---

## 5. Discovery contract, restored in full

V2 claimed self-containment while deleting V1's algorithm. Restored here, unchanged in
substance, with lane initialization folded in.

### 5.1 Repository-grounded eligibility

| Signal | Source | Evidence |
| --- | --- | --- |
| Successful import | `ImportRun.status = 'completed'` **and** `leagueId IS NOT NULL` **and** `completedAt IS NOT NULL` | `lib/league-import/importPersistenceService.ts:210`; statuses `running`/`completed`/`failed` |
| Active league-season | `LeagueSeason.status = 'active'` on `(leagueId, season)` | `lib/league-import/ImportedLeagueCommitService.ts:1058`; `@@unique([leagueId, season])` |
| Sport | `League.sport` (`enum LeagueSport`: NFL, NBA, MLB, NHL, NCAAF, NCAAB, SOCCER) | Filter `sport = 'NFL'`; other sports **fall out of the scan** rather than being relabelled |
| Season | `LeagueSeason.season` | Per-season grain discovery iterates |
| Platform league id | `League.platformLeagueId` | `WeeklyMatchup.leagueId` holds the **platform** id, not `League.id` |
| Schedule | `League.playoffStartWeek` / `playoffTeams` / `playoffWeeksPerRound` | Defaults 14 / 4 / 1 |
| Evidence | `DISTINCT WeeklyMatchup.week` where `leagueId = platformLeagueId`, `seasonYear = season`, `max(pointsFor) > 0` | The scored-week gate from `lib/core-app/allPlay.ts` |
| Contracts | `DECISION_OS_WINDOW_ACTIVE_CONTRACT` + registry | Validated at startup, fails closed |

### 5.2 Algorithm

```ts
/** Phase 1 — read only. Nothing here can affect an import. */
const seasons = await prisma.leagueSeason.findMany({
  where: {
    season, status: 'active',
    league: {
      sport: 'NFL',
      platformLeagueId: { not: null },
      importRuns: { some: { status: 'completed', season, completedAt: { not: null } } },
    },
  },
  select: {
    season: true,
    league: {
      select: {
        id: true, sport: true, platform: true, platformLeagueId: true, leagueSize: true,
        playoffStartWeek: true, playoffTeams: true, playoffWeeksPerRound: true,
      },
    },
  },
})

// Evidence, keyed on the PLATFORM id. Grouped once for all leagues, not per league.
const scored = await prisma.weeklyMatchup.groupBy({
  by: ['leagueId', 'week'],
  where: { leagueId: { in: platformIds }, seasonYear: season },
  _max: { pointsFor: true },
})   // keep weeks whose _max.pointsFor > 0

/** Phase 2 — per league: schedule, lanes, insert. */
for (const s of seasons) {
  const schedule = resolveScheduledPeriods(s.league)        // §1 — refusal ⇒ skip + record
  if (schedule.kind === 'refused') { record(schedule.reason); continue }
  const lanes = resolveLanes(schedule.periods, evidenceFor(s), now)   // §2.2
  assertDisjoint(lanes.live, lanes.historical)                        // §2.3
  await createSiblingsAtomically(lanes, contracts)
}
```

- **Idempotent** on `uniq_twcs_league_season_contract_lane`.
- **Hourly recovery authority.** An acceleration event may speed discovery up; a lost, dropped
  or never-emitted event is repaired within the hour with no backfill job.
- **Independent failure reporting** in `SyncJobRun`
  (`jobName: 'decision-os-window-discovery'`), including per-league schedule refusals.
- **No coupling to the import transaction.** Discovery only inserts into its own table; a
  Decision OS misconfiguration cannot fail a league import.

---

## 6. Complete transitions

### 6.1 Parameter conventions — CLAIM is different, deliberately

**CLAIM is a batch statement over many checkpoint rows**; its parameters are *selectors*, and
it is the only transition permitted to affect ≠ 1 rows:

| CLAIM | Meaning |
| --- | --- |
| `$1` | `sport` |
| `$2` | `season` |
| `$3` | `resolver_contract` |
| `$4` | `LIMIT` (batch size) |
| `$5` | lease token for this claim invocation |

**Every single-checkpoint transition uses `IDENT`**, which is four columns:

```sql
-- IDENT ::=
league_id = $1 AND season = $2 AND resolver_contract = $3 AND processing_lane = $4
```

| Single-checkpoint | Meaning |
| --- | --- |
| `$1..$4` | `IDENT` |
| `$5` | lease token |
| `$6` | expected `target_period_ordinal` |
| `$7+` | transition-specific |

⚠ V2's `$4` meant `LIMIT` in CLAIM and `processing_lane` in `IDENT`. That collision is the
reason this table exists.

### 6.2 DEFER

```sql
UPDATE team_window_checkpoint_states
   SET last_deferred_period = target_period_ordinal,
       last_deferred_reason = $7,                       -- bounded by twcs_deferred_reason_chk
       deferral_first_at    = COALESCE(deferral_first_at, timezone('UTC', CURRENT_TIMESTAMP)),
       deferral_attempts    = deferral_attempts + 1,
       next_eligible_at     = timezone('UTC', CURRENT_TIMESTAMP) + $8::interval,
       lease_owner = NULL, lease_expires_at = NULL,
       updated_at = timezone('UTC', CURRENT_TIMESTAMP)
 WHERE league_id = $1 AND season = $2 AND resolver_contract = $3 AND processing_lane = $4
   AND lease_owner = $5
   AND lease_expires_at > timezone('UTC', CURRENT_TIMESTAMP)
   AND target_period_ordinal = $6
RETURNING id;
-- affected rows MUST equal exactly 1. 0 ⇒ lease lost/target moved ⇒ abandon, report failure.
```

### 6.3 FAIL

```sql
UPDATE team_window_checkpoint_states
   SET last_failed_at = timezone('UTC', CURRENT_TIMESTAMP),
       last_error_category = $7,                        -- bounded by twcs_error_category_chk
       consecutive_failures = consecutive_failures + 1,
       next_eligible_at = timezone('UTC', CURRENT_TIMESTAMP) + $8::interval,
       lease_owner = NULL, lease_expires_at = NULL,
       updated_at = timezone('UTC', CURRENT_TIMESTAMP)
 WHERE league_id = $1 AND season = $2 AND resolver_contract = $3 AND processing_lane = $4
   AND lease_owner = $5
   AND lease_expires_at > timezone('UTC', CURRENT_TIMESTAMP)
   AND target_period_ordinal = $6
RETURNING id;
-- affected rows MUST equal exactly 1.
```

### 6.4 RELEASE

```sql
UPDATE team_window_checkpoint_states
   SET lease_owner = NULL, lease_expires_at = NULL,
       updated_at = timezone('UTC', CURRENT_TIMESTAMP)
 WHERE league_id = $1 AND season = $2 AND resolver_contract = $3 AND processing_lane = $4
   AND lease_owner = $5
RETURNING id;
-- affected rows MUST equal exactly 1.
```

**No expiry predicate, deliberately.** Releasing a lease you still own but which has expired
is the correct cleanup. The exact-token match still prevents clearing another worker's lease.
This is the **only** transition without the expiry predicate.

### 6.5 SKIP integrity recovery — lease expiry re-checked

V2 §5.8 step 4 omitted `lease_expires_at`. Corrected:

```sql
UPDATE team_window_checkpoint_states
   SET target_period_ordinal = $7, deferral_first_at = NULL, deferral_attempts = 0,
       last_deferred_reason = NULL, next_eligible_at = $8,
       lease_owner = NULL, lease_expires_at = NULL,
       updated_at = timezone('UTC', CURRENT_TIMESTAMP)
 WHERE league_id = $1 AND season = $2 AND resolver_contract = $3 AND processing_lane = $4
   AND lease_owner = $5
   AND lease_expires_at > timezone('UTC', CURRENT_TIMESTAMP)   -- ADDED
   AND target_period_ordinal = $6
RETURNING id;
-- <> 1 -> ROLLBACK
```

---

## 7. Two-stage JSON validation

🛑 **V2's single SELECT can raise instead of refusing.** PostgreSQL does not guarantee that
`jsonb_typeof(x) = 'array'` is evaluated before `jsonb_array_length(x)` in the same target
list, so a malformed `roster_team_map` throws `cannot get array length of a non-array`
rather than returning `pinned_roster_map_invalid`.

**Stage 1 — types and presence only. Uses no extractor that can raise.**

```sql
SELECT
  (f.roster_team_map     IS NOT NULL)                        AS map_present,
  (f.expected_roster_ids IS NOT NULL)                        AS ids_present,
  (jsonb_typeof(f.roster_team_map)     = 'object')           AS map_is_object,
  (jsonb_typeof(f.expected_roster_ids) = 'array')            AS ids_is_array
FROM league_period_finality f
WHERE f.id = $7;
```

`jsonb_typeof` is total on any `jsonb` value — including JSON `null`, scalars and arrays —
and returns `'null'`, `'string'`, `'number'`, `'boolean'`, `'array'` or `'object'`. It never
raises. **The application aborts with `pinned_roster_map_invalid` unless all four are TRUE**,
and only then issues stage 2.

**Stage 2 — extraction, in a separate statement.** Reached only when stage 1 proved the types.

```sql
SELECT
  (COALESCE(jsonb_array_length(f.expected_roster_ids), 0) > 0)                       AS ids_non_empty,
  (COALESCE((SELECT count(*)          FROM jsonb_array_elements_text(f.expected_roster_ids)), 0)
   = COALESCE((SELECT count(DISTINCT value) FROM jsonb_array_elements_text(f.expected_roster_ids)), -1))
                                                                                      AS ids_unique,
  (COALESCE((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(f.roster_team_map) k), '{}')
   IS NOT DISTINCT FROM
   COALESCE((SELECT array_agg(e ORDER BY e) FROM jsonb_array_elements_text(f.expected_roster_ids) e), '{}'))
                                                                                      AS keys_match,
  (COALESCE((SELECT count(*)               FROM jsonb_each_text(f.roster_team_map)), 0)
   = COALESCE((SELECT count(DISTINCT value) FROM jsonb_each_text(f.roster_team_map)), -1))
                                                                                      AS injective,
  (COALESCE((SELECT count(*) FROM jsonb_each_text(f.roster_team_map)), 0)
   = COALESCE((SELECT count(*) FROM jsonb_each_text(f.roster_team_map) m
                JOIN league_teams lt ON lt.id = m.value AND lt."leagueId" = f.league_id), -1))
                                                                                      AS teams_valid_same_league
FROM league_period_finality f
WHERE f.id = $7;
```

Proceed only when **every** column `IS TRUE`; a `NULL` is a failure. `ids_unique` is new —
duplicate expected roster ids would make `keys_match` pass against a shorter key set.

⚠ Both stages run **inside** the COMPLETE transaction (V2 §5.6 step (c)), so a stage-1
failure rolls back before any insert. Two statements, one transaction.

---

## 8. Tests — corrected and extended

Amends V2 §7. Independent connections for concurrency; deterministic clock, ids and lease
tokens for the non-UTC comparison; disposable database for anything that drops or corrupts.
**Every negative control must be mutated and proven red before its pass is believed.**

| # | Test | Assertion |
| --- | --- | --- |
| 13′ | **Bracket arithmetic** | `start=15, wpr=1`: teams 1→last 14; 2→15; 4→16; **6→17**; 7→17; 8→17; 12→18; 16→18; 32→refused `playoff_teams_exceeds_repo_bound` |
| 26 | Six-team playoffs end to end | A 6-team league schedules 1..17, completes period 17, then exhausts. No refusal anywhere |
| 27 | Completed-season historical ownership | floor = 1, ceiling = `lastScheduled`; **no live lane**; every scheduled period visited in order |
| 28 | Missing first historical week | Week 1 has no `WeeklyMatchup`; lane targets 1, defers once, deadline already elapsed → **one SKIP for ordinal 1**, then advances to 2 |
| 29 | Seed barrier | Live lane with unexhausted seed sibling: first live observation is **`provisional`**; hysteresis reader counts it as **0** toward persistence; after seed exhaustion the period is marked for recomputation and superseded via `source_refresh` |
| 30 | Target within persisted bounds | Attempt `UPDATE … SET target_period_ordinal = ceiling + 1` → **CHECK S-5b violation** |
| 31 | Atomic sibling creation | Discovery for a league needing both lanes: either **two** rows exist or **zero**; `hist.ceiling < live.floor` holds; an injected overlap raises `lane_overlap` **before** any insert |
| 32 | Live not starved by a large backfill | League A with a 17-period completed-season backfill and League B live: B is claimed in the **first** batch; A consumes at most `HISTORICAL_MAX_PER_RUN` |
| 33 | Seed not starved by its own live row | Within one league, the seed lane is claimed ahead of its live sibling until exhausted; other leagues' live rows are unaffected |
| 34 | Malformed JSON returns a refusal | Each of: JSON `null`; SQL `NULL`; object where array expected; array where object expected; scalar (`"x"`, `7`, `true`); `{}` / `[]`; duplicate expected ids; foreign-league team id; nonexistent team id → **`pinned_roster_map_invalid`**, no PostgreSQL exception surfaces, **zero rows written** |
| 35 | SKIP recovery with expired lease | Recovery attempted after lease expiry → affected rows **0**; target unchanged; no second advancement |

Retained from V2 unchanged: 1–12, 14–25 — except **13** is replaced by 13′ above, and
**17**'s fixture is L1 weeks 1–6 → 3, L2 weeks 3–8 → 5, L3 no evidence → 1 (three distinct
targets).

---

## 9. Close-out

**Revised schema delta** — V2 §2 as amended:

| # | Change |
| --- | --- |
| S-1 | `processingLane VARCHAR(24) NOT NULL` |
| **S-2a** | **`laneFloorPeriod INTEGER NOT NULL`** |
| **S-2b** | **`laneCeilingPeriod INTEGER NOT NULL`** (was nullable) |
| S-3 | `uniq_twcs_league_season_contract_lane` on `(league_id, season, resolver_contract, processing_lane)` |
| S-4 | `CHECK (processing_lane IN ('live','historical_backfill'))` |
| **S-5a** | **`CHECK (lane_floor_period >= 1 AND lane_ceiling_period >= lane_floor_period)`** |
| **S-5b** | **`CHECK (target_period_ordinal IS NULL OR target_period_ordinal BETWEEN lane_floor_period AND lane_ceiling_period)`** |
| **S-5c** | **`CHECK (lane_ceiling_period <= 25)`** |
| S-6 | `LeagueTeam @@unique([id, leagueId], map: "uniq_league_team_id_league")` |
| S-7 | `TeamWindowObservation` composite FK `(league_team_id, league_id)` → `LeagueTeam(id, leagueId)`, RESTRICT — replaces the single-column team FK |
| S-8 | Index `(sport, season, resolver_contract, processing_lane, next_eligible_at)` |

V2's S-5 (nullable-ceiling rule) is **withdrawn**; both bounds are now NOT NULL.

**Canonical transition order:** `CLAIM` → `HEARTBEAT`\* → one of
`DEFER` | `FAIL` | `SKIP` | `COMPLETE` → (`SKIP` conflict → `SKIP integrity recovery`) →
`RELEASE` on abandon. Exhaustion is expressed by `target_period_ordinal = NULL` inside
`SKIP`, `COMPLETE` or recovery — never as its own statement.

**File list** — unchanged from V2 §10, with `periodCalendar.ts` additionally owning
`resolveLanes` and `assertDisjoint`, and `rosterMapIntegrity.ts` owning the two-stage
validation.

**Remaining external gates:**

| Gate | Status |
| --- | --- |
| Import Integrity Batch A lands in the target branch | **Open** — `a3505ed2b`, not an ancestor of `origin/main` |
| Batch A reader census passes | **Open** |
| `prisma/schema.prisma` released | **Open** |
| Production PostgreSQL major confirmed | **Open** — validated on 18.3 and 17.9; test Neon reports 17.11 |
| IMP-05 period finality implemented | **Open** — contract supplied, no implementation |
| Real concurrency + non-UTC tests pass | **Open** |
| *(new)* 32-team playoff support | **Open, optional** — requires raising `simulateApiCore.ts`'s `max(16)`; arithmetic already works |

**No implementation, commit, migration, database change, deployment or Prisma edit
occurred.** Both disposable PostgreSQL clusters from earlier validation remain destroyed.

**Milestone 19 progress: 34%.**
