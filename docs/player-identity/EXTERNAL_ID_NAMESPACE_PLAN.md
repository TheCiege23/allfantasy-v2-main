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

#### RESULT, measured 2026-08-27

Population: 7,672 NFL `rolling_insights` rows reachable by neither route (no
`sleeperId` on the row, no `PlayerIdentityMap` pairing).

| bucket | rows | share |
| --- | ---: | ---: |
| **Matchable — strong** (unique name, position family agrees, both teams known and equal) | **1,409** | 18.4% |
| **Matchable — weak** (unique name, position family agrees, team unknown on one side) | **5,267** | 68.7% |
| Ambiguous but narrowed to one candidate | 77 | 1.0% |
| Real disagreement on team and/or position | 562 | 7.3% |
| Still ambiguous — one name, several Sleeper players | 195 | 2.5% |
| No Sleeper counterpart of that name at all | 162 | 2.1% |

**The headline number is 6,676 — strong plus weak.** That would take NFL coverage
from 19.8% to roughly 89% (1,891 + 6,676 of 9,563).

#### The precision behind it, and the one tier to refuse

The same matcher was run against the 1,890 pairs `PlayerIdentityMap` already
asserts, where the right answer is known:

| tier | attempted | correct | precision |
| --- | ---: | ---: | ---: |
| strong | 1,492 | 1,490 | **99.9%** |
| weak | 200 | 200 | **100%** |
| ambiguous-narrowed | 45 | 39 | **86.7%** |

So **exclude the narrowed-ambiguous tier.** 86.7% means roughly one in seven
wrong, and a wrong pairing here is invisible and permanent — exactly the failure
`sleeperId @unique` cannot catch. The 77 rows it would add are not worth it.

⚠ **THE VALIDATION IS FRIENDLY TO ITSELF AND THE NUMBER SHOULD BE READ AS A
CEILING.** Those 1,890 ground-truth pairs were themselves produced by some earlier
matching process, so measuring a name matcher against them is partly circular: it
can only confirm agreement with whatever rule made them. Treat 99.9% as "does not
contradict the existing pairs", not as "verified against reality". The signal
worth trusting is the *relative* one — the narrowed-ambiguous tier failed 13% even
on this friendly set, which is a floor on its error rate rather than a ceiling.

⚠ **Two comparison artifacts nearly produced a wrong answer**, recorded so the next
run does not repeat them. A first pass put 83.1% of the population in "team and/or
position disagree", which is implausible on its face. Two causes: Rolling Insights
stores `Jacksonville Jaguars` where Sleeper stores `JAX` (handled — `normalizeTeamAbbrev`
does resolve full names), and more importantly **Sleeper's `team` is NULL on
thousands of rows**, which is *unknown*, not a disagreement. Position taxonomies
also differ — RI `DL` against Sleeper `DE`, RI `CB` against Sleeper `WR` for a
player who genuinely converted — so positions must be compared as FAMILIES
(DL/LB/DB/OL) rather than labels. Correcting both moved the disagreement bucket
from 6,374 to 562.

#### What this does NOT say

This is NFL only. `PlayerIdentityMap` holds no NCAAF rows and no NBA/NHL/MLB
`rollingInsightsId` pairs at all, so nothing here licenses a matcher for those
sports — there is no ground truth to validate one against, which is a different
and worse position than a low number.

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

#### RESULT — strong tier applied to production 2026-08-28

`scripts/backfill-nfl-identity-strong-tier.ts` (dry run by default, `--write` to apply).

| | before | after |
| --- | ---: | ---: |
| `PlayerIdentityMap` rows | 33,308 | 34,674 |
| NFL rows | 1,933 | 3,299 |
| NFL fully paired | 1,890 | 3,263 |
| **NFL RI coverage** | **19.8%** | **34.1%** |

1,366 created, 7 updated, 0 failed. 23 skipped because the Sleeper id was already
claimed, 13 skipped as duplicates inside the batch — both are the same underlying
fact, that **Rolling Insights holds two rows for one player** ("Harold Landry" and
"Harold Landry Iii" are separate RI ids resolving to Sleeper 5030). `sleeperId
@unique` stops the second and that is correct; it is counted, never forced.

Verified after: 0 Sleeper ids used by more than one pair, 0 RI ids used by more than
one pair, 0 rows breaking the `normalizedName` convention, and the collision probe
still 0 with the guard in place.

**All 1,373 new pairs agree by name.** The weak tier (5,267 rows) was NOT run.

⚠ **THE BACKFILL FOUND PRE-EXISTING CORRUPTION IT DID NOT CAUSE.** Checking name
agreement across ALL NFL pairs afterwards found 20 that disagree — every one of them
older than the backfill, none written by it. Eleven are the same defect this whole
document is about, committed to the identity table itself: `sleeperId` **equals**
`rollingInsightsId`, i.e. someone copied an id across two namespaces. Of the ten that
can be resolved against a Sleeper row, **ten point at the wrong player** — Jaye
Howard's row resolves to Marc Anthony, Chigoziem Okonkwo's to Grayland Arnold. The
other nine disagreements are benign nickname variants (Cameron Ward / Cam Ward).

They also validate the caveat recorded under Phase 2 — the "ground truth" that phase
measured against contains known-wrong pairs, which is precisely why 99.9% was
described as agreement with existing pairs rather than verification against reality.

#### Those 11 were cleared 2026-08-28

`sleeperId` set to NULL on all 11. The ROW and its `rollingInsightsId` are kept: the
RI side was correct in every case — the RI player row's name matches the map's
`canonicalName` — so only the false Sleeper claim was removed, not the identity.

Ten were proven wrong against a Sleeper row. The eleventh, `Trent Sherfield SR`
(9419), could not be verified because no Sleeper row holds that id — so the pairing
resolved to nothing either way, and it carried the identical structural defect. It
was nulled with the others and is called out here as the one not individually proven.

Reversal record — restore by setting `sleeperId` back to the value shown:

| row id | sleeperId | rollingInsightsId | canonicalName |
| --- | --- | --- | --- |
| a3b0822c-9786-482e-ba8d-c1452ccaa00c | 1375 | 1375 | Jaye Howard |
| 0d9689c2-f554-4d7c-bbb0-8f0232528122 | 7051 | 7051 | Chigoziem Okonkwo |
| 77afad5d-60ef-4aa3-a1f7-c6a1d2c0226d | 5826 | 5826 | Nick Westbrook |
| 2548d9a5-8c57-4951-aa98-15a77db36964 | 6648 | 6648 | Brian Gaither |
| aae14879-164e-466c-9f94-98d4668b8f43 | 4252 | 4252 | Hollywood Brown |
| 9a2f1e39-dd31-4176-9b21-d9152def831e | 7193 | 7193 | John Parker Romo |
| 371fc7e2-4ab5-4236-9ed6-357e117b592f | 6616 | 6616 | Bam Knight |
| 79282e62-f5be-4cbe-b3ef-b1d15e8b5389 | 9419 | 9419 | Trent Sherfield SR |
| 14a587ca-5f19-427b-8688-6e10b0d78101 | 7696 | 7696 | Jaylen Moody |
| 76350043-8eb4-48f7-b3c3-94b1e3389698 | 8753 | 8753 | Andres Borregales |
| 0217ff3f-8ece-49a5-8988-af45a22703f6 | 3489 | 3489 | Trayvon Henderson |

After: NFL fully-paired 3,263 -> 3,252, self-paired rows 0, and name disagreements
across all NFL pairs 20 -> 10. **Every one of the remaining 10 is a benign nickname
variant** — Cameron/Cam Ward, Zachary/Zach Carter, Camryn/Cam Bynum, Matthew/Matt
Orzech — so the NFL identity map now holds no wrong-player pairing.

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
