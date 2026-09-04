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

## 0.38 ✅ R1.5 — BUILT, AFTER BEING SCOPED AS A DEFER AND OVERRULED

**2026-09-03.** R1.5 says a C2C / devy-slot NFL dynasty league wants the devy board and the
`sport === 'NCAAF'` test will not find it.

🛑 **I SCOPED THIS AS A DEFER AND THE OWNER OVERRULED IT. THE OVERRULE WAS RIGHT.** My argument
was that the beneficiary population is zero, so no implementation cost was worth paying. What
that misses is that the defect is **latent, not absent**: the first devy league created would
have silently got nothing, and "correct before anyone needs it" is a defensible standard for a
one-hop change. Building it also surfaced **two real bugs** that a deferral would have left
sitting in the analysis instead of the code — see the end of this section. The measurement below
stands; the conclusion I drew from it did not.

### The board has data. The consumers do not exist.

```
DevyPlayer                              1,721 rows   (270 with stats)
NCAAF leagues                               1
devy_league_configs                         0
devy_leagues                                0
leagues with leagueVariant like '%devy%'    0
non-NCAAF leagues wanting devy              0
```

⚠ **AND MY FIRST MEASUREMENT WAS IN THE WRONG PLACE, WHICH IS THE PART WORTH KEEPING.** I first
counted `settings->>'devy_enabled'` and `settings->'devyConfig'` in the League JSON blob and got
16 leagues carrying a config. All 16 read `devy: false`, `devyConfig.enabled: false`, `slots:
null` — a default-off block, not a signal. The CANONICAL predicate is
`lib/devy/DevyLeagueConfig.ts::isDevyLeague`, and it reads neither of those: it checks a
`devy_league_configs` ROW, then falls back to `leagueVariant === 'devy_dynasty'`. Both are empty.
Same answer, but the first route to it was luck — **find the predicate the code already uses
before counting anything.**

### Every correct fix costs something, and nothing is free in scope

`want.devy` is decided by the ROUTE, at `app/api/chat/chimmy/route.ts:1713`, before the packet
runs. Measured: there is **no league object, no `leagueVariant`, and no awaited context carrying
either** anywhere before that line. So:

| option | cost |
|---|---|
| call `isDevyLeague` in the route | a DB round-trip per chat turn, **and** it delays the packet kick, since the grounding task is constructed synchronously |
| let the PACKET decide from rules it already loads | `canonicalLeagueRules` DOES carry `variant`, so the signal is free — but `devy` is kicked in the CONCURRENT WAVE, so gating it on rules makes it a serialized second hop like `idpKicker` |

⚠ **THE SECOND OPTION IS THE ARCHITECTURALLY RIGHT ONE** and matches what the route's own comment
already argues for `valueFormat`: derive it in the packet from rules already paid for, so there is
no second read and no second derivation to drift. It may even be free in wall-clock — `devy` is
not the packet's critical path, which is dominated by `savedAnalysis` — but that is a claim
requiring a production measurement, and measuring it for zero users is not worth the run.

### What was built — the free option, not the expensive one

`deriveWantsDevyBoard(rules)` reads `general.variant`, which `canonicalLeagueRules` already puts
in the rules the packet has paid for. `pWantsDevy` then gates the devy load:

```ts
const pWantsDevy = want.devy
  ? Promise.resolve(true)                              // caller asked — FULLY PARALLEL, no hop
  : pRules.then(deriveWantsDevyBoard).catch(() => false)
```

⚠ **THE NCAAF PATH IS BYTE-FOR-BYTE UNCHANGED**, which is the whole point of the promise rather
than an await — the same escape `args.valueFormat` gives the market lane. Only the case that
previously got NOTHING pays the hop off `pRules`, and it is the hop the market lane already pays
for the same reason. **A test asserts devy still loads when `pRules` REJECTS**, so that escape
cannot silently regress into a dependency.

It matches `DEVY_DYNASTY_VARIANT` exactly rather than a `/devy/i` substring, because
`isDevyLeague` compares against that constant and a loose test here would be a second definition
of one rule.

### 🛑 Two bugs the tests caught, and neither was visible in the analysis

1. **Gating the LOAD was not enough.** The first version chained the fetch off the rules and left
   the slice RESOLUTION reading `want.devy` — so a devy-variant league fetched the board and then
   threw it away as `not_requested`. The **wiring test** caught it; the predicate's own unit suite
   passed throughout. That is R1.4's lesson (§0.34) paying for itself one commit later.
2. **Conflating "should we load" with "does the board apply" broke an existing assertion.** A
   caller passing `want.devy` for a sport with no model must still read `no_producer`, not
   `not_computed` — the existing "does not claim it is merely cold" test. `devyBoardApplies` is
   now NCAAF **or variant-derived specifically**, never merely "the caller asked".

5 predicate tests + 4 wiring tests. Mutation-verified in both halves: reverting EITHER the load
gate or the resolution gate fails the end-to-end test, which is correct — either alone leaves the
feature broken, and that is exactly the shape of bug #1.

⚠ **THE POPULATION IS STILL ZERO.** This fixes a latent defect and buys nothing today. Recorded
plainly so the next reader does not mistake a green suite for a feature in use.

## 0.37 🛑 SCOPING `tradeDecision` — THE ANSWER IS DO NOT BUILD IT, AND I RECOMMENDED IT WRONGLY

**2026-09-03.** I proposed `tradeDecision` as the highest-value next build: the trade engine is
the biggest in the system at 22 files, trade questions are what people actually ask, and unlike
`waiverDecision` its blocker looked like it would not be a latency ruling. **Scoping it says
build nothing.** Recording the reasoning, because the conclusion is counter-intuitive and the
next person will have the same instinct I did.

### The engine needs a PERSISTED PROPOSAL, and there are none

`RunTradeEvaluateInput` takes a `proposal: TradeProposalContext`, and that type is not a
description of a hypothetical trade:

```ts
interface TradeProposalContext {
  proposalId: string          // required — a row that already exists
  proposerRosterId: string
  receiverRosterId: string
  status: string | null
  vetoMode: string | null
}
```

`proposalId` is required. The engine evaluates a trade that has been PROPOSED and stored — it
does not evaluate "should I trade X for Y" from a sentence.

The only table with that shape is `redraft_trade_proposals`. Measured in production:

```
redraft_trade_proposals     0 rows
trade_analysis_snapshots    1 row
```

### Both required inputs are empty, not one

⚠ **THE SNAPSHOT IS THE SECOND EMPTY INPUT, AND IT IS EASY TO MISS.**
`buildProductionTradeDecisionDeps(memo: TradeValueSnapshot)` is wrap-fidelity, and its own
comment is explicit that this is not a shadow-only limitation:

> *"The recommender is the persisted deterministic snapshot (`memo`) — fed wrap-fidelity. **For a
> non-shadow live run, the memo is still the authoritative captured snapshot.**"*

⚠ **THAT IS STRICTLY WORSE THAN WAIVER.** Waiver has `productionWaiverRecommend()`, an
independent recommender explicitly reserved "for a future live run". Trade has **no equivalent** —
there is no path that recomputes rather than reads a captured snapshot. So `tradeDecision` needs
two persisted rows, and both tables are empty.

### It is NOT an unfinished build — it is an unused one

The feature is complete end to end. Two writers
(`lib/trade-runtime/resolveNflRedraftTradeRuntime.ts:491` and
`app/api/redraft/trade-proposals/route.ts:163`), ten reader modules, a full engine, and an
existing grounding path. **Zero rows means nobody has proposed a trade through AllFantasy**, not
that something was left half-built.

🛑 **AND THE DARK PATH ALREADY EXISTS.** `lib/chimmy-trade/pendingTradeDecisionGrounding.ts`
reads that same empty table today. Building `tradeDecision` would be the **second** surface
pointed at it — the "migrate the read and wire the writer together, or not at all" failure from
`ingestCFBDStats`, committed knowingly this time.

### The 18,057 rows are real, and answer a different question

`LeagueTrade` holds **18,057** rows and `LeagueTradeHistory` **4,273** — but their columns
(`transactionId`, `tradeDate`, `playersGiven`, `valueGiven`, `analyzed`) are **completed** trades
imported from platforms. No pending status, no proposer/receiver semantics.

That is the shape of the imported portfolio: Sleeper dominates, and a Sleeper trade arrives
already DONE. "Was that trade fair" and "should I accept this" are different products, and only
the second is what the engine evaluates. The completed rows already feed
`manager_trade_tendencies` (481 rows), which works.

### Recommendation

**Do not build `tradeDecision`.** It would be correctly written and permanently absent.

Worth considering instead, in order:

1. **Nothing, and that is a real answer.** The engine is not broken and not wasted — it is live in
   shadow on the redraft trade path and will start producing the moment a proposal exists.
2. **A product question for the owner, not an engineering one:** should AllFantasy-native trade
   proposals exist for IMPORTED leagues? Today the writers are redraft-scoped while 225 Sleeper
   leagues cannot produce a proposal at all. That is the actual gap, and it is a product decision.
3. **If a trade fact in chat is the goal**, the honest cheap version is the `waiverDecision`
   treatment from §0.36's sibling commit — an opt-in slice that explains why it has nothing,
   pointing at the trade surface. Small, and it stops the silence without pretending.

⚠ **AND THE PROCESS LESSON, WHICH IS THE SAME ONE AS `waiverDecision`.** I estimated both from
the engine's SIZE and its apparent completeness, and was wrong both times in the same direction:
the blocker was never the engine, it was the INPUT the engine requires. Twenty-two files of
working code with two empty tables in front of it is worth less than a one-file producer with
data. **Check what feeds a thing before scoping the thing.**

## 0.28 THE INTENT ROUTER — R2/R3.1/R3.3/R4b.5's OPT-IN SLICES NOW GET ASKED FOR

**2026-09-03.** Closes the gap §0.26 found: the live chat route hardcoded
`want` to four always-on flags, so `lineupDecision`/`commissionerHealthDecision`
(R2), `idpKicker` (R3.1), `rosterValueGrade` (R3.3) and `psychologyConsistency`
(R4b.5) — all built, tested, wired into the packet — never reached a real
chat turn.

### Reused, not built: two intent classifiers already exist, one already runs in this exact route

`lib/chimmy-context/intent/IntentClassifier.ts` and `lib/chimmy-orchestration/
intent-classifier.ts` both export a function named `classifyChimmyIntent`,
with different vocabularies, for different purposes. Census: the
`chimmy-context` one has **zero real callers** anywhere in the tree. The
`chimmy-orchestration` one is **already called inside
`app/api/chat/chimmy/route.ts`** (line ~1789, for labelling the turn for
orchestration — an unrelated, pre-existing purpose) and its vocabulary
already includes `manager_psychology` and `player_value`, which the other
classifier's does not.

🛑 **THAT CALL HAPPENS AFTER THE PACKET IS ALREADY BUILT** (line ~1675 vs.
~1789), and reordering a 1800-line live route to share one call was more risk
than the fix needed. Solution: a SECOND, EARLY call to the same pure,
synchronous, no-I/O function, using only `message` — available since line
640 — rather than the fuller `recentUserSnippet` the later call also has.
Calling a regex-matching function twice costs microseconds; reordering
working code in a route this size does not need to be risked for that.

### One pure function, not inline conditionals in the route

`lib/decision-os/grounding/intentToWant.ts` — `deriveWantFromIntent(intent)`
— maps FOUR of the fourteen possible intents to the four low-risk opt-in
flags:

| Intent | Flag |
|---|---|
| `start_sit` | `lineupDecision` |
| `commissioner` | `commissionerHealthDecision` |
| `manager_psychology` | `psychologyConsistency` |
| `player_value` | `rosterValueGrade` |

⚠ **NOT SEVEN.** `waiver` maps to nothing — `waiverDecision` has no producer
anywhere in `packet.ts` (a type field only, matching R2.6's own "documented,
not wired" note for waiver alongside trade). `idpKicker` is deliberately
excluded despite being a real, wired producer: its own doc comment names it
"the one slice that cannot join the concurrent wave" — a serialized second
hop with its own cost profile — and turning it on for every player_value
question is a real latency decision needing its own measurement, not a rider
on this fix.

Extracted as its OWN pure function (no packet/route knowledge, just intent
in, four booleans out) specifically so it is unit-testable without mocking a
1800-line route handler — the route itself now does one thing:
`deriveWantFromIntent(classifyChimmyIntent(message).intent)`, spread into
the existing `want` object.

7 tests. One thing mutation-verified: swapping the `start_sit` mapping to
`waiver` fails exactly the two tests that check either intent's mapping,
none of the other five — including a structural guard asserting every
intent maps to at most one true flag, so a future accidental OR of two
conditions would be caught even without a test naming that exact pair.

## 0.27 R4b.7 — FRAMING ONLY, AND ALL OF R4b IS NOW DONE

**2026-09-03.** P4: "Explanation and framing only. The deterministic engine's
recommendation is never changed by a behavioural inference." Two additions,
both conditional instructions rather than data plumbing — there is nothing to
join, since a decision and a psychology fact are already independent slices
in the same context by the time either reaches a prompt.

### One general rule, not one per engine

`serializeDecisionOsGroundingForPrompt` gains a single instruction, appended
only when a decision (`lineupDecision`/`waiverDecision`/
`commissionerHealthDecision`) AND `managerPsychology` are BOTH present:
psychology may explain a decision, never re-argue it. 🛑 **Deliberately ONE
rule at the one place every decision and every psychology fact are already
combined, not wired per-engine.** `decisionBridge.ts`'s own header already
forbids touching the four live engines ("if a change here appears to need an
engine change, that is the signal to stop and re-scope"); a rule stated once
here covers all three today and whatever is bridged next without editing any
of them. Conditional, not standing — mutation-verified in both directions:
forced off fails exactly the one test asserting it appears; forced always-on
fails exactly the two tests asserting it does NOT pad an irrelevant prompt.

`pendingTradeDecisionGrounding.ts` gets the same policy restated in its own
existing RULES line, because — stated in its own file header — that block is
composed into the chat prompt SEPARATELY from the packet. A rule in one
surface does not reach a turn built from the other.

### ⚠ Correct, and immediately inert, for two independent reasons

Same honesty this session has applied to every finding today: neither
surface this connects psychology to currently fires with real data for a
real user.

- The packet's three decision slices are `want`-gated off in the one live
  chat route (§0.26's finding) — R2's own recommendations don't reach a
  prompt today, so there is nothing for this instruction to attach to there
  yet.
- `pendingTradeDecisionGrounding.ts` DOES reach the live route unconditionally
  — but its data source, `redraft_trade_proposals`, has zero rows in
  production (§0.23's R3.3 finding — real trades happen on Sleeper, not
  through this app's native trade builder).

Built anyway, for the same reason R3.3/R4b.5's opt-in slices were: correct
now means nothing to rebuild later, once either gap above is closed by
whoever scopes that separately.

### 🛑 A third, more severe gap found investigating this one — fixed same session, not deferred

Checking where `rosterValueGrade`/`psychologyConsistency` would need to sit
alongside a decision for R4b.7 to matter at all surfaced that
`serializeDecisionOsGroundingForPrompt` has its OWN local `slices` array,
separate from `packet.ts`'s array of the same name that feeds `packet.gaps`.
`idpKickerValues` (R3.1), `rosterValueGrade` (R3.3) and
`psychologyConsistency` (R4b.5) were never added to THIS one — so a present
reading with real data silently never rendered, while an absent one
correctly showed up as a gap. Backwards, unnoticed by three separate rounds
of mutation-verified producer tests (each tested its own producer in
isolation, never a full packet through this exact function), and — unlike
everything else recorded as "found, not fixed" today — **fixed immediately
and shipped as its own standalone commit**, because R3.3 was already live on
`main` at the time this was found, making it a real production gap rather
than queued work. See the commit itself
(`fix(decision-os): three slices never reached the prompt, only their gaps
did`) for the full account; not duplicated here.

24 tests across two files. Two things mutation-verified (in addition to the
serializer fix's own control): the conditional framing instruction in both
directions, and the trade-grounding rule addition (reverting it fails
exactly the one test that checks for it).
## 0.36 ✅ SCORECARD REFRESH — §3 WAS STALE IN THE OPTIMISTIC DIRECTION'S OPPOSITE

**2026-09-03.** §3 scored the system at **~58% built**, with the memorable split *"construction
~85%, connection ~30%"*. Three of its footnotes now describe a system that no longer exists,
and every one of them understated the truth. Re-measured rather than re-estimated.

### What was re-measured, and how

| axis | method |
|---|---|
| 1 Feed · 2 Kernel | enumerated every `OsFactSource` in `lib/decision-os/` — **13 sources** |
| 5 Packet | the slice fields on `DecisionOsGroundingPacket`, and the producer assignments at `packet.ts:1450-1455` |
| 6 Chimmy | the serializer's own slice list, compared field-by-field against the packet's |
| 4 Cron | **empirically, per §0.35's rule** — output tables, not config |
| 3 Engine · 7 User | ⚠ **carried forward unverified** from the original audit |

### The three stale footnotes

- **⁷ "Import OS collector gated off"** — **false.** §0.35 measured 35 successful syncs in two
  hours. The collector is live and Import OS is not gated.
- **¹⁰ "Manager Psychology has no `OsFactSource`, zero references in `lib/decision-os/`"** —
  **false since R4b.** `psychologyProfileSource` is registered, and the packet carries TWO
  psychology slices (`managerPsychology`, `psychologyConsistency`).
- **⁶ "assembled and graded, then serialized to the word `available`" (G11)** — **fully
  closed.** Every field on the packet type now appears in the serializer's list, including the
  three that silently did not until earlier today.

🛑 **AND ONE FOOTNOTE THE REFRESH CONFIRMS RATHER THAN RETIRES.** `waiverDecision` is a type
field (`packet.ts:240`) and a serializer entry (`serialize.ts:528`), and it is **absent from
the producer assignment block**. It is plumbed end to end and nothing fills it — so it renders
absent forever. That is the single clearest "built everything except the part that works" in
the system.

### Refreshed grid

⚠ **Scored on a STATED rule, because the original's arithmetic is not reproducible from its
own marks.** ✅ = full weight, ⚠ = half, ❌ = 0, n/a = excluded from the denominator; axes 1–3
weigh 13.33 each, axes 4–7 weigh 15 each. The marks are the measurement; the percentages are
derived and should be compared to each other, not to the old numbers.

| OS | 1 Feed | 2 Kernel | 3 Engine | 4 Cron | 5 Packet | 6 Chimmy | 7 User | **%** | was |
|---|---|---|---|---|---|---|---|---|---|
| **Manager Psychology OS** | ✅ | ✅ | ✅ | ✅ | ✅ ×2 | ✅ | ✅ | **100%** | 65% |
| **Import OS** | ✅ | ✅ | n/a | ✅ | ✅ | ✅ | ✅ | **100%** | 63% |
| **Lineup OS** | ✅ | ✅ | ✅ | n/a | ✅ | ✅ | ✅ | **100%** | 70% |
| **Projection OS** | ✅ | ✅ | n/a | ⚠ | ✅ | ✅ | ✅ | **91%** | 68% |
| **League OS** | ✅ | ✅ | n/a | ❌ | ✅ | ✅ | ✅ | **83%** | 85% |
| **Player Value OS** | ✅ | ✅ | n/a | ❌ | ✅ | ✅ | ⚠ | **74%** | 48% |
| **Waiver OS** | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | **70%** | 75% |
| **Trade OS** | ✅ | ✅ | ✅ | ❌ | ❌ | ⚠ | ✅ | **63%** | 73% |
| **Draft OS** | ✅ | ✅ | ⚠ | ✅ | ❌ | ❌ | ⚠ | **56%** | 45% |

**Producer mean: ~82%**, against the original's ~58% whole-system figure.

### Interface OS's — two more stale lines

- **Decision OS (hub)** — *"the packet has never run in prod"* is **false**; §0.11 analysed a
  live production packet run, which is where R1.4 and R1.6 came from.
- **Fantasy OS** — *"collector gated off in committed prod env"* is the same disproven claim
  as footnote 7.
- **Chimmy** — *"works, on the OLD grounding path"* is now wrong: the intent router wires the
  opt-in slices into the live chat route.
- **Commissioner OS (35%)** — ⚠ **UNCHANGED and now the clear floor.** Default mode `demo`,
  `isLiveReady()` false, `DECISION_OS_BASE_URL` present only in `.env.local`. That is **R5**,
  an owner transport decision.

### What the refresh actually changes about priorities

The old headline — *construction 85%, connection 30%* — **is no longer the shape of the
problem.** Connection is now the majority of what works: 6 of 9 producer OS's reach Chimmy
through the packet.

What remains is narrower and more specific than "connect everything":

1. **`waiverDecision` has no producer.** One missing function; everything else exists.
2. **Trade OS reaches Chimmy only by a side path** (`pendingTradeDecisionGrounding`) whose
   table, `redraft_trade_proposals`, is **0 rows in production**.
3. **Commissioner OS is a transport decision, not code** — R5, and it is the lowest score by a
   wide margin.
4. **Draft OS's feed warms a runtime with zero callers**, per the original's footnote 9 — the
   one place where "built and connected to nothing" still holds after today.

## 0.35 ✅ R0.4 + R0.5 — AND R0.4 REFUTES §0.3'S HEADLINE

**2026-09-03.** Both answered by measurement, neither by the probe each asked for.

### R0.4 — the collector IS live. §0.3 said it was off.

§0.3 concluded the collector was disabled because the Vercel dashboard showed
`FANTASY_OS_EXEC_SYNC_LIVE` as a base64 `Config` value rather than the literal string
`true`, and the gate is a strict `=== 'true'`. It asked for a five-minute probe: hit the cron
endpoint with the `CRON_SECRET` bearer and look for the disabled `reason`.

**That probe is unnecessary, and the conclusion it was meant to confirm is wrong.** Measured
against `league_sync_state`:

```
attempted in last 2h   38
succeeded in last 2h   35
newest success         09-03 23:12:51   (81 seconds before the reading)
```

The route returns the disabled `reason` and performs **no sync at all** unless the gate
passes. Successful syncs are landing every few minutes, so the gate passes and the value IS
`'true'`. **Import OS is not gated by this.**

⚠ **TWO REASONS §0.3 WAS WRONG, AND BOTH ARE ALREADY IN THIS FILE.** §0.13 records that §0.3
read the **dead Vercel project**; and production has since moved to Railway, so a Vercel
dashboard value describes neither the old nor the current deploy. A conclusion drawn from an
env-var *display* survived two platform corrections without being re-checked.

🛑 **THE RULE THIS VINDICATES: JUDGE A JOB BY ITS OUTPUT TABLES, NOT BY ITS CONFIG.** A cron
can return 200 and do nothing; an env var can be unreadable, stale, or read off the wrong
project. `max(lastSuccessfulSyncAt)` cannot lie about whether work happened. It is also
cheaper than the probe, and — unlike hitting a live cron endpoint — it has no side effect on
production.

### R0.5 — a real second database, but a DEAD one

```
TRADE_OS_VALIDATION_DATABASE_URL   ep-hidden-block-ad77fprp …  db mydb_shadow
production DATABASE_URL            ep-curly-block-ad0dlt9o  …  db neondb
```

Different endpoint AND different database name, so §0.3's hope was reasonable — but it
**cannot serve as the W2 non-prod target**, because the endpoint does not exist.
`docs/redraft/PHASE_NEXT_BASELINE_AND_PATH_DECISION.md` already recorded it as stale, matching
no live compute endpoint across the account's five Neon projects, and §0.18's own census found
**exactly one** active endpoint in the All Fantasy project. Two independent measurements, one
of them from another session, agreeing.

⚠ **AND `mydb_shadow` IS A NAME TO BE WARY OF EVEN IF IT WERE ALIVE.** That is Prisma's shadow
-database convention, and a shadow database is **dropped and recreated** by `prisma migrate
dev`. Pointing a test suite at one would work until the next migration silently wiped it.
`schema.prisma` declares no `shadowDatabaseUrl`, and **zero code reads either variable** — so
today it is provisioned, dead, and unused.

**W2 still needs a non-prod database.** This was the most promising candidate on the list and
it is not one; that is a real answer, not a deferral.

## 0.34 ✅ R1.4 — THE BOUNDED ROWS ARE THE ASKER'S PLAYERS

**2026-09-03.** §0.9 measured it on a live packet: *"the 8 rendered rows are arbitrary —
first-8, not the user's roster and not top-ranked. Bounding is correct; ordering is not
solved. For 'what is my WR worth' the right 8 are the asker's players."*

A value feed carries hundreds of players. `slice(0, 8)` answers a question nobody asked, and
the asker's own players were reaching the prompt only by luck.

### Fixed

- `rosterPlayerKeys` reads the packet's OWN `roster` slice — **starters and bench**, because a
  bench player is still the asker's — into match keys. Ids compare as-is; names are lowercased
  and stripped of punctuation, so `T.J. Hockenson` matches `TJ Hockenson`.
- `orderByRosterRelevance` puts those rows first.

⚠ **A STABLE PARTITION, NOT A SORT.** The producer's relative order survives inside each
group, so a feed already emitting by descending value keeps that ordering among the promoted
rows — and the same packet always renders the same text, which a comparator on floats would
not guarantee.

⚠ **NOTHING IS DROPPED OR DEDUPED.** Every element survives and only the order changes, so
the caller's `hidden` count stays exact.

⚠ **A NO-OP WHEN IT CANNOT HELP.** No roster, an empty roster, or a list whose rows carry no
recognisable player key all return the input untouched — a slice this cannot reason about
renders exactly as it did before.

🛑 **AND THE PROMPT NOW SAYS WHICH EIGHT THESE ARE.** Showing the asker's own players without
saying so invites *"the top players are …"* — a roster-scoped sample read as a ranked one,
which is a worse failure than the arbitrary ordering it replaces. The hidden-count line gains
`your own players are listed first, NOT the highest-valued` only when a promotion actually
happened; the unordered case keeps its original wording verbatim.

11 tests, mutation-verified: making the reorder a passthrough fails exactly the 3
promotion/ordering tests and leaves the other 8 passing, including every no-op guard and the
never-drops check.

⚠ **WHAT THIS DOES NOT DO.** It does not rank by VALUE. "Top 8 by market value" is a
different question from "my 8", and answering it would need the producer's own ordering
contract rather than a roster lookup. Recorded rather than assumed — today the promoted rows
keep whatever order the producer emitted.

## 0.33 ✅ R1.6 — EIGHT IDENTICAL GAP LINES BECOME ONE

**2026-09-03.** §0.11 measured a live packet carrying **ten gap lines, eight of them
identical**: every context slice reporting the same `teams_rosters did not finish syncing`.
Each line was correct. The repetition is the defect — a prompt that says one sentence eight
times teaches a reader to skim the gap block, which is exactly how the one gap that matters
gets missed, and it spends context on redundancy the model cannot use.

### Fixed

`collapseGapsByCause` in `serialize.ts` groups gaps by their shared cause and renders one
line naming every fact they block:

```
- teams_rosters did not finish syncing. Affects 8 facts: rosters, matchup, … Fix: …
```

A single-slice gap renders exactly as before, so the common case is untouched.

🛑 **GROUPED ON THE WHOLE CAUSE — reason, detail AND remedy — NOT ON `detail` ALONE.** Two
slices blocked for genuinely different reasons can phrase `detail` identically, and merging
those would attach one slice's remedy to another slice's problem: **a confidently wrong fix,
which is worse than a repetitive right one.** Two tests pin it.

⚠ **NOTHING IS DROPPED.** Every slice name survives into the collapsed line, because "which
facts must I decline on" is the entire job of that block. This shortens the prompt without
removing anything from it.

⚠ **PRESENTATION ONLY.** `packet.gaps` keeps one entry per slice: it is a data structure
other consumers read — `groundingToEvidence` builds `missingInformation` from it — and
flattening it there would change what those callers see. A presentation problem belongs in
the presentation layer.

⚠ The group key is `JSON.stringify([reason, detail, remedy])`, not a joined string: a
separator character can appear inside a detail or remedy and silently merge two distinct
causes. Pinned by its own test.

10 tests, mutation-verified: making the key include the slice — so it never groups — fails
exactly the 3 grouping tests and leaves the other 7 passing, including every non-merge
guard.

⚠ **R1.7 IS UNCHANGED AND STILL OPEN.** This makes the report readable; it does not make
`teams_rosters` sync. The eight slices are still inconclusive for a real reason, and §0.11's
third finding stands.

## 0.32 🛑 BUG-3 IS NOT A DUPLICATE-ROW BUG — 23 USERS SEE A BLANK WHERE DATA EXISTS

**2026-09-03.** Third filed bug this session whose premise does not survive measurement,
after BUG-4 (§0.29) and BUG-2 (§0.30).

### Both halves of the filed claim are wrong

BUG-3 reads *"Duplicate league rows share one `platformLeagueId` … A fuzzy name-match
decides which a user gets."*

- **They are not duplicates.** A `League` row is **per importing USER**, by design, and
  `enumerate.ts` says so in its own header: *"Multiple `League` rows (one per importing
  user) can mirror the same external league+season."* The cited league has **three** rows
  (BUG-3 says two) with three **different `userId`s**, each carrying a full 12 rosters, 12
  teams and the same **960 draft facts**. Nothing is corrupt.
- **No fuzzy name-match serves them.** A user's leagues resolve by `userId`. Every
  name-matching query in the tree is search, admin or discovery — not the serving path.

Scope, measured across production: **240 external leagues, 23 of them mirrored**, max 3
mirrors.

### The real defect

Profiling is keyed on the League **row**, so the second and third importer get nothing
until the profiler's own rotation reaches their row — while byte-identical profiles for the
same twelve managers already exist on a sibling.

| | leagues |
|---|---|
| mirrored | 23 |
| **mirrored with ASYMMETRIC psych coverage** | **19** |
| mirrored, all rows profiled | 2 |
| mirrored, no row profiled | 2 |

**23 users are currently served a blank where identical data exists.**

⚠ **NOT the unscheduled-writer trap.** `refreshStaleLeagueProfiles({ maxLeagues: 3 })` IS
scheduled, from `/api/cron/import-players`, and it sorts never-profiled first. The backlog
is real but draining — 223 candidates, 125 ever profiled, 103 never, ~24 profile writes a
day. The waiting is the problem, not a dead cron.

### Fixed — read-side only

`listProfilesByLeague` and `getProfileByLeagueAndManager` fall back to the **freshest**
profiled sibling of the same `(platform, platformLeagueId, season)`, tagging the result
`servedFromSiblingLeagueId` so the substitution is visible rather than silent — the same
honesty `servedFrom` carries in the grounding packet.

- **Nothing is merged, deduped or deleted.** The mirror rows are correct and stay. This is
  explicitly *not* a dedupe and must not become one.
- **No new data is exposed.** A profile is keyed on the **platform** manager id, identical
  across mirrors, and describes the league's managers — not the importing user. Matching
  requires the same platform, external id AND season.
- **Only on a completely empty result.** Topping up a partial answer would blend two
  profiling runs with no way to tell which manager came from where.

10 tests, mutation-verified: disabling the resolver fails exactly the 5 fallback-dependent
tests and leaves the other 5 passing, including the never-top-up guard.

### ⚠ A test-harness trap that made the control lie, worth keeping

The first mutation run failed **9 of 10** tests when only 5 should have — which reads as a
*stronger* control and is in fact a broken one.

`vi.clearAllMocks()` clears recorded CALLS but leaves the `mockResolvedValueOnce` queue
intact. These tests queue two `Once` values (own row, then sibling); with the fallback
working both are consumed and nothing leaks. Disable the fallback and the second value
survives into the **next** test, which then fails on a row it never mocked. Four of the nine
failures were that leak, not the mutation.

`vi.resetAllMocks()` restores the precise 5-of-10 split. **A mutation control that fails
MORE than expected is as suspect as one that fails less** — the same rule this file already
applies to a typecheck that reports cleaner than baseline.

## 0.31 🛑 87% OF THE PORTFOLIO WAS NEVER ENUMERATED — `take: 25` ON A FIXED SORT

**2026-09-03.** The real cause behind §0.30, found by asking why a league 39 hours stale was
not "due". It was due. It was never **asked about**.

### Measured

`app/api/cron/fantasy-os-exec-sync` defaults to `limit = 25` **per provider**, and
`enumerateConnectedLeagues` applied that as `take: 25` **inside the Prisma query**, under a
fixed `[season desc, platform asc, platformLeagueId asc]` sort. Same 25 rows, every tick,
forever:

| enumeration band | leagues | synced in 24 h |
|---|---|---|
| first 25 by that sort | 25 | **25 — 100%** |
| rank 26+ | 170 | **2 — 1.2%** |

The two in the tail are manual refreshes, which bypass enumeration entirely.

🛑 **THE OLD COMMENT ON THAT `orderBy` NAMED THIS EXACT FAILURE AND ASSERTED IT COULD NOT
HAPPEN** — *"a fixed order would refresh the head of the list forever and never reach the
tail … The cadence check is what rotates the portfolio."* It cannot. `take` runs in the
DATABASE, so the per-league cadence check only ever saw the already-truncated 25: it could
skip members of a fixed set, never change the set. Meanwhile the heartbeat reported a
healthy 25/25 every tick — a green check measuring a fifth of the thing it claimed to
cover.

### Fixed — a reorder, not a bigger batch

`take` is gone from the query; `selectStalestFirst` picks the batch **after** enumeration:
never-attempted leagues first, then oldest `lastAttemptedSyncAt`, ties broken by the old
stable order so the result stays deterministic.

⚠ **PROVIDER LOAD IS UNCHANGED.** The same `limit` leagues are fetched per tick — they are
simply the ones that need it. A ~195-league portfolio now cycles completely in ~8 ticks
instead of never reaching league 26. Raising `limit` is a separate decision this does not
require.

Two deliberate choices, both recorded in the code:

- **Orders on `lastAttemptedSyncAt`, never `lastSuccessfulSyncAt`.** Ordering by success
  would pin a permanently failing league to the head of every tick forever — the same
  starvation with a different victim. Attempt time advances whether or not the sync
  succeeds, so a failing league yields its slot after one try.
- **Never consults `syncStatus`.** A league in `partial`/`failed` is precisely the one that
  most needs re-attempting.

10 tests, mutation-verified: bypassing the sort (slice in base order = the old behaviour)
fails exactly the 5 ordering tests — including "the whole portfolio is reachable across
successive ticks", which is the 87% bug stated directly — while limit-capping, the two
unbounded paths, dedup and tie-stability correctly keep passing.

⚠ The bounded path costs one extra indexed `leagueSyncState.findMany`. The unbounded path
and the case where the portfolio already fits inside `limit` short-circuit before it, so
existing callers issue no additional query.

## 0.30 🛑 BUG-2 IS OVER. THE DAMAGE IS NOT — 37 LEAGUES HAVE BEEN FROZEN FOR 39 HOURS

**2026-09-03, measured read-only against production.** §0.18 calls BUG-2 *"LIVE and
ongoing since 05:00 2026-09-02"*. It is not live. It was a **17-minute incident**, and
what it left behind is a different and still-open bug.

### The incident is closed

```
first read-only error   2026-09-02 05:00:21
last  read-only error   2026-09-02 05:17:47      <- 17m 26s, and nothing since
newest sync row         2026-09-03 20:14:43      <- the collector is running normally
```

Zero read-only failures in the ~39 hours since. §0.18's "46 of 184" now reads 35.

⚠ **READ TIMESTAMPS AS TEXT WHEN MEASURING THIS TABLE.** `scripts/db-readonly-probe.mjs`
serializes a timestamp through a JS `Date`, and this machine is EDT, so every ISO string
it prints is **+4 hours**. That is how a first read of this data put the incident at
09:00 and made the newest row look 3.5 hours in the FUTURE. `to_char(...)` removes it and
restores agreement with §0.18's 05:00 onset. Aggregates computed in SQL
(`now() - "updatedAt"`) were never affected — only the displayed strings.

### What is still broken: a league that fails once is never retried

| `syncStatus` | rows | synced in last 24h |
|---|---|---|
| `completed` | 144 | 27 |
| `partial` | 33 | **0** |
| `failed` | 4 | **0** |

**Not one league in `partial` or `failed` has been re-attempted** — in either half of the
enumeration order, with `consecutiveFailures = 1` and `lastAttemptedSyncAt` frozen at
`2026-09-02 05:01`. At the documented 30-minute cadence that is roughly **78 consecutive
missed opportunities**, so it is a rule, not a coincidence.

⚠ **THE ROOT CAUSE NAMED BELOW IS SUPERSEDED BY §0.31, AND THE CORRECTION MATTERS.** This
section reads the correlation as "a failed league is never retried" — status-gated. It is
not. `syncConnectedLeague` never consults `syncStatus` at all; it compares
`lastAttemptedSyncAt` against the cadence, and 39 hours is due under any cadence. The 37
frozen leagues were simply never **enumerated**: they sit past the `take: 25` cutoff, which
is a portfolio-wide starvation affecting **170 leagues**, not a retry rule affecting 37.
`syncStatus` correlated only because the incident struck leagues that were already in the
starved tail.

Ruled out by measurement, not by reasoning:

| hypothesis | verdict |
|---|---|
| Orphaned sync rows (no League to enumerate) | ❌ **0 orphaned** — all 35 join to a live League row |
| Enumeration order starvation (`take` on a fixed sort) | ❌ the stuck ids **interleave** the healthy range; the 27 synced span ranks 1–109 of 181 |
| Season-state gating | ❌ **every** league is `preseason` — uniform, explains nothing |
| A wedged lock | ❌ all 20 lock rows are **expired**, and the lock steals expired leases |

The discriminator is `syncStatus` and nothing else.

### 🆕 20 orphaned lock rows, and they date the incident exactly

`automation_locks` holds **20 rows, all sleeper, all expired, none cleaned up in 39
hours** — `createdAt` **09-02 05:00**, the incident minute; newest expiry 05:23. The
release path never ran, which is what a read-only transaction rejecting the DELETE looks
like. They are harmless (expired leases are stolen) but they are a permanent fingerprint
of the incident and nothing prunes them.

### 🛑 The product tells those users something false

§0.18 already records that the serializer emits *"It retries automatically on the next
sync; a manual refresh will also pick it up"*. The first clause is **not true** for a
league in `partial` or `failed` — it has not retried in 39 hours and there is no evidence
it ever will. `lib/fantasy-os/sync/collector/manualRefresh.ts` exists specifically to
"bypass the cadence gate", so the second clause is the only working remedy.

Either the scheduler should retry these or the message should stop promising it does.
**Deliberately not fixed here:** changing retry semantics for 37 leagues at once is a
provider-load decision (Sleeper rate limits) and an owner call, not a unilateral one.

### What this changes

- BUG-2 should be **re-triaged from "live, ongoing, top priority" to "closed incident,
  open aftermath"**. The investigation §0.18 asks for — what deployed at 05:00 — is now
  forensic rather than urgent.
- The urgent item is the **retry gap**, which is not platform-specific and would freeze
  leagues again after any future transient failure.
- **20% of the imported portfolio is serving data frozen at 2026-09-02 04:01.**

## 0.29 🛑 BUG-4 IS NOT A DYNASTY BUG — IT IS A KEEPER BUG, AND THE FILED PREMISE IS WRONG

**2026-09-03.** BUG-4 reads *"`isDynasty` false on a league the owner says is dynasty …
the import is not capturing dynasty status … dynasty/redraft pricing is untrustworthy
until fixed."* Measured against production, **every clause of that is wrong except the
observation that `isDynasty` is false.**

### What the data says

Sleeper's own payload for the league BUG-4 was filed against
(`1335730625293844480`, *King Gingerbeards SF 2026!!!*):

```
settings.type      1      (0 = redraft, 1 = KEEPER, 2 = dynasty)
max_keepers        2
taxi_slots         0
```

**It is a keeper league, not a dynasty league.** `isDynasty: false` is the CORRECT value,
and the import computed it correctly from `type === 2`.

**Dynasty capture is not broken.** Across all 225 imported Sleeper leagues:

| `leagueType` | rows | `isDynasty = true` |
|---|---|---|
| dynasty | 110 | **110** |
| redraft | 100 | 0 |
| guillotine | 12 | 0 |
| zombie | 2 | 0 |
| survivor | 1 | 0 |

The two fields agree on **every single row**. There is no league with
`leagueType='redraft'` and `isDynasty=true`.

⚠ **THAT ALSO RETIRES A HAZARD `lib/league-runtime/leagueFormat.ts` DOCUMENTS IN ITS OWN
HEADER**, which cites BUG-4 and warns that such leagues "resolve to `'redraft'` with
`isDynasty` silently discarded". Zero rows are in that state. The comment describes a
reachable code path, not an occurring one, and should say so.

### The real defect, which nobody had filed

**A keeper league is indistinguishable from a redraft league, end to end.**

`settings.type` is the only signal that separates them, and it **reaches the database
nowhere** — absent from the stored settings blob on **225/225** rows, because the blob is
rebuilt from the import mapper's output rather than from Sleeper's raw payload.

Consequence, and it is the G11 shape again: `isKeeper` in
`lib/ai/leagueSportsGroundingPacket.ts` tested only
`String(league.leagueType ?? "").includes("keeper")`. `leagueType` holds exactly the five
values in the table above. **None contains "keeper", so `isKeeper` was false for 100% of
leagues in production** — a flag that could never be true, reading a column that could
never hold the value.

🛑 **AND THE OBVIOUS FIX IS WRONG, WHICH IS WHY IT WAS MEASURED FIRST.** `max_keepers`
looks like the natural signal. It is `>= 1` on **225/225** leagues — dynasty, guillotine
and survivor included — as is the `League.keeperCount` column derived from it. Deriving
keeper status from either would have marked **every league in the database** a keeper
league. The check that killed it is in the test file as a permanent guard.

### Fixed

- `SleeperLeagueMapper` derives `is_keeper` from `type === 1` and emits it. It reaches the
  settings blob for free: `buildImportedLeagueSettings` spreads `normalized.league`, which
  is exactly how `isDynasty` already gets there.
- `leagueSportsGroundingPacket` reads that flag, keeping the substring as a fallback so a
  human-confirmed keeper type still resolves.
- Writer and reader in ONE change, deliberately — a reader without its writer points a
  surface at data nothing populates, which this repo already paid for once with
  `ingestCFBDStats`.

10 tests, both halves mutation-verified: dropping the mapper emission fails exactly the 5
mapper tests; restoring the old substring-only reader fails exactly the 3 tests that
depend on the new signal, and correctly leaves the other 2 passing.

### Still open, and deliberately not fixed here

- ⚠ **Three subsystems disagree on whether keeper counts as dynasty.** The replay framework
  says YES (`type === 2 || type === 1`, in `ingestSleeperTradesForLeague`,
  `lineupSleeperNormalizer`, `sleeperTradeNormalizer`); the import says NO; and
  `sleeperCohortClient` / `app/api/league/transfer` treat it as its own third format. That
  is one rule with three implementations and wants an owner decision, not a unilateral pick.
- **`leagueType` is never written by any import path** — only by
  `lib/career/leagueTypeConfirmation.ts` on human confirmation. Writing `'keeper'` there
  from vendor data would change 100 production rows and is a data decision, not a code one.
- 🆕 **BUG-3 undercounts: there are THREE duplicate rows for this league**
  (`17739ade…`, `fcde8abf…`, `3d1b9554…`), not two.

## 0.26 R4b.6 — CHIMMY NARRATES FROM THE FACTS, AND A SIGNIFICANT GAP FOUND ALONG THE WAY

**2026-09-03.** P2's requirement — structured facts in, Chimmy narrates at
ask-time, nothing stored — already had a complete, working implementation:
`app/api/leagues/[leagueId]/psychological-profiles/explain/route.ts`. Built
before today, unrelated to this session's work, and doing exactly what P2
asks: a `deterministicPayload` of raw facts, an AI orchestration call with an
explicit "stay deterministic-first" instruction, a fact-guard validation pass
(`validateToolOutput`) that catches the model claiming something the payload
doesn't contain, and a non-AI `fallbackNarrative` if the call fails. Fresh
prose every request, nothing persisted.

**What it did not know about: trajectory, cross-league, cross-sport** —
because none of them existed until R4b.5, a few hours earlier today. R4b.6 is
that route learning about them:

- Trajectory (`readManagerTrajectory` + `summariseTrajectory`) is fetched for
  ANY profile the caller can already see — not self-gated, matching
  `psychology-os/index.ts`'s own reasoning that a manager's history reads the
  same for every viewer.
- Cross-league/cross-sport (`loadPsychologyConsistencySlice`, reused directly
  rather than re-derived a third time) is fetched ONLY when the profile being
  explained is the CALLER'S OWN. 🛑 **Deliberately a DIFFERENT gate from
  `canSeeOpponents`** — `resolveProfileAccess`'s entitlement check answers "may
  this caller READ this profile at all" (a subscription question); whether the
  explanation may include the SUBJECT's cross-league/cross-sport data is a
  separate question, and `loadPsychologyConsistencySlice` already restricts
  that to the account it's called with, by design. Explaining a paid-for
  opponent view therefore still never includes their cross-league reading —
  mutation-verified: forcing `isSelf = true` unconditionally fails exactly the
  one test asserting that gate, none of the other six.
- Every new field is `null`, never a fabricated absence-as-negative, and the
  model is explicitly told a null field means "not measured," not "no." Same
  discipline P2/P4 already required of the existing fields.

### 🛑 THE BIGGER FINDING: MOST OF WHAT R2/R3.3/R4b.5 BUILT NEVER REACHES THE LIVE CHAT ROUTE

Investigating where `explain`'s narration fits alongside the AMBIENT chat path
surfaced something bigger. `app/api/chat/chimmy/route.ts` — the one live
chat route — calls `buildDecisionOsGroundingPacket` with a **hardcoded**
`want: { values: true, devy: <NCAAF check>, projections: true, leagueRules:
true }`. Every opt-in slice built this session is `want`-gated and defaults
OFF:

| Slice | Roadmap item | Reaches the live chat route? |
|---|---|---|
| `lineupDecision` | R2 | ❌ never — `want.lineupDecision` is never set |
| `commissionerHealthDecision` | R2 | ❌ never |
| `idpKicker` | R3.1 | ❌ never |
| `rosterValueGrade` | R3.3 | ❌ never |
| `psychologyConsistency` (cross-league/cross-sport) | R4b.5 | ❌ never |
| `managerPsychology` (incl. trajectory) | R4b.4/R4b.5 | ✅ always — gated only by the kill switch, not `want` |
| `savedAnalysis` | earlier | ❌ never |

**Not a defect in any of those items individually** — each is correctly
built, wired into the packet, and tested against what it claims to do. The
gap is a layer none of them owned: nothing decides, per question, which
opt-in slices a chat turn should ask for. This is the same shape as M4's own
"intent router" milestone in `OS_FEED_STATE_2026-09-01.md` — genuinely a
separate, larger piece of work (deciding from a user's question whether it's
about a lineup, a trade, a roster weakness, a cross-league pattern), not
something to fold into R4b.6 as a side effect.

**Recorded here rather than fixed here.** Fixing it changes several already-
"done" items' real-world status at once and deserves its own scoped pass, not
a quiet patch riding on a psychology-narration commit. The `managerPsychology`
row is why R4b.6 itself still works end-to-end despite this — trajectory
rides the one feed that was never `want`-gated in the first place.

7 tests, `__tests__/decision-os/psych-explain-route.test.ts` (new — the route
had no test coverage at all before today). One thing mutation-verified: the
self-only gate on cross-league/cross-sport, described above.

## 0.25 R4b.5 — TRAJECTORY, CROSS-LEAGUE, CROSS-SPORT

**2026-09-03.** Three reads (P1/P5/P7), and two of the three underlying engines
already existed and had zero callers — the same shape as R3.3's trade-grade
finding, twice in one day.

### Trajectory (P1) — wired, not built

`readManagerTrajectory` + `summariseTrajectory`
(`lib/psychological-profiles/ProfileSeasonSnapshot.ts`) were fully built,
carefully null-safe (R4b.3's lesson applied twice — once on write, once on
read), and had exactly one real caller: their own module's doc comment. Added
`readLeagueTrajectories(leagueId)` — one query for the whole league rather
than N+1 per manager, sharing the exact row-mapping `readManagerTrajectory`
already used (extracted to `toTrajectoryPoint` so the two cannot drift) — and
called it from `psychologyProfileSource.derive()` in `psychology-os/index.ts`,
attaching a `TrajectorySummary` to every `PsychologyProfileFact`.

Trajectory is NOT viewer-scoped (a manager's history reads the same for
everyone), so unlike cross-league/cross-sport below it belongs in the
EXISTING 12h-cached league-level feed rather than a new uncached one.

🛑 **THE SERIALIZER NEEDED ITS OWN EDIT, AND WOULD HAVE SILENTLY DROPPED IT
OTHERWISE.** `renderItem()` already had a dedicated `PsychologyProfileFact`
branch (labels, scores, evidence count) that simply never read `trajectory` —
adding the field to the data does nothing on its own, which is G11 in
miniature. Caught by writing the render test first rather than assuming;
mutation-verified by disabling the new branch and confirming exactly the one
test that asserts trajectory text fails, none of the others.

### Cross-league, self only (P5) — reused whole

`rollUpManagerAcrossLeagues` (`CrossLeagueRollup.ts`) already existed,
already had one real caller (a REST handler), and already implements P5's
exact policy — intersection-only, "self" free and "opponents" premium-gated,
"one league is not a pattern." Nothing about it needed to change. What was
missing was an AMBIENT, packet-level entry point for the free half: "how
consistent am I, across every league I play." New
`lib/decision-os/grounding/psychologyConsistencySlice.ts` resolves the
caller's own `platformUserId` from ANY claimed team (not the current league
specifically — a `platformUserId` is constant per platform account, so
anchoring to one league's row would make a data gap on THAT row disable a
read every other league could answer) and calls the existing rollup with
itself as the subject.

⚠ **DELIBERATELY NOT "OPPONENTS."** Grading another manager is a
request-scoped, entitlement-gated question ("tell me about my rival") that
the existing REST route already serves. Folding it into an ambient
league-wide packet slice would mean resolving entitlement during packet
assembly for a question nobody asked yet — scope creep past what P5 needs
here.

### Cross-sport, self only (P7) — the one genuinely new piece

Nothing existed. New `lib/psychological-profiles/CrossSportRollup.ts`,
`rollUpManagerAcrossSports`, mirrors `CrossLeagueRollup`'s shape on a
different axis: WITHIN one sport, union every label seen across however many
leagues (too few leagues per sport for a within-sport majority to mean
anything); ACROSS sports, the same majority rule `CrossLeagueRollup` already
uses (a label seen in more than half the observed groups is "consistent") —
just moved from the league axis to the sport axis. Reports BOTH halves of
P7's own framing: `consistentLabels` (traits that hold) and
`sportSpecificLabels` (ones that don't, seen in exactly one sport).

`leagueIdsForUser` (private in `CrossLeagueRollup.ts`) is now exported and
reused rather than re-derived — "which leagues does this user manage" is the
same question on both axes.

### Why cross-league/cross-sport are NOT in the cached feed

`psychology-os/index.ts`'s own header already said so, before this session
touched it: both are VIEWER-scoped, so a per-subject cache would leak one
account's cross-league pattern to every other viewer, and a per-viewer cache
is almost always cold. Both new reads run through
`psychologyConsistencySlice.ts` as an uncached, per-request producer — the
same `decisionBridge.ts` shape R2 established for the four live decision
engines, joining the packet's concurrent wave rather than the `OsFeed`
mechanism.

### Flattened for the same reason R3.3's roster grade was

`CrossLeagueRollup`'s `dimensions` (a `Record`) and `labels` (array of
`{label, leagues, consistency}` objects) do not survive `renderObject()`'s
deliberately non-recursive design. `psychologyConsistencySlice.ts` reads only
the fields that render cleanly as primitives/string-arrays
(`consistentLabels`, observed/without-profile counts, `caveat`) rather than
passing either rollup's full shape through — the same "the producer shapes
for the renderer" rule R3.3 already established, applied a second time.

19 new/changed tests across 5 files (`psych-season-snapshot.test.ts`,
`psychology-os.test.ts`, `grounding-serializer-values.test.ts`, new
`cross-sport-rollup.test.ts`, new `psychology-consistency-slice.test.ts`).
Two things mutation-verified: the serializer's trajectory branch (disabling
it fails exactly the one test that asserts trajectory text, none of the
others), and — found DURING test-writing, not before — that
`rollUpManagerAcrossSports`/`rollUpManagerAcrossLeagues` share
`leagueIdsForUser`'s pre-existing lack of a try/catch, so a query failure
propagates rather than degrading silently; the packet producer's own
try/catch is the actual, and only, safety net, matching every other bridge
this session has built.

## 0.24 R4 — IDENTITY OS: THE MEASURE THE TRAP ALREADY NEEDED

**2026-09-03.** Scoped as R4.1 (re-run the audit) / R4.2 (one source, one
assertion, one packet slice) / R4.3 (give `unresolved_identity` a producer).
All three land together — they are one change, not three.

### R4.1 — fresh figures, `scripts/audit-player-identity-coverage.ts`

Registry coverage (Table A): every sport now reports `NO ROUTE: none` — every
row is reachable by SOME path (an external id or name+team). NCAAF alone grew
to 62,505 rows since the 2026-08-31 measurement (was ~20,030).

Roster-referenced coverage (Table B, the number that matters — see the
script's own header on why): NFL 60.8% (758/1247, sample of 25 leagues),
NCAAF 24.1% (118/490, 1 league) — essentially unchanged from NCAAF's
2026-08-31 figure. NBA and SOCCER still have leagues with zero rosters,
unmeasurable.

⚠ **NFL's figure moved from 80.4% to 60.8%, and that is NOT a reported
regression** — `orderBy: { updatedAt: 'desc' }` samples the 25 MOST RECENTLY
UPDATED leagues, which is a different league SET each run, not a fixed
population re-measured. Two samples three days apart are not directly
comparable; flagging the methodology rather than the number, the same
distinction §2.12 in `HUB_BUILD_PLAN.md` already drew for NCAAF's own two
measurements.

### R4.2 — one assertion, landed on the slice that already exists

`ImportAssertions` had four categories per its own D7 header, and "Identity"
among them was **entirely about MANAGERS** (`managerIdentityCoverage` — does
a roster's owner map to a real account). Nothing anywhere measured whether
the PLAYERS on a roster resolve to a real `PlayerIdentityMap` row — a
completely different, unrelated question that happened to share a section
title.

Added a fifth section: `playerIdentityCoverage` / `playersResolved` /
`playersTotal`, computed live in `loadImportAssertions()` (the same
in-memory-ratio-over-already-fetched-rows shape `managerIdentityCoverage`
already used — not a new sync, a derived measure). Ids are pulled via
`getNormalizedLineupSections`, the SAME parser `RosterContextProvider`
already reads `Roster.playerData` through — not a second implementation —
then checked against `PlayerIdentityMap` via a provider→column map
(`sleeper→sleeperId`, `fantrax→fantraxId`, ...). An unmapped provider
(native/manual — no external ids at all) reports `null`, never a measured
zero, the same null-vs-zero distinction `rosterCoverage` already draws.

🛑 **"ONE PACKET SLICE" DID NOT MEAN A NEW ONE.** `ImportAssertions` already
flows through the packet as `importAssertions: GroundedSlice<ImportAssertions>`
end to end, kill-switch and all. Adding fields to the type is the whole
change — zero new packet.ts wiring, zero new flags.ts entries. Reusing what
already renders beats adding a slice that would render the identical fields
twice.

### R4.3 — `unresolved_identity` gets a producer, via the general mechanism

`FactDependency` gained `minIdentityResolution: number | null`, wired into
`isConclusive()` next to the existing `minCoverage` check, sharing
`assertion: 'identity'` with the manager-identity blocker (by design — both
really are identity failures) but with a distinguishable `detail` string.

⚠ **SET TO 0.15, NOT `minCoverage`'s 0.9.** R4.1's own fresh numbers are why:
a normal NFL sample resolves ~61%, NCAAF ~24% — the ORDINARY case, not a
defect. A threshold near `minCoverage`'s would block most real leagues from
ever getting a lineup decision. 0.15 is a floor against the MEASURED trap (a
roster where every one of 27 players came back as
`{ playerId: '6804', name: '6804' }`, 0% resolved, and still graded itself
`conclusive: ok`) — not a quality bar against resolution nothing in
production has yet. Only `lineupDecision` carries the threshold;
`standings`/`leagueRules`/`managerBehaviour`/`globalPlayerValue` do not name
players to make their core claim.

19 tests across `conclusive.test.ts` and a new `identity-os-coverage.test.ts`.
Two things mutation-verified: the blocking condition itself (disabling it
fails exactly the two tests that assert blocking, none of the five that
assert non-blocking), and the unmapped-provider null guard (removing it
sends `where: { undefined: { in: [...] } }` to Prisma — the exact silent
failure the guard exists to prevent).

## 0.23 R3.3 — THE OTHER THREE VALUE QUESTIONS, RESOLVED

**2026-09-03.** OS_FEED_STATE's own M2 table names three sub-questions (2.1
trade grade · 2.2 roster holes · 2.3 cross-league exposure) and one of its
file-path claims was already wrong before this session touched it —
`sumCanonicalValues` lives in `lib/decision-os/value/contract.ts`, not
`lib/decision-os/trade/` as M2's own text says. Verify paths in this doc
against the code before trusting them.

### ✅ 2.3 "Am I overexposed to X?" — CONFIRMED DONE, verification only

`resolvePortfolioGrounding` (`lib/intelligence/chimmy/portfolioGrounding.ts`)
already computes real cross-league exposure via `getCommandCenter(userId)` —
`center.exposure.rows` carries `{name, count, exposurePct, rostersCounted,
injury}` per player, already formatted into the `portfolio: GroundedSlice<string>`
slice's prose. The serializer's `renderValue()` has a dedicated, unconditional
string branch (`typeof value === 'string'`) that every `GroundedSlice<string>`
goes through identically — no slice-name special-casing — and that branch is
already proven end-to-end by an existing test
(`__tests__/decision-os/grounding-serializer-values.test.ts:135`, "emits the
four prose slices VERBATIM"). Nothing to build.

### ✅ 2.2 "Where am I weak?" (in VALUE terms) — BUILT AND WIRED

⚠ **Do not confuse this with `weaknessSignals`**
(`lib/chimmy-context/intel/rosterWeakness.ts`, surfaced into the `roster` slice
via `RosterContextProvider` and already rendering since the R3 serializer fix —
see §0.21). That is a real, already-working, already-rendering signal, but it
compares THIS WEEK's point projections against a static per-position constant
(`positionProjectionFallback`: QB=17, RB=12, WR/TE=10...) — a weekly-lineup
signal, not a value one. It answers a genuinely different question and does
not satisfy "positional replacement level" as M2 states it.

What 2.2 actually needed was a VALUE-based comparison, and
`lib/core-app/rosterGrade.ts`'s `getRosterGrade` already does exactly that —
ranks every position's market value against the REST OF THIS LEAGUE'S rosters
(not a global baseline, which the module's own header says would call a strong
redraft roster thin because dynasty prices dominate the market). Bridged, not
re-derived — same playbook as R2:

- New: `lib/decision-os/grounding/rosterValueGradeSlice.ts` —
  `loadRosterValueGradeSlice({userId, leagueId})`. Loads the league +
  claimed-team row, builds `getRosterGrade`'s args the same way
  `lib/core-app/myTeam.ts` (its only existing caller) does, with one
  correction: `isDynasty` is `deriveLeagueFormat(league) === 'dynasty'`
  (R4b.1's helper), not raw `league.isDynasty` — so this does not propagate
  BUG-4 further than it already reaches.
- 🛑 **`RosterGrade.strongest`/`.weakest` are nested `PositionStrength`
  objects, and `renderObject()` is deliberately non-recursive** (§0.21's own
  design principle — descending is what makes an unbounded dump possible
  again). So the producer FLATTENS them into prefixed primitive fields
  (`weakestPosition`, `weakestValue`, `weakestRank`, `weakestOutOf`,
  `strongestPosition`, ...) before they ever reach the packet, rather than
  growing the serializer a second special-case branch. 8 tests, the flattening
  itself mutation-verified (reverting to pass the nested objects through
  un-flattened fails exactly the 2 tests that check for it, none of the other
  6).
- Wired into `packet.ts` as `rosterValueGrade` — joins the concurrent wave
  (own DB reads, no roster dependency, unlike `idpKicker`), opt-in
  (`want.rosterValueGrade`, default OFF, since `getRosterGrade` reads every
  roster in the league). `'rosterValueGrade'` added to both
  `DecisionOsFeed` and `DECISION_OS_FEEDS` in `flags.ts` — the trap this repo
  already knows about (the two must stay in sync).

### ✅ 2.1 "Is this trade fair?" — ALREADY WIRED; the gap is data, not code

**Not two competing systems — one pipeline.** `lib/decision-os/trade/`
(`runTradeEvaluateDecision`, wrapped by `runTradeShadowForProposal` in
`shadow.ts`) does not compute values; its `evaluate` dep is literally
`async () => memo` (`deps.ts:35-41`) — it wraps the ALREADY-PERSISTED
`redraft_trade_value_snapshots` row that `captureRedraftTradeValueSnapshot` →
`buildTradeValueSnapshot` (`lib/trade-value/`) writes. `lib/chimmy-trade/
tradeIntelligenceTools.ts` reads the same row. No rival implementation exists.

`lib/chimmy-trade/pendingTradeDecisionGrounding.ts` — read in full — is
already the correct answer to "wire the deterministic trade engine into
Chimmy": it queries pending incoming proposals, calls
`runTradeShadowForProposal`, renders the full `Decision<T>` four-answer shape
via `toTradeCard`, suppresses the grade below `LOW_COMPLETENESS` (60) rather
than presenting a verdict off thin data, surfaces illegal-trade verdicts, and
degrades honestly at every failure point (query failure, missing snapshot,
`DECISION_OS_TRADE_LIVE` off). It is already composed into the live
`/api/chat/chimmy` route. This module exists BECAUSE `explainTrade`
(`tradeIntelligenceTools.ts`) turned out to be unreachable — `buildTradeContext
ForChimmy` is called with only 2 args, so its `proposalId`-gated branch never
fires on any real request. Someone already found and fixed that gap.

🛑 **MEASURED 2026-09-03 AGAINST PRODUCTION: BOTH DEPENDENCY TABLES ARE
EMPTY.** `redraft_trade_proposals`: **0 rows**, all statuses. `redraft_trade_
value_snapshots`: **0 rows**. Not a writer gap (there is nothing upstream
failing to write) — the native in-app trade-proposal flow itself has never
been used in production. This matches a comment already in
`app/api/chat/chimmy/route.ts` that imported leagues (Sleeper, the dominant
platform per this whole document) trade through their own platform's UI, not
through this app's trade builder.

**So the code is correct and complete for what it was built to do, and
currently grades zero real trades — a product-adoption fact, not a defect.**
Building a NEW entry point (grading a Sleeper trade after the fact, or a
hypothetical trade described in chat) would need chat-level intent parsing to
extract proposed assets from natural language — a materially larger, different
feature than "wire the machinery," and outside M2's own scope framing
("reuses M1 rendering... none needs new feed work"). Not attempted here;
recorded as a real gap for whoever scopes it, distinct from 2.1 as written.

## 0.22 R3.1 — THE IDP/KICKER SLICE, AND THE PRODUCER NOBODY BUILT

**2026-09-03.** Player Value OS sat at 48% because "IDP and kicker have a built adapter and no feed
source and no packet slice". The adapter turned out to be the finished part.

### 🛑 THE ADAPTER WAS COMPLETE. ITS INPUT HAD NO PRODUCER.

`loadIdpKickerValues` takes an `IdpLeagueValuationContext`. A grep for that type across the repo
finds **only the adapter and its own definition** — nothing ever built one. Passing `null` compiles,
yields an empty value map, and the adapter honestly reports `not_computed`. Forever. For every
league.

Wiring it that way would have been `ingestCFBDStats` a third time: a surface pointed at a producer
nothing feeds, failing silently and looking correct. **The missing piece was never the slice — it
was the context.**

`lib/decision-os/grounding/idpKickerSlice.ts` builds it, from the same two pure functions that
`waiver-intelligence`, `idpChimmy` and `league-rankings-v2` already compose. A fourth caller of an
established composition, not a rival to it.

### ✅ THE CHEAP EXIT IS THE DESIGN, NOT AN OPTIMISATION

**10 of 94 NFL leagues carry real IDP roster slots; 19 carry a kicker.** So four leagues in five
must pay nothing, and `detectIdpLeague`/`detectKickerLeague` are checked on ROSTER SLOTS before any
query runs.

⚠ **Never infer an IDP league from its scoring settings.** `availablePlayersTool` records an earlier
note there claiming 70 of 94, from a grep that matched the scoring block — every Sleeper league
ships `sack`/`int`/`ff` keys whether or not it rosters a defender. The strict predicates exist
because that grep is wrong.

### ⚠ TWO TRAPS CARRIED FORWARD FROM THE PRODUCERS

1. **An EMPTY vorp map must be passed as `undefined`, not as an empty `Map`.** The three existing
   callers all guard this. An empty Map reads to the adapter as "this league prices IDP and every
   defender is worth nothing"; `undefined` reads as "not priced here", which omits them instead.
2. **The adapter's own `pickValue()` must not be inlined away.** `buildIdpKickerValueMap` writes the
   real number into `value` OR `redraftValue` by format and a literal `0` into the other, so reading
   `.value` unconditionally prices every IDP and kicker in every redraft league at zero — and zero
   is a number `isCoherentValue` accepts.

### ⚠ ROSTER-SCOPED, SO DELIBERATELY NOT A FEED SOURCE

`marketValueSource` and `devyValueSource` are keyed sport+format and live in the domain-os store.
These cannot: they derive from ONE league's scoring and price ONE roster. A linebacker is worth ~9
points under `balanced` scoring and roughly double under a tackle-heavy setup. The scorecard's "no
feed source" is therefore **correct and should stay that way** — only the packet slice was missing.

### Status

| # | Step | |
|---|---|---|
| **R3.1a** | `loadIdpKickerValueSlice` — builds the context, cheap exit, honest gaps. 6 tests, both guards mutation-verified. | ✅ |
| **R3.1b** | Wire it into the packet as a slice. ⚠ Needs `rosterPlayerIds` + `rosterPositions` + `numTeams`, so unlike every other producer it DEPENDS on the roster and cannot join the concurrent wave — it is a serialized second hop and must default OFF. | ✅ |
| **R3.2** | Schedule the app-level value + projection sources (a second cron walk, keyed sport+format). | ✅ `refreshAppSources` in `app/api/cron/domain-os-refresh/route.ts`, runs before the league walk. |
| **R3.3** | The other three value questions: trade grade · roster holes · cross-league exposure. | ✅ 2026-09-03 — see §0.23. 2.2 built + wired (`rosterValueGrade` slice); 2.3 was already done (verification only); 2.1's machinery was already built and wired, currently data-starved in production (0 rows in both dependency tables) rather than missing code. |

Suite after R3.1a: **199 files / 3,703 tests / 0 failures.**

## 0.21 R2 — BRIDGE PIPELINE A INTO THE PACKET · plan, and what the survey changed

**2026-09-03.** R2's one-line spec said: *"a **read-only** adapter: the four live engines'
decision objects → packet slices."* Four findings from reading the code change that plan before
a line is written. Three make it easier than expected; one makes it smaller.

### ✅ F-1 — ALL FOUR ENGINES ALREADY SHARE ONE CONTRACT, so this is ONE adapter, not four

```
decideLineupSet(dco, deps)          -> Decision<LineupActionItem>
decideWaiverClaim(dco, deps)        -> Decision<WaiverClaimRecommendation>
decideTradeEvaluate(dco, deps)      -> Decision<TradeEvaluation>
decideCommissionerHealth(dco, deps) -> Decision<CommissionerHealthAssessment>
```

`Decision<TAction>` (`lib/decision-os/core/decision.ts`) already carries **everything a
`GroundedSlice` needs**, which is why the mapping is translation rather than invention:

| `Decision` field | → `GroundedSlice` |
|---|---|
| `data_completeness` (0–100) + `confidence` (0–100) | `confidence` (0..1), `conclusive` |
| `provenance.weakest_trust` | the gap `reason` when it is `low`/`unverified` |
| `uncertainty_sources[]` | the gap `detail` |
| `four_answers` + `explanation` | the serialised value Chimmy reads |
| `rule_verdicts[]` | the hard constraints Chimmy must not contradict |

⚠ **`Decision` measures its own honesty already.** `data_completeness` is explicitly "separate
from confidence", and `provenance.weakest_source` is documented as *"the weakest required input
drives confidence/completeness honesty"*. The packet's conclusiveness model and the engines'
provenance model were designed to the same principle independently. The adapter does not have to
invent a confidence story; it has to avoid losing the one already there.

### 🛑 F-2 — "READ-ONLY ADAPTER" HAS AN UNSTATED PREREQUISITE: THERE IS NOTHING TO READ

There IS a decision store — `canonical_decisions`, with a 46-column schema and a writer at
`lib/decision-os/canonical/prismaDecisionStore.ts:236`.

```
SELECT count(*) FROM canonical_decisions;   ->   0
```

**Zero rows in production.** The four engines run *inline, per request*, on their own routes
(`lib/decision-os/{lineup,waiver,trade,commissioner-health}/index.ts`) and nothing persists the
result. So a bridge that reads the store returns nothing, for every league, silently.

🛑 That is precisely the `ingestCFBDStats` failure this repo has already paid for once — *"pointing
a surface at a table nothing refreshes is worse than the live call it replaced: it fails silently
and looks correct."* **So R2 runs the engines inline off inputs the packet already holds.**
Persisting decisions is a separate, later decision (R2.7), not a prerequisite.

### ✅ F-3 — THE ENGINES ARE CHEAP; THEIR *INPUTS* ARE THE COST

`resolveLineupWorld` and `buildLineupDCO` are **pure and synchronous** — no `await`, no I/O. The
orchestrator's own docstring says Prisma reads happen "in an injected loader at the route seam,
never here". So running an engine costs whatever its inputs cost, and nothing more.

And the packet **already loads most of them**: `leagueRules`, `roster`, `matchup`, `standings`,
`projections`, `marketValues`. The bridge is therefore mostly *reuse*, not new fetching — which is
what keeps it inside the latency budget R0.8/R0.10 established.

### 🛑 F-4 — IT IS NOT "+4 OS's". TRADE DOES NOT FIT A LEAGUE-SCOPED PACKET.

The four engines' inputs are **not** uniform, and one of them is structurally different:

| Engine | Required input | Fits a general packet build? |
|---|---|---|
| Commissioner-health | `snapshot` + `userId` | ✅ cheapest — one object |
| Lineup | roster players, rules, weeks | ✅ packet already holds roster + rules |
| Waiver | `engineInput: WaiverAIServiceInput` + world | ⚠ needs a waiver pool loaded |
| **Trade** | **`proposal: TradeProposalContext`** + assets | 🛑 **no proposal exists in a general turn** |

A trade decision is **proposal-scoped**, not league-scoped. "How does my roster look?" contains no
proposal, so there is nothing for `decideTradeEvaluate` to evaluate. Forcing a trade slice into
every packet would mean inventing a proposal, which is the fabrication the whole grounding design
exists to prevent.

⚠ And a path for the real case already exists: `lib/chimmy-trade/pendingTradeDecisionGrounding.ts`
(the scorecard's footnote 3). **R2 wires three engines and documents the fourth**, rather than
claiming four and shipping a stub.

### The plan

| # | Step | Status |
|---|---|---|
| **R2.1** | `decisionToSlice()` — one generic `Decision<T>` → `GroundedSlice<DecisionFact>` adapter, pure, no I/O. Mirror of `toEvidencePacket.ts`. | ✅ |
| **R2.2** | Serializer support: render a decision slice as its four answers + verdicts, never `JSON.stringify`. | ✅ |
| **R2.3** | Wire **commissioner-health** — ⚠ REVISED, see below. | ⏸ |
| **R2.4** | Wire **lineup** — reuses the roster + rules the packet already loads. | ✅ |
| **R2.5** | Wire **waiver** — 🛑 REVISED: request-scoped, like trade. | ⛔ |
| **R2.6** | **Trade: documented, not wired.** Record why, and point at the proposal-scoped path. | ✅ |
| **R2.7** | Decide whether to persist decisions to `canonical_decisions` — separate from R2, and it needs a writer wired at the same time or not at all. | ☐ |

**Each engine gets its own `want` flag and its own kill switch**, exactly like `values`/`devy`/
`projections`. A bridge that cannot be switched off per-engine turns one slow engine into a slow
Chimmy for everyone.

⚠ **The engines are NOT to be modified.** They are live, load-bearing and correct. Every step here
adds a caller; none changes a decider. If a step seems to need an engine change, that is the signal
to stop and re-scope.

### ✅ R2.1 + R2.2 DONE — the seam exists and is proven

`lib/decision-os/grounding/decisionToSlice.ts` (new) · `serialize.ts` · `packet.ts`
· `__tests__/decision-os/decision-to-slice.test.ts` (10) ·
`__tests__/decision-os/decision-slice-serialization.test.ts` (5)

**Suite: 196 files / 3,686 tests / 0 failures** (was 194 / 3,671).

Three design rules are load-bearing and each is pinned by a mutation-verified test:

1. 🛑 **An `illegal` rule verdict does NOT make a decision inconclusive.** It is the most conclusive
   thing a decision can say — "your league's rules forbid this" is a finding, not a gap. Only the
   QUALITY OF THE INPUTS may block; never the content. Getting this backwards would suppress
   exactly the answer a user most needs, and it is the single most plausible "fix" someone would
   later apply.
2. ⚠ **A malformed decision degrades to a gap rather than throwing.** `assertFourAnswers` throws by
   design and is deliberately *not* called here: one bad decision must not take down the packet
   build for every other slice in the same turn.
3. ⚠ **Actions are counted always, described only when the caller supplies a describer.** Without
   one, a best-effort stringifier on an unknown shape yields `[object Object]` and puts it in a
   prompt as though it were a fact.

🛑 **AND R2.2 CAUGHT G11 ARRIVING THROUGH A NEW DOOR.** `renderValue` returns `[]` for anything
that is not a string or an array, and a `DecisionFact` is a plain object — so a decision slice
would have serialised to `Lineup decision: available` with no substance beneath it. That is the
precise bug the serializer was rewritten to fix for values, reappearing for a new value type.
A test asserts the four answers reach the prompt; reverting the branch fails four of five.

⚠ **`packet.ts` now imports `DecisionFact` as `import type`, and that is not stylistic.**
`decisionToSlice` imports `GroundedSlice` from `packet`, so a value import would close a runtime
cycle. Type-only is erased at compile time, leaving the cycle in the type graph where it is inert.

### ✅ R2.4 DONE — lineup is bridged end to end

`grounding/decisionBridge.ts` (new) · `packet.ts` (`want.lineupDecision`, producer, assembly) ·
`flags.ts` (`lineupDecision` kill switch) · `__tests__/decision-os/decision-bridge.test.ts` (5)

**Suite: 197 files / 3,691 tests / 0 failures.**

The bridge separates three absences that are easy to collapse and costly to confuse:
`disabled` (an operator switched it off — the user can do nothing), `not_synced` (a null loader
result: an unimported or off-season league — tell them to sync, not to file a bug), and
`not_computed` (the engine threw). It also **never passes `shadow` deps**: that option runs the
legacy recommender too, and a chat turn wants the decision, not a second opinion it never reads.

⚠ **`want.lineupDecision` DEFAULTS OFF, unlike every flag beside it, and the asymmetry is the
point.** The others gate a READ; this gates running a decision engine inside the chat route's
latency ceiling. Charging every turn a lineup decision — including the ones asking about trade
values — is how the packet went 5.4s over that ceiling before R0.8.

### 🛑 R2.5 AND R2.3 CHANGED ON CONTACT WITH THE CODE

**R2.5 — waiver is REQUEST-scoped, exactly like trade.** `RunWaiverClaimInput` requires
`engineInput: WaiverAIServiceInput`, and the live route supplies it from the **request body**:

```ts
// app/api/waiver-ai/engine/route.ts:242
runWaiverShadowForEngine({ userId, leagueId: input.leagueId, engineInput: input, legacyAnalysis: analysis }, …)
```

`input` is what the user submitted — which targets, which budget. A general chat turn has none, and
synthesising one would be inventing the user's question. **Same structural class as trade**, found
by tracing the caller rather than by assuming the plan was right. `loadWaiverWorldFacts` exists and
gives world facts, but world facts are not the ask.

**R2.3 — commissioner-health is feasible but needs an input the packet does not hold.**
`buildCommissionerHealthSnapshot` is pure, but the only loader is
`getCommissionerHubHealthForUser(userId, leagues: UserLeague[])` — it takes the user's whole league
list, filters to `isCommissioner`, and returns snapshots for **all** of them. The packet knows one
`leagueId`, not a `UserLeague[]`. It is a real wiring job (load the league, build the snapshot,
run), not a one-liner, and it applies only when the user commissions that league. Parked
deliberately rather than half-done.

⚠ **SO R2 IS "+1 WIRED, +3 EXPLAINED", NOT "+4 CONNECTED".** The original estimate assumed four
interchangeable engines behind one contract. The contract is genuinely shared — that part held —
but their INPUTS are not: one is DB-derivable (lineup), one needs a different loader shape
(commissioner), and two are scoped to a user request that a chat turn does not contain (waiver,
trade). Lineup is also the highest-value single one, so the leverage estimate was closer than the
count was.

## 0.20 ✅ THE SNAPSHOT WRITER RUNS IN PRODUCTION — and it has a defect I introduced

**2026-09-02, 19:19 UTC.** Baseline was 0 rows at 19:07:34. A watch caught the first write.

### ✅ The production gap in R4b is closed

```
97 rows written 19:19:33.943 → 19:19:49.069   (a 16-second burst)
8 leagues · 18 managers · 1 season · 0 rows with NULL confidence
```

Confidence is spread across all three buckets and tracks evidence volume monotonically, which is
what it should do if the floor is working rather than rubber-stamping:

```
confidence  count  avg sampleSize
   0.3        18        5.0
   0.6        29        7.1
   0.9        50        8.6
```

⚠ **The write burst was NOT the 19:30 heartbeat** — it landed at 19:19, between two fires. So the
trigger was something other than the exec-sync cron (a manual `/run` route, or a deploy). The
writer working is proven; *which caller proved it* is not, and the 19:30 cron path remains
formally unconfirmed.

### ⚠ Still ZERO trajectories, and that is by design not defect

`count(DISTINCT season) = 1` — everything is 2026 — so **no manager has a trajectory yet** and
`summariseTrajectory` will correctly refuse for all 97. The migration said this in advance: *"the
clock started when this was applied."* The table is accumulating, not broken.

### 🛑 R4b.3 — THE SCORE COLUMNS REPRODUCE THE EXACT BUG THE EVIDENCE FLOOR EXISTS TO PREVENT

The migration reasons carefully about one column and I failed to apply that reasoning to five:

```sql
"sampleSize"  INTEGER NOT NULL DEFAULT 0,   -- zero is a real answer. Correct.
"confidence"  DOUBLE PRECISION,             -- NULLABLE: null = below the floor. Correct.
"aggressionScore" DOUBLE PRECISION NOT NULL DEFAULT 0,   -- 🛑 and four more like it
```

and the writer coalesces on the way in:

```ts
${input.scores.aggressionScore ?? 0}     // ProfileSeasonSnapshot.ts:82-84
```

**So an unmeasured score is stored as `0`, which reads as measured indifference** — a manager who
was never assessed for aggression is recorded as maximally passive. That is precisely the failure
`gateScores` was built to prevent on the live profile, reintroduced one table over.

The data already shows the ambiguity and cannot resolve it:

```
rows with non-zero aggression   68 / 97
rows carrying any label         29 / 97
```

The 29 zero-score rows are indistinguishable from genuinely-passive managers, because the
information was destroyed at write time by `?? 0`. **No query can recover it** — the fix has to be
a migration dropping `NOT NULL` on the five score columns plus removing the coalesce, and then the
existing 97 rows are still unrecoverable and want re-writing.

⚠ **Nothing type-checks this and no test caught it** — the tests assert the upsert shape and the
never-throws contract, not the null-preservation property. Landed in `3c5a3a70d`.

### ✅ R4b.3 FIXED — 2026-09-02, and the null died in THREE places, not one

Owner applied the `DROP NOT NULL` (verified: all five report `is_nullable = YES`, `sampleSize`
correctly still `NO`). The code fix follows it.

**The defect I first reported was one third of the actual bug.** Fixing only the writer would have
left two sites intact and the suite still green:

| # | site | what it did | why it is invisible |
|---|---|---|---|
| 1 | `writeProfileSeasonSnapshot` | `${score ?? 0}` | the one I found |
| 2 | `readManagerTrajectory` | `Number(r.aggressionScore)` | **`Number(null)` is `0`, not `NaN`** — the read resurrects the null the column now preserves |
| 3 | `summariseTrajectory` | `last.aggressionScore - first.aggressionScore` | **`null - 75` is `-75`, not `NaN`** — prints a confident swing for a season nobody measured |

⚠ **Site 3 is not covered by the confidence filter.** `usable` already drops seasons whose
`confidence` is null, and it is tempting to conclude the arithmetic is therefore safe. It is not:
clearing the evidence floor overall does **not** imply every individual score was measured, so a
graded season can still carry a null aggression. The guard is load-bearing, not defensive.

The trajectory **survives** an unmeasured score — a label change is direction on its own — so only
the aggression clause is withheld (`'aggression not measured in both seasons'`). Refusing the whole
summary would throw away the answer the caller asked for.

**Verified by positive control, not by a green run.** Each of the three fixes was reverted in turn,
the mutation proven to have applied (`diff` must differ — a no-op mutation is indistinguishable
from a test that cannot fail), and each produced **exactly one** failure:

```
M1 writer  ?? 0          1 failed | 11 passed
M2 read    Number()      1 failed | 11 passed
M3 summary guard         1 failed | 11 passed
file restored to the fixed version after each
```

One failure per mutation means the three tests guard three distinct sites with no overlap masking
a gap. Suite: **12 passed**, and `__tests__/decision-os/` **194 files / 3,671 tests, 0 failures**.

⚠ **A parse error caught a worse latent bug.** The first attempt put the explanation as a `/* */`
block *inside* the `Prisma.sql` template — where it is not a comment but literal SQL text, and the
`${score ?? 0}` in the prose became a **live interpolation**. Here it failed loudly at transform.
The same mistake in a string that happens to parse would inject prose into a query silently.

SQL and hardening in §10.4. Migration recorded at `prisma/migrations-pending/20260902193000_manager_psych_seasons_nullable_scores/`.

## 0.19 ✅ R1.9 RESOLVED BY EFFECT — and a NEW gap in R4b's own guard

**2026-09-02, ~19:10 UTC.**

### (a) ✅ `FANTASY_OS_EXEC_SYNC_LIVE` IS genuinely `true` on the live project

R1.9 asked whether the exec-sync collector is switched on. It is — **not** read off an
env var listing, but measured by its output:

```
manager_psych_profiles   last updated  2026-09-02 18:11:50 UTC
                         updated in last 2h   314
                         total                1,749   (1,681 an hour earlier)
```

`refreshProfilesForExternalLeagues` is called at `app/api/cron/fantasy-os-exec-sync/route.ts:121`,
which is **inside** the `if (!liveEnabled) return` gate at line 53. Rows are moving, so the gate
is open. This retires the earlier "the collector is silently off" reading, which came from the
dead Vercel scope (§0.13).

⚠ **Recorded as an effect measurement, not an env read.** Nobody has seen the variable's value;
what is proven is that the gated code path executes. That is the stronger claim anyway — an env
var being set is not evidence the branch runs.

### (b) 🛑 NEW — `ProfileRefreshService` DEFEATS R4b's "no season, no snapshot" refusal

`PsychologicalProfileEngine` deliberately refuses to invent a season, and says so in a comment:
inventing one *"would file a dynasty league's cumulative history under whatever year the cron
happened to run, which is worse than having no history at all."*

The caller one layer up does exactly that invention:

```ts
// lib/psychological-profiles/ProfileRefreshService.ts:49
const season = input.season ?? league?.season ?? new Date().getFullYear()
```

So `input.season` is **never null** by the time the engine sees it, and the guard at
`PsychologicalProfileEngine.ts:142` can never fire. The refusal is correct and **structurally
unreachable from the production path**.

**Blast radius is narrow but real.** The exec-sync path passes `league.season` (line 121), which
is right. The fallback only bites a league whose own `season` is null — and for a dynasty league
that is precisely the case where stamping the current year corrupts the trajectory the table
exists to hold. It writes a row that looks like data.

**Not fixed here, because the fix is a decision, not an edit.** Either the fallback goes (and
seasonless leagues get no snapshot, which is what R4b argues for), or it stays and the snapshot
writer needs to know the season was inferred rather than observed. Filed as **R4b.2**.

⚠ The general lesson, and it is the third time this file has recorded a version of it: **a guard
is only as strong as the narrowest caller that reaches it.** Checking that the refusal is written
correctly says nothing about whether any input can trigger it.

## 0.18 🛑 BUG-2 — 25% OF LEAGUE SYNCS ARE FAILING ON A READ-ONLY TRANSACTION

**Filed 2026-09-02. Live, ongoing, and NOT caused by anything in this session's work.**
Found while running the batch-3 production check.

### Measured

```
runKey             sleeper:1335730625293844480:2026
incompleteScopes   ["league_state", "teams_rosters"]
lastError          scope "league_state" failed after 3 attempts:
                   Invalid `prisma.league.update()` invocation:
                   PostgresError 25006: cannot execute UPDATE in a read-only transaction
```

**46 of 184 `league_sync_state` rows carry this error — 25% of leagues.** It is 46 of 49 total
errors, so it is effectively *the* failure mode. Intermittent, not total:

| hour (UTC) | read-only failures | OK |
|---|---|---|
| 04:00 | **0** | 108 |
| 05:00 | **36** | 10 |
| 18:00 | **10** | 17 |

Healthy at 04:00, broken from 05:00, still broken at 18:00 — **with successes and failures in the
same hour**, which is what makes it intermittent rather than a global read-only state.

### 🛑 THIS IS WHY CHIMMY DECLINED A TRADE QUESTION IN PRODUCTION

Asked *"Should I trade Jeremiyah Love for Ashton Jeanty in King Gingerbeards SF 2026?"*, Chimmy
answered: *"No league roster or trade data is available… so I cannot evaluate."*

**That refusal was CORRECT.** `teams_rosters` never completed, the packet reported the slice
absent, and the model declined rather than inventing a trade grade — D8 and **A7** working exactly
as designed, on a real failure.

⚠ **But it dropped the remedy.** The serializer emits *"It retries automatically on the next sync;
a manual refresh will also pick it up"* and the model did not relay it. The refusal landed, the fix
did not — half the contract. **R1.6** now has production evidence.

### Ruled out, by measurement rather than reasoning

| hypothesis | verdict |
|---|---|
| Neon **read replica** endpoint | ❌ **98 endpoints, all `read_write`**, zero read-only |
| Project-wide read-only state | ❌ my connection writes fine; both outcomes in one hour |
| Role-level `default_transaction_read_only` | ❌ `pg_db_role_setting` holds only `search_path` and `statement_timeout` |
| Endpoint suspended or disabled | ❌ `ep-curly-block-ad0dlt9o` is `active`, `disabled: false` |
| Code opening a read-only transaction | ❌ every "read-only" in `lib/fantasy-os/sync/*` means read-only **against Sleeper**, not Postgres |

### ✅ BOTH REMAINING HYPOTHESES CHECKED VIA THE NEON API — and both are ruled out

**1. "The live app uses a different `DATABASE_URL`." — NO.**
Of 98 endpoints on project `icy-field-51189449` ("All Fantasy"), **exactly one is `active`:
`ep-curly-block-ad0dlt9o`**, last active 18:56 UTC, `read_write`, `disabled: false`, on branch
`br-withered-shadow-adur64u9`. That is the same endpoint `.env.local` uses and the one I write to
successfully. **The app and I are on the same healthy primary.**

**2. "A Neon compute event at 05:00 caused a read-only window." — NO.**
The operations log shows **no Neon operation of any kind between 03:50 and 14:41 UTC today.** The
failures begin at 05:00, squarely inside that gap. No `start_compute`, no `suspend_compute`, no
`apply_config`, no branch operation.

🛑 **SO THE ONSET HAS NO INFRASTRUCTURE CAUSE, AND THAT INVERTS THE HYPOTHESIS.** I argued
infrastructure was likelier because 25006 is a Postgres-level error rather than an application
one. The operations log says nothing happened on the Neon side when it broke. **The remaining
explanation is a deploy** — and batch 1 / batch 2 landed in that window, batch 2 being another
session's import/sync work touching `lib/fantasy-os/sync/collector/*`.

⚠ **STILL A CORRELATION, NOT A PROVEN CAUSE.** What is now established is that the *infrastructure*
alibi is gone, not that the deploy is guilty. A `grep` of `lib/fantasy-os/sync/*` for a read-only
transaction found nothing, so if a deploy did this the mechanism is not obvious and needs finding
rather than assuming.

### 🆕 Two secondary observations from the same log

- **`apply_config` ran on the PRIMARY twice today** — 16:00:24 and 16:02:26 UTC. That reconfigures
  a live compute and could plausibly produce a brief read-only window; it may account for some of
  the 18:00 failures, but **not the 05:00 onset**, which precedes it by eleven hours.
- **Heavy branch churn: six branches created in ~80 minutes** (14:41, 15:12 ×2, 15:19, 15:55,
  15:57), against 98 total endpoints and a daily `timeline_archive` cadence. Not a cause of this
  bug, but worth someone's attention — that is a lot of accumulated state on a `scale` plan.

### The one check left, and it is not one I can run

**What changed in production at 05:00 UTC 2026-09-02.** Vercel's deployment list for
`allfantasy-v2-main-a6wc` around that timestamp, cross-referenced against batch 1 / batch 2's
contents. If a deploy lines up, the mechanism is in that diff.

### 🆕 Two more real defects found on the same league

- **DUPLICATE LEAGUE ROWS.** `fcde8abf…` and `3d1b9554…` are both *King Gingerbeards SF 2026!!!*
  with the **same `platformLeagueId` 1335730625293844480**. Both have 12 rosters and 12 teams —
  but one has **12 psychology profiles and the other has 0**. Which one a fuzzy name-match selects
  therefore decides whether a user gets psychology data at all.
- ⚠ **`isDynasty = false` AND `leagueType = 'redraft'` on both**, on a league the owner states is
  dynasty. **This weakens BUG-1's headline evidence and the correction is owed:** §0.15 reported
  *"a dynasty league answered with a redraft price, 43% low"*. The price matched what the database
  says the league is. The fabrication bug BUG-1 fixed is real and independent — settings were
  invented from the question text — but the wrong-price symptom used as its evidence has a
  **different root cause**: the import is not capturing dynasty status. That is a third bug,
  upstream of anything fixed here, and it means dynasty/redraft pricing cannot be trusted until it
  is resolved.

---

## 0.17 ⏸ R4b IS BUILT, VERIFIED, AND HELD — `f09ee6684`

**Owner's decision 2026-09-02: hold until a reviewer session picks it up.** Not pushed.

```
TIP    f09ee66842a9395cb48c8f5c4290f17632e28703
BASE   54b4b4c8528b753480e77fce6948a4316d4c4d01
```

| check | result |
|---|---|
| typecheck pair | base **145** → tip **145**, both `TSC_DONE=2`, 59,430 bytes, 0 syntax / 0 crash / 0 missing-module |
| normalized set | **0 appeared · 0 disappeared** |
| errors in the 7 changed source files | **NONE** |
| suites on the commit | **87 / 87**, 7 files, 17 new tests all red-first |
| file set | 12 files, **0 D lines** |
| migration | applied by the owner already; the staged file is a history backfill |

### ⚠ THE RAW TEXT DIFF PRODUCED A PHANTOM DELTA — normalize before comparing

Comparing full error messages reported **1 appeared / 1 disappeared**. Same file, same line, same
`TS2322` — TypeScript printed a union's members in a different order between two runs:

```
base  … "commissioner" | "war_room" | "free" | "pro" | "supreme" …
tip   … "commissioner" | "war_room" | "pro" | "supreme" | "free" …
```

**Union member order is not stable across runs.** Normalizing to `file:line:col:TScode` gives 0/0.
Reported raw, this commit would have gone over as "+1 appeared" against a file it never touched.

🛑 **Any gate that diffs error TEXT will manufacture deltas on commits that changed nothing.**
Compare error *identity*, not its prose rendering.

### Why it is held rather than landed

The reviewer session went 33 minutes without a heartbeat and its name stopped resolving; the
push-queue lock expires on its own. **A holder that does not resolve is not a vacancy** — claiming
on that basis collides with a live batch — and this session hands SHAs to a gate rather than
pushing. So it waits.

Nothing is at risk: it is a real commit in a detached worktree with its attestation ready.

### 🛑 The item to weigh when it does land

**No production run.** The engine now writes a season snapshot on every profile refresh — **1,681
profiles, every 30 minutes** — and that path is covered only by mocked tests. It is the
least-exercised code in the commit and the most repeated at runtime. The blast radius is bounded
(the writer returns `false` rather than throwing, so it cannot fail the refresh), but *"cannot
break the refresh"* is not *"is known to work"*.

---

## 0.16 ✅ R4b — PSYCHOLOGY OS IS INSIDE THE HUB (the half that needs no SQL)

Built 2026-09-02. **Branch only, not pushed.**

### The engine was never the missing piece

`lib/psychological-profiles/` was already 16 modules, **all seven sports**, migrated tables, 15
labels, 10 evidence types, an evidence floor, a viewer-scoped cross-league rollup, 8 API routes,
2 user-facing pages, and a cron refresh — with **zero references anywhere in `lib/decision-os/`**.
A complete subsystem sitting outside the hub meant to reason over it. **This is a seam, not a
rewrite** — the lesson §2.14 and §2.16 both record about rivalling working producers.

### What shipped

| | |
|---|---|
| `'psychology'` as an `OsDomain` | **no migration** — `domain` is `VarChar(16)`, the value is 10 chars |
| `lib/decision-os/psychology-os/` | league-level source, **12h TTL**, schedulable by the 1.1b three-part rule |
| `managerPsychology` packet slice | graded on the **existing** `managerBehaviour` fact profile |
| `managerPsychology` kill switch | eleventh feed, fail-open like the rest |
| serializer rendering | labels + **only the scores that cleared the floor** |

⚠ **`managerBehaviour` already existed in the conclusiveness taxonomy** — needs manager identity,
24h staleness bound. Nothing new was invented for this; the profile anticipated the fact type.

### 🛑 Three things it deliberately does NOT do

1. **It does not re-derive the evidence floor.** `gateScores` already nulls any score below it and
   says a profile written before the counts existed is *"reported as unmeasured rather than
   assumed sufficient"*. The feed carries that decision through. A second floor would be two
   implementations of one rule.
2. **It does not cache the cross-league or cross-sport roll-up.** Those are **viewer-scoped** —
   the answer covers the leagues the viewer and subject share, so it differs per viewer. A
   per-subject cache leaks; a per-viewer cache is always cold. Derived at read (**P5**, **P7**).
3. **It carries no trajectory.** `manager_psych_profiles` is one row per (league, manager),
   overwritten — so *"a rebuilder in 2023, win-now since 2024"* is **unanswerable from the data as
   stored**, not merely unimplemented. Needs §10.2's SQL (**P1**).

### ⚠ `anySufficient` IS THE PRESENCE TEST, NOT `length > 0`

A league can hold twelve profiles where **every one is below its floor**. Rows exist; nothing may
honestly be said. Grading that `present` would put twelve managers of null scores in front of a
model and invite it to characterise them — the *"`[]` presented as available"* failure §5.2 exists
to prevent, reached through a **non-empty** array. That case gets its own `not_computed` gap
naming how many profiles exist and why none can be used.

### 🆕 A fragility this exposed, now fixed

Adding the slice to the serializer's fixed list turned **eight passing tests into TypeErrors** —
their fixture predated the field and `sliceLine` did a bare `s.present`.

🛑 **In production that is worse than a test failure.** `serialize.ts` is the one function between
an assembled packet and the prompt. A packet from an older caller, or a slice added ahead of one
producer, would throw — and the model would receive **nothing** rather than the fifteen slices that
were fine. Now tolerated and pinned by a test that deletes two slices and asserts the rest render.

### Still needs the owner's SQL — §10.2

- **(A)** `format` column → per-(sport, format) profiles (**P3**)
- **(B)** `manager_psych_profile_seasons` → the trajectory (**P1**)

Both are written out in §10.2 and **not applied**. Until (B) lands this feed reports the current
read honestly and claims no history.

### Not verified

9 new tests + 78 across six suites, all green, red-first. **No typecheck yet. No production run.**
Not wired into `/api/cron/domain-os-refresh` — that walk is NFL-only because
`draftRulesSource.sport` is hardcoded, and this source is genuinely all-sport, so adding it needs
that constraint lifted rather than inherited.

---

## 0.15 🛑 BUG — CHIMMY REPORTS LEAGUE SETTINGS IT NEVER READ. LIVE, WRONG ANSWERS.

**Filed 2026-09-02, confirmed in production by the owner. Not caused by any of this work — found
while testing it.**

### Measured

Owner asked production Chimmy, on a league he confirms is **DYNASTY**:

> *"What's Jeremiyah Love worth in King Gingerbeards SF 2026!!!?"*
>
> → *"Jeremiyah Love's FantasyCalc **redraft** value is **3779**… Settings: superflex,
> **12-team PPR**. Source: FantasyCalc current values."*

**The correct dynasty value is 6644** (measured on the same feed the same evening). The answer
**understated a dynasty asset by 43%**, and named settings it had not read.

### Root cause — `lib/ai/deterministic.ts:440-460`

```js
if (!/\b(trade value|fantasycalc|value|worth)\b/i.test(message)) return null
const isDynasty   = /\bdynasty|keeper|future\b/i.test(message)   // ← from the QUESTION TEXT
const isSuperflex = /\bsuperflex|\bsf\b|2qb|two qb/i.test(message) // ← from the QUESTION TEXT
await getFantasyCalcValuesDbFirst({ isDynasty, numQbs: …, numTeams: 12, ppr: 1 })  // ← hardcoded
…
`Settings: ${isSuperflex ? 'superflex' : '1QB'}, 12-team PPR.`   // ← "12-team PPR" is a LITERAL
```

Four fabricated inputs, all presented to the user as their league's settings:

| reported | actually |
|---|---|
| `redraft` | the word "dynasty" was absent from the sentence |
| `superflex` | the league NAME happens to contain "SF" — **right by accident** |
| `12-team` | hardcoded literal, identical for every league |
| `PPR` | hardcoded literal, identical for every league |

🛑 **This is the exact defect the grounding packet exists to prevent: an unsourced value rendered
as a fact.** It is the same family as `DevyPlayer.devyValue` being zero-not-null, and as the
serializer's `available` — except this one is worse, because it does not merely omit the truth, it
**states a specific falsehood with a confident source line** ("Source: FantasyCalc current values").

### Why it was never caught

`tryDeterministicAnswerDetailed` runs at `app/api/chat/chimmy/route.ts:1387` and returns at ~1496.
The grounding packet is not built until **1667**. So **every message containing "value" or "worth"
short-circuits before Decision OS is consulted at all** — the packet's league-aware
`deriveValueFormat` never runs for the one question it was built for.

⚠ **AND THIS INVALIDATES A12 AS A TEST.** The milestone question — *"what's my WR worth?"* — is the
single intent that never reaches this work. Choosing it as the acceptance test meant the first
production check exercised a completely different code path and would have been read as a pass.
**Pick an acceptance test by tracing which code answers it, not by what it sounds like it exercises.**

### The fix is small — the data is already in scope

`leagueId` is resolved at **route.ts:1159** (and refined at 1189), **200 lines before** the
deterministic call. It is simply not passed: `tryDeterministicAnswerDetailed(message, requestLocale)`.

1. Pass `leagueId` through.
2. Resolve the league's real format with **`deriveValueFormat(rules)`** — already written, exported
   and tested in `lib/decision-os/grounding/packet.ts`, reading `general.format` and
   `detectQbFormat(roster.starters)`.
3. Delete the two message regexes and the hardcoded `numTeams` / `ppr` / `"12-team PPR"`.
4. When no league is in scope, **say so** rather than defaulting — a stated default is a claim.

⚠ **Do not "fix" it by deleting the settings line.** Suppressing the sentence hides the wrongness
without correcting the VALUE, which is still fetched with `isDynasty`/`numQbs` derived from the
question text. The price is the defect; the sentence is only how it announces itself.

### ✅ FIXED — `085c5bc85` on base `9b19a3d76`, batch 5

`leagueId` is now passed, the format comes from **`deriveValueFormat`** — the same derivation the
grounding packet uses, so producer and consumer cannot drift — and all four fabricated inputs are
gone. With no league in scope, or rules that will not resolve, the answer **states the basis it
used and that it is not theirs** rather than defaulting silently.

⚠ `deriveValueFormat` / `deriveIdpRules` moved to `grounding/leagueValueFormat.ts` and are
re-exported from `packet.ts`, so no existing importer changed. They moved because this path runs
on **every chat message** and `packet.ts` carries 17 imports including `ChimmyContextEngine`; the
new module has one.

### 🛑 AND THE FIX ALMOST REINTRODUCED THE BUG IT WAS FIXING

**The suite was 68/68 green with a real type error in it.** `FantasyCalcSettings.ppr` is the
literal union `0 | 0.5 | 1` — the market publishes exactly three buckets — and the new helper
returned a plain `number`.

A TE-premium league scoring **1.5 per reception has no bucket**. That value would have been
coerced at the call site into a query for a market that does not exist, **and then printed to the
user as their PPR setting** — BUG-1 exactly, inside the fix for BUG-1.

**Only the compiler objected.** Narrowing the return type made it visible; an unrepresentable value
now returns `null`, the query uses a stated default, and the settings sentence **omits PPR** rather
than inventing one. That is the sixth test.

⚠ **The lesson is about types, not diligence.** Rounding 1.5 → 1 would have passed every test
written for this fix. The union at the boundary is the entire reason it did not ship — which is
the argument for a base/tip typecheck gate over a suite-only one, in one concrete case.

### ⚠ Not verified — carried into the landing report verbatim

- **No production run.** Never executed on a deployment.
- Touches `app/api/chat/chimmy/route.ts`, so it holds its own batch slot: a revert is one commit.
- **Four other `tryDeterministicAnswer` callers** now get honest generic wording instead of the
  false `"Settings: 1QB, 12-team PPR"` claim — `app/api/chimmy` (a dead shim, 0 callers),
  **`app/api/shared/chat/threads/[threadId]/messages` (a real user surface)**, and two in
  `lib/world-cup/worldCupChimmyPrivateReply`. `leagueId` is optional so they compile unchanged and
  the change is strictly an improvement, but it is **a behaviour change on surfaces not tested**.
  Threading `leagueId` into them is a named follow-up, deliberately not done here.
- Only five suites were run, not the full tree.

---

## 0.14 ✅ LANDED — and my "removes 15" was an artifact

**Batch 3 on `origin/main` = `cc57ecea5`** (verified by `ls-remote`).
**(a) = `a545b846a` · (b) = `0c2dd1c33`.**

### The reviewer's gate, which is the authoritative number

```
post-repair base 145   vs   post-repair tip 145
normalized set: 0 appeared / 0 disappeared
zero errors in the 81 changed files
4 of my suites inside a 4,245-passed union
```

### 🛑 CORRECTION TO §0.12 — "removes 15" was measurement noise, not my code

§0.12 reports base **160** → tip **145**, "adds 0, **removes 15**", and offers a mechanism: that
changing `OsStore.write` from `Promise<void>` to `Promise<boolean>` improved inference through the
feed's generic chain, so consumers stopped resolving to `unknown`.

**The mechanism was plausible and it was wrong.** On a healthy base the pair is 145 → 145 with
**nothing appearing and nothing disappearing**. The 15 were the broken generated Prisma client
inflating the *base* run, then clearing — not my commits fixing anything.

⚠ **AND THE REASON IT FOOLED ME IS THE PART WORTH KEEPING.** I argued the delta was safe because
"base, (a) and tip were all measured in ONE environment, minutes apart, same command." That was
the right instinct and still insufficient: **the environment was being repaired while I measured
it.** `prisma generate` was regenerating the type surface across those runs, so my base saw a
more-broken client than my tip. A delta is only meaningful if the environment is *stable* across
both halves, not merely *the same one*.

**The claim that survives is the one that mattered: ADDS 0.** Both my pair and the reviewer's
healthy pair agree on it. "Removes 15" is withdrawn.

### What is now live

⚠ **`DECISION_OS_GROUNDING_ENABLED` has been `true` on the live project since ~2026-09-01**, so
with (b) deployed the packet finally renders what it gathers. Until this deploy it was assembling
facts on every chat turn and serializing them to the word `available` — the spend without the
benefit. **Production verification pending: named prices, the two IDP players rescored, latency
inside the 3 s ceiling.**

---

## 0.13 🛑 RETRACTION — I READ THE WRONG VERCEL PROJECT. THREE FINDINGS ARE WRONG.

**2026-09-02. This invalidates §0.3 and the audit's founding claim. Read it before §0.3.**

### There are two Vercel scopes and I measured the dead one

| | `cafeconchimmy` · `team_2oea…` | `cafeconchimmy-1100s-projects` · `team_xbn5…` |
|---|---|---|
| project | `allfantasy-v2-main` | **`allfantasy-v2-main-a6wc`** |
| state | **dead** — billing-blocked 2026-08-21, no deploys since 08-20 | **LIVE — serves allfantasy.ai** |
| owns the domain | ❌ `vercel domains ls` → **0 domains** | ✅ |
| this machine's CLI | ✅ logged in here | ❌ *"scope does not exist"* |

`.vercel/project.json` links this checkout to the **dead** project, and it is gitignored — a
per-machine link, not a repo defect. **Every `vercel env ls` figure in §0.3 came from the corpse.**

⚠ **`vercel projects ls` ACTIVELY MISLEADS HERE** and nearly made this worse: it prints
`allfantasy-v2-main → https://www.allfantasy.ai` for the dead project — a **stale alias record**
from before the domain moved. Only `vercel domains ls` (0 domains) and `vercel domains inspect`
(*"you don't have access"*) settle it. One more lookup returning a plausible value for a question
it is not answering.

### The three corrections

| § | claim | verdict |
|---|---|---|
| **G1** | *"`DECISION_OS_GROUNDING_ENABLED` does not exist — the packet has never run in production"* | 🛑 **WRONG.** It is `true` on the live project, **Production AND Preview**, added ~2026-09-01. **The packet has been running for about a day.** |
| §0.3 | *"`FANTASY_OS_EXEC_SYNC_LIVE` is a `Config`-type JSON blob, so the collector is silently off"* | ⚠ **UNVERIFIED.** On the live project it is a normal encrypted Production var; the JSON-blob shape was the dead project's. Value hidden — **not proven either way.** |
| §0.3, §3 | *"`DECISION_OS_BASE_URL` is Preview-only, so Commissioner OS is demo-mode in production"* | 🛑 **WRONG.** Present in **Production AND Preview** on the live project. |

### 🛑 What G1 being wrong actually means — it makes (b) URGENT, not optional

The flag is **on**. The code that makes it worth having is **not deployed**. So for roughly a day,
production Chimmy has been:

- building the grounding packet on **every chat turn**, on the highest-traffic route
- paying ~1.7 s of assembly for it
- receiving the **old** serializer's output — the word `available` per slice, **zero values**

**The cost is already being paid; (b) is what converts it into facts.** The audit's conclusion
("the packet is off and needs turning on") inverts to: *the packet is on and has been delivering
nothing.* Same fix, considerably more urgency.

### What survives, and why

Everything derived from **source or live execution** is untouched — none of it depended on env
output: the serializer never reading `slice.value` (0 occurrences, read from the file), the narrow
`want` flags (read from the route), the value lane working end-to-end in a production build against
the production database, and both commits' typecheck and suite numbers.

### ⚠ The lesson, which is the same one this file keeps recording

`.vercel/project.json` was present the whole time and names the project in one line. **I treated
CLI output as production truth without checking which project the CLI was pointed at** — the
environment equivalent of §0.8's dev-server error, where every figure was correctly measured in the
wrong place. A tool that answers confidently about *something* is not the same as a tool answering
about *your thing*.

**Rule: before quoting any `vercel` output as production, verify the scope** —
`vercel whoami`, `vercel teams ls`, and `cat .vercel/project.json`.

---

## 0.12 LANDING STATUS — two commits, one staged, one held

Owner's decision 2026-09-02: **stage (a), hold (b).** Reviewer session gates every push;
this session pushes nothing.

| | SHA | base | contents | state |
|---|---|---|---|---|
| **(a)** | `438371366` | `967b95f94` | domain-OS `write_failed` fix — **no user request path** | ✅ **in batch 3** |
| **(b)** | `ad79b9c7c` | on (a) | packet · values · chat route · docs | ⏸ **held** |

**Why the split earned itself twice.** It was proposed as a risk split — (a) touches only a cron,
(b) touches the highest-traffic route. It then paid a second time by accident: when a peer's
interrupted `npm install` emptied `node_modules/.bin` and broke the generated Prisma client, the
one test file that could not load belonged to **(b)**. Staging (a) alone sidestepped the outage
entirely.

### 🛑 THE MEASUREMENT LESSON, WHICH IS THE DURABLE PART

**A total is not a measurement unless you took the baseline yourself, in the same environment.**

Three sessions measured the *same commit* `967b95f94` and got **145**, **160** and **220**. Nobody
was careless; the generated Prisma client was in a different state each time, and a missing type
surface **inflates** errors in prisma-importing files (`TS7006` / `TS2339` / `TS2322` clustered
there) rather than zeroing them — so the failure does not look like a failure.

⚠ **And it nearly produced a wrong report in BOTH directions.** Carrying the reviewer's 145 would
have attributed someone else's artifact to this commit. Then (a) measured **148** and the obvious
reading was *"(a) adds 3"* — also wrong. The truth only appeared after measuring the base in the
same worktree, same command, minutes apart:

```
base 967b95f94   160
(a) 438371366    148     ADDS 0, REMOVES 12
(a)+(b) tip      145     ADDS 0, REMOVES 15
```

Set comparison, not counts. The arithmetic reconciles exactly: 160 − 12 − 3 = 145.

⚠ (a) removes ten errors **in files it does not touch** — `waiver-ai/engine`, `lineup/shadowSweep`.
Changing `OsStore.write` from `Promise<void>` to `Promise<boolean>` improved inference through the
feed's generic chain, so consumers stopped resolving to `unknown`. **A signature change propagating
into consumers — the mechanism that usually breaks them, running the other way.**

**The rule now applied by the reviewer to every session: gate on a base/tip pair measured in ONE
environment, never on a bare total.**

### The staleness check that misfires on this branch

`git log <tip>..<base> -- <path>` flagged **10 of 14** of these paths as stale, listing 11
"missing" commits on `packet.ts` alone. **All false positives.** A cherry-pick renames every
commit, so main holds that work under different SHAs and the log reports it absent *by name*
while the bytes match.

Settled by content, which is now the required test:
- `git rev-parse <base>:<path>` == `git rev-parse <copyParent>:<path>` — **14/14 identical**
- `git patch-id --stable` — **`7c7db5cdd…` identical** for the picked diff and the original

This is the CLAUDE.md merge-base trap reached from the opposite side: there ancestry wrongly says
*"not on main"* about shipped work; here it wrongly says *"missing from your copy"* about work
already in it. **Only a content comparison settles either.**

---

## 0.11 ✅✅ VERIFIED IN A PRODUCTION BUILD — the value lane executed, 2026-09-02

`next build` → `next start`, real league, real production database. **The first time the
valuation lane has ever run.**

### R1.1 confirmed — values arrive NAMED and PRICED

```
- Market player values: available (served from store)
    · Jeremiyah Love (RB) 6644 market_units, rank 16
    · Bucky Irving (RB) 3035 market_units, rank 76
    · Jordan Addison (WR) 2072 market_units, rank 105
    · …and 427 more not shown (Market player values holds 435)
```

Before this change that entire block was the single word `available`. Note **served from store** —
the `domain_os_facts` table F1 created is doing the work.

### 🛑 R1.2 confirmed, and the evidence is sharper than a pass/fail

```
· Khalil Mack (LB)   3.8 pts — rescored for this league
· Jonas Sanker (DB)  4.2 pts — rescored for this league
· Ladd Mcconkey (WR) 13.1 pts — canonical preset, NOT this league
· Ashton Jeanty (RB) 14.8 pts — canonical preset, NOT this league
```

**Exactly the two IDP players rescored; every offensive player did not.** That is precisely
correct — `rescoreIdpForLeague` only rescores rows carrying IDP component amounts, so an offensive
projection legitimately keeps its canonical value and the label says so.

⚠ **And the numbers MOVED.** Against the pre-R1.2 run on the same league: Khalil Mack 4.4 → 3.8,
Jonas Sanker 4.3 → 4.2. This league's own scoring is now being applied. A test could have shown
`rescored: true`; only the live run shows the number changing under real rules.

### Latency — no regression, and the cold hit is not the number

| run | buildMs |
|---|---|
| 1 (cold) | 3137 ❌ |
| 2–5 | **1384 · 1733 · 2101 · 1372** ✅ |

Steady state is **under the 3000 ms ceiling with the value lane ON**, and within noise of the
1730–1782 ms measured before it existed. The extra slice costs effectively nothing.

⚠ `marketValues` and `projections` report **identical** timings every run (837/837, 1083/1083,
1325/1325). That is the one deliberate dependency R1.2 introduced — both chain off `pRules` — and
it is visible in the data rather than merely asserted.

### 🆕 Three findings the live run produced

1. **`oldestAsOf` is working and it changed the verdict.** Projections now read *22 days old*
   rather than the arbitrary *13 days*, which is the honest figure — and it is old enough that
   the conclusiveness machinery now marks the slice **PRESENT BUT NOT SAFE TO ACT ON**. The fix
   did not just correct a label; it corrected a decision.
2. ⚠ **Ten gap lines, eight of them identical.** Every context slice reports the same
   `teams_rosters did not finish syncing`. Correct, and repetitive enough to crowd the prompt.
   Worth collapsing shared-cause gaps into one line. **R1.6.**
3. ⚠ **This league's `teams_rosters` scope is genuinely failing to sync**, which is why eight
   slices are inconclusive. Not a packet bug — the packet is reporting a real import problem
   accurately, with a real remedy. **R1.7** to investigate the sync itself.

---

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

## 0.3 ⛔ SUPERSEDED — measured against the DEAD Vercel project. See §0.13.

🛑 **DO NOT QUOTE ANY ENV FIGURE IN THIS SECTION.** It was read with
`vercel env ls` against `cafeconchimmy/allfantasy-v2-main` — the billing-blocked
team with no deploys since 2026-08-20. The live site is served by
`allfantasy-v2-main-a6wc` in `cafeconchimmy-1100s-projects`. **§0.13 carries the
corrections**; the section is kept below rather than deleted so the error is
legible and nobody re-derives it.

Run by the owner, 2026-09-01, against `cafeconchimmy/allfantasy-v2-main`.
**One claim confirmed, three corrected, three new findings.**

### 🛑 RETRACTED — G1 IS WRONG. THE FLAG IS SET AND THE PACKET HAS BEEN RUNNING.

**The text below is false.** On the LIVE project `DECISION_OS_GROUNDING_ENABLED`
is `true` in **Production and Preview**, added ~2026-09-01. See §0.13 for what
that means — the packet has been assembled and paid for on every chat turn for
about a day while returning no values, which makes commit (b) urgent rather than
optional.

~~**`DECISION_OS_GROUNDING_ENABLED` does not exist in Vercel at all** — not in
Production, not in Preview. Nor does any `DECISION_OS_FEED_*` kill switch.~~

~~**The Decision OS grounding packet has never run in either environment.** The
earlier finding was read from a committed file; it is now read from the control
plane. G1 is not an inference any more.~~

⚠ The `DECISION_OS_FEED_*` half is **unverified**, not retracted — those kill
switches were absent from the dead project and have not been checked on the live
one. Absence there would still mean every feed defaults on, which is the
fail-open behaviour `flags.ts` intends.

### ✅ CONFIRMED — the four engines really are live in production

`DECISION_OS_LINEUP_LIVE` · `WAIVER_LIVE` · `TRADE_LIVE` ·
`COMMISSIONER_HEALTH_LIVE` — all present in **Preview + Production**, alongside
their `_SHADOW` counterparts and six trade shadow variants. §1's two-pipeline
finding holds.

### ⚠ CORRECTED #1 — RETRACTED IN §0.13: this was the DEAD project

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

### 🛑 CORRECTED #2 — WRONG, see §0.13: DECISION_OS_BASE_URL IS in Production

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

### R4 — Identity OS · new → 80% · ✅ 2026-09-03, see §0.24

- **R4.1** ✅ Re-run the coverage audit for current figures.
- **R4.2** ✅ One source, one assertion, one packet slice — landed as a fifth
  field on the EXISTING `ImportAssertions`/`importAssertions` slice rather than
  a new one, since it already flows through the packet unmodified.
- **R4.3** ✅ Give `unresolved_identity` a producer. `minIdentityResolution` on
  `lineupDecision`'s `FactDependency`, wired into `isConclusive()`.

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
| **R4b.5** | Trajectory + cross-league + cross-sport reads, **derived not cached** (**P1/P5/P7**) | ✅ 2026-09-03, see §0.25 |
| **R4b.6** | Chimmy narrates from the facts — **no stored prose** (**P2**) | ✅ 2026-09-03, see §0.26. Also surfaced a significant, cross-cutting gap — see the same section. |
| **R4b.7** | Wire into recommendations as **framing only** (**P4**) | ✅ 2026-09-03, see §0.27. **All of R4b (R4b.1–7) is now done.** |

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
| ✅ | **R0.4** Hit `/api/cron/fantasy-os-exec-sync`, read `reason` | **Done 2026-09-03 — and it REFUTES §0.3.** Answered WITHOUT calling the endpoint: the collector demonstrably runs. 38 leagues attempted and 35 succeeded in two hours, newest success 81 seconds before the reading. The route returns the disabled `reason` and syncs NOTHING unless `FANTASY_OS_EXEC_SYNC_LIVE === 'true'`, so live writes prove the gate passes. **Import OS is not gated.** §0.35 |
| ✅ | **R0.5** Confirm what `TRADE_OS_VALIDATION_DATABASE_URL` points at | **Done 2026-09-03. NOT usable for W2 — the endpoint is STALE.** Host `ep-hidden-block-ad77fprp` / db `mydb_shadow`, versus production `ep-curly-block-ad0dlt9o` / `neondb`. Genuinely a different database, but a dead one: `docs/redraft/PHASE_NEXT_BASELINE_AND_PATH_DECISION.md` already recorded it matching no live compute endpoint across the account's 5 Neon projects, and §0.18's endpoint census found exactly one active. Zero code reads it. §0.35 |
| ✅ | **R1.1** Render slice values (**G11**) | **Done 2026-09-02.** Proved red→green, 48/48. Also added `playerName` to the anonymous value contract, and fixed an arbitrary-element `asOf`. Typecheck blocked by a peer's mid-edit file. §0.9 |
| ✅ | **R1.4** Order the bounded rows by relevance | **Done 2026-09-03.** `orderByRosterRelevance` promotes the asker's own players (starters + bench, punctuation-normalised names) as a stable partition; no-op without a roster, nothing dropped, and the hidden-count line says the rows are roster-scoped rather than top-valued. 11 tests, mutation-verified. §0.34 |
| ✅ | **R1.2** Ask for the value lane (**G2**) | **Done 2026-09-02.** Gate was double-locked; packet now derives `valueFormat` + `leagueIdpRules` from rules it already loads. Red→green, 63/63. Typecheck deferred — machine contention. §0.10 |
| ⬜ | **R1.5** 🆕 Devy for C2C / devy-slot NFL dynasty leagues | The NCAAF sport test will not find them. §0.10 |
| ✅ | **R1.6** Collapse gaps that share one cause | **Done 2026-09-03.** `collapseGapsByCause` groups on reason+detail+remedy and names every affected fact in one line; presentation only, `packet.gaps` unchanged. 10 tests, mutation-verified. §0.33 |
| ⏸ | **R1.5** Devy for C2C / devy-slot NFL dynasty leagues | **Deferred 2026-09-03 — real gap, ZERO beneficiaries.** devy_league_configs, devy_leagues and leagueVariant~devy are all 0 rows; the board itself has 1,721 players. Every fix costs a per-turn query or serializes devy behind rules, and nothing carrying `leagueVariant` is in scope at the gate. Fix located and trigger recorded. §0.38 |
| ✅ | **R1.5** Devy for C2C / devy-slot NFL dynasty leagues | **Done 2026-09-03.** `deriveWantsDevyBoard` reads `general.variant` from rules the packet already loads — no new query, and the NCAAF path stays fully parallel. Population is still zero, so this closes a LATENT defect. 9 tests; two bugs caught during the build (resolution gate, and board-applies vs caller-asked). §0.38 |
| ⬜ | **R1.6** 🆕 Collapse gaps that share one cause | 8 identical `teams_rosters` lines crowd the prompt. §0.11 |
| ⬜ | **R1.7** 🆕 `teams_rosters` scope is failing to sync on live leagues | Makes 8 slices inconclusive. Real import bug, correctly reported. §0.11 |
| ✅ | **R1.3** Turn `DECISION_OS_GROUNDING_ENABLED` on | **ALREADY DONE ~2026-09-01, on the live project** — `true`, Production and Preview. I reported it absent because I read the dead Vercel team. 🛑 It has therefore been running for a day WITHOUT the code that makes it useful, which is why (b) is urgent. §0.13 |
| ✅ | **BUG-1** **Chimmy states league settings it never read** | **FIXED 2026-09-02 — `085c5bc85` on base `9b19a3d76`, accepted into batch 5.** Pair 145→145, **0 appeared / 0 disappeared**; 69/69 suites on the commit; 5 files, 0 D lines; MIGRATION no. Six tests, all red-first. **§0.15** |
| ⚠ | **BUG-2** **25% of league syncs failing — `PostgresError 25006`** — **INCIDENT CLOSED, AFTERMATH OPEN** | **NOT live.** A 17-minute incident: 2026-09-02 05:00:21 → 05:17:47, zero since (~39 h). The open half is the AFTERMATH — no league in `partial`/`failed` has EVER been retried (0 of 37, ~78 missed cycles), so 20% of the portfolio serves data frozen at 09-02 04:01 while the serializer promises an automatic retry. **§0.30** supersedes §0.18. |
| ⚠ | **BUG-3** ~~Duplicate league rows share one `platformLeagueId`~~ **— PREMISE DISPROVEN** | Not duplicates: a League row is per importing USER, by design (`enumerate.ts`), and there are THREE rows with three different userIds, not two. No fuzzy name-match serves them either — leagues resolve by `userId`. The real defect was 23 users served a blank while an identical sibling mirror held profiles. **Fixed read-side; §0.32.** |
| ⚠ | **BUG-4** ~~`isDynasty` false on a dynasty league~~ **— PREMISE DISPROVEN; it is a KEEPER bug** | Sleeper reports the example league as `settings.type = 1` = **KEEPER**, so `isDynasty=false` was CORRECT and dynasty capture is fine — `leagueType`/`isDynasty` agree on all 225 leagues (110 dynasty). The real defect was that KEEPER was captured nowhere, leaving `isKeeper` false for 100% of leagues. **Fixed; §0.29** supersedes this row's original claim. |
| ⬜ | **R1.8** 🆕 Re-check `DECISION_OS_FEED_*` kills on the LIVE project | Never verified there; absence = fail-open, which is intended. §0.13 |
| ✅ | **R1.9** Re-check `FANTASY_OS_EXEC_SYNC_LIVE`'s VALUE on the live project | **Resolved 2026-09-03 by R0.4's evidence, not by reading the var.** It is encrypted and unreadable, but the collector's own writes settle it: syncs are landing, and they cannot land unless the value is exactly `'true'`. §0.35 |
| ⬜ | **R1.3** Turn the grounding flag on (**G1**) | R1.2 |
| ✅ | **R2** Bridge the 4 live engines into the packet | **Done 2026-09-03.** lineupDecision + commissionerHealthDecision producers, opt-in, wired end to end. §0.21 |
| ✅ | **R3** Finish Player Value OS | **Done 2026-09-03.** R3.1 idpKicker (§0.22), R3.3 rosterValueGrade + the other two value questions (§0.23). |
| ✅ | **R4** Identity OS | **Done 2026-09-03.** `playerIdentityCoverage` assertion + `minIdentityResolution` gating on lineupDecision. §0.24 |
| ✅ | **R4b** Manager Psychology OS into the hub | **Done 2026-09-03 — all of R4b.1–R4b.7.** §0.25, §0.26, §0.27. |
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

### 10.4 ✅ R4b.3 — score columns must allow NULL (**APPLIED BY OWNER 2026-09-02**)

> ✅ **Applied.** Verified by effect: `information_schema` reports `is_nullable = YES` for all five
> score columns and `NO` for `sampleSize`. The matching code change shipped with it — see §0.20.
>
> ⚠ **One hardening was NOT applied and is still open.** `DROP NOT NULL` does not drop the
> `DEFAULT 0`, so an INSERT that *omits* one of these columns still writes `0` rather than `NULL`.
> Nothing on the current path can hit it — our writer names all fifteen columns — but a future
> writer that omits one silently reintroduces the whole bug. Your call:
>
> ```sql
> ALTER TABLE "manager_psych_profile_seasons"
>   ALTER COLUMN "aggressionScore"     DROP DEFAULT,
>   ALTER COLUMN "activityScore"       DROP DEFAULT,
>   ALTER COLUMN "tradeFrequencyScore" DROP DEFAULT,
>   ALTER COLUMN "waiverFocusScore"    DROP DEFAULT,
>   ALTER COLUMN "riskToleranceScore"  DROP DEFAULT;
> ```
>
> `sampleSize` keeps its `DEFAULT 0` — zero observations is a real answer.

**Original handover, kept for the record:**

**Why**, in one line: the five score columns are `NOT NULL DEFAULT 0` and the writer coalesces
`null → 0`, so *"never measured"* is stored as *"measured, and the answer was zero"*. That is the
failure the evidence floor exists to prevent. See §0.20.

⚠ **Do not run this alone.** It is inert — and slightly misleading — without the matching code
change removing the `?? 0` coalesce in `ProfileSeasonSnapshot.ts`, because the writer would keep
sending zeros into columns that now permit null. Apply the pair, or neither.

```sql
ALTER TABLE "manager_psych_profile_seasons"
  ALTER COLUMN "aggressionScore"     DROP NOT NULL,
  ALTER COLUMN "activityScore"       DROP NOT NULL,
  ALTER COLUMN "tradeFrequencyScore" DROP NOT NULL,
  ALTER COLUMN "waiverFocusScore"    DROP NOT NULL,
  ALTER COLUMN "riskToleranceScore"  DROP NOT NULL;
```

⚠ **`sampleSize` is deliberately NOT in that list.** Zero observations is a real, measured answer;
zero aggression is not. That asymmetry is the whole point and dropping `NOT NULL` on `sampleSize`
too would erase it.

**The 97 existing rows are not repaired by this.** Their zeros are already ambiguous and no query
can separate the genuine from the unmeasured. They will correct themselves as each manager's next
refresh upserts over them — no backfill needed, but until then treat any `0` score in that table
as unreliable.

---

## 11. Provenance

Read-only census of the working tree at `commish-os/phase-0-1b`, 2026-09-01.
No source modified. Method: per-OS census across seven axes using file reads,
symbol greps for every import form, `cron-schedule.json`, and the committed env
files.

⚠ **Not measured here:** production environment variables (Vercel dashboard),
production database state, and live latency after the packet's parallelisation.
All three are named as checks in R0 rather than assumed in the tables above.
