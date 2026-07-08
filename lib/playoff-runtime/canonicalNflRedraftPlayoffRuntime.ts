import type {
  CanonicalLeagueRuntimeEvent,
  CanonicalLeagueRuntimeEventType,
} from '@/lib/league-runtime/leagueRuntimeEvents'
import { toCanonicalLeagueRuntimeEvent } from '@/lib/league-runtime/leagueRuntimeEvents'

export type NflRedraftPlayoffRulesInput = {
  general?: {
    season?: number | null
    sport?: string | null
    teamCount?: number | null
  }
  playoffs: {
    teamCount?: number | null
    startWeek?: number | null
    firstRoundByes?: number | null
    bracketType?: string | null
    totalRounds?: number | null
    consolationBracketEnabled?: boolean | null
    thirdPlaceGameEnabled?: boolean | null
    seedingRules?: string | null
    tiebreakerRules?: string[] | null
    byeRules?: string | null
    reseedBehavior?: string | null
    standingsTiebreakers?: string[] | null
  }
  schedule: {
    regularSeasonLength?: number | null
    playoffTransitionPoint?: number | null
  }
}

export type NflRedraftPlayoffTeamInput = {
  rosterId: string
  displayName?: string | null
  ownerId?: string | null
  ownerName?: string | null
  divisionId?: string | null
  divisionName?: string | null
  wins?: number | null
  losses?: number | null
  ties?: number | null
  pointsFor?: number | null
  pointsAgainst?: number | null
  divisionWins?: number | null
  divisionLosses?: number | null
  divisionTies?: number | null
  playoffSeed?: number | null
  isEliminated?: boolean | null
}

export type NflRedraftPlayoffMatchupInput = {
  matchupId?: string | null
  roundId?: string | null
  roundNumber: number
  roundName?: string | null
  matchupNumber: number
  bracketType?: NflRedraftPlayoffBracketType | string | null
  homeRosterId?: string | null
  awayRosterId?: string | null
  homeSeed?: number | null
  awaySeed?: number | null
  homeScore?: number | null
  awayScore?: number | null
  winnerRosterId?: string | null
  nextMatchupId?: string | null
  status?: string | null
  metadata?: Record<string, unknown> | null
}

export type NflRedraftPlayoffBracketStatus = 'not_generated' | 'pending' | 'active' | 'locked' | 'complete'
export type NflRedraftPlayoffBracketType = 'championship' | 'consolation' | 'third_place'
export type NflRedraftPlayoffMatchupStatus = 'scheduled' | 'active' | 'final' | 'bye' | 'cancelled'
export type NflRedraftPlayoffRoundStatus = 'pending' | 'active' | 'completed' | 'cancelled'
export type NflRedraftPlayoffQualifiedBy = 'division' | 'wildcard' | 'standings'

export type NflRedraftPlayoffSettings = {
  playoffTeamCount: number
  regularSeasonEndWeek: number
  playoffStartWeek: number
  bracketSize: number
  firstRoundByes: number
  roundCount: number
  reseedAfterEachRound: boolean
  consolationEnabled: boolean
  thirdPlaceGameEnabled: boolean
  divisionWinnersEnabled: boolean
  tiebreakers: string[]
  supported: boolean
  supportWarnings: string[]
}

export type NflRedraftPlayoffTeamState = {
  rosterId: string
  displayName: string
  ownerId: string | null
  ownerName: string | null
  divisionId: string | null
  divisionName: string | null
  wins: number
  losses: number
  ties: number
  pointsFor: number
  pointsAgainst: number
  divisionWins: number
  divisionLosses: number
  divisionTies: number
  winPct: number
  divisionWinPct: number
  playoffSeed: number | null
  qualified: boolean
  qualifiedBy: NflRedraftPlayoffQualifiedBy | null
  eliminated: boolean
  tiebreakerValues: Record<string, number | string>
}

export type NflRedraftPlayoffSeedState = {
  seed: number
  rosterId: string
  displayName: string
  qualifiedBy: NflRedraftPlayoffQualifiedBy
  wins: number
  losses: number
  ties: number
  winPct: number
  pointsFor: number
  pointsAgainst: number
  divisionRecord: string | null
  tiebreakerValues: Record<string, number | string>
}

export type NflRedraftPlayoffMatchupState = {
  matchupId: string
  roundId: string
  roundNumber: number
  roundName: string
  matchupNumber: number
  bracketType: NflRedraftPlayoffBracketType
  homeRosterId: string | null
  awayRosterId: string | null
  homeSeed: number | null
  awaySeed: number | null
  homeScore: number | null
  awayScore: number | null
  winnerRosterId: string | null
  loserRosterId: string | null
  nextMatchupId: string | null
  status: NflRedraftPlayoffMatchupStatus
  bye: boolean
  complete: boolean
  metadata: Record<string, unknown>
}

export type NflRedraftPlayoffRoundState = {
  roundId: string
  roundNumber: number
  roundName: string
  bracketType: NflRedraftPlayoffBracketType
  status: NflRedraftPlayoffRoundStatus
  matchups: NflRedraftPlayoffMatchupState[]
}

export type NflRedraftPlayoffFinalStanding = {
  finish: number
  rosterId: string
  displayName: string
  seed: number | null
  playoffWins: number
  playoffLosses: number
  champion: boolean
  runnerUp: boolean
}

export type NflRedraftPlayoffBracketState = {
  bracketId: string | null
  status: NflRedraftPlayoffBracketStatus
  locked: boolean
  generated: boolean
  rounds: NflRedraftPlayoffRoundState[]
  consolationRounds: NflRedraftPlayoffRoundState[]
  championRosterId: string | null
  runnerUpRosterId: string | null
  finalStandings: NflRedraftPlayoffFinalStanding[]
}

export type NflRedraftPlayoffRuntimeState = {
  leagueId: string
  seasonId: string
  season: number
  week: number
  generatedAtIso: string
  settings: NflRedraftPlayoffSettings
  teams: NflRedraftPlayoffTeamState[]
  seeds: NflRedraftPlayoffSeedState[]
  bubbleRosterIds: string[]
  eliminatedRosterIds: string[]
  bracket: NflRedraftPlayoffBracketState
  coverage: {
    teamCount: number
    qualifiedTeams: number
    championshipRounds: number
    championshipMatchups: number
    consolationMatchups: number
    completedMatchups: number
  }
}

export type NflRedraftGeneratedPlayoffBracket = {
  bracket: NflRedraftPlayoffBracketState
  events: CanonicalLeagueRuntimeEvent[]
}

export type NflRedraftPlayoffAdvanceResult =
  | {
      ok: true
      state: NflRedraftPlayoffRuntimeState
      events: CanonicalLeagueRuntimeEvent[]
      advancedRosterIds: string[]
      eliminatedRosterIds: string[]
      status: 'round_complete' | 'championship_ready' | 'ok'
    }
  | {
      ok: false
      code: 'NO_ACTIVE_ROUND' | 'NO_BRACKET' | 'MATCHUPS_INCOMPLETE' | 'TIE_UNRESOLVED'
      message: string
      blockedMatchupIds: string[]
      events: CanonicalLeagueRuntimeEvent[]
    }

export type NflRedraftPlayoffFinalizeResult =
  | {
      ok: true
      state: NflRedraftPlayoffRuntimeState
      championRosterId: string
      runnerUpRosterId: string | null
      finalStandings: NflRedraftPlayoffFinalStanding[]
      events: CanonicalLeagueRuntimeEvent[]
    }
  | {
      ok: false
      code: 'NO_BRACKET' | 'FINAL_ROUND_INCOMPLETE' | 'NO_WINNER'
      message: string
      events: CanonicalLeagueRuntimeEvent[]
    }

const DEFAULT_TIEBREAKERS = ['win_pct', 'wins', 'division_record', 'points_for', 'points_against']
const COMPLETE_STATUSES = new Set(['final', 'completed', 'complete'])
const CANCELLED_STATUSES = new Set(['cancelled', 'canceled'])

function intOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value)
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function numberOrZero(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function nextPowerOfTwo(value: number): number {
  return 2 ** Math.ceil(Math.log2(Math.max(2, value)))
}

function displayName(input: Pick<NflRedraftPlayoffTeamInput, 'displayName' | 'ownerName' | 'rosterId'>): string {
  return input.displayName?.trim() || input.ownerName?.trim() || input.rosterId
}

function normalizedText(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

function includesToken(value: unknown, token: string): boolean {
  return normalizedText(value).replace(/[-\s]+/g, '_').includes(token)
}

function normalizeTiebreakers(input: NflRedraftPlayoffRulesInput): string[] {
  const raw = input.playoffs.standingsTiebreakers?.length
    ? input.playoffs.standingsTiebreakers
    : input.playoffs.tiebreakerRules?.length
      ? input.playoffs.tiebreakerRules
      : DEFAULT_TIEBREAKERS
  const normalized = raw
    .map((row) => normalizedText(row).replace(/[-\s]+/g, '_'))
    .filter(Boolean)
  return Array.from(new Set([...normalized, 'roster_id']))
}

function resolveSettings(input: {
  rules: NflRedraftPlayoffRulesInput
  teamCount: number
}): NflRedraftPlayoffSettings {
  const configuredTeams = intOrNull(input.rules.playoffs.teamCount)
  const playoffTeamCount = Math.max(2, Math.min(configuredTeams ?? Math.min(6, input.teamCount), input.teamCount))
  const regularSeasonEndWeek =
    intOrNull(input.rules.schedule.regularSeasonLength) ??
    (intOrNull(input.rules.playoffs.startWeek) != null ? Math.max(1, intOrNull(input.rules.playoffs.startWeek)! - 1) : null) ??
    14
  const playoffStartWeek =
    intOrNull(input.rules.playoffs.startWeek) ??
    intOrNull(input.rules.schedule.playoffTransitionPoint) ??
    regularSeasonEndWeek + 1
  const bracketSize = nextPowerOfTwo(playoffTeamCount)
  const calculatedByes = bracketSize - playoffTeamCount
  const configuredByes = intOrNull(input.rules.playoffs.firstRoundByes)
  const firstRoundByes = Math.max(0, Math.min(configuredByes ?? calculatedByes, calculatedByes))
  const roundCount = Math.max(1, Math.ceil(Math.log2(bracketSize)))
  const tiebreakers = normalizeTiebreakers(input.rules)
  const supportWarnings: string[] = []
  if (playoffTeamCount > 16) supportWarnings.push('Playoff brackets above 16 teams are not supported by the G40 runtime.')
  if (input.teamCount < 2) supportWarnings.push('At least two teams are required for playoff generation.')
  return {
    playoffTeamCount,
    regularSeasonEndWeek,
    playoffStartWeek,
    bracketSize,
    firstRoundByes,
    roundCount,
    reseedAfterEachRound: includesToken(input.rules.playoffs.reseedBehavior, 'reseed'),
    consolationEnabled: Boolean(input.rules.playoffs.consolationBracketEnabled),
    thirdPlaceGameEnabled: Boolean(input.rules.playoffs.thirdPlaceGameEnabled),
    divisionWinnersEnabled:
      includesToken(input.rules.playoffs.seedingRules, 'division') ||
      tiebreakers.includes('division_winners') ||
      tiebreakers.includes('division_record'),
    tiebreakers,
    supported: supportWarnings.length === 0,
    supportWarnings,
  }
}

function recordString(row: Pick<NflRedraftPlayoffTeamState, 'wins' | 'losses' | 'ties'>): string {
  return row.ties > 0 ? `${row.wins}-${row.losses}-${row.ties}` : `${row.wins}-${row.losses}`
}

function normalizeTeam(input: NflRedraftPlayoffTeamInput): NflRedraftPlayoffTeamState {
  const wins = Math.max(0, intOrNull(input.wins) ?? 0)
  const losses = Math.max(0, intOrNull(input.losses) ?? 0)
  const ties = Math.max(0, intOrNull(input.ties) ?? 0)
  const divisionWins = Math.max(0, intOrNull(input.divisionWins) ?? 0)
  const divisionLosses = Math.max(0, intOrNull(input.divisionLosses) ?? 0)
  const divisionTies = Math.max(0, intOrNull(input.divisionTies) ?? 0)
  const games = wins + losses + ties
  const divisionGames = divisionWins + divisionLosses + divisionTies
  const winPct = games > 0 ? round3((wins + ties * 0.5) / games) : 0
  const divisionWinPct = divisionGames > 0 ? round3((divisionWins + divisionTies * 0.5) / divisionGames) : 0
  return {
    rosterId: input.rosterId,
    displayName: displayName(input),
    ownerId: input.ownerId ?? null,
    ownerName: input.ownerName ?? null,
    divisionId: input.divisionId ?? null,
    divisionName: input.divisionName ?? null,
    wins,
    losses,
    ties,
    pointsFor: round2(numberOrZero(input.pointsFor)),
    pointsAgainst: round2(numberOrZero(input.pointsAgainst)),
    divisionWins,
    divisionLosses,
    divisionTies,
    winPct,
    divisionWinPct,
    playoffSeed: input.playoffSeed ?? null,
    qualified: false,
    qualifiedBy: null,
    eliminated: Boolean(input.isEliminated),
    tiebreakerValues: {},
  }
}

function tiebreakerValue(team: NflRedraftPlayoffTeamState, key: string): number | string {
  switch (key) {
    case 'win_pct':
    case 'winning_percentage':
      return team.winPct
    case 'wins':
      return team.wins
    case 'losses':
      return -team.losses
    case 'division_record':
    case 'division_win_pct':
      return team.divisionWinPct
    case 'division_wins':
      return team.divisionWins
    case 'points_for':
    case 'pf':
      return team.pointsFor
    case 'points_against':
    case 'pa':
      return -team.pointsAgainst
    case 'head_to_head':
      return 0
    case 'roster_id':
      return team.rosterId
    default:
      return 0
  }
}

function compareTeams(a: NflRedraftPlayoffTeamState, b: NflRedraftPlayoffTeamState, tiebreakers: string[]): number {
  for (const key of tiebreakers) {
    const av = tiebreakerValue(a, key)
    const bv = tiebreakerValue(b, key)
    if (typeof av === 'number' && typeof bv === 'number' && av !== bv) return bv - av
    if (typeof av === 'string' && typeof bv === 'string' && av !== bv) return av.localeCompare(bv)
  }
  return a.displayName.localeCompare(b.displayName) || a.rosterId.localeCompare(b.rosterId)
}

function seedTeams(teams: NflRedraftPlayoffTeamState[], settings: NflRedraftPlayoffSettings): {
  teams: NflRedraftPlayoffTeamState[]
  seeds: NflRedraftPlayoffSeedState[]
  bubbleRosterIds: string[]
  eliminatedRosterIds: string[]
} {
  const sorted = [...teams].sort((a, b) => compareTeams(a, b, settings.tiebreakers))
  const selectedRosterIds: string[] = []
  const qualifiedBy = new Map<string, NflRedraftPlayoffQualifiedBy>()

  if (settings.divisionWinnersEnabled) {
    const bestByDivision = new Map<string, NflRedraftPlayoffTeamState>()
    for (const team of sorted) {
      if (!team.divisionId) continue
      const current = bestByDivision.get(team.divisionId)
      if (!current || compareTeams(team, current, settings.tiebreakers) < 0) bestByDivision.set(team.divisionId, team)
    }
    const divisionWinners = [...bestByDivision.values()].sort((a, b) => compareTeams(a, b, settings.tiebreakers))
    for (const team of divisionWinners) {
      if (selectedRosterIds.length >= settings.playoffTeamCount) break
      selectedRosterIds.push(team.rosterId)
      qualifiedBy.set(team.rosterId, 'division')
    }
  }

  for (const team of sorted) {
    if (selectedRosterIds.length >= settings.playoffTeamCount) break
    if (selectedRosterIds.includes(team.rosterId)) continue
    selectedRosterIds.push(team.rosterId)
    qualifiedBy.set(team.rosterId, selectedRosterIds.length <= settings.playoffTeamCount ? 'wildcard' : 'standings')
  }

  const selectedSet = new Set(selectedRosterIds)
  const selected = sorted
    .filter((team) => selectedSet.has(team.rosterId))
    .sort((a, b) => compareTeams(a, b, settings.tiebreakers))

  const seededTeams = [...selected, ...sorted.filter((team) => !selectedSet.has(team.rosterId))]
  const teamsWithSeeds = seededTeams.map((team, index) => {
    const seed = selectedSet.has(team.rosterId) ? index + 1 : null
    const tiebreakerValues = Object.fromEntries(settings.tiebreakers.map((key) => [key, tiebreakerValue(team, key)]))
    return {
      ...team,
      playoffSeed: seed,
      qualified: seed != null,
      qualifiedBy: seed != null ? qualifiedBy.get(team.rosterId) ?? 'standings' : null,
      eliminated: seed == null || team.eliminated,
      tiebreakerValues,
    }
  })

  const seeds = teamsWithSeeds
    .filter((team) => team.playoffSeed != null)
    .sort((a, b) => (a.playoffSeed ?? 999) - (b.playoffSeed ?? 999))
    .map((team) => ({
      seed: team.playoffSeed!,
      rosterId: team.rosterId,
      displayName: team.displayName,
      qualifiedBy: team.qualifiedBy ?? 'standings',
      wins: team.wins,
      losses: team.losses,
      ties: team.ties,
      winPct: team.winPct,
      pointsFor: team.pointsFor,
      pointsAgainst: team.pointsAgainst,
      divisionRecord: team.divisionId ? recordString({ wins: team.divisionWins, losses: team.divisionLosses, ties: team.divisionTies }) : null,
      tiebreakerValues: team.tiebreakerValues,
    }))

  const bubbleStart = Math.max(0, settings.playoffTeamCount - 2)
  const bubbleEnd = Math.min(teamsWithSeeds.length, settings.playoffTeamCount + 2)
  return {
    teams: teamsWithSeeds,
    seeds,
    bubbleRosterIds: teamsWithSeeds.slice(bubbleStart, bubbleEnd).map((team) => team.rosterId),
    eliminatedRosterIds: teamsWithSeeds.filter((team) => !team.qualified).map((team) => team.rosterId),
  }
}

function normalizeStatus(value: unknown): NflRedraftPlayoffMatchupStatus {
  const raw = normalizedText(value)
  if (raw === 'bye') return 'bye'
  if (COMPLETE_STATUSES.has(raw)) return 'final'
  if (CANCELLED_STATUSES.has(raw)) return 'cancelled'
  if (raw === 'active' || raw === 'in_progress' || raw === 'live') return 'active'
  return 'scheduled'
}

function normalizeRoundStatus(value: unknown, matchups: NflRedraftPlayoffMatchupState[]): NflRedraftPlayoffRoundStatus {
  const raw = normalizedText(value)
  if (raw === 'active') return 'active'
  if (raw === 'completed' || raw === 'complete') return 'completed'
  if (raw === 'cancelled' || raw === 'canceled') return 'cancelled'
  if (matchups.length > 0 && matchups.every((matchup) => matchup.complete || matchup.status === 'bye')) return 'completed'
  return 'pending'
}

function bracketType(value: unknown): NflRedraftPlayoffBracketType {
  const raw = normalizedText(value)
  if (raw === 'consolation') return 'consolation'
  if (raw === 'third_place' || raw === 'third-place') return 'third_place'
  return 'championship'
}

function rosterSeed(seedByRosterId: Map<string, number>, rosterId: string | null | undefined): number | null {
  return rosterId ? seedByRosterId.get(rosterId) ?? null : null
}

function loserFor(matchup: Pick<NflRedraftPlayoffMatchupState, 'homeRosterId' | 'awayRosterId' | 'winnerRosterId'>): string | null {
  if (!matchup.winnerRosterId) return null
  if (matchup.homeRosterId === matchup.winnerRosterId) return matchup.awayRosterId ?? null
  if (matchup.awayRosterId === matchup.winnerRosterId) return matchup.homeRosterId ?? null
  return null
}

function normalizeMatchup(input: NflRedraftPlayoffMatchupInput, seedByRosterId: Map<string, number>): NflRedraftPlayoffMatchupState {
  const type = bracketType(input.bracketType ?? input.metadata?.bracketType)
  const roundNumber = Math.max(1, intOrNull(input.roundNumber) ?? 1)
  const matchupNumber = Math.max(1, intOrNull(input.matchupNumber) ?? 1)
  const roundName = input.roundName?.trim() || roundNameFor(roundNumber, roundNumber)
  const homeRosterId = input.homeRosterId ?? null
  const awayRosterId = input.awayRosterId ?? null
  const homeSeed = input.homeSeed ?? rosterSeed(seedByRosterId, homeRosterId)
  const awaySeed = input.awaySeed ?? rosterSeed(seedByRosterId, awayRosterId)
  const status = normalizeStatus(input.status)
  const bye = status === 'bye' || Boolean(homeRosterId && !awayRosterId)
  const homeScore = input.homeScore == null ? null : round2(numberOrZero(input.homeScore))
  const awayScore = input.awayScore == null ? null : round2(numberOrZero(input.awayScore))
  const winnerRosterId = input.winnerRosterId ?? (bye ? homeRosterId : null)
  const complete = Boolean(winnerRosterId) || status === 'final' || status === 'bye'
  return {
    matchupId: input.matchupId?.trim() || `${type}:r${roundNumber}:m${matchupNumber}`,
    roundId: input.roundId?.trim() || `${type}:round:${roundNumber}`,
    roundNumber,
    roundName,
    matchupNumber,
    bracketType: type,
    homeRosterId,
    awayRosterId,
    homeSeed,
    awaySeed,
    homeScore,
    awayScore,
    winnerRosterId,
    loserRosterId: loserFor({ homeRosterId, awayRosterId, winnerRosterId }),
    nextMatchupId: input.nextMatchupId ?? null,
    status: bye ? 'bye' : status,
    bye,
    complete,
    metadata: input.metadata ?? {},
  }
}

function groupRounds(matchups: NflRedraftPlayoffMatchupState[], type: NflRedraftPlayoffBracketType): NflRedraftPlayoffRoundState[] {
  const byRound = new Map<number, NflRedraftPlayoffMatchupState[]>()
  for (const matchup of matchups.filter((row) => row.bracketType === type)) {
    const rows = byRound.get(matchup.roundNumber) ?? []
    rows.push(matchup)
    byRound.set(matchup.roundNumber, rows)
  }
  return [...byRound.entries()]
    .sort(([a], [b]) => a - b)
    .map(([roundNumber, rows]) => {
      const sorted = rows.sort((a, b) => a.matchupNumber - b.matchupNumber)
      return {
        roundId: sorted[0]?.roundId ?? `${type}:round:${roundNumber}`,
        roundNumber,
        roundName: sorted[0]?.roundName ?? roundNameFor(roundNumber, byRound.size),
        bracketType: type,
        status: normalizeRoundStatus(sorted[0]?.metadata.roundStatus, sorted),
        matchups: sorted,
      }
    })
}

function bracketStatus(value: unknown, rounds: NflRedraftPlayoffRoundState[]): NflRedraftPlayoffBracketStatus {
  const raw = normalizedText(value)
  if (raw === 'complete' || raw === 'completed') return 'complete'
  if (raw === 'locked') return 'locked'
  if (raw === 'active') return 'active'
  if (raw === 'pending') return 'pending'
  if (rounds.length > 0) return rounds.some((round) => round.status === 'active') ? 'active' : 'pending'
  return 'not_generated'
}

function roundNameFor(roundNumber: number, roundCount: number): string {
  if (roundNumber >= roundCount) return 'Championship'
  if (roundNumber === roundCount - 1) return 'Semifinal'
  if (roundNumber === 1 && roundCount === 3) return 'Quarterfinal'
  return `Round ${roundNumber}`
}

function generatedSeedPairs(bracketSize: number): Array<[number, number]> {
  if (bracketSize <= 2) return [[1, 2]]
  const previous = generatedSeedPairs(bracketSize / 2)
  const pairs: Array<[number, number]> = []
  for (const [a, b] of previous) {
    pairs.push([a, bracketSize + 1 - a])
    pairs.push([b, bracketSize + 1 - b])
  }
  return pairs
}

function buildGeneratedRounds(input: {
  seeds: NflRedraftPlayoffSeedState[]
  settings: NflRedraftPlayoffSettings
  bracketType: NflRedraftPlayoffBracketType
}): NflRedraftPlayoffRoundState[] {
  const seedToRoster = new Map(input.seeds.map((seed) => [seed.seed, seed.rosterId]))
  const roundCount = input.settings.roundCount
  const pairs = generatedSeedPairs(input.settings.bracketSize)
  const rounds: NflRedraftPlayoffRoundState[] = []
  let previousMatchupIds: string[] = []

  for (let roundNumber = 1; roundNumber <= roundCount; roundNumber += 1) {
    const matchupCount = roundNumber === 1 ? pairs.length : Math.max(1, previousMatchupIds.length / 2)
    const roundName = roundNameFor(roundNumber, roundCount)
    const matchups: NflRedraftPlayoffMatchupState[] = []
    for (let index = 0; index < matchupCount; index += 1) {
      const pair = pairs[index] ?? [null, null]
      const homeSeed = roundNumber === 1 && pair[0] ? pair[0] : null
      const awaySeed = roundNumber === 1 && pair[1] ? pair[1] : null
      const homeRosterId = homeSeed ? seedToRoster.get(homeSeed) ?? null : null
      const awayRosterId = awaySeed ? seedToRoster.get(awaySeed) ?? null : null
      const bye = roundNumber === 1 && Boolean(homeRosterId && !awayRosterId)
      const matchupId = `${input.bracketType}:r${roundNumber}:m${index + 1}`
      matchups.push({
        matchupId,
        roundId: `${input.bracketType}:round:${roundNumber}`,
        roundNumber,
        roundName,
        matchupNumber: index + 1,
        bracketType: input.bracketType,
        homeRosterId,
        awayRosterId,
        homeSeed,
        awaySeed,
        homeScore: null,
        awayScore: null,
        winnerRosterId: bye ? homeRosterId : null,
        loserRosterId: null,
        nextMatchupId: null,
        status: bye ? 'bye' : 'scheduled',
        bye,
        complete: bye,
        metadata: bye ? { autoAdvance: true } : {},
      })
    }

    if (previousMatchupIds.length > 0) {
      previousMatchupIds.forEach((previousId, index) => {
        const target = matchups[Math.floor(index / 2)]
        const previous = rounds[rounds.length - 1]?.matchups.find((matchup) => matchup.matchupId === previousId)
        if (previous && target) previous.nextMatchupId = target.matchupId
      })
    }

    rounds.push({
      roundId: `${input.bracketType}:round:${roundNumber}`,
      roundNumber,
      roundName,
      bracketType: input.bracketType,
      status: roundNumber === 1 ? 'active' : 'pending',
      matchups,
    })
    previousMatchupIds = matchups.map((matchup) => matchup.matchupId)
  }
  return rounds
}

function buildConsolationRounds(input: {
  teams: NflRedraftPlayoffTeamState[]
  settings: NflRedraftPlayoffSettings
}): NflRedraftPlayoffRoundState[] {
  if (!input.settings.consolationEnabled) return []
  const consolationTeams = input.teams.filter((team) => !team.qualified)
  if (consolationTeams.length < 2) return []
  const pairs: NflRedraftPlayoffMatchupState[] = []
  for (let i = 0; i < Math.floor(consolationTeams.length / 2); i += 1) {
    const home = consolationTeams[i]
    const away = consolationTeams[consolationTeams.length - 1 - i]
    pairs.push({
      matchupId: `consolation:r1:m${i + 1}`,
      roundId: 'consolation:round:1',
      roundNumber: 1,
      roundName: 'Consolation',
      matchupNumber: i + 1,
      bracketType: 'consolation',
      homeRosterId: home?.rosterId ?? null,
      awayRosterId: away?.rosterId ?? null,
      homeSeed: home?.playoffSeed ?? null,
      awaySeed: away?.playoffSeed ?? null,
      homeScore: null,
      awayScore: null,
      winnerRosterId: null,
      loserRosterId: null,
      nextMatchupId: null,
      status: 'scheduled',
      bye: false,
      complete: false,
      metadata: {},
    })
  }
  return pairs.length
    ? [{ roundId: 'consolation:round:1', roundNumber: 1, roundName: 'Consolation', bracketType: 'consolation', status: 'active', matchups: pairs }]
    : []
}

function activeChampionshipRound(rounds: NflRedraftPlayoffRoundState[]): NflRedraftPlayoffRoundState | null {
  return rounds.find((round) => round.status === 'active') ?? rounds.find((round) => round.matchups.some((matchup) => !matchup.complete)) ?? null
}

function resolveWinner(matchup: NflRedraftPlayoffMatchupState): {
  winnerRosterId: string | null
  loserRosterId: string | null
  blockedReason: string | null
} {
  if (matchup.winnerRosterId) {
    return { winnerRosterId: matchup.winnerRosterId, loserRosterId: loserFor(matchup), blockedReason: null }
  }
  if (matchup.bye) {
    return { winnerRosterId: matchup.homeRosterId, loserRosterId: null, blockedReason: null }
  }
  if (!matchup.homeRosterId || !matchup.awayRosterId) {
    return { winnerRosterId: null, loserRosterId: null, blockedReason: 'Matchup is missing one or more teams.' }
  }
  if (matchup.homeScore == null || matchup.awayScore == null) {
    return { winnerRosterId: null, loserRosterId: null, blockedReason: 'Matchup scores are not complete.' }
  }
  if (matchup.homeScore > matchup.awayScore) return { winnerRosterId: matchup.homeRosterId, loserRosterId: matchup.awayRosterId, blockedReason: null }
  if (matchup.awayScore > matchup.homeScore) return { winnerRosterId: matchup.awayRosterId, loserRosterId: matchup.homeRosterId, blockedReason: null }
  if (matchup.homeSeed != null && matchup.awaySeed != null && matchup.homeSeed !== matchup.awaySeed) {
    const homeWinsTie = matchup.homeSeed < matchup.awaySeed
    return {
      winnerRosterId: homeWinsTie ? matchup.homeRosterId : matchup.awayRosterId,
      loserRosterId: homeWinsTie ? matchup.awayRosterId : matchup.homeRosterId,
      blockedReason: null,
    }
  }
  return { winnerRosterId: null, loserRosterId: null, blockedReason: 'Tied playoff score needs commissioner resolution.' }
}

function cloneRound(round: NflRedraftPlayoffRoundState): NflRedraftPlayoffRoundState {
  return { ...round, matchups: round.matchups.map((matchup) => ({ ...matchup, metadata: { ...matchup.metadata } })) }
}

function seedForRoster(state: NflRedraftPlayoffRuntimeState, rosterId: string | null): number | null {
  if (!rosterId) return null
  return state.seeds.find((seed) => seed.rosterId === rosterId)?.seed ?? null
}

function finalStandingRows(state: NflRedraftPlayoffRuntimeState, championRosterId: string, runnerUpRosterId: string | null): NflRedraftPlayoffFinalStanding[] {
  const winLoss = new Map<string, { wins: number; losses: number }>()
  for (const round of state.bracket.rounds) {
    for (const matchup of round.matchups) {
      if (matchup.winnerRosterId) {
        const row = winLoss.get(matchup.winnerRosterId) ?? { wins: 0, losses: 0 }
        row.wins += matchup.awayRosterId ? 1 : 0
        winLoss.set(matchup.winnerRosterId, row)
      }
      if (matchup.loserRosterId) {
        const row = winLoss.get(matchup.loserRosterId) ?? { wins: 0, losses: 0 }
        row.losses += 1
        winLoss.set(matchup.loserRosterId, row)
      }
    }
  }
  const playoffTeams = state.teams.filter((team) => team.qualified)
  const ordered = [
    ...playoffTeams.filter((team) => team.rosterId === championRosterId),
    ...playoffTeams.filter((team) => team.rosterId === runnerUpRosterId),
    ...playoffTeams
      .filter((team) => team.rosterId !== championRosterId && team.rosterId !== runnerUpRosterId)
      .sort((a, b) => (a.playoffSeed ?? 999) - (b.playoffSeed ?? 999)),
    ...state.teams
      .filter((team) => !team.qualified)
      .sort((a, b) => compareTeams(a, b, state.settings.tiebreakers)),
  ]
  return ordered.map((team, index) => {
    const row = winLoss.get(team.rosterId) ?? { wins: 0, losses: team.qualified ? 1 : 0 }
    return {
      finish: index + 1,
      rosterId: team.rosterId,
      displayName: team.displayName,
      seed: team.playoffSeed,
      playoffWins: row.wins,
      playoffLosses: row.losses,
      champion: team.rosterId === championRosterId,
      runnerUp: team.rosterId === runnerUpRosterId,
    }
  })
}

export function buildPlayoffRuntimeEvent(input: {
  leagueId: string
  type: CanonicalLeagueRuntimeEventType | string
  actorUserId?: string | null
  occurredAt?: Date | string | null
  payload?: Record<string, unknown>
}): CanonicalLeagueRuntimeEvent {
  return toCanonicalLeagueRuntimeEvent({
    leagueId: input.leagueId,
    eventType: input.type,
    actorUserId: input.actorUserId ?? null,
    createdAt: input.occurredAt,
    payload: input.payload ?? {},
  })
}

export function buildNflRedraftPlayoffRuntimeState(input: {
  leagueId: string
  seasonId: string
  season: number
  week: number
  rules: NflRedraftPlayoffRulesInput
  teams: NflRedraftPlayoffTeamInput[]
  matchups?: NflRedraftPlayoffMatchupInput[]
  bracketStatus?: string | null
  bracketId?: string | null
  now?: Date
}): NflRedraftPlayoffRuntimeState {
  const now = input.now ?? new Date()
  const settings = resolveSettings({ rules: input.rules, teamCount: input.teams.length })
  const seeded = seedTeams(input.teams.map(normalizeTeam), settings)
  const seedByRosterId = new Map(seeded.seeds.map((seed) => [seed.rosterId, seed.seed]))
  const normalizedMatchups = (input.matchups ?? []).map((matchup) => normalizeMatchup(matchup, seedByRosterId))
  const championshipRounds = groupRounds(normalizedMatchups, 'championship')
  const consolationRounds = groupRounds(normalizedMatchups, 'consolation')
  const status = bracketStatus(input.bracketStatus, championshipRounds)
  const finalRound = championshipRounds[championshipRounds.length - 1]
  const finalMatchup = finalRound?.matchups.find((matchup) => !matchup.nextMatchupId) ?? finalRound?.matchups[0]
  const championRosterId = status === 'complete' ? finalMatchup?.winnerRosterId ?? null : null
  const runnerUpRosterId = championRosterId && finalMatchup ? loserFor({ ...finalMatchup, winnerRosterId: championRosterId }) : null
  const provisionalState = {
    leagueId: input.leagueId,
    seasonId: input.seasonId,
    season: input.season,
    week: input.week,
    generatedAtIso: now.toISOString(),
    settings,
    teams: seeded.teams,
    seeds: seeded.seeds,
    bubbleRosterIds: seeded.bubbleRosterIds,
    eliminatedRosterIds: seeded.eliminatedRosterIds,
    bracket: {
      bracketId: input.bracketId ?? null,
      status,
      locked: status === 'locked' || status === 'complete',
      generated: championshipRounds.length > 0,
      rounds: championshipRounds,
      consolationRounds,
      championRosterId,
      runnerUpRosterId,
      finalStandings: [] as NflRedraftPlayoffFinalStanding[],
    },
    coverage: {
      teamCount: seeded.teams.length,
      qualifiedTeams: seeded.seeds.length,
      championshipRounds: championshipRounds.length,
      championshipMatchups: championshipRounds.reduce((sum, round) => sum + round.matchups.length, 0),
      consolationMatchups: consolationRounds.reduce((sum, round) => sum + round.matchups.length, 0),
      completedMatchups: normalizedMatchups.filter((matchup) => matchup.complete || matchup.status === 'bye').length,
    },
  } satisfies NflRedraftPlayoffRuntimeState
  if (championRosterId) {
    provisionalState.bracket.finalStandings = finalStandingRows(provisionalState, championRosterId, runnerUpRosterId)
  }
  return provisionalState
}

export function generateNflRedraftPlayoffBracket(input: {
  state: NflRedraftPlayoffRuntimeState
  actorUserId?: string | null
  lockBracket?: boolean
}): NflRedraftGeneratedPlayoffBracket {
  const rounds = buildGeneratedRounds({ seeds: input.state.seeds, settings: input.state.settings, bracketType: 'championship' })
  const consolationRounds = buildConsolationRounds({ teams: input.state.teams, settings: input.state.settings })
  const bracket: NflRedraftPlayoffBracketState = {
    bracketId: input.state.bracket.bracketId,
    status: input.lockBracket ? 'locked' : 'active',
    locked: input.lockBracket === true,
    generated: true,
    rounds,
    consolationRounds,
    championRosterId: null,
    runnerUpRosterId: null,
    finalStandings: [],
  }
  const events = [
    buildPlayoffRuntimeEvent({
      leagueId: input.state.leagueId,
      type: 'playoffs.qualification.calculated',
      actorUserId: input.actorUserId,
      payload: { seasonId: input.state.seasonId, playoffTeamCount: input.state.settings.playoffTeamCount },
    }),
    buildPlayoffRuntimeEvent({
      leagueId: input.state.leagueId,
      type: 'playoffs.seeds.updated',
      actorUserId: input.actorUserId,
      payload: { seasonId: input.state.seasonId, seeds: input.state.seeds.map((seed) => ({ seed: seed.seed, rosterId: seed.rosterId, qualifiedBy: seed.qualifiedBy })) },
    }),
    buildPlayoffRuntimeEvent({
      leagueId: input.state.leagueId,
      type: 'playoffs.bracket.generated',
      actorUserId: input.actorUserId,
      payload: {
        seasonId: input.state.seasonId,
        playoffTeamCount: input.state.settings.playoffTeamCount,
        bracketSize: input.state.settings.bracketSize,
        byes: input.state.settings.firstRoundByes,
        rounds: input.state.settings.roundCount,
      },
    }),
    ...rounds.flatMap((round) =>
      round.matchups.map((matchup) =>
        buildPlayoffRuntimeEvent({
          leagueId: input.state.leagueId,
          type: 'playoffs.matchup.created',
          actorUserId: input.actorUserId,
          payload: {
            seasonId: input.state.seasonId,
            roundNumber: round.roundNumber,
            matchupNumber: matchup.matchupNumber,
            homeRosterId: matchup.homeRosterId,
            awayRosterId: matchup.awayRosterId,
            bye: matchup.bye,
          },
        }),
      ),
    ),
  ]
  const firstRound = rounds[0]
  if (firstRound) {
    events.push(
      buildPlayoffRuntimeEvent({
        leagueId: input.state.leagueId,
        type: 'playoffs.round.opened',
        actorUserId: input.actorUserId,
        payload: { seasonId: input.state.seasonId, roundNumber: firstRound.roundNumber },
      }),
    )
  }
  if (input.lockBracket) {
    events.push(
      buildPlayoffRuntimeEvent({
        leagueId: input.state.leagueId,
        type: 'playoffs.bracket.locked',
        actorUserId: input.actorUserId,
        payload: { seasonId: input.state.seasonId },
      }),
    )
  }
  if (consolationRounds.length) {
    events.push(
      buildPlayoffRuntimeEvent({
        leagueId: input.state.leagueId,
        type: 'playoffs.consolation.generated',
        actorUserId: input.actorUserId,
        payload: { seasonId: input.state.seasonId, matchupCount: consolationRounds.reduce((sum, round) => sum + round.matchups.length, 0) },
      }),
    )
  }
  const finalRound = rounds[rounds.length - 1]
  if (finalRound) {
    events.push(
      buildPlayoffRuntimeEvent({
        leagueId: input.state.leagueId,
        type: 'playoffs.championship.matchup.created',
        actorUserId: input.actorUserId,
        payload: { seasonId: input.state.seasonId, roundNumber: finalRound.roundNumber },
      }),
    )
  }
  return { bracket, events }
}

function fillNextRound(input: {
  state: NflRedraftPlayoffRuntimeState
  rounds: NflRedraftPlayoffRoundState[]
  activeRound: NflRedraftPlayoffRoundState
  winners: string[]
}) {
  const nextRound = input.rounds.find((round) => round.roundNumber === input.activeRound.roundNumber + 1)
  if (!nextRound) return null
  const seedByRosterId = new Map(input.state.seeds.map((seed) => [seed.rosterId, seed.seed]))
  const sortedWinners = input.state.settings.reseedAfterEachRound
    ? [...input.winners].sort((a, b) => (seedByRosterId.get(a) ?? 999) - (seedByRosterId.get(b) ?? 999))
    : input.winners

  if (input.state.settings.reseedAfterEachRound) {
    const pairs: Array<[string | null, string | null]> = []
    let left = 0
    let right = sortedWinners.length - 1
    while (left <= right) {
      const home = sortedWinners[left++] ?? null
      const away = left - 1 === right ? null : sortedWinners[right--] ?? null
      pairs.push([home, away])
    }
    nextRound.matchups.forEach((matchup, index) => {
      const [home, away] = pairs[index] ?? [null, null]
      matchup.homeRosterId = home
      matchup.awayRosterId = away
      matchup.homeSeed = seedForRoster(input.state, home)
      matchup.awaySeed = seedForRoster(input.state, away)
      matchup.status = home && !away ? 'bye' : 'scheduled'
      matchup.bye = Boolean(home && !away)
      matchup.winnerRosterId = matchup.bye ? home : null
      matchup.complete = matchup.bye
      matchup.metadata = { ...matchup.metadata, reseeded: true }
    })
  } else {
    for (const matchup of input.activeRound.matchups) {
      const winnerRosterId = matchup.winnerRosterId
      if (!winnerRosterId || !matchup.nextMatchupId) continue
      const target = nextRound.matchups.find((row) => row.matchupId === matchup.nextMatchupId)
      if (!target) continue
      if (target.homeRosterId === winnerRosterId || target.awayRosterId === winnerRosterId) continue
      if (!target.homeRosterId) {
        target.homeRosterId = winnerRosterId
        target.homeSeed = seedForRoster(input.state, winnerRosterId)
      } else if (!target.awayRosterId) {
        target.awayRosterId = winnerRosterId
        target.awaySeed = seedForRoster(input.state, winnerRosterId)
      }
    }
  }
  nextRound.status = 'active'
  return nextRound
}

export function advanceNflRedraftPlayoffRound(input: {
  state: NflRedraftPlayoffRuntimeState
  actorUserId?: string | null
}): NflRedraftPlayoffAdvanceResult {
  if (!input.state.bracket.generated || input.state.bracket.rounds.length === 0) {
    return { ok: false, code: 'NO_BRACKET', message: 'No playoff bracket has been generated.', blockedMatchupIds: [], events: [] }
  }
  const rounds = input.state.bracket.rounds.map(cloneRound)
  const activeRound = activeChampionshipRound(rounds)
  if (!activeRound) {
    return { ok: false, code: 'NO_ACTIVE_ROUND', message: 'No active playoff round is available.', blockedMatchupIds: [], events: [] }
  }

  const blocked: Array<{ matchupId: string; reason: string }> = []
  const advancedRosterIds: string[] = []
  const eliminatedRosterIds: string[] = []
  for (const matchup of activeRound.matchups) {
    const resolved = resolveWinner(matchup)
    if (!resolved.winnerRosterId) {
      blocked.push({ matchupId: matchup.matchupId, reason: resolved.blockedReason ?? 'Matchup is not ready.' })
      continue
    }
    matchup.winnerRosterId = resolved.winnerRosterId
    matchup.loserRosterId = resolved.loserRosterId
    matchup.status = matchup.bye ? 'bye' : 'final'
    matchup.complete = true
    advancedRosterIds.push(resolved.winnerRosterId)
    if (resolved.loserRosterId) eliminatedRosterIds.push(resolved.loserRosterId)
  }

  if (blocked.length) {
    const tieBlocked = blocked.some((row) => row.reason.toLowerCase().includes('tied'))
    return {
      ok: false,
      code: tieBlocked ? 'TIE_UNRESOLVED' : 'MATCHUPS_INCOMPLETE',
      message: blocked.map((row) => row.reason).join(' '),
      blockedMatchupIds: blocked.map((row) => row.matchupId),
      events: [],
    }
  }

  activeRound.status = 'completed'
  const nextRound = fillNextRound({ state: input.state, rounds, activeRound, winners: advancedRosterIds })
  const finalRoundComplete = !nextRound
  const bracketStatus: NflRedraftPlayoffBracketStatus = finalRoundComplete ? 'locked' : 'active'
  const state = {
    ...input.state,
    bracket: {
      ...input.state.bracket,
      status: bracketStatus,
      locked: bracketStatus === 'locked',
      rounds,
    },
  } satisfies NflRedraftPlayoffRuntimeState

  const events: CanonicalLeagueRuntimeEvent[] = [
    buildPlayoffRuntimeEvent({
      leagueId: input.state.leagueId,
      type: 'playoffs.advancement',
      actorUserId: input.actorUserId,
      payload: { seasonId: input.state.seasonId, roundNumber: activeRound.roundNumber, advancedRosterIds, eliminatedRosterIds },
    }),
    ...advancedRosterIds.map((rosterId) =>
      buildPlayoffRuntimeEvent({
        leagueId: input.state.leagueId,
        type: 'playoffs.team.advanced',
        actorUserId: input.actorUserId,
        payload: { seasonId: input.state.seasonId, roundNumber: activeRound.roundNumber, rosterId },
      }),
    ),
    ...eliminatedRosterIds.map((rosterId) =>
      buildPlayoffRuntimeEvent({
        leagueId: input.state.leagueId,
        type: 'playoffs.team.eliminated',
        actorUserId: input.actorUserId,
        payload: { seasonId: input.state.seasonId, roundNumber: activeRound.roundNumber, rosterId },
      }),
    ),
  ]
  if (input.state.settings.reseedAfterEachRound && nextRound) {
    events.push(
      buildPlayoffRuntimeEvent({
        leagueId: input.state.leagueId,
        type: 'playoffs.reseeded',
        actorUserId: input.actorUserId,
        payload: { seasonId: input.state.seasonId, roundNumber: nextRound.roundNumber },
      }),
    )
  }
  if (nextRound) {
    events.push(
      buildPlayoffRuntimeEvent({
        leagueId: input.state.leagueId,
        type: 'playoffs.round.opened',
        actorUserId: input.actorUserId,
        payload: { seasonId: input.state.seasonId, roundNumber: nextRound.roundNumber },
      }),
    )
  }
  return {
    ok: true,
    state,
    events,
    advancedRosterIds: Array.from(new Set(advancedRosterIds)),
    eliminatedRosterIds: Array.from(new Set(eliminatedRosterIds)),
    status: finalRoundComplete ? 'championship_ready' : 'round_complete',
  }
}

export function finalizeNflRedraftPlayoffChampion(input: {
  state: NflRedraftPlayoffRuntimeState
  actorUserId?: string | null
}): NflRedraftPlayoffFinalizeResult {
  if (!input.state.bracket.generated) {
    return { ok: false, code: 'NO_BRACKET', message: 'No playoff bracket has been generated.', events: [] }
  }
  const finalRound = input.state.bracket.rounds[input.state.bracket.rounds.length - 1]
  if (!finalRound || finalRound.status !== 'completed') {
    return { ok: false, code: 'FINAL_ROUND_INCOMPLETE', message: 'The championship round is not complete.', events: [] }
  }
  const championshipMatchup = finalRound.matchups.find((matchup) => !matchup.nextMatchupId) ?? finalRound.matchups[0]
  if (!championshipMatchup?.winnerRosterId) {
    return { ok: false, code: 'NO_WINNER', message: 'The championship matchup has no winner.', events: [] }
  }
  const championRosterId = championshipMatchup.winnerRosterId
  const runnerUpRosterId = loserFor(championshipMatchup)
  const finalStandings = finalStandingRows(input.state, championRosterId, runnerUpRosterId)
  const state = {
    ...input.state,
    bracket: {
      ...input.state.bracket,
      status: 'complete',
      locked: true,
      championRosterId,
      runnerUpRosterId,
      finalStandings,
    },
  } satisfies NflRedraftPlayoffRuntimeState
  const events = [
    buildPlayoffRuntimeEvent({
      leagueId: input.state.leagueId,
      type: 'playoffs.champion.crowned',
      actorUserId: input.actorUserId,
      payload: { seasonId: input.state.seasonId, championRosterId, runnerUpRosterId },
    }),
    buildPlayoffRuntimeEvent({
      leagueId: input.state.leagueId,
      type: 'playoffs.final_standings.recorded',
      actorUserId: input.actorUserId,
      payload: { seasonId: input.state.seasonId, finalStandings },
    }),
    buildPlayoffRuntimeEvent({
      leagueId: input.state.leagueId,
      type: 'season.completed',
      actorUserId: input.actorUserId,
      payload: { seasonId: input.state.seasonId, championRosterId },
    }),
  ]
  return { ok: true, state, championRosterId, runnerUpRosterId, finalStandings, events }
}
