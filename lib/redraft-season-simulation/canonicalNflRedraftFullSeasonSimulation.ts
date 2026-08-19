import type { CanonicalLeagueRules, CanonicalLeagueRuntimeEvent } from '@/lib/league-runtime'
import { toCanonicalLeagueRuntimeEvent } from '@/lib/league-runtime'
import {
  buildCanonicalDraftRuntimeState,
  buildDraftRuntimeEvent,
  getDraftOrderEntry,
  type DraftRuntimePick,
  type DraftRuntimeSlot,
} from '@/lib/draft-runtime/canonicalDraftRuntime'
import {
  buildCanonicalRosterRuntimeState,
  buildCanonicalRosterSectionsFromDraftedPlayers,
  buildRosterRuntimeEvent,
  type RosterRuntimePlayer,
  type RosterRuntimeSections,
} from '@/lib/roster-runtime/canonicalRosterRuntime'
import {
  buildCanonicalScheduleRuntimeState,
  buildScheduleGeneratedEvents,
  planCanonicalScheduleWeekTransition,
  type CanonicalScheduleRuntimeMatchup,
  type ScheduleRuntimeMatchupInput,
  type ScheduleRuntimeTeamInput,
} from '@/lib/schedule-runtime/canonicalScheduleRuntime'
import {
  buildNflRedraftLiveScoringRuntimeState,
  buildScoringRuntimeEvents,
  type NflRedraftRuntimePlayerInput,
  type NflRedraftRuntimeScoreInput,
  type NflRedraftRuntimeTeamInput,
  type NflRedraftLiveScoringRuntimeState,
} from '@/lib/scoring-runtime/canonicalNflRedraftScoringRuntime'
import {
  buildNflRedraftWaiverRuntimeState,
  processNflRedraftWaiverClaims,
  type NflRedraftWaiverPlayerInput,
  type NflRedraftWaiverProcessResult,
  type NflRedraftWaiverRosterInput,
  type NflRedraftWaiverTransactionInput,
} from '@/lib/waiver-runtime/canonicalNflRedraftWaiverRuntime'
import {
  buildNflRedraftTradeRuntimeState,
  buildTradeLifecycleEvents,
  executeNflRedraftTrade,
  validateNflRedraftTradeProposal,
  type NflRedraftTradeAssetInput,
  type NflRedraftTradeRosterInput,
} from '@/lib/trade-runtime/canonicalNflRedraftTradeRuntime'
import {
  advanceNflRedraftPlayoffRound,
  buildNflRedraftPlayoffRuntimeState,
  finalizeNflRedraftPlayoffChampion,
  generateNflRedraftPlayoffBracket,
  type NflRedraftPlayoffRuntimeState,
} from '@/lib/playoff-runtime/canonicalNflRedraftPlayoffRuntime'
import {
  buildNflRedraftCommunicationPlan,
  type NflRedraftCommunicationPlan,
} from '@/lib/league-notifications/nflRedraftCommunicationRuntime'

export const G43_FULL_SEASON_SIMULATION_VERSION = 'g43-nfl-redraft-full-season-v1' as const

type SimTeam = {
  rosterId: string
  displayName: string
  ownerId: string
  ownerName: string
  divisionId: string
  divisionName: string
  faabBalance: number
  waiverPriority: number
  sections: RosterRuntimeSections
}

export type G43SimulationRosterSummary = {
  rosterId: string
  displayName: string
  valid: boolean
  starters: string[]
  bench: string[]
}

export type G43SimulationWeekSummary = {
  week: number
  matchupScores: Array<{
    matchupId: string
    homeRosterId: string
    awayRosterId: string | null
    homeScore: number
    awayScore: number | null
    winnerRosterId: string | null
  }>
  standings: Array<{
    rosterId: string
    wins: number
    losses: number
    ties: number
    pointsFor: number
    playoffSeed: number
  }>
}

export type G43FullSeasonSimulationResult = {
  version: typeof G43_FULL_SEASON_SIMULATION_VERSION
  rules: CanonicalLeagueRules
  draft: {
    completed: boolean
    pickCount: number
    uniqueDraftedPlayerCount: number
  }
  rosterSummaries: G43SimulationRosterSummary[]
  schedule: {
    generated: boolean
    regularSeasonWeeks: number
    matchups: Array<{ id: string; week: number; homeRosterId: string; awayRosterId: string | null }>
  }
  weeklyResults: G43SimulationWeekSummary[]
  waiver: {
    processed: boolean
    results: NflRedraftWaiverProcessResult[]
    addedPlayerId: string
    droppedPlayerId: string
  }
  trade: {
    processed: boolean
    proposalId: string
    movedPlayerIds: string[]
  }
  playoffs: {
    generated: boolean
    seeds: Array<{ seed: number; rosterId: string }>
    championRosterId: string
    runnerUpRosterId: string | null
    finalStandings: Array<{ finish: number; rosterId: string; champion: boolean }>
  }
  leagueHistory: {
    championRosterId: string
    championName: string
    season: number
    completedAtIso: string
    finalStandingsRecorded: boolean
  }
  communication: {
    notificationCount: number
    feedCount: number
    chatCount: number
    eventTypes: string[]
  }
  events: CanonicalLeagueRuntimeEvent[]
  communicationPlans: NflRedraftCommunicationPlan[]
  invariants: {
    rostersValidAfterDraft: boolean
    scheduleReferencesRealTeams: boolean
    scoringUsesOnlyStarters: boolean
    standingsUpdated: boolean
    waiverUpdatedRosters: boolean
    tradeUpdatedRosters: boolean
    playoffSeedsDerivedFromStandings: boolean
    bracketAdvanced: boolean
    championCrowned: boolean
    finalHistoryRecorded: boolean
    notificationsCreated: boolean
    noDuplicatePlayers: boolean
    canonicalEventsEmitted: boolean
  }
}

const leagueId = 'g43-full-season-league'
const seasonId = 'g43-season-2026'
const commissionerUserId = 'commissioner-g43'
const simulationNow = new Date('2026-07-02T12:00:00.000Z')

const slotOrder: DraftRuntimeSlot[] = [
  { slot: 1, rosterId: 'alpha', displayName: 'Alpha Storm', userId: 'user-alpha' },
  { slot: 2, rosterId: 'bravo', displayName: 'Bravo Blitz', userId: 'user-bravo' },
  { slot: 3, rosterId: 'charlie', displayName: 'Charlie Routes', userId: 'user-charlie' },
  { slot: 4, rosterId: 'delta', displayName: 'Delta Rush', userId: 'user-delta' },
]

const baseTeamMeta = [
  { rosterId: 'alpha', displayName: 'Alpha Storm', ownerId: 'user-alpha', ownerName: 'Ava', divisionId: 'east', divisionName: 'East' },
  { rosterId: 'bravo', displayName: 'Bravo Blitz', ownerId: 'user-bravo', ownerName: 'Ben', divisionId: 'east', divisionName: 'East' },
  { rosterId: 'charlie', displayName: 'Charlie Routes', ownerId: 'user-charlie', ownerName: 'Cora', divisionId: 'west', divisionName: 'West' },
  { rosterId: 'delta', displayName: 'Delta Rush', ownerId: 'user-delta', ownerName: 'Drew', divisionId: 'west', divisionName: 'West' },
] as const

const draftedByRoster: Record<string, Array<Omit<RosterRuntimePlayer, 'acquisitionType'>>> = {
  alpha: [
    { playerId: 'alpha-qb', playerName: 'Alpha QB', position: 'QB', team: 'BUF' },
    { playerId: 'alpha-rb1', playerName: 'Alpha RB1', position: 'RB', team: 'ATL' },
    { playerId: 'alpha-wr1', playerName: 'Alpha WR1', position: 'WR', team: 'LAR' },
    { playerId: 'alpha-te', playerName: 'Alpha TE', position: 'TE', team: 'ARI' },
    { playerId: 'alpha-rb2', playerName: 'Alpha Flex RB', position: 'RB', team: 'DET' },
    { playerId: 'alpha-k', playerName: 'Alpha K', position: 'K', team: 'DAL' },
    { playerId: 'alpha-def', playerName: 'Alpha D/ST', position: 'DEF', team: 'NYJ' },
    { playerId: 'alpha-bench-wr', playerName: 'Alpha Bench WR', position: 'WR', team: 'NO' },
  ],
  bravo: [
    { playerId: 'bravo-qb', playerName: 'Bravo QB', position: 'QB', team: 'KC' },
    { playerId: 'bravo-rb1', playerName: 'Bravo RB1', position: 'RB', team: 'SEA' },
    { playerId: 'bravo-wr1', playerName: 'Bravo WR1', position: 'WR', team: 'CIN' },
    { playerId: 'bravo-te', playerName: 'Bravo TE', position: 'TE', team: 'BAL' },
    { playerId: 'bravo-rb2', playerName: 'Bravo Flex RB', position: 'RB', team: 'CHI' },
    { playerId: 'bravo-k', playerName: 'Bravo K', position: 'K', team: 'PHI' },
    { playerId: 'bravo-def', playerName: 'Bravo D/ST', position: 'DEF', team: 'SF' },
    { playerId: 'bravo-bench-wr', playerName: 'Bravo Bench WR', position: 'WR', team: 'TB' },
  ],
  charlie: [
    { playerId: 'charlie-qb', playerName: 'Charlie QB', position: 'QB', team: 'HOU' },
    { playerId: 'charlie-rb1', playerName: 'Charlie RB1', position: 'RB', team: 'NYJ' },
    { playerId: 'charlie-wr1', playerName: 'Charlie WR1', position: 'WR', team: 'MIN' },
    { playerId: 'charlie-te', playerName: 'Charlie TE', position: 'TE', team: 'LV' },
    { playerId: 'charlie-rb2', playerName: 'Charlie Flex RB', position: 'RB', team: 'LAC' },
    { playerId: 'charlie-k', playerName: 'Charlie K', position: 'K', team: 'MIA' },
    { playerId: 'charlie-def', playerName: 'Charlie D/ST', position: 'DEF', team: 'PIT' },
    { playerId: 'charlie-bench-wr', playerName: 'Charlie Bench WR', position: 'WR', team: 'WAS' },
  ],
  delta: [
    { playerId: 'delta-qb', playerName: 'Delta QB', position: 'QB', team: 'PHI' },
    { playerId: 'delta-rb1', playerName: 'Delta RB1', position: 'RB', team: 'GB' },
    { playerId: 'delta-wr1', playerName: 'Delta WR1', position: 'WR', team: 'DET' },
    { playerId: 'delta-te', playerName: 'Delta TE', position: 'TE', team: 'BUF' },
    { playerId: 'delta-rb2', playerName: 'Delta Flex RB', position: 'RB', team: 'DAL' },
    { playerId: 'delta-k', playerName: 'Delta K', position: 'K', team: 'CLE' },
    { playerId: 'delta-def', playerName: 'Delta D/ST', position: 'DEF', team: 'CLE' },
    { playerId: 'delta-bench-wr', playerName: 'Delta Bench WR', position: 'WR', team: 'DEN' },
  ],
}

const freeAgents: NflRedraftWaiverPlayerInput[] = [
  { playerId: 'waiver-rb', playerName: 'Waiver Runner', position: 'RB', team: 'CAR', sport: 'NFL', slotType: 'BENCH' },
  { playerId: 'waiver-wr', playerName: 'Waiver Wideout', position: 'WR', team: 'JAX', sport: 'NFL', slotType: 'BENCH' },
]

function buildRules(): CanonicalLeagueRules {
  return {
    version: 1,
    leagueId,
    generatedAtIso: simulationNow.toISOString(),
    source: {
      commissionerSettings: 'League',
      draftSettings: 'LeagueSettings',
      effectiveResolvers: ['draft', 'draftUi', 'scoring', 'waivers', 'playoffs', 'schedule'],
      settingsSnapshotVersion: 8,
      presetKey: 'af:v2|concept=redraft|sport=NFL',
    },
    general: {
      name: 'G43 Full Season NFL Redraft',
      sport: 'NFL',
      season: 2026,
      format: 'redraft',
      variant: null,
      teamCount: 4,
      rosterSize: 8,
      lifecycleState: 'active',
      status: 'active',
      locked: false,
      emergencyPaused: false,
      timezone: 'America/New_York',
      language: 'en',
    },
    draft: {
      type: 'snake',
      rounds: 8,
      timerSeconds: 90,
      slowTimerSeconds: 3600,
      timerMode: 'per_pick',
      scheduledAtIso: '2026-08-20T23:00:00.000Z',
      orderMethod: 'manual',
      orderLocked: true,
      pickOrderRules: 'snake',
      thirdRoundReversal: false,
      autoPickEnabled: true,
      cpuAutoPick: true,
      commissionerForceAutoPickEnabled: true,
      pickTradingEnabled: true,
      importEnabled: true,
      executionMode: 'live',
      playerPool: 'all',
      rosterFillOrder: 'starter_first',
      positionFilterBehavior: 'by_eligibility',
    },
    scoring: {
      templateId: 'nfl_half_ppr',
      presetId: 'nfl_half_ppr',
      formatType: 'redraft',
      sport: 'NFL',
      activeRuleCount: 0,
      overriddenRuleCount: 0,
      activeRules: [],
    },
    roster: {
      size: 8,
      starters: ['QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DEF'],
      irSlots: 0,
      eligibleReserveStatuses: [],
      allowPreDraftMoves: true,
      preventBenchDrops: false,
      lockAllMoves: false,
    },
    waivers: {
      type: 'faab',
      continuous: false,
      processingDays: [3],
      processingTimeUtc: '10:00',
      processingTimeLocal: '06:00',
      claimLimitPerPeriod: null,
      maxClaimsPerPeriod: null,
      priorityBehavior: 'rolling',
      gameLockBehavior: 'per_player',
      dropLockBehavior: 'locked_after_kickoff',
      freeAgentUnlockBehavior: 'after_clear',
      sameDayAddDropRules: null,
      faabEnabled: true,
      faabBudget: 100,
      faabMinBid: 1,
      faabResetRules: null,
      tiebreakRule: 'waiver_priority',
      instantFreeAgencyAfterClear: true,
    },
    trades: { reviewHours: 24, deadlineWeek: 10, draftPickTrading: true },
    playoffs: {
      teamCount: 2,
      startWeek: 4,
      startPoint: 4,
      weeksPerRound: 1,
      firstRoundByes: 0,
      bracketType: 'single_elimination',
      matchupLength: 1,
      totalRounds: 1,
      consolationBracketEnabled: true,
      thirdPlaceGameEnabled: false,
      toiletBowlEnabled: false,
      championshipLength: 1,
      consolationPlaysFor: 'final_standings',
      seedingRules: 'standings',
      tiebreakerRules: ['win_pct', 'wins', 'points_for', 'points_against'],
      byeRules: 'top_seed_byes',
      reseedBehavior: 'none',
      standingsTiebreakers: ['win_pct', 'wins', 'points_for', 'points_against'],
    },
    schedule: {
      unit: 'week',
      regularSeasonLength: 3,
      matchupFrequency: 'weekly',
      matchupCadence: 'weekly',
      generationStrategy: 'round_robin',
      playoffTransitionPoint: 4,
      headToHeadBehavior: 'standard',
      lockTimeBehavior: 'per_player_kickoff',
      lockWindowBehavior: 'nfl_week',
      scoringPeriodBehavior: 'weekly',
      rescheduleHandling: null,
      doubleheaderHandling: null,
    },
    permissions: {
      settingsEditableByRoles: ['commissioner', 'co_commissioner'],
      memberMovesLocked: false,
      inviteLinksDisabled: false,
      inviteCapacityOverride: false,
    },
    intelligence: {
      chimmyHelperEnabled: false,
      managerIntelligence: {
        requiredPlan: 'pro',
        requiredFeatures: [],
        leagueToggles: [],
      },
      commissionerIntelligence: {
        requiredPlan: 'commissioner',
        requiredFeatures: [],
        enabledLeagueSettings: [],
        lockedWithoutEntitlement: [],
      },
      automation: {
        commissionerShortcutsEnabled: false,
        weeklyLeagueReportEnabled: false,
      },
    },
  } as CanonicalLeagueRules
}

function draftedPlayerFor(rosterId: string, pickIndexForRoster: number): Omit<RosterRuntimePlayer, 'acquisitionType'> {
  const player = draftedByRoster[rosterId]?.[pickIndexForRoster]
  if (!player) throw new Error(`Missing drafted player ${rosterId} ${pickIndexForRoster}`)
  return player
}

function buildDraftPicks(): DraftRuntimePick[] {
  const byRosterPickCount = new Map<string, number>()
  const picks: DraftRuntimePick[] = []
  for (let overall = 1; overall <= 32; overall += 1) {
    const order = getDraftOrderEntry({
      overall,
      teamCount: 4,
      draftType: 'snake',
      thirdRoundReversal: false,
      slotOrder,
    })
    const pickIndex = byRosterPickCount.get(order.rosterId) ?? 0
    const player = draftedPlayerFor(order.rosterId, pickIndex)
    byRosterPickCount.set(order.rosterId, pickIndex + 1)
    picks.push({
      overall,
      round: order.round,
      slot: order.slot,
      rosterId: order.rosterId,
      playerId: player.playerId,
      playerName: player.playerName,
      position: player.position,
      team: player.team,
      source: 'user',
      createdAtIso: new Date(simulationNow.getTime() + overall * 1000).toISOString(),
    })
  }
  return picks
}

function buildTeamsFromDraft(rules: CanonicalLeagueRules, picks: DraftRuntimePick[]): SimTeam[] {
  return baseTeamMeta.map((team, index) => {
    const rosterPicks = picks
      .filter((pick) => pick.rosterId === team.rosterId)
      .sort((a, b) => a.overall - b.overall)
      .map((pick) => ({ ...pick, acquisitionType: 'draft' }))
    const sections = buildCanonicalRosterSectionsFromDraftedPlayers({ rules, draftedPlayers: rosterPicks })
    return {
      ...team,
      faabBalance: 100,
      waiverPriority: index + 1,
      sections,
    }
  })
}

function slotTypeFor(section: 'starters' | 'bench' | 'ir', player: RosterRuntimePlayer): string {
  if (section === 'bench') return 'BENCH'
  if (section === 'ir') return 'IR'
  return player.position === 'DST' ? 'DEF' : player.position
}

function flatPlayers(team: SimTeam): NflRedraftWaiverPlayerInput[] {
  return (['starters', 'bench', 'ir'] as const).flatMap((section) =>
    team.sections[section].map((player) => ({
      playerId: player.playerId,
      playerName: player.playerName,
      position: player.position,
      team: player.team,
      sport: 'NFL',
      slotType: slotTypeFor(section, player),
      acquisitionType: player.acquisitionType,
    })),
  )
}

function teamsToWaiverRosters(teams: SimTeam[]): NflRedraftWaiverRosterInput[] {
  return teams.map((team) => ({
    rosterId: team.rosterId,
    displayName: team.displayName,
    ownerId: team.ownerId,
    ownerName: team.ownerName,
    faabBalance: team.faabBalance,
    waiverPriority: team.waiverPriority,
    players: flatPlayers(team),
  }))
}

function teamsToTradeRosters(teams: SimTeam[]): NflRedraftTradeRosterInput[] {
  return teamsToWaiverRosters(teams)
}

function teamsToScheduleTeams(teams: SimTeam[]): ScheduleRuntimeTeamInput[] {
  return teams.map((team) => ({
    rosterId: team.rosterId,
    displayName: team.displayName,
    ownerName: team.ownerName,
    divisionId: team.divisionId,
    divisionName: team.divisionName,
  }))
}

function playerFromFlat(player: NflRedraftWaiverPlayerInput): RosterRuntimePlayer {
  return {
    playerId: player.playerId,
    playerName: player.playerName,
    position: player.position,
    team: player.team,
    status: player.injuryStatus,
    acquisitionType: player.acquisitionType,
  }
}

function sectionsFromFlat(players: NflRedraftWaiverPlayerInput[]): RosterRuntimeSections {
  return {
    starters: players.filter((player) => !['bench', 'bn', 'ir', 'reserve'].includes(String(player.slotType ?? '').toLowerCase())).map(playerFromFlat),
    bench: players.filter((player) => ['bench', 'bn'].includes(String(player.slotType ?? '').toLowerCase())).map(playerFromFlat),
    ir: players.filter((player) => ['ir', 'reserve'].includes(String(player.slotType ?? '').toLowerCase())).map(playerFromFlat),
  }
}

function updateTeamsFromFlat(baseTeams: SimTeam[], rows: NflRedraftWaiverRosterInput[]): SimTeam[] {
  return baseTeams.map((team) => {
    const row = rows.find((entry) => entry.rosterId === team.rosterId)
    if (!row) return team
    return {
      ...team,
      faabBalance: row.faabBalance ?? team.faabBalance,
      waiverPriority: row.waiverPriority ?? team.waiverPriority,
      sections: sectionsFromFlat(row.players),
    }
  })
}

function scoringTeams(teams: SimTeam[]): NflRedraftRuntimeTeamInput[] {
  return teams.map((team) => ({
    rosterId: team.rosterId,
    displayName: team.displayName,
    ownerName: team.ownerName,
    divisionId: team.divisionId,
    divisionName: team.divisionName,
    players: flatPlayers(team).map((player): NflRedraftRuntimePlayerInput => ({
      rosterId: team.rosterId,
      playerId: player.playerId,
      playerName: player.playerName,
      position: player.position,
      team: player.team,
      slotType: player.slotType ?? 'BENCH',
    })),
  }))
}

function scoreStats(player: NflRedraftRuntimePlayerInput, strength: number, week: number): Record<string, number> {
  const boost = strength + week
  switch (player.position.toUpperCase()) {
    case 'QB':
      return { pass_yds: 12 * boost, pass_td: Math.floor(boost / 8), pass_int: boost % 5 === 0 ? 1 : 0 }
    case 'RB':
      return { rush_yds: 5 * boost, rush_td: boost % 3 === 0 ? 1 : 0, rec: 2, rec_yds: 3 * week }
    case 'WR':
      return { rec: 3 + (boost % 3), rec_yds: 4 * boost, rec_td: boost % 4 === 0 ? 1 : 0 }
    case 'TE':
      return { rec: 2 + (week % 2), rec_yds: 3 * boost }
    case 'K':
      return { fg_0_39: 1 + (boost % 2), xp_made: 2 }
    case 'DEF':
      return { def_sack: 1 + (boost % 4), def_int: boost % 2, def_points_allowed: 10 }
    default:
      return { rec: 1, rec_yds: boost }
  }
}

function strengthFor(rosterId: string, week: number): number {
  const strengths: Record<number, Record<string, number>> = {
    1: { alpha: 22, bravo: 15, charlie: 24, delta: 12 },
    2: { alpha: 16, bravo: 20, charlie: 25, delta: 13 },
    3: { alpha: 26, bravo: 17, charlie: 19, delta: 14 },
    4: { alpha: 30, bravo: 18, charlie: 28, delta: 16 },
  }
  return strengths[week]?.[rosterId] ?? 15
}

function buildScoreRows(teams: SimTeam[], week: number): NflRedraftRuntimeScoreInput[] {
  return scoringTeams(teams).flatMap((team) =>
    team.players.map((player) => ({
      playerId: player.playerId,
      sport: 'NFL',
      stats: scoreStats(player, strengthFor(team.rosterId, week), week),
      isFinalized: true,
      source: G43_FULL_SEASON_SIMULATION_VERSION,
      updatedAtIso: new Date(simulationNow.getTime() + week * 86_400_000).toISOString(),
    })),
  )
}

function scoringMatchups(matchups: CanonicalScheduleRuntimeMatchup[], week: number) {
  return matchups
    .filter((matchup) => matchup.week === week)
    .map((matchup) => ({
      matchupId: matchup.id,
      week,
      homeRosterId: matchup.homeRosterId,
      awayRosterId: matchup.awayRosterId,
      status: 'scheduled',
    }))
}

function scoreWeek(input: {
  rules: CanonicalLeagueRules
  teams: SimTeam[]
  scheduleMatchups: CanonicalScheduleRuntimeMatchup[]
  week: number
  events: CanonicalLeagueRuntimeEvent[]
}): NflRedraftLiveScoringRuntimeState {
  const state = buildNflRedraftLiveScoringRuntimeState({
    leagueId,
    seasonId,
    season: 2026,
    week: input.week,
    rules: input.rules,
    teams: scoringTeams(input.teams),
    matchups: scoringMatchups(input.scheduleMatchups, input.week),
    scoreRows: buildScoreRows(input.teams, input.week),
    now: new Date(simulationNow.getTime() + input.week * 86_400_000),
  })
  input.events.push(...buildScoringRuntimeEvents({ state, actorUserId: commissionerUserId, includePlayerEvents: true }))
  return state
}

function appendScheduleScores(existing: ScheduleRuntimeMatchupInput[], scoring: NflRedraftLiveScoringRuntimeState): ScheduleRuntimeMatchupInput[] {
  const byId = new Map(existing.map((matchup) => [matchup.id ?? '', matchup]))
  for (const matchup of scoring.matchups) {
    const current = byId.get(matchup.matchupId)
    byId.set(matchup.matchupId, {
      ...(current ?? {}),
      id: matchup.matchupId,
      week: matchup.week,
      homeRosterId: matchup.homeRosterId,
      awayRosterId: matchup.awayRosterId,
      homeScore: matchup.homeScore,
      awayScore: matchup.awayScore,
      status: matchup.complete ? 'final' : matchup.status,
      type: 'regular',
    })
  }
  return [...byId.values()].sort((a, b) => a.week - b.week || String(a.id).localeCompare(String(b.id)))
}

function scoreActiveRound(state: NflRedraftPlayoffRuntimeState, baseScore: number): NflRedraftPlayoffRuntimeState {
  return {
    ...state,
    bracket: {
      ...state.bracket,
      rounds: state.bracket.rounds.map((round) =>
        round.status === 'active'
          ? {
              ...round,
              matchups: round.matchups.map((matchup, index) =>
                matchup.bye
                  ? matchup
                  : {
                      ...matchup,
                      homeScore: baseScore + index + (matchup.homeSeed === 1 ? 5 : 0),
                      awayScore: baseScore - 6 - index,
                      status: 'final',
                    },
              ),
            }
          : round,
      ),
    },
  }
}

function simulationEvent(type: string, payload: Record<string, unknown> = {}): CanonicalLeagueRuntimeEvent {
  return toCanonicalLeagueRuntimeEvent({
    leagueId,
    eventType: type,
    actorUserId: commissionerUserId,
    createdAt: simulationNow,
    payload,
  })
}

function communicationPlans(events: CanonicalLeagueRuntimeEvent[]): NflRedraftCommunicationPlan[] {
  const selected = events.filter((event) =>
    [
      'draft.completed',
      'schedule.generated',
      'waiver.processed',
      'trade.processed',
      'matchup.finalized',
      'playoffs.bracket.generated',
      'playoffs.champion.crowned',
      'season.completed',
    ].includes(event.type),
  )
  return selected.map((event) =>
    buildNflRedraftCommunicationPlan({
      event,
      leagueName: 'G43 Full Season NFL Redraft',
      audience: baseTeamMeta.map((team) => ({ userId: team.ownerId, teamId: team.rosterId })),
      now: simulationNow,
    }),
  )
}

function rosterSummaries(rules: CanonicalLeagueRules, teams: SimTeam[]): G43SimulationRosterSummary[] {
  const rosterState = buildCanonicalRosterRuntimeState({
    rules,
    teams: teams.map((team) => ({ rosterId: team.rosterId, displayName: team.displayName, sections: team.sections })),
    scoringWeek: 1,
    now: simulationNow,
  })
  return rosterState.teams.map((team) => ({
    rosterId: team.rosterId,
    displayName: team.displayName ?? team.rosterId,
    valid: team.validation.ok,
    starters: team.sections.starters.map((player) => player.playerId),
    bench: team.sections.bench.map((player) => player.playerId),
  }))
}

function duplicatePlayerIds(teams: SimTeam[]): string[] {
  const seen = new Set<string>()
  const dupes = new Set<string>()
  for (const team of teams) {
    for (const player of flatPlayers(team)) {
      if (seen.has(player.playerId)) dupes.add(player.playerId)
      seen.add(player.playerId)
    }
  }
  return [...dupes]
}

export function runNflRedraftFullSeasonSimulation(): G43FullSeasonSimulationResult {
  const rules = buildRules()
  const events: CanonicalLeagueRuntimeEvent[] = [
    simulationEvent('league.created'),
    simulationEvent('settings.updated'),
    simulationEvent('draft.scheduled'),
    simulationEvent('draft.started'),
  ]
  const picks = buildDraftPicks()
  const draftState = buildCanonicalDraftRuntimeState({
    rules,
    session: {
      id: 'g43-draft',
      leagueId,
      status: 'completed',
      draftType: 'snake',
      rounds: 8,
      teamCount: 4,
      thirdRoundReversal: false,
      timerSeconds: 90,
      timerEndAtIso: null,
      pausedRemainingSeconds: null,
      slotOrder,
      picks,
      scheduledAtIso: rules.draft.scheduledAtIso,
      version: 1,
      updatedAtIso: simulationNow.toISOString(),
    },
    now: simulationNow,
  })
  events.push(
    ...picks.map((pick) =>
      buildDraftRuntimeEvent({
        leagueId,
        type: 'draft.pick',
        occurredAt: pick.createdAtIso,
        actorUserId: `user-${pick.rosterId}`,
        payload: { rosterId: pick.rosterId, playerId: pick.playerId, playerName: pick.playerName, overall: pick.overall },
      }),
    ),
    buildDraftRuntimeEvent({
      leagueId,
      type: 'draft.completed',
      occurredAt: simulationNow,
      actorUserId: commissionerUserId,
      payload: { pickCount: picks.length },
    }),
  )

  let teams = buildTeamsFromDraft(rules, picks)
  const afterDraftRosterSummaries = rosterSummaries(rules, teams)
  events.push(
    ...teams.flatMap((team) =>
      team.sections.starters.map((player) =>
        buildRosterRuntimeEvent({
          leagueId,
          type: 'roster.player.started',
          actorUserId: team.ownerId,
          payload: { rosterId: team.rosterId, playerId: player.playerId },
        }),
      ),
    ),
  )

  const scheduleState = buildCanonicalScheduleRuntimeState({
    rules,
    teams: teamsToScheduleTeams(teams),
    currentWeek: 1,
    status: 'active',
    now: simulationNow,
  })
  events.push(...buildScheduleGeneratedEvents({ state: scheduleState, actorUserId: commissionerUserId }))

  const scheduleMatchups = scheduleState.weeks.flatMap((week) => week.matchups)
  const completedScheduleRows: ScheduleRuntimeMatchupInput[] = []
  const weeklyResults: G43SimulationWeekSummary[] = []

  const weekOne = scoreWeek({ rules, teams, scheduleMatchups, week: 1, events })
  completedScheduleRows.push(...appendScheduleScores([], weekOne))
  let recalculatedSchedule = buildCanonicalScheduleRuntimeState({
    rules,
    teams: teamsToScheduleTeams(teams),
    persistedMatchups: completedScheduleRows,
    currentWeek: 1,
    status: 'active',
  })
  const weekOneTransition = planCanonicalScheduleWeekTransition({
    state: recalculatedSchedule,
    action: 'advance_week',
    week: 1,
    draftCompleted: draftState.status === 'completed',
    rosterReady: afterDraftRosterSummaries.every((row) => row.valid),
    actorUserId: commissionerUserId,
  })
  if (weekOneTransition.ok) events.push(...weekOneTransition.events)
  weeklyResults.push({
    week: 1,
    matchupScores: weekOne.matchups.map((matchup) => ({
      matchupId: matchup.matchupId,
      homeRosterId: matchup.homeRosterId,
      awayRosterId: matchup.awayRosterId,
      homeScore: matchup.homeScore,
      awayScore: matchup.awayScore,
      winnerRosterId: matchup.winnerRosterId,
    })),
    standings: recalculatedSchedule.standings.map((row) => ({
      rosterId: row.rosterId,
      wins: row.wins,
      losses: row.losses,
      ties: row.ties,
      pointsFor: row.pointsFor,
      playoffSeed: row.playoffSeed,
    })),
  })

  const waiverState = buildNflRedraftWaiverRuntimeState({
    leagueId,
    seasonId,
    season: 2026,
    week: 2,
    rules,
    rosters: teamsToWaiverRosters(teams),
    claims: [
      {
        claimId: 'g43-alpha-waiver',
        rosterId: 'alpha',
        addPlayerId: 'waiver-rb',
        addPlayerName: 'Waiver Runner',
        addPlayerPosition: 'RB',
        addPlayerTeam: 'CAR',
        dropPlayerId: 'alpha-bench-wr',
        dropPlayerName: 'Alpha Bench WR',
        bidAmount: 11,
        priority: 1,
        conditionalRank: 1,
        status: 'pending',
        submittedAtIso: '2026-09-10T10:00:00.000Z',
        actorUserId: 'user-alpha',
      },
    ],
    transactions: [],
    freeAgents,
    now: simulationNow,
  })
  const waiverProcessed = processNflRedraftWaiverClaims({ state: waiverState, actorUserId: commissionerUserId, now: simulationNow })
  teams = updateTeamsFromFlat(teams, waiverProcessed.teams)
  events.push(...waiverProcessed.events)

  const weekTwo = scoreWeek({ rules, teams, scheduleMatchups, week: 2, events })
  const throughWeekTwoRows = appendScheduleScores(completedScheduleRows, weekTwo)
  completedScheduleRows.length = 0
  completedScheduleRows.push(...throughWeekTwoRows)
  recalculatedSchedule = buildCanonicalScheduleRuntimeState({
    rules,
    teams: teamsToScheduleTeams(teams),
    persistedMatchups: completedScheduleRows,
    currentWeek: 2,
    status: 'active',
  })
  const weekTwoTransition = planCanonicalScheduleWeekTransition({
    state: recalculatedSchedule,
    action: 'advance_week',
    week: 2,
    draftCompleted: true,
    rosterReady: rosterSummaries(rules, teams).every((row) => row.valid),
    actorUserId: commissionerUserId,
  })
  if (weekTwoTransition.ok) events.push(...weekTwoTransition.events)
  weeklyResults.push({
    week: 2,
    matchupScores: weekTwo.matchups.map((matchup) => ({
      matchupId: matchup.matchupId,
      homeRosterId: matchup.homeRosterId,
      awayRosterId: matchup.awayRosterId,
      homeScore: matchup.homeScore,
      awayScore: matchup.awayScore,
      winnerRosterId: matchup.winnerRosterId,
    })),
    standings: recalculatedSchedule.standings.map((row) => ({
      rosterId: row.rosterId,
      wins: row.wins,
      losses: row.losses,
      ties: row.ties,
      pointsFor: row.pointsFor,
      playoffSeed: row.playoffSeed,
    })),
  })

  const tradeAssets: NflRedraftTradeAssetInput[] = [
    { fromRosterId: 'alpha', toRosterId: 'bravo', assetType: 'player', playerId: 'waiver-rb', playerName: 'Waiver Runner' },
    { fromRosterId: 'bravo', toRosterId: 'alpha', assetType: 'player', playerId: 'bravo-bench-wr', playerName: 'Bravo Bench WR' },
    { fromRosterId: 'alpha', toRosterId: 'bravo', assetType: 'faab', metadata: { amount: 4 } },
  ]
  const tradeState = buildNflRedraftTradeRuntimeState({
    leagueId,
    seasonId,
    season: 2026,
    week: 3,
    rules,
    rosters: teamsToTradeRosters(teams),
    proposals: [
      {
        proposalId: 'g43-trade-alpha-bravo',
        proposerRosterId: 'alpha',
        receiverRosterId: 'bravo',
        status: 'pending',
        vetoMode: 'commissioner',
        vetoThreshold: 2,
        createdAtIso: '2026-09-17T12:00:00.000Z',
        expiresAtIso: '2026-09-18T12:00:00.000Z',
        assets: tradeAssets,
      },
    ],
    activeRosterLimit: rules.roster.size,
    now: simulationNow,
  })
  const tradeValidation = validateNflRedraftTradeProposal({
    state: tradeState,
    proposerRosterId: 'alpha',
    receiverRosterId: 'bravo',
    assets: tradeAssets,
  })
  if (!tradeValidation.ok) throw new Error(`G43 trade validation failed: ${tradeValidation.code}`)
  events.push(
    ...buildTradeLifecycleEvents({
      state: tradeState,
      proposalId: 'g43-trade-alpha-bravo',
      type: 'proposed',
      actorUserId: 'user-alpha',
      now: simulationNow,
    }),
  )
  const tradeProcessed = executeNflRedraftTrade({
    state: tradeState,
    proposalId: 'g43-trade-alpha-bravo',
    actorUserId: 'user-bravo',
    now: simulationNow,
  })
  if (!tradeProcessed.ok) throw new Error('G43 trade execution failed')
  teams = updateTeamsFromFlat(teams, tradeProcessed.teams)
  events.push(...tradeProcessed.events)

  const weekThree = scoreWeek({ rules, teams, scheduleMatchups, week: 3, events })
  const throughWeekThreeRows = appendScheduleScores(completedScheduleRows, weekThree)
  completedScheduleRows.length = 0
  completedScheduleRows.push(...throughWeekThreeRows)
  recalculatedSchedule = buildCanonicalScheduleRuntimeState({
    rules,
    teams: teamsToScheduleTeams(teams),
    persistedMatchups: completedScheduleRows,
    currentWeek: 3,
    status: 'active',
  })
  const weekThreeTransition = planCanonicalScheduleWeekTransition({
    state: recalculatedSchedule,
    action: 'advance_week',
    week: 3,
    draftCompleted: true,
    rosterReady: rosterSummaries(rules, teams).every((row) => row.valid),
    actorUserId: commissionerUserId,
  })
  if (weekThreeTransition.ok) events.push(...weekThreeTransition.events)
  weeklyResults.push({
    week: 3,
    matchupScores: weekThree.matchups.map((matchup) => ({
      matchupId: matchup.matchupId,
      homeRosterId: matchup.homeRosterId,
      awayRosterId: matchup.awayRosterId,
      homeScore: matchup.homeScore,
      awayScore: matchup.awayScore,
      winnerRosterId: matchup.winnerRosterId,
    })),
    standings: recalculatedSchedule.standings.map((row) => ({
      rosterId: row.rosterId,
      wins: row.wins,
      losses: row.losses,
      ties: row.ties,
      pointsFor: row.pointsFor,
      playoffSeed: row.playoffSeed,
    })),
  })

  const playoffTeams = recalculatedSchedule.standings.map((standing) => {
    const team = teams.find((row) => row.rosterId === standing.rosterId)
    return {
      rosterId: standing.rosterId,
      displayName: standing.displayName,
      ownerId: team?.ownerId,
      ownerName: team?.ownerName,
      divisionId: standing.divisionId,
      wins: standing.wins,
      losses: standing.losses,
      ties: standing.ties,
      pointsFor: standing.pointsFor,
      pointsAgainst: standing.pointsAgainst,
      divisionWins: standing.divisionWins,
      divisionLosses: standing.divisionLosses,
      divisionTies: standing.divisionTies,
    }
  })
  const playoffState = buildNflRedraftPlayoffRuntimeState({
    leagueId,
    seasonId,
    season: 2026,
    week: 4,
    rules,
    teams: playoffTeams,
    now: simulationNow,
  })
  const bracket = generateNflRedraftPlayoffBracket({ state: playoffState, actorUserId: commissionerUserId, lockBracket: true })
  events.push(...bracket.events)
  let activePlayoffs: NflRedraftPlayoffRuntimeState = { ...playoffState, bracket: bracket.bracket }
  const advanced = advanceNflRedraftPlayoffRound({
    state: scoreActiveRound(activePlayoffs, 135),
    actorUserId: commissionerUserId,
  })
  if (!advanced.ok) throw new Error(`G43 playoff advancement failed: ${advanced.code}`)
  events.push(...advanced.events)
  activePlayoffs = advanced.state
  const finalized = finalizeNflRedraftPlayoffChampion({ state: activePlayoffs, actorUserId: commissionerUserId })
  if (!finalized.ok) throw new Error(`G43 playoff finalize failed: ${finalized.code}`)
  events.push(...finalized.events)

  const finalRosterSummaries = rosterSummaries(rules, teams)
  const plans = communicationPlans(events)
  const finalChampion = teams.find((team) => team.rosterId === finalized.championRosterId)
  const finalHistory = {
    championRosterId: finalized.championRosterId,
    championName: finalChampion?.displayName ?? finalized.championRosterId,
    season: 2026,
    completedAtIso: simulationNow.toISOString(),
    finalStandingsRecorded: finalized.finalStandings.length === teams.length,
  }
  const scheduleReferencesRealTeams = scheduleMatchups.every((matchup) => {
    const ids = [matchup.homeRosterId, matchup.awayRosterId].filter((id): id is string => Boolean(id))
    return ids.every((id) => teams.some((team) => team.rosterId === id))
  })
  const scoringUsesOnlyStarters = weeklyResults.every((week) =>
    week.matchupScores.every((matchup) => {
      const sourceState = [weekOne, weekTwo, weekThree].find((state) => state.week === week.week)
      const scored = sourceState?.matchups.find((row) => row.matchupId === matchup.matchupId)
      return Boolean(scored && scored.homeScore === scored.home.starterTotal && (!scored.away || scored.awayScore === scored.away.starterTotal))
    }),
  )
  const topSeeds = recalculatedSchedule.standings.slice(0, rules.playoffs.teamCount ?? 2).map((row) => row.rosterId)
  const playoffSeedRosters = playoffState.seeds.map((seed) => seed.rosterId)

  return {
    version: G43_FULL_SEASON_SIMULATION_VERSION,
    rules,
    draft: {
      completed: draftState.status === 'completed' && draftState.completedPickCount === draftState.totalPicks,
      pickCount: draftState.completedPickCount,
      uniqueDraftedPlayerCount: new Set(picks.map((pick) => pick.playerId)).size,
    },
    rosterSummaries: finalRosterSummaries,
    schedule: {
      generated: scheduleState.generated,
      regularSeasonWeeks: scheduleState.regularSeasonWeeks,
      matchups: scheduleMatchups.map((matchup) => ({
        id: matchup.id,
        week: matchup.week,
        homeRosterId: matchup.homeRosterId,
        awayRosterId: matchup.awayRosterId,
      })),
    },
    weeklyResults,
    waiver: {
      processed: waiverProcessed.results.some((result) => result.success && result.addPlayerId === 'waiver-rb'),
      results: waiverProcessed.results,
      addedPlayerId: 'waiver-rb',
      droppedPlayerId: 'alpha-bench-wr',
    },
    trade: {
      processed: tradeProcessed.ok,
      proposalId: 'g43-trade-alpha-bravo',
      movedPlayerIds: ['waiver-rb', 'bravo-bench-wr'],
    },
    playoffs: {
      generated: bracket.bracket.generated,
      seeds: playoffState.seeds.map((seed) => ({ seed: seed.seed, rosterId: seed.rosterId })),
      championRosterId: finalized.championRosterId,
      runnerUpRosterId: finalized.runnerUpRosterId,
      finalStandings: finalized.finalStandings.map((row) => ({
        finish: row.finish,
        rosterId: row.rosterId,
        champion: row.champion,
      })),
    },
    leagueHistory: finalHistory,
    communication: {
      notificationCount: plans.reduce((sum, plan) => sum + plan.notifications.length, 0),
      feedCount: plans.filter((plan) => plan.feed).length,
      chatCount: plans.filter((plan) => plan.chat).length,
      eventTypes: plans.map((plan) => plan.event.type),
    },
    events,
    communicationPlans: plans,
    invariants: {
      rostersValidAfterDraft: afterDraftRosterSummaries.every((row) => row.valid) && finalRosterSummaries.every((row) => row.valid),
      scheduleReferencesRealTeams,
      scoringUsesOnlyStarters,
      standingsUpdated: weeklyResults[2]?.standings.some((row) => row.wins + row.losses + row.ties === 3) === true,
      waiverUpdatedRosters: teams.some((team) => team.rosterId === 'bravo' && flatPlayers(team).some((player) => player.playerId === 'waiver-rb')),
      tradeUpdatedRosters: teams.some((team) => team.rosterId === 'alpha' && flatPlayers(team).some((player) => player.playerId === 'bravo-bench-wr')),
      playoffSeedsDerivedFromStandings: topSeeds.join('|') === playoffSeedRosters.join('|'),
      bracketAdvanced: advanced.status === 'championship_ready',
      championCrowned: Boolean(finalized.championRosterId),
      finalHistoryRecorded: finalHistory.finalStandingsRecorded,
      notificationsCreated: plans.length > 0 && plans.every((plan) => plan.notifications.length === baseTeamMeta.length),
      noDuplicatePlayers: duplicatePlayerIds(teams).length === 0,
      canonicalEventsEmitted: events.length > 0 && events.every((event) => event.type !== 'runtime.unknown'),
    },
  }
}
