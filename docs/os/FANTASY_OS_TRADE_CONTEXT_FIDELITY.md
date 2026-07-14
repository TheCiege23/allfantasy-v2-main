# Trade Context Fidelity Matrix (Phase 17)

**Status: audit only (Phase 17), no shadow seam existed yet to compare against at the time. This matrix classifies `TradeDecisionContextV1`'s real inputs (read directly from `lib/trade-engine/trade-decision-context.ts`'s Zod schema) — it is the pre-migration equivalent of Phase 15's Waiver matrix, produced before any seam is built rather than after one is found broken.**

**Phase 18 note:** this matrix describes `TradeDecisionContextV1`, the context object behind the flagship `/dynasty-trade-analyzer` route — Phase 18 did NOT migrate that route (still out of scope, per Phase 17's explicit recommendation). The seam actually built in Phase 18 targets `/api/trade-value/analyze`, a structurally simpler, roster-less, sport-wide asset comparison that doesn't use `TradeDecisionContextV1` at all. This matrix remains accurate for a *future* `/dynasty-trade-analyzer` migration attempt, not for what Phase 18 shipped — see [`FANTASY_OS_TRADE_SHADOW_COMPARE.md`](FANTASY_OS_TRADE_SHADOW_COMPARE.md) for the real request/context fields Phase 18 actually forwards.

**Phase 19 note:** no change to this matrix — Phase 19 was an identity-resolution fix (multi-sport `SportsPlayer` fallback) and expanded validation on the already-migrated `/api/trade-value/analyze` route, not a context-fidelity change, and did not touch `TradeDecisionContextV1` or `/dynasty-trade-analyzer` in any way.

## Why this matrix looks different from Waiver's

Phase 15's Waiver matrix compared two *already-running* systems (authoritative route vs. existing shadow seam) and found 3 accidentally-omitted fields. Trade has no shadow seam wired to any live route yet — this matrix instead classifies every real input `TradeDecisionContextV1` carries, so that whoever eventually builds a Trade shadow seam starts with the Waiver lesson already applied (forward every field that can't be independently reconstructed) instead of discovering it the hard way again.

## Classification key

- **Deterministic**: a pure fact, computable from stored data given the same inputs, no AI/LLM involved.
- **Contextual**: real, request-scoped information that cannot be reconstructed from a leagueId/rosterId alone (mirrors Waiver's `currentWeek`/`goal`/`maxResults` category).
- **Derived**: computed from other fields already in this list (not an independent input).
- **AI narrative only**: produced by Stage B (`runPeerReviewAnalysis`)/quality-gate, never part of the deterministic Stage A context.

## Matrix

| Field (from `TradeDecisionContextV1`) | Source | Classification | Notes |
|---|---|---|---|
| `leagueConfig.{scoringType,isSF,isTEP,tepBonus,rosterPositions,starterSlots,benchSlots,taxiSlots,scoringSettings,numTeams}` | Parsed from client-supplied free-text `leagueContext` string (`parseLeagueContext`) — **not** read from the real `League`/`LeagueSettings` DB tables for `/dynasty-trade-analyzer` | **Contextual, but currently unreliable** — a real, disclosed gap: even the *authoritative* route doesn't read real league settings from the DB for this field; it regex-parses a free-text hint (`"12 team superflex"` → `numTeams: 12, isSF: true`). A future shared service that read REAL `LeagueSettings` rows would be **more accurate than the authoritative path itself** here — the opposite of Waiver's problem, and a real design question for Phase 18: should the shadow "agree with" a client-parsed guess, or independently assemble the real settings and treat disagreement as evidence the authoritative path itself has stale context? |
| `sideA`/`sideB` asset lists (player names, picks) | Free-text `sideA`/`sideB` strings, split on `,`/`and` | **Contextual** — this is the actual trade being evaluated; cannot be reconstructed, must always come from the request (same category as Waiver's `roster`, but unlike Waiver's roster, there is no independently-assemblable "real" version to compare against unless the request also supplies real roster ids) |
| `sideA`/`sideB` asset valuations (`marketValue`,`impactValue`,`vorpValue`,`volatility`,`adp`,`isCornerstone`) | `priceAssets()` → FantasyCalc + ADP + VORP engine, all real DB/API-backed lookups | **Deterministic** — independently re-derivable from the resolved player identity + real valuation sources, exactly the category Waiver's `availablePlayers`/`leagueSettings` fell into (intentionally re-assembled, not forwarded) |
| `sideA`/`sideB` `riskMarkers` (injury, analytics) | `prisma.sportsInjury`, `player-analytics.ts` | **Deterministic** — same category as above |
| `sideA`/`sideB` `rosterComposition`/`needs`/`surplus`/`contenderTier` | `league-intelligence.ts`'s `computeNeedsSurplus`/`classifyCornerstone`, derived from the priced assets | **Derived** — computed from the deterministic valuations above, not an independent input |
| `sideA`/`sideB` `managerPreferences` | `manager-tendency-engine.ts`'s `buildManagerProfile`, keyed by team **name** (`sideA.name`/`sideB.name` — free text, not a real manager id) | **Deterministic in principle, unreliable in practice** — a real, disclosed gap: matching happens by whatever display name string was typed for "Team A"/"Team B," which has no guaranteed real-world referent at all when no `leagueId` is supplied |
| `competitors` | `fetchCompetitorSnapshots(leagueId, ...)` | **Contextual/deterministic hybrid** — real when `leagueId` resolves to a real imported league via `platformLeagueId`, empty otherwise; genuinely re-derivable from leagueId alone, same category as Waiver's `allLeagueRosters` |
| `valueDelta` | Computed from `sideA.totalValue`/`sideB.totalValue` | **Derived** |
| `tradeHistoryStats` | `fetchLeagueTradeHistory(leagueId)` → `prisma.tradeNotification` counts | **Contextual/deterministic hybrid**, same caveat as `competitors` |
| `missingData`/`dataQuality`/source `freshness` (`computeSourceFreshness`) | Computed alongside every field above | **Derived** — meta-information about the other fields, not an independent input, but load-bearing for confidence scoring |
| AI `consensus` (verdict, reasons, counters, warnings) | `runPeerReviewAnalysis` (Stage B, LLM) | **AI narrative only** — analogous to Waiver's `includeAIExplanation` output, explicitly out of scope for any deterministic shadow comparison |
| `gate` (quality-gate adjustments) | `runQualityGate(consensus, tradeContext)` | **Derived from AI + deterministic** — adjusts Stage B's confidence against Stage A facts; not itself a new independent input |

## The Waiver lesson, applied in advance

Phase 15's fix was: forward `currentWeek`/`goal`/`maxResults` because they're **contextual and non-reconstructable**. Applying that lesson here *before* any seam exists: any future Trade shadow-compare design must forward, at minimum, the **exact `sideA`/`sideB` asset text/list** (there is no way to reconstruct "which trade the user is asking about" any other way) and, if a `leagueId` is present, should prefer **independently re-deriving** `leagueConfig`/`competitors`/`tradeHistoryStats` from the real DB rather than trusting the client-parsed free-text guess — a genuine opportunity to be *more* correct than the authoritative path, not just equivalent to it, which is a materially different design goal than Waiver's "prove we match" framing.

## Open question this phase does not resolve

Given `leagueConfig` in the live authoritative path is itself unreliable (free-text-parsed, not DB-read) for the primary route, is the honest comparison target "does the shadow match what the user typed" (low bar, easy to pass, low value) or "does the shadow produce the *objectively correct* league-aware answer the authoritative path should have produced" (higher bar, more valuable, but no longer a same-inputs comparison — a different kind of validation than Waiver's shadow-compare pattern entirely)? This is a real design decision for whoever scopes Phase 18's implementation, not decided here.
