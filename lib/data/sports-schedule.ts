import 'server-only'

import { prisma } from '@/lib/prisma'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'
import { SUPPORTED_SPORTS, type SupportedSport } from '@/lib/sport-scope'

export type ChimmySportDigest = {
  text: string
  sources: string[]
  freshness: {
    overallLastSyncedAt: string | null
    perSource: Record<string, string | null>
  }
}

type TeamCatalogRow = {
  sport: string
  name: string
  shortName: string | null
  city: string | null
  externalId: string
}

type TeamCandidate = TeamCatalogRow & {
  score: number
  resolvedCode: string | null
}

type ScheduleGameRow = {
  source: 'game_schedules' | 'sports_game'
  sport: SupportedSport
  homeTeam: string | null
  awayTeam: string | null
  status: string | null
  startTime: Date | null
  homeScore: number | null
  awayScore: number | null
  updatedAt: Date | null
}

const SCHEDULE_QUESTION_RE = /\b(next\s+game|play\s+next|who\s+do(?:es)?\s+.*\s+play|when\s+is\s+the\s+next\s+.*\s+game|what\s+is\s+the\s+next\s+game|this\s+week|upcoming\s+game|next\s+opponent|next\s+matchup|schedule)\b/i

const STOPWORDS = new Set([
  'when',
  'who',
  'what',
  'does',
  'do',
  'is',
  'are',
  'the',
  'a',
  'an',
  'my',
  'our',
  'their',
  'this',
  'next',
  'game',
  'games',
  'play',
  'plays',
  'playing',
  'against',
  'vs',
  'versus',
  'opponent',
  'matchup',
  'schedule',
  'team',
  'teams',
  'week',
  'tonight',
  'today',
  'tomorrow',
  'latest',
  'upcoming',
  'future',
])

function isScheduleQuestion(question: string): boolean {
  return SCHEDULE_QUESTION_RE.test(question)
}

function tokenizeQuestion(question: string): string[] {
  const rawTokens = question
    .split(/\s+/)
    .map((token) => token.replace(/[^a-zA-Z0-9'.-]/g, '').trim())
    .filter(Boolean)
    .map((token) => token.toLowerCase())

  const tokens: string[] = []
  for (const token of rawTokens) {
    if (!STOPWORDS.has(token) && token.length >= 2) {
      tokens.push(token)
    }
  }
  return tokens
}

function humanizeDate(date: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }).format(date)
  } catch {
    return date.toISOString()
  }
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function scoreCandidate(
  candidate: TeamCatalogRow,
  tokens: string[],
  questionLower: string,
  sportHint: SupportedSport | 'all'
): TeamCandidate | null {
  const name = candidate.name.toLowerCase()
  const shortName = candidate.shortName?.toLowerCase() ?? ''
  const city = candidate.city?.toLowerCase() ?? ''
  const externalId = candidate.externalId.toLowerCase()
  const resolvedCode = normalizeTeamAbbrev(candidate.shortName ?? candidate.externalId ?? candidate.name)

  let score = 0
  for (const token of tokens) {
    if (!token) continue
    const singular = token.endsWith('s') ? token.slice(0, -1) : token
    if (shortName === token || shortName === singular) score += 12
    if (shortName.includes(token) || shortName.includes(singular)) score += 9
    if (name === token || name === singular) score += 10
    if (name.includes(token) || name.includes(singular)) score += 6
    if (city === token || city === singular) score += 5
    if (city.includes(token) || city.includes(singular)) score += 3
    if (externalId === token || externalId === singular) score += 4
    if (externalId.includes(token) || externalId.includes(singular)) score += 2
  }

  if (questionLower.includes(name)) score += 4
  if (shortName && questionLower.includes(shortName)) score += 5
  if (city && questionLower.includes(city)) score += 2

  if (sportHint !== 'all' && candidate.sport === sportHint) {
    score += 1
  }

  if (score <= 0) return null

  return {
    ...candidate,
    score,
    resolvedCode,
  }
}

function buildClarificationText(matches: TeamCandidate[]): string {
  const options = matches
    .slice(0, 4)
    .map((match) => `${match.name} (${match.sport})`)
    .join(', ')

  return options
    ? `### Schedule lookup\n- I found more than one team that could match that question: ${options}. Please clarify the team or league.`
    : '### Schedule lookup\n- I need the team name or league to answer that schedule question.'
}

function buildUnavailableText(teamName: string, sport: SupportedSport | 'all'): string {
  const scope = sport === 'all' ? 'the requested sport' : sport
  return `### Schedule lookup\n- I found ${teamName} in ${scope}, but verified future schedule data is not available yet.`
}

function mapSportsGameRow(row: {
  sport: string
  homeTeam: string
  awayTeam: string
  status: string | null
  startTime: Date | null
  homeScore: number | null
  awayScore: number | null
  updatedAt: Date
}): ScheduleGameRow | null {
  const sport = row.sport as SupportedSport
  if (!(SUPPORTED_SPORTS as readonly string[]).includes(sport)) return null
  if (!row.startTime || Number.isNaN(row.startTime.getTime())) return null
  return {
    source: 'sports_game',
    sport,
    homeTeam: row.homeTeam,
    awayTeam: row.awayTeam,
    status: row.status,
    startTime: row.startTime,
    homeScore: row.homeScore,
    awayScore: row.awayScore,
    updatedAt: row.updatedAt,
  }
}

function mapGameScheduleRow(row: {
  sportType: string
  homeTeam: string | null
  awayTeam: string | null
  status: string
  startTime: Date | null
  homeScore: number | null
  awayScore: number | null
  updatedAt: Date
}): ScheduleGameRow | null {
  const sport = row.sportType as SupportedSport
  if (!(SUPPORTED_SPORTS as readonly string[]).includes(sport)) return null
  if (!row.startTime || Number.isNaN(row.startTime.getTime())) return null
  return {
    source: 'game_schedules',
    sport,
    homeTeam: row.homeTeam,
    awayTeam: row.awayTeam,
    status: row.status,
    startTime: row.startTime,
    homeScore: row.homeScore,
    awayScore: row.awayScore,
    updatedAt: row.updatedAt,
  }
}

function scoreGameForTeam(game: ScheduleGameRow, team: TeamCandidate): boolean {
  const teamCode = team.resolvedCode?.toUpperCase() ?? null
  const teamName = team.name.toUpperCase()
  const shortName = team.shortName?.toUpperCase() ?? null
  const city = team.city?.toUpperCase() ?? null
  const rowHome = (game.homeTeam ?? '').toUpperCase()
  const rowAway = (game.awayTeam ?? '').toUpperCase()

  const rowValues = [rowHome, rowAway]
  const candidates = [teamCode, shortName, teamName, city].filter((value): value is string => Boolean(value))

  for (const rowValue of rowValues) {
    for (const candidateValue of candidates) {
      if (rowValue === candidateValue) return true
      if (rowValue.includes(candidateValue) || candidateValue.includes(rowValue)) return true
    }
  }

  return false
}

async function findNextGameForTeam(
  team: TeamCandidate,
  timezone: string
): Promise<{
  text: string
  sources: string[]
  freshness: Record<string, string | null>
} | null> {
  const now = new Date()

  const scheduleRows = await prisma.gameSchedule.findMany({
    where: {
      sportType: team.sport,
      startTime: { gte: now },
    },
    orderBy: { startTime: 'asc' },
    take: 200,
    select: {
      sportType: true,
      homeTeam: true,
      awayTeam: true,
      status: true,
      startTime: true,
      homeScore: true,
      awayScore: true,
      updatedAt: true,
    },
  })

  const normalizedScheduleRows = scheduleRows
    .map((row) => mapGameScheduleRow(row))
    .filter((row): row is ScheduleGameRow => Boolean(row))
    .filter((row) => scoreGameForTeam(row, team))

  const sportsGameRows = await prisma.sportsGame.findMany({
    where: {
      sport: team.sport,
      startTime: { gte: now },
    },
    orderBy: { startTime: 'asc' },
    take: 200,
    select: {
      sport: true,
      homeTeam: true,
      awayTeam: true,
      status: true,
      startTime: true,
      homeScore: true,
      awayScore: true,
      updatedAt: true,
    },
  })

  const normalizedSportsRows = sportsGameRows
    .map((row) => mapSportsGameRow(row))
    .filter((row): row is ScheduleGameRow => Boolean(row))
    .filter((row) => scoreGameForTeam(row, team))

  const nextGame = [...normalizedScheduleRows, ...normalizedSportsRows]
    .filter((row) => row.startTime && row.startTime >= now)
    .sort((a, b) => (a.startTime?.getTime() ?? 0) - (b.startTime?.getTime() ?? 0))[0]

  if (!nextGame) {
    return null
  }

  const homeTeam = nextGame.homeTeam ?? 'TBD'
  const awayTeam = nextGame.awayTeam ?? 'TBD'
  const isHome = team.resolvedCode != null && homeTeam.toUpperCase() === team.resolvedCode.toUpperCase()
  const opponent = isHome ? awayTeam : homeTeam
  if (!opponent || opponent === 'TBD') {
    return null
  }

  const status = nextGame.status?.trim()
  if (!status) {
    return null
  }

  const startTime = nextGame.startTime
  if (!startTime || Number.isNaN(startTime.getTime())) {
    return null
  }

  const sourceKey = `${nextGame.source}_${team.sport}`
  return {
    text: `### Schedule lookup (DB-only)\n- ${team.name} (${team.sport}) next game: ${team.shortName ?? team.name} vs ${opponent} on ${humanizeDate(startTime, timezone)}. Status: ${status}.`,
    sources: [sourceKey],
    freshness: {
      [sourceKey]: toIso(nextGame.updatedAt ?? nextGame.startTime),
    },
  }
}

export async function buildChimmyScheduleDigest(args: {
  question: string
  sport: SupportedSport | 'all'
  timezone?: string
}): Promise<ChimmySportDigest | null> {
  const question = args.question.trim()
  if (!question || !isScheduleQuestion(question)) return null

  const tokens = tokenizeQuestion(question)
  const questionLower = question.toLowerCase()
  const timezone = args.timezone ?? 'America/New_York'

  const catalogRows = await prisma.sportsTeam.findMany({
    select: {
      sport: true,
      name: true,
      shortName: true,
      city: true,
      externalId: true,
    },
  })

  const candidates = catalogRows
    .map((row) => scoreCandidate(row, tokens, questionLower, args.sport))
    .filter((row): row is TeamCandidate => Boolean(row))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))

  if (candidates.length === 0) {
    return {
      text: '### Schedule lookup\n- I could not resolve a team from the database. Please specify the team or league.',
      sources: [],
      freshness: { overallLastSyncedAt: null, perSource: {} },
    }
  }

  const topScore = candidates[0]?.score ?? 0
  const topCandidates = candidates.filter((candidate) => candidate.score === topScore)

  if (topCandidates.length > 1) {
    return {
      text: buildClarificationText(topCandidates),
      sources: [],
      freshness: { overallLastSyncedAt: null, perSource: {} },
    }
  }

  const resolved = topCandidates[0]
  if (!resolved) {
    return {
      text: '### Schedule lookup\n- I could not resolve a team from the database. Please specify the team or league.',
      sources: [],
      freshness: { overallLastSyncedAt: null, perSource: {} },
    }
  }

  const nextGameDigest = await findNextGameForTeam(resolved, timezone)
  if (!nextGameDigest) {
    return {
      text: buildUnavailableText(resolved.name, args.sport),
      sources: [],
      freshness: { overallLastSyncedAt: null, perSource: {} },
    }
  }

  return {
    text: nextGameDigest.text,
    sources: nextGameDigest.sources,
    freshness: {
      overallLastSyncedAt: nextGameDigest.freshness[nextGameDigest.sources[0] ?? ''] ?? null,
      perSource: nextGameDigest.freshness,
    },
  }
}