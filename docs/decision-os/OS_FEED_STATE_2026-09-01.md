# Decision OS — feed state audit **and build plan**, 2026-09-01

> **Contents:** §1–§4 audit (what is wired, what is not, measured) · §5 the
> owner's answers · §6 the ordered plan · §7 traps · §8 still open.

**Read [`HUB_BUILD_PLAN.md`](./HUB_BUILD_PLAN.md) first.** That file is the
owner-directed plan (2026-08-31) and holds the decisions D1–D17, the measured
findings, and the phase ledger. **This file is not a rival plan.** It is a
point-in-time audit of *what is actually connected right now*, written because
the question "is every OS feeding Decision OS, and is Decision OS answering
Chimmy correctly" needed an evidence-backed answer rather than a recollection.

Where this file and the build plan disagree, **the build plan's ledger is the
authority on intent** and this file is the authority on current wiring.

> Method note: every row below is either a file path + line, a grep census, or a
> config read. Nothing here is inferred from a module's name or from a comment
> alone — this repo's own CLAUDE.md records four separate occasions where a
> census that stopped at "who imports it" gave the wrong answer.

---

## 1. The map — what exists

### 1.1 Decision OS itself

`lib/decision-os/` — **287 TypeScript files**. The hub.

| Layer | Path | What it is |
|---|---|---|
| Feed kernel | `domain-os/{types,feed,store}.ts` | Generic read-through feed + TTL'd store over `DomainOsFacts`. Domains declare *what* they gather; the kernel serves it identically for all of them. |
| Per-domain feeds | `{lineup,waiver,trade,draft,league,value,projection,import}-os/index.ts` | The eight `OsDomain` producers. |
| Grounding packet | `grounding/packet.ts` | `buildDecisionOsGroundingPacket()` — **the one object Chimmy is designed to read.** |
| Conclusiveness | `conclusive.ts` | Per-fact-profile verdicts, so a stale import refuses *the affected claims* rather than the league. |
| Value contract | `value/contract.ts` | `CanonicalValue` — one shape, four producers, required `unit`. |
| Reasoning | `three-brain/` | DeepSeek ∥ Grok → OpenAI synthesis → optional Claude review. Read as a **saved** conclusion, never run inline. |
| Kill switches | `flags.ts` | Ten per-feed kills, env OR db, fail-**open**. |
| Decision engines | `{lineup,waiver,trade,commissioner-health}/` | Canonical decision objects with shadow + parity machinery. |
| Presentation | `presentation/`, `sdk/` | Widget contracts, white-label, partner SDK. |

### 1.2 The other "OS" modules, and which way the arrow points

**This is the single most confusable thing in the codebase and the kernel's own
header calls it out.** Same suffix, opposite direction:

| Module | Direction | Note |
|---|---|---|
| `lib/decision-os/*-os/` | **FEEDS →** Decision OS | The eight domain producers. |
| `lib/commissioner-os/` | **← CONSUMES** Decision OS | Its `*/decision-os-client/` modules call *into* Decision OS to render a surface. |
| `lib/fantasy-os/` | **FEEDS →** (via import) | Sleeper/Fantrax sync collector, exec intelligence, sports-runtime integrations. |
| `lib/sports-os/` | Sideways | Readiness / identity-health / reconciliation services. Reporting, not a feed. |
| `lib/decision-os-core/` | Pure | Primitives, sport-adapter and provider-adapter registries. No IO — has a `no-live-imports` test. |

### 1.3 The producers you asked about

| Producer | Module | Adapter | Feed source | In the packet? |
|---|---|---|---|---|
| Offense / market | `PlayerValueSnapshot`, `fantasycalc-db`, `trade-value/valueEngine` | `value/marketAdapter.ts` | ✅ `value-os` `market` (app, 6h) | ⚠ only if `want.values` **and** `valueFormat` |
| IDP | `lib/idp-projections/{idpValuation,idpTradeValues,leagueIdpVorp}` | `value/idpKickerAdapter.ts` | ❌ **none, deliberately** | ❌ **no slice exists** |
| Kicker | `lib/kicker-values/{leagueKickerValue,loadLeagueKickerValue}` | `value/idpKickerAdapter.ts` | ❌ **none, deliberately** | ❌ **no slice exists** |
| College / devy | `lib/devy/devyValueBoard`, `trade-intel/devyTradeValue` | `value/devyAdapter.ts` | ✅ `value-os` `devy` (app, 12h) | ⚠ only if `want.devy` |
| AF Projections | `lib/af-projections/` | `projection/facts.ts` | ✅ `projection-os` `canonical` (app, 6h) | ✅ requested by the chat route |
| Platform imports | `lib/fantasy-os/sync/collector/` | `import/assertions.ts` | ✅ `import-os` `assertions` (league, 5m) | ✅ always |

The **IDP/kicker omission is a documented design choice, not an oversight**:
`loadIdpKickerValues` is parameterised by `rosterPlayerIds`, so it prices a
*roster*, not a board. A cache key would have to encode the roster set. See the
header of `value-os/index.ts`. **But the consequence is real and is not written
down anywhere the packet's consumers can see it:** there is no path by which
"what is my linebacker worth" is answerable from the grounding packet.

---

## 2. The gaps — measured

### G1 — The packet has never run in production 🛑

`/api/chat/chimmy` gates the whole thing:

```ts
process.env.DECISION_OS_GROUNDING_ENABLED === 'true' && leagueId
```

`app/api/chat/chimmy/route.ts:1667`

**Census of every env file in the repo — the variable is absent from all of
them:** `.env`, `.env.local`, `.env.staging`, `.env.production`, `.env.example`.

So Chimmy is still grounded by the *old* path. The build plan says this in its
own words at §2.18: *"4.2 shipped behind `DECISION_OS_GROUNDING_ENABLED`, which
is off, so the packet has never run in production."*

⚠ **This also blocks plan item 4.5** (retiring `/api/chimmy`), correctly — you
cannot retire the old grounding while its replacement has never executed.

### G2 — Valuations never reach Chimmy, even with the flag on 🛑

```ts
want: { projections: true, leagueRules: true }
```

`app/api/chat/chimmy/route.ts:1674`

Four things are missing from that call, and each independently kills a lane:

| Missing arg | Consequence |
|---|---|
| `want.values` | `marketValues` reports `not_requested`. Offense/market prices never assembled. |
| `want.devy` | `devyValues` reports `not_requested`. The college board never assembled. |
| `valueFormat` | Even with `want.values: true`, the market slice is skipped — the guard is `want.values && args.valueFormat`. `packet.ts:690` |
| `leagueIdpRules` | Projections arrive **canonical, not rescored**. Per `projection-os/index.ts`, the canonical value is *balanced*-IDP, "materially wrong for a tackle-heavy league". `ProjectionFact.rescored` will read `false`. |

**The default is more generous than the call site.** `packet.ts:481` defaults to
`{ values: true, projections: true, leagueRules: true }` — so the chat route is
narrower than the packet's own default, and *removes* the value lane.

### G3 — IDP and kicker have no packet slice

Covered in §1.3. `DecisionOsGroundingPacket` has fields for `marketValues`,
`devyValues` and `projections`. There is no `idpKickerValues`. The adapter is
built, tested and callable; nothing on the Chimmy path calls it.

### G4 — The packet exceeded its own ceiling

Measured on live leagues 2026-09-01 and recorded in `packet.ts`:

```
buildMs   5441 / 5354 / 6178      ceiling 3000
engineMs   457   ← twelve context providers, already concurrent
the rest  4984   ← eight independent reads, awaited serially
```

**The `Promise.race` ceiling abandons the result; it does not cancel the work.**
Every read still completes and is still billed. A routinely-late packet is
therefore strictly *worse* than a disabled one — and indistinguishable from it
from outside.

The waterfall has since been parallelised (`kick()` in `packet.ts`). **The
post-fix number has not been re-measured on a live league.** That measurement is
the precondition for G1, not an optimisation to do afterwards.

### G5 — `domain_os_facts` has no migration ⚠

- Model present: `prisma/schema.prisma:16182` (`@@map("domain_os_facts")`)
- Added by: `f539b4016` *"Waiver OS and Trade OS, on a kernel the three feeds share (#580)"*
- **Zero matches** for `domain_os_facts` in `prisma/migrations/` (152 dirs) or `prisma/migrations-pending/` (9 dirs)

`domain-os/store.ts` is written to survive this — `delegateOf()` returns
undefined and reads fall through to live derivation, and every failure path is
swallowed. **So the symptom is not an error. It is that the store silently does
nothing:** every `get` misses, every `write` no-ops, and D5's "precomputed,
always warm" is not in effect anywhere.

🛑 **This is not proof the table is absent in production** — CI uses
`prisma db push` (`.github/workflows/{playwright,performance-budget}.yml`), and
production could have been pushed by hand. **It is a check to run, not a
conclusion.** But if the table *is* absent, it also explains G4 exactly: a
5-second packet is what you get when every feed derives live on every turn.

A migration is a deploy decision that belongs to the owner, per this repo's
push convention. It is not pushable on an author's say-so.

### G6 — The refresh cron warms 2 of 8 domains

`app/api/cron/domain-os-refresh/route.ts` walks exactly two sources:

| Source | Status |
|---|---|
| `draftRulesSource` | ✅ warmed — but its only consumer, `resolveNflRedraftDraftRuntime`, has **zero callers**. A writer filling a cache nobody reads. |
| `waiverSettingsSource` | ✅ warmed, genuinely read. |

Ineligible, each for a stated reason: `tradeSettingsSource` (keyed on a season
the walk does not have), `leagueRulesSource` (60s TTL — expired before the next
30-min fire), lineup sources (user- and week-parameterised).

**Scoped NFL-only**, because `draftRulesSource.sport` is hardcoded `() => 'NFL'`.

### G7 — Value and projection sources are schedulable but unscheduled

`value-os/index.ts` says so explicitly: both sources are app-level with long
TTLs and derives satisfiable from the scope key, so they *are* legitimate
`refresh()` targets — *"They are not wired into it yet: that cron walks LEAGUES
and these are keyed on sport+format, so it needs a second walk rather than a
bigger list."*

Same is true of `canonicalProjectionSource`.

### G8 — Sleeper transactions were never written

Plan item 6.4, scoped in `docs/decision-os/SLEEPER_HISTORY_SCOPE.md`, not
started. `SleeperHistoricalBackfillService` orchestrates three siblings (draft,
matchup, season state); **transactions was never written**, so Sleeper trades
and waivers reach the DB only via a hand-run script and waiver claims not at
all. The import already fetches 18 weeks of `/transactions` per league and
discards the normalized array.

⚠ **Order matters: schedule the orchestrator BEFORE adding the fourth service,**
or it is the `ingestCFBDStats` failure again — a surface pointed at a table
nothing refreshes.

### G9 — Chimmy surface sprawl

**15** `app/api/**/*chimmy*` route directories. Established by the build plan
(§2.1, §2.18) and re-confirmed here:

- `/api/chat/chimmy` — **canonical.** The one with the packet wiring.
- `/api/chimmy` — a shim that forwards to `postChatChimmy`. **Zero callers.**
  Three docs claim it is the preferred entry point; all three are stale.
- `/api/ai/chimmy` — **not a chat route.** One branch of a settings-panel family
  taking `{ leagueId }`. Was misclassified as a duplicate; it is not.
- The remaining twelve are surface-specific (`start-sit`, `survivor`, `zombie`,
  `big-brother`, `trade-value`, autocompletes, personalization).

**None of the twelve surface routes reads the grounding packet.** Whether they
should is a product question, not a defect.

### G11 — 🛑 THE SERIALIZER EMITS A MANIFEST, NOT DATA. THIS IS THE BIGGEST ONE.

**`serialize.ts` never reads `slice.value`. Zero occurrences in the file.**

`sliceLine()` is the entire rendering of a present fact:

```ts
function sliceLine(name: string, s: GroundedSlice<unknown>, now: number): string | null {
  if (!s.present) return null
  const bits: string[] = []
  const age = ageLine(s.asOf, now)
  if (age) bits.push(age)
  if (s.servedFrom) bits.push(`served from ${s.servedFrom}`)
  if (s.confidence != null) bits.push(`confidence ${s.confidence.toFixed(2)}`)
  const meta = bits.length ? ` (${bits.join(', ')})` : ''
  const blocked = !s.conclusive.ok ? ' — PRESENT BUT NOT SAFE TO ACT ON, see gaps below' : ''
  return `- ${name}: available${meta}${blocked}`
}
```

So what reaches the model is:

```
WHAT IS AVAILABLE:
- Market player values: available (4 hours old, served from store)
- Projections: available (6 hours old, served from store)
- Roster: available (12 minutes old, served from live)
```

**Not one number. Not one player name. Not one projection.**

⚠ **This is orthogonal to G1 and G2, and it survives fixing both of them.** Turn
the flag on, add `want.values` and `valueFormat`, migrate the table, warm every
feed — and Chimmy is still told *that* market values exist, never *what they
are*. It cannot answer "what is my WR worth" from this packet, because the
answer was assembled, graded, serialized to the word `available`, and dropped.

⚠ **It affects the prose slices too.** `commissionerIntelligence`,
`leagueIntelligence`, `portfolio` and `savedAnalysis` are all
`GroundedSlice<string>` — already prompt-ready text — and `sliceLine` reduces
each to `available` as well. **three-brain's saved conclusion never reaches the
model either.** That is the substance of plan item 6.2, serialized away.

**The gaps half is complete and correct.** `WHAT IS MISSING, AND WHY` renders
`detail` and `remedy` in full, plus a standing instruction. So the packet today
is a rigorous, well-defended **refusal engine** with no assertion half: it is
extremely good at saying what it cannot tell you and structurally incapable of
telling you anything.

🛑 **Why this survived, and it is the pattern this repo keeps recording.** The
serializer's own header says the gaps "are the point, not an appendix" — and it
is right, that WAS the hard half and the half everyone gets wrong. The available
half was the easy one, so it was written first, thinly, and never revisited. The
file's tests assert the gap rendering. **A packet that renders no values passes
every test in the suite**, because nothing asserts a value appears.

⚠ **AND THE MEASUREMENT IN G4 IS THE TELL NOBODY READ.** The packet spends
~5.4 seconds assembling `ValueLookup[]`, `ProjectionFact[]`, rosters and
matchups — and then emits ~10 lines of the word "available". The cost and the
output have been wildly out of proportion the whole time, and the latency
investigation stopped at *why is it slow* without asking *what did we get*.

**The fix is small and it is the highest-value change in this document:** render
each present slice's `value`, bounded — top-N by relevance to the question,
never the whole board — with the age/confidence meta kept as-is. It does not
touch the feeds, the kernel, the flags or the grading. It is one function.

⚠ **Bound it deliberately.** `marketValues` and `devyValues` are whole boards
and `contextFacts.rankings` carries difficulty ratings for ~400 leagues
(measured, `packet.ts`). Rendering them raw would blow the context window and
re-create the latency problem in tokens. Relevance-filtering against the
question is part of the change, not a follow-up.

### G10 — Crons live outside `vercel.json`

`vercel.json` has **0** crons. `cron-schedule.json` has **54**, fired by
`.github/workflows/cron-{fast,slow}-tier.yml`. `scripts/cron-tier.mjs` and
`lib/production-health/cronRegistry.ts` read `cron-schedule.json` first and fall
back to `vercel.json`.

Relevant entries, all present and scheduled:

| Cron | Schedule | Feeds |
|---|---|---|
| `/api/cron/domain-os-refresh` | `*/30 * * * *` | draft + waiver settings |
| `/api/cron/compute-projections` | daily | `AFProjectionSnapshot` → `projection-os` |
| `/api/cron/adp-refresh` | daily 10:00 UTC | `ingestPlayerValues` → `value-os` market |
| `/api/cron/import-players` | `0 */6 * * *` | devy pool → `value-os` devy |
| `/api/cron/decision-os-*` | 3 entries | intelligence maintenance, activity ingest, snapshot capture |
| `/api/cron/fantasy-os-exec-sync` | `*/30 * * * *` | exec intelligence |

**The producer writers are scheduled.** The gap is not upstream of the feeds;
it is at the feed↔Chimmy seam.

---

## 3. What is NOT broken

Stated deliberately, because a gap list reads as an indictment and this one
should not.

- The **contract design is sound and unusually well-defended.** `unit` is
  required and arithmetic across currencies refuses. Emptiness is absence, not
  a fact. Unavailable results are never cached. Kill switches fail open. Each
  of those is enforced by a test proved red before green.
- The **producers all run.** Projections, market values, devy pool and imports
  are on schedule and writing.
- `ChimmyContextEngine`'s twelve providers were **reused, not reimplemented** —
  the packet wraps them and adds staleness + permission, which they cannot know.
- `three-brain` is read, not run, and the reason is measured (~75s worst case
  against a 3s ceiling).
- The **degradation semantics are the good part.** `present` and `conclusive`
  are separate questions; every gap carries a `remedy`; a killed feed says
  `disabled` rather than masquerading as a cold cache.

---

## 4. The seam, in one picture

```
PRODUCERS                     FEEDS (domain-os kernel)        PACKET              CHIMMY
─────────                     ────────────────────────        ──────              ──────
market/fantasycalc  ──✅──→   value-os · market      ──✅──→  marketValues  ──❌── want.values absent
devy board          ──✅──→   value-os · devy        ──✅──→  devyValues    ──❌── want.devy absent
IDP  (idp-projections) ─✅─→  ❌ no source                    ❌ no slice   ──❌──
kicker (kicker-values) ─✅─→  ❌ no source                    ❌ no slice   ──❌──
af-projections      ──✅──→   projection-os          ──✅──→  projections   ──⚠️── unrescored (no leagueIdpRules)
sync collector      ──✅──→   import-os · assertions ──✅──→  importAssertions ─✅─
league rules        ──✅──→   league-os              ──✅──→  leagueRules   ──✅──
context ×8 + 3      ──✅──→   ChimmyContextEngine    ──✅──→  contextFacts  ──✅──
three-brain (saved) ──✅──→   ─────────────────────  ──✅──→  savedAnalysis ──✅──
                                                                              │
                                    ⛔ DECISION_OS_GROUNDING_ENABLED unset ───┘
                                       (the whole packet, off)
                                                                              │
                                    ⛔ serialize.ts renders `available`,  ────┘
                                       never slice.value  (G11)
```

**Three cuts, and they are independent — fixing any two leaves it broken.**

1. A switch that is off (**G1**).
2. A call site that asks for half of what it could have (**G2**).
3. **A serializer that drops every value it was handed (G11).**

⚠ **G11 is the one to fix first and it is the smallest.** G1 and G2 are a
config change and four arguments. G11 is one function — and until it lands,
turning the flag on delivers a manifest of adjectives to the model and changes
nothing a user would notice. Everything upstream of all three is built and
running.

---

## 5. Owner's answers — 2026-09-01

Twelve questions, answered by the owner in session. **These are settled. Do not
relitigate them inside a ticket; add a note here if one turns out to be wrong.**
Numbered `A1…A12` so later work can cite them.

| # | Question | Answer |
|---|---|---|
| **A1** | Flag-on vs latency-first | **Measure, then flip.** A packet over the ceiling is billed and discarded — worse than off. |
| **A2** | How IDP + kicker reach Chimmy | **A roster-scoped packet slice**, computed live, uncached. Keeps Chimmy reading exactly one object. |
| **A3** | Sport scope this pass | **NFL + NCAAF only.** Everything else returns an honest *no producer*. D17 still holds — the *design* stays seven-sport. |
| **A4** | How literal is "Chimmy is the only way in" | **Chimmy is the only AI path.** Deterministic surfaces (start-sit, trade-value, waiver engine) stay first-class with their own engines. |
| **A5** | What a start/sit answer is built from | **Deterministic call, AI explains it.** This is invariant P3 restated — AI may explain, prioritise and communicate; never generate or replace a fact. |
| **A6** | Proactivity | **Fully proactive alerts.** Injuries, trade offers, lineup deadlines. |
| **A7** | Gap UX | **Say it plainly and offer the fix.** Exactly what `GroundingGap.remedy` was built for. |
| **A8** | What the value lane must do | **All four:** what a player is worth · grade a trade · rank a roster / find holes · cross-league exposure. |
| **A9** | `domain_os_facts` migration | **Owner checks production first, then decides.** Nothing written or applied until then. |
| **A10** | Latency budget | **Keep the 3s ceiling.** |
| **A11** | Alert channels | **All four:** web push · in-app queue · email digest · Discord/SMS. |
| **A12** | First milestone | **One real question, fully grounded** — *"What's my WR worth?"* end to end on a real league, with age and confidence visible. |

⚠ **A6 + A11 together are the largest single build in this document**, and A12
does not depend on either. They are sequenced last for that reason, not because
they matter least.

⚠ **A5 constrains A8.** "Grade a trade" must run the deterministic trade engine
and have Chimmy explain the verdict — not have Chimmy add up values itself. The
machinery already exists (`lib/decision-os/trade/`, `sumCanonicalValues` with
its unit refusal); the plan wires it rather than re-deriving it.

---

## 6. The plan

Ordered by **dependency**, not size. Every milestone leaves the tree working and
is independently shippable. Nothing here pushes to `main` or applies a
migration — both are owner decisions under this repo's conventions.

> **The through-line:** three independent cuts stand between a built system and
> a working one (§4). M1 closes all three. Everything before it is verification;
> everything after it is breadth.

---

### M0 — Verify the ground · *blocking, cheap*

Nothing in M1 can be trusted without these. Two of the three are measurements,
not code.

| Step | What | Owner |
|---|---|---|
| **0.1** | **Does `domain_os_facts` exist in production?** Per **A9**, owner checks. `\d domain_os_facts` or a Prisma introspect against prod. **This changes M3 entirely and every latency estimate below.** | Owner |
| **0.2** | **Re-measure the packet on a live league.** `/api/admin/decision-os/grounding-proof` returns `meta.durationMs`, `meta.engineMs` and per-slice `sliceMs`. The waterfall was parallelised after the 5441ms reading; **the post-fix number has never been taken.** | Dev |
| **0.3** | **Positive control on 0.2 before believing it.** Kill one feed via `DECISION_OS_FEED_PROJECTIONS=off` and confirm the proof surface reports `disabled` for it. A proof surface that has never once gone red is not evidence. | Dev |

🛑 **0.3 is not ceremony.** This repo's CLAUDE.md records five separate
occasions where a check that could not fail was read as a pass. The proof
surface is new, has one caller, and has never been shown to report a negative.

**Exit:** a real `buildMs` against the 3000ms ceiling, and a known answer to 0.1.

---

### M1 — The first win: *"What's my WR worth?"* · **A12**

**This is the milestone. Everything before it is checking; everything after is
widening.** All three cuts close here, smallest first.

#### 1.1 — Render slice values in the serializer 🛑 *the highest-value change in this document*

`lib/decision-os/grounding/serialize.ts`

**G11.** `sliceLine()` never reads `s.value`. Add the assertion half beside the
existing refusal half — the gaps rendering is correct and must not change.

Requirements, each of which is a way to get this wrong:

- **Bounded, not raw.** `marketValues` and `devyValues` are whole boards;
  `contextFacts.rankings` carries difficulty for ~400 leagues (measured).
  Render top-N by relevance to `args.question`, never the collection.
- **The four `GroundedSlice<string>` slices are already prompt-ready** —
  `commissionerIntelligence`, `leagueIntelligence`, `portfolio`, `savedAnalysis`.
  Emit their `value` verbatim. **This is what finally delivers plan item 6.2**;
  three-brain's saved conclusion has been serialized to the word `available`
  since it landed.
- **Keep the meta.** Age, `servedFrom` and confidence stay on every line — per
  **A7** the user is told how old a fact is, not just what it is.
- **A present-but-inconclusive slice still renders its value**, with the
  existing `PRESENT BUT NOT SAFE TO ACT ON` marker. Dropping true information to
  punish a stale import is the failure the packet's own roster comment warns
  about.
- **Stay pure.** No IO, no clock — the file's header promises this so what the
  model is told is assertable in a test.

#### 1.2 — The test that does not exist

`__tests__/decision-os/` — **assert a value reaches the prompt.**

⚠ **The reason G11 survived is that nothing asserts this.** A packet rendering
zero values passes the entire existing suite. Prove it red against today's
serializer before writing the fix, or the test is documentation.

#### 1.3 — Ask the packet for the value lane

`app/api/chat/chimmy/route.ts:1674` — **G2.** Four additions:

```ts
want: { values: true, devy: true, projections: true, leagueRules: true },
valueFormat: { format, qbFormat },      // else the market slice is skipped outright
leagueIdpRules,                          // else projections arrive balanced-IDP, not this league's
```

⚠ **`valueFormat` is a hard gate, not a hint.** `packet.ts:690` reads
`want.values && args.valueFormat` — omit it and `want.values: true` does
nothing. Resolve format and qbFormat from the league rules already in scope.

⚠ **`leagueIdpRules: null` is legitimate and means canonical** — but the
canonical projection is *balanced*-IDP, not neutral. `ProjectionFact.rescored`
reports which you got; surface it rather than assuming.

#### 1.4 — The roster-scoped IDP/kicker slice · **A2**

Add `idpKickerValues: GroundedSlice<ValueLookup[]>` to `DecisionOsGroundingPacket`.

- Backed by `loadIdpKickerValues` **called directly, not through the feed
  kernel.** `value-os/index.ts` explains why at length and it is still right: it
  prices a roster, so a scope key would have to encode the roster set.
- **Never cached.** A league-level key would price one manager's linebackers for
  another. Uncached and honest beats cached and wrong.
- Scope **NFL + NCAAF** per **A3**; `IDP_SUPPORTED_SPORTS` already says
  `['NFL','NCAAF']`. Kickers are football-only. Every other sport returns
  `no_producer`, which is a fact about the world — not a gap.
- Add a `DECISION_OS_FEED_IDP_KICKER_VALUES` kill switch to `flags.ts` for
  parity with the other ten.

#### 1.5 — Prove it under the ceiling · **A1, A10**

Re-run 0.2 with the value lane on. `buildMs` must be **under 3000ms** on a live
league. If it is not, cut here — do not raise the ceiling and do not flip.

⚠ **1.4 adds a live, uncached read to every packet.** Measure specifically what
it costs; it is the one slice with no store behind it by design.

#### 1.6 — Flip the flag

`DECISION_OS_GROUNDING_ENABLED=true`. **Last, and only after 1.5 is green.**

⚠ **Add it to `.env.example` too.** It is absent from all five env files, which
is how it stayed invisible.

**Exit / definition of done (A12):** ask Chimmy *"what is my WR worth?"* on a
real league and get a real number, with its age and confidence, sourced from the
packet — and ask about a sport with no producer and get the honest **A7**
refusal with a remedy.

---

### M2 — The other three value questions · **A8**

Only after M1. Each reuses the M1 rendering; none needs new feed work.

| Step | Question | Wires |
|---|---|---|
| **2.1** | *"Is this trade fair?"* | The **deterministic** trade engine (`lib/decision-os/trade/`) decides; Chimmy explains — **A5**. `sumCanonicalValues` already refuses to mix `market_units` with `devy_points` unless the league sets a bridge, and a bridged result carries `DEVY_BRIDGE_CAVEAT`. **Surface that caveat; do not swallow it.** |
| **2.2** | *"Where am I weak?"* | Values joined against roster + positional replacement level. Needs the roster slice to carry real names — see the trap in §7. |
| **2.3** | *"Am I overexposed to X?"* | `packet.portfolio` already exists as a slice and already collapses to prose. M1.1 makes it visible; 2.3 is mostly verification. |

---

### M3 — Warm the feeds · *gated on 0.1*

**The branch depends entirely on whether the table exists.**

**If `domain_os_facts` is ABSENT in production:**

- **3.1** Write the migration into `prisma/migrations-pending/` with a runbook,
  matching the nine `commissioner_os_*` entries already staged there.
  🛑 **Do not apply it.** A migration is a deploy decision that belongs to the
  owner; code that ships ahead of its schema raises P2021/P2022 rather than
  no-opping.
- **3.2** Until it is applied, **every latency figure in M0/M1 already reflects
  live derivation** — which means M1's numbers are the pessimistic case and will
  only improve. State that in the attestation rather than re-measuring.

**If it EXISTS:**

- **3.3** Diagnose why the feeds are still slow — the store is being read and
  missing, which is a different problem from the store not existing.

**Either way:**

- **3.4** **Second cron walk for app-level sources.** `value-os` and
  `projection-os` are schedulable (long TTL, derive satisfiable from the scope
  key) but unscheduled, because `/api/cron/domain-os-refresh` walks *leagues* and
  these are keyed `sport:format:qbFormat`. Add a second walk, not a longer list.
- **3.5** **Un-hardcode two sports.** `importAssertionSource.sport` and
  `draftRulesSource.sport` are both `() => 'NFL'`. Under **A3** NCAAF is in
  scope, and a fact filed under the wrong partition is *unreachable*, not merely
  mislabelled.
- **3.6** **Point the league-rules source at traffic.** It lives in `draft-os`
  and warms `resolveNflRedraftDraftRuntime`, which has **zero callers** — a
  writer filling a cache nobody reads. The same fact is read live by
  `playoff-runtime` (4 routes), `roster-runtime` (1) and `schedule-runtime` (1).
  Plan item 1.2a; the fact is league rules, not draft rules.

---

### M4 — Deterministic-first answers · **A4, A5**

The invariant is already written into the architecture freeze as P3 and into the
decision engines. This milestone makes the *chat path* obey it.

- **4.1** Intent router: start/sit · waiver · trade · value → the matching
  decision engine. Chimmy receives the **decision object** and explains it.
- **4.2** `groundingPacketToEvidence` (`grounding/toEvidencePacket.ts`) already
  converts a packet into `DecisionOSEvidencePacket`, and maps
  present-but-inconclusive to `not_safe_to_act_on`. Reuse it. Do not build a
  second bridge.
- **4.3** **Leave the twelve surface routes alone** — per **A4** they keep their
  own engines and stay first-class. This milestone does not touch them.

---

### M5 — Proactive alerts · **A6, A11** · *largest build*

Deliberately last. It depends on M1 (facts must render) and reuses M4's engines.

- **5.1** `lib/decision-os/attentionQueue.ts` + `attentionSignals.ts` +
  `notifications.ts` already exist. Census what they emit before writing
  anything — this repo has four recorded cases of a census stopping at "who
  imports it" and giving the wrong answer.
- **5.2** One outbox, four transports (**A11**): web push (infrastructure landed
  today) · in-app queue · email digest via Resend · Discord/SMS.
- **5.3** **Fatigue budget per user, enforced in the outbox, not per channel.**
  Four channels × injuries + trades + deadlines is how a useful alert becomes an
  unsubscribe.
- **5.4** `/api/cron/notification-outbox-relay` runs every 5 min already.

---

### M6 — Retire the old path

**Blocked until M1.6 has run in production and answers have been compared.**
Plan item 4.5 says so and is right.

- **6.1** Compare answers old vs new on the same leagues.
- **6.2** Retire `/api/chimmy` — a shim, **zero callers**.
  ⚠ **`/api/ai/chimmy` is NOT a chat route** and must survive; it is one branch
  of a settings-panel family taking `{ leagueId }`. It was misclassified once.
- **6.3** Fix three stale docs that name `/api/chimmy` as the preferred client
  entry point (`AI_CHIMMY_QA_DELIVERABLE.md`,
  `CHIMMY_UNIFIED_ASSISTANT_DELIVERABLE.md`). Traced: nothing calls it.

---

### Deferred, tracked so it is not lost

- **Sleeper transactions (G8 / plan 6.4).** Trades and waivers reach the DB only
  via a hand-run script; waiver claims not at all. 🛑 **Schedule the existing
  orchestrator BEFORE writing the fourth service**, or it is the
  `ingestCFBDStats` failure again — a surface pointed at a table nothing
  refreshes.
- **B2B/B2C cohort unification (plan 6.3).** Blocked: DB roles `NOLOGIN`.
- **Sports beyond NFL/NCAAF.** Out of scope by **A3**, in scope by design (D17).

---

## 7. Traps, named in advance

Each of these has already happened once in this repo. They are not hypotheticals.

1. **A check that cannot fail reads as a pass.** M0.3 exists for this. Prove
   every new check red before trusting its green.
2. **A test that asserts the wrong half.** G11 survived a full suite because
   nothing asserted a value appears. M1.2 must be proved red against today's
   serializer.
3. **`Promise.race` abandons, it does not cancel.** A late packet is still
   assembled and still billed. Making it *fast* is the fix; raising the timeout
   is not.
4. **Filtering a check's output is not scoping it.** Read the full typecheck
   total against a baseline from a detached worktree at the commit's parent —
   never `tsc | grep <my files>`.
5. **A roster of player IDs grades itself fine.** Measured 2026-09-01: all 27
   players came back as `{ playerId: '6804', name: '6804' }` and the slice
   reported `present: true, conclusive: ok, gap: null`. **M2.2 depends on real
   names.** Check before building on it.
6. **Emptiness is absence, not a fact.** `hasSubstance()` exists because `[]` is
   truthy and a cold league rendered as *available*. Any new slice must use it.
7. **Never cache an unavailable result.** One transient outage becomes a
   TTL-long blackout. The kernel already refuses; new code must too.
8. **A migration is not pushable work.** Code ahead of its schema raises P2021 /
   P2022 — it does not no-op.

---

## 8. Provenance

Written 2026-09-01 from a read-only audit of the working tree at branch
`commish-os/phase-0-1b`. No source files were modified. Figures are greps and
config reads against the tree as checked out; the production database was not
queried and no provider was called.

⚠ **Two figures in §2 are file-tree facts, not production facts**, and the
distinction matters: G5 says *no migration file exists*, which is not the same
as *the table is absent in production*, and G4's post-parallelisation timing has
not been re-measured. Both are named as checks to run.
