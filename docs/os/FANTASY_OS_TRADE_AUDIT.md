# Trade Domain Audit (Phase 17)

**Status: audit and design only (Phase 17). No shadow seam implemented then. No code changed then.**

**Phase 18 update:** the recommended narrow target (`/api/trade-value/analyze`) has since been implemented — see [`FANTASY_OS_TRADE_SHADOW_COMPARE.md`](FANTASY_OS_TRADE_SHADOW_COMPARE.md). Re-auditing the route before writing code (Phase 18's own Task 1) found one more real correction to this document's assumption: the route's `playerId` field is a `SportsPlayerRecord.id`, NOT a raw provider id — meaning even this "most promising" route needed a narrower identity-comparison scope than originally hoped. Documented in full in the Shadow Compare doc, not here.

This document traces the real, live Trade production path(s) directly from source — not from Phase 5/14 memory, both of which turn out to have been partially wrong (see "Corrections to prior assumptions" below).

## Corrections to prior assumptions

Phase 14's audit cited `lib/engine/trade.ts` (via `/api/engine/trade/analyze`) as "the actual live production trade-analysis engine." **This was wrong, and is corrected here.** Direct verification this phase found:

- `app/api/app/leagues/[leagueId]/trades/analyze-ai/route.ts` (which proxies to `/api/engine/trade/analyze`) has **zero real UI callers** anywhere in `app/` or `components/`.
- `app/api/engine/trade/analyze/route.ts` itself has **no session/auth check at all** and no league-membership check.
- Both are orphaned, legacy-adjacent code, not the live path.

Phase 5's shared Trade service (`lib/shared-services/trade/`) compares against `trade-engine.ts`'s `computeTradeDrivers` and T2 (`lib/trade-value/grader.ts`) — **neither of which is called by `lib/engine/trade.ts` either.** Phase 5's own docstring already correctly identified `computeTradeDrivers` as wired to "the trade-evaluator, trade-finder, and legacy goal-proposals/league-analyze routes" — none of which are the same as `lib/engine/trade.ts`. This phase's audit did not find a live route that calls `computeTradeDrivers` as its primary path either (see below) — it appears to power a distinct, older evaluator surface not central to this audit.

## There is no single "the" live Trade route

Unlike Waiver (`/api/waiver-ai/engine`, one clear entry point), Trade has **three genuinely live, customer-facing routes for three different purposes**, confirmed via direct UI-caller tracing:

| Route | Purpose | UI entry point | Real auth? | Real roster grounding? |
|---|---|---|---|---|
| `POST /api/dynasty-trade-analyzer` | Analyze a hypothetical/proposed trade from free-text player names | `/dynasty-trade-analyzer` page, linked from the League War Room tab | Session required (401 if not) | **No** — no `assertLeagueMember`, no roster ownership check, `leagueId` optional and only used for supplementary context (manager tendencies, trade history) |
| `POST /api/trade-value/analyze` | "Trade Value Console" — structured asset-vs-asset value comparison | Dashboard AI Tools grid | **No** — `userId` optional, request works unauthenticated (IP rate-limited instead) | No |
| `POST /api/leagues/[leagueId]/draft/trade-builder/analyze` | Evaluate a **draft-pick** trade during a live, in-progress draft | Draft Room's pick-trade panel | Session + `canAccessLeagueDraft` + real roster ownership (`getCurrentUserRosterIdForLeague`) + real pick-ownership validation | **Yes** — the most thoroughly authorized of the three, but scoped narrowly to draft-pick trades only, a different domain from general player trades |

**Central finding**: none of the three live routes match Waiver's shape (one authenticated user, one real owned roster, structured provider-ID input). The closest analog by usage pattern (`/dynasty-trade-analyzer`) is structurally the *least* roster-grounded of the three.

## Call graphs (traced directly, not inferred)

### `/api/dynasty-trade-analyzer` (the primary "analyze a trade" tool)

```
POST /api/dynasty-trade-analyzer
  → session check (401)
  → parse sideA/sideB as free-text strings (comma/and-separated), leagueId optional
  → assembleTradeDecisionContext(partyA, partyB, parsedLeague)   [Stage A — deterministic]
      → extractPlayerNames() — regex filter only, no resolution
      → priceAssets() (lib/hybrid-valuation.ts)
          → findPlayerByName() (lib/fantasycalc.ts) — NAME MATCH ONLY, no provider ID, no PlayerIdentityMap
          → getPlayerADP, getPlayerAnalyticsBatch, historical-values, vorp-engine
      → fetchManagerContext/fetchLeagueTradeHistory/fetchCompetitorSnapshots — leagueId used here only, via League.platformLeagueId lookup, never a Roster fetch
  → runPeerReviewAnalysis()   [Stage B — AI, lib/trade-engine/dual-brain-trade-analyzer.ts]
  → runQualityGate() — validates/adjusts AI output against Stage A deterministic facts
  → formatTradeResponse()
  → response (no decisionOs-style wrapper, no shadow hook of any kind exists today)
```

### `/api/trade-value/analyze`

```
POST /api/trade-value/analyze
  → IP rate limit (20/min)
  → optional session (userId may be null)
  → Zod-validated structured assets: { kind: 'player', playerId?, name?, sportHint? } | { kind: 'pick', ... } | { kind: 'faab', ... }
  → runTradeConsoleAnalysis() (lib/trade-value-console/)
  → response
```

Notable: this route's `assetSchema` DOES support an optional `playerId` — the only one of the three live routes with any structured provider-ID surface at all. Not deep-audited further this phase (out of scope — see Scope Boundaries); flagged as the most promising integration point for future canonical player-identity work in Trade.

### `/api/leagues/[leagueId]/draft/trade-builder/analyze`

```
POST /api/leagues/[leagueId]/draft/trade-builder/analyze
  → session (401) → canAccessLeagueDraft (403) → getCurrentUserRosterIdForLeague (403 if none)
  → draft-pick-trading-enabled checks (403 x2)
  → active in-progress draft session required (400)
  → real pick-ownership validation via resolvePickOwner (400 on invalid give/receive)
  → buildDraftPickTradeStructuredAnalysis + buildDraftTradeAiReview (deterministic)
  → optional AI summary (entitlement-gated, timeout-bounded, falls back to deterministic on any AI failure)
  → response
```

This is real, roster-grounded, and already has a mature deterministic/AI-fallback split resembling Waiver's pattern — but it belongs conceptually to Draft OS (Phase 8), not general Trade, since it only ever evaluates draft-pick swaps during a live draft.

## Existing shared Trade service's own assumptions (Phase 5)

`lib/shared-services/trade/TradeShadowService.ts`'s `evaluateTradeShadow()` requires `sideARosterId`/`sideBRosterId` — **but these must be the provider's own team id** (e.g. Sleeper's numeric `roster_id`, read from `Roster.playerData.source_team_id`), **not** `Roster.id` and **not** `Roster.platformUserId` — a third, distinct roster-identifier concept, confirmed via the Phase 6 backtest README's own documented "real translation gotcha." A roster missing `source_team_id` is skipped, never guessed. Native (non-imported) leagues are entirely unsupported (`buildLeagueDecisionContext` has no native-provider branch).

**No live route today naturally supplies a `sideARosterId`+`sideBRosterId` pair matching this contract.** `/dynasty-trade-analyzer` has no roster concept at all; `/trade-value/analyze` has no roster pairing; `/trade-builder/analyze` has real roster ids but scoped to draft picks, a different domain, and uses `Roster.id` shape via the draft engine, not `source_team_id`.

## Authorization summary

| Route | Auth | Membership | Roster ownership | Entitlement |
|---|---|---|---|---|
| `/dynasty-trade-analyzer` | ✓ session | ✗ | ✗ | ✗ (no entitlement gate found) |
| `/trade-value/analyze` | optional | ✗ | ✗ | ✗ (IP rate-limit only) |
| `/trade-builder/analyze` | ✓ session | ✓ (`canAccessLeagueDraft`) | ✓ (`getCurrentUserRosterIdForLeague`) | ✓ (`pro_trade_ai` for the AI layer specifically) |
| `commissioner/trade-review` (read-only workload summary, not analysis) | ✓ session | ✓ commissioner-only | n/a | n/a, gated by `COMMISSIONER_TRADE_REVIEW_ENABLED` |

A real, disclosed gap: **`/dynasty-trade-analyzer`, the highest-traffic-appearing live trade tool, has no league-membership or entitlement check at all** — any authenticated user can run it against any `leagueId` string (used only for read-only context enrichment, never to gate access) or no `leagueId` at all. This is not a new problem introduced by this audit; it's a pre-existing characteristic of a free-text hypothetical-analysis tool, but is materially different from every route this Fantasy OS effort has shadow-compared before (Waiver's, Draft's real routes all gate on real membership).

## Scope boundaries respected this phase

No code was written or modified. No shadow seam was implemented. `/trade-value/analyze`'s structured-asset/`playerId` surface and `/trade-builder/analyze`'s draft-pick pattern were identified as real, promising integration points but not built out — that is Phase 18+ work, contingent on the readiness decision in the final report.
