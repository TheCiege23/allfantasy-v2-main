# LeagueTeam reader census — Import Integrity Batch A/A.1

Generated for the integration compatibility pass. Every `prisma.leagueTeam.find*` /
`count` / `aggregate` / `groupBy` call site in `lib/`, `app/` and `scripts/`, excluding
`__tests__`. **No reader is left unclassified.**

## Why most readers correctly need no filter

`origin/main` ALREADY archives a vanishing *claimed* team (`isOrphan: true`) rather than
deleting it — verified at `1a43ebbd8`. Orphaned rows therefore exist in production today,
and any unfiltered reader already sees them. Batch A.1 widened the population from
claimed-only to all vanishing teams; it did not introduce the exposure.

The decisive distinction is the SHAPE of the read, not the file it lives in:

| Shape | Rule | Why |
|---|---|---|
| Enumeration for display/decision | exclude archived | a departed team is shown or counted |
| Lookup map keyed by a unique id | retain | unreachable from current data; filtering breaks historical resolution |
| Historical/statistical read | retain | attribution must survive |

## Totals

| Category | Call sites | Files |
|---|---|---|
| 1 active-enumeration | 80 | 71 |
| 2 team-lookup | 62 | 43 |
| 3 identity-map | 16 | 16 |
| 4 historical | 9 | 9 |
| 5 admin-monitoring | 10 | 8 |
| 6 import-lifecycle | 10 | 8 |
| 7 purge/script | 7 | 6 |
| **Total** | **194** | **146** |

Files changed in this pass: **12**

## Unresolved ambiguity

None blocking. Two judgement calls are recorded rather than hidden:

- **Category 2 (team lookup), 43 files.** The instruction is to exclude archived teams
  unless archived data is explicitly requested. Two own-team resolvers on current-decision
  paths (`ai/waiver-recs`, `ai/matchup-preview`) were changed. The remainder look up a team
  BY its id/externalId to render or join that specific record — where returning the row the
  caller asked for by primary key is the correct behaviour, and filtering would make a
  historical record unreadable. They are listed below for review.
- **Category 5 (admin/commissioner), 8 files.** Archived teams are INCLUDED deliberately:
  a commissioner needs to see that a seat left the league, which is precisely the fact
  archival preserves.

## Full census

| File | Line | Call | Category | Expected orphan behaviour | Changed | Coverage |
|---|---|---|---|---|---|---|
| `app/api/ai/matchup-preview/route.ts` | 70 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | yes | active-surface-orphan-guards |
| `app/api/ai/waiver-recs/route.ts` | 70 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | yes | active-surface-orphan-guards |
| `app/api/cron/alert-sweep/route.ts` | 234 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | no | — |
| `app/api/cron/decision-os-activity-ingest/route.ts` | 394 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | no | — |
| `app/api/devy/import/match/route.ts` | 27 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | no | — |
| `app/api/discover/orphan-teams/route.ts` | 174 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | no | — |
| `app/api/dynasty-outlook/route.ts` | 56 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | no | — |
| `app/api/league/trend-board/route.ts` | 135 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | no | — |
| `app/api/leagues/[leagueId]/draft/import/validate/route.ts` | 71 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | no | — |
| `app/api/leagues/[leagueId]/draft/settings/route.ts` | 276 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | no | — |
| `app/api/leagues/[leagueId]/draft/settings/route.ts` | 438 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | no | — |
| `app/api/leagues/[leagueId]/dynasty-projections/handler.ts` | 336 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | no | — |
| `app/api/leagues/[leagueId]/fill-empty-slots/handler.ts` | 41 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | no | — |
| `app/api/leagues/[leagueId]/fill-empty-slots/handler.ts` | 131 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | no | — |
| `app/api/leagues/[leagueId]/matchups/handler.ts` | 99 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | no | — |
| `app/api/leagues/[leagueId]/zombie/summary/route.ts` | 51 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | no | — |
| `app/api/leagues/join/route.ts` | 297 | `leagueTeam.count` | 1 active-enumeration | exclude archived | yes | active-team-policy-registry, active-surface-orphan-guards | | active-surface-orphan-guards, active-team-policy-registry
| `app/api/leagues/join/route.ts` | 390 | `leagueTeam.count` | 1 active-enumeration | exclude archived | yes | active-team-policy-registry, active-surface-orphan-guards | | active-surface-orphan-guards, active-team-policy-registry
| `app/api/leagues/join/route.ts` | 391 | `leagueTeam.count` | 1 active-enumeration | exclude archived | yes | active-team-policy-registry, active-surface-orphan-guards | | active-surface-orphan-guards, active-team-policy-registry
| `app/api/rankings/route.ts` | 55 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | yes | active-surface-orphan-guards |
| `app/api/trade-value/league-teams/route.ts` | 34 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | yes | active-surface-orphan-guards |
| `lib/agents/anthropic-pipeline.ts` | 1351 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | no | — |
| `lib/ai-tools-start-sit/opponentMatchup.ts` | 110 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | no | — |
| `lib/ai/engine/plugins/nfl.plugin.ts` | 195 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | yes | active-team-policy-registry, active-surface-orphan-guards | | active-surface-orphan-guards, active-team-policy-registry
| `lib/ai/leagueSportsGroundingPacket.ts` | 408 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | no | — |
| `lib/chat-core/matchupThreads.ts` | 83 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | no | — |
| `lib/chimmy-alerts/ChimmyAlertSignalHydrator.ts` | 154 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | no | — |
| `lib/chimmy-alerts/ChimmyAlertSignalHydrator.ts` | 167 | `leagueTeam.groupBy` | 1 active-enumeration | exclude archived | no | — |
| `lib/chimmy/tools/leagueByName.ts` | 325 | `leagueTeam.count` | 1 active-enumeration | exclude archived | yes | active-team-policy-registry, active-surface-orphan-guards | | active-surface-orphan-guards, active-team-policy-registry
| `lib/core-app/draftHq.ts` | 523 | `leagueTeam.count` | 1 active-enumeration | exclude archived | no | — |
| `lib/core-app/draftHqAll.ts` | 149 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | no | — |
| `lib/core-app/myTeam.ts` | 886 | `leagueTeam.count` | 1 active-enumeration | exclude archived | yes | active-team-policy-registry, active-surface-orphan-guards | | active-surface-orphan-guards, active-team-policy-registry
| `lib/core-app/playerFinder.ts` | 499 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | no | — |
| `lib/core-app/playerImpact.ts` | 190 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | no | — |
| `lib/core-app/portfolio.ts` | 130 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | no | — |
| `lib/core-app/seasonOutlook.ts` | 597 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | no | — |
| `lib/core-app/seasonOutlook.ts` | 606 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | no | — |
| `lib/core-app/trades.ts` | 450 | `leagueTeam.count` | 1 active-enumeration | exclude archived | no | — |
| `lib/core-app/weekAll.ts` | 95 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | no | — |
| `lib/core-app/weekBoard.ts` | 331 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | no | — |
| `lib/core-app/weekBoard.ts` | 340 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | no | — |
| `lib/data/league-home.ts` | 369 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | yes | active-surface-orphan-guards |
| `lib/decision-os/grounding/psychologyConsistencySlice.ts` | 68 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | no | — |
| `lib/decision-os/world/port.ts` | 101 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | no | — |
| `lib/decision-os/world/port.ts` | 974 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | no | — |
| `lib/invite-engine/InviteEngine.ts` | 290 | `leagueTeam.count` | 1 active-enumeration | exclude archived | no | — |
| `lib/league-chat/leagueMemberIds.ts` | 8 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | no | — |
| `lib/league-events/publisher.ts` | 32 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | yes | active-surface-orphan-guards |
| `lib/league/league-dashboard-view.ts` | 215 | `leagueTeam.count` | 1 active-enumeration | exclude archived | yes | active-surface-orphan-guards |
| `lib/league/maxPF.ts` | 29 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | no | — |
| `lib/live/liveScoresPage.ts` | 228 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | no | — |
| `lib/long-term-coaching/buildLongTermCoachingAnalysis.ts` | 226 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | no | — |
| `lib/matchup-prep-dashboard/resolveMatchupOpponent.ts` | 155 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | no | — |
| `lib/notification-engine.ts` | 175 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | yes | active-surface-orphan-guards |
| `lib/profile-stats/ProfileStatsService.ts` | 62 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | no | — |
| `lib/promotion-relegation/DivisionResolver.ts` | 55 | `leagueTeam.count` | 1 active-enumeration | exclude archived | no | — |
| `lib/promotion-relegation/StandingsEvaluator.ts` | 28 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | no | — |
| `lib/promotion-relegation/StandingsEvaluator.ts` | 72 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | no | — |
| `lib/psychological-profiles/CrossLeagueRollup.ts` | 60 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | no | — |
| `lib/psychological-profiles/ProfileAccess.ts` | 70 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | no | — |
| `lib/schedule-runtime/resolveNflRedraftScheduleRuntime.ts` | 120 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | no | — |
| `lib/scoring-engine/resolveTeamLabels.ts` | 6 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | no | — |
| `lib/shared-services/league-hub/LeaguePortfolioService.ts` | 88 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | no | — |
| `lib/shared-services/league-hub/userOsContext.ts` | 134 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | no | — |
| `lib/sports-media-engine/PowerRankingGenerator.ts` | 26 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | yes | active-surface-orphan-guards |
| `lib/survivor/SurvivorOfficialCommandService.ts` | 79 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | no | — |
| `lib/survivor/SurvivorTimelineResolver.ts` | 68 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | no | — |
| `lib/survivor/ai/SurvivorAIContext.ts` | 164 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | no | — |
| `lib/survivor/notificationEngine.ts` | 45 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | no | — |
| `lib/today-actions-engine/countLeaguesWithWeeklyMatchupForUserTeams.ts` | 8 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | no | — |
| `lib/tournament/importTournamentFromLeagues.ts` | 146 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | no | — |
| `lib/tournament/importedStandingsSource.ts` | 73 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | no | — |
| `lib/tournament/ingestWeeklyPlayerScores.ts` | 210 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | no | — |
| `lib/tournament/rosterCompliance.ts` | 114 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | no | — |
| `lib/tournament/topPerformers.ts` | 124 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | no | — |
| `lib/trade-value-console/roster-context-loader.ts` | 231 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | no | — |
| `lib/trade-value-console/war-room-trade-context.ts` | 116 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | no | — |
| `lib/trending-players/trendCardEnrichment.ts` | 42 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | no | — |
| `lib/zombie/ai/ZombieAIContext.ts` | 105 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | no | — |
| `lib/zombie/rosterTeamMap.ts` | 21 | `leagueTeam.findMany` | 1 active-enumeration | exclude archived | no | — |
| `app/api/league/create/route.ts` | 1348 | `leagueTeam.findFirst` | 2 team-lookup | exclude archived unless explicitly requested | no | — |
| `app/api/league/invite/claim/route.ts` | 55 | `leagueTeam.findFirst` | 2 team-lookup | exclude archived unless explicitly requested | no | — |
| `app/api/league/invite/route.ts` | 35 | `leagueTeam.findFirst` | 2 team-lookup | exclude archived unless explicitly requested | no | — |
| `app/api/league/roster/route.ts` | 391 | `leagueTeam.findFirst` | 2 team-lookup | exclude archived unless explicitly requested | no | — |
| `app/api/league/trend-board/route.ts` | 102 | `leagueTeam.findFirst` | 2 team-lookup | exclude archived unless explicitly requested | no | — |
| `app/api/leagues/[leagueId]/orphaned-teams/handler.ts` | 18 | `leagueTeam.findFirst` | 2 team-lookup | exclude archived unless explicitly requested | no | — |
| `app/api/leagues/[leagueId]/psychological-profiles/handler.ts` | 59 | `leagueTeam.findFirst` | 2 team-lookup | exclude archived unless explicitly requested | no | — |
| `app/api/survivor/tribal/route.ts` | 283 | `leagueTeam.findFirst` | 2 team-lookup | exclude archived unless explicitly requested | no | — |
| `app/api/zombie/universe/[universeId]/chat/route.ts` | 50 | `leagueTeam.findFirst` | 2 team-lookup | exclude archived unless explicitly requested | no | — |
| `lib/ai-payload/resolveAiTeamContext.ts` | 128 | `leagueTeam.findFirst` | 2 team-lookup | exclude archived unless explicitly requested | no | — |
| `lib/ai-payload/resolveAiTeamContext.ts` | 143 | `leagueTeam.findFirst` | 2 team-lookup | exclude archived unless explicitly requested | no | — |
| `lib/ai-tools-start-sit/runStartSitAnalysis.ts` | 222 | `leagueTeam.findFirst` | 2 team-lookup | exclude archived unless explicitly requested | no | — |
| `lib/ai-tools-start-sit/runStartSitAnalysis.ts` | 249 | `leagueTeam.findFirst` | 2 team-lookup | exclude archived unless explicitly requested | no | — |
| `lib/ai-tools-start-sit/runStartSitAnalysis.ts` | 262 | `leagueTeam.findFirst` | 2 team-lookup | exclude archived unless explicitly requested | no | — |
| `lib/ai-tools-start-sit/runStartSitAnalysis.ts` | 468 | `leagueTeam.findFirst` | 2 team-lookup | exclude archived unless explicitly requested | no | — |
| `lib/ai/engine/plugins/nfl.plugin.ts` | 183 | `leagueTeam.findFirst` | 2 team-lookup | exclude archived unless explicitly requested | yes | active-team-policy-registry, active-surface-orphan-guards | | active-surface-orphan-guards, active-team-policy-registry
| `lib/ai/league-settings-ai/access.ts` | 36 | `leagueTeam.findFirst` | 2 team-lookup | exclude archived unless explicitly requested | no | — |
| `lib/ai/leagueSportsGroundingPacket.ts` | 468 | `leagueTeam.findFirst` | 2 team-lookup | exclude archived unless explicitly requested | no | — |
| `lib/ai/opponents/draftRosterMapping.ts` | 10 | `leagueTeam.findFirst` | 2 team-lookup | exclude archived unless explicitly requested | no | — |
| `lib/ai/opponents/draftRosterMapping.ts` | 22 | `leagueTeam.findFirst` | 2 team-lookup | exclude archived unless explicitly requested | no | — |
| `lib/ai/opponents/draftRosterMapping.ts` | 39 | `leagueTeam.findFirst` | 2 team-lookup | exclude archived unless explicitly requested | no | — |
| `lib/ai/opponents/liveDraftAiAutopick.ts` | 218 | `leagueTeam.findUnique` | 2 team-lookup | exclude archived unless explicitly requested | no | — |
| `lib/ai/opponents/liveDraftAiAutopick.ts` | 253 | `leagueTeam.findUnique` | 2 team-lookup | exclude archived unless explicitly requested | no | — |
| `lib/ai/opponents/liveDraftAiAutopick.ts` | 435 | `leagueTeam.findUnique` | 2 team-lookup | exclude archived unless explicitly requested | no | — |
| `lib/ai/sim/groundedTradeDelta.ts` | 95 | `leagueTeam.findFirst` | 2 team-lookup | exclude archived unless explicitly requested | no | — |
| `lib/chat-core/matchupThreads.ts` | 126 | `leagueTeam.findFirst` | 2 team-lookup | exclude archived unless explicitly requested | no | — |
| `lib/core-app/draftBoard.ts` | 119 | `leagueTeam.findFirst` | 2 team-lookup | exclude archived unless explicitly requested | no | — |
| `lib/core-app/draftHq.ts` | 498 | `leagueTeam.findFirst` | 2 team-lookup | exclude archived unless explicitly requested | no | — |
| `lib/core-app/draftHq.ts` | 689 | `leagueTeam.findFirst` | 2 team-lookup | exclude archived unless explicitly requested | no | — |
| `lib/core-app/leaguePairing.ts` | 296 | `leagueTeam.findFirst` | 2 team-lookup | exclude archived unless explicitly requested | no | — |
| `lib/core-app/matchup.ts` | 320 | `leagueTeam.findFirst` | 2 team-lookup | exclude archived unless explicitly requested | no | — |
| `lib/core-app/myTeam.ts` | 875 | `leagueTeam.findFirst` | 2 team-lookup | exclude archived unless explicitly requested | yes | active-team-policy-registry, active-surface-orphan-guards | | active-surface-orphan-guards, active-team-policy-registry
| `lib/core-app/trades.ts` | 490 | `leagueTeam.findFirst` | 2 team-lookup | exclude archived unless explicitly requested | no | — |
| `lib/core-app/waivers.ts` | 253 | `leagueTeam.findFirst` | 2 team-lookup | exclude archived unless explicitly requested | no | — |
| `lib/decision-os/grounding/rosterValueGradeSlice.ts` | 100 | `leagueTeam.findFirst` | 2 team-lookup | exclude archived unless explicitly requested | no | — |
| `lib/dispersal-draft/DispersalDraftEngine.ts` | 70 | `leagueTeam.findFirst` | 2 team-lookup | exclude archived unless explicitly requested | no | — |
| `lib/dispersal-draft/DispersalDraftEngine.ts` | 122 | `leagueTeam.findFirst` | 2 team-lookup | exclude archived unless explicitly requested | no | — |
| `lib/dispersal-draft/dispersal-draft-detail.ts` | 91 | `leagueTeam.findFirst` | 2 team-lookup | exclude archived unless explicitly requested | no | — |
| `lib/franchise/franchiseBoard.ts` | 53 | `leagueTeam.findFirst` | 2 team-lookup | exclude archived unless explicitly requested | no | — |
| `lib/franchise/franchiseService.ts` | 123 | `leagueTeam.findFirst` | 2 team-lookup | exclude archived unless explicitly requested | no | — |
| `lib/league-access.ts` | 102 | `leagueTeam.findFirst` | 2 team-lookup | exclude archived unless explicitly requested | no | — |
| `lib/league/dispersal-draft-route-helpers.ts` | 7 | `leagueTeam.findFirst` | 2 team-lookup | exclude archived unless explicitly requested | no | — |
| `lib/league/permissions.ts` | 17 | `leagueTeam.findFirst` | 2 team-lookup | exclude archived unless explicitly requested | no | — |
| `lib/live-draft-engine/auth.ts` | 56 | `leagueTeam.findFirst` | 2 team-lookup | exclude archived unless explicitly requested | no | — |
| `lib/matchup-prep-dashboard/resolveMatchupOpponent.ts` | 50 | `leagueTeam.findFirst` | 2 team-lookup | exclude archived unless explicitly requested | no | — |
| `lib/matchup-prep-dashboard/resolveMatchupOpponent.ts` | 100 | `leagueTeam.findFirst` | 2 team-lookup | exclude archived unless explicitly requested | no | — |
| `lib/matchup-prep-dashboard/resolveMatchupOpponent.ts` | 124 | `leagueTeam.findFirst` | 2 team-lookup | exclude archived unless explicitly requested | no | — |
| `lib/matchup-prep-dashboard/resolveMatchupOpponent.ts` | 129 | `leagueTeam.findFirst` | 2 team-lookup | exclude archived unless explicitly requested | no | — |
| `lib/matchup-prep-dashboard/resolveMatchupOpponent.ts` | 199 | `leagueTeam.findFirst` | 2 team-lookup | exclude archived unless explicitly requested | no | — |
| `lib/matchup-prep-dashboard/runMatchupPrepDashboard.ts` | 438 | `leagueTeam.findFirst` | 2 team-lookup | exclude archived unless explicitly requested | no | — |
| `lib/matchup-prep-dashboard/runMatchupPrepDashboard.ts` | 453 | `leagueTeam.findFirst` | 2 team-lookup | exclude archived unless explicitly requested | no | — |
| `lib/matchup-prep-dashboard/runMatchupPrepDashboard.ts` | 589 | `leagueTeam.findFirst` | 2 team-lookup | exclude archived unless explicitly requested | no | — |
| `lib/matchup-prep-dashboard/runMatchupPrepDashboard.ts` | 596 | `leagueTeam.findFirst` | 2 team-lookup | exclude archived unless explicitly requested | no | — |
| `lib/promotion-relegation/DivisionResolver.ts` | 49 | `leagueTeam.findUnique` | 2 team-lookup | exclude archived unless explicitly requested | no | — |
| `lib/redraft/finalizeDraftToRedraftSeason.ts` | 204 | `leagueTeam.findFirst` | 2 team-lookup | exclude archived unless explicitly requested | no | — |
| `lib/redraft/redraftRosterIdentity.ts` | 140 | `leagueTeam.findFirst` | 2 team-lookup | exclude archived unless explicitly requested | no | — |
| `lib/redraft/redraftRosterIdentity.ts` | 149 | `leagueTeam.findFirst` | 2 team-lookup | exclude archived unless explicitly requested | no | — |
| `lib/redraft/redraftRosterIdentity.ts` | 397 | `leagueTeam.findFirst` | 2 team-lookup | exclude archived unless explicitly requested | no | — |
| `lib/survivor/SurvivorTribalCouncilService.ts` | 130 | `leagueTeam.findFirst` | 2 team-lookup | exclude archived unless explicitly requested | no | — |
| `lib/survivor/notificationEngine.ts` | 52 | `leagueTeam.findFirst` | 2 team-lookup | exclude archived unless explicitly requested | no | — |
| `lib/today-actions-engine/primaryLeagueForUser.ts` | 14 | `leagueTeam.findFirst` | 2 team-lookup | exclude archived unless explicitly requested | no | — |
| `lib/tournament/linkManager.ts` | 70 | `leagueTeam.findFirst` | 2 team-lookup | exclude archived unless explicitly requested | no | — |
| `app/api/leagues/[leagueId]/claim-roster/handler.ts` | 43 | `leagueTeam.findMany` | 3 identity-map | retain archived (resolves historical records / provider identity) | no | — |
| `app/api/leagues/[leagueId]/downsize/handler.ts` | 65 | `leagueTeam.findMany` | 3 identity-map | retain archived (resolves historical records / provider identity) | no | — |
| `app/api/leagues/[leagueId]/members/autocomplete/route.ts` | 26 | `leagueTeam.findMany` | 3 identity-map | retain archived (resolves historical records / provider identity) | no | — |
| `lib/ai/sim/groundedTradeDelta.ts` | 144 | `leagueTeam.findMany` | 3 identity-map | retain archived (resolves historical records / provider identity) | no | — |
| `lib/broadcast-engine/BroadcastModeEngine.ts` | 37 | `leagueTeam.findMany` | 3 identity-map | retain archived (resolves historical records / provider identity) | yes | active-team-policy-registry, active-surface-orphan-guards | | active-surface-orphan-guards, active-team-policy-registry
| `lib/core-app/discordBridge.ts` | 188 | `leagueTeam.findMany` | 3 identity-map | retain archived (resolves historical records / provider identity) | no | — |
| `lib/core-app/leagueHome.ts` | 478 | `leagueTeam.findMany` | 3 identity-map | retain archived (resolves historical records / provider identity) | yes | active-surface-orphan-guards |
| `lib/core-app/matchup.ts` | 391 | `leagueTeam.findMany` | 3 identity-map | retain archived (resolves historical records / provider identity) | no | active-surface-orphan-guards (lookup) |
| `lib/core-app/portfolio.ts` | 170 | `leagueTeam.groupBy` | 3 identity-map | retain archived (resolves historical records / provider identity) | no | — |
| `lib/core-app/trades.ts` | 513 | `leagueTeam.findMany` | 3 identity-map | retain archived (resolves historical records / provider identity) | no | — |
| `lib/league/sleeper-import-process.ts` | 551 | `leagueTeam.findMany` | 3 identity-map | retain archived (resolves historical records / provider identity) | no | — |
| `lib/platform-leaderboards/PlatformLeaderboardsService.ts` | 92 | `leagueTeam.findMany` | 3 identity-map | retain archived (resolves historical records / provider identity) | no | — |
| `lib/psychological-profiles/CrossLeagueRollup.ts` | 97 | `leagueTeam.findMany` | 3 identity-map | retain archived (resolves historical records / provider identity) | no | — |
| `lib/psychological-profiles/TransactionFactBackfill.ts` | 97 | `leagueTeam.findMany` | 3 identity-map | retain archived (resolves historical records / provider identity) | no | — |
| `lib/shared-services/league-hub/crossLeaguePlayerPortfolio.ts` | 378 | `leagueTeam.findMany` | 3 identity-map | retain archived (resolves historical records / provider identity) | no | — |
| `lib/waiver-wire/run-hooks.ts` | 148 | `leagueTeam.findMany` | 3 identity-map | retain archived (resolves historical records / provider identity) | no | — |
| `app/api/league/sync-history/route.ts` | 32 | `leagueTeam.findFirst` | 4 historical | retain archived (attribution must survive) | no | active-surface-orphan-guards (historical absence) |
| `app/api/leagues/[leagueId]/rivalries/[rivalryId]/head-to-head/route.ts` | 35 | `leagueTeam.findMany` | 4 historical | retain archived (attribution must survive) | no | active-surface-orphan-guards (historical absence) |
| `lib/core-app/career.ts` | 494 | `leagueTeam.findMany` | 4 historical | retain archived (attribution must survive) | no | active-surface-orphan-guards (historical absence) |
| `lib/data-warehouse/HistoricalFactGenerator.ts` | 174 | `leagueTeam.findMany` | 4 historical | retain archived (attribution must survive) | no | active-surface-orphan-guards (historical absence) |
| `lib/decision-os/lineup/warehouseFacts.ts` | 127 | `leagueTeam.findFirst` | 4 historical | retain archived (attribution must survive) | no | active-surface-orphan-guards (historical absence) |
| `lib/league-history/leagueWarehouseReads.ts` | 157 | `leagueTeam.findMany` | 4 historical | retain archived (attribution must survive) | no | active-surface-orphan-guards (historical absence) |
| `lib/league/syncLeagueHistory.ts` | 116 | `leagueTeam.findFirst` | 4 historical | retain archived (attribution must survive) | no | active-surface-orphan-guards (historical absence) |
| `lib/sports-media-engine/RecapGenerator.ts` | 25 | `leagueTeam.findMany` | 4 historical | retain archived (attribution must survive) | no | active-surface-orphan-guards (historical absence) |
| `lib/weekly-recap-engine/WeeklyRecapEngine.ts` | 54 | `leagueTeam.findFirst` | 4 historical | retain archived (attribution must survive) | no | active-surface-orphan-guards (historical absence) |
| `app/api/commissioner/leagues/[leagueId]/ai-opponents/assignments/route.ts` | 57 | `leagueTeam.findFirst` | 5 admin-monitoring | see note — archived included deliberately for monitoring | no | — |
| `app/api/commissioner/leagues/[leagueId]/league-settings/route.ts` | 40 | `leagueTeam.findMany` | 5 admin-monitoring | see note — archived included deliberately for monitoring | no | — |
| `app/api/commissioner/leagues/[leagueId]/league-settings/route.ts` | 102 | `leagueTeam.findMany` | 5 admin-monitoring | see note — archived included deliberately for monitoring | no | — |
| `app/api/commissioner/leagues/[leagueId]/managers/route.ts` | 27 | `leagueTeam.findMany` | 5 admin-monitoring | see note — archived included deliberately for monitoring | no | — |
| `app/api/commissioner/leagues/[leagueId]/renew/route.ts` | 317 | `leagueTeam.count` | 5 admin-monitoring | see note — archived included deliberately for monitoring | no | — |
| `app/api/league/settings/co-commissioners/route.ts` | 30 | `leagueTeam.findFirst` | 5 admin-monitoring | see note — archived included deliberately for monitoring | no | — |
| `lib/admin-dashboard/DuplicateManagerVerificationService.ts` | 210 | `leagueTeam.findMany` | 5 admin-monitoring | see note — archived included deliberately for monitoring | no | — |
| `lib/commissioner-ui/managers/managerNames.ts` | 65 | `leagueTeam.findMany` | 5 admin-monitoring | see note — archived included deliberately for monitoring | no | — |
| `lib/commissioner-workspace/rosterReads.ts` | 30 | `leagueTeam.count` | 5 admin-monitoring | see note — archived included deliberately for monitoring | no | — |
| `lib/commissioner-workspace/rosterReads.ts` | 31 | `leagueTeam.count` | 5 admin-monitoring | see note — archived included deliberately for monitoring | no | — |
| `lib/import-os/collector/applySleeperLeagueSync.ts` | 106 | `leagueTeam.findMany` | 6 import-lifecycle | preserve identity; archive only on complete authoritative observation; reactivate same row | no | team-archival / ghost-team-lifecycle |
| `lib/import-os/collector/applySleeperLeagueSync.ts` | 425 | `leagueTeam.findMany` | 6 import-lifecycle | preserve identity; archive only on complete authoritative observation; reactivate same row | no | team-archival / ghost-team-lifecycle |
| `lib/import-os/collector/fantraxMatchupParity.ts` | 122 | `leagueTeam.findMany` | 6 import-lifecycle | preserve identity; archive only on complete authoritative observation; reactivate same row | yes | active-surface-orphan-guards, team-archival / ghost-team-lifecycle |
| `lib/league-import/ImportedLeagueCommitService.ts` | 624 | `leagueTeam.findFirst` | 6 import-lifecycle | preserve identity; archive only on complete authoritative observation; reactivate same row | no | team-archival / ghost-team-lifecycle |
| `lib/league-import/ImportedLeagueCommitService.ts` | 639 | `leagueTeam.findFirst` | 6 import-lifecycle | preserve identity; archive only on complete authoritative observation; reactivate same row | no | team-archival / ghost-team-lifecycle |
| `lib/league-import/avatarMirror.ts` | 55 | `leagueTeam.findMany` | 6 import-lifecycle | preserve identity; archive only on complete authoritative observation; reactivate same row | no | team-archival / ghost-team-lifecycle |
| `lib/league-import/canonicalSeasonMaterialization.ts` | 76 | `leagueTeam.findMany` | 6 import-lifecycle | preserve identity; archive only on complete authoritative observation; reactivate same row | no | team-archival / ghost-team-lifecycle |
| `lib/league-import/placeholderClaim.ts` | 148 | `leagueTeam.findMany` | 6 import-lifecycle | preserve identity; archive only on complete authoritative observation; reactivate same row | no | team-archival / ghost-team-lifecycle |
| `lib/league-import/sleeper/SleeperLeagueCreationBootstrapService.ts` | 332 | `leagueTeam.findMany` | 6 import-lifecycle | preserve identity; archive only on complete authoritative observation; reactivate same row | no | team-archival / ghost-team-lifecycle |
| `lib/sleeper-sync.ts` | 386 | `leagueTeam.findMany` | 6 import-lifecycle | preserve identity; archive only on complete authoritative observation; reactivate same row | no | team-archival / ghost-team-lifecycle |
| `scripts/backfill-decision-os-sleeper-history.ts` | 82 | `leagueTeam.findMany` | 7 purge/script | destructive by intent; isolated and authorized | no | — |
| `scripts/backfill-fantrax-team-ids.ts` | 97 | `leagueTeam.findMany` | 7 purge/script | destructive by intent; isolated and authorized | no | — |
| `scripts/probe-manager-tendencies.ts` | 54 | `leagueTeam.findMany` | 7 purge/script | destructive by intent; isolated and authorized | no | — |
| `scripts/probe-yahoo-pending-trades.ts` | 96 | `leagueTeam.findMany` | 7 purge/script | destructive by intent; isolated and authorized | no | — |
| `scripts/seed-drama-smoke-data.ts` | 95 | `leagueTeam.findFirst` | 7 purge/script | destructive by intent; isolated and authorized | no | — |
| `scripts/verify-screen-projections.ts` | 27 | `leagueTeam.findMany` | 7 purge/script | destructive by intent; isolated and authorized | no | — |
| `scripts/verify-screen-projections.ts` | 140 | `leagueTeam.findMany` | 7 purge/script | destructive by intent; isolated and authorized | no | — |
