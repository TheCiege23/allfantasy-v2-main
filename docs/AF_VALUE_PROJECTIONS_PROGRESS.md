# AF Value + Projections — Build Progress

Companion to [AF_VALUE_AND_PROJECTIONS_AUDIT_AND_PLAN.md](AF_VALUE_AND_PROJECTIONS_AUDIT_AND_PLAN.md).
Updated as each step lands. **Nothing here is pushed to production.**

**Legend:** ✅ done · 🔄 in progress · ⏸ blocked on you · ⬜ not started · ❌ failed

---

## ✅ LANDED ON MAIN — 2026-09-02

All work is on `origin/main`, verified **by patch-id** rather than by ancestry (a cherry-pick
renames every commit it touches, so ancestry answers "no" about work that is sitting right there):

| my pick | patch-id | on main as | batch |
|---|---|---|---|
| `7b421e8b1` | `95daf80a5…` | **`821b8231d`** | 3 |
| `b683b07b5` | `d18d60764…` | **`b1e67d2bf`** | 3 |
| `4c490c2e5` | `350b92687…` | **`821660ae6`** | 4 |

`origin/main` = `9b19a3d76c5f9e973494ebd966d1815f245148d3`. Batch 3 deployed 06:07Z
(`dpl_D6EVJPm8Ln9H7WcR21uLxtEENrPv`).

**Every gate measured 145/145 detached with a sentinel**, none in my files.

### ✅ PRODUCTION VERIFIED — the 07:53Z fire, 2026-09-02

The runtime path executed against a live database and did what the unit tests said it would.

**NFL, before vs after:**

| | rows_read | rows_written | src | fallback |
|---|---|---|---|---|
| 09-01 07:53Z | 1120 | **0** | 2026 | null |
| **09-02 07:53Z** | **1938** | **1576** | **2025** | **fired** |

```json
{"to": 2025, "from": 2026,
 "reason": "Season 2026 had 1120 stat lines and no games played in any of them;
            rolled back to 2025."}
```

Three independent things had to be true and all three were: it **read** a different season
(1120 → 1938 rows — 2025's real data, not 2026's shells), it **wrote** for the first time since
20 August (0 → 1,576), and it **recorded why** in a sentence a human can act on rather than a
boolean.

**ROS columns populated for the first time:**

| sport | rows | with_ros | with_weeks | newest |
|---|---|---|---|---|
| NFL | 3,154 | 3,124 | 3,152 | 09-02 07:53 |
| MLB | 1,712 | 1,656 | 1,710 | 09-02 07:53 |
| NCAAF | 10,189 | 1 | 1 | 09-02 07:53 |

NFL went from 1,576 rows / 0 with_ros to **3,154 / 3,124**. The doubling is the season-long baseline
plus week-scoped rows, now that a real season is the source.

⚠ **One number I cannot yet explain:** `with_ros` (3,124) is **30 short** of `with_weeks` (3,152).
That is `rosFromPerGame` returning null rather than 0 for ~30 players — which is by design, since
"unknown" must not enter the value engine as "worth nothing" — but I have not confirmed the cause is
the intended one. Recorded as open rather than rounded off as clean.

### ✅ The control held — NCAAF unchanged

Declared **before** the result specifically so a move would count against me:

| | status | rows_written | src | fallback | refusals |
|---|---|---|---|---|---|
| 09-01 | failed | 1 | 2026 | null | `{"insufficient_sample": 3832}` |
| 09-02 | failed | 1 | 2026 | null | `{"insufficient_sample": 3832}` |

Byte-identical across the deploy. The fallback correctly did **not** fire, because NCAAF's refusal
reason is `insufficient_sample`, not `no_games_played`. SOCCER still fails honestly (no stat lines);
MLB/NHL/NBA/NCAAB unchanged.

### What remains unverified

The trade-value **read** side. `AFProjectionSnapshot` now carries `rosProjection`, but nothing has
consumed it through `loadAfProjectionRows` in production — that needs a real trade proposal, and
`redraft_trade_assets` still has **zero rows**.

---

### ⏳ (superseded) The one thing still unverified: does it work at runtime?

Every test injects its ports. The real path — `AFProjectionSnapshot` read against a live database,
the season fallback firing on a real cron — has **never executed**. That has been on the
not-verified list since the first hand-off.

**Pre-cron baseline, captured 06:08Z** so the comparison is a measurement rather than an inference:

```
latest run              2026-09-01 07:53Z  (the day BEFORE the fix)
NFL since 08-20         10 runs · rows_written TOTAL 0 · every one status=success
NFL metadata            src=2026 · noSourceSeasonYet=TRUE · sourceSeasonFallback=null
AFProjectionSnapshot    NFL 1,576 rows · with_ros 0 · newest 2026-08-20 07:50Z
                        NCAAF 10,189 rows · with_ros 0
```

All three "after" signals sit at their failing values. First fire under the new code: **07:50Z**.

⚠ **A control stated in advance.** NCAAF refuses for `insufficient_sample`, not `no_games_played`,
so the fallback must **not** fire for it. If NCAAF's numbers move, my reasoning is wrong and that
is a finding, not noise — declared before the result so it cannot be rationalised afterwards.

⚠ **And a correction to my own earlier framing:** the 2026-season flip is not NFL-specific. NHL,
NBA and NCAAB already run on `src=2025` by ordinary means; only NFL, NCAAF and MLB are on 2026. NFL
rolling back would put it in the majority, not make it exceptional.

---

## 📦 HAND-OFF — delivered 2026-09-02

| | |
|---|---|
| **SHA** | `7b421e8b188a12f90ab531700abf1d7805451016` |
| **Tag** | `handoff/ac-value-projections` (so it survives GC — it lives on a detached HEAD) |
| **Base** | `967b95f94d1c1ea5d591f1b7554ac268cdddbb1f` |
| **Reviewer** | peer session `-70`, verifying independently |
| **Migration** | **YES** — carries `20260901230000_af_projection_ros`, already applied in production |
| **Status** | NOT covered by the standing batch approval; needs an explicit yes from Guap |

**Verification handed over:**

| check | result |
|---|---|
| Typecheck — detached, on the commit, on the current base | **145 vs 145, zero delta**; sentinel `=2`; 59,401 bytes; 0 crash/module/fork tells; **none in my files** |
| Tests — against the **committed tree**, not the working tree | **3,850 passed / 207 files, 0 failed** |
| Fast-forward | `merge-base --is-ancestor` → **rc=0** |
| Deletions vs base | **zero** |
| Files | **35**, every path mine (path allowlist, not eyeballed) |
| Mutation controls | **6**, all fired, all restored byte-identical |

⚠ The commit was first built on `857edb30b` and rebased when the base moved. `patch-id`
**`95daf80a5`** on both sides — identical change, renamed. Trees differ, as they must.

⚠ The `node_modules` junction was verified `LinkType = Junction` **before** the run — a missing
junction yields 0 errors and no crash dump, which reads as a pass — and removed with
`cmd /c rmdir`: **696 target entries before, 696 after**, so nothing was deleted through it.

**Declared NOT verified**, verbatim to the reviewer:

1. `__tests__` is excluded from tsconfig — the 44 new test files are transpiled by vitest and never
   type-checked. Pre-existing config; "zero delta" covers `lib/` and `app/` only.
2. **The runtime path has never executed.** Every test injects its ports; nothing exercises the real
   `AFProjectionSnapshot` read against a database.
3. `rosProjection` is NULL on all 19,556 production rows until `compute-projections` next runs, so
   the new wiring returns nothing until then — by design, with a warning firing meanwhile.
4. No lint, no build, no e2e; only four test directories.

---

## Phase 2 — the three hardcoded nulls ✅ (2026-09-02)

| Step | Status | Notes |
|---|---|---|
| 2.1 `fantasyCalcValue` | ✅ | From the shared resolver, not a second implementation |
| 2.2 `idpValue` | ✅ | Same; `idpLeague` supplied from the league's own slots |
| 2.3 `rankingValue` | ✅ **deliberately null** | See below — it was never "deferred" |
| 2.4 Real `ScoringContext` | ✅ | Landed earlier in 1.7g |
| 2.5 Split brain | ✅ | Closed at the root by sharing the resolver |
| Tests | ✅ | **10 new**; suite **3,878 passed / 209 files** |
| Mutation control | ✅ | Restoring the hardcoded nulls → **2 red**, restore byte-identical |

### 🛑 A finding that qualifies Phase 1: the id spaces do not match

Measured on production before writing anything:

```
redraft_roster_players.playerId    numeric SLEEPER ids   (7679 = Alim McNeill), 2,264/2,315
AFProjectionSnapshot.playerId      registry ids          1,576/1,576, ZERO numeric
direct join between them           0 of 2,315 rows
```

So the Phase 1.3 wiring resolved **nothing** for Sleeper-keyed callers — and a zero-row result is
indistinguishable from "the engine has not projected these players", which is precisely what
`af_projection_no_rows` exists to name.

`loadAfProjectionRows` now crosses through `PlayerIdentityMap.sleeperId` and **re-keys results back
to the caller's id space**, so no consumer needs to know which it holds. Measured recovery:

| | |
|---|---|
| distinct redraft player ids | 1,125 |
| → reach the registry | **1,065 (94.7%)** |
| → reach an AF projection | **866 (77.0%)** |

The remaining 23% are players the engine genuinely has not projected — an honest absence, not a
broken join.

### Why sharing the resolver, not re-implementing it

The split brain existed because two paths answered "what is this player worth" differently. Filling
the three nulls with parallel code in `captureSnapshot` would have preserved that split behind two
implementations that agree today and drift tomorrow. Routing capture through
`resolveTradeEnrichment` means one answer — and capture inherits the AF-projection wiring and the
crosswalk for free.

⚠ **Both gating arguments must be supplied or the resolver silently returns null.** `valueFormat`
absent ⇒ no market value at all; `idpLeague` absent ⇒ no defender pricing. `qbFormat` is derived
from `shape.superflexSlots > 0` — read off real `roster_positions`, which cannot be misspelled the
way a scoring label can.

### `rankingValue` was never deferred

Nothing in the codebase produces a ranking on this 0–10000 convention, and `computeConfidence` does
not read it. A field no producer fills and no consumer reads is not pending work — it is a contract
line that has never been true. Left in place (removing it breaks `AssetValueSources`) and now
labelled so the next reader does not go hunting for the producer.

### ⚠ An `npx` mistake worth recording

I ran `npx tsc` for a quick single-file check. `node_modules/.bin` happened to be empty at that
moment (a peer's interrupted install), so **npm went to the registry, downloaded the unrelated
package literally named `tsc`, and executed it.** It is a well-known typo-guard that prints a
banner, so nothing harmful happened — but "npx silently installed and ran something nobody vetted"
is the shape of a supply-chain problem.

CLAUDE.md already documents the correct form and every other typecheck this session used it:
`node ./node_modules/typescript/lib/tsc.js`. Never bare `npx <tool>` in this checkout.

⚠ I initially reported this as having *caused* the `.bin` breakage. A peer corrected the ordering:
npx only falls through to the registry when the local binary is **already** absent, so `.bin` was
empty first. My command was a symptom, not the cause.

---

## Standing constraints (agreed 2026-09-01)

| | |
|---|---|
| **Every push needs your explicit OK** | Updated 2026-09-02: the designated-pusher role is discontinued. `npm run push:pusher` now reports "any session may push", so **the token gate will not stop anyone** — this is a human rule, not an enforced one, and the absence of a refusal is not permission. This session has **zero commits**; everything is uncommitted working tree. |
| **No prod pushes** | Local dev server + pure unit tests only. Nothing lands on `main` without you saying so. |
| **No agent DB access** | I do not run scripts that import `@prisma/client`. All DB reads are SQL handed to you. |
| **SQL is yours to run** | Any table creation comes as a separate `CREATE`-named file. Read-only census SQL is `docs/sql/`. |
| **Cost discipline** | Neon + Vercel spend is being cut. Dev server stays stopped unless actively testing. |

---

## 🛑 BLOCKER — the dev server points at production

`.env.local` **and** `.env` both set `DATABASE_URL` to
`ep-curly-block-ad0dlt9o-pooler.c-2.us-east-1.aws.neon.tech`.

CLAUDE.md names that exact host as **production**, twice (lines 1242, 1254). So `npm run dev` on
this checkout is a live production client: every page that queries bills production Neon compute,
and any write path writes production rows.

I started a dev server, saw it was pointed there, and **stopped it before it compiled a page that
queries**. No queries were issued — `preview_logs` showed zero Prisma lines at shutdown.

**This is a decision for you.** Options, cheapest first:

| Option | Neon cost | Isolation | Effort |
|---|---|---|---|
| **A. Local Postgres (Docker)** | **$0** | Total | ~30 min: run Postgres, `prisma migrate deploy`, seed a league |
| **B. Neon branch** | Low — scales to zero when idle | Total | ~5 min via Neon console; new `DATABASE_URL` in `.env.local` |
| **C. Stay on prod, reads only** | Current spend continues | None | Zero, but one careless write path is a production incident |

**Recommendation: A.** It is the only option that costs nothing while you are cutting spend, and it
removes the "accidentally wrote to prod" class of failure entirely rather than managing it.

⚠ Most of Phase 1 does **not** need a database. The value formula, the unit conversion, the
scarcity model and the projection ladder are all pure and unit-testable. We can build and verify a
long way before this blocker binds — it binds at integration smoke, not before.

---

## Phase 0 — Measure the baseline ✅ COMPLETE

| Step | Status | Result |
|---|---|---|
| 0.1 Typecheck baseline | ✅ | **145 error TS lines.** Sentinel `SENTINEL_DONE=1` present, 0 crash dumps, 0 `Cannot find module`, 59,397 bytes of output. Independently matches the 145 that peer session `-72` measured at the same parent. |
| 0.2 Value parity probe | ✅ | [`scripts/probe-value-parity.ts`](../scripts/probe-value-parity.ts) — pure, offline. **All 4 positive controls fired**, exit 0. Four findings below. |
| 0.3 Decision OS flag check | ✅ | `DECISION_OS_TRADE_LIVE=true` and `DECISION_OS_TRADE_SHADOW=true` in `.env.production` (committed, so live in prod). **Unset in dev.** Closes an UNVERIFIED from the audit — and changes finding G2. |
| 0.4 Row census | ⏸ **YOU** | Split into 5 files, `docs/sql/phase0-step1..5`. **Run step 1 first.** See below. |

### 0.4 — first attempt ran against the wrong database

The census was run on branch `br-withered-shadow-adur64u9`, database **`mydb_shadow`**. The app
connects to **`neondb`** (from `DATABASE_URL` in both `.env.local` and `.env`).

Six statements reported "executed successfully" and one errored. **The error was the honest
signal**; the six successes were the misleading ones — they ran against a schema that is not the
app's. Q7 failed because `"PlayerValueSnapshot"` does not exist in `mydb_shadow`; the table name
itself is correct, verified against
`prisma/migrations/20260816220000_player_value_snapshot/migration.sql`.

Same family as the checks CLAUDE.md catalogues: it ran, it returned plausible output, and it
measured a different artifact from the one in question.

**Two fixes applied:**
1. `phase0-step1-diagnostic.sql` now prints `current_database()` with a pass/fail verdict, plus a
   presence + approximate-row-count check for all 8 tables the census needs. Run it alone, first.
2. The 11KB monolith was truncated by the Neon editor (it warned "the last 4214 characters will be
   truncated"), so Q8–Q11 never ran at all. Split into five files of ~3KB each.

### 0.1 — the first run was a false clean, worth recording

The initial background typecheck was killed by session teardown and left **113 bytes of npm
banner, zero `error TS` lines, no crash dump, no `Cannot find module`** — precisely the profile
CLAUDE.md says to read as "OOM or clean". It was neither; it had not started. The sentinel is what
caught it. Re-run produced the real 145.

### 0.2 — four measured findings

1. **The two engines invert QB vs TE.** Normalised so TE = 1.000: canonical prices a QB at
   **0.85× TE**, hybrid at **1.083× TE**. Hybrid applies a superflex-shaped view unconditionally.
   3 of 6 positions disagree by >15% (QB 1.274×, RB 1.159×, DEF 0.833×).
2. **Superflex QBs are completely indistinguishable.** At 340/380/420/460 projected points a
   superflex QB prices **10000, 10000, 10000, 10000**. The uncapped value at 460 pts is 16,266 —
   **1.63× the ceiling.** Superflex is the one format where QB separation matters most.
   1-QB RBs also saturate at 360+ pts (3/4 distinct).
3. **The per-game → ROS trap is silent and ~17×.** An elite WR at 19.5/game prices **532** on the
   raw per-game number vs **9050** correctly converted. No zero, no NaN, no error — every wrong
   value is a plausible mid-tier price. This is Phase 1's single largest risk.
4. **ADP swings a player 13% on draft slot alone**, additively, after scarcity — and ADP is a
   *preseason* consensus still being added to a live in-season projection. Worth deciding whether
   it should decay.

### 0.5 — league-format coverage (added at your request) ✅

You were right that 0.2 under-covered this: it tested 1QB vs superflex only, and said nothing about
true 2QB or the concept leagues. [`scripts/probe-league-format-coverage.ts`](../scripts/probe-league-format-coverage.ts)
closes that. Pure/offline, all 7 positive controls fired, exit 0.

**1. True 2QB is modelled — and the clamp destroys it.** The engine does distinguish the formats:

| format | QB multiplier | effective scarcity | 380-pt QB |
|---|---|---|---|
| 1QB | 1.0 | 0.85 | **8398** |
| Superflex | 1.6 | 1.36 | 10000 ← clamped |
| True 2QB | 1.8 | 1.53 | 10000 ← clamped |
| both flags set | 1.8 | 1.53 | 10000 ← clamped |

2QB correctly outranks superflex and correctly wins when both flags are set. **All three then
collapse to the same number.** The format modelling is correct and unreachable — which makes the
clamp fix (1.5) more important than the audit rated it.

**2. `is2QB` is set by a substring match on a label.** The correct slot-based resolver already
exists — `resolveLeagueScoringFlags`, `DraftContextAssembler.ts:238`, which derives `isSF`/`is2QB`
as mutually exclusive from real roster slots. The trade path never calls it. The only thing feeding
the value engine is `describedTradeEvaluator.ts:91`: `s.includes('2qb')`.

Measured against 11 plausible spellings, it **misses 5**: `Two QB Dynasty`, `TWO-QB`,
`QB2 Required`, `2-QB`, `startTwoQb`. Each miss prices that league's QBs at **0.85 instead of
1.53 — a 1.8× understatement on the position that defines the format.**
The fix is to call the slot resolver, not to add spellings to a regex.

**3. All 16 implemented formats price identically — 6552 for every one.**

🛑 **My first list of nine was wrong by omission**, because I built it from a hardcoded `ls` of
`lib/` and then measured my own guess. Rebuilt from evidence — string-literal occurrence counts
across `lib/`+`app/`+`types/`, plus which formats have a `*-trade-value.test.ts`:

| format | refs | trade test | format | refs | trade test |
|---|---|---|---|---|---|
| redraft | 652 | | best_ball | 187 | |
| dynasty | 612 | | **big_brother** | **91** | |
| devy | 416 | ✓ | **exile** | **77** | |
| survivor | 265 | ✓ | salary_cap | 78 | |
| keeper | 250 | | idol | 19 | |
| zombie | 201 | ✓ | **king_of_the_hill** | **18** | ✓ |
| tournament | 173 | ✓ | lottery | 17 | |
| guillotine | 165 | ✓ | **pirate** | **12** | ✓ |

The four in bold are the ones I missed. **7 of the 16 have a dedicated trade-value test file**, so
trading in them is a shipped feature — the tests pin the plumbing, not a format-specific price.

**4. 🛑 QB demand is continuous and every layer models it as a boolean.** This is the deepest
finding and it came directly from your Four Horsemen question:

| league | QB slots | `needs.QB` | `superflex` | multiplier | 380-pt QB |
|---|---|---|---|---|---|
| 1QB | 1 | 1 | false | 1.0 | **8398** |
| Superflex | 1 | 1 | true | 1.6 | 10000 |
| 2QB | 2 | 2 | true | 1.6 | 10000 |
| 3QB | 3 | 3 | true | 1.6 | 10000 |
| **4QB (Horsemen)** | **4** | **4** | true | **1.6** | **10000** |
| 6QB | 6 | 6 | true | 1.6 | 10000 |

A 4-QB league is, to this engine, a superflex league. The loss point is
`lib/core-app/slotEligibility.ts:210-228`: `dedicatedQb` is counted, tested once as `> 1`,
collapsed to a boolean, and never returned.

**Two things make this cheap to fix.** The count *does* survive as `needs.QB` — so the data is
already there, it is lost at the `ScoringContext` boundary. And the `is2QB` × 1.8 branch is
currently **unreachable from roster slots at all**: the resolver only emits `superflex: boolean`,
so the only thing that can ever set `is2QB` is the substring match in
`describedTradeEvaluator.ts:91`.

⚠ **The two files also contradict each other.** `slotEligibility.ts:225` says 2QB "prices
quarterbacks like superflex does"; `valueEngine.ts` prices them **1.8 vs 1.6**. Nothing reconciles
them because the boolean can only ever select the superflex branch.

**5. Roster depth is invisible.** A 10-team league rostering 130 players and a 12-team Horsemen-XL
rostering 408 price the same WR identically (6552). `normalizedPlayerValue` takes no league size,
no starter count, no bench depth — and those set **replacement level**, which is exactly what
positional scarcity is a proxy for.

**6. Four league facts expressible, twelve not.** Missing: QB starter count, league type, league
size, starter count, bench depth, IDP slots, kicker slots, playoff weeks, taxi/IR, trade deadline,
cap space, elimination state.

**Plan impact — three changes:**
- Phase 1.5 (the clamp) moves from polish to **prerequisite**: format modelling cannot reach a
  grade while superflex/2QB/4QB all saturate at 10000.
- New **Phase 1.7**: widen `ScoringContext` from booleans to counts (`qbStarters`, `leagueSize`,
  `starterCount`) and thread `needs.QB` through. This is plumbing, not modelling — the numbers
  already exist upstream.
- Phase 4.2 (`leagueTypeModel.ts`) covers **16 formats, not 9**, and several (guillotine, survivor,
  zombie, big_brother, KOTH, pirate) share one underlying need: an **elimination/survival horizon**,
  which is probably one model with per-format parameters rather than six models.

### 0.3 — this REVISES audit finding G2

The audit said the enrichment path "does not run in production". That was wrong: the flags are
committed in `.env.production`, Next.js loads that file when `NODE_ENV=production`, and
`runCanonicalTradeShadowAttempt` is **not** gated by `DECISION_OS_CANONICAL_SHADOW_ENABLED` (that
flag only gates `decisionStore` persistence). So enrichment **does** run in prod.

**The corrected finding is worse, not better** — it is a split brain:

| Path | What it prices from | Who sees it |
|---|---|---|
| `captureRedraftTradeValueSnapshot` → **persisted** `RedraftTradeValueSnapshot` | projection + ADP only (3 hardcoded nulls) | **Chimmy**, via `tradeChimmyGrounding` reading `snapshotGrade` |
| Decision OS live memo → **response only**, not persisted | + market value, IDP value, liquidity, trend | the trade UI, at proposal time |

So the trade screen and Chimmy can quote **different grades for the same trade**, and Chimmy quotes
the impoverished one. `tradeChimmyGrounding.ts` even labels it "(HISTORICAL snapshot, may differ
from current)" — the divergence was anticipated but not closed.

**A further bug found in the same file:** `app/api/redraft/trade-proposals/route.ts:209` hardcodes
`scoring: season.sport === 'NCAAF' ? 'standard' : 'ppr'` and `rosterFormat: 'standard'`. The
league's real scoring is never read, so **every persisted snapshot is priced as standard 1-QB
redraft — including superflex and TE-premium leagues**, whose scarcity multipliers therefore never
fire on the persisted path.

---

## Phase 1.7 — LeagueShape + league-size-aware pick curve 🔄 IN PROGRESS

Started first, ahead of Phase 1, because it fixes **6 of the 11 Four Horsemen breakages** and needs
no database. All work below is pure and unit-tested.

| Step | Status | Result |
|---|---|---|
| 1.7a `lib/trade-value/leagueShape.ts` | ✅ | New pure module. 25 tests. |
| 1.7b Mutation control on leagueShape | ✅ | Constant-multiplier mutant → **3 tests red**; restore verified byte-identical. |
| 1.7c League-size-aware pick curve | ✅ | `pickShareByOverall` / `pickValueByOverall` in `lib/pick-curve.ts`. 15 tests. |
| 1.7d Wire curve into `normalizedPickValue` | ✅ | Additive — `teams`/`slot` optional. |
| 1.7e Widen `ScoringContext` with `shape` | ✅ | Shape supersedes the booleans. 22 tests. |
| 1.7f Clamp fix (soft knee) | ✅ | Rational soft knee. Mutation control → **7 tests red**. |

**Full suite: 4,022 passed / 234 files, 0 failed.** Baseline was 380/44 in the trade-value + IDP
subset; that subset is now 442/48.

### 1.7e — shape supersedes the booleans, and must

Adding `shape` to `ScoringContext` alongside `isSuperflex`/`is2QB` would have **multiplied** two
answers to the same question. So when a shape is present it *replaces* them for positional demand;
`tePremium` and `scoringFormat` still apply on top, because those are scoring facts, not roster
facts. Pinned by a test that supplies both and asserts the 1.6× does **not** appear.

Same 300-pt QB, by real league:

| league | value |
|---|---|
| 12-team 1QB | 6630 |
| Four Horsemen (4tm, 4QB) | **7656** |
| KBFL (32tm, 1QB) | **9412** |

And N-QB, which previously collapsed 2/3/4/6 into one number:

```
1QB 6630 · 2QB 9053 · 3QB 9498 · 4QB 9641 · 6QB 9756
```

Additive guarantee holds: a standard 12-team shape produces **byte-identical** values to supplying
no shape at all (3276/5460/7644 both ways).

### 1.7f — the soft knee, and the two errors it took to get right

Superflex QBs, which all priced at exactly 10000 before:

```
340 pts → 9552    380 → 9650    420 → 9713    460 → 9757
```

**Error 1, caught by my own test.** The first implementation used `1 − e^(−x/h)`. Correct on paper;
in float64 `Math.exp` underflows to 0, so it returned exactly 10000 and destroyed the ordering it
existed to protect. Worse, after `Math.round` it saturated at a raw value of ~20,500 — and a 6-QB
league produces ~24,900, so the collapse was **still reachable by a real league**. Replaced with a
rational form `h·x/(x+h)`, which keeps distinct integers to a raw ~4.5 million. Both cases are now
pinned as regression guards.

**Error 2, a pre-existing test that encoded the bug.** `trade-value-engine.test.ts` asserted
`toBe(10000)` for a 9,999-point projection — pinning the hard clamp itself. Its own name says
"clamps to 0..10000", and 9992 satisfies that. Updated to assert the *requirement* (bounded) plus
the new guarantee (two absurd projections stay **ordered**), so it is now harder to pass than
before, not easier.

⚠ **Not free.** Values in [8500, 10000) shift down — a raw 8600 by ~3 points (0.03%), a raw 9828 by
~447 (4.5%). Fitting an unbounded range into a bounded one while preserving order has to compress
somewhere. The real fix is recalibrating `PROJ_TO_VALUE` (step 1.5); this guarantees nothing is
lost when it overshoots.

### 1.7g — call sites wired ✅

`LeagueShape` was built and consumed but nothing constructed one from a real league. Now four paths do.

| Call site | Status | Note |
|---|---|---|
| `lib/decision-os/trade/scoringContextFromWorld.ts` | ✅ new | Pure adapter: world facts → `ScoringContext` |
| `canonicalMemo` E.2 path | ✅ | Was passing **nothing** |
| `canonicalMemo` E.3 path (`buildTradeMemo`) | ✅ | Via new `TradeWorld.scoringContext` |
| `captureSnapshot` + `/api/redraft/trade-proposals` | ✅ | Route now passes `leagueId` |
| `describedTradeEvaluator` (Chimmy) | ✅ | Slots now beat the substring match |

**🛑 The finding that came out of the wiring.** `buildTradeValueSnapshot` has accepted a `scoring`
argument since slice 16, and **neither canonicalMemo call site passed it**. So the Decision OS
path — the one that *is* live in production — priced every league as standard 1-QB redraft. The
parameter existed, the data existed, and the two were never connected.

**Architecture note.** `buildTradeMemo` only receives a `TradeWorld`, not the raw `CanonicalWorld`,
so the context is resolved in the **resolver** (which owns carrying world facts across) and read
from a new `TradeWorld.scoringContext` field. That keeps the E.2/E.3 byte-identity property the
module's docstring promises — and a positive control asserts the wire is genuinely populated, so
that identity is not passing vacuously on two nulls.

**Chimmy's evaluator now prefers roster slots**, falling back to the label only when a league has
no slots. The five spellings the label misses (`Two QB Dynasty`, `TWO-QB`, `QB2 Required`, `2-QB`,
`startTwoQb`) are pinned as a **documented limitation**, not fixed by adding spellings — because
a boolean cannot express a 4-QB league however it is spelled.

### Verification after wiring

| Check | Result |
|---|---|
| Tests | **4,062 passed / 237 files, 0 failed** |
| Typecheck | **145 error TS lines vs 145 baseline — zero delta**, sentinel `SENTINEL_DONE=2`, 0 crash dumps, **0 errors in any file I touched** |

⚠ Exit code 2 is normal here — this repo carries a standing 145-error baseline. The tell for a bad
run is a crash dump or `Cannot find module`, and both are zero.

### Mutation controls — both fired

| mutation | result |
|---|---|
| `demandMultiplier` → constant 1.0 | **3 tests red**, restore byte-identical |
| `softCap` → hard clamp | **7 tests red**, restore byte-identical |

### What LeagueShape does

Scarcity becomes **leaguewide starter demand** — `teams × starters at the position` — instead of a
fixed table. The key measurement that justifies it:

```
QB demand, 12-team 1QB league   12 × 1 = 12
QB demand, Four Horsemen         4 × 4 = 16   ← FEWER teams, MORE quarterbacks needed
QB demand, KBFL (32-team 1QB)   32 × 1 = 32
```

Neither team count nor slot count alone explains demand — only the product does, which is exactly
what a `isSuperflex` boolean cannot express. `demandMultiplier` is **exactly 1.0** for the
reference 12-team league, so standard leagues are unchanged.

It also now distinguishes **1QB / 2QB / 4QB / 6QB as four distinct values** — pinned by test.

### The pick curve, measured

`normalizedPickValue` now keys on **overall pick number**, not round. Verified identical for
12-team leagues:

| round | Four Horsemen (4tm) | KBFL (32tm) | 12-team |
|---|---|---|---|
| 1 | 2500 → **3193** (+28%) | 2500 → **1356** (−46%) | 2500 → 2500 ✅ |
| 2 | 1200 → **2500** (+108%) | 1200 → **240** (−80%) | 1200 → 1200 ✅ |
| 3 | 600 → **1957** (+226%) | 600 → **180** (−70%) | 600 → 600 ✅ |
| 6 | 100 → **952** (+852%) | 100 → 180 | — |
| 10 | 100 → **395** (+295%) | 100 → 180 | — |

**Validated against your own rulebook.** The Four Horsemen rules say a 3rd-round pick there "would
fall somewhere in the 1.9-1.12 range" of a 12-team draft. The conversion puts it at overall #10.5
— inside that range, derived from the curve rather than by hand. That is an independent human
answer agreeing with the code, which is the strongest control available here.

### ⚠ Honest limitation: the curve runs out for very large leagues

`PICK_ROUND_SHARE` was solved from **771 dynasty trades that are overwhelmingly 12-team**, and the
data stops at round 5 — roughly overall pick #55. A 32-team league passes that by its **second
round** (overall #33+), so KBFL's rounds 5–10 all hold the last observed share and price
**identically at 180**.

That is the same flat-floor problem the fix was meant to solve, moved from 100 to 180 and from
round 6 to round 5-equivalent. It is now *honest* — holding the last measured value rather than
inventing a decay — but it is **not solved for 32-team leagues**. Solving it needs pick data from
large leagues, which we do not have. Flagged rather than papered over.

---

## Phase 1.2 — rest-of-season conversion 🔄 helper done, writer gated

| Step | Status | Notes |
|---|---|---|
| Migration SQL | ✅ applied | Columns verified present: `rosProjection` (double precision, nullable), `rosWeeksRemaining` (integer, nullable) |
| Migration made idempotent + moved to `prisma/migrations/` | ✅ | `ADD COLUMN IF NOT EXISTS` — see below |
| `rosFromPerGame` helper | ✅ | `lib/af-projections/restOfSeason.ts`, **21 tests** |
| Mutation control | ✅ | Injected the exact 17× bug → **7 tests red**, restore byte-identical |
| `schema.prisma` fields | ✅ | `rosProjection Float?`, `rosWeeksRemaining Int?` |
| Writer change | ✅ | Both the season-long and week-scoped rows |

### Why the migration is now `ADD COLUMN IF NOT EXISTS`

The columns were already present when checked, but nothing says *how* they were applied. If by hand
rather than through Prisma, `_prisma_migrations` holds no row — and a bare `ADD COLUMN` would then
fail on the next `migrate deploy` with "column already exists", writing a `finished_at IS NULL` row
that **blocks every later deploy with P3009**. Idempotent, so Prisma can record it cleanly either
way. Moved into `prisma/migrations/` because it is applied, which is where applied migrations belong.

### ⚠ The Prisma client is half-generated, and it does not block anything

`npx prisma generate` fails with `EPERM` on `query_engine-windows.dll.node` — a peer's Next dev
server (PID 5232, holding :3000) has it open. Three attempts, three failures.

What that actually leaves:

| | state |
|---|---|
| `node_modules/.prisma/client/index.d.ts` | ✅ **current** — 35 `rosProjection` hits |
| inlined datamodel in `index.js` / `edge.js` | ✅ current |
| `node_modules/.prisma/client/schema.prisma` | ⚠ stale — but nothing reads it at runtime |
| `query_engine-windows.dll.node` | ✅ fine — version-specific, not schema-specific |

So the typecheck and the runtime are both correct; only a reference copy is stale. Worth a clean
regenerate when that dev server goes down. The three ~19MB `.tmp` files my failed attempts left
behind have been removed.

### One test failure, investigated and cleared

`command-center-notification-error-handling.test.tsx` failed once in a combined run. It is **not
mine** and the evidence is:

- **Passes in isolation** (2/2)
- **Passes on a re-run of the identical combined set** — so it is flaky, not deterministic pollution
- Imports nothing I touched — only `@/lib/decision-os/notifications` (mocked) and a component whose
  mtime is 08-30 and whose `git status` is clean

I did **not** `git stash` to isolate it: this tree is shared and a stash would have swept peers'
uncommitted work.

### The helper does more than multiply

`weeksRemaining` **subtracts a bye that is still ahead**. Over a 13-week window that is a ~7.7%
overstatement, and it does **not** cancel out across the league — at any moment mid-season it
over-values exactly the players whose bye has not yet passed and none of the others.

`rosFromPerGame` returns **null, never 0**, for unusable input. A 0 would enter the value engine as
a real projection meaning "this player will score nothing"; "we could not compute this" must not be
able to impersonate that. A genuine 0.0/game rate still returns 0, and a test pins the difference.

`perGameFromRos` / `reprojectRos` are the inverse, and they are why `rosWeeksRemaining` is a column:
a stored total is meaningless without its divisor. A test demonstrates that a star in week 14 and a
scrub in week 3 produce **the same stored total**, and only the divisor separates them.

### 🛑 Correction — I moved an applied migration, and had to move it back

I moved `20260831_tournament_grants` to `migrations-pending/` on the strength of its own header
("PARKED, NOT APPLIED"), then ran the check that verifies that claim. **Wrong order.** Q1 returned
a row: it was applied 2026-08-31 17:26:39, and the table exists.

Restored to `prisma/migrations/`, content verified byte-identical (md5 unchanged on both files),
directory count back to 151.

**The lesson is the one this file keeps recording:** a comment asserting a fact is not a
measurement of it, and I had already written the query that would have settled it. Run the check
*before* the action it authorises, not after.

The two migrations I did **not** move — `fantrax_league_source_id` and `devy_head_coach_context` —
were confirmed applied by Q4, so leaving them alone was right.

---

## Phase 0.4 — CENSUS RESULTS ✅ (run 2026-09-02, read-only against `neondb`)

### ✅ The thesis, confirmed with a number

| | rows | distinct players |
|---|---|---|
| `AFProjectionSnapshot` (what the engine computes) | **19,556** | **19,555** |
| `fantasy_projections` (what value used to read) | 1,003 (944 live) | 1,003 |

**19× more coverage.** The value engine was reading the smaller of the two tables, and the larger
one was unreachable.

### ✅ The identity join works — 1,576 / 1,576

The single biggest risk in the Phase 1.3 wiring. **100% of NFL AF rows resolve onto
`PlayerIdentityMap`.** The `af_projection_no_rows` warning I built will not fire for a bad join.

### ✅ IDP component amounts are populated — Phase 1.4 is viable

~90% of defenders carry `componentAmounts`, so `rescoreIdpForLeague` has real data to work with:

```
DB 257 rows / 232 with amounts    LB 246 / 218    CB 124 / 115
DT 122 / 111    DE 106 / 90    DL 105 / 100
```

### 🛑 `rosProjection` is populated on ZERO of 19,556 rows

Expected — `compute-projections` has not run since the columns landed — but it means **the Phase
1.3 wiring returns nothing until that cron next fires.** `af_projection_rows_without_ros` will fire
until then, which is exactly the honest signal it was built for.

### 🛑 NFL projections are 12 days stale, and the cron fails a third of the time

| sport | newest | basis | confidence |
|---|---|---|---|
| **NFL** | **2026-08-20** ← 12 days | sleeper weekly + IDP | high/medium |
| MLB · NBA · NCAAB · NHL | 2026-09-01 | `season_category_components` | **all low** |
| NCAAF | 2026-08-31 | `season_dk_fppg_proxy` (10,189 rows) | **all low** |

`cron-compute-projections`: **42 success / 22 failed (34% failure rate)**. Success and failure
timestamps are seconds apart, so a single run partially succeeds per sport — and NFL is the phase
that is failing. NFL is also the only sport with a genuinely good basis mix.

**This matters more than anything else in the census.** Phase 1.3 points the value engine at this
table; if the NFL phase keeps failing, it points at a table that stops updating.

### ⚠ Every row is `week = null` — the week-scoped path never writes

`week_scoped = 0` for **all seven sports**. The note in `ncaafProjections.ts:41` said this about
NCAAF; it is true everywhere. The writer's week-scoped branch (which carries the opponent-history
adjustment) is not producing rows.

### 🛑 `redraft_trade_value_snapshots` is EMPTY — zero rows

So audit finding G2 (three hardcoded nulls) has **no production impact yet**: nothing has ever been
written. It also means Chimmy's trade grounding reads an empty table, and the redraft
trade-proposal path has never completed successfully in production.

Good news for the fix — there is no bad historical data to migrate.

### ✅ Kickers — P1 confirmed, and a naming trap avoided

Only **41 kicker rows** exist (27 `sleeper_weekly_projection`, 14 `weekly_actuals_recency`), range
1.76–10.85. No kicker-specific scoring path, exactly as the audit found.

⚠ The 878 `P` rows scoring `season_category_components` with values down to **−9.44** are **MLB
pitchers, not punters** — `P` is ambiguous across sports and my query grouped it with K/PK. Not a
football bug. Worth remembering before someone "fixes" negative punter projections.

### Market board is healthy

FantasyCalc, refreshed 2026-09-01, all four format combinations present:
DYNASTY ONE_QB 462 players · DYNASTY SUPERFLEX 463 · REDRAFT ONE_QB 211 · REDRAFT SUPERFLEX 211.

---

## Phase 1.1 / 1.3 — the calculator is CONNECTED ✅

The audit's headline finding is closed. `AFProjectionSnapshot` now reaches the value engine.

| Step | Status | Notes |
|---|---|---|
| 1.1 `loadAfProjectionRows` in `world/port.ts` | ✅ | Week-scoped row beats the season-long baseline |
| 1.3 Prefer AF in `enrichmentPort`, provider fallback | ✅ | Records which fired in `valuationSource` |
| Tests | ✅ | **11 tests**, `afProjectionPreference.test.ts` |
| Mutation control | ✅ | Swapped `rosProjection` → `afProjection` (the 17× bug) → **7 tests red**, restore byte-identical |

### It was shut out TWICE, not once

The audit said the value chain read a different table. Wiring it up found the second lock:
`loadProjectionRows` filters **`source: { not: 'allfantasy' }`** — so even the mirror rows the
projection writer copies into `fantasy_projections` were excluded by design. Reading
`AFProjectionSnapshot` directly is the only way through.

### Only `rosProjection` is read — never `afProjection`

A row without a ROS value is **skipped**, not converted here against a guessed horizon. The
mutation control proves the distinction is load-bearing: substituting the per-game field turns 7
tests red.

Where the league's own horizon is known, the stored total is **re-projected** onto it — a league
whose championship is week 14 does not inherit the writer's 17-week assumption. Where it is not
known, the stored value stands, because inheriting a stated horizon is honest and inventing one is
not.

### Two warnings that stop a silent join failure

`AFProjectionSnapshot.playerId` and the canonical ids passed into the seam are **different id
spaces** unless the registry resolved them. A join across mismatched spaces returns zero rows and
looks exactly like "the engine has not computed these players yet". So:

- `af_projection_no_rows` — asked, got nothing back at all
- `af_projection_rows_without_ros` — rows exist but predate the ROS columns

Different diagnoses, different warnings, both tested. **This is what the census would have told us
up front** — and now the code says it at runtime instead.

### ✅ TYPECHECK MEASURED — 145 vs 145, zero delta (2026-09-02)

Sixth attempt, first to actually run.

| check | result |
|---|---|
| Sentinel | `SENTINEL_DONE=2` — exit 2 is tsc's "errors exist", normal on this baseline |
| Output size | **59,402 bytes** (the false runs were 0 and 16 bytes) |
| `error TS` lines | **145** vs a **145** baseline — **zero delta** |
| Crash / `Cannot find module` / fork-failure tells | **0** |
| Errors in files I touched | **none** |
| Compile set | **12,772 files**, and **all 14 of my touched files confirmed present** |

The last row matters as much as the count. `--listFilesOnly` (exit 0, 12,772 lines, no crash) is the
only check that proves a file was actually compiled, and CLAUDE.md records a case where a
thorough-looking config compiled 506 files while silently excluding the one under test.

⚠ **`__tests__` is excluded from tsconfig**, so my 44 new test files are NOT type-checked by this
run. Vitest transpiles them without full checking. That is pre-existing repo configuration, not a
gap I introduced, but it means "145, zero delta" describes the `lib/` and `app/` changes only.

⚠ **This 145 was measured in the SHARED CHECKOUT**, which holds other sessions' uncommitted work,
so per CLAUDE.md it describes a tree nobody will build. Peer `-70` reports the batch tip at
`857edb30b` measured **145 detached with a sentinel** — that is a real baseline anchored to a real
commit. When there is a SHA to hand over, the honest measurement is a detached worktree at its
parent, not a reuse of this number.

### How the earlier attempts failed — and how a broken check lied twice

Five runs lost before this one. Two distinct false-clean shapes, both worth recognising:

```
tsc-ros.txt     0 bytes,  no sentinel                    ← killed before writing
tsc-final.txt  16 bytes,  SENTINEL_DONE=4,  0 error TS   ← fork failure, reads as a PASS
```

Exit 4 is the Cygwin fork failure. Note the second: a sentinel **is** present, so a "did it finish"
check passes, and the count reads **0 against a 145 baseline**.

🛑 **My own wait loop caused part of it.** `until grep -q SENTINEL_DONE "$f"; do sleep 20; done`
forks a subshell every 20 seconds — ~30 extra forks per ten-minute wait, on top of the compile. The
fix is `run_in_background` plus the completion notification. Polling cost process handles and helped
kill the run it was watching.

🛑 **And two of my own verification checks produced confident wrong answers**, which is the point of
the rule about positive controls:

1. A hand-rolled glob matcher reported all three new files as **NOT in the compile set**. The bug
   was mine: replacing `*` with `[^/]*` after replacing `**` with `.*` corrupts the `.*` it just
   wrote. It printed a plausible, alarming, wrong answer.
2. `--listFilesOnly` at `--max-old-space-size=4096` **OOMed** (exit 134, SIGABRT) and emitted 26
   lines of crash dump. Grepping those for filenames returned zero matches for every file — a
   perfect false negative. At 8192 it exits 0 with 12,772 lines and finds all fourteen.

Both had the same shape: **a broken tool and a true negative print identically.**

Four attempts, none usable. Three died on Cygwin fork exhaustion (exit 4); the fourth I killed
myself when a peer reported **four concurrent `tsc.js` processes on this machine, ~11.8GB combined**.

The dangerous shape, from my own runs:

```
tsc-ros.txt     0 bytes,  no sentinel
tsc-final.txt  16 bytes,  SENTINEL_DONE=4,  0 `error TS` lines
```

The second is the one to watch for. A sentinel **is** present, so a "did it finish" check passes —
and the count reads **0 on a repo with a 145-error baseline**. Exit 4 is the fork failure, not tsc.
CLAUDE.md's rule ("a status that is neither 0 nor 1 is not a verdict") covers it exactly.

🛑 **My own wait loop was part of the cause.** `until grep -q SENTINEL_DONE "$f"; do sleep 20; done`
forks a subshell every 20 seconds — ~30 extra forks per ten-minute wait, on top of the compile.
Use `run_in_background` and wait for the completion notification; polling costs process handles for
nothing and helped kill the very run it was watching.

**Nothing in this phase is attested on a typecheck.** The last clean measurement was 145 vs a 145
baseline, taken *before* Phase 1.2 and 1.1/1.3. Re-run when the machine is quiet, alone.

### Test flakiness, characterised

Two suites failed in combined runs and passed both in isolation and on a re-run of the identical
set: `command-center-notification-error-handling` (1 test) and `grounding-serializer-values`
(5 tests). Neither imports anything in this workstream. **The suite has flakiness under parallel
load** — worth knowing before anyone reads a red run as a regression.

---

## Phase 1 — remaining ⬜

Decisions locked: store **both** units · `CanonicalValue` is the spine · adjustments are a
**separate "fit" number** · Phase 1 first.

| Step | Status | Notes |
|---|---|---|
| 1.1 `loadAfProjectionRows` in `world/port.ts` | ⬜ | Read `AFProjectionSnapshot` by `snapshotLookupKey` |
| 1.2 `rosFromPerGame` helper + `rosProjection` column | ⬜ | ⚠ **Needs a migration — yours to apply.** Computed at WRITE time. |
| 1.3 Prefer AF snapshot in `enrichmentPort`, fall back to `FantasyProjection` | ⬜ | Record which fired in `valuationSource` |
| 1.4 Apply `rescoreIdpForLeague` at the seam | ⬜ | Gated on Q4 of the census showing `with_component_amounts > 0` |
| 1.5 Recalibrate `PROJ_TO_VALUE`; fix clamp saturation | ⬜ | Soft knee above ~8500 rather than a hard clamp |
| 1.6 Tests incl. superflex-QB separation | ⬜ | Must go red before green |

---

## Phase 2 — Stop writing nulls ⬜

| Step | Status | Notes |
|---|---|---|
| 2.1 Fill `fantasyCalcValue` from `getFantasyCalcValuesDbFirst` | ⬜ | DB-first; the "live API" objection is obsolete |
| 2.2 Fill `idpValue` via `buildIdpKickerValueMap` | ⬜ | ⚠ Use `pickValue()` — reading `.value` yields **0 for every IDP/kicker in redraft** |
| 2.3 Fill or delete `rankingValue` | ⬜ | A permanently-null contract field is a lie |
| 2.4 Pass real `ScoringContext` into capture | ⬜ | Fixes the hardcoded `'ppr'` found in 0.3 |
| 2.5 Close the Chimmy/UI split brain | ⬜ | New, from 0.3 — persist the enriched memo or point Chimmy at it |

---

## Phase 6 — the engine becomes visible ✅ (2026-09-02)

**The gap this closes, stated plainly: the engine got substantially smarter and nobody could see
any of it.** The trade console showed a grade, two side TOTALS and three chips. Which input priced
each player, what the league's format thought, why a player came out at zero — all computed, all
stored, all rendered nowhere. A grade you cannot interrogate is a number to accept or dismiss,
never one to argue with.

| Step | Status | Notes |
|---|---|---|
| 6.2 "Why is this number what it is" | ✅ | Per-asset basis, in plain language, behind a `<details>` in the trade console |
| 6.3 Base and format fit as **separate** numbers | ✅ | The fit renders as its own percentage with its own sentence; the base is untouched |
| 6.4 Refusals render as sentences | ✅ | `valuationBasis: 'none'` says "gap in our data, NOT a judgement that he is worthless" |
| 6.1 `/projections` surface | ⬜ | Not started |

### 🛑 `valueBasisFor` — one implementation, not two

The obvious way to label a value in the UI is to re-check the engine's conditions there. That is
two implementations of one rule, and this repo has already measured the cost (a SQL copy of
`normalizePlayerName` disagreed with the real one on **7.2%** of 500 rows).

So the branch decision was extracted into `valueBasisFor` in `valueEngine.ts`, and
`normalizedPlayerValue` **branches on its result**. The snapshot records it; the panel reads it.
Behaviour-preserving — verified by the existing 163 trade-value tests passing unchanged before any
new assertion was written.

⚠ **`adp` is never a basis.** It is a capped PREMIUM on the projection path, worth a few hundred
points at most. A player with an ADP and no projection is priced from the market or not at all, so
reporting "priced from ADP" would name an input that never decides the number.

### The two cases that were previously invisible

- **An unpriced player.** Rendered as a bare `0` beside a real 6,552, that reads as *worthless* —
  the opposite of what it means. Every zero now says which of the two it is, and a banner counts
  how many, because a side total that silently omits players looks complete and is not.
- **A format opinion.** Guillotine's −47% and Four Horsemen's +5% now appear as their own figures
  with the model's own sentence. A closed trade window renders as a warning, not a discount — the
  player is worth the same, he is simply untradeable.

### Verified in a browser, without touching the database

`/dev/trade-value-preview` — dev-only, `notFound()` in production, synthetic data, and it imports
no prisma. Same pattern and same reason as `/dev/admin-29a-preview`: **`.env.local` points
`DATABASE_URL` at the production Neon endpoint**, so opening a real league locally would run every
roster query against production to look at a panel.

Confirmed in the DOM rather than by eye: 8 base values, 2 fits, 1 unpriced note. **`7,410` stays
`7,410` beside a −47% fit** — the blended `3,927` appears nowhere. Server logs contained zero
prisma lines; the three console errors are pre-existing local-env noise (Sentry DSN, Facebook over
http).

**Mutation control:** rendering `internalValue × multiplier` as the base turns **2 tests red**,
including the one asserting the product never appears. Proved applied against a byte-compared
backup and proved restored the same way.

**Suites: 4,062 passed across 227 files** (87 skipped), exit 0 — including `decision-os`, which
consumes the refactored engine.

### ⚠ Still not visible

`/projections` (6.1) has no surface. And the panel renders what the **client-side preview**
computes — `TradeCenterModal` builds its assets with four of five sources null, so in the live
console most rows will report `Projection` or `Not priced`. That is honest, and it is also the next
thing worth fixing: the modal cannot call `resolveTradeEnrichment` directly because it is
`server-only`, so this needs a route.

---

## Phases 3–7 ⬜ Not started

See §8 of the audit doc. Order: 3.1 kickers → 7.1/7.2 Chimmy tools → the rest.

---

## Files created so far

| File | Purpose |
|---|---|
| [`docs/AF_VALUE_AND_PROJECTIONS_AUDIT_AND_PLAN.md`](AF_VALUE_AND_PROJECTIONS_AUDIT_AND_PLAN.md) | The audit, 34 questions, 8-phase plan |
| [`docs/AF_VALUE_PROJECTIONS_PROGRESS.md`](AF_VALUE_PROJECTIONS_PROGRESS.md) | This file |
| [`docs/sql/phase0-value-projection-census.sql`](sql/phase0-value-projection-census.sql) | 11 read-only census queries — **you run these** |
| [`scripts/probe-value-parity.ts`](../scripts/probe-value-parity.ts) | Pure offline parity probe, 4 positive controls |
| `.claude/launch.json` | Added `next-dev-value-engine` (own dist dir, per repo convention) |

⚠ The line that stood here said **"Nothing is committed. All changes are working-tree only."**
That was true when written and false by the time anyone read it — five commits exist
(`205e8bceb`, `28c9b6078`, `688623d74`, `abef9c466`, `adfd7cde5`), three of them landed on
`main`. Recorded rather than deleted, because a status line that ages into a lie is the failure
mode this document is most exposed to.

---

## Census, 2026-09-02 — 🛑 `lib/trade-intel/` ALREADY MODELS MOST OF THESE FORMATS

**This reframes Phase 4 and the "16 per-format value models" item, and it was found by accident.**
While blocked on a typecheck box, a read-only census of what the repo knows about each format
turned up a ~12,000-line subsystem nobody in this plan had mentioned.

### What exists

| Module | Lines | What it does |
|---|---|---|
| `lib/trade-intel/leagueFormatRules.ts` | 413 | Concept resolution **including alias flattening**; keeper surplus; impossible-pick warnings |
| `lib/trade-intel/tradeContextNotes.ts` | 1488 | The consumer — reached from `/api/trade-value/analyze` |
| `pirate.ts` · `zombie.ts` · `kingOfTheHill.ts` | 207·262·144 | Steal exposure, weapon/bomb/serum value, crown value |
| `survivor.ts` · `tournament.ts` · `guillotine.ts` | 207·192·194 | Tribe relation, bracket compression, field-shrink decay |
| `salaryCap.ts` · `devyOutlook.ts` · `devyTradeValue.ts` | 242·339·320 | Cap maths, college asset recognition |
| `rosterNeed.ts` · `positionScarcity.ts` · `contention.ts` · `situation.ts` · `trajectory.ts` · `managerPremium.ts` | 463·137·178·273·341·370 | The context axes the original audit asked about |

### What it does NOT do

**None of it reaches `normalizedPlayerValue`.** It produces prose, risk descriptions and some
point-based maths for an analyze route. No format opinion can move a trade value.

So the gap is real and `lib/trade-value/formats/` is the right shape for it — but the framing
"sixteen unmodelled formats" was wrong, and acting on it would have built a second implementation
of work that already exists.

### 🛑 The defect this found in already-written code

`formats/registry.ts` resolved models from `TradeValueContext.leagueType`.
`lib/league-creation/canonical/normalizeConcept.ts` flattens four concepts onto base formats:

    pirate_vampire → dynasty        king_of_the_hill → redraft
    royal          → dynasty        idp              → redraft

A pirate league's `leagueType` is the literal string `dynasty`. **Any pirate or
king-of-the-hill model would have been unreachable from the day it landed**, returning a null
indistinguishable from an honest "no model". Fixed in `adfd7cde5` by resolving through
`readFormatRules`, which already handled this.

The sixteen-id list was also wrong three ways — it counted string occurrences, so it caught
`idol` and `exile` (Survivor mechanics) and `lottery` (`lib/draft-lottery/`), missed `c2c`, and
listed alias-only ids as `leagueType` values.

### What this changes about the plan

1. **Do not write 16 models from scratch.** For pirate, zombie, KOTH, survivor, tournament,
   guillotine, salary cap and devy/c2c, the rules are already encoded — the work is a *value
   adapter* over `lib/trade-intel/`, not new domain logic.
2. **`lib/league-concepts/*Defaults.ts` is a second rule source**, machine-readable, covering
   redraft, dynasty, best ball, keeper, guillotine, tournament, survivor, devy, salary cap, c2c.
   Guillotine alone carries `eliminationStartWeek`, `eliminationsPerPeriod`, `endgame`,
   `faabBudgetPerTeam`, `dangerMarginPoints`.
3. **Only a few formats genuinely lack encoded rules** — `big_brother` and `zombie` have large
   engine directories but no settings snapshot; Four Horsemen needed a PDF from the user. Those
   are where a rulebook is still required.
4. ⚠ **`lib/trade-value/captureSnapshot.ts:237` hardcodes `leagueType: 'redraft'` and
   `isDynasty: false`.** Believed correct — it is the redraft capture path writing
   `redraft_trade_value_snapshots` — but **not proven**. If anything routes a dynasty trade
   through it, that trade is priced as redraft silently.

### Method note — and a correction inside it

The finding came from checking whether a module already existed **before** writing one, which is
this repo's standing rule and was skipped when the registry was first written.

⚠ **The first version of this note gave a wrong reason, and the wrong reason is worth keeping.**
It said a name-grep found zero callers because the per-format functions "are used via re-export".
They are not. `tradeContextNotes.ts` imports them with **relative paths** — `from './pirate'`,
`from './zombie'`, `from './kingOfTheHill'` — so the grep that missed them was searching for
`trade-intel/pirate`, which a relative import never contains. That is precisely the
four-import-form trap CLAUDE.md records, hit **while writing about it**, and the invented
explanation had a plausible mechanism attached. Verified by reading the import block.

**`lib/trade-intel/salaryCap.ts` (242 lines) is genuinely orphaned** — censused across all four
import forms, its only importer is `__tests__/salary-cap-trade.test.ts`. Every one of its five
exports has exactly one caller, the test. It is the one module in the subsystem that reaches no
production path, so a salary-cap value adapter has no existing consumer to hang off.
