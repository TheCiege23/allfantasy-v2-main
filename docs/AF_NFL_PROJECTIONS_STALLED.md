# NFL projections stopped on 2026-08-20 and the cron reports success every day

**Measured 2026-09-02, read-only against `neondb`.**

---

## 🛑 I had this backwards, and the truth is worse

The census made me say "NFL is the phase that is failing". It is not. NFL is the phase that
**succeeds while writing nothing** — which is the exact failure mode `compute-projections`'s own
header says it was built to end:

> "FAILS LOUDLY … A projection job that reports success while writing nothing is the exact failure
> this engine was built to end."

The runs that actually fail are SOCCER (7, honestly — no stat lines exist) and some older
MLB/NCAAB/NBA/NHL runs that have since resolved. NFL has **never** failed.

```
job_scope=NFL  status=success  runs=10  rows_read=6217  rows_written=0
```

Ten consecutive runs. 6,217 rows read. **Zero written.** ~310ms each — it bails before doing work.

Last NFL projection actually written: **2026-08-20 07:50:46**. Thirteen days ago.

---

## The mechanism, in four steps

### 1. `sourceSeason` is "newest season present", regardless of whether it was played

`lib/af-projections/writeAfProjectionSnapshots.ts:105-110`

```ts
const newest = await prisma.fantasyStatLine.findFirst({
  where: { sport },
  orderBy: { season: 'desc' },
  select: { season: true },
})
const sourceSeason = opts.sourceSeason ?? (newest ? Number(newest.season) : NaN)
```

### 2. `import-players` began writing 2026 NFL rows — empty shells for an unplayed season

```
fantasy_stat_lines   NFL 2026 → 1,120 rows     ← newest, ZERO games played
                     NFL 2025 → 1,938 rows     ← real, complete season
```

So `sourceSeason` flipped 2025 → 2026 around 2026-08-20.

### 3. Every player refuses, for the one reason that triggers the carve-out

Metadata from the four most recent NFL **successes**, identical each time:

```json
{"sport":"NFL","refusalRate":1,"rowsUpdated":0,"sourceSeason":2026,"targetSeason":2026,
 "refusalsByReason":{"no_games_played":1120},"noSourceSeasonYet":true,"weeklyWritten":0}
```

### 4. The offseason carve-out fires and marks it healthy

`app/api/cron/compute-projections/route.ts:79-83`

```ts
const noSourceSeasonYet =
  zeroRows && r.refused > 0 && reasons.length === 1 && reasons[0] === 'no_games_played'
const failed = (zeroRows || tooManyRefusals) && !noSourceSeasonYet
```

**The carve-out's reasoning is correct and its condition is not.** It exists because in a true
offseason every player legitimately refuses with `no_games_played`, and an hourly red for something
the calendar resolves in September is a red nobody reads. That is right.

But it fires on "the newest season has no games", not on "no season has games". Here a complete
2025 season with 1,938 rows sits right there, and it produced 1,576 projections until the flip.

**Without the carve-out this would have been a loud 500 every day since 20 August.** The safeguard
is what made it silent.

---

## Why this matters more than it looks

- **It is peak season for the product.** Late August is drafting and trading season. Projections
  froze exactly when managers use them most.
- **It blocks Phase 1.** The value engine was just wired to `AFProjectionSnapshot`. It now points at
  an NFL table that stopped updating on 20 August.
- **`rosProjection` will stay NULL for NFL indefinitely.** The new columns are only populated on
  write, and NFL never writes. The `af_projection_rows_without_ros` warning will fire forever.
- **It self-heals eventually but not usefully** — once 2026 games are actually played,
  `games_played > 0` and the run resumes. But that is after week 1 completes, and the whole
  preseason window is lost every single year.

⚠ **NCAAF has the same shape, one step further along.** Its runs *do* fail
(`refusalRate: 0.9997`, `insufficient_sample: 3832`), because 2026 college rows exist with 1–2
games — enough to clear `no_games_played` but not the `minGamesPlayed: 2` floor. Same root cause,
different refusal reason, and the carve-out correctly does not mask it.

---

## The fix

**Root cause: picking a source season by recency alone.** The symptom is the silent success; the
cause is that `sourceSeason` can select a season with no production in it.

### Option A — resolve the source season by usable data, not recency *(recommended)*

Pick the newest season that actually has games played. Correct at the root, and makes the carve-out
mean what it says again: `noSourceSeasonYet` would then only be true when **no** season has data.

⚠ `games_played` lives inside `stats.regular_season`, so this is a JSON predicate rather than a
column filter. Cheap enough on 1,120 rows, but it is real work — not a one-line change.

### Option B — fall back one season on a total `no_games_played` refusal *(smallest change)*

If a run refuses 100% for `no_games_played` **and an older season exists**, retry once with
`sourceSeason − 1`. Reuses the existing extraction path, needs no JSON query, and is ~15 lines in
the writer.

### Option C — narrow the carve-out only

Require that no older season exists before `noSourceSeasonYet` can be true. This makes the failure
**loud** but does not fix it — NFL would go red daily until the season starts.

**Recommendation: B now, A later.** B restores NFL projections today with a small, testable change.
A is the correct model and can follow without time pressure.

⚠ **Either way, do C as well.** The carve-out should not be able to mask a case where a usable
season exists. A guard that hides a real stall is worse than no guard, and this one hid it for
thirteen days.

---

## ✅ FIXED — B + C implemented 2026-09-02

| | |
|---|---|
| **B** `lib/af-projections/writeAfProjectionSnapshots.ts` | The exported function is now a thin wrapper over `writeAfProjectionSnapshotsForSeason`. On a run that writes nothing and refuses **exclusively** for `no_games_played`, with an older season available, it retries once at `sourceSeason − 1`. |
| **C** `app/api/cron/compute-projections/route.ts` | `noSourceSeasonYet` now also requires `!r.olderSeasonAvailable`. The exemption applies only when there is genuinely nothing to project from. |

**Tests: 11 new, full suite 3,868 passed / 208 files, 0 failed.**

### Guardrails on the fallback

- **Retries once, not in a loop.** Two empty seasons is a data problem, not something to paper over
  by walking backwards — and each attempt is a full table read. Pinned by a test with four empty
  seasons that asserts it stops at 2025.
- **Never overrides an explicit `sourceSeason`.** A backfill asking for an empty season gets an
  honest empty answer.
- **Never fires on mixed refusals.** A mix means some players *did* play, so the season is not empty.
- **If the rollback is also empty, the FIRST attempt is returned** — reporting the older season as
  the source of an empty run misdescribes what happened and points a debugger at the wrong season.
- **`sourceSeasonFallback` is surfaced in both cron telemetry payloads.** A projection built from an
  older season is a different claim, and the run record now says so rather than quietly substituting.

### ⚠ My first version of the C tests could not fail

They **re-implemented** `assess()` inline instead of importing it. The mutation control caught it:
restoring the old wide carve-out left every C test green, because they were checking my restatement
of the rule rather than the rule.

`assess` is now exported from the route and the tests call it. Re-running the same mutation now
turns the production-shape test **red**, which is what it was for.

Mutation controls, both restored byte-identical:

| mutation | result |
|---|---|
| remove the fallback (restore the stall) | **3 red** |
| widen the carve-out (before the fix) | 0 red ← the test was useless |
| widen the carve-out (after the fix) | **1 red** ← now real |

### What this does NOT do

It does not make the 2026 NFL rows projectable — they have no games in them. It makes the engine
**use 2025 until 2026 has production**, which is what it did before 20 August, and it makes a
genuine stall loud instead of green.

---

## What I have NOT verified

- Whether NFL 2026 stat lines are genuinely empty shells or carry partial preseason data — I read
  the refusal reason (`no_games_played`, all 1,120), not the rows themselves.
- Whether `import-players` writing 2026 rows early is intended. It may be correct to have roster
  rows before games are played; the bug is downstream, in what `compute-projections` does with them.
- Whether the same stall affects other sports at their own season boundaries. MLB/NBA/NHL/NCAAB are
  mid-season now, so they would not show it today.
