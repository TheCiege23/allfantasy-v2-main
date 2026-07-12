import { normalizeTeamAbbrev } from '@/lib/team-abbrev'

export type CanonicalNflGameState = 'scheduled' | 'live' | 'final' | 'unknown'

export type CanonicalNflScore = {
  providerGameRef: string
  sport: 'NFL'
  league: 'NFL'
  season: number | null
  week: number | null
  state: CanonicalNflGameState
  statusLabel: string | null
  scheduledStartIso: string | null
  homeTeam: string
  awayTeam: string
  homeScore: number | null
  awayScore: number | null
  period: string | null
  clock: string | null
  sourceTimestampIso: string | null
  fetchedAtIso: string
  correctionVersion: string | null
}

export type CanonicalNflInjuryStatus =
  | 'active'
  | 'questionable'
  | 'doubtful'
  | 'out'
  | 'ir'
  | 'pup'
  | 'suspended'
  | 'unknown'

export type CanonicalNflInjury = {
  canonicalPlayerId: string | null
  providerPlayerRef: string | null
  playerName: string
  sport: 'NFL'
  team: string | null
  status: CanonicalNflInjuryStatus
  providerStatusLabel: string | null
  injuryType: string | null
  description: string | null
  participationStatus: string | null
  gameDesignation: string | null
  expectedReturnIso: string | null
  sourceTimestampIso: string | null
  fetchedAtIso: string
  confidence: 'resolved' | 'provider_reference_only' | 'unknown'
}

type UnknownRecord = Record<string, unknown>

function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' ? value as UnknownRecord : {}
}

function text(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return null
}

function numberOrNull(...values: unknown[]): number | null {
  for (const value of values) {
    if (value === '' || value == null) continue
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function isoOrNull(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value < 10_000_000_000 ? value * 1000 : value)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }
  if (typeof value !== 'string' || !value.trim()) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function normalizeNflGameState(value: unknown): CanonicalNflGameState {
  const label = String(value ?? '').trim().toLowerCase()
  if (/final|finished|complete|after extra|aet|ft/.test(label)) return 'final'
  if (/scheduled|not started|pre game|pregame|tbd|ns/.test(label)) return 'scheduled'
  if (/live|in progress|quarter|half|overtime|\bot\b|q[1-4]/.test(label)) return 'live'
  return 'unknown'
}

export function normalizeNflInjuryStatus(value: unknown): CanonicalNflInjuryStatus {
  const label = String(value ?? '').trim().toLowerCase()
  if (!label) return 'unknown'
  if (/injured reserve|\bir\b/.test(label)) return 'ir'
  if (/physically unable|\bpup\b/.test(label)) return 'pup'
  if (/suspend/.test(label)) return 'suspended'
  if (/out|inactive/.test(label)) return 'out'
  if (/doubt/.test(label)) return 'doubtful'
  if (/question|game.?time decision|gtd/.test(label)) return 'questionable'
  if (/active|healthy|available|full participant|probable/.test(label)) return 'active'
  return 'unknown'
}

export function normalizeNflScoreRow(
  input: unknown,
  options: { fetchedAtIso?: string; season?: number | null; week?: number | null } = {},
): CanonicalNflScore | null {
  const row = record(input)
  const game = record(row.game)
  const date = record(game.date)
  const status = record(game.status)
  const teams = record(row.teams)
  const home = record(teams.home)
  const away = record(teams.away)
  const scores = record(row.scores)
  const homeScores = record(scores.home)
  const awayScores = record(scores.away)
  const league = record(row.league)
  const providerGameRef = text(game.id, row.gameId, row.id, row.externalId)
  const homeTeam = normalizeTeamAbbrev(text(home.name, row.homeTeam, row.home_team) ?? '')
  const awayTeam = normalizeTeamAbbrev(text(away.name, row.awayTeam, row.away_team) ?? '')
  if (!providerGameRef || !homeTeam || !awayTeam) return null

  const statusLabel = text(status.long, status.short, row.status, row.gameStatus)
  const rawWeek = text(game.week, row.week)
  const parsedWeek = rawWeek ? numberOrNull(rawWeek.replace(/\D/g, '')) : null
  const fetchedAtIso = options.fetchedAtIso ?? new Date().toISOString()
  return {
    providerGameRef,
    sport: 'NFL',
    league: 'NFL',
    season: numberOrNull(league.season, row.season, options.season),
    week: parsedWeek ?? options.week ?? null,
    state: normalizeNflGameState(statusLabel),
    statusLabel,
    scheduledStartIso: isoOrNull(date.timestamp ?? date.date ?? game.startTime ?? row.startTime),
    homeTeam,
    awayTeam,
    homeScore: numberOrNull(homeScores.total, row.homeScore, row.home_score),
    awayScore: numberOrNull(awayScores.total, row.awayScore, row.away_score),
    period: text(game.period, row.period, row.quarter),
    clock: text(game.clock, row.clock),
    sourceTimestampIso: isoOrNull(row.updatedAt ?? row.fetchedAt ?? row.timestamp),
    fetchedAtIso,
    correctionVersion: text(row.correctionVersion, row.version),
  }
}

export function normalizeNflInjuryRow(
  input: unknown,
  options: { fetchedAtIso?: string; canonicalPlayerId?: string | null } = {},
): CanonicalNflInjury | null {
  const row = record(input)
  const player = record(row.player)
  const team = record(row.team)
  const playerName = text(player.name, row.playerName, row.player_name, row.name)
  if (!playerName) return null
  const providerPlayerRef = text(player.id, row.playerId, row.player_id)
  const canonicalPlayerId = options.canonicalPlayerId?.trim() || null
  const providerStatusLabel = text(row.status, row.state, row.designation)
  return {
    canonicalPlayerId,
    providerPlayerRef,
    playerName,
    sport: 'NFL',
    team: normalizeTeamAbbrev(text(team.name, row.teamAbbrev, row.team_name) ?? '') || null,
    status: normalizeNflInjuryStatus(providerStatusLabel),
    providerStatusLabel,
    injuryType: text(row.type, row.injury, row.bodyArea),
    description: text(row.description, row.details),
    participationStatus: text(row.participationStatus, row.practiceStatus),
    gameDesignation: text(row.gameDesignation, row.designation, row.status),
    expectedReturnIso: isoOrNull(row.expectedReturn ?? row.returnDate),
    sourceTimestampIso: isoOrNull(row.date ?? row.updatedAt ?? row.fetchedAt),
    fetchedAtIso: options.fetchedAtIso ?? new Date().toISOString(),
    confidence: canonicalPlayerId ? 'resolved' : providerPlayerRef ? 'provider_reference_only' : 'unknown',
  }
}
