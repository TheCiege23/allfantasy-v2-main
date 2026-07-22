/**
 * Repeatable League / Roster stubs for engine tests (trade, waiver, roster validation).
 * No database — use with `validateTradeAssets`, `resolveLeagueTradeSettings`, etc.
 */

import type { League, Roster } from '@prisma/client'
import type { MatchupCenterPayload, MatchupPlayerSlot } from '@/lib/matchup-center/types'

/**
 * Default in-season league row with trades enabled and no trade deadline week.
 * Override fields per scenario (guillotine, dynasty, tradeDeadlineWeek, etc.).
 */
function slot(
  playerId: string,
  overrides: Partial<MatchupPlayerSlot> = {},
): MatchupPlayerSlot {
  return {
    playerId,
    name: `Player ${playerId}`,
    position: 'RB',
    team: 'TST',
    opponent: null,
    headshotUrl: null,
    currentPoints: 0,
    projectedPoints: 10,
    hasRealProjection: true,
    injuryStatus: null,
    newsBlurb: null,
    weatherSummary: null,
    gameStatus: 'upcoming',
    gameLabel: 'Sun 1:00',
    aiInsight: null,
    ...overrides,
  }
}

/**
 * Valid `MatchupCenterPayload` for `assertValidMatchupPayload` / command-center UI tests.
 */
export function buildMinimalValidMatchupCenterPayload(
  over: Partial<MatchupCenterPayload> = {},
): MatchupCenterPayload {
  const leftStarters = [slot('p-left-1')]
  const rightStarters = [slot('p-right-1')]
  const base: MatchupCenterPayload = {
    leagueId: 'engine-test-league',
    season: 2026,
    week: 1,
    sport: 'NFL',
    matchupStatus: 'upcoming',
    conceptOverlay: null,
    left: {
      rosterId: 'r-left',
      teamName: 'Team Left',
      avatarUrl: null,
      record: { wins: 0, losses: 0, ties: 0 },
      winPct: 0,
      totalPoints: 0,
      projectedTotal: 90,
      starters: leftStarters,
      remainingStarters: 0,
    },
    right: {
      rosterId: 'r-right',
      teamName: 'Team Right',
      avatarUrl: null,
      record: { wins: 0, losses: 0, ties: 0 },
      winPct: 0,
      totalPoints: 0,
      projectedTotal: 88,
      starters: rightStarters,
      remainingStarters: 0,
    },
    winProbabilityLeft: 0.52,
    insights: {
      matchupEdge: 'Even matchup.',
      startSit: 'Start your studs.',
      weather: 'Clear.',
      injuryNews: 'No major flags.',
      swingPlayers: ['Player p-left-1'],
      riskLevel: 'medium',
      floorVsCeiling: 'Balanced floor and ceiling.',
    },
    partialData: false,
    refreshIntervalMs: 30_000,
    ...over,
  }
  return base
}

/** Survivor / high-churn league shell — override `guillotineMode` / lifecycle as needed. */
export function buildEngineTestLeagueSurvivor(over: Partial<League> = {}): League {
  return buildEngineTestLeague({
    leagueType: 'redraft',
    leagueSize: 14,
    guillotineMode: false,
    lifecycleState: 'in_season',
    ...over,
  })
}

/** Salary-cap format: FAAB-style economy hints for waiver/trade tests. */
export function buildEngineTestLeagueSalaryCap(over: Partial<League> = {}): League {
  return buildEngineTestLeague({
    waiverType: 'faab',
    waiverBudget: 200,
    leagueType: 'redraft',
    ...over,
  })
}

export function buildEngineTestLeague(over: Partial<League> = {}): League {
  return {
    id: 'l1',
    userId: 'u0',
    platform: 'manual',
    platformLeagueId: 'p1',
    name: 'L',
    sport: 'NFL',
    season: 2026,
    leagueSize: 12,
    scoring: null,
    isDynasty: false,
    rosterSize: 16,
    starters: null,
    status: 'in_season',
    avatarUrl: null,
    settings: {},
    presetKey: null,
    scoringPresetId: 'half_ppr',
    settingsSnapshotVersion: 1,
    lastSyncedAt: null,
    syncStatus: null,
    syncError: null,
    legacyLeagueId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    leagueVariant: null,
    importBatchId: null,
    importedAt: null,
    logoUrl: null,
    timezone: 'America/New_York',
    waiverType: 'rolling',
    waiverBudget: 100,
    waiverMinBid: 0,
    waiverClearAfterGames: true,
    waiverHours: 24,
    customDailyWaivers: false,
    waiverProcessTime: '02:00',
    waiverSchedule: null,
    tradeReviewHours: 48,
    tradeDeadlineWeek: null,
    draftPickTrading: true,
    playoffStartWeek: 14,
    playoffTeams: 4,
    playoffWeeksPerRound: 1,
    playoffSeedingRule: 'default',
    playoffLowerBracket: 'consolation',
    irSlots: 0,
    irAllowCovid: false,
    irAllowOut: true,
    irAllowSuspended: false,
    irAllowNA: false,
    irAllowDNR: false,
    irAllowDoubtful: false,
    leagueType: 'redraft',
    devyYear: null,
    medianGame: false,
    allowPreDraftMoves: true,
    preventBenchDrops: false,
    lockAllMoves: false,
    dispersalDraftRounds: 0,
    taxiSlots: 0,
    taxiAllowNonRookies: false,
    taxiYearsLimit: 2,
    taxiDeadlineWeek: 0,
    overrideInviteCapacity: false,
    disableInviteLinks: false,
    aiChimmyEnabled: true,
    aiWaiverSuggestions: false,
    aiTradeAnalysis: false,
    aiLineupHelp: false,
    aiDraftRecs: false,
    aiRecaps: false,
    leagueAiCommissionerAlerts: false,
    aiModeration: false,
    aiPowerRankings: false,
    isCommissioner: false,
    keeperCount: 3,
    keeperCostSystem: 'round_based',
    keeperMaxYears: 3,
    keeperWaiverAllowed: true,
    keeperEligibilityRule: 'any',
    keeperMinRoundsHeld: 0,
    keeperRoundPenalty: 1,
    keeperInflationRate: 1,
    keeperAuctionPctIncrease: 0.2,
    keeperSelectionDeadline: null,
    keeperPhaseActive: false,
    dynastySeasonPhase: 'regular',
    keeperConflictRule: 'player_chooses',
    keeperMissedDeadlineRule: 'auto_no_keepers',
    bestBallVariant: 'standard',
    bestBallMode: false,
    bbWaiversEnabled: false,
    bbTradesEnabled: false,
    bbFaEnabled: false,
    bbIrEnabled: false,
    bbTaxiEnabled: false,
    bbScoringPeriod: 'weekly',
    bbMatchupFormat: 'h2h',
    bbTiebreaker: 'points_for',
    bbOptimizerTiming: 'period_end',
    bbContestId: null,
    guillotineMode: false,
    guillotineEndgame: 'last_team_standing',
    guillotineEndgameThreshold: 1,
    guillotineEliminationsPerPeriod: 1,
    guillotineProtectedWeek1: false,
    guillotineAcceleratedWeeks: '[]',
    lifecycleState: 'in_season',
    ...over,
  } as League
}

export function buildEngineTestRoster(
  id: string,
  leagueId: string,
  userId: string,
  playerData: unknown,
  faab = 100,
): Roster {
  return {
    id,
    leagueId,
    platformUserId: userId,
    playerData,
    faabRemaining: faab,
    createdAt: new Date(),
    updatedAt: new Date(),
    waiverPriority: 1,
    settings: null,
    dispersalDraftPasses: false,
  } as Roster
}

/** Minimal player-for-player swap assets (IDs must exist on respective rosters). */
export function buildPlayerSwapTradeAssets(params: {
  proposerRosterId: string
  receiverRosterId: string
  proposerSendsPlayerId: string
  receiverSendsPlayerId: string
}) {
  return [
    {
      itemType: 'player' as const,
      itemReference: params.proposerSendsPlayerId,
      fromRosterId: params.proposerRosterId,
      toRosterId: params.receiverRosterId,
    },
    {
      itemType: 'player' as const,
      itemReference: params.receiverSendsPlayerId,
      fromRosterId: params.receiverRosterId,
      toRosterId: params.proposerRosterId,
    },
  ]
}
