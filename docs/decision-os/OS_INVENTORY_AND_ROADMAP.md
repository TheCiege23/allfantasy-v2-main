# The OS systems — inventory, scorecard, and the road to 100%

**Written 2026-09-01.** Companion to
[`OS_FEED_STATE_2026-09-01.md`](./OS_FEED_STATE_2026-09-01.md) (the feed-seam
audit) and [`HUB_BUILD_PLAN.md`](./HUB_BUILD_PLAN.md) (the owner-directed plan).

> **This file answers four questions:** which OS systems exist · how complete
> each one is · what a user actually sees today · and which OS systems *should*
> exist. §6 is the recommendation; §7 is the road to 100%.

---

## 0. Working agreements — owner-set, 2026-09-01

**These bind every task in this file. Violating one is a defect, not a shortcut.**

| # | Rule | What it means in practice |
|---|---|---|
| **W1** | **Never push to production.** | Work lands on a branch. Production pushes happen only for an explicitly requested live test, and only by the designated pusher. |
| **W2** | **Every deliverable ships with a dev URL.** | A non-prod preview the owner tests against. Never "it works locally" — never `allfantasy.ai`. |
| **W3** | **All SQL is handed over explicitly.** | Every table, column and index is written out in §10 for the owner to apply. **No migration is ever applied by an author.** |
| **W4** | **Mark tasks done as they complete.** | The ledgers in this file and in `HUB_BUILD_PLAN.md` are updated in the same change that does the work — never in a batch afterwards. |
| **W5** | **Deep, not repeated.** | See below. This is the rule that governs how everything else is built. |
| **W6** | **Universal across all seven sports.** | `NFL · NHL · NBA · MLB · NCAAB · NCAAF · SOCCER`. See §0.2 for how this reconciles with the NFL+NCAAF value scope. |

### 0.1 What "deep" means here — W5 stated as testable conditions

*"I don't want to keep rebuilding the same things over and over."* The
rebuilding in this repo has had five recorded causes. Each gets a rule:

| Cause | Rule |
|---|---|
| A check that could not fail read as a pass | **Every check reproduces a known positive before its negative is trusted.** Inject the failure; confirm it is reported. |
| A test that asserted the wrong half | **Every test is proved RED against the pre-fix code**, and the mutation is proved to have applied. |
| A census that stopped at "who imports it" | **Every census checks all four import forms**: `@/lib/x`, `./x`, `await import()`, and test mocks. |
| A seam built with no consumer | **Nothing ships without a caller.** A feed with no reader and a reader with no writer are both incomplete. |
| A surface pointed at a table nothing refreshes | **Migrate the read and wire the writer in the same change, or neither.** |

**And one addition specific to this build:** a task is done when it is
*connected*, not when it compiles. §3's central finding is that this system is
~85% constructed and ~30% connected. More construction is the failure mode to
avoid.

### 0.2 W6 — how "all sports" reconciles with the NFL+NCAAF value scope

These are not in conflict and the distinction is load-bearing:

| Layer | Sport coverage | Why |
|---|---|---|
| **Every contract** | **All 7, always** | `lib/sport-scope.ts` standing rule + plan **D17**. `sport` is a required field on every fact, never a default. |
| **Value / projection producers** | **NFL + NCAAF first** | Not a design choice — the producer matrix is genuinely sparse. FantasyCalc prices NFL only; devy is NCAAF only; kickers are football-only. Other sports return **`no_producer`**, a fact about the world. |
| **Manager Psychology** | **All 7 from day one** | Its inputs are league *transactions*, not vendor stats — so it has no sparse-producer problem. `SportBehaviorResolver` already maps all seven and calibrates thresholds per sport. |

⚠ **"No producer for this sport" is a first-class answer, not a gap.**
Collapsing it into `null` is how a sport silently looks broken.

---

## ⚠ Read this before trusting any percentage

1. ✅ **Env findings are now resolved against real Vercel** — `vercel env ls`
   was run by the owner 2026-09-01. **See §0.3, which corrects three claims in
   this file.** Values themselves are hidden; only presence and environment were
   read.
2. **The production database was not queried.** Table existence, row counts and
   real freshness are unknown here. (R0.2, still open.)
3. **Percentages are a weighted axis score, not an estimate of effort.** The
   axes are in §3 and the weighting is stated. They are for ranking what to fix,
   not for planning a calendar.

---

## 0.4 ✅ R0.2 RESOLVED — `domain_os_facts` DOES NOT EXIST IN PRODUCTION

Owner ran it 2026-09-01: **`Did not find any relation named "domain_os_facts"`.**

**D5 — "precomputed, always warm" — is not in effect anywhere, and never has
been.** Every `domain-os` feed derives live on every single call.

### What actually happens, traced rather than assumed

The model is in `schema.prisma`, so **the Prisma client delegate exists** —
verified: 24 references to `domainOsFacts` in the generated client. So
`delegateOf(db)` does **not** return undefined, and the `if (!delegate) return`
guard never fires. The queries run and hit Postgres.

| Path | What happens |
|---|---|
| `store.read` | `findUnique` throws **P2021** → caught → returns `null` → **read misses, every time.** ✅ Fails safe, exactly as designed. |
| `store.write` | `upsert` throws **P2021** → caught by `catch {}` → returns normally. **The write silently does nothing.** |

**The read half is correct and the design deserves credit for it** — the store's
own header promises it will never serve a stale fact and will degrade to live
derivation, and that is precisely what a missing table produces. Nothing is
wrong in any answer any user has received.

### 🛑 But the write half reports success for writes that never happened

Two swallows stack, and the outcome is a lie:

```ts
// store.ts — swallow #1
try { await delegate.upsert(...) } catch { /* must never fail the caller */ }

// store.ts — swallow #2
export async function safeWrite(store, args): Promise<void> {
  try { await store.write(args) } catch { /* opportunistic */ }
}

// feed.ts — put() ignores the result, so:
async refresh(source, args) {
  const live = await source.derive(args).catch(() => null)
  if (!live) return 'unavailable'
  await put(source, args, live)
  return 'written'          // ← ALWAYS. The write failing cannot reach here.
}
```

`/api/cron/domain-os-refresh` then does `if (outcome === 'written') counts.written += 1`.

**So the cron has been firing every 30 minutes, deriving facts for up to 200
leagues × 2 sources, writing none of them, and reporting `written: N` as healthy
work.** Since `safeRead` always misses, no league is ever skipped as still-warm —
so it is the *full* walk, every fire, at ~7 queries per `resolveCanonicalLeagueRules`.

⚠ **And the route's own comment says the opposite**, in good faith:

> *"this catch covers a store write failing, which it does not."*

The `try/catch` around `t.refresh(args)` **cannot** catch a store write failure,
because `safeWrite` has already swallowed it two layers down. For that case the
catch is dead code and the outcome is `'written'`.

🛑 **This is the "check that cannot fail" family, in its most expensive form:
not a check that reads a pass, but a WRITER that reports success while writing
nothing.** It is the exact inverse of the `ingestCFBDStats` failure this repo
already records — there, a surface read a table nothing wrote; here, a writer
fills a table that does not exist and says it worked.

### Two fixes, and the second matters even after the first

| Fix | What | Why both |
|---|---|---|
| **F1** | Apply §10.1 — create the table | Makes the feeds actually warm. Turns ~19k discarded derives/day into cache hits. |
| **F2** | Make the write outcome honest | **Required independently of F1.** With only F1, the next write failure — a permissions change, a schema drift, a full disk — reports `written` exactly the same way. The bug is that failure is unobservable, not that the table is missing. |

**F2, precisely:** `OsStore.write` returns `boolean`; `safeWrite` propagates it;
`put` returns it; `refresh` returns `'unavailable'` when it is false.

⚠ **`get()` must NOT change.** There, a failed cache write is genuinely
opportunistic — the caller already has the live value and must still receive it.
Only `refresh`, whose entire job is to write, may report the failure. **Same
swallow, two different correct behaviours** — which is why this is a two-line
change in `refresh` and not a redesign of the seam.

### Consequence for the rest of this file

**Every latency figure in these documents is the cold-cache case.** The
5354/6178/5441 ms packet builds were measured with **zero caching in effect**.
Applying §10.1 is therefore the single largest available latency win, and R1.5's
3-second target should be re-judged after it — not before.

---

## 0.5 ✅ F1 + F2 SHIPPED TO BRANCH — 2026-09-01

**Not pushed.** Working tree only, per **W1**.

## 0.10 ✅ R1.2 / G2 DONE — the valuation lane is requested, and derives its own inputs

**Branch only. Not pushed, not deployed (W1).**

### The gate was double-locked, and only one lock was documented

**G2** was recorded as "the chat route doesn't ask for `want.values`". True, and not
sufficient — `packet.ts` gated the market slice on `want.values && args.valueFormat`, so
setting `want.values: true` alone would still have bought **nothing**. Two locks, one key each:

| lock | fix |
|---|---|
| the route never set `want.values` | set it (plus `devy`, scoped — below) |
| the packet required a `valueFormat` no caller passed | **derive it** from the rules already loaded |

### 🛑 Derived in the PACKET, not demanded from callers

`valueFormat` is `general.format` + `detectQbFormat(roster.starters)`; `leagueIdpRules` is
`scoring.activeRules` as a `statKey → points` map. **The packet already loads those rules**, so
this costs no new query at any call site — and one derivation cannot drift the way two can. It is
the same argument `OsFactSource.scopeKey` makes about producers and consumers sharing a key.

An explicit argument still wins and stays fully parallel; only the derived path takes the extra
hop off `pRules` (~765 ms from store, against ~1250 ms of measured headroom — R0.10).

⚠ **`undefined` and `null` are NOT the same for `leagueIdpRules`.** `null` is a caller asking for
the canonical value, which `ProjectionFact.rescored: false` then reports honestly; `undefined` is
a caller with no opinion. A `??` would have silently overridden the first. Pinned by a test.

⚠ **Keeper maps to DYNASTY.** `PlayerValueSnapshot` holds exactly four buckets — measured:
`DYNASTY|REDRAFT × SUPERFLEX|ONE_QB` — so every league must land on one. A keeper league holds
assets across seasons, which is what the dynasty market prices; REDRAFT would price a held asset
as a rental.

⚠ **All active rules are passed, not a filtered "IDP" subset.** `rescoreIdpForLeague` walks the
*projection's* components and looks each up, so a non-IDP key is never read. Filtering on
`category` here risks dropping a real IDP rule an importer spelled differently — silent
under-scoring, which is worse than a harmless extra key.

### `devy` is scoped to NCAAF deliberately

The board is college-football only, so requesting it on an NFL league returns a `no_producer`
gap — true, unfixable, and printed into every NFL answer. An **unrequested** slice raises no gap
at all, which is the honest shape for a question that could never have wanted it.

⚠ **Known limitation, recorded not guessed:** a C2C / devy-slot NFL dynasty league *does* want the
board and this sport test will not find it. **R1.5.**

### A third caller was fixed for the same reason

`/api/admin/decision-os/grounding-proof` had the identical narrow `want`. **A proof surface that
assembles a different packet from the live route proves nothing about the live route**, so it now
mirrors it exactly.

### Verification

| check | result |
|---|---|
| 4 new tests | **RED first** — the two derivation tests failed, the two "explicit wins" tests passed (that behaviour already worked) |
| after fix | **63/63 across 4 suites** |
| typecheck | ⏸ **deliberately not run — see below** |

🛑 **NO TYPECHECK IS ATTESTED FOR R1.1 OR R1.2, AND THE REASON IS NOT LAZINESS.** A peer session
reported **four concurrent `tsc.js` processes at ~11.8 GB** on this machine, with runs being killed
silently — *zero bytes written, no `error TS` lines, no crash dump, and a sentinel that is neither
0 nor 1*. My own R1.1 typecheck was stopped with no completion record and was almost certainly one
of them. **On a repo with a ~145-error baseline, "clean" is the tell that a run measured nothing.**
Starting a fifth would produce an unreliable number and slow four other sessions down. It runs when
the machine is quiet, and not before.

---

## 0.9 ✅ R1.1 / G11 DONE — the packet now says what it knows

**Branch only. Not pushed, not deployed (W1).**

### What the model receives now — real production data, real league

Before, every slice rendered as the single word `available`. Now:

```
- Projections: available (13 days old, served from store)
    · Ashton Jeanty (RB) 14.8 pts — canonical preset, NOT this league
    · Ladd Mcconkey (WR) 13.1 pts — canonical preset, NOT this league
    · Khalil Mack (LB) 4.4 pts — canonical preset, NOT this league
    · …and 1568 more not shown (Projections holds 1576)
- League intelligence: available (served from live)
    League: "Stop Hatin Satan!" (12 teams, half-ppr), format: superflex, dynasty.
    Graded trade ledger: 129 completed trades since 2020…
    History (565 matchups synced across 7 seasons); highest week ever 208.6…
```

### 🛑 The value contract was ANONYMOUS, and that would have made R1.1 useless

`CanonicalValue` carried `playerId` / `idSpace` / `sourceId` — everything needed to identify a
player to the **system**, and nothing to identify them to a **reader**. A model handed
`pid-3d9f8a2c … 6420 market_units` cannot answer *"what is Nabers worth"*, which is the whole
first-milestone goal (**A12**).

⚠ **All three adapters already had the name and were discarding it.** `marketAdapter` selects
`name`, passes it as the identity resolver's `nameHint`, and drops it one line later;
`idpKickerAdapter` does the same; `devyAdapter`'s `sourceId` is literally `name@school`. Adding
`playerName` / `position` as **display-only optional** fields costs no new query anywhere and
touches neither `isCoherentValue` nor the D15 unit arithmetic.

### 🛑 A SECOND BUG, FOUND ONLY BY LOOKING AT THE OUTPUT

The packet announced **"Projections: available (13 days old)"**. The newest
`AFProjectionSnapshot` row was written **the previous morning** — the cron is healthy.

`packet.ts` dated the whole slice with `asOf: facts[0]?.computedAt` — **whichever of 1,576 rows
happened to land first**. The rows span three weeks and arrive in no guaranteed order.

**Fixed to `oldestAsOf(facts)`.** Oldest rather than newest, because a single `asOf` cannot
express a range and this codebase already settled which way to be wrong: `ImportAssertions`
carries both `lastAttemptedSyncAt` and `lastSuccessfulSyncAt` so a surface cannot show the
flattering one. Overstating age makes a model hedge unnecessarily; understating it makes a model
assert stale numbers as current. **Only the first is recoverable.**

⚠ The red test caught it erring in the *unsafe* direction — reporting 2 hours old when the oldest
member was 300 hours old. **An arbitrary element can be wrong either way**, which is exactly why
it is not a rounding error.

### 🆕 Two findings the rendered output made visible

1. **Every projection reads `canonical preset, NOT this league`.** That is **G2** confirmed in
   production: the chat route passes no `leagueIdpRules`, so a superflex dynasty league with
   Khalil Mack (LB) and Jonas Sanker (DB) on its rosters is being shown *balanced-IDP* numbers.
   The warning fired correctly on its first real run.
2. **The 8 rendered rows are arbitrary** — first-8, not the user's roster and not top-ranked.
   Bounding is correct; **ordering is not solved.** For "what is my WR worth" the right 8 are the
   asker's players. Recorded as **R1.4**, not hidden.

### Verification

| check | result |
|---|---|
| new serializer suite | **RED first** — 5 failed / 3 passed. The 3 passing were the gaps-half regression guards |
| after fix | **8/8** |
| freshness bug | **RED first** — `expected '2026-08-31T18:00' to be '2026-08-19T08:00'` |
| all three grounding suites | **48/48** |
| typecheck | ⚠ **blocked — see below** |

🛑 **THE TYPECHECK COULD NOT BE MEASURED, AND THE TELL IS WHY THIS IS RECORDED RATHER THAN
CLAIMED.** The run reported **5** `error TS` lines against a **145** baseline — *cleaner than
baseline*, which CLAUDE.md names as the signature of a blind run. Cause: 411 bytes of output, all
**syntax** errors (`TS1003`, `TS1005`) in `app/api/user/profile/avatar/route.ts`, where a peer had
inserted an `import` statement **inside** another import block mid-edit. Not this change's file,
and not this change's error. **No typecheck is attested until a clean run exists.**

---

## 0.8 🛑 R0.10 — IT WAS THE DEV SERVER. THE PACKET ALREADY MEETS THE CEILING.

**Measured 2026-09-02 on a real production build** (`next build` → `next start`,
own dist dir `.next-prod-decision-os`, `BUILD_DONE=0`, proof route confirmed
compiled into the artifact). Same league, same packet, **same code** as the dev
run — the only variable changed is the build.

| | dev server | **production build** |
|---|---|---|
| cold first hit | 7026 ms | 4070 ms |
| steady state | **3983 – 5242 ms** | **1730 · 1775 · 1782 ms** |
| vs the 3000 ms ceiling | ❌ exceeded every run | ✅ **~1250 ms of headroom** |

### 🛑 This overturns THREE conclusions in this file, including two of its own

| claim | verdict |
|---|---|
| §0.4 "the missing table is very likely the whole 5.4s" | ❌ **wrong** — already retracted in §0.6 |
| §0.6 "still over the ceiling; warming didn't fix it" | ❌ **wrong environment.** True of a dev server, false of production |
| §0.7 "no query is slow — it is queueing" | ⚠️ **half right.** Queueing was real; the cause was the dev server, **not** pool saturation |
| §0.6 "four context providers time out at exactly 1500 ms" | ❌ **dev artifact.** On production `matchup`, `roster`, `rankings` and `devy` all return `ok=true` in 566–1170 ms |

**R0.9 is therefore closed without work: half the context slices were never
failing in production.**

### The production slice profile — nothing dominates any more

```
 1170 ms  devy                     live   ok
 1113 ms  savedAnalysis            —      FAILS (data, not latency)
  994 ms  leagueIntelligence       live   ok
  766 ms  importedHistory          live   ok
  765 ms  importAssertions         STORE  ok
  765 ms  leagueRules              STORE  ok
  765 ms  projections              STORE  ok
  657 ms  rankings                 live   ok      ← was a 1500 ms timeout on dev
  642 ms  roster                   live   ok      ← was a 1500 ms timeout on dev
  566 ms  matchup                  live   ok      ← was a 1500 ms timeout on dev
```

`savedAnalysis` is no longer the critical path — `devy` is, by 57 ms. **There is
no long pole left.** The profile is flat, which is what a healthy parallel
assembly looks like.

⚠ **`savedAnalysis` still returns `ok=false`** — but at 1113 ms that is a
**data** problem (`not_computed`: no run exists for this league's current
evidence), not a latency one. Different ticket, much lower stakes.

### What this means for the plan

🛑 **G4 (the latency gap) is substantially CLOSED, and no latency work is needed
before R1.** The packet fits the chat route's 3-second budget today, on real
production code, against real production data.

**R0.11 drops to low priority.** Both cuts were justified by a latency problem
that does not exist in production:
- *Cut 1* (the duplicate `intelligence_league_snapshots` read) is still
  unconditionally correct — one provably redundant round-trip, ~16 ms — but it is
  now tidiness, not a fix.
- *Cut 2* (parallelising the four serial evidence queries) was contingent on the
  bottleneck being latency rather than pool contention. It is latency — so it
  would help — but it would buy ~50 ms against 1250 ms of headroom. **Not worth
  the risk to a working path right now.**

### ⚠ The lesson, recorded because it cost four investigations

**Every figure in §0.6 and §0.7 was correctly measured and wrongly generalised.**
The tooling was right, the arithmetic was right, the reasoning was careful — and
the environment invalidated the conclusion. §0.6 *did* flag this ("these numbers
come from a local dev server… the absolute comparison is weak") and the flag was
then not acted on for two more investigations.

🛑 **A caveat you write down and do not test is not a caveat, it is a footnote.**
The correct move was to run R0.10 immediately after R0.3 — before diagnosing a
cause for a number that had not been established as real. Measuring the right
thing in the wrong place is the most expensive kind of careful.

---

## 0.7 ✅ R0.8 DIAGNOSED — no query is slow. It is queueing.

Every candidate measured against production, 2026-09-02. **Not one is the cause.**

### First: `savedAnalysis` is not "one indexed read", and its own header says it is

`savedAnalysis.ts` documents itself as *"One indexed read, no provider call, no
added latency."* Traced, `readLeagueIntelligence` is **four steps, and the
indexed read is the last one**:

| # | step | cost |
|---|---|---|
| 1 | `buildLeagueIntelligenceEvidence` — **rebuilds the league's evidence set** | 4 queries |
| 2 | `computeIntelligenceRequestIdentity` — hash | none |
| 3 | `resolveIntelligenceAccess` — entitlement + league access | 2 queries (parallel) |
| 4 | `store.findByIdentity` — ← *the* "one indexed read" | 1 query |

🛑 **The claim is not a small inaccuracy: it is the reason nobody looked here.**
A header asserting a single indexed read is a header that says "not worth
profiling". Step 1 alone rebuilds evidence on **every** packet build, and it
cannot simply be skipped — the identity key is derived from the evidence *on
purpose*, so that changed league data misses the cache instead of serving a
stale answer under a matching key.

### Then: every query measured, and every one is fast

Against production, this league:

| query | measured |
|---|---|
| Neon round-trip (`SELECT 1`, ×5) | **15–35 ms** |
| `leagues` findUnique | 18.9 ms |
| `intelligence_league_snapshots` findUnique (**runs twice** — see below) | 16.2 ms |
| `rosters` count | 16.0 ms |
| `decision_os_imported_activity` findMany — 188 rows, **23 kB** total | 16.2 ms |
| entitlement — 2 queries under one `Promise.all` | ~20–40 ms |

**Total real query work for the whole `savedAnalysis` path: ~120–150 ms.
Reported: 5236 ms. A 35–40× gap that no query accounts for.**

⚠ The unbounded `findMany` in `loadImportedActivityEvidence` — no `take`,
selecting a JSON column — *looks* like the culprit and is not, on this league.
It would be worth bounding before a league with 6,000+ rows finds it (the
resolver's own comment cites 42 leagues with 6,436 rows between them), but it is
**not** what to fix today. Measured, not assumed.

### The actual tell, and it was already in the R0.3 data

`importAssertions`, `leagueRules` and `projections` each reported **exactly
1115 ms** — three *different* queries, each ~16 ms of real work, all resolving on
the identical millisecond.

🛑 **Three independent operations finishing at the same millisecond after 16 ms
of work is queueing.** They were blocked together and released together. That is
~70× inflation on a cache hit, and it applies to every slice — `savedAnalysis` is
not special, it is simply last out of the queue.

**So the packet's cost is contention, not any single operation. The fix is fewer
round-trips, not a faster query** — and optimising `savedAnalysis` in isolation
would have bought nothing.

### ⚠ What cannot be settled on a dev server, stated rather than guessed

Three candidates remain and **this measurement cannot separate them**:

1. **Prisma pool saturation.** `DATABASE_URL` sets no `connection_limit` (default
   is `cpus × 2 + 1`) and no `pgbouncer=true`, while connecting through Neon's
   pooler. The packet fires ~17 slices plus 12 context providers concurrently.
2. **Next dev-server overhead.** Single-threaded, on-demand compilation,
   materially worse under concurrent async work than a production build.
3. **Neon pooler behaviour** under that burst.

🛑 **Naming one now would repeat the mistake §0.6 records** — reasoning from a
plausible mechanism to a conclusion without isolating it. The decisive experiment
is to measure the same packet in a **production-like build** (`next build && next
start`, the `next-start` config already exists) or on a preview deployment. If
`buildMs` collapses, it was the dev server; if it holds, it is the pool and
`connection_limit` is the lever.

### Two cheap fixes this surfaced, independent of the above

- **`intelligence_league_snapshots` is queried twice per build** —
  `loadLeagueSourceVersion` reads it, then `buildLeagueIntelligenceEvidence`
  reads the same row again with a near-identical `select`. One round-trip,
  free to remove.
- **`buildLeagueIntelligenceEvidence`'s four queries are fully serial** — no
  `Promise.all`, though none depends on another's result. The same waterfall
  `packet.ts` already fixed in itself.

---

## 0.6 ✅ R0.3 DONE — and it REFUTES this file's own hypothesis

🛑 **§0.4 said the missing table was "very likely the whole 5.4-second packet."
That was wrong, and the measurement says so.** Recorded rather than quietly
corrected, because the reasoning was plausible and someone will re-derive it.

Measured 2026-09-02 via `/api/admin/decision-os/grounding-proof` — the **same
surface** that produced the original 5354 / 6178 / 5441 ms figures — on a live
NFL dynasty league, with `domain_os_facts` populated and serving.

| run | buildMs |
|---|---|
| 1 (cold compile) | 7026 |
| 2 | 4216 |
| 3 | 3983 |
| 4 (detailed) | 5242 |

**Still over the 3000 ms ceiling. Warming the kernel did not fix it.**

### Why — the per-slice breakdown, which is the actual finding

| slice | ms | servedFrom |
|---|---|---|
| **savedAnalysis** | **5236** | ❌ failed |
| **leagueIntelligence** | **4636** | live |
| importedHistory | 1488 | live |
| standings | 1434 | live |
| leagueDifficulty | 1328 | live |
| matchup · roster · rankings · devy | **1500 each** | ❌ failed |
| `importAssertions` · `leagueRules` · `projections` | 1115 | ✅ **store** |

**`savedAnalysis` alone is 5236 ms of a 5242 ms build. It IS the critical path —
and it fails.** `leagueIntelligence` is second at 4636 ms.

🛑 **NEITHER GOES THROUGH THE DOMAIN-OS KERNEL.** `savedAnalysis` reads
`decisionIntelligenceRun`; `leagueIntelligence` is a `lib/intelligence/chimmy/*`
resolver. **No amount of cache warming could ever have touched them**, which is
precisely why the hypothesis was wrong: it reasoned from "the cache is broken" to
"the cache explains the latency" without checking whether the slow slices used
the cache at all.

✅ **The three slices that DO use the kernel are the only ones served from
store** — proof the F1 fix works, and simultaneously proof it was not the
bottleneck. Both facts come from the same table.

⚠ `savedAnalysis` is documented in its own header as *"one indexed read, no
provider call, no added latency."* It is taking 5.2 seconds and returning
`not_computed`. `decision_intelligence_runs` has `@@index([leagueId])`, so a
missing index is not the obvious explanation. **Not diagnosed further here** —
it is now the top latency item and deserves its own investigation, not a guess.

### ⚠ A SECOND FINDING: half the context slices are timing out

`matchup`, `roster`, `rankings` and `devy` each report **exactly 1500 ms** and
`ok=false`. An identical number across four independent providers is a timeout,
not four coincidences. **Four of the eight graded context slices are failing on
every build**, and the packet correctly reports them as `not_computed` gaps
rather than fabricating — the degradation machinery working exactly as designed,
around a problem nobody had measured.

### ⚠ Comparability caveat, stated because it bounds the conclusion

These numbers come from a **local dev server against the production database**.
Whether the original 5354/6178/5441 figures were taken the same way is **not
recorded** — `packet.ts` says only "on live leagues". A Next dev server is
materially slower than a production build, so the absolute comparison is weak.

**The per-slice ranking is not.** `savedAnalysis` and `leagueIntelligence`
dominating, and the kernel-backed slices being the only ones served warm, hold
regardless of environment — those are within-run comparisons.

**So: R0.3 is done, the ceiling is still exceeded, and the cause is named and is
not what this file predicted.**

---

### ✅ VERIFIED IN PRODUCTION — the kernel completed a round trip, 2026-09-02

Not a test double. Read directly from the production database.

| time (UTC) | what happened |
|---|---|
| 02:00:02 → 02:00:36 | `/api/cron/domain-os-refresh` wrote **400 rows** in 34s — 200 `draft/rules` + 200 `waiver/settings`, i.e. `LEAGUE_CAP` × 2 targets |
| 01:50 → 02:20 | `lineup/signal` + `lineup/warehouse` populated by **read-through on live traffic** — not the cron, which has lineup marked ineligible |
| **02:30 fire** | **`draft` and `waiver` UNCHANGED** — same 200 rows, same `last_write` to the millisecond |

🛑 **THE SECOND ROW IS THE ONE THAT MATTERS, AND IT WAS A SEPARATE CLAIM.**
"Writes land" and "reads find them" are different assertions, and the row count
proves only the first. A store that wrote perfectly and read nothing would show
a *growing* table and re-write all 400 every 30 minutes — indistinguishable from
health if you only count rows.

The 6h TTL made it falsifiable: entries written at 02:00 are 30 minutes old at
02:30, so `safeRead` must hit and the walk must skip. **It did.** `last_write`
frozen at `02:00:36.582` is the proof — had reads failed, it would read
`02:30:xx`.

**Measured saving on that walk:** without the cache all 48 daily fires derive 400
facts (~7 queries each, per `resolveCanonicalLeagueRules`). With a 6h TTL only 4
fires do, and 44 skip — **19,200 → 1,600 derives/day, ~92% less.**

⚠ **AND IT MADE ONE DOCUMENTED WASTE REAL.** Those 200 `draft/rules` rows are
written for `resolveNflRedraftDraftRuntime`, which has **zero callers** (G6).
Before today that cost nothing, because nothing was written. It is now genuine
work for nobody — which strengthens plan item 1.2a rather than weakening it: the
fact is *league* rules, misfiled in `draft-os`, and pointing it at the three
runtime resolvers that do have traffic would make those rows earn their keep.

⚠ **Not overclaimed:** `lineup` grew 7 → 10 rows with `last_write` moving, which
is a mix of new scope keys and legitimate re-derivation — `lineupSignalSource`
has a **30-minute** TTL and is *supposed* to expire between fires. Nothing about
the lineup rows is evidence either way, and they are not cited as such.

### F1 — the table exists

Owner applied §10.1. Verified via `information_schema.columns`: 10 columns,
correct types (`jsonb` for `facts`, `double precision` for `confidence`,
`timestamp` for `capturedAt`). **`prisma/schema.prisma` needed no change** — the
model was already correct at line 16182. That mismatch *was* the bug: the client
knew about a table the database did not have.

✅ **Migration history backfilled 2026-09-01** —
`prisma/migrations-pending/20260901220000_domain_os_facts/migration.sql`, SQL
byte-identical to what was applied. **Staged, not live**: it is in
`migrations-pending/`, not `migrations/`, per that directory's README.

⚠ **It is a THIRD case that README did not previously cover** and now does:
applied to production, but *not through Prisma*, so there is **no
`_prisma_migrations` row**. The seven Commissioner OS migrations match-and-skip
on a later `migrate deploy`; this one will **run**. That is safe only because
every statement is `IF NOT EXISTS` — the run is a no-op that succeeds and finally
writes the missing row. **The guards are what make it self-healing, not luck.**

### F2 — a failed write can no longer report success

| File | Change |
|---|---|
| `domain-os/store.ts` | `OsStore.write` returns `Promise<boolean>`. `safeWrite` returns `boolean`, reading anything other than `true` as failure. |
| `domain-os/feed.ts` | New `OsRefreshOutcome = 'written' \| 'unavailable' \| 'write_failed'`. `put()` returns `{ measured, persisted }`; `refresh()` reports `write_failed`. |
| `domain-os/index.ts` | Exports `OsRefreshOutcome` so a scheduler cannot re-declare the union and drop the third member. |
| `cron/domain-os-refresh/route.ts` | Counts `writeFailed` separately; **`status` now reports `partial`**; metadata carries it. The comment that wrongly claimed the `try/catch` covered store failures is corrected. |
| `__tests__/decision-os/domain-os.test.ts` | 5 new tests + 1 corrected assertion; `memoryStore` now affirms. |

#### Proved red before green, per **W5**

```
AssertionError: expected 'written' to be 'write_failed'   ×2
AssertionError: expected undefined to be false            ×1
```

**That first message is the production bug reproduced in a test.** Red: 3 failed
/ 15 passed. Green: 18/18, and **40/40 across all five domain-OS suites**.

Typecheck: **145 `error TS` lines against the 145 baseline** measured at today's
parent by another session, 59 KB of real output, no crash dump, no
`Cannot find module`. **Zero errors anywhere in the `domain-os` tree.**

#### 🛑 Two decisions inside F2 worth not re-litigating

1. **`safeWrite` reads `undefined` as FAILURE, not success.** A store that
   forgets to return is reported as not having persisted. Treating `undefined`
   as "probably fine" is the exact shape of the bug being fixed, and it would let
   the next unmigrated store go quiet the same way. The test double had to be
   updated to affirm — which is the mechanism working, not friction.
2. **`get()` deliberately ignores `persisted`.** On the read path a failed cache
   write is opportunistic: the caller already holds the fact and must still
   receive it. Only `refresh`, whose entire job is writing, reports the failure.
   A test pins both behaviours so a later tidy-up cannot collapse them.

⚠ **And the fix had a second half that is easy to miss.** Counting `writeFailed`
while the telemetry block still said `status: 'success'` would have left the
signal in a field nobody reads — the "seam with no consumer" pattern that let the
original bug live. A run where every write failed satisfied `r.failed === 0` and
reported success with `rowsWritten: N`. Both moved together.

---

## 0.3 ✅ R0.1 RESOLVED — what `vercel env ls` actually said

Run by the owner, 2026-09-01, against `cafeconchimmy/allfantasy-v2-main`.
**One claim confirmed, three corrected, three new findings.**

### ✅ CONFIRMED — G1 stands, and more firmly than before

**`DECISION_OS_GROUNDING_ENABLED` does not exist in Vercel at all** — not in
Production, not in Preview. Nor does any `DECISION_OS_FEED_*` kill switch.

**The Decision OS grounding packet has never run in either environment.** The
earlier finding was read from a committed file; it is now read from the control
plane. G1 is not an inference any more.

### ✅ CONFIRMED — the four engines really are live in production

`DECISION_OS_LINEUP_LIVE` · `WAIVER_LIVE` · `TRADE_LIVE` ·
`COMMISSIONER_HEALTH_LIVE` — all present in **Preview + Production**, alongside
their `_SHADOW` counterparts and six trade shadow variants. §1's two-pipeline
finding holds.

### 🛑 CORRECTED #1 — Fantasy OS sync: the flag IS set, and it still does not enable anything

`FANTASY_OS_EXEC_SYNC_LIVE` **exists in Preview + Production** (14d ago). I
previously reported it absent. That part was wrong — it is absent from the
*committed file*, which is not the same claim.

**But the correction does not change the conclusion, and the reason is worth
keeping.** The gate is a strict string comparison:

```ts
const liveEnabled = process.env.FANTASY_OS_EXEC_SYNC_LIVE === 'true'
```
`app/api/cron/fantasy-os-exec-sync/route.ts:51`

The dashboard shows this var as type **`Config`** with a base64/JSON-shaped
value (`eyJ…`, which decodes to a `{"v":"v2","c":…}` object), **not the literal
string `true`**. Anything other than exactly `'true'` leaves the collector off.

🛑 **This is the "check that cannot fail" pattern relocated into the control
plane, and it is worse there.** A flag that is *present* reads as *enabled* to
anyone looking at the dashboard, while the code sees a string that is not
`'true'` and silently no-ops. The cron fires every 30 minutes, reports success,
and syncs nothing.

⚠ **Two comments in the repo assert this flag "is unset"** —
`app/api/cron/import-players/route.ts:449` and
`lib/psychological-profiles/ProfileRefreshService.ts:140`. They are now stale in
their premise and accidentally right in their effect. Fix them when the flag is.

**The definitive test — no guessing.** The route returns a `reason` field when
the gate is closed:

```
reason: 'live sync disabled (set FANTASY_OS_EXEC_SYNC_LIVE=true to enable the rate-limited collector)'
```

Hit the cron endpoint with the `CRON_SECRET` bearer and read that field. If it
appears, the collector is off regardless of what the dashboard shows. **This is
R0.4 and it is a five-minute check that gates Import OS entirely.**

### 🛑 CORRECTED #2 — Commissioner OS can go live in PREVIEW today

`DECISION_OS_BASE_URL` and `DECISION_OS_API_KEY` exist in **Preview only** —
absent from Production. Also Preview-only:
`DECISION_OS_INTELLIGENCE_API_ENABLED`, `..._PROVIDER`,
`INTELLIGENCE_API_TEST_KEYS`, `DECISION_OS_DEBUG_TELEMETRY`.

**Better news than reported.** Production is demo-mode as stated, but **Preview
is already provisioned for live Commissioner OS** — which is exactly the
environment **W2** requires for owner testing. R5 can be validated on a preview
URL without touching production at all.

### 🛑 CORRECTED #3 — Draft OS is in SHADOW, not dead. 28% → 45%

I scored Draft OS at 28% on "no engine, sole consumer has zero callers." **Half
of that was wrong.** `DECISION_OS_DRAFT_SHADOW` exists in Preview + Production
and has a real production caller:

`app/api/draft/recommend/route.ts:144` runs `evaluateDraftShadow()` against the
live recommendation and emits `manager.draft.pick` parity — *"the FIRST
production caller of `lib/shared-services/draft`"*. There is also
`lib/draft-intelligence/draft-decision-engine.ts`.

**Draft OS is at the same shadow stage lineup, waiver and trade each passed
through before going live.** That is a materially different position from dead.

⚠ **What I said that remains true:** `draftRulesSource` — the *domain-os feed* —
is warmed by cron for `resolveNflRedraftDraftRuntime`, which genuinely has zero
callers. **Two different things share the name "Draft OS"**, and conflating them
is what produced the wrong score. The feed is orphaned; the decision path is
progressing.

**This changes the §6 recommendation:** fold the *rules source* into League OS as
planned, but **keep Draft as a decision domain** — it is converging, not dead.

### 🆕 THREE NEW FINDINGS

| Finding | Why it matters |
|---|---|
| **`TRADE_OS_VALIDATION_DATABASE_URL` + `_DIRECT_URL` exist** (Preview + Production) | A **separate validation database**. Directly relevant to **W1/W2** — there may already be a non-prod target for testing. Confirm what it points at before using it; a `.vercel.app` URL is not proof of a non-prod DB. |
| **VAPID keys present in Preview *and* Production** | Web push is fully provisioned. **R7's first transport needs no infrastructure work.** |
| **`AF_DISABLE_AI_LIVE_CALLS` / `AF_MOCK_AI_CACHE_FIRST` are set** | Read into `lib/db-first-mode.ts` — but its only six consumers are **draft-pool modules**. ⚠ **Neither flag gates Chimmy or any AI path.** `disableAiLiveCalls` is a dead switch: it reads as an AI kill and controls nothing. Worth retiring or wiring, but it does not affect R1. |

---

## 1. 🛑 The finding that reframes everything: there are TWO fact pipelines

This is the single most important structural fact in the codebase and nothing
names it.

```
PIPELINE A — "world"                          PIPELINE B — "domain-os feeds"
lib/decision-os/world/  (12 families)         lib/decision-os/{domain}-os/  (8 domains)
        │                                              │
        ▼                                              ▼
  4 DECISION ENGINES                            GROUNDING PACKET
  lineup · waiver · trade · commissioner-health  grounding/packet.ts
        │                                              │
        ▼                                              ▼
  ✅ LIVE IN PRODUCTION                          ⛔ NEVER RUN IN PRODUCTION
  (*_LIVE=true, 4 real routes)                   (flag unset · values dropped)
        │                                              │
        ▼                                              ▼
  ✅ USERS SEE THIS                              ❌ CHIMMY SEES NOTHING
```

**They share no code.** Verified: `lib/decision-os/world/` contains zero
references to `domain-os`, `OsFactSource` or `createOsFeed`. Twelve fact
families — ADP, injury, news, weather, matchup, performance, projection,
league-intel, schedule/bye, player metadata, redraft roster, assets — feed the
engines and **never reach the packet**.

### What that means in one sentence

**The half of the system that works does not feed Chimmy, and the half that
feeds Chimmy does not work.**

This is why the earlier audit found three cuts at the Chimmy seam and *also*
found four decision engines live in production. Both are true. They are
different pipelines.

⚠ **Do not "fix" this by merging them.** Pipeline A is live, load-bearing and
correct; a rewrite would put working production behaviour at risk to serve a
path that has never run. The fix is a **read-only bridge** — see §7 R2.

---

## 2. What OS systems exist — three lists that do not line up

The word "OS" names three different things in this codebase, and no document
says so. That mismatch is itself a defect.

### List 1 — The seven MARKETED OS's (what a user is shown)

`app/fantasy-os/FantasyOsGateway.tsx:20`, `GUIDED_SEQUENCE`:

| OS | Question it claims to answer | Routes to |
|---|---|---|
| Platform OS | *Where should I focus first?* | `/manager-hub` |
| Manager OS | *What should I do for my team?* | `/manager-hub` |
| Commissioner OS | *Is the league operating well?* | `/commissioner-hub` |
| League OS | *What is happening across the ecosystem?* | `/commissioner-hub` |
| Trade OS | *Where are the trade opportunities?* | `/commissioner-hub` |
| Waiver OS | *Which acquisition decision matters?* | `/manager-hub` |
| Draft OS | *What preparation is required?* | `/manager-hub` |

🛑 **These are navigation labels, not systems.** Seven names route to **two
pages**. Nothing behind this list is an engine.

### List 2 — The eight DOMAIN FEEDS (the kernel's own union)

`lib/decision-os/domain-os/types.ts`, `OsDomain`:

`lineup · waiver · trade · draft · league · value · projection · import`

### List 3 — The four DECISION ENGINES (what actually decides)

`lib/decision-os/{lineup,waiver,trade,commissioner-health}/` — each with the
full `world → rules → decision → outcome` shape plus shadow/parity.

**`commissioner-health` is in List 3 and in neither of the others.**
**`draft`, `league`, `value`, `projection`, `import` are in List 2 with no engine.**

### Plus three sibling modules that also carry the name

| Module | What it really is |
|---|---|
| `lib/commissioner-os/` | A **UI data layer**, 12 namespaces, that calls Decision OS over **HTTP** as if it were an external vendor. Not an engine. |
| `lib/fantasy-os/` | Sleeper/Fantrax **sync collector** + an "exec intelligence" reporting layer. Genuinely a producer. |
| `lib/sports-os/` | **Reporting** services (readiness, identity health, reconciliation). Not a feed, not an engine. |

---

## 3. The scorecard

Seven axes, scored per OS. Weighting: axes 1–3 (does it exist) = 40%,
axes 4–5 (is it fed and connected) = 30%, axes 6–7 (does it reach a human) = 30%.

| Axis | Question |
|---|---|
| **1 Feed** | Is there an `OsFactSource`? |
| **2 Kernel** | Registered in `domain-os`? |
| **3 Engine** | Is there a `world → rules → decision → outcome`? |
| **4 Cron** | Is it warmed on a schedule? |
| **5 Packet** | Does it reach `buildDecisionOsGroundingPacket`? |
| **6 Chimmy** | Does the fact reach the model? |
| **7 User** | Is there a working user-facing surface? |

### Producer / domain OS's

| OS | 1 Feed | 2 Kernel | 3 Engine | 4 Cron | 5 Packet | 6 Chimmy | 7 User | **%** |
|---|---|---|---|---|---|---|---|---|
| **League OS** | ✅ 1 src | ✅ | n/a¹ | ❌ 60s TTL² | ✅ | ✅ | ✅ 3 routes | **85%** |
| **Waiver OS** | ✅ 2 src | ✅ | ✅ full | ✅ warmed | ❌ | ❌ | ✅ live | **75%** |
| **Trade OS** | ✅ 2 src | ✅ | ✅ full | ❌ season key | ❌ | ⚠ partial³ | ✅ live | **73%** |
| **Lineup OS** | ✅ 2 src | ✅ | ✅ full | n/a⁴ | ❌ | ❌ | ✅ live | **70%** |
| **Projection OS** | ✅ 1 src | ✅ | n/a¹ | ⚠ writer only⁵ | ✅ | ⚠ dropped⁶ | ✅ | **68%** |
| **Import OS** | ✅ 1 src | ✅ | n/a¹ | ⚠ gated⁷ | ✅ | ⚠ dropped⁶ | ✅ | **63%** |
| **Player Value OS** | ⚠ 2 of 4⁸ | ✅ | n/a¹ | ❌ unscheduled | ⚠ 2 of 4 | ❌ | ⚠ other paths | **48%** |
| **Draft OS** | ✅ 1 src | ✅ | ⚠ shadow⁹ | ✅ warmed | ❌ | ❌ | ⚠ split⁹ | **45%** |
| **Manager Psychology OS** | ❌ no src¹⁰ | ❌ | ✅ engine¹¹ | ✅ refreshed | ❌ | ⚠ separate¹² | ✅ 2 pages | **65%** |

¹ Fact domain by design — it supplies facts, it does not decide. Not a gap.
² Ineligible: a 60s entry expires long before a 30-min cron fires. Read-through by nature.
³ `lib/chimmy-trade/pendingTradeDecisionGrounding.ts` exists — a separate path, not the packet.
⁴ Ineligible: user- and week-parameterised. Never a league fact.
⁵ `writeAfProjectionSnapshots` runs daily ✅; the *feed refresh* is unscheduled.
⁶ Assembled and graded, then serialized to the word `available` — see the audit's **G11**.
⁷ `/api/cron/fantasy-os-exec-sync` fires every 30 min, but the collector is gated on `FANTASY_OS_EXEC_SYNC_LIVE`, **absent from committed `.env.production`**.
⁸ Market ✅ + devy ✅. IDP and kicker have a built adapter and **no feed source and no packet slice**.
⁹ **Corrected 2026-09-01 — two different things share this name.** The *feed* (`draftRulesSource`) is warmed by cron for `resolveNflRedraftDraftRuntime`, which has zero callers (1.2b: no route). The *decision path* is live in shadow: `DECISION_OS_DRAFT_SHADOW` is set in Preview + Production and `app/api/draft/recommend/route.ts:144` runs `evaluateDraftShadow` and emits `manager.draft.pick` parity. See §0.3.
¹⁰ No `OsFactSource`, and **zero references to `psychological-profiles` anywhere in `lib/decision-os/`**. It is a fully-built system sitting outside the hub.
¹¹ 16 modules at `lib/psychological-profiles/`, **all 7 sports**, tables already migrated, 15 labels, 10 evidence types, evidence floor, viewer-scoped cross-league rollup.
¹² Reached by `/api/chat/chimmy` directly and by `chimmy-orchestration/tool-routing-map.ts` — a *separate* path, not the grounding packet.

### Interface and surface OS's

| OS | What it is | State | **%** |
|---|---|---|---|
| **Decision OS (hub)** | The kernel, packet, conclusiveness, flags, three-brain | Built; the packet has never run in prod | **65%** |
| **Commissioner OS (UI)** | 12 namespaces over an HTTP transport | **Default mode `demo`.** `DECISION_OS_BASE_URL` absent from committed prod env; `isLiveReady()` defaults `false`; 4 of 11 `live.ts` have real wiring | **35%** |
| **Fantasy OS** | Sync collector + exec intelligence + gateway | Gateway ✅ live. Collector gated off in committed prod env. Exec data self-labels **"Certified league portfolio (non-production)"** | **45%** |
| **Manager / Platform OS** | `managerCommandCenter.ts`, `platformOs.ts`, `userOs.ts` + mounted components | Real pages, real data | **70%** |
| **Sports OS** | Readiness / identity-health / reconciliation reporting | Reporting only, by design | **n/a** |
| **Chimmy (interface)** | 15 route dirs; `/api/chat/chimmy` canonical | Works — on the **old** grounding path | **60%** |

**Weighted whole-system: ~58% built.** The distribution matters more than the
number: **construction is ~85% done and connection is ~30% done.** Almost
nothing left is "write the engine"; almost everything left is "connect two
things that already exist".

---

## 4. What is user-facing and works today

### ✅ Works, real data, users see it

| Surface | Backed by | Evidence |
|---|---|---|
| Lineup decisions | Lineup engine | `/api/today/lineup-actions`, `DECISION_OS_LINEUP_LIVE=true` |
| Waiver decisions | Waiver engine | `/api/waiver-ai/engine`, `DECISION_OS_WAIVER_LIVE=true` |
| Trade decisions | Trade engine | `/api/redraft/trade-proposals`, `DECISION_OS_TRADE_LIVE=true` + 6 shadow surfaces |
| League health | Commissioner-health engine | `/api/league-health`, `..._HEALTH_LIVE=true` |
| `/manager-hub` | `ManagerCommandCenterSection` | Real portfolio |
| `/league/[id]` | LeaguePulse · ManagerDna · Recommendations · UserOs | Real; fetches `/api/decision-os/manager-intelligence` |
| `/commissioner-hub` | Commissioner hub health | Real league list + health |
| `/fantasy-os` | Gateway | Real portfolio, routes to the two hubs |
| Chimmy chat | `/api/chat/chimmy` | Works — on the **legacy** grounding packet |
| Runtime routes | League OS cached rules | roster-runtime, playoff-runtime, schedule |

### ⚠ Renders, but not on real data

| Surface | Why |
|---|---|
| **Commissioner OS 12 modules** | Default mode is `demo` (`DEFAULT_DATA_MODE = 'demo'`), switched by a **cookie**. Live needs `DECISION_OS_BASE_URL`, absent from committed prod env. |
| **Fantasy OS executive workspace** | Self-labels its source `Certified league portfolio (non-production)` and discloses an offseason sampling gap. Honest — and not production data. |
| **Chimmy + Decision OS packet** | Never runs (flag) and would render no values if it did (G11). |

### ❌ Built, reaches nobody

| Thing | Status |
|---|---|
| `resolveNflRedraftDraftRuntime` | Zero callers. Deliberately no route (1.2b). |
| `/api/chimmy` | A shim. Zero callers. Three docs wrongly call it preferred. |
| IDP + kicker value adapter | Built and tested. No feed, no slice, no consumer on the Chimmy path. |
| three-brain saved analysis | Assembled into the packet, then serialized away (G11). |
| `runThreeBrainAnalysis` orchestrator | Zero callers (the *managed* path is live and separate). |

---

## 5. Connection map — API / cron / Chimmy

| OS | Upstream source | Cron | Reaches Chimmy? |
|---|---|---|---|
| Import | Sleeper / Fantrax via `fantasy-os/sync/collector` | `fantasy-os-exec-sync` `*/30` ⚠ gated | Manifest only |
| Value · market | FantasyCalc → `PlayerValueSnapshot` | `adp-refresh` daily 10:00 UTC ✅ | ❌ never requested |
| Value · devy | CFBD → `DevyPlayer` | `import-players` `0 */6` ✅ | ❌ never requested |
| Value · IDP/kicker | League scoring (derived) | n/a — roster-scoped | ❌ no slice |
| Projection | `writeAfProjectionSnapshots` | `compute-projections` daily 07:50 ✅ | ⚠ requested, dropped |
| League | `resolveCanonicalLeagueRules` (Postgres) | ❌ read-through | ✅ requested, dropped |
| Lineup / Waiver / Trade | `world/*` + loaders | waiver only ✅ | ❌ |
| Draft | `resolveCanonicalLeagueRules` | ✅ warmed | ❌ |
| three-brain | DeepSeek ∥ Grok → OpenAI → Claude | `decision-os-intelligence-maintenance` `*/10` ✅ | ⚠ read, dropped |
| **Psychology** | `dw_transaction_facts` + draft/roster/standings (all 7 sports) | `fantasy-os-exec-sync` `*/30` ✅ via `refreshProfilesForExternalLeagues` | ⚠ **separate path**, not the packet |

**Every upstream provider is correctly wired and on a schedule.** Not one
producer is broken. **All ten failures are at the last two hops.**

---

## 6. What OS systems SHOULD exist — the recommendation

### The principle that resolves the three-list mismatch

**An OS is one of exactly two things. Name it, and the rest follows.**

- A **Fact OS** owns a class of truth and maintains it. It never decides.
- A **Decision domain** owns a class of question. It reads facts and decides.

A hub, a page and a nav label are **none of these** and must stop being called
an OS. That single rename removes most of the confusion in §2.

### Recommended set — 5 Fact OS + 5 Decision domains + 1 hub + 1 interface

#### Fact OS (feed Decision OS; never decide)

| # | OS | Owns | Change from today |
|---|---|---|---|
| F1 | **Import OS** | Sync freshness, parity, coverage, identity confidence | ✅ keep. Absorb `fantasy-os/sync`. |
| F2 | **League OS** | Rules, scoring, structure, schedule, bye | ✅ keep. **Absorb Draft OS's `rules` source** — the plan already found it is league rules, misfiled. |
| F3 | **Player Value OS** | **All four** producers: market · IDP · kicker · devy | ⚠ finish. 2 of 4 wired. |
| F4 | **Projection OS** | AF projections, canonical + rescore-at-read | ✅ keep. |
| F5 | 🆕 **Identity OS** | `PlayerIdentityMap` — resolution and its confidence | **NEW. See below.** |
| F6 | **Manager Psychology OS** | How each manager behaves — labels, scores, evidence, trajectory | ⚠ **Built but orphaned.** Bring it inside the hub. See §6.2. |

#### Decision domains (read facts, decide, explain)

| # | Domain | State |
|---|---|---|
| D1 | **Lineup** | ✅ engine live |
| D2 | **Waiver** | ✅ engine live |
| D3 | **Trade** | ✅ engine live |
| D4 | **Commissioner** | ✅ engine live (`commissioner-health`) |
| D5 | **Draft** | ⚠ **no engine.** Either build one or retire the name. |

#### The hub and the interface

- **Decision OS** — the only thing that assembles, grades and answers.
- **Chimmy** — the only AI interface (owner's **A4**).

### 🆕 The one OS that should exist and does not: **Identity OS**

**Recommended as the highest-value addition, and it is not a new idea — it is a
missing feed for a dependency everything already has.**

- `HUB_BUILD_PLAN.md` **D13** already names `PlayerIdentityMap` as the spine.
- Coverage was **measured**: NFL **80.4%**, NCAAF **24.2%** (§2.11).
- The packet already has an `unresolved_identity` gap reason — **with no
  producer**, exactly like `not_entitled` had none until 4.4 fixed it.
- The audit found a live case: a roster where all 27 players came back as
  `{ playerId: '6804', name: '6804' }` and **graded itself `conclusive: ok`**.

Every other OS silently depends on identity and none can report on it. That is
the definition of a missing Fact OS.

**Scope it small:** one source, one assertion (`resolutionConfidence` per
league), one packet slice. It does not resolve identities — `PlayerIdentityMap`
already does — it *reports how well resolution went*, so a decision can refuse
when it went badly.

### 6.2 Manager Psychology OS — the design, settled 2026-09-01

**It already exists and is better built than its absence from every plan
suggests.** 16 modules, all 7 sports, migrated tables, 15 labels, 10 evidence
types, an evidence floor, a viewer-scoped cross-league rollup with a real
privacy argument, 8 API routes, 2 user-facing pages, and a cron refresh.

**And it is invisible to Decision OS.** Zero references in `lib/decision-os/`.
That single fact is the whole gap.

#### Owner's answers — `P1…P7`, settled

| # | Question | Answer |
|---|---|---|
| **P1** | How much history | **Per-season snapshots + a trajectory.** Keep the cumulative row as the headline. Needs a new table — §10.2. |
| **P2** | What "biography" means | **Structured facts; Chimmy narrates at ask-time.** The engine emits labels, scores, evidence, trajectory; the prose is generated per question and never stored. |
| **P3** | League type | **Separate profile per (sport, format).** Dynasty and redraft are different people. Needs a `format` column — §10.2. |
| **P4** | Influence on recommendations | **Explanation and framing only.** The deterministic engine's recommendation is never changed by a behavioural inference. |
| **P5** | Whose psychology | **Self + opponents in leagues you share.** Keeps the existing intersection privacy model exactly as built. |
| **P6** | Evidence floor | **Strict — refuse below the floor and say why.** "Not enough history to read his waiver behaviour — 4 claims across 1 season." |
| **P7** | Cross-sport | **Per-sport profiles + a cross-sport read.** Traits that hold across sports are reported; ones that don't are flagged. |

#### 🛑 P2 and P4 together are what keep this safe

The temptation with a "biography" is to generate and store prose. Both answers
refuse it, and for the same reason as invariant **P3** in the architecture
freeze: *AI may explain, prioritise and communicate a deterministic decision; it
may never generate, replace or fabricate a fact.*

- **P2** — stored prose drifts from the data behind it and has no provenance. A
  biography written in March asserting "aggressive trader" survives a season in
  which the manager made no trades. **Facts are stored; narration is live.**
- **P4** — psychology changes *how a recommendation is explained*, never *what
  it is*. A behavioural inference must not be able to move a lineup call.

⚠ **P4 is a real constraint on ambition, and it is deliberate.** "Reranks,
never overrides" was on the table and was not chosen. If that changes later it
is a decision to make explicitly, not to drift into.

#### 🛑 P1 is the one that needs a schema change, and the reason is precise

Today `manager_psych_profiles` is `@@unique([leagueId, managerId])` — **one row,
overwritten on every refresh.** `BehaviorSignalAggregator.seasonThrough()` uses
`season: { lte: n }`, which is deliberately cumulative — its own comment
explains that a dynasty league carries picks under seasons 2021–2025, so exact
equality would return nothing.

**That is correct for a headline and useless for a trajectory.** There is no
stored record of what the profile said last season, so *"he was a rebuilder in
2023 and has been win-now since 2024"* is not merely unimplemented — it is
unanswerable from the data as stored. §10.2 adds the snapshot table.

#### ⚠ P5 and P7 must stay DERIVED, not precomputed

`CrossLeagueRollup` is **viewer-scoped** — it covers the intersection of leagues
the viewer and subject share. That answer is different for every viewer, so
**it cannot be precomputed into a table per subject.** The same applies to the
cross-sport read in P7.

Any attempt to cache these produces one of two failures: a per-viewer cache that
is almost always cold, or a per-subject cache that leaks behaviour from leagues
the viewer has no relationship with. **Neither is acceptable. They stay derived.**

#### What Decision OS gets

A `managerPsychology` slice on the grounding packet:

```
present · asOf · confidence · sampleSize
labels[]            15-term vocabulary, each with evidence count
scores{}            aggression · activity · tradeFrequency · waiverFocus · riskTolerance
trajectory[]        per-season, from the new snapshot table   (P1)
crossLeague         derived, viewer-scoped, shared leagues only (P5)
crossSport          derived, traits that hold vs traits that don't (P7)
conclusive          refuses below the evidence floor, with the sample size named (P6)
```

⚠ **The slice is graded like every other.** Below the floor it is
`present: false` with a `not_computed` gap naming the sample size — **never a
label asserted on thin evidence.** That is P6 expressed in the packet's existing
machinery rather than a new mechanism.

### ❌ What should NOT be an OS

Say these plainly, because each currently carries the name and shouldn't:

| Currently called | Should be | Why |
|---|---|---|
| **Platform OS** | A **view** | An aggregation of other OS's. Owns no facts. |
| **Manager OS** | A **view** | Same. `/manager-hub` is a page. |
| **Commissioner OS** (`lib/commissioner-os`) | A **UI data layer** | The *engine* is `decision-os/commissioner-health`. **Two different things share one name** — the most confusing collision in the tree. |
| **Sports OS** | A **reporting service** | Readiness dashboards. Not a feed. |
| **Fantasy OS** | A **gateway + collector** | Split it: the collector belongs to Import OS; the gateway is a page. |
| **Draft OS** (today) | Fold into League OS | Its only source is league rules and its only consumer has zero callers. |

**Net: 12 things called "OS" → 10 real OS's (5 fact + 5 decision), 1 hub, 1
interface, and 5 things renamed to what they are.**

### Can one OS handle several? Yes — three consolidations

1. **Draft OS → League OS.** Its `rules` source *is* league rules. Fold it,
   point it at the three runtime resolvers that have real traffic, and reopen
   "Draft" later as a decision domain if a draft engine is ever built.
2. **Value OS handles all four producers.** That was always the design —
   `CanonicalValue` exists so "Decision OS never learns there were four". Do not
   split IDP or kicker into their own OS; finish the one that exists.
3. **Fantasy OS sync → Import OS.** One ingestion story, not two.

**Do NOT consolidate:** Lineup, Waiver and Trade. They look similar and are not
— each has its own rules, its own world and its own live kill switch, and all
three are in production. Merging live engines to tidy a diagram is the worst
possible trade.

---

## 7. The road to 100%

Ordered by dependency. **R1–R3 are the whole first release**; they are
connection work, not construction. Milestones M0–M6 in
[`OS_FEED_STATE_2026-09-01.md`](./OS_FEED_STATE_2026-09-01.md) §6 remain the
detailed steps — this is the OS-level view of the same road.

### R0 — Settle the ground · *hours*

- **R0.1** `vercel env ls` — resolve every flag in this file against real
  production, not the committed file. **Four conclusions here flip if the
  dashboard sets them.**
- **R0.2** Confirm whether `domain_os_facts` exists in production.
- **R0.3** Re-measure the packet; prove the proof surface can go red first.

### R1 — Make Decision OS able to speak · *the unlock* → hub 65% → 85%

The audit's three cuts. **Nothing else matters until these land.**

- **R1.1** Render slice values in `serialize.ts` (**G11** — one function).
- **R1.2** Ask for the value lane: `want.values/devy` + `valueFormat` + `leagueIdpRules` (**G2**).
- **R1.3** Turn the flag on, after R0.3 is green (**G1**).

### R2 — Bridge Pipeline A into the packet · *the structural fix* → +4 OS's connected

**This is §1's answer and the highest-leverage work after R1.**

- **R2.1** A **read-only** adapter: the four live engines' decision objects →
  packet slices. `grounding/toEvidencePacket.ts` already does the inverse; this
  is its mirror.
- **R2.2** Lineup / Waiver / Trade / Commissioner each gain a packet slice.
  **Do not touch the engines.** They are live and correct.
- **R2.3** Chimmy explains the deterministic verdict (owner's **A5** — P3).

**Effect: Lineup 70→90 · Waiver 75→92 · Trade 73→90 · Commissioner-health →90.**

### R3 — Finish Player Value OS · 48% → 90%

- **R3.1** IDP + kicker roster-scoped slice, uncached (**A2**).
- **R3.2** Schedule the app-level value + projection sources (a *second* cron
  walk — the existing one walks leagues, these are keyed sport+format).
- **R3.3** The other three value questions: trade grade · roster holes ·
  cross-league exposure (**A8**).

### R4 — Identity OS · new → 80%

- **R4.1** Re-run the coverage audit for current figures.
- **R4.2** One source, one assertion, one packet slice.
- **R4.3** Give `unresolved_identity` a producer. Fix the
  `{ playerId: '6804', name: '6804' }` roster grading itself `ok`.

### R4b — Manager Psychology OS into the hub · 65% → 92%

**Highest ratio of value to remaining work in this document** — the engine is
built, tested, all-sport and already refreshed on a cron. What is missing is a
seam.

| Step | Work | SQL |
|---|---|---|
| **R4b.1** | `format` column + backfill from each league's settings (**P3**) | §10.2 (A) |
| **R4b.2** | `manager_psych_profile_seasons` + write a snapshot on each refresh (**P1**) | §10.2 (B) |
| **R4b.3** | `OsFactSource` → register `'psychology'` as an `OsDomain`. League-level, 12h TTL. **No migration** — `OsDomain` is `VarChar(16)` and widening the union is free. | — |
| **R4b.4** | `managerPsychology` packet slice, graded, refusing below the floor (**P6**) | — |
| **R4b.5** | Trajectory + cross-league + cross-sport reads, **derived not cached** (**P1/P5/P7**) | — |
| **R4b.6** | Chimmy narrates from the facts — **no stored prose** (**P2**) | — |
| **R4b.7** | Wire into recommendations as **framing only** (**P4**) | — |

⚠ **R4b.2 writes a snapshot going forward; it does not invent history.** The
first season of trajectory data appears after the first refresh that runs with
the table present. **A backfill is possible** from `dw_transaction_facts` and
`profile_evidence_records` (both carry timestamps) and is a separate,
explicitly-scoped task — not something to slip into the migration.

⚠ **R4b depends on R1** (the serializer must render values) and **R2** (the
bridge pattern). Doing it before R1 produces a slice that serializes to the word
`available`, which is the exact failure G11 documents.

### R5 — Decide Commissioner OS's future · 35% → 85%

**A product decision, not an engineering one.** The UI layer talks HTTP to a
Decision OS that lives *in the same process*.

- **Option A (recommended):** replace the HTTP transport with direct imports.
  Removes a network hop, an API key, a timeout and a whole class of failure.
- **Option B:** stand up the HTTP service and set `DECISION_OS_BASE_URL`.
  Justified only if Commissioner OS is going to be a separately deployed or
  third-party-facing product.

Then: default mode `demo` → `live`, and finish the 7 of 11 namespaces whose
`live.ts` is still an honest placeholder.

### R6 — Rename to the model in §6 · *cheap, high clarity*

Platform/Manager → views · Commissioner OS (UI) → distinguished from the engine
· Draft OS → folded into League OS · Fantasy OS split. **Docs and identifiers
only, no behaviour change.** Do it in one pass so the three lists become one.

### R7 — Proactive alerts (**A6**, **A11**) · *largest build, last*

Depends on R1 (facts must render) and R2 (engines must reach the packet).
One outbox, four transports, one fatigue budget enforced in the outbox.

### Deferred

Sleeper transactions (schedule the orchestrator **before** the fourth service) ·
B2B/B2C cohorts (blocked, `NOLOGIN`) · sports beyond NFL/NCAAF (**A3**).

---

## 8. The shape of the answer, in five lines

1. **~58% built** — but that splits as **~85% constructed, ~30% connected**.
2. **Every producer works and is on a schedule.** Not one is broken.
3. **Two fact pipelines exist and don't touch.** The live one doesn't feed
   Chimmy; the Chimmy one has never run.
4. **Four decision engines are already live in production.** That is the
   strongest asset in the system and it is invisible to Chimmy.
5. **R1 + R2 is the whole first release** — and it is connection work, not
   construction.

---

## 9. Task ledger

Updated **in the same change that does the work** (**W4**).
`✅ done · 🔄 in progress · ⏸ blocked · ⬜ not started`

### Audit and planning

| | Task | Notes |
|---|---|---|
| ✅ | Feed-seam audit | `OS_FEED_STATE_2026-09-01.md`. Found G1–G11. |
| ✅ | Identified the serializer defect (**G11**) | `serialize.ts` never reads `slice.value` — 0 occurrences. |
| ✅ | OS census across 7 axes | This file, §3. |
| ✅ | Found the two-pipeline split | §1. `world/` and `domain-os` share no code. |
| ✅ | Owner decisions **A1–A12** | `OS_FEED_STATE_2026-09-01.md` §5. |
| ✅ | Manager Psychology census + decisions **P1–P7** | §6.2. |
| ✅ | Working agreements **W1–W6** | §0. |
| ✅ | SQL handed over | §10. Three statements, none applied. |

### Build — nothing started

| | Task | Blocked on |
|---|---|---|
| ✅ | **R0.1** `vercel env ls` — resolve flags against real prod | **Done 2026-09-01.** G1 confirmed; 3 claims corrected; 3 new findings. §0.3 |
| ✅ | **R0.2** Confirm `domain_os_facts` exists in prod | **Done 2026-09-01. IT DOES NOT EXIST.** Every feed derives live; the refresh cron reports writes that never happen. §0.4 |
| ✅ | **R0.6** 🆕 **F1** — apply §10.1, create `domain_os_facts` | **Done 2026-09-01 by owner.** 10 columns verified via `information_schema`. The feeds can now actually warm. |
| ✅ | **R0.7** 🆕 **F2** — make the write outcome honest | **Done 2026-09-01.** §0.5. Proved red (`expected 'written' to be 'write_failed'`) → green. 40/40 across 5 suites; typecheck 145 = baseline, 0 in the changed tree. **Not pushed (W1).** |
| ✅ | **R0.3** Re-measure the packet | **Done 2026-09-02. Still 3983–5242 ms, over the ceiling.** Cause is `savedAnalysis` (5236 ms, failing) + `leagueIntelligence` (4636 ms) — **neither uses the kernel.** §0.6 refutes this file's own hypothesis. |
| ✅ | **R0.8** Diagnose `savedAnalysis` | **Done 2026-09-02. No query is slow — it is QUEUEING.** All ~120–150 ms of real work vs 5236 ms reported. Header's "one indexed read" is false; it is 4 steps. §0.7 |
| ✅ | **R0.10** Re-measure on a production build | **Done 2026-09-02. IT WAS THE DEV SERVER.** 1730–1782 ms vs a 3000 ms ceiling — **~1250 ms headroom.** Overturns three conclusions in this file. §0.8 |
| ✅ | **R0.9** Four context providers "timing out" | **Closed without work — dev artifact.** All four return `ok=true` in 566–1170 ms on production. §0.8 |
| ⏸ | **R0.11** Two round-trip cuts | **Deprioritised.** Justified by a latency problem that does not exist in production; would buy ~50 ms against 1250 ms of headroom. §0.8 |
| ⬜ | **R0.12** Bound the unbounded `findMany` in `loadImportedActivityEvidence` | Not a latency issue (188 rows here) but 42 leagues share 6,436 rows. §0.7 |
| ⬜ | **R0.13** 🆕 `savedAnalysis` returns `not_computed` | Now a **data** question (no run for current evidence), not latency. 1113 ms. §0.8 |
| ⬜ | **R0.9** 🆕 Four context providers timing out at exactly 1500 ms | `matchup` · `roster` · `rankings` · `devy` — half the graded context, failing every build. §0.6 |
| ⬜ | **R0.4** 🆕 Hit `/api/cron/fantasy-os-exec-sync`, read `reason` | **Gates Import OS.** 5 min. §0.3 |
| ⬜ | **R0.5** 🆕 Confirm what `TRADE_OS_VALIDATION_DATABASE_URL` points at | May already be the non-prod target for **W2** |
| ✅ | **R1.1** Render slice values (**G11**) | **Done 2026-09-02.** Proved red→green, 48/48. Also added `playerName` to the anonymous value contract, and fixed an arbitrary-element `asOf`. Typecheck blocked by a peer's mid-edit file. §0.9 |
| ⬜ | **R1.4** 🆕 Order the bounded rows by relevance | Bounding works; ordering is first-8. For "what is my WR worth" the right 8 are the asker's players. §0.9 |
| ✅ | **R1.2** Ask for the value lane (**G2**) | **Done 2026-09-02.** Gate was double-locked; packet now derives `valueFormat` + `leagueIdpRules` from rules it already loads. Red→green, 63/63. Typecheck deferred — machine contention. §0.10 |
| ⬜ | **R1.5** 🆕 Devy for C2C / devy-slot NFL dynasty leagues | The NCAAF sport test will not find them. §0.10 |
| ⬜ | **R1.3** Turn the grounding flag on (**G1**) | R1.2 |
| ⬜ | **R2** Bridge the 4 live engines into the packet | R1 |
| ⬜ | **R3** Finish Player Value OS | R1 |
| ⬜ | **R4** Identity OS | R1 |
| ⬜ | **R4b** Manager Psychology OS into the hub | R1, R2 |
| ⬜ | **R5** Commissioner OS transport decision | Owner |
| ⬜ | **R6** Rename pass | R1–R4 |
| ⬜ | **R7** Proactive alerts | R1, R2 |

---

## 10. SQL — handed over, not applied (**W3**)

**Three statements. None has been applied and none will be by an author.**
Apply them yourself, or stage them into `prisma/migrations-pending/` on request.

⚠ **Order matters.** §10.1 is independent. §10.2 (A) must run before (B) is
useful, and both are additive — every added column is nullable or defaulted, so
neither statement can fail on existing rows.

⚠ **After applying, update `prisma/schema.prisma` to match and re-run
`prisma generate`**, or the client will not expose the new fields. §10.2's
Prisma models are given so the schema and the SQL cannot drift.

### 10.1 `domain_os_facts` — the feed kernel's store

🛑 **This model is in `schema.prisma:16182` and has NO migration file anywhere.**
Added by `f539b4016`. Until it exists, `domain-os/store.ts` swallows every read
and write, so **every feed derives live on every call** and D5's "precomputed,
always warm" is not in effect. It is very likely the whole 5.4-second packet.

**Confirm it is actually absent before running this** (R0.2) — CI uses
`prisma db push`, so production may already have it.

```sql
CREATE TABLE IF NOT EXISTS "domain_os_facts" (
  "id"         TEXT NOT NULL,
  "domain"     VARCHAR(16)  NOT NULL,
  "kind"       VARCHAR(32)  NOT NULL,
  "level"      VARCHAR(8)   NOT NULL,
  "scopeKey"   VARCHAR(128) NOT NULL,
  "sport"      VARCHAR(16)  NOT NULL,
  "facts"      JSONB        NOT NULL,
  "confidence" DOUBLE PRECISION,
  "sampleSize" INTEGER,
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "domain_os_facts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "domain_os_facts_domain_kind_level_scopeKey_key"
  ON "domain_os_facts" ("domain", "kind", "level", "scopeKey");

CREATE INDEX IF NOT EXISTS "domain_os_facts_capturedAt_idx"
  ON "domain_os_facts" ("capturedAt");

CREATE INDEX IF NOT EXISTS "domain_os_facts_domain_level_idx"
  ON "domain_os_facts" ("domain", "level");
```

⚠ **`confidence` and `sampleSize` are nullable on purpose.** Null means *"the
producer does not express one"*, never zero. Zero-as-unknown is the exact defect
that made 85% of the devy board render as a confident "worthless".

### 10.2 Manager Psychology OS

#### (A) `format` on the existing profile table — **P3**

```sql
ALTER TABLE "manager_psych_profiles"
  ADD COLUMN IF NOT EXISTS "format" VARCHAR(24);

CREATE INDEX IF NOT EXISTS "manager_psych_profiles_managerId_sport_format_idx"
  ON "manager_psych_profiles" ("managerId", "sport", "format");
```

🛑 **Nullable, and the unique key is deliberately NOT widened.** A league has
exactly one format, so `(leagueId, managerId)` already yields one profile per
format — this column makes the format *queryable* so a cross-league read can
group by it. Widening the key would let one league hold two profiles for one
manager, which is wrong.

**NULL means "format not yet resolved"** — honest, and distinguishable from a
league genuinely having no format. Backfill separately (R4b.1).

Expected values: `dynasty · redraft · keeper · bestball · guillotine · devy`.
Deliberately not an enum: `LeagueSport` is one, and a new format then needs a
migration to be *namable*.

#### (B) Per-season snapshots — **P1**

```sql
CREATE TABLE IF NOT EXISTS "manager_psych_profile_seasons" (
  "id"                  TEXT NOT NULL,
  "leagueId"            VARCHAR(64)  NOT NULL,
  "managerId"           VARCHAR(128) NOT NULL,
  "sport"               VARCHAR(16)  NOT NULL,
  "format"              VARCHAR(24),
  "season"              INTEGER      NOT NULL,
  "profileLabels"       JSONB        NOT NULL DEFAULT '[]',
  "aggressionScore"     DOUBLE PRECISION NOT NULL DEFAULT 0,
  "activityScore"       DOUBLE PRECISION NOT NULL DEFAULT 0,
  "tradeFrequencyScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "waiverFocusScore"    DOUBLE PRECISION NOT NULL DEFAULT 0,
  "riskToleranceScore"  DOUBLE PRECISION NOT NULL DEFAULT 0,
  "sampleSize"          INTEGER      NOT NULL DEFAULT 0,
  "confidence"          DOUBLE PRECISION,
  "computedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "manager_psych_profile_seasons_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "manager_psych_profile_seasons_league_manager_season_key"
  ON "manager_psych_profile_seasons" ("leagueId", "managerId", "season");

CREATE INDEX IF NOT EXISTS "manager_psych_profile_seasons_manager_sport_season_idx"
  ON "manager_psych_profile_seasons" ("managerId", "sport", "season");

CREATE INDEX IF NOT EXISTS "manager_psych_profile_seasons_league_season_idx"
  ON "manager_psych_profile_seasons" ("leagueId", "season");
```

🛑 **A separate table, not a `season` column on the existing one.** The live
profile is the cumulative headline and stays exactly as it is — every one of its
current readers keeps working untouched. This table is history, written
alongside. Adding `season` to the existing table would change its unique key and
break `findUnique({ where: { leagueId_managerId } })`, which the engine and
several routes call.

⚠ **`sampleSize` is `NOT NULL DEFAULT 0` while `confidence` is nullable.** Not
an inconsistency: a snapshot always knows how many observations it drew on
(zero is a real answer), but confidence is only meaningful once the evidence
floor is cleared. **Null confidence = "below the floor, do not assert"**, which
is P6 enforced by the schema rather than by discipline.

⚠ **No foreign key to `manager_psych_profiles`.** A season snapshot outlives the
cumulative row — profiles are upserted and could be pruned, and history must not
cascade away with them.

#### Prisma models to match — add to `schema.prisma`

```prisma
model ManagerPsychProfileSeason {
  id                  String   @id @default(cuid())
  leagueId            String   @db.VarChar(64)
  managerId           String   @db.VarChar(128)
  sport               String   @db.VarChar(16)
  /// dynasty | redraft | keeper | bestball | guillotine | devy. Null = not yet resolved.
  format              String?  @db.VarChar(24)
  season              Int
  profileLabels       Json     @default("[]")
  aggressionScore     Float    @default(0)
  activityScore       Float    @default(0)
  tradeFrequencyScore Float    @default(0)
  waiverFocusScore    Float    @default(0)
  riskToleranceScore  Float    @default(0)
  /// Observations behind this snapshot. Zero is a real answer.
  sampleSize          Int      @default(0)
  /// Null = below the evidence floor. Never zero-as-unknown.
  confidence          Float?
  computedAt          DateTime @default(now())

  @@unique([leagueId, managerId, season])
  @@index([managerId, sport, season])
  @@index([leagueId, season])
  @@map("manager_psych_profile_seasons")
}
```

And on the existing `ManagerPsychProfile`, add one field:

```prisma
  /// dynasty | redraft | keeper | bestball | guillotine | devy. Null = not yet resolved.
  format              String?  @db.VarChar(24)
```
plus `@@index([managerId, sport, format])`.

### 10.3 No SQL needed for these

Stated so nobody goes looking:

| Work | Why no table |
|---|---|
| Registering `'psychology'` as an `OsDomain` | `DomainOsFacts.domain` is `VarChar(16)`; widening a TS union is free. |
| Cross-league and cross-sport reads | **Viewer-scoped — must stay derived.** Caching them either leaks or is always cold. See §6.2. |
| Identity OS | `PlayerIdentityMap` already exists. Identity OS reports on resolution quality; it stores nothing new. |
| The R2 engine bridge | Read-only adapter over decision objects the engines already produce. |
| Chimmy narration | **P2** — no stored prose, by design. |

---

## 11. Provenance

Read-only census of the working tree at `commish-os/phase-0-1b`, 2026-09-01.
No source modified. Method: per-OS census across seven axes using file reads,
symbol greps for every import form, `cron-schedule.json`, and the committed env
files.

⚠ **Not measured here:** production environment variables (Vercel dashboard),
production database state, and live latency after the packet's parallelisation.
All three are named as checks in R0 rather than assumed in the tables above.
