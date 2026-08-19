# Commissioner OS Recommendation Architecture

Date: 2026-07-13. Populates the `commissioner` domain of the existing
`LeagueRecommendationBundle` contract (League Hub Foundation phase, already
extended by the User OS phase) for the first time. Same contract, same
coordinator pattern as User OS — deliberately not a second recommendation
architecture, per this phase's own explicit guardrail.

## The shape

```
Request (appUserId from session, canonicalLeagueId from route)
    ↓
assembleCommissionerOsContext()          — fail-closed, real commissioner-only context
    ↓
assembleCommissionerOsRecommendations()  — the one coordinator every consumer calls
    ↓  (per requested domain)
health / engagement / rankings / storylines / rivalries / draft / trades / integrity
    ↓
LeagueRecommendationBundle.commissioner + domainStatus map
```

`lib/shared-services/league-hub/commissionerOsRecommendations.ts`'s
`assembleCommissionerOsRecommendations({ appUserId, canonicalLeagueId,
requestedDomains?, requestTime? })` is the single entry point — the API
route, the League Hub UI widget, and the new Chimmy seam all call this one
function, never the individual generators or the pre-existing shared
Commissioner Intelligence Service directly.

## Why this reuses an existing shadow-mode package instead of building fresh

This phase's Part 1 inventory found `lib/shared-services/commissioner/*` — a
real, pre-existing, fully-built "Commissioner Intelligence Service"
(Fantasy OS Migration Plan, Phase 10) with **zero live consumers** before
this phase (confirmed by its own README and by grepping every caller in the
codebase). It already federates real, live-computed League Health, activity
counts, retention risk, and format-awareness via
`resolveMissionControlSnapshot`/`resolveLeagueAnalyticsSnapshot`, and
exposes five real builder functions:

| Builder | Real underlying engine |
|---|---|
| `buildCommissionerContext` | `resolveMissionControlSnapshot` + `resolveLeagueAnalyticsSnapshot` federation |
| `buildLeagueHealthAssessment` | `monitorLeagueHealth()` (unmodified — this phase never recomputes a score) |
| `buildCommissionerAttentionItems` | `deriveLeagueAttentionSignals()` — real, previously unconsumed |
| `buildCommissionerRanking` | `computePowerRankings()` (`lib/league-power-rankings/PowerRankingEngine.ts`) |
| `buildCommissionerBrief` | Structured weekly brief, facts-only, no LLM-computed numbers |

This phase's entire job for the context-assembly layer was giving this
package its first real consumer — not re-implementing any part of it. The
guardrail "do not build duplicate engines when usable implementations
already exist" is satisfied structurally, not just by intent.

Three more real, already-persisted engines were found and are read-only
consumed the same way: `lib/drama-engine/` (→ `DramaEvent`, storylines),
`lib/rivalry-engine/` directory (→ `RivalryRecord`/`RivalryEvent`,
rivalries — explicitly NOT the legacy, roster_id-keyed duplicate at
`lib/rivalry-engine.ts`), and `lib/rankings-engine/draft-grades.ts` (→
`DraftGrade`, draft grades). `CommissionerOsContext` only ever *reads*
already-persisted rows from these three — it never calls
`runLeagueDramaEngine`/`runRivalryEngine`/`computeDraftGrades` itself.

## Authorization boundary reuse (Part 3)

Deliberately reuses `resolveActiveLeagueContext`'s `isCommissioner` (`lib/
shared-services/league-hub/activeLeagueContext.ts`), not `lib/shared-
services/commissioner/CommissionerAuthorization.ts`'s
`resolveCommissionerAccess` (which wraps `getLeagueRole()`). That module's
own docstring discloses the same real gap this phase found and fixed: for
imported leagues, `getLeagueRole()` reflects "who imported it," not real,
attestation-aware commissioner status. `resolveActiveLeagueContext` is the
more recently hardened, more consistently used mechanism (every other
League Hub surface already reads from it) — see
`COMMISSIONER_OS_CONTEXT_CONTRACT.md` for the exact fix and its test
coverage.

## The eight generators

| Domain | File | Real data source |
|---|---|---|
| Health | `generators/commissioner/leagueHealthRecommendations.ts` | `context.health` (`buildLeagueHealthAssessment`) — thin mapper, never recomputes the score |
| Engagement | `generators/commissioner/engagementRecommendations.ts` | `context.attentionItems` + `context.shared.missionControl.recommendedActions` |
| Rankings | `generators/commissioner/rankingsRecommendations.ts` | `context.ranking` (`buildCommissionerRanking`) — honestly declines specialty-format stubs |
| Storylines | `generators/commissioner/storylineRecommendations.ts` | Real `DramaEvent` rows, NFL-only this phase |
| Rivalries | `generators/commissioner/rivalryRecommendations.ts` | Real `RivalryRecord`/`RivalryEvent` rows |
| Draft grades | `generators/commissioner/draftGradeRecommendations.ts` | Real `DraftGrade` rows, discloses format-naivety in the copy itself |
| Trade grades | `generators/commissioner/tradeGradeRecommendations.ts` | Real trade count from Mission Control — a recap pointer, not a fabricated valuation |
| Integrity | `generators/commissioner/integrityRecommendations.ts` | Real `context.health.issues` text, reframed with cautious language — never calls tanking/collusion detection |

## Copy-ready content (Part 17)

`generators/commissioner/copyReadyContent.ts` — deliberately template-based,
not LLM-based. `lib/drama-engine/AIDramaNarrativeAdapter.ts` (a real, live
LLM-backed narrative generator, found in this phase's inventory) exists and
could produce richer prose, but wiring an LLM call into this coordinator's
synchronous read path was judged unsafe to verify within this phase's
budget. This generator instead builds grounded, deterministic copy directly
from real `headline`/`summary`/rivalry/ranking fields — always accurate to
the source, never inventing a quote. `CommissionerNarrativeOutput`'s own
`aiGenerated: false` fallback field already models exactly this pattern —
a future phase can layer the real AI adapter in as an upgrade path.

## Snapshot-only truthfulness (Part 18)

`CommissionerOsContext.isSnapshotOnly` (from the existing, real
`deriveImportType()` — `providerCapabilities.ts`) is `true` only for
Fantrax (`csv_snapshot`). When true, the `integrity` generator returns
nothing at all, and the `engagement` generator suppresses any
`manager_engagement_risk` item — both because a single point-in-time CSV
upload can prove a lineup's state *at upload time*, never a repeated or
ongoing pattern (abandonment, inactivity trend). See
`COMMISSIONER_OS_CONTENT_POLICY.md` for the full reasoning and
`COMMISSIONER_OS_DOMAIN_SUPPORT_MATRIX.md` for what a snapshot-only league
still receives.

## Prioritization (Part 13)

`selectTopCommissionerActions(bundle, maxCount)` — orders by a real
`HOMEPAGE_ORDER` map (critical governance issue → inactive/lineup
carryover → Mission Control action → league health → everything else by
raw priority), not just raw priority level, matching the phase brief's
explicit suggested order.

## Chimmy seam (Part 20)

`getChimmyCommissionerOsSummary({ appUserId, canonicalLeagueId })` mirrors
the User OS phase's `getChimmyUserOsSummary` shape and scope exactly:
narrower than the full bundle (identity, real freshness, `isSnapshotOnly`,
a real health summary, and up to 5 prioritized actions whose entries
already carry evidence + copy-ready content — no separate shape needed).
Fails closed identically to the coordinator (`accessDenied`/`null` context
→ `null`). Not wired into `lib/chimmy-context/*` this phase — only exposed,
per the same scoping decision the User OS phase made for its own seam.

## What this phase does NOT touch

No changes to `lib/integrity/TankingDetectionEngine.ts`/
`CollusionDetectionEngine.ts` (real deterministic-evidence-plus-LLM-verdict
engines, deliberately excluded from this phase's deterministic aggregation
— see `COMMISSIONER_OS_CONTENT_POLICY.md`), no changes to
`lib/rivalry-engine.ts` (the legacy, roster_id-keyed duplicate — untouched,
never read), no changes to `lib/live-draft-brain/post-draft-grade.ts`
(a richer, orphaned reach/value draft engine — not revived this phase), and
no start of the global provider-agnostic Rankings migration.
