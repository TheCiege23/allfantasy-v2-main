import { prisma } from '@/lib/prisma'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import type {
  FantraxImportDraftPick,
  FantraxImportPayload,
  FantraxImportTeam,
  FantraxImportTransaction,
} from '@/lib/league-import/adapters/fantrax/types'

type LegacyStanding = {
  rank?: unknown
  team?: unknown
  wins?: unknown
  losses?: unknown
  ties?: unknown
  pointsFor?: unknown
  pointsAgainst?: unknown
}

type LegacyMatchup = {
  week?: unknown
  awayTeam?: unknown
  awayScore?: unknown
  homeTeam?: unknown
  homeScore?: unknown
  isPlayoff?: unknown
}

type LegacyRosterPlayer = {
  fantraxId?: unknown
  name?: unknown
  primaryPosition?: unknown
  position?: unknown
  nflTeam?: unknown
}

type LegacyTransaction = {
  type?: unknown
  player?: unknown
  position?: unknown
  team?: unknown
  date?: unknown
  week?: unknown
  managerTeam?: unknown
  fromTeam?: unknown
  toTeam?: unknown
  isDraftPick?: unknown
  pickRound?: unknown
  pickNumber?: unknown
}

export class FantraxImportConnectionError extends Error {}
export class FantraxImportLeagueNotFoundError extends Error {}

interface FantraxSourceLookup {
  leagueRecordId?: string
  username?: string
  leagueName?: string
  season?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asNumber(value: unknown, fallback: number | null = null): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function asBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    return normalized === 'true' || normalized === '1' || normalized === 'yes'
  }
  return false
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function normalizeTeamLabel(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

function toIsoDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString()
}

function parseFantraxSourceInput(sourceInput: string): FantraxSourceLookup {
  const trimmed = sourceInput.trim()
  if (!trimmed) {
    throw new FantraxImportLeagueNotFoundError(
      'Fantrax source is required. Use a legacy Fantrax league ID or username.'
    )
  }

  const idPrefixed = trimmed.match(/^id:(.+)$/i)
  if (idPrefixed?.[1]) {
    return { leagueRecordId: idPrefixed[1].trim() }
  }

  const maybeUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  if (maybeUuid.test(trimmed)) {
    return { leagueRecordId: trimmed }
  }

  if (trimmed.includes('|')) {
    const [usernameRaw, secondRaw, ...rest] = trimmed.split('|').map((part) => part.trim())
    const username = usernameRaw || undefined
    if (!username) {
      throw new FantraxImportLeagueNotFoundError(
        'Fantrax source format is username|season|leagueName (or username|leagueName).'
      )
    }

    const secondNumber = asNumber(secondRaw, null)
    if (secondNumber != null) {
      return {
        username,
        season: secondNumber,
        leagueName: rest.join('|').trim() || undefined,
      }
    }
    return {
      username,
      leagueName: [secondRaw, ...rest].join('|').trim() || undefined,
    }
  }

  return { username: trimmed }
}

function resolveFantraxSport(rawSport: string, isDevy: boolean): string {
  const normalized = rawSport.trim().toLowerCase()
  if (normalized === 'cfb' || normalized === 'ncaaf' || normalized === 'college_football') {
    return 'NCAAF'
  }
  if (normalized === 'cbb' || normalized === 'ncaab' || normalized === 'college_basketball') {
    return 'NCAAB'
  }
  if (normalized === 'soccer' || normalized === 'futbol') {
    return 'SOCCER'
  }
  if (normalized === 'nfl' || normalized === 'nba' || normalized === 'mlb' || normalized === 'nhl') {
    return normalized.toUpperCase()
  }
  if (isDevy) return 'NCAAF'
  return normalizeToSupportedSport(rawSport)
}

function parseStandings(raw: unknown): LegacyStanding[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(isRecord) as LegacyStanding[]
}

function parseMatchups(raw: unknown): LegacyMatchup[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(isRecord) as LegacyMatchup[]
}

function parseRoster(raw: unknown): LegacyRosterPlayer[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(isRecord) as LegacyRosterPlayer[]
}

function parseTransactions(raw: unknown): LegacyTransaction[] {
  if (!isRecord(raw)) return []
  const groups = ['claims', 'drops', 'trades', 'lineupChanges', 'userTransactions'] as const
  const transactions: LegacyTransaction[] = []
  for (const key of groups) {
    const value = raw[key]
    if (!Array.isArray(value)) continue
    for (const entry of value) {
      if (isRecord(entry)) transactions.push(entry as LegacyTransaction)
    }
  }
  return transactions
}

function buildTeamIdMap(args: {
  standings: LegacyStanding[]
  matchups: LegacyMatchup[]
  userTeam: string
}): Map<string, string> {
  const labels: string[] = []
  for (const standing of args.standings) {
    const teamName = asString(standing.team)
    if (teamName) labels.push(teamName)
  }
  for (const matchup of args.matchups) {
    const awayTeam = asString(matchup.awayTeam)
    const homeTeam = asString(matchup.homeTeam)
    if (awayTeam) labels.push(awayTeam)
    if (homeTeam) labels.push(homeTeam)
  }
  if (args.userTeam) labels.push(args.userTeam)

  const map = new Map<string, string>()
  const slugCounts = new Map<string, number>()
  for (const label of labels) {
    const normalized = normalizeTeamLabel(label)
    if (!normalized || map.has(normalized)) continue
    const baseSlug = slugify(normalized) || 'team'
    const count = (slugCounts.get(baseSlug) ?? 0) + 1
    slugCounts.set(baseSlug, count)
    const suffix = count > 1 ? `-${count}` : ''
    map.set(normalized, `fantrax-team:${baseSlug}${suffix}`)
  }
  return map
}

function buildRosterPositionCounts(players: LegacyRosterPlayer[]): Array<{ position: string; count: number }> {
  const counts = new Map<string, number>()
  for (const player of players) {
    const position = asString(player.primaryPosition) || asString(player.position) || 'FLEX'
    const normalized = position.toUpperCase()
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([position, count]) => ({ position, count }))
}

function buildRosterPlayerMap(players: LegacyRosterPlayer[]): Record<string, { name: string; position: string; team: string }> {
  const map: Record<string, { name: string; position: string; team: string }> = {}
  for (const player of players) {
    const playerId = asString(player.fantraxId)
    if (!playerId) continue
    map[playerId] = {
      name: asString(player.name) || playerId,
      position: (asString(player.primaryPosition) || asString(player.position) || 'N/A').toUpperCase(),
      team: asString(player.nflTeam),
    }
  }
  return map
}

function buildSyntheticPlayerId(playerName: string, fallback: string): string {
  const slug = slugify(playerName)
  return `fantrax-player:${slug || fallback}`
}

function resolveTeamId(teamLabel: string, teamMap: Map<string, string>): string | null {
  const normalized = normalizeTeamLabel(teamLabel)
  if (!normalized) return null
  return teamMap.get(normalized) ?? null
}

export async function fetchFantraxLeagueForImport(
  userId: string,
  sourceInput: string
): Promise<FantraxImportPayload> {
  if (!userId) {
    throw new FantraxImportConnectionError('Sign in before importing from Fantrax.')
  }

  const lookup = parseFantraxSourceInput(sourceInput)
  const includeConfig = {
    user: {
      select: {
        id: true,
        fantraxUsername: true,
      },
    },
  } as const

  let leagueRecord:
    | (Awaited<ReturnType<typeof prisma.fantraxLeague.findUnique>> & {
        user: { id: string; fantraxUsername: string }
        appUserId: string | null
      })
    | null = null

  if (lookup.leagueRecordId) {
    leagueRecord = await prisma.fantraxLeague.findUnique({
      where: { id: lookup.leagueRecordId },
      include: includeConfig,
    }) as any
  } else if (lookup.username) {
    leagueRecord = await prisma.fantraxLeague.findFirst({
      where: {
        user: { fantraxUsername: lookup.username },
        leagueName: lookup.leagueName ?? undefined,
        season: lookup.season ?? undefined,
      },
      orderBy: [{ season: 'desc' }, { updatedAt: 'desc' }],
      include: includeConfig,
    }) as any
  }

  // Import Security Closure phase — real ownership enforcement. A snapshot
  // ID or username|season|leagueName lookup is not authorization. Reject
  // with the same "not found" error used for a genuinely missing snapshot
  // (never a distinct "forbidden" message) so an unauthorized caller can't
  // use this to probe which snapshots exist. A row with `appUserId: null`
  // (a legacy/unattributed row from before this phase) is not importable by
  // anyone until it is re-uploaded by its real owner — fails closed rather
  // than fabricating ownership.
  if (!leagueRecord || leagueRecord.appUserId !== userId) {
    throw new FantraxImportLeagueNotFoundError(
      'Fantrax league not found. Use a Fantrax legacy league ID (UUID), or username|season|leagueName.'
    )
  }

  const username = leagueRecord.user?.fantraxUsername ?? lookup.username ?? 'fantrax-user'
  const season = leagueRecord.season ?? new Date().getFullYear()
  const standings = parseStandings(leagueRecord.standings)
  const matchups = parseMatchups(leagueRecord.matchups)
  const rosterPlayers = parseRoster(leagueRecord.roster)
  const transactionRows = parseTransactions(leagueRecord.transactions)
  const userTeam = leagueRecord.userTeam?.trim() || username
  const sport = resolveFantraxSport(leagueRecord.sport ?? '', Boolean(leagueRecord.isDevy))
  const teamMap = buildTeamIdMap({
    standings,
    matchups,
    userTeam,
  })
  const rosterPlayerMap = buildRosterPlayerMap(rosterPlayers)
  const userTeamId = resolveTeamId(userTeam, teamMap)
  const standingsByNormalizedTeam = new Map<string, LegacyStanding>()
  for (const standing of standings) {
    const label = asString(standing.team)
    const normalized = normalizeTeamLabel(label)
    if (normalized) standingsByNormalizedTeam.set(normalized, standing)
  }

  const teams: FantraxImportTeam[] = Array.from(teamMap.entries()).map(([normalizedLabel, teamId], index) => {
    const standing = standingsByNormalizedTeam.get(normalizedLabel)
    const teamName = asString(standing?.team) || normalizedLabel
    const isUserTeam = normalizeTeamLabel(userTeam) === normalizedLabel
    const rosterPlayerIds = isUserTeam ? Object.keys(rosterPlayerMap) : []
    return {
      teamId,
      managerId: isUserTeam ? `fantrax-user:${username}` : `fantrax-manager:${slugify(teamName) || teamId}`,
      managerName: isUserTeam ? username : teamName,
      teamName,
      logoUrl: null,
      wins: asNumber(standing?.wins, 0) ?? 0,
      losses: asNumber(standing?.losses, 0) ?? 0,
      ties: asNumber(standing?.ties, 0) ?? 0,
      rank: asNumber(standing?.rank, index + 1),
      pointsFor: asNumber(standing?.pointsFor, 0) ?? 0,
      pointsAgainst: asNumber(standing?.pointsAgainst, null),
      faabRemaining: null,
      waiverPriority: null,
      rosterPlayerIds,
      starterPlayerIds: [],
      reservePlayerIds: rosterPlayerIds,
      playerMap: isUserTeam ? rosterPlayerMap : {},
    }
  })

  const scheduleByWeek = new Map<number, FantraxImportPayload['schedule'][number]['matchups']>()
  for (const matchup of matchups) {
    const week = asNumber(matchup.week, null)
    if (week == null || week < 1) continue
    const awayTeamName = asString(matchup.awayTeam)
    const homeTeamName = asString(matchup.homeTeam)
    const teamId1 = resolveTeamId(awayTeamName, teamMap)
    const teamId2 = resolveTeamId(homeTeamName, teamMap)
    if (!teamId1 || !teamId2) continue
    if (!scheduleByWeek.has(week)) scheduleByWeek.set(week, [])
    scheduleByWeek.get(week)!.push({
      teamId1,
      teamId2,
      points1: asNumber(matchup.awayScore, null) ?? undefined,
      points2: asNumber(matchup.homeScore, null) ?? undefined,
      isPlayoff: asBoolean(matchup.isPlayoff),
    })
  }

  const schedule = Array.from(scheduleByWeek.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([week, weekMatchups]) => ({
      week,
      season,
      matchups: weekMatchups,
    }))

  const transactions: FantraxImportTransaction[] = transactionRows.map((transaction, index) => {
    const type = asString(transaction.type).toLowerCase()
    const normalizedType =
      type === 'trade' ? 'trade' : type === 'drop' ? 'drop' : type === 'claim' ? 'waiver' : 'free_agent'
    const playerName = asString(transaction.player)
    const fallbackPlayer = `tx-${index + 1}`
    const playerId = buildSyntheticPlayerId(playerName, fallbackPlayer)
    const managerTeamId = resolveTeamId(asString(transaction.managerTeam), teamMap)
    const fromTeamId = resolveTeamId(asString(transaction.fromTeam), teamMap)
    const toTeamId = resolveTeamId(asString(transaction.toTeam), teamMap)
    const teamId = resolveTeamId(asString(transaction.team), teamMap)
    const rosterIds = Array.from(
      new Set([managerTeamId, fromTeamId, toTeamId, teamId].filter((id): id is string => Boolean(id)))
    )
    const adds: Record<string, string> = {}
    const drops: Record<string, string> = {}

    if (normalizedType === 'waiver' || normalizedType === 'free_agent') {
      const destination = toTeamId ?? managerTeamId ?? teamId
      if (destination && playerName) adds[playerId] = destination
    } else if (normalizedType === 'drop') {
      const sourceTeamId = fromTeamId ?? managerTeamId ?? teamId
      if (sourceTeamId && playerName) drops[playerId] = sourceTeamId
    } else if (normalizedType === 'trade') {
      if (fromTeamId && playerName) drops[playerId] = fromTeamId
      if (toTeamId && playerName) adds[playerId] = toTeamId
    }

    return {
      transactionId: `fantrax:${leagueRecord.id}:tx:${index + 1}:${slugify(playerName || fallbackPlayer)}`,
      type: normalizedType,
      status: 'completed',
      createdAt: toIsoDate(transaction.date),
      teamIds: rosterIds,
      adds,
      drops,
      isDraftPick: asBoolean(transaction.isDraftPick),
      pickRound: asNumber(transaction.pickRound, null),
      pickNumber: asNumber(transaction.pickNumber, null),
      playerId,
      playerName: playerName || null,
      position: asString(transaction.position) || null,
      team: asString(transaction.team) || null,
    }
  })

  const draftPicks: FantraxImportDraftPick[] = transactions
    .filter((transaction) => transaction.isDraftPick)
    .map((transaction) => {
      const round = transaction.pickRound ?? null
      const pickNumber = transaction.pickNumber ?? null
      if (round == null || pickNumber == null) return null
      const teamId = transaction.teamIds[0] ?? userTeamId ?? 'fantrax-team:unknown'
      const draftPlayerId = `fantrax-draft-pick:r${round}:p${pickNumber}`
      return {
        round,
        pickNumber,
        teamId,
        playerId: draftPlayerId,
        playerName: transaction.playerName ?? `Draft Pick R${round}P${pickNumber}`,
        position: null,
        team: null,
      } satisfies FantraxImportDraftPick
    })
    .filter(Boolean) as FantraxImportDraftPick[]

  const previousSeasonRecords = await prisma.fantraxLeague.findMany({
    where: {
      userId: leagueRecord.userId,
      leagueName: leagueRecord.leagueName,
      season: { lt: season },
    },
    select: {
      id: true,
      season: true,
    },
    orderBy: { season: 'desc' },
    take: 8,
  })

  return {
    sourceInput,
    league: {
      leagueId: leagueRecord.id,
      name: leagueRecord.leagueName,
      sport,
      season,
      size: leagueRecord.teamCount || teams.length,
      currentWeek: schedule.length > 0 ? schedule[schedule.length - 1]?.week ?? null : null,
      isFinished: season < new Date().getFullYear(),
      url: null,
      isDevy: Boolean(leagueRecord.isDevy),
    },
    settings: {
      scoringType: leagueRecord.isDevy ? 'devy' : null,
      rosterPositions: buildRosterPositionCounts(rosterPlayers),
      scoringRules: [],
      raw: {
        isDevy: leagueRecord.isDevy,
        sport: leagueRecord.sport,
        teamCount: leagueRecord.teamCount,
      },
    },
    teams,
    schedule,
    transactions,
    draftPicks,
    playerMap: rosterPlayerMap,
    previousSeasons: previousSeasonRecords.map((record) => ({
      season: String(record.season),
      sourceLeagueId: record.id,
    })),
  }
}
