# Game Day OS Caller Graph (Phase 33)

## `lib/shared-services/game-day/` itself

```
lib/shared-services/game-day/*
  ← lib/shared-services/commissioner/CommissionerContextAssembler.ts  (shadow-calls-shadow, itself uncalled)
  ← lib/shared-services/commissioner/types.ts                        (type import only)
  ← __tests__/shared-services/game-day/*.test.ts  (9 files, test-only)
  ← __tests__/shared-services/commissioner/commissioner-context-assembler.test.ts (test-only, transitive)

  NOT reachable from: any app/ route, any components/ file, any scripts/ cron job.
```

## The real engines Game Day OS wraps (their own, separate, real caller graphs)

```
server/services/matchupCenterService.ts :: buildMatchupCenterPayload()
  ← app/api/leagues/[leagueId]/matchup-center/route.ts   (real, live API route)
  ← app/api/leagues/[leagueId]/ai/matchup/route.ts        (real, live API route)
  ← components/matchup-center/MatchupTabContainer.tsx     (real, live UI, fetches the route above)
      ← MatchupHeaderCard.tsx, MatchupInsightsPanel.tsx, MatchupStarterRow.tsx, MatchupStartSitModal.tsx (real, live UI)
  ← lib/shared-services/game-day/GameDayContextAssembler.ts (this phase's audited module)

lib/lineup-actions/computeLineupActionsForUser.ts
  ← app/api/today/lineup-actions/route.ts                 (real, live API route)
  ← app/api/today/lineup-actions/[leagueId]/route.ts       (real, live API route)
  ← app/api/lineup-check/route.ts                          (real, live, deprecated-but-active route)
  ← lib/today-actions-engine/runTodayActions.ts             (real orchestration)
  ← lib/war-room-command-center/runWarRoomCommandCenter.ts   (real orchestration)
  ← lib/decision-os/lineup/shadow.ts                         (Decision OS, flag-gated live path)
  ← lib/shared-services/game-day/LineupAttentionService.ts   (this phase's audited module)

server/services/canonicalPlayerScores.ts :: loadCanonicalPlayerScores()
  ← server/services/matchupCenterService.ts (above)
  reads: WeeklyScore (materialized), PlayerWeeklyScore (raw), falls back to
         lib/redraft/scoringEngine.ts's calculateScoreFromSportConfig
```

## Reading this graph

Game Day OS's own module is a dead-end from a production-traffic perspective — it wraps two real, live, well-connected engines but is not itself wired into anything real. Any future "cutover" phase (making Game Day OS an actual consumer surface) would need to either replace one of the real routes above with a Game Day OS-backed implementation, or add a genuinely new real caller — neither has happened yet.
