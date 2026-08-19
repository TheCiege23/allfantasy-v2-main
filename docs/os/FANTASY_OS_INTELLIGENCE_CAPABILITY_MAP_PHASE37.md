# Intelligence Capability Map (Phase 37, Part 4)

One canonical map: for every real intelligence capability found, where it originates, where it's displayed, who can access it, whether it's duplicated, and whether surfaces disagree.

| Capability | Originates (real engine) | Displayed on | Access | Appears 2+ times? | Contradictions found |
|---|---|---|---|---|---|
| League health (Commissioner HQ variant) | `lib/commissioner-hub/commissionerHubHealth.ts` | `/dashboard` (Commissioner HQ card), `/commissioner-hub` (League Health Map + per-league cards) | Commissioner | Yes (2 pages, **same** engine — intentional, documented reuse) | No — consistent within this one engine's own outputs |
| League health (Intelligence API variant) | `/api/v1/intelligence/leagues/[leagueId]/health` (G15.6) | `/league/[leagueId]/intelligence` | Commissioner (module-gated) | No | **Yes, by omission** — computed entirely independently of the Commissioner HQ engine above; a commissioner has no way to know these two numbers might differ, because neither surface references the other |
| League health (Mission Control / League Analytics) | `lib/decision-os/missionControl.ts`, `lib/decision-os/leagueAnalytics.ts` | `/commissioner-hub` League Focus only | Commissioner | No | Same contradiction risk as above — a third independent computation, shown on the same page as the Commissioner HQ health engine's own League Health Map, without cross-reference |
| Manager retention risk / engagement | `lib/decision-os/behavioral/manager-intelligence.ts` via `resolveUserOsSnapshot` | `UserOsCard` (all sports, 2 entry components) | Any member, own team only | No (1 canonical card, multiple entry points, not duplicated content) | No |
| Manager DNA | `lib/decision-os/manager-dna.ts` | `LeagueTab.tsx`, `/commissioner-hub` | Member / Commissioner respectively | Yes (2 pages, same engine, same data) | No |
| Recommendations (manager-tier) | `lib/decision-os/recommendations.ts` | `LeagueTab.tsx`, `/commissioner-hub`, `/manager-hub` (via Manager Command Center) | Member / Commissioner / Any member | Yes (3 pages) | No — same underlying `Recommendation` objects, filtered by tier |
| League pulse | `lib/decision-os/league-pulse.ts` | `LeagueTab.tsx`, `/commissioner-hub` | Member / Commissioner | Yes (2 pages, same engine) | No |
| Matchup scores/insights | `server/services/matchupCenterService.ts` | Matchup Center tab, `/dashboard`'s `MatchupPreviewCard` | Member | Yes (2 surfaces, intentional documented reuse) | No |
| Replay/historical trade insights | `lib/replay-framework/insights/` | NFL/NCAAF league home only | Any member (flagged) | No | No |
| Attention/priority signals | `lib/decision-os/attentionSignals.ts` (manager) + Commissioner's own attention queue | `/manager-hub`, `/commissioner-hub` | Any member / Commissioner | No (separate manager-scoped vs commissioner-scoped signal sets) | No — deliberately different scopes, not the same data shown twice |

## Contradictions identified (the real consolidation priority)

**Three independently-computed "league health" values can be shown to the same commissioner, for the same league, in the same session, with no cross-reference between them.** This is the single highest-value finding of this phase's Intelligence Mapping — not a truthfulness defect in any one engine (each is internally honest about its own inputs/confidence), but a real, disclosed structural inconsistency: nothing tells the user these are three different computations, and nothing guarantees they'd ever agree.

**Recommendation OS engineering (not implemented this phase, per guardrails):** the smallest fix or requires cross-system engine unification, judged out of scope for "do not redesign any OS subsystem." The realistic near-term mitigation is presentation-layer: each health surface stating explicitly which engine computed it (already partially true — `/commissioner-hub`'s cards show "Source: Database/Dashboard fallback," a good existing precedent) and, ideally, a short explanatory note when a user might reasonably encounter more than one. Flagged for a future phase's explicit scope, not attempted here.
