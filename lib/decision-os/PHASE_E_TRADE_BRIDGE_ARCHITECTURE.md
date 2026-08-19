# Decision OS — Phase E: Trade Bridge Architecture (ADR-DOS-003)

**Status:** **APPROVED 2026-06-29** and amended with the reusable **Canonical Asset contract** + four
permanent principles (§0.1). Phases **E.1 + E.2 + E.3 + E.4 + E.5 BUILT** (read-only, shadow-only). **Amendment 2026-06-29
(post-E.2, approved):** added the decision-specific **`TradeWorld` contract** + **`MarketContext`** (§3.1);
the memo consumes `TradeWorld`, never `CanonicalWorld` directly — trade now follows the same `Canonical
World → Decision-specific World → Memo → Decision → Explainability → Telemetry` pipeline as lineup/waiver/
commissioner. E.3 renamed **`TradeWorldResolver`** (consistent with World/Context/Decision Resolution). **E.3
BUILT 2026-06-29:** `lib/decision-os/trade/tradeWorld.ts` (`resolveTradeWorld` + `TradeWorld`/`MarketContext`)
and `buildTradeMemo(tradeWorld)` in `canonicalMemo.ts`; the acceptance gate — `buildTradeMemo(resolveTradeWorld(x))`
**byte-identical** to E.2 `buildCanonicalTradeMemo(x)` for equivalent inputs — passes (proves the new contract
is an architectural wrapper, not a behavior change). The
P3 AI-governance rule (§0.1) was elevated to its formal standing wording. The original audit (§1–§12) stands
as the rationale of record; §0.1, §3, §3.1, §7 carry the approved amendments.

**Scope:** Design the provider-agnostic Trade Bridge that lets `manager.trade.evaluate` consume the
**Canonical World** substrate (`lib/decision-os/world/`) while preserving parity with the existing
redraft-native trade pipeline. Trade is the most complex remaining slice; this ticket de-risks it the
same way ADR-DOS-002 de-risked the substrate — **ADR → Build → Validate → Enrich → Cutover.**

**Constraints that remain in force during the E.1+ build** (the original "architecture-only" hard rules
relax only as far as each approved phase allows): every phase is **read-only + shadow-only + flag-gated**;
no cutover (that is Phase G, governed); no legacy deletion (Phase H); no Decision OS *core* changes; the
deterministic pipeline owns every fact and every grade (P3). The asset contract is built in the **Canonical
World layer**, never under `trade/` (the binding rule, §0.1).

> **Companion docs:** [`PHASE_2_CANONICAL_BRIDGE_ARCHITECTURE.md`](./PHASE_2_CANONICAL_BRIDGE_ARCHITECTURE.md)
> (ADR-DOS-002 — the substrate macro-architecture; **approved & built**), [`DECISION_REGISTRY.md`](./DECISION_REGISTRY.md),
> the trade slice under `lib/decision-os/trade/`, the substrate under `lib/decision-os/world/`, and the
> lineup bridge `lib/decision-os/lineup/canonicalBridge.ts` (the **template** this bridge mirrors).

---

## 0. The single most important finding (read this first)

**The deterministic trade value engine is already pure and provider-agnostic. The redraft coupling
lives entirely in the *capture harness* and the *loader* — not in the computation.**

```
captureRedraftTradeValueSnapshot   ──reads──►  RedraftRoster / RedraftSeason / AdpDataRecord
   (redraft-bound harness)                       │  record · pointsFor · seed · positions · leagueSize · adp
        │ builds EnrichedTradeAsset[] + TeamProfile[] + context
        ▼
buildTradeValueSnapshot(assets, context, currentSeason, profiles)   ◄── PURE. No prisma. No provider.
   (lib/trade-value/snapshot.ts + valueEngine.ts + grader.ts)            No redraft assumption in the math.
        ▼
   TradeValueSnapshot (sides[], grade, fairness, confidence)  =  the evaluation MEMO
```

Every input the redraft harness feeds the pure engine **already exists in the Canonical World**:

| Pure-engine input | Redraft harness source | Canonical World equivalent (built) |
|---|---|---|
| team record (W/L/T) | `RedraftRoster.{wins,losses,ties}` | `TeamFacts.record` ✅ |
| points for | `RedraftRoster.pointsFor` | `TeamFacts.pointsFor` ✅ |
| playoff seed / rank | `RedraftRoster.playoffSeed` | `TeamFacts.rank` ✅ (seed≈rank) |
| roster positions (profile) | `RedraftRosterPlayer.position` | `RosterFacts.playerIds` → **Phase D.1 metadata seam** (`resolvePlayerMetadata`) ✅ |
| league size | `RedraftRoster.count(seasonId)` | `world.teams.length` ✅ |
| ADP | `AdpDataRecord` (canonical, by `playerId`+`sport`) | unchanged — already canonical ✅ |
| projection | asset `metadata.restOfSeasonProjection` | asset metadata (carried on the proposal) ✅ |

**Consequence for the whole plan:** ADR-DOS-002's framing of "**no canonical trade evaluation memo**"
(its §2.1 / §9 "High" debt) is real but **narrower than it sounds**. The memo is not a missing
computation — it is a *pure function whose inputs are now canonically available*. Phase E is therefore
**"rehost the pure engine on a canonical trade-view assembler,"** not "invent a fairness model." This is
the lowest-risk possible shape for the hardest slice, and it is the backbone of the recommendation in
§11.

The **one genuinely missing fact** is **pick ownership inventory** for dynasty/keeper future-pick
trading (§3, §5) — and that degrades honestly today exactly as 3+ team trades already do.

---

## 0.1 Architectural principles this ADR makes permanent

*(Approved amendment, 2026-06-29.)* ADR-DOS-002 §5 established **origin-blindness**: business logic never
branches on *where* a fact came from. This ADR adds three more principles and one binding contract rule —
all of which become standing Decision OS governance, not trade-specific notes.

### P1 — Purpose-blindness *(new principle)*

> **The Canonical World must never know *why* a field exists.**

Origin-blindness says the world doesn't know *where* a fact came from. Purpose-blindness says it doesn't
know *what it's for*. The world records what is **true about reality**; every decision type reads the same
truths. A weather fact is not "a lineup input that happens to live in the world" — it is a truth the world
holds that *any* decision may consume.

```
                          ┌───────────────┐
 Weather  ─┐              │               │      ┌─► Lineup
 Injuries ─┤              │   Canonical   │      ├─► Trade
 News     ─┼─►(adapters)─►│     World     │─► DOS ┼─► Commissioner
 Usage    ─┤              │   (truths)    │      ├─► Waiver
 Market   ─┘              │               │      ├─► Chimmy
                          └───────────────┘      └─► future tools
```

The world thinks *"this is true about reality,"* never *"this is for lineup."* This keeps the world model
reusable across every current and future decision type and is the precondition for the enrichment layer
(Phase F) and the licensing layer (Phase I).

### P2 — Enrichment is truth, not feature

Every integration/API added to the platform must answer **"What truth does this add to the Canonical
World?"** — never *"What feature does this power?"* Enrichment lands as origin-blind, purpose-blind **facts**
in the substrate (Phase F), shared by every decision once, never wired feature-by-feature. (Applied in §9.)

### P3 — AI governance *(permanent Decision OS rule)*

> **AI may summarize, explain, prioritize, or communicate deterministic decisions.**
> **AI may never generate, replace, or fabricate deterministic facts used by the Decision OS.**

*(Formalized 2026-06-29 — the standing governance wording. This is the canonical statement of the rule; the
earlier phrasing "AI may explain a deterministic decision, summarize supporting evidence, or communicate
uncertainty — but it must never create or replace deterministic facts used by the Decision OS" is preserved
in spirit and superseded in wording. "Prioritize" is admitted because ranking already-deterministic options
for presentation is a communication act; "generate/replace/fabricate" close the loop on fact creation.)*

The deterministic World → DCO → Rules → Decision pipeline owns every fact and every grade. AI is an
explanation/communication layer over a settled decision — it may order or surface what the deterministic
layer already decided, but the values, grades, fairness, and confidence it speaks about are never of its
own making. This protects platform integrity as AI surface area grows (Chimmy and beyond) and is the
boundary that keeps the Decision OS auditable and licensable.

### The binding contract rule *(this ADR's design constraint for E.1)*

> **Every asset contract created during the Trade Bridge is designed as a reusable *Canonical Asset*
> contract that supports future enrichment, provider independence, and eventual licensing. Trade
> *consumes* that contract — it does not *define* it.**

Therefore the asset contract lives in the **Canonical World layer** (`lib/decision-os/world/`), not under
`trade/`. Trade adds only the *exchange semantics* (direction: from-roster → to-roster) on top of the
reusable asset. See §3.

---

## 1. Current trade dependency map

Traced through `lib/decision-os/trade/{loader,world,dco,decision,rules,parity,deps,shadow,index}.ts`,
`lib/trade-value/*`, the redraft trade route, and `prisma/schema.prisma`.

### 1.1 Pipeline (today, redraft-native)

```
route (proposal create) ──► captureRedraftTradeValueSnapshot ──► persist RedraftTradeValueSnapshot (immutable memo)
        │                                                              │
        │  (DECISION_OS_TRADE_SHADOW)                                  │ payload (JSON)
        ▼                                                              ▼
runTradeShadowForProposal ──► loadTradeWorldFacts (prisma) ──► resolveTradeWorld ──► buildTradeDCO
        │                         League + RedraftSeason + RedraftRoster×2          (participants[] from assets)
        ▼
decideTradeEvaluate(dco, { evaluate: () => memo })  ──► snapshotToEvaluation ──► Decision<TradeEvaluation>
        ▼
compareTradeParity(decision, memo)  ──► emitShadowParity   (WRAP-FIDELITY: fed the same persisted memo)
```

The slice is **wrap-fidelity over a persisted memo**: the route computes & persists the deterministic
snapshot; the shadow feeds that *same* snapshot to the Decision OS and proves the wrapper adds no drift.

### 1.2 Dependency table (origin classification)

| # | Source | Provides | Canonical? | Where it couples |
|---|---|---|---|---|
| 1 | `prisma.league.findUnique({sport,tradeReviewHours,tradeDeadlineWeek,draftPickTrading})` | trade settings | **Yes** (`League` shared) | `loader.defaultTradeLoaderDeps.loadLeagueSettings` |
| 2 | `prisma.redraftSeason.findFirst({currentWeek,season})` | season week | **No** | `loader.loadSeason` |
| 3 | `prisma.redraftRoster.findFirst({faabBalance,wins,losses,ties,pointsFor,playoffSeed})` ×2 | per-roster resource/standings | **No** | `loader.loadRoster` |
| 4 | `RedraftTradeValueSnapshot.payload` (the memo) | **the deterministic grade itself** | **No** (FK → `RedraftTradeProposal` → `RedraftRoster`) | route capture + `deps.evaluate` |
| 5 | `RedraftTradeAsset` rows | the asset graph (from/to/type/player/pick) | **No** | route → `assets: TradeAssetSummary[]` |
| 6 | `captureSnapshot.profileFor` → `prisma.redraftRoster` (+ `players.position`) | team profiles (stance/weak/strong) | **No** | `lib/trade-value/captureSnapshot.ts` |
| 7 | `prisma.adpDataRecord.findMany` | ADP value source | **Yes** | `captureSnapshot` |
| 8 | asset `metadata.restOfSeasonProjection` | projection value source | **Yes** (carried on proposal) | `captureSnapshot` |

**Provider-agnostic already (no change needed):** `resolveTradeWorld`, `buildTradeDCO`,
`deriveParticipants`, `evaluateTradeRules` (deadline/FAAB/snapshot world rules), `decideTradeEvaluate`,
`snapshotToEvaluation`, `compareTradeParity`, and the entire `lib/trade-value` math. None import prisma;
none name a provider or a redraft table. This matches ADR-DOS-002 §0 — **the coupling is the loader +
the capture harness, items 2/3/4/5/6 above.**

---

## 2. Canonical World coverage matrix

Every trade input mapped against the **built** substrate (`lib/decision-os/world/facts.ts`). Classes:
**Available** (substrate carries it today) · **Derived** (substrate computes it) · **Missing** (no
canonical source yet) · **Future enrichment** (a fact a later phase adds).

| Trade input | Canonical World fact | Class | Notes |
|---|---|---|---|
| Trade settings (review/deadline/pick-trading) | `LeagueFacts.tradeSettings` | **Available** | `reviewHours`, `deadlineWeek`, `pickTrading` already assembled |
| Current week | `LeagueFacts.currentWeek` (+ `currentWeekBasis`) | **Derived** | from `TeamPerformance`; honest `unavailable` basis when no source |
| Per-roster FAAB | `TeamFacts.faab.{remaining,budget,used,remainingDerived}` | **Derived** | substrate derives `remaining = budget − used` (ADR-DOS-002 §12.3 fix) |
| Record / PF / rank | `TeamFacts.{record,pointsFor,rank}` | **Available** | drives `buildTeamProfile` stance |
| Playoff seed | `TeamFacts.rank` | **Available** | seed≈rank; exact seed is a redraft-engine concept → honest approximation w/ provenance |
| Asset graph (player/pick/faab, from/to) | `AfLeagueTradeItem` (canonical, FK → `Roster`) | **Available** | already canonical — see §3 |
| Player positions (for profile + scarcity) | `RosterFacts.playerIds` + `resolvePlayerMetadata` (D.1 seam) | **Available** | the Phase D.1 metadata seam supplies position |
| ADP value source | `AdpDataRecord` (canonical) | **Available** | unchanged |
| Projection value source | proposal asset `metadata` | **Available** | carried at proposal time |
| **Pick ownership inventory** (dynasty future picks) | — | **Missing** | no canonical tradeable-pick-inventory table; `RedraftDraftPick` is draft-time only. Honest degrade until added (§3, §5, §8) |
| FantasyCalc / market value | `AssetValueSources.fantasyCalcValue` (deferred null today) | **Future enrichment** | belongs in substrate enrichment (§9), not the adapter |
| Rankings value source | `AssetValueSources.rankingValue` (deferred null today) | **Future enrichment** | §9 |

**Verdict:** **9 of 11 trade inputs are Available or Derived from the built substrate today.** The two
that are not — pick inventory (Missing) and market/rankings values (Future enrichment) — both already
degrade honestly in the current engine (`fantasyCalcValue: null`, `rankingValue: null`, picks
reference-only in redraft). The bridge inherits that honesty; it does not regress it.

---

## 3. The reusable Canonical Asset contract (Resolution → Enrichment → Context)

Per the binding rule (§0.1), E.1 does **not** build a trade-specific asset type. It builds a reusable
**`CanonicalAsset`** in the world layer that every decision can consume, assembled in three layers that
also map cleanly to the build phases:

```
 Canonical Asset Resolution   →   Canonical Asset Enrichment   →   Canonical Asset Context
  (what the asset IS,               (external truths about it,        (what it MEANS in this
   from the canonical graph)         origin/purpose-blind facts)       league / roster situation)
         E.1                               Phase F                          E.2 / E.3
```

The redraft asset graph (`RedraftTradeAsset`) and the canonical graph (`AfLeagueTradeItem`) are already
**structurally the same shape**, and the canonical one is already provider-agnostic (FK → `Roster`,
`itemType`/`itemReference`/`faabAmount`/`from`/`to`). E.1 projects that graph into the **Resolution layer**
of one contract. The shape the Decision OS sees — and the *only* thing it sees — is:

```
CanonicalAsset {
  assetId        // stable canonical id (NOT provider-namespaced)
  assetType      // 'player'|'draft_pick'|'faab'|'contract'|'keeper'|'salary'|'devy'|'future_consideration'
  owner          // canonical roster/team ownership — null when unowned/unknown (never fabricated)
  value          // AssetValueSources + internalValue, or null when unvaluable (honest)
  metadata       // intrinsic facts:    player · pick · faab · contract · keeper · salary · devy
  enrichment     // external truths:    projections · injuries · weather · news · depthChart · usage · marketValue · trends · analytics
  context        // situational meaning: contenderScore · rebuildScore · rosterFit · positionalScarcity · leagueScoring · managerTendencies · playoffImpact · schedule
  provenance     // per-field origin + freshness + trust (origin-blind: lives HERE, never in logic)
  completeness   // honest 0..100 + which layers/fields are present
  uncertainty[]  // explicit unknowns; populated, never hidden
}
```

> **The Decision OS only ever sees `CanonicalAsset`.** It does not care where `value`, `enrichment`, or
> `context` came from — that is purpose-blindness (P1) and origin-blindness operating together. Adding a
> new enrichment API (Phase F) or a new provider changes *nothing* above this contract.

**Trade consumes — it does not define.** Trade adds only exchange semantics on top of the reusable asset:

```
TradeMovement { asset: CanonicalAsset; fromRosterId; toRosterId }   // the only thing trade adds
```

`deriveParticipants` (already implemented) builds the multi-team graph from these movements — so multi-team
is free once assets are canonical.

**E.1 scope = the Resolution layer only.** `enrichment` and `context` are present-but-**honestly-empty**
in E.1 (every field `null`, flagged in `completeness`/`uncertainty`); Phase F fills `enrichment`, E.2/E.3
fill `value`/`context`. An empty enrichment layer is *honestly empty*, never absent and never fabricated.

Coverage of the required (and now expanded) asset classes:

| Asset class | `assetType` | Layer that values it | Canonical readiness |
|---|---|---|---|
| Players | `player` | E.2 `normalizedPlayerValue(projection, adp, position)` | **Ready** — positions via D.1 seam |
| FAAB | `faab` | E.2 `normalizedFaabValue(amount)` | **Ready** — `faabAmount` on item; balance via `TeamFacts.faab` |
| Draft picks (current) | `draft_pick` | E.2 `normalizedPickValue(round, season)` | **Conditional** — needs pick ownership (§5 Missing) |
| Future picks (dynasty) | `draft_pick`, `season > current` | E.2 discounted 15%/yr (engine ready) | **Blocked on inventory** — honest degrade |
| Keeper assets | `keeper` (+ league keeper settings) | E.2 player value | **Ready** (value); keeper-cost rules are a future rule module |
| Contract / salary | `contract` / `salary` | F enrichment (cap context) | **Modeled, unvalued** until salary-cap enrichment lands |
| Devy | `devy` | F enrichment (devy market) | **Modeled, unvalued** until devy market enrichment lands |
| Conditional assets | `future_consideration` | **unvalued by design** | **Honest placeholder** — lowers `completeness`, raises `uncertainty[]` |

**Design rules for the asset contract:**
1. **No redraft assumption.** Pick provenance (`metadata.pick.originalRosterId`/`season`/`round`) models a
   tradeable pick without a redraft draft.
2. **Unknown value is never fabricated.** Unowned/unvaluable assets set `value: null`, lower `completeness`,
   and raise `uncertainty[]` — the existing `fantasyCalcValue: null` / 3+ team `unsupported` discipline.
3. **The contract is reusable by construction.** It carries `enrichment`/`context` slots from day one so
   Phase F and future decisions extend it *additively* — no schema churn, no trade coupling, licensing-ready.

---

## 3.1 The decision-specific `TradeWorld` contract *(amendment, approved 2026-06-29)*

**The memo must consume a `TradeWorld`, not `CanonicalWorld` directly.** This is the missing contract that
makes trade follow the *same* shape every other decision already uses:

```
Canonical World            ← origin-blind, purpose-blind FACTS only (it never knows "why")
        ↓
Decision-specific World     ← lineup / waiver / commissioner / TRADE  (decision-scoped, owns its context)
        ↓
Decision Memo               ← deterministic engine rehosted on the decision-specific world
        ↓
Decision Object             ← grade / recommendation
        ↓
Explainability (AI)         ← P3: explains/prioritizes, never fabricates
        ↓
Telemetry
```

Lineup, waiver, and commissioner each already resolve a decision-specific world off the Canonical World;
trade is the last to adopt it. The `TradeWorld` is that contract:

```
TradeWorld {
  participants:   TradeParticipant[]              // { rosterId, teamId, managerUserId } per side
  assets:         TradeMovement[]                 // CanonicalAsset + { fromRosterId, toRosterId }
  teamProfiles:   Record<rosterId, TeamProfile>   // resolved from TeamFacts (record/PF/rank → stance)
  leagueContext:  TradeLeagueContext              // sport, season, scoring, rosterFormat, isDynasty, currentWeek, settings
  marketContext:  MarketContext                   // see below — owned HERE, not by Canonical World
  constraints:    TradeConstraints                // deadline week, review window, pick-trading allowed, roster legality
  warnings:       string[]
  provenance:     WorldProvenance                 // carried from the Canonical World (origin lives only here)
  completeness:   number                          // 0–100, honest
  uncertainty:    string[]                        // honest, never fabricated
}
```

### `MarketContext` — decision-specific, owned by `TradeWorld` (never by Canonical World)

Trade is unique: it depends on information *outside* the roster. The Canonical World owns **facts**; the
*market interpretation* of those facts (scarcity, market value, news/injury impact) is **decision-specific**
and therefore lives on the decision-specific world, not the substrate.

```
MarketContext {
  adpByPlayerId:          Record<playerId, number | null>
  marketValueByPlayerId:  Record<playerId, number | null>
  projectionByPlayerId:   Record<playerId, number | null>
  projectionSource:       string | null            // provenance/debug only — never a decision branch
  positionalScarcity:     Record<position, number> // engine POSITION_SCARCITY, made explicit + auditable
  leagueScarcity:         Record<position, number> // scarcity relative to THIS league's roster needs
  injuryMarketImpact:     Record<playerId, number | null>   // Phase F enrichment; null+uncertainty until then
  newsImpact:             Record<playerId, number | null>   // Phase F enrichment; null+uncertainty until then
  confidence:             number                   // share of assets with a real market signal
}
```

**Boundary rule (a corollary of P1 purpose-blindness):** the Canonical World stays facts-only. Market
value, scarcity, injury-market, and news impact are *interpretations for the trade decision* and belong to
`TradeWorld.marketContext`. Other decisions may compute different context off the same Canonical World facts
— that is precisely why the substrate must not own it. Each `MarketContext` field that is not yet sourced is
**honestly null + raised in `uncertainty[]`** (the E.2 degradation discipline), never fabricated (P3).

The E.2 memo's injected `CanonicalMemoEnrichment` (adp/projection/position) is the *seed* of `MarketContext`:
E.3 widens it into the full contract and the memo's signature moves from `(CanonicalWorld + enrichment)` to
`(TradeWorld)`. The memo logic is unchanged — it simply reads its inputs from one settled contract.

---

## 4. Trade evaluation memo architecture

**Question:** should the Canonical World generate a reusable evaluation memo, or should the Trade Bridge
assemble it on demand?

**Recommendation: BOTH, layered — mirror the redraft pattern, honor the lineup-bridge pattern.**

1. **On-demand in the bridge during SHADOW (read-only).** The bridge computes the memo in-memory by
   rehosting the **pure** `buildTradeValueSnapshot` on a canonical trade-view (team profiles from
   `TeamFacts` + positions from the D.1 seam; assets from `AfLeagueTradeItem`; ADP from `AdpDataRecord`).
   No write. This is the exact analogue of `resolveCanonicalLineupInputs` — native-first, canonical
   fallback, never throws, honest degrade. It is what the shadow runs and what parity compares.

2. **Pinned/persisted canonical memo at proposal time (later, native canonical trades).** Just as
   redraft persists an **immutable** `RedraftTradeValueSnapshot` at proposal time (so the grade is stable
   even if live values drift — schema comment line 13166), a canonical league should persist a
   `CanonicalTradeValueSnapshot` (FK → `AfLeagueTrade`) when proposals are created through the AF-native
   trade flow. This is a *write* and therefore **out of scope for the read-only bridge** — it is a
   Phase F/native-flow concern, named here as a prerequisite, not built.

**Why both, not one:** the lineup bridge proved that a *read-time projection* is the correct shadow-safe
unit (no writes, instant rollback). But trade value must be **pinned at proposal time** for fairness
integrity (a memo recomputed weeks later would grade a different trade). So: **read-time compute for the
shadow & parity; proposal-time persistence for the eventual source of truth.** During Phase E the
persisted redraft snapshot remains the parity reference where both exist (wrap-fidelity preserved).

**Determinism guard (ADR-DOS-002 §10 "trade timing"):** the on-demand memo must pin its value-source
inputs (projection/adp captured into the asset/world snapshot) so two runs on the same proposal+world
are byte-identical. The engine is already pure; the bridge must not read *live* values mid-evaluation.

---

## 5. World Resolution contract (what the trade-view assembler needs)

Per ADR-DOS-002 §4, Decision OS keeps **per-decision assemblers** over the shared substrate — no
god-object. Phase E adds a **`tradeWorldAssembler`** (the rewritten loader) that projects the Canonical
World into the existing neutral `TradeWorldInput` + `CanonicalAsset[]` movements (§3), exposing:

| Capability | Substrate source | Status |
|---|---|---|
| trade settings | `LeagueFacts.tradeSettings` | ✅ available |
| current week | `LeagueFacts.currentWeek` | ✅ derived (honest basis) |
| participant FAAB | `TeamFacts.faab.remaining` | ✅ derived |
| participant standings (record/PF/seed) | `TeamFacts.{record,pointsFor,rank}` | ✅ available |
| manager → team → roster ownership | `TeamFacts.managerUserId → teamId → RosterFacts.teamId` | ✅ available (origin-blind join; same as lineup bridge) |
| roster eligibility (size/slots after trade) | `LeagueFacts.rosterSettings` + `RosterFacts.playerIds` | ◑ partial — roster-legality rule module is future work |
| **pick ownership** | — | ✗ **Missing** — honest degrade (`draft_pick` → low completeness) until a canonical pick-inventory fact exists |
| trade restrictions (no-trade, veto mode) | `AfLeagueTrade.{reviewType,vetoMode}` + league settings | ◑ partial — settings available; enforcement is a rule, not a fact |
| commissioner settings | `LeagueFacts.tradeSettings` + health world | ✅ available |

**Origin-blindness (load-bearing, ADR-DOS-002 §5.2):** the assembler folds substrate
`provenance.freshness` → trust, and `completeness.warnings` → `uncertainty[]`. The Decision OS sees
numbers + trust levels, never "Sleeper." Origin travels only as a **telemetry flag**. The trade slice
already routes `data_completeness`/`uncertainty`/`provenance.weakest_trust` through the Decision Object —
the assembler simply feeds them from the substrate instead of redraft rows.

---

## 6. Provider abstraction strategy

**Goal (ADR-DOS-002 §6): zero provider-specific logic above the substrate.** Phase E adds nothing new
here — it *inherits* the substrate's abstraction. Validation targets: Sleeper, ESPN, Yahoo, Fantrax, MFL,
CBS, native AF.

- **Adapters stay below the substrate.** Trade never sees a provider; it sees `CanonicalWorld` +
  `CanonicalAsset[]`. The 6-provider adapter tree confirmed in ADR-DOS-002 §12.2 already feeds the
  substrate; trade is just another consumer.
- **Litmus test (must hold at Phase E exit):** grep `lib/decision-os/trade/` + the new
  `tradeWorldAssembler` for any provider name or `redraft*` table → **zero matches**. Today the trade
  *loader* fails this (reads `redraftSeason`/`redraftRoster`); the assembler must pass it.
- **Player-id namespaces:** trade values key on canonical player ids resolved via the same D.1 metadata
  seam the lineup bridge uses (raw provider ids → enriched position/name). No provider branching.
- **Settings dialects:** already normalized into `LeagueFacts` at import.

---

## 7. Migration roadmap (phased, shadow-safe, flag-gated)

Each phase is independently shippable, **shadow-only**, gated by `DECISION_OS_TRADE_SHADOW` +
`DecisionShadowScope` (targetable to `theciege24` / specific leagues in prod), parity GREEN on **both**
native and imported before advancing. No cutover, no legacy deletion in any phase.

**Trade phases (E.1–E.5)** — each read-only, shadow-only, flag-gated; parity GREEN on **both** native and
imported before advancing. **Platform phases (F–I)** follow once trade is shadow-proven.

| Phase | Deliverable | Exit criteria |
|---|---|---|
| **E.1 — Canonical Asset Resolution** ✅ **BUILT 2026-06-29** | The reusable **`CanonicalAsset` contract** (world layer) + a pure resolver that builds the **Resolution layer** from the canonical asset graph (`AfLeagueTradeItem`), with a read adapter from `RedraftTradeAsset` for parity. `enrichment`/`context` honest-empty. **No valuation.** | ✅ Asset graph + `deriveParticipants` identical between redraft and canonical assets for a known 2-team trade; **one reusable contract, no trade-specific asset type**; unit-tested with canonical fakes. Shipped: [`lib/decision-os/world/assets.ts`](world/assets.ts), test `__tests__/decision-os/canonical-asset-resolution.test.ts` (14 tests GREEN), architecture guard extended. Encoding: reusable `CanonicalAsset` (owner only) in the world layer; trade adds direction via the consumer's `toRosterId` (the §3 `TradeMovement` wrapper) — Trade *consumes*, never *defines*, the asset. |
| **E.2 — Trade Memo on Canonical Assets** ✅ **BUILT 2026-06-29** | Rehost the pure `buildTradeValueSnapshot` on canonical assets + canonical team profiles (`TeamFacts` + D.1 positions; ADP canonical) → fills `value` + trade-relevant `context`. Pure, no writes. | ✅ Shipped: [`lib/decision-os/trade/canonicalMemo.ts`](trade/canonicalMemo.ts) — a pure adapter (`TradeMovement[]` + `CanonicalWorld` + injected enrichment → engine `EnrichedTradeAsset[]`), `buildCanonicalTradeMemo` (calls `buildTradeValueSnapshot` verbatim, deterministic `capturedAt = world.provenance.assembledAt`), `compareTradeMemos` (memo↔memo parity), `buildCanonicalMemoTelemetry` (provider only in provenance). **Engine reused, not duplicated** (memo values == `normalized*` fns). Parity with the redraft snapshot GREEN on equivalent inputs; missing canonical projection degrades honestly (confidence/value differ, surfaced as diffs — the documented intentional difference, no fake parity). Tested: `__tests__/decision-os/trade-memo.test.ts` (12 GREEN); ticket suite 47 GREEN; full trade+architecture regression 60 GREEN; zero new type errors (3197 baseline). The memo is byte-compatible with `RunTradeEvaluateDeps.shadow.snapshot` → slots into E.4. The enrichment seam (ADP/positions via ports) is built in E.3. |
| **E.3 — `TradeWorldResolver`** ✅ **BUILT 2026-06-29** *(renamed from "Trade World Assembler")* | `resolveTradeWorld` projects `CanonicalWorld` → the **`TradeWorld` contract** (§3.1): participants, `TradeMovement[]`, `teamProfiles`, `leagueContext`, **`marketContext`** (ADP/positions/scarcity via read-only ports — widens the E.2 `CanonicalMemoEnrichment` seed), constraints, provenance, completeness, uncertainty. Native-first, canonical fallback (mirror `resolveCanonicalLineupInputs`); honest `*_unavailable`. The **memo's signature moves to `(TradeWorld)`** — it no longer reads `CanonicalWorld` directly. Naming is consistent with World/Context/Decision **Resolution**. | ✅ Shipped: [`lib/decision-os/trade/tradeWorld.ts`](trade/tradeWorld.ts) (pure `resolveTradeWorld` + `TradeWorld`/`MarketContext`/`TradeParticipant`/`TradeLeagueContext`/`TradeConstraints`) + `buildTradeMemo(tradeWorld)` in `canonicalMemo.ts` (the memo's signature now `(TradeWorld)`). Both memo paths share the SAME leaf helpers (`toEnrichedAsset`/`profileForRoster`/`computeMemoCompleteness`), so **`buildTradeMemo(resolveTradeWorld(x))` is byte-identical to `buildCanonicalTradeMemo(x)`** for full-enrichment / no-enrichment / missing-profile / native inputs (the acceptance gate — wrapper, not behavior change). `MarketContext` owns the market interpretation (substrate stays facts-only, §3.1 boundary rule); unsourced Phase-F fields degrade to honest-empty + uncertainty. Pure/read-only/origin-blind (no prisma, no provider branching). Tested: `__tests__/decision-os/trade-memo.test.ts` now 25 GREEN (13 new E.3); full decision-os regression GREEN (only the 2 pre-existing `lineup-shadow-route` failures remain, unrelated); zero new type errors (3197 baseline). Coexistence: legacy Slice-3 `trade/world.ts` keeps the barrel export pre-cutover; canonical module imported by path to avoid the `TradeWorld`/`resolveTradeWorld` name collision. ADP/position **port wiring + live `theciege24` validation deferred to E.4/E.5** (DB-gated). |
| **E.4 — Trade Shadow Parity** ✅ **BUILT 2026-06-29** | Mount the canonical assembler behind `DECISION_OS_TRADE_SHADOW` beside the redraft path; parity per-participant + grade; pick-only/3+ team degrade honestly. | ✅ Shipped: [`lib/decision-os/trade/canonicalShadow.ts`](trade/canonicalShadow.ts) — `runCanonicalTradeShadowAttempt(args, deps)` runs the canonical pipeline (`CanonicalWorld → resolveTradeWorld → buildTradeMemo → compareTradeMemos`) BESIDE the native path, attached inside `runTradeShadowForProposal` AFTER the (unchanged) native result, behind the existing `DECISION_OS_TRADE_SHADOW` gate (no route change — the route already wraps shadow in try/catch). Injectable read-only `resolveWorld` (default `resolveCanonicalWorld`, find* port only). Best-effort, **never throws**: structured skips `canonical_trade_world_unavailable` (no world / world doesn't cover both participant rosters — the redraft↔canonical roster-identity mismatch, full join is E.5) / `canonical_asset_resolution_unavailable` (no stageable assets) / `canonical_memo_unavailable` (multi-team or engine threw). Emits `decision.shadow_parity` with `source: 'canonical_trade_world'` + completeness/uncertainty-count/asset-count/participant-count/memo-source/valuation-source; **provider only under `provenance`** (never a decision-facing flag). Honest-degraded parity: no ADP/projection port yet (E.5) ⇒ player values floor to 0 ⇒ canonical snapshot DIFFERS from the redraft snapshot ⇒ parity `passed: false` with diffs surfaced honestly (no fake parity, P3). Read-only: no writes/persistence/cache-warming/proposal mutation. Canonical `TradeWorld` NOT barrel-exported (legacy `trade/world.ts` collision). Tested: `__tests__/decision-os/trade-canonical-shadow.test.ts` (14 GREEN); ticket suite 74 GREEN; trade+architecture regression 23 GREEN; full decision-os GREEN except the 2 pre-existing `lineup-shadow-route` failures (unrelated); zero new type errors (3197 baseline). |
| **E.5 — Canonical Trade Parity Validation + MarketContext Enrichment Seam** ✅ **BUILT 2026-06-29** | Add the read-only enrichment seam that lifts canonical trade parity off the E.4 honest-degraded floor, validate the canonical roster-identity join, and add a DB-gated real-data check. Still shadow-only; no cutover; no production behavior change. | ✅ Shipped — **enrichment port** [`lib/decision-os/trade/enrichmentPort.ts`](trade/enrichmentPort.ts): pure, read-only, never-throws `resolveTradeEnrichment` → `CanonicalMemoEnrichment` from **ADP** (`AdpDataRecord` via new read-only `loadAdpRecords` in `loader.ts` — the SAME table+key the redraft snapshot-capture path reads, freshest by `createdAt`) + **position** (authoritative SportsPlayer cache via the D.1 `resolvePlayerMetadata` seam; the ADP record's position is a fallback only). **Projection has NO provider-id-keyed read-only source** (D.1) ⇒ stays null, surfaced as `projection_unavailable` — never fabricated (P3); this is the residual honest gap. **Roster-identity join** [`lib/decision-os/trade/rosterIdentity.ts`](trade/rosterIdentity.ts): pure `resolveRosterIdentityJoin` maps a proposal-space roster id to a canonical roster via **direct → teamId → managerUserId** (the same join the lineup bridge uses), with an OPTIONAL injectable read-only resolver (production shadow injects none ⇒ direct-match only, preserving E.4; the validation script injects a real one). No owner repair, no mutation. **Wired** into `runCanonicalTradeShadowAttempt`: enrichment feeds `MarketContext`/memo (confidence lifts; values lift off the 0 floor once ADP resolves), join remaps participants+asset roster ids, and additive telemetry (`enrichment_source`, `adp_resolved`, `position_resolved`, `identity_method`) keeps the provider only under `provenance`. **DB-gated validation** [`scripts/decision-os-trade-conformance.ts`](../../scripts/decision-os-trade-conformance.ts): read-only, SKIPS without `DATABASE_URL` (exit 0), **REFUSES the production host** (exit 0), stages a representative two-sided trade from real rosters and reports enrichment source / resolved counts / completeness / uncertainty / identity method / determinism. Tested: `__tests__/decision-os/trade-enrichment.test.ts` (25 GREEN, all 10 ticket cases); ticket suite 90 GREEN; adjacent trade slices 20 GREEN; zero new type errors (3197 baseline). Real-data run pending a non-prod `DATABASE_URL` (none configured locally; script verified for skip+refuse). Proposal-time `CanonicalTradeValueSnapshot` persistence remains design-only (the net-new write, native flow — **not built here**); cutover stays a separate governed decision. |
| **F — Canonical World Enrichment (all APIs)** | The permanent enrichment layer: sports/news/weather/injuries/projections/historical/market-value integrations land as origin-blind, purpose-blind **facts** that fill `CanonicalAsset.enrichment` once for every decision (§9). | Each integration answers *"what truth does this add"* (P2); a single substrate fact is consumed by ≥2 decision types. |
| **G — Decision OS Cutover** | Promote shadow → source of truth per slice, governed, parity-gated (ADR-DOS-002 §11 governance). | Per-slice cutover with parity GREEN sustained; rollback path intact. |
| **H — Legacy Retirement** | Retire redraft-native loaders/memos once every league reads canonical. | No live reader of the retired path; redraft gameplay engine remains where still needed. |
| **I — Decision OS SDK / Licensing Layer** | Expose the production-proven core as SDK / APIs / docs / enterprise tooling. **Does not start until AllFantasy runs on the platform in production and the architecture is proven.** | Stable production core; the multi-party asset-exchange pattern (§10) generalized behind a licensable boundary. |

E.1–E.5 do **not** add a parallel canonical slice — they swap the loader internals behind the flag and
rehost the pure engine on the reusable contract. F–I are platform phases that the clean contract unlocks.

---

## 8. Technical debt assessment

| Severity | Item | Detail | Disposition |
|---|---|---|---|
| **Critical** | None unique to trade | The lineup-loader owner-repair write (ADR-DOS-002 §9 Critical) is already fixed (`resolveRedraftRosterLookupReadOnly`); trade loader is already read-only. | — |
| **High** | No persisted canonical trade memo | `RedraftTradeValueSnapshot` FK → `RedraftRoster`; `AfLeagueTrade` has none. | E.2 read-time compute (shadow) + E.5 proposal-time persistence design (native flow). **The computation is not missing — only the canonical capture/persistence is.** |
| **High** | Pick ownership inventory absent | No canonical tradeable-pick table; dynasty future picks can't be owned/validated canonically. | Honest degrade in E.4; a `CanonicalDraftPickInventory` fact is a named **prerequisite** for full dynasty-pick trading (design only, not in Phase E). |
| **Medium** | Duplicated trade stores | `AfLeagueTrade`/`AfLeagueTradeItem` vs `RedraftTradeProposal`/`RedraftTradeAsset`/`RedraftTradeValueSnapshot`. | Out of scope (matches ADR-DOS-002 §9 "duplicated transaction stores"). Decision OS reads the canonical side; redraft remains gameplay + parity reference. |
| **Medium** | Team profile coupling | `captureSnapshot.profileFor` reads `RedraftRoster` directly. | E.2 reads `TeamFacts` instead; `buildTeamProfile` is already pure over neutral inputs. |
| **Medium** | Season-week coupling | Trade loader reads `RedraftSeason.currentWeek`. | Substrate `LeagueFacts.currentWeek` (already derived) replaces it. |
| **Low** | `rankingValue`/`fantasyCalcValue` deferred-null | Two of four value sources unused. | §9 enrichment — additive facts, not a blocker. |
| **Low** | Redraft naming in neutral code | `TradeRosterFacts.faabBalance`, `proposer/receiver` vocabulary. | Cosmetic; rename to canonical vocabulary when the assembler lands (no behavior change). |

---

## 9. API & enrichment placement strategy

Where each enrichment source belongs — **design the home, don't integrate.** The rule (ADR-DOS-002 §12.3):
*cross-provider derivations live in the substrate so every provider and native league gets them once;
adapters stay thin; the engine stays pure; AI only explains.* Phase F builds this as the **permanent
enrichment layer**, and every API is admitted by the P2 test — *"what truth does this add to the Canonical
World?"*, never *"what feature does this power?"*:

```
 Integrations:  Sports · News · Weather · Injuries · Projections · Historical · Market Value · AI
                                          │
                                          ▼
                          Canonical World Enrichment        ← purpose-blind facts (P1), fills CanonicalAsset.enrichment
                                          │
                                          ▼
                                     Decision OS             ← Lineup · Trade · Commissioner · Waiver · Chimmy · future
```

A weather feed is not "a trade feature" — it is a truth the world holds that trade *and* lineup *and* any
future tool may read. Placement of each source:

| Source | Belongs in | Rationale |
|---|---|---|
| Player metadata (name/position/team) | **Canonical World enrichment** (D.1 seam, built) | already the lineup bridge's source; trade scarcity needs position |
| Injury feeds | **Canonical World enrichment** | a player fact every slice wants; trade uses it for confidence, not the base value |
| News | **Canonical World enrichment** (fact) → **AI explanation** (prose) | the *fact* (e.g. "traded-for player is on bye") is substrate; the narrative is AI |
| Projections | **Canonical World enrichment** | primary value signal; today carried on asset metadata — promote to a substrate value-source fact so all consumers share it |
| Weather (NFL) | **Canonical World enrichment** (NFL-only fact) | confidence modifier, never a base value; honest null off-NFL |
| Historical performance | **Canonical World** (already: `TeamPerformance`) | profiles/stance already derive from it |
| Market valuations (FantasyCalc / equiv.) | **Canonical World enrichment** → `AssetValueSources.fantasyCalcValue` | the engine already has the slot (deferred null); a substrate value-source fact fills it for every provider once |
| Future draft-pick valuation | **Trade-specific logic** (`normalizedPickValue`, exists) over a **substrate pick-inventory fact** | the math is trade-specific; the *ownership* is a substrate fact (the §8 prerequisite) |

**Litmus:** none of these belong in a provider adapter (that would re-introduce per-provider drop, the
ADR-DOS-002 §12.3 FAAB bug) and none belong in Decision OS core (that would couple core to fantasy).
Every one is a **fact in the substrate** or a **pure trade-rule input** or **AI prose** — never a branch.

---

## 10. Decision OS licensing review

| Question | Finding |
|---|---|
| Does Phase E keep Decision OS core free of fantasy-specific assumptions? | **Yes.** Phase E touches only the trade *assembler* + *trade-value* modules. The core (`core/decision.ts`, `core/parity`, `core/shadow`, telemetry) gains nothing fantasy-specific; it already speaks `Decision`, `RuleVerdict`, four-answers, provenance/trust. |
| Is fantasy logic confined to adapters / trade modules? | **Yes.** Fairness math, scarcity, FAAB, picks live in `lib/trade-value` + `lib/decision-os/trade`. The substrate is fantasy-shaped but provider-blind; the core is domain-blind. |
| Could this trade-decision architecture generalize to a reusable licensed pattern? | **Yes — and Phase E strengthens it.** Strip the labels and `manager.trade.evaluate` is a **multi-party asset-exchange evaluation**: N participants, each sending/receiving valued assets, graded for fairness with honest confidence + a legality gate + an immutable proposal-time memo. That pattern licenses to any exchange/barter/marketplace domain (asset swaps, deal desks, multi-party settlements). The four-answer Decision Object + shadow-parity + origin-blind World is the licensable substrate; the fantasy valuation is one pluggable engine. |
| Does the design strengthen long-term licensability? | **Yes.** Keeping valuation a *pure injected engine* (`deps.evaluate`) means a licensee swaps the engine without touching the pipeline — the cleanest possible seam for a productized "decision kernel." |

**Net:** Phase E is licensing-positive. The pure-engine-as-injected-dep boundary (already in
`trade/deps.ts`) is the exact extension point a licensed Decision OS would expose.

**Phase I — Decision OS SDK / Licensing Layer (deferred, production-gated).** The reusable `CanonicalAsset`
contract (§3) is the asset of record for licensing: it is provider-independent, enrichment-ready, and
purpose-blind, so a licensee plugs in their own adapters (below) and their own valuation engine (the
injected `deps.evaluate` seam) without touching the pipeline. Phase I exposes the production-proven core as
an SDK + APIs + docs + enterprise tooling. **It does not start until AllFantasy itself runs on the platform
in production and the architecture is proven** — building the licensing surface before the core is
production-hardened would freeze the contract too early. The four permanent principles (P1 purpose-blind,
P2 enrichment-as-truth, P3 AI-governance, + the reusable-contract rule) are precisely the guarantees an
enterprise licensee buys: an auditable, origin/purpose-blind decision kernel where AI never fabricates a
fact.

---

## 11. Decision record (ADR-DOS-003)

**ADR-DOS-003 — Trade Bridge: rehost the pure trade-value engine on a canonical trade-view assembler,
over a reusable Canonical Asset contract.**

**Status:** **APPROVED 2026-06-29**, amended with the reusable `CanonicalAsset` contract (§3) and four
permanent principles (§0.1: P1 purpose-blindness, P2 enrichment-as-truth, P3 AI-governance, + the
binding reusable-contract rule). Phase E.1 cleared to build (read-only, shadow-only). Builds on the
approved & built ADR-DOS-002.

**Context:** Three of four Decision OS slices read the canonical substrate (waiver, commissioner-health,
and now lineup via Phase D's bridge). Trade still reads redraft-native rows (`RedraftSeason`/
`RedraftRoster`) and a redraft-only persisted memo (`RedraftTradeValueSnapshot`), so it cannot serve
imported leagues. The audit established that the trade *value computation is already pure and
provider-agnostic*, that **all of its inputs now exist in the built Canonical World** (record, PF, rank,
FAAB-derived, positions via the D.1 metadata seam, ADP canonical, asset graph via `AfLeagueTradeItem`),
and that the only genuinely missing fact is **pick-ownership inventory** (which degrades honestly today).

**Decision:** Adopt the **trade-view assembler** approach over a **reusable Canonical Asset contract** —
build `CanonicalAsset` (§3) in the world layer (E.1), then a per-decision canonical assembler
(`tradeWorldAssembler`) that projects `CanonicalWorld` into the neutral `TradeWorldInput` +
`CanonicalAsset[]` movements, and **rehost the pure `buildTradeValueSnapshot`** on canonical team profiles
to produce the evaluation memo at read time for the shadow. Mirror the lineup bridge exactly: native-first,
canonical fallback, read-only, never throws, honest `*_unavailable`/low-completeness degradation, origin
only in telemetry. Trade *consumes* the asset contract and adds only direction; it does not define it.
Persist a `CanonicalTradeValueSnapshot` at proposal time for native canonical trades as a separate, later
write (Phase E.5 design / native flow) — **not** in the read-only bridge. Decision OS core, the trade
DCO/rules/decision/parity, and all of `lib/trade-value` math are **unchanged**.

**Why this is the right foundation:**
1. **Lowest risk for the hardest slice.** The fairness model is not rewritten — it is rehosted on inputs
   that already exist. The pure engine + injected `deps.evaluate` seam make this a data-source swap.
2. **Mirrors a proven pattern.** Phase D's lineup bridge is the template; reusing it (and the D.1
   metadata seam) keeps one bridge shape across slices.
3. **Honesty preserved.** Missing pick inventory, 3+ team trades, and deferred value sources all degrade
   through the existing `data_completeness`/`uncertainty`/`unsupported` channels — no fabrication.
4. **Provider-agnostic by inheritance.** Trade consumes the substrate; the 6-provider adapter tree below
   it is untouched. Litmus: zero provider/`redraft*` references in the assembler at exit.
5. **Licensing-positive.** The injected pure-engine boundary is the productizable seam (§10).

**Consequences:**
- One new reusable **`CanonicalAsset` contract** (world layer) + one per-decision assembler + a thin
  canonical rehost of the capture harness (read-time). No core change. The contract is consumed by trade
  now and extends additively to every future decision and enrichment (P1/P2).
- Four principles (§0.1) become standing Decision OS governance: **purpose-blindness**, **enrichment-as-
  truth**, **AI-governance** (AI never creates/replaces deterministic facts), and **Trade consumes, never
  defines, the contract**.
- Pick-ownership inventory becomes a **named, deferred prerequisite** for full dynasty-pick trading.
- The proposal-time canonical memo persistence is a later write (E.5 design / native flow), explicitly out
  of the read-only bridge.
- Cutover (Phase G) and legacy retirement (Phase H) remain separate, governed decisions; Phase E ends at
  "canonical-capable shadow, GREEN on imported + native, still shadow." Licensing (Phase I) is
  production-gated.

**Rejected alternatives:**
- **Synthesize `RedraftRoster`/`RedraftSeason` shims per provider** to reuse the existing loader unchanged
  — re-introduces the exact redraft-schema coupling ADR-DOS-002 rejected (its Option A), for every provider.
- **Invent a new canonical fairness model** — unnecessary and risky; the existing engine is already pure
  and its inputs are canonically available. Rewriting it would risk parity drift for zero benefit.
- **Compute the memo live (unpinned) at evaluation time** — breaks fairness integrity (a trade would
  re-grade as values drift). Rejected in favor of pinned proposal-time inputs (§4 determinism guard).

---

## 12. Real-world validation (`theciege24`, Sleeper)

Per the cross-cutting validation constraint, the architecture was checked against the live proof account
and the substrate validation already done:

- **ADR-DOS-002 §12 (live `theciege24` import trace)** established the trade-relevant substrate facts:
  imported leagues have `League` + `LeagueTeam` (record/PF/rank) + `Roster` (raw player ids) + 6-provider
  adapters, and **no** `RedraftRoster`/`RedraftSeason`/`RedraftTradeValueSnapshot` — i.e. exactly the
  "substrate-but-no-redraft-projection" leagues where trade fails today and the bridge is needed.
- **Phase D.2 validation** proved the substrate's trade-input facts hold across redraft/dynasty/
  superflex/IDP/taxi/TEP/native/FAAB/priority configs — including the FAAB derivation and the standings
  facts the team profile consumes.
- **Repeatable check:** `scripts/decision-os-world-conformance.ts` (read-only, DB-gated) can be extended
  in E.2 to assert the trade-view facts (participant standings, FAAB, positions) resolve for
  `theciege24`'s real imported leagues before any shadow mounts — the same evidence bar the prior phases
  met.

Sleeper is treated only as the first implemented provider; every finding above is stated in
provider-neutral terms. No Sleeper-specific behavior is designed into the bridge.

---

*End of audit + approved amendments. ADR-DOS-003 is **APPROVED**; Phases **E.1 (Canonical Asset Resolution)**,
**E.2 (Trade Memo on Canonical Assets)**, **E.3 (TradeWorldResolver)**, **E.4 (Trade Shadow Parity)**, and
**E.5 (Canonical Trade Parity Validation + MarketContext Enrichment Seam)** are
✅ **BUILT 2026-06-29**, all read-only. E.1: the reusable
`CanonicalAsset` contract per §3, the binding rule, and the four permanent principles (§0.1) live in
[`lib/decision-os/world/assets.ts`](world/assets.ts) (14 tests GREEN). E.2: the pure Canonical Trade Memo
[`lib/decision-os/trade/canonicalMemo.ts`](trade/canonicalMemo.ts) **rehosts** `buildTradeValueSnapshot` onto
canonical assets + `TeamFacts` profiles — engine reused not duplicated, deterministic `capturedAt`, honest
degradation, memo↔redraft parity GREEN on equivalent inputs (12 tests GREEN, zero new type errors). E.3: the
decision-specific `TradeWorld` + `MarketContext` contract and the pure `resolveTradeWorld` resolver live in
[`lib/decision-os/trade/tradeWorld.ts`](trade/tradeWorld.ts); the memo's entry point `buildTradeMemo(tradeWorld)`
(in `canonicalMemo.ts`) now consumes `TradeWorld`, not a raw `CanonicalWorld`. Both memo paths share the SAME
leaf helpers, so `buildTradeMemo(resolveTradeWorld(x))` is **byte-identical** to `buildCanonicalTradeMemo(x)`
(the acceptance gate — proves wrapper, not behavior change). 25 trade-memo tests GREEN (13 new E.3), zero new
type errors. Coexistence note: the legacy Slice-3 `trade/world.ts` (`resolveTradeWorld`/`TradeWorld`) stays
live and keeps the barrel export pre-cutover; the canonical module is imported by path to avoid the name
collision until the barrel flips at cutover. E.4: the canonical pipeline now runs **beside** the native trade
shadow — [`lib/decision-os/trade/canonicalShadow.ts`](trade/canonicalShadow.ts)'s `runCanonicalTradeShadowAttempt`
is mounted inside `runTradeShadowForProposal` AFTER the (unchanged) native result, behind the existing
`DECISION_OS_TRADE_SHADOW` gate (no route change). It is best-effort + never-throws (three structured skip
codes), read-only (injectable `resolveCanonicalWorld`, find* port only), provider-blind in decision-facing
telemetry (`source: 'canonical_trade_world'`, provider only under `provenance`), and records **honest-degraded
parity** vs the redraft snapshot (player values floor to 0 with no enrichment port yet ⇒ `passed: false` with
diffs surfaced, no fake parity). 14 E.4 tests GREEN (74 ticket-suite GREEN), zero new type errors. E.5: the
read-only enrichment seam that lifts parity from honest-degraded toward meaningful — a cached-only ADP/position
port ([`lib/decision-os/trade/enrichmentPort.ts`](trade/enrichmentPort.ts), delegating to `loadAdpRecords` on
`AdpDataRecord` + D.1 `resolvePlayerMetadata` on the `SportsPlayer` cache; NO live provider calls, NO writes, NO
cache warming) feeds `MarketContext` so player values rise off the 0 floor when cached ADP exists (e.g. adp=5 ⇒
~690), with missing values left **null + uncertainty-flagged**, never fabricated (P3); a pure read-only
roster-identity join ([`lib/decision-os/trade/rosterIdentity.ts`](trade/rosterIdentity.ts)) maps proposal-space
`RedraftRoster.id` participants to canonical `Roster.id` via direct → teamId → managerUserId (NO owner repair,
NO mutation); and a DB-gated, prod-refusing, strictly read-only validation script
([`scripts/decision-os-trade-conformance.ts`](../../scripts/decision-os-trade-conformance.ts)) proves the seam
end-to-end on real cached data (theciege24's imported leagues when a non-prod DB is present, else SKIP exit 0).
`valuationSource` stays `deterministic_engine`; provider names appear only in provenance/debug. 25 E.5 tests
GREEN (90 ticket-suite GREEN), zero new type errors. Honest residual gap: **projection** has no provider-id-keyed
read-only source, so it stays null and imported leagues lacking cached ADP still floor to 0 — full GREEN parity
awaits Phase F (FantasyCalc/market-value enrichment). **Next: F** — market-value enrichment to close the
projection gap, then proposal-time canonical-snapshot persistence, then cutover (G). Every E phase remains
read-only + shadow-only + flag-gated; cutover (G), legacy retirement (H), and licensing (I) are later,
separately governed phases.*
