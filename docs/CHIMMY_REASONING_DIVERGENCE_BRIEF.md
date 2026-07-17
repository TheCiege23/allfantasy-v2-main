# Chimmy Reasoning Divergence — Scoping Brief

**Status:** discovery/scoping only, no code changes · **Prepared:** 2026-07-17 · **Branch:**
`claude/chimmy-reasoning-divergence-brief`

Scopes the v2 architecture's **layer 3** requirement — *"Chimmy is the conversational orchestration
layer OVER the Intelligence Platform... It does not independently calculate trade grades, player
values, waiver recommendations, rankings, or league health — those come from shared services, or
Chimmy and the Trade Evaluator will eventually give two different answers to the same question."*

## Headline

**"Eventually" already happened.** Four of the five capabilities layer 3 names have two independent
implementations reachable by real users today. The single number that frames the whole problem:

> **57 route files exist under `app/api/ai/`. Zero of them import `lib/decision-os`.**

Decision OS governs exactly four decisions, mounted on four specific non-`/api/ai/` routes. The
entire AI surface of the product sits outside its jurisdiction. This is not "Chimmy is broken" — it's
that the AI feature surface was built first, Decision OS was built later as the correct architecture,
and the two were never converged.

## The critical reframe: the rule already exists

Layer 3's rule is **already written into this codebase**, verbatim, as Decision OS's P3 invariant
(`lib/decision-os/ARCHITECTURE_FREEZE.md`, frozen 2026-06-29):

> *"AI may summarize, explain, prioritize, or communicate deterministic decisions. AI may NEVER
> generate, replace, or fabricate deterministic facts used by the Decision OS."*

`DECISION_REGISTRY.md` even claims **"Deterministic decisions: 100% (AI is explanation-only, never in
the verdict path)."** That claim is *true within the four governed slices and false everywhere else.*
It's not a lie — it's a scope statement being read as a product statement.

**So this is a migration/jurisdiction problem, not a design problem.** Nobody needs to invent the
rule, win an argument about it, or build a new abstraction. The rule exists, is frozen, has an ADR
process, and is enforced by tests — for four decisions. The work is extending its jurisdiction.

**Strongest evidence this was known, not accidental:** the registry's own notes on
`commissioner.league.health` say, in bold: *"**AI commissioner insights (`getAICommissionerInsights`)
are out of scope.**"* Someone saw this exact divergence, wrote it down, and deliberately scoped it
out. That makes the fix a **product decision about previously-deferred scope**, not a bug report.

## Confirmed divergences — same question, two answers

Each row = two live code paths that answer the same user question through completely independent
reasoning. All are user-reachable (UI call sites cited).

| Capability | Governed path (Decision OS) | Ungoverned path | Evidence |
|---|---|---|---|
| **Waiver recs** | `/api/waiver-ai/engine` → shared `runWaiverAIService` → `suggestWaiverPickups`. Registry slice `manager.waiver.claim`, shadow-mounted. UI: `components/waiver-wire/WaiverWirePage.tsx:889` | `/api/waiver-ai/grok` → **its own local** `buildDeterministicFacts` (defined at `route.ts:101`) + direct Grok call (`grok-4-0709`, `route.ts:161`). UI: `app/components/WaiverAI.tsx:177` | A real shared `buildDeterministicFacts` exists at `lib/waiver-engine/waiver-deterministic-facts.ts:454` — **the Grok route does not import it.** Same function name, two implementations. |
| **Trade grades** | `/api/redraft/trade-proposals` → `buildTradeValueSnapshot` (`lib/trade-value`). Registry slice `manager.trade.evaluate`, explicitly *"deterministic, no AI"* | `/api/trade-evaluator` → `lib/hybrid-valuation` (`pricePlayer`/`pricePick`/`compositeScore`) + `lib/historical-values` (`computeDualModeGrades`) + **three** LLM providers (`openaiChatJson`, `xaiChatJson`, `deepseekQuantAnalysis`). UI: `app/trade-evaluator/page.tsx` | `buildTradeValueSnapshot` is imported by **exactly one** file in all of `app/` — the trade-proposals route. The Trade Evaluator has never touched it. |
| **League health** | `monitorLeagueHealth` (`lib/league-health/league-health-engine.ts`) → `commissionerHubHealth.ts`. Registry slice `commissioner.league.health` | `getAICommissionerInsights` (`lib/ai-commissioner/AICommissionerService.ts`) → `/api/leagues/[leagueId]/ai-commissioner/insights`. UI: `components/app/commissioner/AICommissionerPanel.tsx` | `AICommissionerService.ts` contains **zero** references to `monitorLeagueHealth` or the health engine. Registry explicitly declares it out of scope. |
| **Manager DNA** | `assembleManagerDna` (Phase 6.2) via `/api/decision-os/manager-intelligence` → real behavioral pipeline | `/api/ai/manager-dna` → delegates to `server/api-route-modules/legacy/manager-dna/route` (a **legacy** module) | `assembleManagerDna` is called only by `lib/decision-os/dashboard-intelligence.ts` and phase6 internals — never by the `/api/ai/` route that shares its name. |

**Player values** (layer 3's fifth item) is a *partial* case, not a clean divergence: at least three
valuation sources coexist — `lib/player-values/playerValuesLoader` (`getPlayerValuesContext`, which
the Grok waiver route *does* use), `lib/hybrid-valuation` (`pricePlayer`, trade evaluator), and
`lib/historical-values`. Whether these are genuinely competing or legitimately layered
(market value vs. historical vs. context) was **not determined** — it needs a read of all three, and
is the one item here I'd want to check before assuming it's a defect.

## Explicitly NOT a divergence — a false positive worth recording

**Rankings.** `/api/ai/power-rankings` (Claude over a raw Sleeper bundle) and
`lib/ranking/computeAndSaveRank` look like a divergence but are **not the same question**:
- `computeAndSaveRank(afUserId, ...)` → a **user's global AF rank** across the platform
  (`computeLegacyRankPreview`, `calculateAndSaveRank`).
- `/api/ai/power-rankings` → **team power rankings within one league** (`teams = bundle.rosters`,
  gated on `Power rankings require a Sleeper-synced league`).

Two different features answering two different questions. **However**, it is still a layer-3 concern
for a different reason: it computes rankings via an LLM directly over raw Sleeper data with **no
deterministic engine underneath at all** (confirmed: zero references to `lib/ranking`). So it's not
"two answers to one question" — it's "AI is the engine, not the explainer." Different defect, same
principle. Also note it consumes raw Sleeper vocabulary end-to-end, corroborating the Phase 1
canonical-layer finding independently.

## Why this happened (relevant to how it should be fixed)

The `/api/ai/*` surface is 57 routes — a mature product area that predates Decision OS. Decision OS
started in June 2026, deliberately picked four high-value decisions, wrapped them beside their legacy
engines in shadow mode, and froze its architecture with an explicit ADR gate. It did exactly what a
careful migration should do: prove the pattern on a bounded set first.

What never happened is step two — bringing the pre-existing surface under the proven pattern. The
Phase-5 soak that would have promoted the four slices to Stage 1 was never run
(see [[decision-os-activation-investigation]]), so the migration stalled *before* the four slices
were even live, let alone before anyone looked at the other 57 routes.

**Implication for sequencing:** finishing the Stage 1 activation of the four existing slices is
arguably a prerequisite to this work, not a parallel track. Migrating route #5 onto a pattern whose
first four instances have never run live would be building on unproven ground.

## What needs a product decision (not an engineering call)

For each ungoverned path, someone has to decide which of three outcomes applies. This is the actual
content of the eventual build brief, and I don't think it can be inferred from code:

1. **Retire** — the ungoverned path is redundant; delete it and point its UI at the governed one.
   (Candidate: `/api/ai/manager-dna` → legacy module, when Phase 6.2 already does this properly.)
2. **Migrate** — the capability is real and wanted, but must be re-pointed at the shared service, with
   AI demoted to explanation-only. (Candidate: `/api/waiver-ai/grok` — its Grok research + news
   evidence may be genuinely additive *on top of* shared deterministic facts, rather than instead of
   them.)
3. **Keep distinct** — it's a legitimately different product with a different contract, and the
   apparent overlap is naming, not substance. (Candidate: `/api/ai/power-rankings`, per the false
   positive above.)

The trade case is the hardest and most valuable: `/api/trade-evaluator` is not a thin AI wrapper — it
carries a real, independent valuation stack (`hybrid-valuation` + `historical-values` + a 3-provider
LLM ensemble + PECR). "Just point it at `buildTradeValueSnapshot`" would delete real capability. That
one likely needs its own dedicated analysis of which engine is actually *better*, not just which is
canonical.

## Honest scope

This is not a bug-fix pass. Four confirmed divergences across a 57-route surface, at least one of
which (trade) is a substantial system in its own right, gated behind a per-path product decision, and
arguably blocked on finishing an activation that has been stalled since June 30. Anyone estimating
this as "wire Chimmy to the shared services" is under-scoping it by an order of magnitude.

The genuinely cheap wins, if a fast signal is wanted: `/api/ai/manager-dna` (option 1, likely a
delete) and closing the registry's own acknowledged `getAICommissionerInsights` gap (option 1 or 2,
already documented as deferred scope by the people who built it).

## Not determined by this pass

Whether the three player-value sources are competing or layered. Whether the remaining ~53
`/api/ai/*` routes contain further divergences (only the layer-3-named five were checked; the count
of 57 is a scale indicator, not a claim that all 57 are defective). Whether `/api/trade-evaluator`'s
valuation stack is better or worse than `buildTradeValueSnapshot`. Whether any of these paths
disagree *in practice* on real data — every finding here is structural (different code, different
engine), not an observed output mismatch; proving actual divergent answers would need both paths run
against the same league.
