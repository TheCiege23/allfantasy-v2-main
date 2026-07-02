import type {
  CanonicalLeagueRules,
} from '@/lib/league-runtime/canonicalLeagueRules'
import type {
  CanonicalLeagueRuntimeEvent,
  CanonicalLeagueRuntimeEventType,
} from '@/lib/league-runtime/leagueRuntimeEvents'
import { toCanonicalLeagueRuntimeEvent } from '@/lib/league-runtime/leagueRuntimeEvents'
import { bridgeScoringKey } from '@/lib/nfl-scoring/scoringKeyBridge'
import { expandSportConfigToggles, getScoringCategories } from '@/lib/sportConfig'
import type { ScoringCategory } from '@/lib/sportConfig/types'
import {
  isTeamDefenseRow,
  normalizeNflTeamDefenseWeeklyStats,
  normalizeNflWeeklyStats,
} from './nflStatNormalization'

export const NFL_REDRAFT_STAT_CORRECTION_VERSION_KEY = '__af_correction_version'

export type NflRedraftScoringStatus = 'scheduled' | 'live' | 'final' | 'bye' | 'illegal_lineup'

export type NflRedraftScoringSettings = {
  sport: 'NFL'
  presetId: string | null
  templateId: string | null
  categories: ScoringCategory[]
  categoryPoints: Record<string, number>
  receptionPoints: number | null
  tePremiumEnabled: boolean
  source: 'canonical_rules' | 'sport_config_fallback'
}

export type NflRedraftRuntimePlayerInput = {
  rosterId: string
  playerId: string
  playerName: string
  position: string
  team?: string | null
  slotType: string
  injuryStatus?: string | null
  isLocked?: boolean | null
}

export type NflRedraftRuntimeScoreInput = {
  playerId: string
  sport?: string | null
  stats: Record<string, unknown>
  isFinalized?: boolean | null
  source?: string | null
  updatedAtIso?: string | null
}

export type NflRedraftRuntimeTeamInput = {
  rosterId: string
  displayName: string | null
  ownerName?: string | null
  divisionId?: string | null
  divisionName?: string | null
  players: NflRedraftRuntimePlayerInput[]
  validationIssues?: Array<{ code: string; severity: string; message: string; playerId?: string | null }>
}

export type NflRedraftRuntimeMatchupInput = {
  matchupId: string
  week: number
  homeRosterId: string
  awayRosterId?: string | null
  status?: string | null
  homeScore?: number | null
  awayScore?: number | null
}

export type NflRedraftPlayerScore = {
  rosterId: string
  playerId: string
  playerName: string
  position: string
  team: string | null
  slotType: string
  section: 'starter' | 'bench' | 'ir'
  fantasyPoints: number
  stats: Record<string, number>
  breakdown: Record<string, number>
  hasStats: boolean
  isFinalized: boolean
  correctionVersion: number
  source: string | null
}

export type NflRedraftTeamScore = {
  rosterId: string
  displayName: string | null
  ownerName: string | null
  divisionId: string | null
  divisionName: string | null
  starterTotal: number
  benchTotal: number
  irTotal: number
  totalVisiblePoints: number
  starterCount: number
  scoredStarterCount: number
  missingStarterPlayerIds: string[]
  allStartersFinal: boolean
  lineupLegal: boolean
  illegalLineupIssues: Array<{ code: string; severity: string; message: string; playerId?: string | null }>
  starters: NflRedraftPlayerScore[]
  bench: NflRedraftPlayerScore[]
  ir: NflRedraftPlayerScore[]
}

export type NflRedraftMatchupScore = {
  matchupId: string
  week: number
  status: NflRedraftScoringStatus
  homeRosterId: string
  awayRosterId: string | null
  home: NflRedraftTeamScore
  away: NflRedraftTeamScore | null
  homeScore: number
  awayScore: number | null
  winnerRosterId: string | null
  loserRosterId: string | null
  tied: boolean
  complete: boolean
  missingStarterPlayerIds: string[]
  correctionVersion: number
}

export type NflRedraftScoringStanding = {
  rosterId: string
  displayName: string | null
  wins: number
  losses: number
  ties: number
  pointsFor: number
  pointsAgainst: number
  winPct: number
  streak: string | null
  playoffSeed: number | null
  divisionId: string | null
  divisionRecord: { wins: number; losses: number; ties: number } | null
}

export type NflRedraftLiveScoringRuntimeState = {
  leagueId: string
  seasonId: string
  season: number
  week: number
  sport: 'NFL'
  generatedAtIso: string
  settings: NflRedraftScoringSettings
  teams: NflRedraftTeamScore[]
  matchups: NflRedraftMatchupScore[]
  standings: NflRedraftScoringStanding[]
  coverage: {
    rosterCount: number
    matchupCount: number
    players: number
    playersWithStats: number
    starters: number
    startersWithStats: number
    illegalLineups: number
    finalizedMatchups: number
    correctionVersion: number
  }
}

const NON_SCORING_SLOTS = new Set(['bench', 'bn', 'ir', 'taxi', 'devy', 'reserve'])
const IR_SLOTS = new Set(['ir', 'reserve'])

function roundScore(value: number): number {
  return Math.round(value * 100) / 100
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function finiteStats(raw: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(raw)) {
    const n = finiteNumber(value)
    if (n !== null) out[key] = n
  }
  return out
}

function normalizedPosition(position: string | null | undefined): string {
  const raw = String(position ?? '').trim().toUpperCase()
  if (raw === 'DST' || raw === 'D/ST') return 'DEF'
  return raw
}

function presetReceptionPoints(rules: CanonicalLeagueRules): number | null {
  const raw = `${rules.scoring.presetId ?? ''} ${rules.scoring.templateId ?? ''}`.toLowerCase()
  if (raw.includes('standard') || raw.includes('non_ppr') || raw.includes('non-ppr')) return 0
  if (raw.includes('half')) return 0.5
  if (raw.includes('ppr')) return 1
  return null
}

function activeTogglesFromRules(rules: CanonicalLeagueRules): string[] {
  const toggles = new Set<string>()
  const starterText = JSON.stringify(rules.roster.starters ?? {}).toUpperCase()
  if (starterText.includes('IDP') || starterText.includes('DL') || starterText.includes('LB') || starterText.includes('DB')) {
    toggles.add('IDP')
  }
  const scoringText = `${rules.scoring.presetId ?? ''} ${rules.scoring.templateId ?? ''}`.toLowerCase()
  if (scoringText.includes('tep') || scoringText.includes('te_premium') || scoringText.includes('te-premium')) {
    toggles.add('TE_PREMIUM')
  }
  for (const rule of rules.scoring.activeRules ?? []) {
    const key = bridgeScoringKey(rule.statKey) ?? rule.statKey
    if (key.startsWith('idp_')) toggles.add('IDP')
    if (key === 'te_premium' && rule.enabled !== false) toggles.add('TE_PREMIUM')
  }
  return expandSportConfigToggles([...toggles])
}

export function resolveNflRedraftScoringSettings(input: {
  rules: CanonicalLeagueRules
  categoryPoints?: Record<string, number> | null
}): NflRedraftScoringSettings {
  const toggles = activeTogglesFromRules(input.rules)
  const receptionPoints = presetReceptionPoints(input.rules)
  let categories = getScoringCategories('NFL', toggles)
  if (receptionPoints !== null) {
    categories = categories.map((category) =>
      category.key === 'rec' ? { ...category, defaultPoints: receptionPoints } : category,
    )
  }

  const categoryPoints: Record<string, number> = {}
  for (const [key, value] of Object.entries(input.categoryPoints ?? {})) {
    if (Number.isFinite(value)) categoryPoints[key] = value
  }

  let mappedRuleCount = 0
  for (const rule of input.rules.scoring.activeRules ?? []) {
    if (rule.enabled === false) continue
    const engineKey = bridgeScoringKey(rule.statKey) ?? rule.statKey
    const value = finiteNumber(rule.pointsValue)
    if (!engineKey || value === null) continue
    categoryPoints[engineKey] = value * (finiteNumber(rule.multiplier) ?? 1)
    mappedRuleCount += 1
  }

  return {
    sport: 'NFL',
    presetId: input.rules.scoring.presetId ?? null,
    templateId: input.rules.scoring.templateId ?? null,
    categories,
    categoryPoints,
    receptionPoints,
    tePremiumEnabled: categories.some((category) => category.key === 'te_premium'),
    source: mappedRuleCount > 0 || Object.keys(categoryPoints).length > 0 ? 'canonical_rules' : 'sport_config_fallback',
  }
}

function bonusBaseYardsKey(catKey: string): string | null {
  if (catKey.includes('pass_') && catKey.includes('bonus')) return 'pass_yds'
  if (catKey.includes('rush_') && catKey.includes('bonus')) return 'rush_yds'
  if (catKey.includes('rec_') && catKey.includes('bonus')) return 'rec_yds'
  return null
}

function categoryPoints(cat: ScoringCategory, rawStats: Record<string, number>, pointsValue: number): number {
  if (cat.minForBonus != null) {
    const base = bonusBaseYardsKey(cat.key)
    if (!base) return 0
    return (rawStats[base] ?? 0) >= cat.minForBonus ? pointsValue : 0
  }
  if (cat.tierStatKey != null) {
    if (!(cat.tierStatKey in rawStats)) return 0
    const value = rawStats[cat.tierStatKey]
    if (!Number.isFinite(value)) return 0
    const min = cat.tierMin ?? Number.NEGATIVE_INFINITY
    const max = cat.tierMax ?? Number.POSITIVE_INFINITY
    return value >= min && value <= max ? pointsValue : 0
  }
  const stat = rawStats[cat.key] ?? 0
  return stat * pointsValue
}

function withTePremiumStat(
  settings: NflRedraftScoringSettings,
  rawStats: Record<string, number>,
  position: string,
): Record<string, number> {
  if (!settings.tePremiumEnabled) return rawStats
  if (normalizedPosition(position) !== 'TE') return rawStats
  return { ...rawStats, te_premium: rawStats.rec ?? rawStats.receptions ?? 0 }
}

export function calculateNflRedraftFantasyPoints(input: {
  settings: NflRedraftScoringSettings
  stats: Record<string, number>
  position: string
}): { points: number; breakdown: Record<string, number> } {
  const effectiveStats = withTePremiumStat(input.settings, input.stats, input.position)
  const breakdown: Record<string, number> = {}
  let total = 0
  for (const cat of input.settings.categories) {
    const pointsValue = input.settings.categoryPoints[cat.key] ?? cat.defaultPoints
    const points = categoryPoints(cat, effectiveStats, pointsValue)
    if (Math.abs(points) > 0.00001) breakdown[cat.key] = roundScore(points)
    total += points
  }
  return { points: roundScore(total), breakdown }
}

export function normalizeNflRedraftPlayerStats(input: {
  playerId: string
  position: string
  rawStats: unknown
}): Record<string, number> {
  const normalized = isTeamDefenseRow(input.playerId, input.position)
    ? normalizeNflTeamDefenseWeeklyStats(input.rawStats)
    : normalizeNflWeeklyStats(input.rawStats)
  return finiteStats(normalized)
}

export function isNflRedraftScoringStarterSlot(slotType: string | null | undefined): boolean {
  return !NON_SCORING_SLOTS.has(String(slotType ?? '').toLowerCase())
}

function scoringSection(slotType: string | null | undefined): NflRedraftPlayerScore['section'] {
  const normalized = String(slotType ?? '').trim().toLowerCase()
  if (IR_SLOTS.has(normalized)) return 'ir'
  return isNflRedraftScoringStarterSlot(normalized) ? 'starter' : 'bench'
}

function correctionVersionFromStats(stats: Record<string, number>): number {
  const value = stats[NFL_REDRAFT_STAT_CORRECTION_VERSION_KEY]
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

function scoreMap(rows: NflRedraftRuntimeScoreInput[]): Map<string, NflRedraftRuntimeScoreInput> {
  return new Map(rows.map((row) => [row.playerId, row]))
}

export function buildNflRedraftTeamScore(input: {
  team: NflRedraftRuntimeTeamInput
  scoreRowsByPlayerId: Map<string, NflRedraftRuntimeScoreInput>
  settings: NflRedraftScoringSettings
}): NflRedraftTeamScore {
  const playerScores: NflRedraftPlayerScore[] = input.team.players.map((player) => {
    const scoreRow = input.scoreRowsByPlayerId.get(player.playerId)
    const normalizedStats = scoreRow ? finiteStats(scoreRow.stats) : {}
    const hasStats = Object.keys(normalizedStats).some((key) => key !== NFL_REDRAFT_STAT_CORRECTION_VERSION_KEY)
    const calculation = hasStats
      ? calculateNflRedraftFantasyPoints({
          settings: input.settings,
          stats: normalizedStats,
          position: player.position,
        })
      : { points: 0, breakdown: {} }
    return {
      rosterId: input.team.rosterId,
      playerId: player.playerId,
      playerName: player.playerName,
      position: normalizedPosition(player.position),
      team: player.team ?? null,
      slotType: player.slotType,
      section: scoringSection(player.slotType),
      fantasyPoints: calculation.points,
      stats: normalizedStats,
      breakdown: calculation.breakdown,
      hasStats,
      isFinalized: scoreRow?.isFinalized === true,
      correctionVersion: correctionVersionFromStats(normalizedStats),
      source: scoreRow?.source ?? null,
    }
  })

  const starters = playerScores.filter((player) => player.section === 'starter')
  const bench = playerScores.filter((player) => player.section === 'bench')
  const ir = playerScores.filter((player) => player.section === 'ir')
  const illegalLineupIssues = (input.team.validationIssues ?? []).filter((issue) => issue.severity === 'blocking' || issue.severity === 'error')
  const starterTotal = roundScore(starters.reduce((sum, player) => sum + player.fantasyPoints, 0))
  const benchTotal = roundScore(bench.reduce((sum, player) => sum + player.fantasyPoints, 0))
  const irTotal = roundScore(ir.reduce((sum, player) => sum + player.fantasyPoints, 0))
  const missingStarterPlayerIds = starters.filter((player) => !player.hasStats).map((player) => player.playerId)

  return {
    rosterId: input.team.rosterId,
    displayName: input.team.displayName,
    ownerName: input.team.ownerName ?? null,
    divisionId: input.team.divisionId ?? null,
    divisionName: input.team.divisionName ?? null,
    starterTotal,
    benchTotal,
    irTotal,
    totalVisiblePoints: roundScore(starterTotal + benchTotal + irTotal),
    starterCount: starters.length,
    scoredStarterCount: starters.length - missingStarterPlayerIds.length,
    missingStarterPlayerIds,
    allStartersFinal: starters.length > 0 && starters.every((player) => player.hasStats && player.isFinalized),
    lineupLegal: illegalLineupIssues.length === 0,
    illegalLineupIssues,
    starters,
    bench,
    ir,
  }
}

function matchupStatus(home: NflRedraftTeamScore, away: NflRedraftTeamScore | null): NflRedraftScoringStatus {
  if (!away) return 'bye'
  if (!home.lineupLegal || !away.lineupLegal) return 'illegal_lineup'
  const missing = home.missingStarterPlayerIds.length + away.missingStarterPlayerIds.length
  if (missing === 0 && home.allStartersFinal && away.allStartersFinal) return 'final'
  if (home.scoredStarterCount > 0 || away.scoredStarterCount > 0) return 'live'
  return 'scheduled'
}

export function buildNflRedraftMatchupScore(input: {
  matchup: NflRedraftRuntimeMatchupInput
  teamScoresByRosterId: Map<string, NflRedraftTeamScore>
}): NflRedraftMatchupScore | null {
  const home = input.teamScoresByRosterId.get(input.matchup.homeRosterId)
  if (!home) return null
  const away = input.matchup.awayRosterId ? input.teamScoresByRosterId.get(input.matchup.awayRosterId) ?? null : null
  const status = matchupStatus(home, away)
  const homeScore = home.starterTotal
  const awayScore = away ? away.starterTotal : null
  const tied = Boolean(away && status === 'final' && homeScore === awayScore)
  const winnerRosterId =
    away && status === 'final' && !tied
      ? homeScore > awayScore!
        ? home.rosterId
        : away.rosterId
      : null
  const loserRosterId =
    away && status === 'final' && !tied
      ? winnerRosterId === home.rosterId
        ? away.rosterId
        : home.rosterId
      : null
  const correctionVersion = Math.max(
    ...home.starters.map((player) => player.correctionVersion),
    ...(away?.starters.map((player) => player.correctionVersion) ?? []),
    0,
  )

  return {
    matchupId: input.matchup.matchupId,
    week: input.matchup.week,
    status,
    homeRosterId: home.rosterId,
    awayRosterId: away?.rosterId ?? null,
    home,
    away,
    homeScore,
    awayScore,
    winnerRosterId,
    loserRosterId,
    tied,
    complete: status === 'final',
    missingStarterPlayerIds: [...home.missingStarterPlayerIds, ...(away?.missingStarterPlayerIds ?? [])],
    correctionVersion,
  }
}

export function buildNflRedraftScoringStandings(input: {
  teams: NflRedraftTeamScore[]
  matchups: NflRedraftMatchupScore[]
}): NflRedraftScoringStanding[] {
  const rows = new Map<string, NflRedraftScoringStanding & { streakEvents: Array<'W' | 'L' | 'T'> }>()
  for (const team of input.teams) {
    rows.set(team.rosterId, {
      rosterId: team.rosterId,
      displayName: team.displayName,
      wins: 0,
      losses: 0,
      ties: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      winPct: 0,
      streak: null,
      playoffSeed: null,
      divisionId: team.divisionId,
      divisionRecord: team.divisionId ? { wins: 0, losses: 0, ties: 0 } : null,
      streakEvents: [],
    })
  }

  for (const matchup of input.matchups.filter((row) => row.complete && row.away)) {
    const home = rows.get(matchup.homeRosterId)
    const away = matchup.awayRosterId ? rows.get(matchup.awayRosterId) : null
    if (!home || !away || matchup.awayScore == null) continue
    home.pointsFor = roundScore(home.pointsFor + matchup.homeScore)
    home.pointsAgainst = roundScore(home.pointsAgainst + matchup.awayScore)
    away.pointsFor = roundScore(away.pointsFor + matchup.awayScore)
    away.pointsAgainst = roundScore(away.pointsAgainst + matchup.homeScore)

    const divisionGame = home.divisionId != null && home.divisionId === away.divisionId
    if (matchup.homeScore > matchup.awayScore) {
      home.wins += 1
      away.losses += 1
      home.streakEvents.push('W')
      away.streakEvents.push('L')
      if (divisionGame && home.divisionRecord && away.divisionRecord) {
        home.divisionRecord.wins += 1
        away.divisionRecord.losses += 1
      }
    } else if (matchup.awayScore > matchup.homeScore) {
      away.wins += 1
      home.losses += 1
      away.streakEvents.push('W')
      home.streakEvents.push('L')
      if (divisionGame && home.divisionRecord && away.divisionRecord) {
        away.divisionRecord.wins += 1
        home.divisionRecord.losses += 1
      }
    } else {
      home.ties += 1
      away.ties += 1
      home.streakEvents.push('T')
      away.streakEvents.push('T')
      if (divisionGame && home.divisionRecord && away.divisionRecord) {
        home.divisionRecord.ties += 1
        away.divisionRecord.ties += 1
      }
    }
  }

  const ordered = [...rows.values()].sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins
    if (a.losses !== b.losses) return a.losses - b.losses
    if (b.pointsFor !== a.pointsFor) return b.pointsFor - a.pointsFor
    if (a.pointsAgainst !== b.pointsAgainst) return a.pointsAgainst - b.pointsAgainst
    return String(a.displayName ?? a.rosterId).localeCompare(String(b.displayName ?? b.rosterId))
  })

  return ordered.map((row, index) => {
    const games = row.wins + row.losses + row.ties
    const last = row.streakEvents[row.streakEvents.length - 1]
    let streak: string | null = null
    if (last) {
      let count = 0
      for (let i = row.streakEvents.length - 1; i >= 0; i -= 1) {
        if (row.streakEvents[i] !== last) break
        count += 1
      }
      streak = `${last}${count}`
    }
    const { streakEvents: _streakEvents, ...publicRow } = row
    return {
      ...publicRow,
      winPct: games > 0 ? roundScore((row.wins + row.ties * 0.5) / games) : 0,
      streak,
      playoffSeed: index + 1,
    }
  })
}

export function buildNflRedraftLiveScoringRuntimeState(input: {
  leagueId: string
  seasonId: string
  season: number
  week: number
  rules: CanonicalLeagueRules
  teams: NflRedraftRuntimeTeamInput[]
  matchups: NflRedraftRuntimeMatchupInput[]
  scoreRows: NflRedraftRuntimeScoreInput[]
  categoryPoints?: Record<string, number> | null
  now?: Date
}): NflRedraftLiveScoringRuntimeState {
  const settings = resolveNflRedraftScoringSettings({
    rules: input.rules,
    categoryPoints: input.categoryPoints,
  })
  const scoreRowsByPlayerId = scoreMap(input.scoreRows)
  const teams = input.teams.map((team) => buildNflRedraftTeamScore({ team, scoreRowsByPlayerId, settings }))
  const teamsByRosterId = new Map(teams.map((team) => [team.rosterId, team]))
  const matchups = input.matchups
    .map((matchup) => buildNflRedraftMatchupScore({ matchup, teamScoresByRosterId: teamsByRosterId }))
    .filter((matchup): matchup is NflRedraftMatchupScore => Boolean(matchup))
  const standings = buildNflRedraftScoringStandings({ teams, matchups })
  const allPlayers = teams.flatMap((team) => [...team.starters, ...team.bench, ...team.ir])
  const starters = teams.flatMap((team) => team.starters)

  return {
    leagueId: input.leagueId,
    seasonId: input.seasonId,
    season: input.season,
    week: input.week,
    sport: 'NFL',
    generatedAtIso: (input.now ?? new Date()).toISOString(),
    settings,
    teams,
    matchups,
    standings,
    coverage: {
      rosterCount: teams.length,
      matchupCount: matchups.length,
      players: allPlayers.length,
      playersWithStats: allPlayers.filter((player) => player.hasStats).length,
      starters: starters.length,
      startersWithStats: starters.filter((player) => player.hasStats).length,
      illegalLineups: teams.filter((team) => !team.lineupLegal).length,
      finalizedMatchups: matchups.filter((matchup) => matchup.complete).length,
      correctionVersion: Math.max(...allPlayers.map((player) => player.correctionVersion), 0),
    },
  }
}

export function applyNflRedraftStatCorrection(input: {
  playerId: string
  position: string
  previousStats?: Record<string, unknown> | null
  correctedStats: unknown
}): { normalizedStats: Record<string, number>; correctionVersion: number } {
  const previous = finiteStats(input.previousStats ?? {})
  const corrected = normalizeNflRedraftPlayerStats({
    playerId: input.playerId,
    position: input.position,
    rawStats: input.correctedStats,
  })
  const correctionVersion = correctionVersionFromStats(previous) + 1
  return {
    normalizedStats: {
      ...corrected,
      [NFL_REDRAFT_STAT_CORRECTION_VERSION_KEY]: correctionVersion,
    },
    correctionVersion,
  }
}

export function buildScoringRuntimeEvent(input: {
  leagueId: string
  type: CanonicalLeagueRuntimeEventType | string
  occurredAt?: Date | string | null
  actorUserId?: string | null
  payload?: Record<string, unknown>
}): CanonicalLeagueRuntimeEvent {
  return toCanonicalLeagueRuntimeEvent({
    leagueId: input.leagueId,
    eventType: input.type,
    createdAt: input.occurredAt,
    actorUserId: input.actorUserId ?? null,
    payload: input.payload ?? {},
  })
}

export function buildScoringRuntimeEvents(input: {
  state: NflRedraftLiveScoringRuntimeState
  actorUserId?: string | null
  includePlayerEvents?: boolean
}): CanonicalLeagueRuntimeEvent[] {
  const events: CanonicalLeagueRuntimeEvent[] = [
    buildScoringRuntimeEvent({
      leagueId: input.state.leagueId,
      type: 'scoring.period.opened',
      actorUserId: input.actorUserId,
      payload: { seasonId: input.state.seasonId, week: input.state.week },
    }),
  ]

  for (const team of input.state.teams) {
    if (!team.lineupLegal) {
      events.push(
        buildScoringRuntimeEvent({
          leagueId: input.state.leagueId,
          type: 'lineup.illegal.flagged',
          actorUserId: input.actorUserId,
          payload: { rosterId: team.rosterId, week: input.state.week, issues: team.illegalLineupIssues },
        }),
      )
    }
    events.push(
      buildScoringRuntimeEvent({
        leagueId: input.state.leagueId,
        type: 'scoring.team_score.updated',
        actorUserId: input.actorUserId,
        payload: {
          rosterId: team.rosterId,
          week: input.state.week,
          starterTotal: team.starterTotal,
          benchTotal: team.benchTotal,
          missingStarterPlayerIds: team.missingStarterPlayerIds,
        },
      }),
    )
    if (input.includePlayerEvents) {
      for (const player of [...team.starters, ...team.bench, ...team.ir].filter((row) => row.hasStats)) {
        events.push(
          buildScoringRuntimeEvent({
            leagueId: input.state.leagueId,
            type: 'scoring.player_stat.ingested',
            actorUserId: input.actorUserId,
            payload: { rosterId: team.rosterId, playerId: player.playerId, week: input.state.week, section: player.section },
          }),
          buildScoringRuntimeEvent({
            leagueId: input.state.leagueId,
            type: 'scoring.fantasy_points.calculated',
            actorUserId: input.actorUserId,
            payload: { rosterId: team.rosterId, playerId: player.playerId, week: input.state.week, fantasyPoints: player.fantasyPoints },
          }),
        )
      }
    }
  }

  for (const matchup of input.state.matchups) {
    events.push(
      buildScoringRuntimeEvent({
        leagueId: input.state.leagueId,
        type: 'scoring.matchup_score.updated',
        actorUserId: input.actorUserId,
        payload: {
          matchupId: matchup.matchupId,
          week: matchup.week,
          homeScore: matchup.homeScore,
          awayScore: matchup.awayScore,
          status: matchup.status,
        },
      }),
    )
    if (matchup.complete) {
      events.push(
        buildScoringRuntimeEvent({
          leagueId: input.state.leagueId,
          type: 'matchup.finalized',
          actorUserId: input.actorUserId,
          payload: {
            matchupId: matchup.matchupId,
            week: matchup.week,
            winnerRosterId: matchup.winnerRosterId,
            tied: matchup.tied,
          },
        }),
      )
    }
  }

  events.push(
    buildScoringRuntimeEvent({
      leagueId: input.state.leagueId,
      type: 'standings.recalculated',
      actorUserId: input.actorUserId,
      payload: { seasonId: input.state.seasonId, week: input.state.week, standingsRows: input.state.standings.length },
    }),
  )

  return events
}
