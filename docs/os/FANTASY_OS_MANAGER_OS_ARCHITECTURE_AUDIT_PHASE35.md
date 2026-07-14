# Manager OS Architecture Audit (Phase 35, Track B — audit only, no implementation)

Fresh audit — the codebase's own prior "OS-C1 through OS-C4" documentation was not trusted; every claim below was independently re-verified against the actual code.

## What "Manager OS" actually is

Two real files, no dedicated `lib/manager-os/` directory (it does not exist — the implementation lives inside `lib/decision-os/`):

- **`lib/decision-os/userOs.ts`** — `resolveUserOsSnapshot(leagueId, managerId, now)`: single-manager, single-league snapshot. Composes `assembleManagerBehavioralFacts`/`deriveManagerBehavioralIntelligence` (real behavioral pipeline) and `resolveManagerIntelligencePayload` (real, Prisma-backed: loads league events, assembles behavioral facts, runs pattern detection, Manager DNA, recommendations). Never throws; degrades to `{available: false, reason: 'user_os_unavailable'}`.
- **`lib/decision-os/managerCommandCenter.ts`** — `resolveManagerCommandCenterSnapshot(userId, leagueIds, now)`: multi-league aggregation, calls `resolveUserOsSnapshot` per league in parallel, buckets healthy/at-risk leagues, derives an attention queue, collects recommendations (capped 60). Per-league failures degrade independently.

## Real production wiring (confirmed, not assumed)

- `app/api/decision-os/user-os/route.ts` — real, session-gated, authorized API route.
- `app/api/decision-os/manager-command-center/route.ts` — real, session-gated API route.
- `components/decision-os/UserOsCard.tsx` — real, non-trivial rendering component.
- `components/decision-os/ManagerCommandCenterSection.tsx` — real, substantial client component.
- `app/manager-hub/page.tsx` / `ManagerHubPageClient.tsx` — real, deployed, session-aware route rendering the above.

## Naming collisions found (a real, recurring pattern in this codebase)

| Thing | Path | Relationship |
|---|---|---|
| **Manager Intelligence Platform / "Manager Hub"** | `app/league/[leagueId]/manager-hub/page.tsx` → `components/manager-intelligence/ManagerIntelligenceHub.tsx` | **Separate, independent system.** Reads `RedraftRoster`/`RedraftSeason` directly, zero calls into `lib/decision-os/behavioral/*`. Provider-specific (AF-native redraft only). Confusingly similar route path to the real Manager OS's `/manager-hub`. |
| **Manager Replay Insights** | `lib/replay-framework/insights/managerReplayInsight.ts`, `lib/decision-os/replay-insights/replayInsightResolver.ts` | Separate, narrower system. Its own header comments claim "not wired into any live route" — **this claim is stale/false**: it IS real-wired (`app/api/leagues/[leagueId]/replay-insights/route.ts` → `components/dashboard/ManagerReplayInsightsCard.tsx`, rendered in the real NFL/NCAAF home dashboard), but gated by a feature flag whose production value could not be confirmed from the repo. |
| Generic "manager" utilities | `components/ManagerPsychology.tsx`, `app/manager-compare`, `app/api/ai/manager-dna`, `app/commissioner-os/managers` | Confirmed unrelated. |

## The critical, real finding: reachability is narrower than prior documentation implies

1. **`UserOsCard`/`resolveUserOsSnapshot`** is only reached via `LeagueTab.tsx`, which renders only for the `'league'` tab id — which exists for NBA/MLB/NHL/NCAAB/SOCCER/PGA leagues. **NFL and NCAAF leagues — the platform's most-invested-in sports — use a completely separate `NflRedraftLeagueHomeDashboard` component with zero Manager OS integration.** This sport-conditional split is not discussed anywhere in the prior `OS-C`/`USER_OS_MANAGER_OS_SLEEPER_PROOF_AUDIT.md` documentation.
2. **`/manager-hub` (Manager Command Center)** is real and wired end-to-end, but reachable only by direct URL or via `app/fantasy-os/FantasyOsGateway.tsx` — and no primary navigation component anywhere in the app links to `/fantasy-os` or `/manager-hub`.

## Fact-check of `OS_C4_MANAGER_OS_CERTIFICATION.md`'s specific claims

| Claim | Verifiable from repo? |
|---|---|
| Real non-prod pipeline execution mechanism (the live-validate script) | **Yes** — the script is real, does what it claims, calls real production functions in the real order |
| Specific real-data numbers (1 league, N signals, N notifications) | **No** — rests on an unrepeatable, uncommitted script run with no persisted evidence artifact in the repo |
| "Multi-League" framing in the doc's title | **Not backed by its own evidence** — its own results table shows only 1 real league for the tested user |
| Self-disclosed remaining risks (no browser screenshot exists, production null-status risk) | **Yes, and independently confirmed** — no e2e/browser test of Manager OS exists in `__tests__/` |

The document is honestly hedged in its own text about several limits, but its headline "certification" framing overstates what its own evidence supports, and neither it nor any other prior doc discusses the sport-conditional reachability gap found this phase.
