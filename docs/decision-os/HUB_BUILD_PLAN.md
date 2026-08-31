# Decision OS as the hub — build plan

**Written 2026-08-31.** Owner-directed. This file is the durable record so the
work does not restart from zero: it holds the **decisions** (§1), the
**measured findings** (§2), and the **ordered plan** (§4).

> **Read §2 before doing anything in §4.** Several steps exist only because a
> measurement contradicted what the code's own comments claim. Where a header
> and a measurement disagree, this file records the measurement and says so.

---

## Progress ledger

Updated as work lands. `✅ done · 🔄 in progress · ⏸ blocked · ⬜ not started`

| | Task | Notes |
|---|---|---|
| ✅ | **0.1** Correct the stale three-brain header | Bigger than expected — two stacks, see §4 Phase 0 |
| ✅ | **0.3** Unwired-module audit | 40 dirs, 3 controls passed. §2.7. 37 triaged in §2.9 |
| ✅ | **0.2** Identity coverage — Table A (registry) | Run on prod 2026-08-31. §2.10. **Overturns the sleeperId assumption** |
| ✅ | **0.2** Identity coverage — Table B (roster-referenced) | §2.11. NFL 80.4%, NCAAF 24.2%. First run was invalid at 204% — fixed |
| ✅ | **0.4** Find what creates name-only NCAAF identity rows | §2.12. Peer commit `7beaa8811`, deliberate backfill. Audit caught a migration mid-run |
| ✅ | **0.5** Add name+team resolution to the coverage audit | §2.13. False alarm now impossible, not merely documented. Re-run needed for figures |
| ✅ | **1.1** Refresh scheduler | `app/api/cron/domain-os-refresh`. **One source, not five** — see §4 Phase 1 |
| ✅ | **1.1b** Split waiver/trade settings derives so they are schedulable | Both split. Waiver now scheduled; trade blocked on a season key, not on the derive |
| ✅ | **0.6** Diff the two waiver-settings resolvers | §2.14. **No divergence** — they are layered, not rival. The alarm was a truncated grep |
| ✅ | **1.2a** League OS — cached ruleset on the three resolvers that have routes | 60s TTL, GET only. §4 Phase 1.2 |
| ✅ | **1.2b** Decide the fate of `resolveNflRedraftDraftRuntime` | **DECIDED: no route.** Deprecated in place with a written retirement condition. §4 Phase 1.2 |
| 🔄 | **1.3** Propagate `drainOutcomes()` | **Premise was wrong** — see §4 Phase 1.3. Telemetry half was already done; League OS now emits too. Response half deferred to Phase 4 |
| ✅ | **1.4** Schedule `classifyDraftStatus` | **Already done** by `ad514a334`, on main. My §2.6 claim was stale — see §2.15 |
| ✅ | **2.1** Define `CanonicalValue` | `lib/decision-os/value/contract.ts`. Unit refusal enforced by a test proven red-then-green |
| ✅ | **2.2** One adapter per producer | **THREE, not four** — IDP+kicker already composed. market · devy · idpKicker, each with a trap pinned by a red-proven test |
| ✅ | **2.3** Register `'value'` as an `OsDomain` | Union widened; no migration (`VarChar(16)`). Level split documented on the type |
| ✅ | **2.4** Rescore-at-read for IDP + kicker | **Not needed** — `buildIdpKickerValueMap` takes league rules as an argument, so there is no canonical row to rescore |
| ✅ | **3.1** `'projection'` domain | `lib/decision-os/projection/facts.ts`. Rescore-at-read wired; writer verified scheduled |
| ⬜ | **2.5** `OsFactSource` for value + projection | ⚠ Gap I created: both domains are registered and have loaders, but nothing wires them into a FEED yet |
| ✅ | **3.2** `'import'` domain + four assertions | `lib/decision-os/import/assertions.ts`. Reads what the collectors already recorded and nothing could read |
| ✅ | **3.3** `isConclusive(fact)` | `lib/decision-os/conclusive.ts`. Per-fact profiles + remedy on every blocker. Two controls proven red |
| ⬜ | **4.1** `buildDecisionOsGroundingPacket()` | |
| ⬜ | **4.2** Wire into `/api/chat/chimmy` | |
| ⬜ | **4.3** Move orphaned grounding behind Decision OS | Read all 15 first |
| ⬜ | **4.4** No-fact rule | |
| ⬜ | **4.5** Retire duplicate routes | |
| ⬜ | **5.1** Internal proof surface | |
| ⬜ | **5.2** Entitlement + degradation pass | |
| ⬜ | **5.3** Flags and kill switches | |
| ⬜ | **6.1** Collapse the three health scorers | Deferred by D10 |
| ⬜ | **6.2** three-brain as Chimmy's reasoning layer | |
| ⬜ | **6.3** B2B/B2C cohort unification | Blocked: DB roles `NOLOGIN` |

---

## 0. The target, in one paragraph

Every OS module **feeds** Decision OS. Decision OS holds those facts warm at
all times, categorises them, and is ready to answer. Chimmy is the **only**
way a user reaches any of it, so Chimmy reads exactly one object — a Decision
OS grounding packet — and nothing else. Player valuation (offense, IDP,
kicker, college), AF Projections, and the platform imports are the three
producers that matter first.

---

## 1. Decisions taken (owner, 2026-08-31)

These are settled. Do not relitigate them inside a ticket; open a note here if
one turns out to be wrong.

| # | Decision | Consequence |
|---|---|---|
| D1 | **Decision OS is Chimmy's sole grounding source.** | The 12 `ChimmyContextEngine` providers and the 3 `lib/intelligence/chimmy/*` grounding resolvers move *behind* Decision OS as feeds. They are not deleted. |
| D2 | **Canonical chat backend: to be recommended from evidence.** | Answered in §2.1 below — `/api/chat/chimmy`. |
| D3 | **One value contract, four producers.** | A single `CanonicalValue` shape emitted by offense, IDP, kicker and college. Decision OS never learns there were four systems. |
| D4 | **Canonical value + rescore at read.** | Store one canonical value; rescore under the asking league's rules at read time. Same pattern `af-projections/rescoreForLeague.ts` already uses. |
| D5 | **Precomputed, always warm.** | A scheduler keeps facts fresh. A Chimmy turn is a read, never a derive. This is the single largest missing piece (§2.2). |
| D6 | **Projections are a feed INTO Decision OS.** | The projection engine writes; Decision OS reads. Decision OS never runs the math — this preserves the architecture freeze's "decide, not gather". |
| D7 | **Import OS asserts all four:** freshness per scope, parity verdict, coverage score, identity-resolution confidence. | These four together are what lets Decision OS call a league *conclusive*. |
| D8 | **No-fact rule: name the gap and where to look.** | Extends the rule already in the system prompt with the *reason* — not synced / not entitled / not yet computed — which only Decision OS can supply. |
| D9 | **Scope: NFL + college/devy.** | Devy values already flow and would otherwise sit outside the engine. Other sports are out of scope for this build. |
| D10 | **Health-scorer collapse is deferred.** | Values and projections first. Accepts an ambiguous "is my league healthy" answer in the interim. Tracked in §5. |
| D11 | **Audience: closed beta.** | Honest degradation and entitlement gating must be solid. Proof surfaces stay internal. |
| D12 | **Wire Draft OS. Audit for more unwired modules.** | Draft OS is confirmed dead (§2.3). The audit is a plan step, not an assumption. |
| D13 | **Internal canonical player id; registry resolves the rest.** | Adopt `PlayerIdentityMap` as the spine. ⚠ Coverage must be measured first — see §2.4. |
| D14 | **Latency: correctness over speed for beta.** | Measure real timings, tighten later. Do not pre-optimise the grounding assembly. |
| D15 | **Every value carries a required `unit`.** | `'market_units' \| 'devy_points'`. Arithmetic across units refuses unless that league has set a bridge; a bridged result carries `DEVY_BRIDGE_CAVEAT`. Preserves the existing refusal by construction rather than by discipline. |
| D16 | **`conclusive` refuses the affected facts only.** | Chimmy answers everything well-grounded and declines the specific claims resting on stale or unmapped data, naming which part and why. A failed import degrades an answer; it never kills the league. |
| D17 | **Every contract is sport-parameterised from day one.** | D9 scopes the first *build* to NFL + college. It does **not** scope the *design*. See §1.1 — this repo already carries a standing seven-sport rule and the shortcut would break it. |

### 1.1 D17 in detail — open-ended for all seven sports

`lib/sport-scope.ts:5` carries a standing instruction that predates this plan:

> *"SPORT SCOPE: Always support these sports unless explicitly told otherwise:
> NFL, NHL, NBA, MLB, NCAAB, NCAAF, Soccer"*

So NFL-shaped contracts with other sports bolted on later would violate an
existing repo standard, not merely be inconvenient. Three consequences that
must hold in every phase below:

1. **`sport` is a required field on every fact, never a default.** The feed
   kernel is already sport-aware — `OsFactSource.sport: (args) => string` —
   so this costs nothing to honour and is expensive to retrofit.
2. **"No producer for this sport" is a first-class value, not a gap.** The
   producer matrix is genuinely sparse and always will be: FantasyCalc prices
   NFL only; IDP is `['NFL','NCAAF']` (`IDP_SUPPORTED_SPORTS`); kickers exist
   only in football; devy covers NCAAF today. An NHL value query must return
   *"no producer"* — distinguishable from *"producer exists, returned
   nothing"* and from *"not yet computed"*. Collapsing those three into a
   null is how a sport silently looks broken.
3. **College is not one sport.** `COLLEGE_PAIR_WIZARD_PRIMARY_SPORTS` already
   pairs **NFL↔NCAAF and NBA↔NCAAB**, so the C2C/devy stack is designed for
   two college pipelines. `unit: 'devy_points'` (D15) must therefore be
   understood as per-pairing — NCAAF devy points and NCAAB devy points are no
   more interchangeable with each other than either is with market units.

---

## 2. Findings — measured, not recalled

### 2.1 Chimmy and Decision OS have never met

**Only 4 of 217 Chimmy TS files reference Decision OS** (`availablePlayersTool`,
`ReplayInsightContextProvider`, `pendingTradeDecisionGrounding`). Chimmy is
well-grounded — it just grounds in everything *except* the engine.

`lib/intelligence/chimmy/leagueIntelligenceGrounding.ts` assembles its brief
from `leagueContextService`, `marketValueService`, `sleeperTradeGradeService`
and `sleeperH2HService` — calling each directly. Zero references to behavioral
intelligence or the Intelligence API.

**Three chat backends, and the traffic is not where the architecture is:**

| route | lines | UI callers | notes |
|---|---:|---:|---|
| `app/api/chat/chimmy/route.ts` | 2,939 | **4** | `app/core`, `CommsDrawer` (×2), `MockDraftSleeperRoomClient`. Uses `buildLeagueSportsGroundingPacket`. |
| `app/api/chimmy/route.ts` | 783 | **0** | A wrapper that delegates to the above via `postChatChimmy`. Its commissioner/league/portfolio grounding resolvers are therefore **unreachable from the UI**. |
| `app/api/ai/chimmy/route.ts` | 333 | 1 | `LeagueSettingsSubPanels.tsx` only. |

🛑 **`ChimmyContextEngine` — the clean 12-provider architecture — is used by
none of the three chat routes.** Its only consumers are
`lib/shared-services/league-hub/activeLeagueContext.ts` → the league-hub
context route, `commissionerOsContext.ts` and `userOsContext.ts`.

**So the well-designed parts are bypassed and the 2,939-line route is what
users actually hit.** That is the single most important fact in this file.

**D2 resolved: `/api/chat/chimmy` is canonical** — by traffic, not by
elegance. The Decision OS packet goes in there. The other two become shims.

### 2.2 The gathering half of every feed is dead

`OsFeed` exposes `get` (read-through) and `refresh` (populate without
reading). A search for `.refresh(` across `lib/`, `app/api/cron/` and
`scripts/` returns **zero callers**.

Every **league-level** source therefore never fires: Waiver's 6 h settings
entry, Trade's 2 h rules-and-deadline entry, Draft's rules entry. Feeds
populate only through the **user** source, so slow shared facts are re-derived
per user instead of once per league. `waiver-os/index.ts` says so itself:
*"a `refresh()` target for a scheduler that does not exist yet."*

This is why D5 (precomputed, always warm) is currently impossible. **Nothing
warms anything.**

### 2.3 Draft OS is dead; three-brain is NOT

- **Draft OS: zero real imports.** The single grep hit in
  `lib/draft-runtime/resolveNflRedraftDraftRuntime.ts:120` is a **code
  comment** (`See lib/decision-os/draft-os/index.ts`), not an import. Built,
  tested (`__tests__/draft-os.test.ts`), never called.
- **three-brain: live in 6 runtime paths** via
  `three-brain/phase4/attachSavedAnalysis` — the waiver engine, lineup
  actions, redraft trade proposals, `/api/decision-os/manager-intelligence`,
  the intelligence-maintenance cron, and `commissionerHubHealth`.
  ⚠ **Its own module header still says "Not wired into any live Decision OS
  route, persistence, or token flow yet." That header is stale and should be
  corrected** — it caused exactly one wrong conclusion during this review.

Other modules checked and found to have real consumers: `phase6` (22),
`sdk` (8), `presentation` (8), `manager-intelligence` (10), `snapshot` (2),
`delivery` (3), `replay-insights` (3), `commissioner-intelligence` (3).

### 2.4 The identity registry is the real blocker for D13

`PlayerIdentityMap` holds 10 id spaces: `sleeperId` (unique), `fantasyCalcId`,
`rollingInsightsId`, `apiSportsId`, `mflId`, `espnId`, `fleaflickerId`,
`clearSportsId`, `cfbdId`, `fantraxId`.

⚠ **Nothing currently uses `PlayerIdentityMap.id` as a foreign key.** Adopting
it as the canonical spine (D13) is real work, not a rename.

Two measurements already recorded in the schema comments, both of which make
the college case the hard one:

- **0 of 73,883 NCAAF `SportsPlayer` rows carry a `sleeperId`.** The ordinary
  crosswalk cannot serve a college league at all.
- Fantrax's CFB map holds **~16,886 ids against 20,027 NCAAF identity rows**,
  so most rows will never carry one. `fantraxId` is deliberately nullable and
  **not** unique for this reason.

**Consequence for D3/D13:** a unified value contract keyed on a canonical id
makes unmapped players *invisible* rather than *wrong* — which is the correct
failure, but only if coverage is measured and reported. **Measure before
migrating.**

### 2.5 What each producer looks like today

| System | Lives in | Scope | Already emits |
|---|---|---|---|
| Offense / market | `lib/player-values`, `lib/market-value`, `lib/trade-value/valueEngine.ts`, `lib/fantasycalc-db.ts`, `PlayerValueSnapshot` | global | `value`, ranks, `trend30d`, `tradeFrequency`, `marketStdDev` |
| IDP | `lib/idp-projections/{idpValuation,idpTradeValues,leagueIdpVorp}.ts` | **league** (`resolveLeagueIdpScoring`) | league VORP, trade values |
| Kicker | `lib/kicker-values/{leagueKickerValue,loadLeagueKickerValue}.ts` | **league** (`resolveLeagueKickerValue`) | share-at-rank pricing |
| College / devy | `lib/devy/*`, `lib/devy-classification.ts`, `lib/cfb-player-data.ts` | global | devy values, draft rates, ADP |
| Projections | `lib/af-projections/*` → `AFProjectionSnapshot` | canonical `balanced`, rescored per league | points, confidence, `componentAmounts` |

**`PlayerValueSnapshot` already carries the two honesty fields the feed kernel
asks for and every current source returns null for:** `marketStdDev` →
`confidence`, `tradeFrequency` → `sampleSize`. The schema comments already
explain why they matter (*"a high value with near-zero trade frequency is a
thin, rarely-tested price"*) — nothing downstream can reach them today.

**`lib/values/publishedValueEvidence.ts` is the model to copy for discipline.**
Every figure carries its sample and its date, and a test asserts the published
numbers against the function pricing actually calls, so the two cannot
separate silently.

### 2.6 Devy values are a different CURRENCY, and the exchange rate cannot yet be earned

Settled by reading the code, which had already decided this correctly (→ D15).

`devyValueBoard.ts` ranks on `draftProjectionScore` — the signal with evidence
behind it — and prices that rank on a devy-points curve *"which compares devy
assets to each other and converts to nothing else."* `devyMarketBridge.ts`
**refuses** to grade a trade spanning both scales, *"because grading it would
mean inventing a conversion and not saying so."* A commissioner may set an
exchange rate; it is absent by default and every converted output carries
`DEVY_BRIDGE_CAVEAT`.

So devy values are **cardinal within their own scale and non-convertible
outside it**. One `value` field spanning both currencies would perform, by
default, the exact conversion the code spent real effort refusing. Hence the
required `unit`.

⚠ **Two further measurements already recorded in `devyValueBoard.ts`, both of
which say a devy value must never be trusted from `DevyPlayer.devyValue`:**

- That column is written by a **lookup table** — `QB 6000 / RB 4500 / WR 5000
  / TE 3500` × `{FR 1.4, SO 1.3, JR 1.1, SR 1.0}` — with **no player-specific
  input** in the base. Every freshman QB in the country prices at 8400.
- It is **zero — not null — for 1,455 of 1,718 players.** 85 % never went
  through the writer, so an absence of data renders to managers as a confident
  statement that the player is worthless.

🛑 **AND THE WRITER THAT WOULD LET A REAL RATE BE EARNED HAS NO CALLER.**
`classifyDraftStatus` in `lib/devy-classification.ts` is the sole writer of
`graduatedToNFL` and `draftYear`. Measured on production 2026-08-30:
**0 of 1,721 `DevyPlayer` rows have `graduatedToNFL = true`, 0 carry a
`draftYear`, and 335 players were draft-eligible in 2026 with none leaving the
pool.**

The only honest way to price devy assets is to watch what they turn out to be
worth once they reach the NFL. That observation set is **empty, not merely
small**, and stays empty until this writer is scheduled. Same family as §2.2:
a writer that exists, is tested, and nothing runs.

---

### 2.7 The unwired audit — 40 directories, and it is a QUESTION list

Phase 0.3, run 2026-08-31 (`scratchpad/unwired-audit.mjs`, single pass over
9,948 files and 7,108 resolved specifiers, checking all four import forms).

🛑 **Three positive controls passed before any result was read** — `draft-os`
expected 0 and got 0, `fantasycalc-db` expected many and got 50, `three-brain`
expected 6 and got 6. A check that has never gone red is not evidence.

⚠ **The first per-directory version of this took >10 min and was killed.** It
grepped the whole tree once per directory. The single-pass index is the
version to keep.

**40 directories under `lib/` have zero runtime consumers outside themselves.**
They fall into three categories and **the list must never be treated as a
delete list** — two of the three largest are load-bearing-in-waiting:

| category | example | what it means |
|---|---|---|
| **Built ahead of a blocker** | `lib/domain` (26 files) | The tenancy write path. `.eslintrc.json` already *enforces* that Commissioner OS reach the DB through it (invariant 2), and `lib/domain/db.ts` is the sanctioned `$executeRaw` exemption. Waits on the DB roles (§6.3). Deleting it would delete the plan. |
| **Inert by governed design** | `lib/decision-os/canonical` (11 files) | Shadow-only persistence, double-gated on `mode: 'shadow'` **and** `DECISION_OS_CANONICAL_SHADOW_ENABLED === 'true'`. Its own header: *"Nothing here reads for the UI, notifications, or Chimmy."* Going live is a cutover phase, not a wiring task. |
| **A real gap** | `lib/decision-os/draft-os` (1 file) | Built, tested, and its only reference anywhere is a code comment. This is the one Phase 1.2 wires. |

⚠ **`lib/decision-os/canonical` nearly escaped the audit through a
near-collision.** A loose grep for `canonical` returns `canonicalAdapter`,
`canonicalBridge`, `canonicalMemo`, `canonicalDraftRuntime` and
`canonicalImportNormalizer` — five *different* live modules. Only an
exact-path check shows the directory itself has no importer. Same shape as the
`api-sports.io` / `api.sportsdata.io` collision CLAUDE.md records.

The other 37 are untriaged and listed in the script's output. Triage them
individually; the category table above is the question to ask of each.

### 2.8 There is no relational path from a roster to a player

Found while writing the 0.2 measurement, and it makes D13 materially harder
than a rename.

**`Roster.playerData` is `Json`.** Not a relation, not a join table, no FK.
The id space *inside* that blob differs by the league's provider — Sleeper ids
for a Sleeper import, Fantrax ids for a Fantrax one, and so on.

Consequences:

- Adopting `PlayerIdentityMap.id` as the canonical spine (D13) cannot be done
  by adding a foreign key. Every read path that turns a roster into players
  has to go through a resolver, and that resolver is where coverage either
  holds or silently drops players.
- Coverage therefore **cannot be measured by counting registry rows**. The
  number that matters is *of the ids real rosters actually contain, how many
  resolve* — which is why 0.2 samples blobs rather than aggregating the table.
- This is also why the college case is the dangerous one: 0 of 73,883 NCAAF
  `SportsPlayer` rows carry a `sleeperId` (§2.4), so a college roster's blob
  cannot resolve through the ordinary crosswalk at all.

### 2.9 Triage of the 37 remaining unwired directories

Files / tests-mentioning / last commit. **High test count + zero consumers is
the interesting signal** — it means the module was built to a spec and then
orphaned, not abandoned half-written.

| flag | directories |
|---|---|
| **Heavily tested, zero consumers** — triage first | `lib/tournament/ai` (1 file, 1,901 test mentions), `lib/sports-data-gateway/ports` (2 / 779), `lib/sports-data-gateway/scoring` (1 / 336), `lib/rosters` (2 / 187), `lib/ai/intelligence` (2 / 142), `lib/sim` (1 / 134), `lib/routes` (1 / 125), `lib/replay-framework/ingest` (2 / 92), `lib/ai/metrics` (3 / 63) |
| **Recent, so probably live-in-progress** | `lib/brand-social` (2026-08-27), `lib/replay-framework/ingest` (2026-08-26), `lib/draft-pick-value` (2026-08-20), `lib/launch` (2026-08-03) |
| **Stale ≥ 4 months, no tests** — likeliest genuine abandonment | `lib/platform-analytics`, `lib/email-growth`, `lib/ai-performance`, `lib/data-consistency` (all 2026-03), `lib/ai-orchestration-engine`, `lib/deterministic-evidence-layer` (2026-03-27), `lib/franchise-window` (2026-03-20) |
| **Relevant to this plan** | `lib/ncaaf-provider` (1 file, 0 tests, 2026-07-14) — a college provider seam sitting unused while NCAAF is in scope (D9). `lib/deterministic-evidence-layer` — name suggests exactly what §3 needs. Both worth reading before Phase 2. |

⚠ **Test-mention counts are substring matches on the directory basename**, so
`lib/sim`'s 134 and `lib/routes`' 125 are inflated by unrelated words. Treat
the column as a ranking hint, not a measurement.

### 2.10 Identity coverage, measured on production 2026-08-31

Run: `scripts/audit-player-identity-coverage.ts`, read-only, against the
production endpoint. **81,338 `PlayerIdentityMap` rows total.**

| sport | rows | sleeper | rollingInsights | espn | cfbd | fantrax |
|---|---:|---:|---:|---:|---:|---:|
| NCAAF | 36,149 | **0.0%** | 55.4% | 0.0% | **8.6%** | **11.4%** |
| NCAAB | 18,209 | 0.0% | 100% | 0.0% | 0.0% | 0.0% |
| NFL | 9,563 | 94.4% | 100% | 4.0% | 0.0% | 0.0% |
| MLB | 7,312 | 0.0% | 100% | 0.0% | 0.0% | 0.0% |
| SOCCER | 4,233 | 0.0% | 100% | 0.0% | 0.0% | 0.0% |
| NHL | 4,115 | 0.0% | 100% | 0.0% | 0.0% | 0.0% |
| NBA | 1,757 | 0.0% | 100% | 0.0% | 0.0% | 0.0% |

*(`fantasyCalcId`, `apiSportsId`, `fleaflickerId`, `clearSportsId` are 0.0%
across every sport and are omitted.)*

🛑 **THE SPINE IS `rollingInsightsId`, NOT `sleeperId`, AND THE SCHEMA SAYS
OTHERWISE.** `PlayerValueSnapshot` describes `sleeperId` as *"the join key
every source in use can reach."* Measured: that is true for **NFL only**
(94.4%) and **0.0% on all six other sports**. `rollingInsightsId` is 100% on
six of seven. Any cross-sport contract keyed on `sleeperId` resolves nothing
outside football — which is precisely what D17 exists to prevent.

**This strengthens D13 rather than weakening it.** No single external id space
works everywhere, so an internal canonical id with a resolver underneath is
the only shape that can serve seven sports. But the resolver's fallback order
is now a measured fact, not a guess: **`rollingInsightsId` first, `sleeperId`
for NFL, and NCAAF needs its own path.**

🛑 **NCAAF IS THE HOLE, AND IT IS WORSE THAN §2.4 IMPLIED.** 36,149 rows, and
**44.6% carry no id in any space at all** — name-only. Worse, the two bridges
built specifically for it are thin: `cfbdId` at **8.6%** and `fantraxId` at
**11.4%**.

⚠ **The `fantraxId` figure contradicts its own schema comment and the gap is
4×.** That comment says *"Fantrax's CFB map holds ~16,886 ids against 20,027
NCAAF identity rows"* — ~84%. Measured today: 11.4% of 36,149 ≈ **4,121 rows**.
Two readings, and they need different fixes: either the registry grew
(20,027 → 36,149) while the bridge ingestion did not keep pace, or the 16,886
counts ids **available from Fantrax** rather than ids **written to the
registry**. **Resolve this before Phase 2.2** — it decides whether the college
value adapter can reach a roster at all.

⚠ **NCAAB has no college bridge whatsoever.** 18,209 rows, `rollingInsightsId`
only. `cfbdId` is football-specific and Fantrax's map was CFB. So the
NBA↔NCAAB pairing named in D17 §1.1 has a college side reachable only through
Rolling Insights — which is fine *if* NCAAB rosters carry RI ids, and unknown
until Table B is re-run.

⚠ **The first run of Table B was INVALID and is not recorded.** It counted
registry ROWS rather than distinct resolved ids, and since only `sleeperId` is
unique it reported **2,975 resolved from 1,456 candidates: 204.3%**. The
absurdity is the only reason it was caught; a milder duplication would have
produced a plausible number and entered this file as fact. Fixed to count the
sample side and assert `resolved ≤ sample`. Kept here because the near-miss is
the lesson, not the bug.

### 2.11 Table B — roster-referenced coverage (valid run, 2026-08-31)

| sport | leagues | rosters | candidate ids | best space | resolved | runners-up |
|---|---:|---:|---:|---|---:|---|
| NFL | 25 | 383 | 1,456 | `rollingInsightsId` | **1,171 (80.4%)** | `sleeperId` 1,145 · `espnId` 2 |
| NCAAF | 1 | 12 | 491 | `fantraxId` | **119 (24.2%)** | `sleeperId` 1 · `rollingInsightsId` 1 |
| NBA | 10 | **0** | — | — | — | leagues exist, no rosters |
| SOCCER | 10 | **0** | — | — | — | leagues exist, no rosters |
| MLB · NHL · NCAAB | **0** | — | — | — | — | no leagues at all |

⚠ Candidate ids are an **upper bound** — the JSON walker cannot know which keys
hold ids, so it over-collects and the true denominator is smaller. A low
percentage means *"not proven to resolve"*, never *"proven broken"*.

**NFL resolves well through either spine** (80.4% RI / 78.6% sleeper). This is
the sport where D13 is cheap.

🛑 **NCAAF's REGISTRY IDS AND ITS ROSTER IDS ARE DIFFERENT POPULATIONS.** The
registry holds ~20,030 NCAAF `rollingInsightsId`s. The one real NCAAF league's
rosters resolve through `rollingInsightsId` **exactly once**. They are Fantrax
ids, and only 24.2% of them reach a registry row. So the 49.6% RI coverage in
§2.10 is not 49.6% of anything a roster asks for — **a registry can look half
populated and still answer nothing.** This is precisely why 0.2 measures
rosters and not rows.

### 2.12 The registry is growing name-only rows — SOLVED, and it is deliberate

> ✅ **RESOLVED 2026-08-31, minutes after being written.** The cause is
> `7beaa8811` *"feat(identity): widen the NCAAF registry from SportsPlayer,
> keyed on (name, team)"* — a peer session's in-flight backfill, not a rogue
> job. **The audit measured a migration mid-run.** Keep the section: the
> reasoning was right, the alarm was wrong, and the reason it was wrong is the
> useful part.
>
> That commit creates NCAAF rows carrying `canonicalName`, `normalizedName`,
> `currentTeam`, `position`, `sport` — and **no external id at all, by design**.
> Its own message states the gap it closes: *"SportsPlayer holds 73,883 NCAAF
> rows against PlayerIdentityMap's 20,027"* — which is exactly the ~20,030
> `rollingInsightsId` figure measured below, from the other direction.
>
> 🛑 **SO §2.10's NCAAF PERCENTAGES UNDERSTATE REACHABILITY, AND THAT IS A FLAW
> IN THE AUDIT, NOT IN THE DATA.** The script measures ten id columns. These
> rows are meant to be resolved by **(name, team)** — a path it does not
> measure at all. "Unreachable by any id" is true and misleading: they are
> reachable, by the mechanism they were built for.
>
> ⚠ **The independent corroboration is worth more than either number alone.**
> That commit reports an imported Fantrax roster connecting **11 of 39 spots
> (28.2%)**; §2.11 measured **24.2%** from a different sample by a different
> method. Two measurements that never saw each other agreeing to ~4 points is
> the strongest evidence in this file.
>
> **Follow-up (not a blocker):** extend the audit with a name+team resolution
> column before citing NCAAF coverage anywhere.

**Original finding, preserved:**

Found by comparing two runs of the same script minutes apart. Only NCAAF moved.

| | run 1 | run 2 | Δ |
|---|---:|---:|---:|
| NCAAF rows | 36,149 | 40,383 | **+4,234** |
| …with `rollingInsightsId` | 55.4% ≈ 20,027 | 49.6% ≈ 20,030 | **~0** |
| …with `cfbdId` | 8.6% ≈ 3,109 | 7.7% ≈ 3,109 | **0** |
| …with `fantraxId` | 11.4% ≈ 4,121 | 10.2% ≈ 4,119 | **~0** |

Every other sport was byte-identical across both runs.

**The percentages fell because the denominator grew, not because anything
broke.** All three absolute counts are flat within rounding, so **all 4,234 new
rows carry no id in any of the ten spaces** — name-only. That also resolves the
`fantraxId` puzzle in §2.10: the bridge did not regress; the registry grew
underneath it. ~20,353 NCAAF rows (50.4%) are now unreachable by any id.

**What was ruled out, by reading the writers:**
- `lib/devy/ingestFantraxPlayerIdentities.ts` — **update-only.** Links a
  `fantraxId` onto an existing row; never creates.
- `lib/sports-data/cfbdIdentityBridge.ts` — **update-only.** Same shape.
- `lib/sports-data/multiSportIdentityMap.ts` — creates, but **always sets
  `rollingInsightsId`** (copied from `SportsPlayer.externalId`), so it cannot
  produce a name-only row.
- `lib/unified-player-service.ts`, `espnIdentityPopulation.ts`,
  `nflFoundationSync.ts` — NFL-scoped.

✅ **The creator was UNIDENTIFIED at the time and recorded rather than guessed**
— then named within the hour by a peer's handover (`7beaa8811`, see the box
above). Worth keeping as a worked example: refusing to attribute this to a
plausible-sounding filename cost one paragraph and avoided being confidently
wrong about a teammate's deliberate migration.

**What survives the resolution:** §2.10's percentages still have a shelf life,
because the backfill is still running. Re-measure before citing them; do not
quote them from this file.

⚠ **A related oddity, noted not chased:** `fantasyCalcId` reads 0.0% on NFL
despite `lib/unified-player-service.ts` setting it on every row it writes.
With 9,563 NFL rows, 0.0% means fewer than ~5. That writer effectively never
runs. Cheap to confirm and worth knowing before Phase 2.2 leans on it.

### 2.13 The audit now reports the (name, team) route — and a new tsconfig trap

**0.5, done.** `scripts/audit-player-identity-coverage.ts` gained two columns in
Table A and one line in Table B, so the false alarm in §2.12 is now **impossible
rather than documented**:

| column | meaning |
|---|---|
| `name+team` | reachable by the (name, team) path even with zero external ids |
| `NO ROUTE` | no id in ANY space **and** no usable (name, team) pair — the only column that should ever raise an alarm |

A low id-percentage beside a high `name+team` percentage is now legible as *a
registry doing its job*, which is what the previous version could not say.

Table B gains a name-route line using the registry's own `normalizePlayerName`
— not a local lowercase, because a normalizer that differs from the writer's
reports a mismatch that does not exist in the product. ⚠ It resolves on **name
alone**, so it is an explicit UPPER BOUND: `7beaa8811` measured 4,925 of 7,248
colliding NCAAF names (67.9%) as different people at different schools.

🛑 **A NEW TRAP, CAUGHT BY A CONTROL.** The first typecheck of the edited script
reported **exit 0, zero errors — on a file with a deliberately injected type
error in it.**

⚠ **THE FIRST WRITE-UP OF THIS SECTION GOT THE CAUSE HALF RIGHT, AND A PEER
CAUGHT IT.** It blamed the inherited `exclude` alone. Session `9e` tried to
reproduce that, could not, and said so: with `include` naming only an excluded
file, TypeScript emits **TS18003 "No inputs were found in config file"**, exits
**2**, and that line matches `grep -c "error TS"`. Loud, not silent — every tell
in `cd12c3dc5` catches it. Their objection was correct and the original claim
would have taught the next reader to distrust a tell that works.

**Reproduced both configs to find the real cause. It is the interaction, not the
exclude:**

| config (both `extends ./tsconfig.json`) | result |
|---|---|
| `include: ["scripts/probe.ts"]` | **exit 2**, 1 `error TS`, explicit TS18003 naming the include and exclude paths |
| `include: ["scripts/probe.ts", "next-env.d.ts", "types/**/*.d.ts"]` | **exit 0**, 0 errors, planted error never reported |

`listFiles` settles it: the second config compiled **507 files and the probe was
not among them.** tsc did real work, found nothing wrong in what it *did*
compile, and exited 0 with the file under test silently absent.

**So the precise mechanism is:** `extends` inherits `exclude`; the inherited
`exclude` silently drops matching entries from `include`. If **every** entry is
dropped you get TS18003 — loud. If **any** entry survives, even a `.d.ts` that
cannot contain an error, tsc succeeds on the survivors and reports clean.

🛑 **The two "harmless" boilerplate entries are what convert the loud failure
into a silent one.** Adding `next-env.d.ts` and `types/**/*.d.ts` for
completeness — which is what a careful person does — is precisely what suppresses
TypeScript's own warning. The more thorough config is the one that lies.

Two consequences:
1. **`scripts/` is not typechecked by this repo at all.** Every script in that
   directory is unverified by `npm run typecheck`. Pre-existing policy, noted
   rather than changed. (Independently confirmed by `9e`.)
2. **This is a genuine fourth empty-run mode**, and the only one that exits
   **0** — so exit status, error count, and crash-dump absence all read clean.
   Fix: an explicit `"exclude": ["node_modules"]` in the temp config.

**The habit that caught it, and the only thing that survives all four:** inject
a known error, confirm it is reported *at the right line*, and only then trust
the clean run. Note what it did and did not do here — it told me the run was
blind, it did not tell me why, and the first "why" I supplied was wrong. The
control is what makes a clean run mean something; it is not a substitute for
diagnosing the failure it reveals.

### 2.14 The two waiver-settings entry points are LAYERED, not rival — and how the alarm was manufactured

**0.6, answered: there is no divergence.** This section first claimed the
opposite, and the way that happened is the more useful half.

`getWaiverConfigForLeague` **calls** `getEffectiveLeagueWaiverSettings`. It is a
composition, not a competitor:

```
getWaiverConfigForLeague(leagueId)          lib/waiver-defaults/WaiverConfigResolver.ts
  ├─ getWaiverProcessingConfigForLeague()   type, days, locks, claim limits
  ├─ getFAABConfigForLeague()               faab_enabled / faab_budget / reset rules
  └─ getEffectiveLeagueWaiverSettings()     tiebreakRule, instantFaAfterClear
```

And the one field where a disagreement would actually hurt — the FAAB budget —
resolves identically on both paths:

| | source |
|---|---|
| `FAABConfigResolver:48` | `fromSettings(settings?.faabBudget, defaults.FAAB_budget_default)` |
| `settings-service:168` | `overrides.faabBudget ?? defaults.FAAB_budget_default` |

Same settings row, same default. **They agree by construction, not by luck**, so
there is nothing to reconcile and no runtime check to add.

🛑 **HOW A FALSE ALARM GOT COMMITTED: `grep … | head -6` ON A QUERY WHOSE WHOLE
POINT WAS COMPLETENESS.** The importer list for
`getEffectiveLeagueWaiverSettings` is 13 lines. `head -6` showed the first two
files and cut `WaiverConfigResolver.ts:7` off the bottom — the single line that
disproves the finding. The conclusion "neither imports the other" was then drawn
from a deliberately truncated view and written up with confidence.

⚠ **It compounds with a second miss**: that import comes through the
`@/lib/waiver-wire` **barrel**, not `@/lib/waiver-wire/settings-service`, so
even an untruncated grep for the deep path would have missed it. CLAUDE.md's
"check all four import forms" rule exists for exactly this, and following it is
what a barrel defeats.

**The rule worth keeping is narrower than the general pipe warning already in
CLAUDE.md:** truncating a search is safe when you want *an* example, and
disqualifying when you want to know whether something exists **nowhere**. Those
read identically at the terminal. A census must never be piped through `head`.

**Consequence for 1.1b:** unchanged in scope, for a different reason than the
one first written. The hypothesis that League OS's fact already covers
`waiverSettingsSource` still fails — but because `WaiverWorldFacts` carries
user-scoped data (`faabRemaining`, `waiverPriority`, `rosterSize`) that
`CanonicalLeagueRules` has no notion of, not because the settings disagree. So
1.1b remains "split the shared derive", and the split is now known to be clean:
the league half genuinely is league-shaped.

## 3. Target architecture

```
PRODUCERS (feed →)                    DECISION OS                  SURFACE (← consume)
─────────────────                     ───────────                  ──────────────────
value.offense   ┐
value.idp       ├─→ CanonicalValue ─┐
value.kicker    │                   │
value.college   ┘                   │
                                    ├→ Canonical World ─→ Decision Object ─→ Chimmy
projections     ─→ AFProjection ────┤   (facts + provenance   (four answers      packet
                                    │    + confidence          + verdicts)
import          ─→ ImportAssertion ─┤    + age)
                                    │
lineup/waiver/  ─→ OsFactSource ────┘                             commissioner-os
trade/draft                                                       fantasy-os
```

Two rules that must not bend:

1. **Producers never read Decision OS.** Consumers never write to it.
2. **AI may explain, prioritise and communicate a deterministic decision. It
   may never generate, replace or fabricate a fact.** (Architecture freeze,
   invariant P3.) three-brain and Chimmy both sit strictly downstream.

---

## 4. The plan

Each phase is independently shippable and leaves the tree working. Phases are
ordered by dependency, not by size. Everything ships behind a flag (D11).

### Phase 0 — Make the ground true (prerequisite)

**Status as of 2026-08-31: 0.1 ✅ done · 0.3 ✅ done · 0.2 ⏸ written, awaiting
authorisation to run.**

**0.1 ✅ Correct the stale three-brain header.** Done — and the correction was
larger than expected. The directory holds **two stacks**: the Phase 1/1.5
orchestrator (`runThreeBrainAnalysis`, genuinely zero callers) and the
Phase 2/3/4 managed-intelligence path (live in six routes, and it does *not*
go through the orchestrator — `generateLeagueIntelligence` calls
`runManagedIntelligence` directly). The old sentence was true of its own
subject and false of the directory, which is exactly why it misled. Both
halves are additionally gated by `AI_FEATURES_ENABLED`, off unless set to the
string `'true'` — so "imported by a route" and "running in an environment" are
separate claims and neither implies the other.

**0.2 ⏸ Measure identity coverage before designing anything on top of it.**
Script written: `scripts/audit-player-identity-coverage.ts`. Read-only —
counts, groupBys, bounded selects; no writes, no raw SQL, no schema access.

🛑 **It refuses to run off `.env` on purpose.** `.env` and `.env.local` both
resolve to the production endpoint (`ep-curly-block-…`), and importing
`@prisma/client` populates `DATABASE_URL` from `.env` on import. The client is
therefore constructed with an explicit `datasourceUrl` from
`AF_IDENTITY_AUDIT_DB` and exits 2 without it — naming the database *is* the
opt-in, the same principle as `vitest.setup.db-guard.ts`. **The refusal was
verified red before the script was offered** (exit 2, no connection attempted).

It reports two things, and the plan depends far more on the second:
**(A)** registry coverage per sport per id space, and **(B)** coverage of the
ids **real rosters actually contain** — see §2.8 for why those differ and why
only (B) gates D13. Publish the figures the way
`lib/values/publishedValueEvidence.ts` publishes its own: figure, sample, date.
**Blocks 2.1.**

⚠ (B) over-collects by construction — the walker cannot know which JSON keys
hold ids — so a low resolved-% means *"not proven to resolve"*, never
*"proven broken"*. Use it to pick which sport to investigate properly.

**0.3 ✅ Complete the unwired-module audit** (D12). Done — **40 directories**,
three positive controls passed first. Results and the three-category framing
are in §2.7, triage of the remaining 37 in §2.9. The two largest hits are
load-bearing-in-waiting, not dead, so **this is a question list and not a
delete list**.

**0.4 🆕 Identify what creates name-only NCAAF identity rows.** Added after
0.2 — see §2.12. Not in the original plan because nothing suggested it until
two runs of the same script disagreed.

Why it is a gate and not a curiosity: it adds ~4,000 unreachable NCAAF rows per
interval, which means **every percentage in §2.10 decays continuously** and the
college half of the value contract has a moving denominator. Four writers are
already ruled out by reading them (§2.12); the remaining creators are the
`scripts/backfill-*` family and anything reaching `playerIdentityMap.create`
that this pass did not open.

Method that will actually settle it, in preference order:
1. `createdAt` histogram on NCAAF rows where every id column is null — the
   creation *times* name the job far more reliably than the code does.
2. Cross-check those times against `SyncJobRun` and the cron schedule.
3. Only then read the suspected writer.

⚠ Do not delete the name-only rows on discovery. They may be the only record of
a college player the roster references by name, and `lib/devy/devyValueBoard.ts`
already documents what happens when an absence is rendered as a confident zero.

### Phase 1 — Turn the feeds on

**1.1 ✅ Build the refresh scheduler.** Shipped as
`app/api/cron/domain-os-refresh/route.ts`, scheduled `*/30` in
`cron-schedule.json`, with a keep-line in `scripts/vercel-next-build.cjs`.

🛑 **IT SCHEDULES ONE SOURCE, NOT FIVE, AND THE PLAN ABOVE WAS WRONG TO SAY
"EVERY REGISTERED SOURCE".** A source is schedulable only if its `derive` can be
satisfied from league-level inputs. Exactly one can:

| source | schedulable | why |
|---|---|---|
| `draftRulesSource` | ✅ | `resolveCanonicalLeagueRules(leagueId)` — league in, league out. Also the most expensive: seven queries per draft-runtime resolve. |
| `waiverSettingsSource` | ❌ | `level:'league'`, but `derive` is the shared `deriveWorldFacts({userId, leagueId})` returning that user's FAAB and priority. |
| `tradeSettingsSource` | ❌ | same shape — needs an ordered roster pair, returns both sides' record and FAAB. |
| `lineupWarehouseSource` / `lineupSignalSource` | ❌ | user- and week-parameterised by nature. Not league facts, ever. |

Scheduling the middle two would mean inventing a userId or roster pair and
**storing one manager's private resource facts under a league-scoped key**.
Nothing reads those entries today, so it would not break anything now — it
would lie later, and it is precisely what `waiver-os/index.ts` warns about,
reached from the WRITE side: it would *"let the system tell someone they can
afford a bid they cannot"*. **1.1b** is the small refactor that fixes it.

Three things worth copying from the implementation:
- **Due-ness is a read, not a guess.** `refresh()` re-derives unconditionally,
  so the walk calls `safeRead` first with the source's own `ttlMs` — the same
  question `get` asks. Producer and consumer share one definition of stale
  instead of drifting apart.
- **`rotateForFairness` is load-bearing.** A fixed-order walk that stops on
  budget refreshes the first N leagues forever; `runBudget.ts` records exactly
  that happening in production, with four sports frozen at one date.
- **NFL-scoped because `draftRulesSource.sport` is hardcoded `() => 'NFL'`.**
  A fact derived for another sport would be filed under the wrong partition.
  Widening that is a D17 follow-up on the *source*, not on this cron.

⚠ **Verified without running `scripts/vercel-next-build.cjs`**, which
`renameSync`s route files out of the tree and rewrites `next.config.js` — not
safe in a checkout shared with sessions holding uncommitted work. The keep-line
was checked by mirroring the guard's inputs, with a negative control proving
the membership test can report a miss. Typecheck was scoped by **inputs** (a
temp tsconfig including only the route), and an injected type error was
confirmed reported at the right line **before** the clean run — which is what
makes the exit-0 meaningful rather than merely empty.

**1.2 ⏸ Wire Draft OS — BLOCKED, and the reason corrects 1.1's own claim.**

The plan said `resolveNflRedraftDraftRuntime` is the call site. It is — the
`DraftRuntimeDeps.loadRules` seam already exists and `createDraftOsLoaders()`
returns exactly that shape, so the wiring itself is two lines.

🛑 **BUT `resolveNflRedraftDraftRuntime` HAS ZERO CONSUMERS.** No route, no
component, no service. The only reference anywhere is
`__tests__/draft-os.test.ts`. Wiring Draft OS into it connects a dead feed to a
dead resolver.

It is the odd one out in a family of four, which is why this reads as a missing
route rather than an abandoned module:

| canonical runtime resolver | live routes |
|---|---|
| `playoff-runtime` | 4 |
| `roster-runtime` | 1 |
| `schedule-runtime` | 1 |
| **`draft-runtime`** | **0** |

Live drafts do not go through it at all — they run on
`lib/live-draft-engine/DraftSessionService` (`buildSessionSnapshot`), reached
from `/api/draft/room/state` and the commissioner draft route.

⚠ **THIS CORRECTS 1.1's HEADLINE CLAIM, INCLUDING IN ITS COMMIT MESSAGE.**
`draft-os/index.ts` describes `draftRulesSource` as costing *"seven queries on
every draft-runtime resolve, which during a live draft is every poll and every
pick"*, and 1.1 repeated it. That describes a cost **nothing is currently
paying**, because there are no draft-runtime resolves. The cron is correct,
cheap and harmless — it maintains a true fact — but today **nothing reads what
it warms**.

**The value is real and it is somewhere else.** `resolveCanonicalLeagueRules`
IS called on live request paths — by `playoff-runtime` (4 routes),
`roster-runtime` (1) and `schedule-runtime` (1). The fact `draftRulesSource`
maintains is *league rules*, not draft rules; it is misplaced in `draft-os`
rather than wrong.

So 1.2 splits into two, and they are different sizes:

**1.2a ✅ DONE.** `lib/decision-os/league-os/` — the ruleset as a league-level
fact, plus a `deps.loadRules` seam on the three resolvers that have routes,
wired at their **GET** call sites.

- **60 seconds, not `draft-os`'s 6 hours.** Owner's decision, and the reasoning
  is the point: 6h is right for a draft (rules do not change mid-event) and
  wrong for an ordinary read path, where the realistic sequence is *"commissioner
  changes scoring, then opens the roster screen"*. A 6h entry answers that with
  the old rules and looks authoritative doing it — a worse bug than the query
  cost it saves. What 60s still buys is the burst: several resolvers reaching
  the same ruleset within one page load, each previously paying seven queries.
- 🛑 **No cron entry, deliberately.** `/api/cron/domain-os-refresh` fires every
  30 minutes; a 60-second fact is long expired before the next fire, so
  scheduling it would spend the derive and warm nothing while reporting healthy
  work. **Short-TTL facts are read-through by nature** — this is the boundary
  between what a scheduler is for and what it is not.
- 🛑 **Write paths deliberately excluded.** `generate*` / `advance*` /
  `finalize*` persist rows derived from the ruleset. Stale input on a read shows
  an old number for a minute; on a generate it writes one into the database,
  where nothing afterwards reveals which settings produced it. Also excluded:
  the schedule route's **second** call site, inside POST after `updateStandings`
  — "show me the result of what I just did" is where a cached input is most
  likely to be read as a bug.
- The seam is proven, not asserted: a control passing `loadRules: 123` fails
  the typecheck at the call site, so `deps` is enforced rather than decorative.

⚠ **A near-miss worth recording, and it is tonight's shape for the third time.**
The three route imports were inserted with `sed` after the last line matching
`^import `. In two files that line was **inside a multi-line `import { … }`
block**, which broke both files' syntax. The control then reported **the same 10
errors as the baseline** — and 9e's formulation is exactly right: *a control
that produces the same answer as the thing it is controlling has told you
nothing.* The `--listFiles` count had already said so (6 occurrences where 1 was
expected) and was read past. **Establish a zero baseline first; only then does a
control's red mean anything.**

**1.2b ✅ DECIDED 2026-08-31: no route, deprecated in place, retirement
condition written down.**

The tempting argument is symmetry — three of four canonical runtime resolvers
have routes, so the fourth looks unfinished. That is aesthetic, and acting on it
would manufacture a **second way to read draft state** alongside
`live-draft-engine`, which is the adopted one serving `/api/draft/room/state`
and the commissioner draft route today.

The evidence for how that ends is in this repo three times over: three modules
computing league health (§2.2), two entry points for waiver settings (§2.14),
and one ruleset cached twice at different lifetimes (§4 Phase 1.2). Each began
as a reasonable second implementation; none is cheap to reconcile now.

**Not deleted, and that is also a decision.** It is tested, harmless, and
`live-draft-engine` has not been *shown* to cover everything the canonical
resolver models. Deleting on "nothing calls it" alone is the same confidence
that produced those three duplicates, pointed the other way.

🛑 **The retirement condition, so it is not left to judgement later:** when
someone confirms `live-draft-engine` covers every fact
`resolveNflRedraftDraftRuntime` returns, delete the resolver **and** `draft-os`
together — nothing else imports either. Until then, adding callers to either is
the one move that makes the eventual cleanup harder.

### 2.15 1.4 was already done, and my evidence for it was a comment

**`classifyDraftStatus` has a caller.** `app/api/cron/import-players/route.ts:359`
runs it as the `devyDraftStatus` phase behind a 20h cadence gate, with runway
checks and honest deferral — landed as `ad514a334`, already on `origin/main`.

§2.6 of this file said it had none. That claim came verbatim from a comment in
`lib/devy/devyMarketBridge.ts:13`, which was true when written and stale by the
time I read it. **I quoted it as a measured fact and never grepped.**

⚠ **Second time tonight, same class.** The three-brain header (§2.3) said the
stack was unwired; six runtime paths said otherwise. Both times the plan
recorded a module's own comment as evidence. The rule this file already states —
*where a header and a measurement disagree, record the measurement* — only works
if a measurement is actually taken.

The source comment has been corrected in place, with a note saying explicitly
that it was mis-quoted into a plan, so the next reader does not repeat it.

⚠ **And the caution §2.6 attached to 1.4 was aimed at the wrong risk.** It warned
against backfilling. `classifyDraftStatus` does not backfill — it classifies the
current board against real CFBD draft picks for the current and prior year. It
also already **fails closed**: if zero draft years or zero team rosters load, it
aborts *before writing* rather than turning a CFBD outage into a fact about
every player. The real hazard was already handled by its author.

**1.3 🔄 Propagate `drainOutcomes()` — the premise was wrong, and the correction
splits it in two.**

This said *"three request paths already call it and discard the result."* They
do not. All three — `today/lineup-actions`, `waiver-ai/engine`,
`redraft/trade-proposals` — call `drainOutcomes()` and pass it to
`emitFeedOutcomes(domain, …)`, which emits `decision.os_feed` telemetry **and**
writes a durable `ApiUsageEvent` row via `recordDecisionOsFeed`. Its own comment
explains why: the console line is log-drain-only and unqueryable, and the
store-vs-live split is *"the ONLY evidence for whether `domain_os_facts` is
worth migrating."* So the telemetry half of 1.3 was built before this plan
existed.

**Done: League OS now emits too.** That was a hole in 1.2a's own work — the
module header claims the hit rate is *"MEASURABLE rather than assumed"*, and
the three routes did not emit, so it was neither. Each now builds the loader
**once per request** (so `drainOutcomes()` sees every fact that request
resolved) and calls `emitFeedOutcomes('league', …)`, matching what
lineup/waiver/trade already do. This is what makes the 60s TTL's value
checkable rather than argued.

**Deferred: the response half.** Carrying `servedFrom` / `ageMs` into the
*payload*, so a surface can say "facts up to 4h old", is genuinely not built —
telemetry goes to `ApiUsageEvent`, not to the caller. But **it has no consumer
until Phase 4**, and adding a field nothing reads is the exact pattern this
plan has now criticised three times (Draft OS, `lib/domain`,
`decision-os/canonical`). It belongs with `buildDecisionOsGroundingPacket()`
(4.1), which is the first thing that needs it — D16's per-fact
`isConclusive` cannot work without it.

⚠ **Note the shape this correction shares with 1.2.** Both plan items were
written from module headers and grep counts rather than from following the call
through, and both were wrong in the same direction: they described work as
missing that was partly done, and missed where the real gap was. The fix in
both cases came from trying to USE the thing.

**1.4 Schedule `classifyDraftStatus`** (§2.6). The sole writer of
`graduatedToNFL` / `draftYear` has no caller, so no devy player has ever left
the pool and the devy→market exchange rate can never be earned from
observation. Cheap to schedule, and it is the only path from the commissioner's
hand-set bridge to a measured one. Belongs beside `import-players`, which
already runs the other devy phases.

⚠ **Do not backfill history on the first run.** 335 players were
draft-eligible in 2026; classifying them retroactively without their real
draft outcomes would manufacture the very observations the rate is meant to be
fitted to. Start the series from now and say so.

### Phase 2 — The value contract

**2.1 Define `CanonicalValue`** (D3, D4, D13). One shape:

```ts
{ playerId,            // PlayerIdentityMap.id — the canonical spine
  idSpace, sourceId,   // what it was resolved FROM, kept for audit
  value,
  unit,                // REQUIRED (D15): 'market_units' | 'devy_points'
  positionRank, overallRank,
  basis,               // 'market' | 'vorp' | 'share_at_rank' | 'devy_model'
  scope,               // 'global' | 'league'
  confidence,          // marketStdDev-derived, or model confidence
  sampleSize,          // tradeFrequency, games, or n
  asOf, sourceModule }
```

⚠ **`unit` is not documentation — it must be load-bearing.** Any helper that
sums, compares or diffs two `CanonicalValue`s refuses when the units differ,
unless that league has an explicit `devyMarketUnitsPerDevyPoint` bridge, in
which case the result carries `DEVY_BRIDGE_CAVEAT`. A test must prove the
refusal fires, or this degrades to a comment on a field nothing checks — which
is how the invented conversion gets back in.

**2.2 One adapter per producer** — offense, IDP, kicker, college. Adapters
only; no valuation maths moves. Each returns `null` rather than a default when
it cannot price a player.

**2.3 Register `'value'` as an `OsDomain`.** Widen the union in
`domain-os/types.ts`. Global values at **app** level keyed by
sport+format+qbFormat; league-rescored values at **league** level.

**2.4 Rescore-at-read for IDP and kicker** (D4). Copy the shape of
`af-projections/rescoreForLeague.ts` — pure rules-in/points-out, returns null
whenever it cannot do better than the stored value.

### Phase 3 — Projections and imports as feeds

**3.1 Register `'projection'` as an `OsDomain`** (D6). Reads
`AFProjectionSnapshot`; Decision OS never calls `buildAfProjection`. The
per-league IDP rescore happens at read, since it is already written that way.

**3.2 Register `'import'` as an `OsDomain`** and emit the four assertions
(D7): freshness per scope, parity verdict, coverage score, identity-resolution
confidence. `externalMatchupParity` and `fantraxMatchupParity` already compute
the parity verdict and nothing downstream can read it — that is the first one
to surface.

**3.3 Define `conclusive` — per FACT, not per league** (D16).

Not one boolean about a league. Each fact in the grounding packet carries its
own conclusiveness, derived from the assertions its inputs actually depend on:
a stale matchup sync makes a start/sit claim non-conclusive while leaving the
league's scoring rules perfectly conclusive.

So the predicate is `isConclusive(fact) → { ok, blockedBy[] }`, where
`blockedBy` names the assertion that failed — stale scope, parity mismatch,
coverage gap, unmapped identity. Chimmy answers everything `ok`, declines the
rest, and says which assertion blocked it and what would fix it.

⚠ **A league-level boolean is the tempting shortcut and it is wrong twice
over:** it refuses answers that are perfectly well-grounded, and it hides
*which* part is broken behind a single unhelpful flag.

### Phase 4 — Chimmy on Decision OS

**4.1 Build `buildDecisionOsGroundingPacket()`.** One object, assembled from
warm storage: league facts, values, projections, import assertions, behavioral
intelligence, and — for every one of them — `asOf`, `confidence`,
`servedFrom`, and the gap reason when absent.

**4.2 Wire it into `/api/chat/chimmy`** (D2). Beside
`buildLeagueSportsGroundingPacket` initially, so nothing regresses.

**4.3 Move the orphaned grounding behind Decision OS** (D1). `/api/chimmy`'s
three resolvers and `ChimmyContextEngine`'s 12 providers become Decision OS
feeds. **They are the specification of what the packet must contain** — do not
design the packet without reading all 15 first.

**4.4 Implement the no-fact rule** (D8). Extend the existing prompt rule with
the reason Decision OS now supplies: not synced / not entitled / not yet
computed / no identity match.

**4.5 Retire the duplicate routes.** `/api/chimmy` and `/api/ai/chimmy` become
shims that forward. Only after 4.2 is proven.

### Phase 5 — Proof and beta

**5.1 Internal proof surface** — one page showing every fact Decision OS holds
for a league, with age, confidence and source. This is how you see what Chimmy
sees. Internal only (D11).

**5.2 Entitlement and degradation pass** — cold leagues, missing identities,
unsynced scopes. Every path must degrade to a named gap, never to a zero.

**5.3 Flags and kill switches** per feed, reusing `liveReadiness.ts`'s
per-namespace pattern.

### Phase 6 — Deferred, tracked here so it is not lost

**6.1 Collapse the three health scorers** (D10). `commissionerHubHealth`,
`decision-os/commissioner-health`, and `behavioral/league-intelligence`'s
`leagueEngagementScore`. Keep the third. Until this lands, Chimmy's answer to
*"is my league healthy"* depends on which module answers.

**6.2 three-brain as Chimmy's reasoning layer.** Already live in 6 paths
(§2.3), so this is an extension, not an activation. Strictly downstream of
facts — invariant P3.

**6.3 Commissioner OS B2B/B2C cohort unification.** See the companion review:
`derivePlatformBehavioralIntelligence` already takes an array, so both tiers
are one function with different cohorts. ⚠ **Blocked** — the four DB roles are
still `NOLOGIN` and the app's role inherits `commish_migrate`, so `withTenant`
sets the GUC, passes any test asserting it was called, and isolates nothing.

---

## 5. Open questions

Two of the original four were resolved on 2026-08-31 and became D15 and D16;
the evidence is in §2.6 and §3.3 respectively. Remaining:

1. **Which of the 12 `ChimmyContextEngine` providers are genuinely Decision OS
   facts, and which are raw lookups?** Resolve during 4.3 by reading them —
   not in advance. The distinction decides what the packet must hold versus
   what Chimmy may still fetch directly.
2. **Does `/api/ai/chimmy`'s single caller need it,** or can
   `LeagueSettingsSubPanels.tsx` move to the canonical route immediately?
   Cheap to check, and it would retire one of the three backends early.

---

## 6. Provenance of this file

Findings measured 2026-08-31 against the working tree at branch
`commish-os/phase-0-1b`, by direct file read and grep — not from memory and
not from module headers, two of which (three-brain's, and Draft OS's implied
consumer) proved stale. Counts: `lib/decision-os` 270 TS files,
`lib/commissioner-os` 108, `lib/fantasy-os` 33, Chimmy 217 across 14
directories, 52 cron entries, 713 Prisma models.

Companion review of the Commissioner OS B2B/B2C split and the seven-step
architecture remediation: published artifact *One Engine, Two Cohorts*.
