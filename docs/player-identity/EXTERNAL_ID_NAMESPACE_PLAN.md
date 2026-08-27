# Untangling `SportsPlayer.externalId`

**Status:** plan, nothing built. Written 2026-08-27 after a live-data audit.

**Read this first if you were told the fix is "add a `rollingInsightsId` column to
`SportsPlayer`". It is not, and that was my own initial recommendation.**
`PlayerIdentityMap` already exists, already has `sleeperId`, `rollingInsightsId`,
`fantasyCalcId`, `apiSportsId`, `espnId`, `clearSportsId` and `mflId`, already has
a read API and five writers, and already holds 33,308 rows on production. Adding a
column would have built a second, competing identity store next to a working one.

---

## The problem, measured

`SportsPlayer.externalId` holds four id namespaces in one column, and which one a
row uses is decided by its `source`:

| source | namespace | rows |
| --- | --- | ---: |
| `rolling_insights` | bare numeric | 113,669 |
| `sleeper` | `sleeper:*` | 11,896 |
| `thesportsdb` | `tsdb_*` | 5,852 |
| `cfbd` | bare numeric | 5,226 |
| `api_football` | bare numeric | 737 |
| `backfill` | bare numeric | 261 |
| other runtimes | non-numeric | ~175 |

Three different sources write bare numerics, so **the format alone does not tell you
the namespace — only `source` does.** That is the single most important fact here,
and the reason the obvious fixes do not work.

The spaces collide. 42,032 bare-numeric ids also exist as a Sleeper id, and 42,031
of those are a **different person** — one coincidental match in the whole table. A
numeric match between these two spaces is not a weak signal, it is no signal.

### What it has already cost

`lib/player-data/getPlayerDataForSurface.ts` keyed one map by both `externalId` and
`sleeperId`, and `chooseBestSportsPlayerRow` broke ties on source rank, where
`rolling_insights` outranks `sleeper`. The impostor was therefore *preferred*.
Measured: **211 records resolved to a different person** — Matt Milano served Alex
Singleton's row, a kicker served J.K. Dobbins.

That is fixed (commit `f34fa320e`) by requiring an id match to agree with the name.
**That guard is a safety net, not a cure.** It stops a wrong row being used; it does
not give any surface a correct way to cross between the two id spaces.

---

## What already exists

`PlayerIdentityMap` is the intended home and its data is trustworthy:

- 33,308 rows: NCAAB 18,209 · MLB 7,295 · NHL 4,115 · NFL 1,933 · NBA 1,756
- **1,890 rows carry BOTH `sleeperId` and `rollingInsightsId`. All are NFL.**
- Where a pair exists it is right: **1,888 of 1,890 agree by name (99.9%)**. The two
  that "disagree" are nickname variants — `Cam Ward`/`Cameron Ward`,
  `Chig Okonkwo`/`Chigoziem Okonkwo` — so the real accuracy is 1,890 of 1,890.

Read API: `resolvePlayerIdentity` / `resolvePlayerIdentityBatch` in
`lib/fantasy-data/playerIdentityResolver.ts`.

Writers that already exist: `lib/player-match/sleeperIdentitySync.ts`,
`lib/sports-data/multiSportIdentityMap.ts`,
`lib/nfl-data-foundation/nflFoundationSync.ts`, `lib/api-sports.ts`,
`lib/canonical/backfillCanonical.ts`.

**So the machinery is built and under-run, not missing.** The gap is coverage:

| sport | RI rows in `SportsPlayer` | reachable to a Sleeper id | coverage |
| --- | ---: | ---: | ---: |
| NCAAF | 68,517 | 0 | 0.0% |
| NCAAB | 18,209 | 0 | 0.0% |
| **NFL** | **9,563** | **1,890** | **19.8%** |
| MLB | 7,295 | 0 | 0.0% |
| SOCCER | 4,214 | 0 | 0.0% |
| NHL | 4,115 | 0 | 0.0% |
| NBA | 1,756 | 0 | 0.0% |

`PlayerIdentityMap` has no NCAAF rows at all, and NCAAF is the largest RI population.

---

## The plan

**No schema migration.** `PlayerIdentityMap` is already on production — every number
above was read from it. This matters more than it sounds. Measured the same day:
the repo holds 145 migrations, the database has 142 applied, **7 repo migrations are
unapplied**, and by arithmetic 4 applied migrations are not in the repo at all — so
the drift runs in both directions and `prisma migrate deploy` is not safe to run
here. A plan needing DDL would have to resolve that first and would stall behind it.
This one never opens the question.

### Phase 1 — stop the bleeding at the boundary (small, do first)

Make the namespace explicit wherever `externalId` is read, so no new code can
repeat the collision.

1. Add a helper — `externalIdNamespace(source)` — returning the namespace for a
   row, and use it to assert intent at every join site.
2. Require `source` in every `SportsPlayer` lookup that filters on `externalId`.
   `app/api/players/rolling-insights/batch/route.ts` already does exactly this
   (`source: 'rolling_insights'` alongside `externalId: { in: riIds }`) and is the
   pattern to copy.
3. Audit the remaining `externalId` readers. Known-correct today:
   `nflFoundationSync` (RI id against RI-space rows) and the RI batch route.

Exit criterion: no query filters `externalId` without also constraining `source`.

### Phase 2 — measure the real matching ceiling before writing a matcher

Do **not** start by writing a name matcher. First answer: for the 7,673 NFL RI rows
with no Sleeper pairing, how many *could* be matched, and by what?

Run a dry-run report over `sleeperIdentitySync`'s existing logic and bucket the
misses: no Sleeper counterpart exists (retired, practice squad, never rostered) ·
name matches but team/position disagree · genuinely ambiguous (two players, one
name). The first bucket is not a bug and must not be counted as a gap.

Exit criterion: a number for "how many NFL rows are matchable", agreed before any
matcher is tuned to hit it.

### Phase 3 — backfill NFL, guarded

Extend the pairing for NFL only, using the existing writers. Rules:

- Match on `(sport, normalized name, team, position)`, never on name alone, and
  never across sports. Cross-sport matching is what produced the 0%-agreement
  garbage in my first pass at this measurement.
- Write only unambiguous matches. A name that resolves to two candidates is left
  unpaired — an unpaired row is honest, a wrongly paired row is invisible and
  permanent.
- `sleeperId` is `@unique` on this table. Contention on that constraint is a
  signal that two RI rows are claiming one person; log and skip, do not force.
- Re-run the 211-collision probe afterwards. It must stay at 0.

Exit criterion: NFL coverage materially up, name agreement still ~100%, zero new
collisions.

### Phase 4 — decide about the other sports (a decision, not a task)

NCAAF is 68,517 rows at 0% coverage, and **no id survives college→pro** — that is a
known constraint in this codebase, not something a matcher can fix. Before spending
anything here, answer: which surface actually needs an NCAAF row to reach a Sleeper
id? If none does, the right answer is to record that 0% is intentional and stop.

MLB, NHL, NBA and SOCCER have no Sleeper counterpart at all in this product. Their
0% is almost certainly correct and should be documented as such rather than closed.

---

## What could go wrong

- **Treating bare-numeric as "the Rolling Insights space".** It is also CFBD (5,226),
  api_football (737) and backfill (261). Any rule keyed on format rather than
  `source` will mislabel 6,224 rows.
- **Trusting name matches across sports.** My own first measurement did this and got
  0% agreement on 1,890 pairs — every match was cross-sport and wrong. Sport must be
  in the key.
- **Reading coverage as correctness.** Where pairs exist they are ~100% right. Raising
  coverage by loosening the matcher would trade a known-good 1,890 for a larger,
  dirtier set, and the damage would not be visible on any screen.
- **Assuming the name guard makes this safe.** It prevents a wrong row being *used*.
  It does nothing for the surfaces that silently find nothing, which is the larger
  and quieter half of the problem.
- **The table is moving.** `SportsPlayer` grew from 106,331 to 137,818 rows during
  the four hours this audit took. Any count here is a snapshot; re-measure before
  acting on a number.

## Explicitly out of scope

- Adding id columns to `SportsPlayer`. Use `PlayerIdentityMap`.
- Deduplicating `SportsPlayer`. Real, separate, much larger.
- `PlayerIdentityMismatchLog` — 787MB and nothing reads it. Do not wire this to it.
