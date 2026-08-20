# AllFantasy — session handoff, 2026-08-10

Everything below was verified against **production**, not inferred. Where something is
unverified it says so explicitly.

`main` is at `a3e810f3c`. Branch `release/closed-beta-v1` is a superset (already pulled down).

---

## 🔴 NEXT TASK — wire injuries into the urgency path

### The problem, precisely

`playerUrgency.ts` escalates on `OUT`. It is a **pure function** over
`item.injury?.status` — no I/O — so the wiring point is
`lib/shared-services/league-hub/crossLeaguePlayerPortfolio.ts`, which builds `item.injury`.

That file (line ~123, `toInjuryStatus(rawStatus, availabilityCategory)`) derives injury
status from **`SportsPlayerRecord.injuryStatus`** — NOT from the `sportsInjury` table.

Measured in prod (`node scripts/audit-player-injury-status.cjs NFL`):

| value | count | what it actually is |
| --- | --- | --- |
| `INACT` | 7,159 | **roster status** (inactive / practice squad) |
| `ACT` | 2,305 | **roster status** |
| `Questionable` | 422 | injury designation |
| `Active` | 200 | roster status |
| `NA` | 65 | — |
| `IR` | 3 | injury |
| `Suspension` | 3 | injury |
| `Out` | **1** | injury |

**One player in the entire NFL carries `Out`.** Rolling Insights reports **311 live
injuries**. ~92% of the column is roster designation, and `RAW_STATUS_MAP` in
`toInjuryStatus` has no entry for `INACT`/`ACT`, so those fall through to the collapsed
availability category.

**Consequence: urgency has been effectively blind.** The Sunday-panic detection — "OUT and
still starting, 45 minutes to lock", the most valuable behaviour in the Player Command
Center — has had almost nothing to fire on.

### The fix

1. `crossLeaguePlayerPortfolio` takes `item.injury` from **`lib/injuries/injuryReadPort.ts`**
   (`resolveInjuryFacts`) — 311 real designations, minutes fresh, staleness reported.
2. `SportsPlayerRecord.injuryStatus` becomes a **fallback only**, consulted for genuine
   injury tokens (`IR`, `Out`, `Questionable`, `Sus`, `Suspension`) and **explicitly
   ignoring roster tokens** (`INACT`, `ACT`, `Active`, `NA`) rather than coercing them.
3. Carry `stale` / `feedStale` through to `item.injury.freshness` so a stale designation is
   caveated, never rendered plainly. A two-week-old "Questionable" is a false statement,
   not old data.
4. Preserve the existing refusal semantics: `status: null` means **no designation stated**,
   NOT healthy. Absence of an injury row means "no news", also not healthy.

### Acceptance

- Before/after count of players reaching `critical` and `high` urgency. If it does not move
  substantially off 1 league-wide `Out`, the wiring did not take.
- `ambiguous[]` from the port is reported, not swallowed (name collisions are refused —
  RI injury rows carry no position, so genuine collisions cannot be split).
- Tests cover: RI row wins over player-record token; roster tokens (`INACT`/`ACT`) never
  produce an injury severity; stale row flagged not hidden.

---

## THEN — step 2: `fantasyStatLine` is empty

Blocks the AF projection engine. See `AF_PROJECTIONS_ENGINE_BRIEF.md` (repo root) for the
full plan, verified RI endpoint facts, and the corrected diagnosis.

Short version: **no writer exists**. `sports-data-importer.ts` fetches `projections`
(line 402) and `rankings` (412) but its only write is `sportsPlayerRecord.upsert` (545) —
everything else is transient enrichment, discarded. Paying for Rolling Insights does not
create rows; a writer has to exist.

RI `player-stats/{season}/NFL` returns **2,182 rows** for 2025 with a full component set
(passing/rushing/receiving/kicking/returns/two-point, plus IDP: sacks, tackles, INTs, and
`snap_count_*`). Season 2026 returns 304 — the season has not started, so bootstrap from
prior season.

**Highest risk: the ID namespace.** RI player ids are NOT canonical AF ids. Resolve through
`lib/player-match/verifiedNameMatch.ts` (position/team verified, ambiguity refused) or you
reproduce the exact failure already measured — rows that exist and join to nothing.

**Do NOT** add a prior-season fallback to the `projections` dataType. `player-stats` is
historical; it is an INPUT to the engine, never the answer. That mapping was severed
deliberately in `lib/workers/providers/rolling-insights.ts` and the comment there explains
why re-adding it would be wrong.

---

## THEN — step 3: verify slice 17 in production

Pending Sleeper trades now ship (`lib/provider-trades/scanPendingSleeperTrades.ts`,
`/api/league/trades-panel`, `TradesTab.tsx`). **Never verified against real data** — the
sandbox died before integration testing, so 8 passing tests are against fixtures I wrote.

Open the Trades tab for **The Last IDP Dynasty!!** and **Defense IDP For Life**. Expect an
amber bar: *"N pending trades from Sleeper — Shown here for analysis. Accept or reject them
in Sleeper."*

**Check the give/get direction against Sleeper side by side.** The original dashboard code
had draft-pick direction backwards (it only ever credited the receiver); that was fixed by
desk review, not observation. Both leagues are IDP dynasty where picks move constantly.

---

## What shipped today (all in `main`)

- **Slice 17** — pending Sleeper trades surfaced (unverified in prod)
- **Phase 0** — `import-projections` now returns `ok:false` + **HTTP 500** on an empty
  in-season ingest; `projections → player-stats` mapping severed; RI base default corrected
- **Injury migration** — API-Sports → Rolling Insights, **verified in prod**:
  `sportsInjury` went 3,581 rows / 17.2 days stale → 3,892 rows / 14 minutes.
  Delta is exactly **311** = the RI injury count, confirming the stable `externalId`
  updates rather than duplicating.
- **Ratchet** — 366 → 156, baseline re-based 164 → 156, 20 real errors fixed

---

## Production data state (`node scripts/audit-ingest-health.cjs`)

| table | state |
| --- | --- |
| `sportsPlayerRecord` | OK (88,446) |
| `sportsInjury` | **OK — fixed today** (3,892) |
| `sportsGame` | OK (4,283) |
| `sportsDataCache` | OK |
| `injuryReportRecord` | 103.8d stale — downstream of `sportsInjury`; may self-heal now |
| `gameSchedule`, `fantasyScheduleGame` | empty — likely legacy, `sportsGame` is live. Verify before "fixing" |
| `fantasyStatLine` | **EMPTY — blocks the projection engine** |
| `fantasyProjection` | 43 seed fixtures only; no upstream exists |
| `aFProjectionSnapshot` | empty — Phase 2 target |

---

## Hard-won constraints — read before touching anything

**Repo is PUBLIC.** Secret-scan order matters: `git diff` shows only TRACKED changes, so
scanning before `git add` misses every NEW file. Correct order: `git add -A` → scan
`git diff --cached` → commit. Check `git status --short` for `??` entries you did not create.

**"Broken in prod" is usually "never merged."** Cost time three times today. Work lands on
`release/closed-beta-v1`; only a PR merge to `main` deploys. After any merge, more commits
pushed to the same branch have no open PR and silently miss the train. Always:
`git merge-base --is-ancestor <sha> origin/main` before testing production.

**Local ratchet needs a clean tree.** A stale `.next/` + stale Prisma client inflated the
count 366 → 179 (75 phantom `.next/types/**/route.ts` entries from the route→handler
rename). Run `npx prisma generate` + `Remove-Item -Recurse -Force .next` before diagnosing.
`npm run typecheck` carries `--max-old-space-size=8192`; bare `npx tsc --noEmit` OOMs.

**Only `Draft Room Regression` is a required check.** Playwright core 1–3 and
onboarding-activation are baseline-red on `main` itself. `Vercel – allfantasy-v2` is a dead
legacy project, permanently red.

**PowerShell mangles `$` in `node -e`.** `$disconnect` becomes empty. Write a script file.

**Prisma voids the ENTIRE select on any single invalid key.** `commandCenterService` had
five declarations the schema does not have (`format`, `faabRemaining`, `teamCount`,
`draftDate`, plus a `name` nullability mismatch), so that query never returned the shape it
described. Worth extending the existing `db-first-api-boundary` CI check to validate selects
against the schema — this class of drift is mechanical to catch.

---

## Open items not yet scheduled

- **FAAB is broken at the source.** `commandCenterService` selected `faabRemaining` off
  `LeagueTeam`, but that column lives on `Roster` (schema ~7127). That is why
  `userFaabRemaining` reads null across all 62 leagues. Fix = join through to `Roster`;
  needs a decision on which side wins when both carry a value.
- **`SportsPlayerRecord.projections`** was being filled from RI `player-stats` — historical
  data in a field named "projections". Phase 0 severed that. Audit who READS it and whether
  any surface presents it as a forecast (task #64).
- **~~No consumer uses the injury read port yet.~~ DONE (Slice 18 + follow-on, 2026-08-10,
  UNVERIFIED — no shell this session):** the portfolio/urgency path plus all six ad-hoc
  consumers now go through the port — `start-sit/injuries` (port-first; its old primary,
  `injuryReportRecord` via `getInjuryReport`, was 103.8d stale), `news-crawl`,
  `community-insights`, `draft/player-detail` (verified name match, ambiguity refused),
  `sports/injuries`, and `sports?dataType=injuries` (both via new `listInjuryFacts`).
  REMAINING: `app/api/redraft/roster/route.ts` still does name-only first-hit injury
  binding (the slice-15 wrong-row-join hazard) — needs verified matching, not migrated yet.
- **`/api/player-portfolio` (list + detail) did not exist in the tree** while
  `app/my-players/MyPlayersClient.tsx` fetched it — the My Players page was 404ing.
  Found 2026-08-10 because its two test suites failed to import the routes. REBUILT from
  the contracts those suites pin (session-only appUserId, probe-safe 404s, SortKey set).
  Verify /my-players renders after deploy; if the original routes exist on some unmerged
  branch, diff against these rather than assuming either is canonical.
- **`import-projections` will now return HTTP 500** on every run until the AF engine exists.
  That is correct and intentional — the first honest signal that job has ever sent. Do not
  "fix" it by restoring the false `ok: true`.

---

## Diagnostic scripts (committed, `scripts/`)

| script | answers |
| --- | --- |
| `audit-ingest-health.cjs` | row count + freshness per domain vs each cron's cadence |
| `audit-player-injury-status.cjs` | is `injuryStatus` real injury data or roster status |
| `audit-projection-coverage.cjs` | projection tables, preset/source cardinality, ID namespace |
| `audit-ri-injury-shape.cjs` | RI injury field union + status vocabulary |
| `audit-ri-row-shapes.cjs` | RI `player-stats` stat components (projection base) |
| `audit-rolling-insights-surface.cjs` | which RI endpoints exist and respond |
| `audit-clearsports-surface.cjs` | ClearSports: 401 on real routes, 404 on projections |
| `audit-apisports-injuries.cjs` | API-Sports plan/quota (Free = 2022–2024 only) |

---

## The through-line

Six separate systems reported success while doing nothing: a cron returning `ok:true` on
zero rows, a merge that looked complete but omitted the commits, a provider base URL
pointing at a dead host, an env var name that did not match what the code read, a Prisma
select describing columns that do not exist, and a column full of roster status labelled as
injury status.

Every one looked healthy from inside the codebase. All were found by querying production and
probing providers directly. **Measure the data, don't read the code and assume.**
