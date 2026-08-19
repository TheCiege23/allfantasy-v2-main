import { getDecryptedAuth } from '@/lib/league-sync-core'
import type {
  EspnImportDraftPick,
  EspnImportLeague,
  EspnImportPayload,
  EspnImportScheduleWeek,
  EspnImportSettings,
  EspnImportTeam,
  EspnImportTransaction,
} from '@/lib/league-import/adapters/espn/types'

const ESPN_API_BASE = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl'
const CURRENT_IMPORT_SEASON = new Date().getFullYear()
const ESPN_IMPORT_VIEWS = ['mTeam', 'mRoster', 'mMatchup', 'mScoreboard', 'mSettings']
const ESPN_DISCOVERY_VIEWS = ['mTeam', 'mSettings']
const ESPN_DRAFT_VIEWS = ['mDraftDetail']
const ESPN_ACTIVITY_MESSAGE_TYPE_IDS = [178, 180, 179, 239, 181, 244] as const
const ESPN_TRANSACTIONS_MIN_SEASON = 2019
const ESPN_HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'Mozilla/5.0 (compatible; AllFantasy/1.0)',
}

const ESPN_ACTIVITY_TYPE_MAP: Record<
  number,
  { type: 'free_agent' | 'waiver' | 'drop' | 'trade'; description: string }
> = {
  178: { type: 'free_agent', description: 'added' },
  179: { type: 'drop', description: 'dropped' },
  180: { type: 'waiver', description: 'added' },
  181: { type: 'waiver', description: 'dropped' },
  239: { type: 'drop', description: 'dropped' },
  244: { type: 'trade', description: 'traded_away' },
}

const ESPN_SLOT_LABELS: Record<number, string> = {
  0: 'QB',
  1: 'TQB',
  2: 'RB',
  3: 'RB/WR',
  4: 'WR',
  5: 'WR/TE',
  6: 'TE',
  7: 'SUPER_FLEX',
  8: 'DT',
  9: 'DE',
  10: 'LB',
  11: 'DL',
  12: 'CB',
  13: 'S',
  14: 'DB',
  15: 'DP',
  16: 'D/ST',
  17: 'K',
  18: 'P',
  19: 'HC',
  20: 'BE',
  21: 'IR',
  23: 'FLEX',
  24: 'EDR',
}

const ESPN_POSITION_LABELS: Record<number, string> = {
  1: 'QB',
  2: 'RB',
  3: 'WR',
  4: 'TE',
  5: 'K',
  16: 'D/ST',
}

const ESPN_TEAM_ABBREVIATIONS: Record<number, string> = {
  1: 'ATL',
  2: 'BUF',
  3: 'CHI',
  4: 'CIN',
  5: 'CLE',
  6: 'DAL',
  7: 'DEN',
  8: 'DET',
  9: 'GB',
  10: 'TEN',
  11: 'IND',
  12: 'KC',
  13: 'LV',
  14: 'LAR',
  15: 'MIA',
  16: 'MIN',
  17: 'NE',
  18: 'NO',
  19: 'NYG',
  20: 'NYJ',
  21: 'PHI',
  22: 'ARI',
  23: 'PIT',
  24: 'LAC',
  25: 'SF',
  26: 'SEA',
  27: 'TB',
  28: 'WAS',
  29: 'CAR',
  30: 'JAX',
  33: 'BAL',
  34: 'HOU',
}

const ESPN_RESERVE_SLOTS = new Set([20, 21])

type EspnAuthContext = {
  swid: string | null
  espnS2: string | null
}

type EspnMemberSummary = {
  id: string
  displayName: string
  isCommissioner?: boolean
}

type EspnPlayerSummary = {
  name: string | null
  position: string | null
  team: string | null
}

class EspnApiResponseError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export class EspnImportConnectionError extends Error {}

export class EspnImportLeagueNotFoundError extends Error {}

export interface EspnFetchOptions {
  includePreviousSeasons?: boolean
  maxPreviousSeasons?: number
  minSeason?: number
}

const DEFAULT_FETCH_OPTIONS: Required<EspnFetchOptions> = {
  includePreviousSeasons: true,
  maxPreviousSeasons: 6,
  minSeason: 2010,
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseNumber(value: unknown, fallback: number | null = null): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function toPositiveInt(value: unknown, fallback: number): number {
  const parsed = parseNumber(value, null)
  return parsed != null && parsed > 0 ? Math.floor(parsed) : fallback
}

function buildEspnLeagueUrl(leagueId: string, season: number, views: string[] = ESPN_IMPORT_VIEWS): string {
  const query = views.map((view) => `view=${encodeURIComponent(view)}`).join('&')
  return `${ESPN_API_BASE}/seasons/${season}/segments/0/leagues/${leagueId}?${query}`
}

function buildEspnCommunicationUrl(leagueId: string, season: number): string {
  return `${ESPN_API_BASE}/seasons/${season}/segments/0/leagues/${leagueId}/communication/?view=kona_league_communication`
}

function buildEspnActivityFilter(limit = 1000): string {
  return JSON.stringify({
    topics: {
      filterType: { value: ['ACTIVITY_TRANSACTIONS'] },
      limit,
      limitPerMessageSet: { value: limit },
      filterIncludeMessageTypeIds: { value: [...ESPN_ACTIVITY_MESSAGE_TYPE_IDS] },
      sortMessageDate: {
        sortPriority: 1,
        sortAsc: false,
      },
    },
  })
}

export function parseEspnSourceInput(sourceInput: string): { leagueId: string; season: number } {
  const trimmed = sourceInput.trim()
  if (!trimmed) {
    throw new EspnImportLeagueNotFoundError('ESPN league ID is required.')
  }

  let leagueId = ''
  let season = CURRENT_IMPORT_SEASON

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      const url = new URL(trimmed)
      const leagueIdParam = url.searchParams.get('leagueId')
      const seasonIdParam = url.searchParams.get('seasonId')
      if (leagueIdParam) leagueId = leagueIdParam.replace(/\D/g, '')
      if (seasonIdParam) season = toPositiveInt(seasonIdParam, season)
    } catch {
      // Fall through to shorthand parsing.
    }
  }

  if (!leagueId) {
    const seasonFirst = trimmed.match(/^(\d{4})[:/](\d+)$/)
    const leagueFirst = trimmed.match(/^(\d+)[@:](\d{4})$/)
    const leagueIdMatch = trimmed.match(/leagueId=(\d+)/i)
    const seasonIdMatch = trimmed.match(/seasonId=(\d{4})/i)

    if (seasonFirst) {
      season = toPositiveInt(seasonFirst[1], season)
      leagueId = seasonFirst[2]
    } else if (leagueFirst) {
      leagueId = leagueFirst[1]
      season = toPositiveInt(leagueFirst[2], season)
    } else if (leagueIdMatch) {
      leagueId = leagueIdMatch[1]
      if (seasonIdMatch) season = toPositiveInt(seasonIdMatch[1], season)
    } else if (/^\d+$/.test(trimmed)) {
      leagueId = trimmed
    }
  }

  if (!leagueId) {
    throw new EspnImportLeagueNotFoundError(
      'Enter an ESPN league ID, a full ESPN league URL, or a season-prefixed value like 2025:12345678.'
    )
  }

  return { leagueId, season }
}

const ESPN_FETCH_RETRIES = 3
const ESPN_FETCH_TIMEOUT_MS = 12000

const espnFetchDelay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Resilient ESPN GET: per-request timeout plus bounded retries with exponential
 * backoff on TRANSIENT failures only (network error / timeout / 5xx / 429).
 * Definitive statuses (401/403/404/other 4xx) throw EspnApiResponseError
 * immediately so the cookie-fallback and private-league messaging in
 * loadEspnLeagueRaw keep their exact semantics. Exhausted retries throw a
 * plain Error with an honest attempt count — never a silent null.
 */
async function fetchEspnJsonByUrl(
  url: string,
  cookieHeader?: string | null,
  extraHeaders?: Record<string, string>
): Promise<any> {
  const headers = cookieHeader
    ? {
        ...ESPN_HEADERS,
        ...extraHeaders,
        Cookie: cookieHeader,
      }
    : {
        ...ESPN_HEADERS,
        ...extraHeaders,
      }

  let lastError: unknown = null
  for (let attempt = 0; attempt < ESPN_FETCH_RETRIES; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), ESPN_FETCH_TIMEOUT_MS)
    let response: Response
    try {
      response = await fetch(url, {
        headers,
        cache: 'no-store',
        signal: controller.signal,
      })
    } catch (err) {
      clearTimeout(timer)
      lastError = err
      if (attempt < ESPN_FETCH_RETRIES - 1) {
        await espnFetchDelay(300 * 2 ** attempt)
        continue
      }
      break
    }
    clearTimeout(timer)

    if (response.ok) {
      return response.json()
    }

    if ((response.status >= 500 || response.status === 429) && attempt < ESPN_FETCH_RETRIES - 1) {
      await espnFetchDelay(300 * 2 ** attempt)
      continue
    }

    const body = await response.text()
    throw new EspnApiResponseError(response.status, body || response.statusText)
  }

  throw new Error(
    `ESPN request failed after ${ESPN_FETCH_RETRIES} attempts (${
      lastError instanceof Error ? lastError.message : 'network error'
    }).`,
  )
}

async function fetchEspnJson(
  leagueId: string,
  season: number,
  cookieHeader?: string | null,
  views: string[] = ESPN_IMPORT_VIEWS,
  extraHeaders?: Record<string, string>
): Promise<any> {
  return fetchEspnJsonByUrl(buildEspnLeagueUrl(leagueId, season, views), cookieHeader, extraHeaders)
}

async function getEspnAuthForUser(userId: string): Promise<EspnAuthContext> {
  const auth = await getDecryptedAuth(userId, 'espn')
  return {
    swid: auth?.espnSwid ?? null,
    espnS2: auth?.espnS2 ?? null,
  }
}

function buildEspnCookieHeader(context: EspnAuthContext): string | null {
  if (!context.swid || !context.espnS2) return null
  return `SWID=${context.swid}; espn_s2=${context.espnS2}`
}

async function loadEspnLeagueRaw(args: {
  leagueId: string
  season: number
  auth: EspnAuthContext
  views?: string[]
}): Promise<any> {
  const cookieHeader = buildEspnCookieHeader(args.auth)
  const attempts = cookieHeader ? [cookieHeader, null] : [null]
  let lastError: unknown = null

  for (const attempt of attempts) {
    try {
      return await fetchEspnJson(args.leagueId, args.season, attempt, args.views ?? ESPN_IMPORT_VIEWS)
    } catch (error) {
      lastError = error

      if (!(error instanceof EspnApiResponseError)) {
        throw error
      }

      if (error.status === 404) {
        throw new EspnImportLeagueNotFoundError(
          `ESPN league "${args.leagueId}" was not found for season ${args.season}.`
        )
      }

      if (error.status !== 401 && error.status !== 403) {
        throw error
      }
    }
  }

  if (lastError instanceof EspnApiResponseError && (lastError.status === 401 || lastError.status === 403)) {
    if (cookieHeader) {
      throw new EspnImportConnectionError(
        'Your saved ESPN cookies no longer unlock this league. Reconnect ESPN in Settings → Connected Accounts and try again.'
      )
    }
    throw new EspnImportConnectionError(
      'This ESPN league is private. Connect ESPN in Settings → Connected Accounts before importing it.'
    )
  }

  throw lastError instanceof Error ? lastError : new Error('Failed to load ESPN league data.')
}

async function loadOptionalEspnUrlRaw(args: {
  url: string
  auth: EspnAuthContext
  extraHeaders?: Record<string, string>
}): Promise<any | null> {
  const cookieHeader = buildEspnCookieHeader(args.auth)
  const attempts = cookieHeader ? [cookieHeader, null] : [null]

  for (const attempt of attempts) {
    try {
      return await fetchEspnJsonByUrl(args.url, attempt, args.extraHeaders)
    } catch (error) {
      if (!(error instanceof EspnApiResponseError)) {
        throw error
      }

      if (error.status === 400 || error.status === 401 || error.status === 403 || error.status === 404) {
        continue
      }

      throw error
    }
  }

  return null
}

async function loadOptionalEspnLeagueRaw(args: {
  leagueId: string
  season: number
  auth: EspnAuthContext
  views: string[]
}): Promise<any | null> {
  return loadOptionalEspnUrlRaw({
    url: buildEspnLeagueUrl(args.leagueId, args.season, args.views),
    auth: args.auth,
  })
}

async function loadOptionalEspnTransactionsRaw(args: {
  leagueId: string
  season: number
  auth: EspnAuthContext
  limit?: number
}): Promise<any | null> {
  if (args.season < ESPN_TRANSACTIONS_MIN_SEASON) {
    return null
  }

  return loadOptionalEspnUrlRaw({
    url: buildEspnCommunicationUrl(args.leagueId, args.season),
    auth: args.auth,
    extraHeaders: {
      'x-fantasy-filter': buildEspnActivityFilter(args.limit ?? 1000),
    },
  })
}

function buildEspnMemberDirectory(rawMembers: unknown): Map<string, EspnMemberSummary> {
  const directory = new Map<string, EspnMemberSummary>()
  if (!Array.isArray(rawMembers)) return directory

  for (const member of rawMembers) {
    if (!isRecord(member)) continue
    const idCandidates = [member.id, member.memberId, member.guid]
      .map((value) => (value == null ? '' : String(value).trim()))
      .filter(Boolean)
    const memberType = String(member.memberType ?? member.role ?? '').trim().toLowerCase()
    const isCommissioner =
      member.isLeagueManager === true ||
      member.isManager === true ||
      member.isLeagueManager === 1 ||
      member.isManager === 1 ||
      memberType === 'lm' ||
      memberType === 'league_manager' ||
      memberType === 'manager'
    const displayName =
      typeof member.displayName === 'string' && member.displayName.trim()
        ? member.displayName.trim()
        : `${typeof member.firstName === 'string' ? member.firstName : ''} ${typeof member.lastName === 'string' ? member.lastName : ''}`.trim()

    for (const id of idCandidates) {
      directory.set(id, {
        id,
        displayName: displayName || id,
        isCommissioner,
      })
    }
  }

  return directory
}

function resolveEspnOwners(team: Record<string, any>, members: Map<string, EspnMemberSummary>) {
  const ownerRefs = Array.isArray(team.owners) ? team.owners : []
  const resolvedOwners: EspnMemberSummary[] = []

  for (const ownerRef of ownerRefs) {
    if (isRecord(ownerRef)) {
      const ownerId = String(ownerRef.id ?? ownerRef.memberId ?? ownerRef.guid ?? '').trim()
      const displayName =
        typeof ownerRef.displayName === 'string' && ownerRef.displayName.trim()
          ? ownerRef.displayName.trim()
          : `${typeof ownerRef.firstName === 'string' ? ownerRef.firstName : ''} ${typeof ownerRef.lastName === 'string' ? ownerRef.lastName : ''}`.trim()
      if (ownerId || displayName) {
        resolvedOwners.push({
          id: ownerId || displayName || String(team.id ?? 'manager'),
          displayName: displayName || members.get(ownerId)?.displayName || ownerId || String(team.id ?? 'Manager'),
        })
      }
      continue
    }

    const ownerId = String(ownerRef ?? '').trim()
    if (!ownerId) continue
    resolvedOwners.push(members.get(ownerId) ?? { id: ownerId, displayName: ownerId })
  }

  const uniqueOwners = resolvedOwners.filter(
    (owner, index, array) =>
      array.findIndex((candidate) => candidate.id === owner.id && candidate.displayName === owner.displayName) === index
  )

  const managerId = uniqueOwners[0]?.id ?? String(team.primaryOwner ?? team.id ?? 'manager')
  const managerName = uniqueOwners.map((owner) => owner.displayName).filter(Boolean).join(' / ')

  return {
    managerId,
    managerName: managerName || `Manager ${managerId}`,
  }
}

function parseEspnSettings(raw: any): EspnImportSettings | null {
  const settings = isRecord(raw?.settings) ? raw.settings : null
  if (!settings) return null

  const rosterSettings = isRecord(settings.rosterSettings) ? settings.rosterSettings : {}
  const scoringSettings = isRecord(settings.scoringSettings) ? settings.scoringSettings : {}
  const acquisitionSettings = isRecord(settings.acquisitionSettings) ? settings.acquisitionSettings : {}
  const scheduleSettings = isRecord(settings.scheduleSettings) ? settings.scheduleSettings : {}
  const draftSettings = isRecord(settings.draftSettings) ? settings.draftSettings : {}
  const lineupSlotCountsRaw = isRecord(rosterSettings.lineupSlotCounts) ? rosterSettings.lineupSlotCounts : {}
  const scoringItemsRaw = Array.isArray(scoringSettings.scoringItems) ? scoringSettings.scoringItems : []

  const lineupSlotCounts = Object.entries(lineupSlotCountsRaw)
    .map(([slotId, count]) => ({
      slotId: toPositiveInt(slotId, 0),
      slot: ESPN_SLOT_LABELS[toPositiveInt(slotId, 0)] ?? `SLOT_${slotId}`,
      count: toPositiveInt(count, 0),
    }))
    .filter((slot) => slot.count > 0)
    .sort((a, b) => a.slotId - b.slotId)

  const scoringItems = scoringItemsRaw
    .map((item: unknown) => {
      if (!isRecord(item)) return null
      const statId = parseNumber(item.statId, null)
      if (statId == null) return null
      return {
        statId,
        points: parseNumber(item.points, 0) ?? 0,
      }
    })
    .filter(Boolean) as EspnImportSettings['scoringItems']

  return {
    scoringType: typeof scoringSettings.scoringType === 'string' ? scoringSettings.scoringType : null,
    draftType: typeof draftSettings.type === 'string' ? draftSettings.type : null,
    lineupSlotCounts,
    scoringItems,
    usesFaab: Boolean(
      acquisitionSettings.isUsingAcquisitionBudget ??
        acquisitionSettings.useAcquisitionBudget ??
        acquisitionSettings.acquisitionBudget
    ),
    acquisitionBudget: parseNumber(acquisitionSettings.acquisitionBudget, null),
    waiverProcessDay:
      parseNumber(acquisitionSettings.waiverProcessDays, null) ??
      parseNumber(acquisitionSettings.waiverProcessDay, null),
    playoffTeamCount: parseNumber(scheduleSettings.playoffTeamCount, null),
    matchupPeriodCount: parseNumber(scheduleSettings.matchupPeriodCount, null),
    regularSeasonMatchupCount: parseNumber(scheduleSettings.matchupPeriodCount, null),
    raw: settings,
  }
}

function buildEspnTeamName(team: Record<string, any>, fallback: string): string {
  const location = typeof team.location === 'string' ? team.location.trim() : ''
  const nickname = typeof team.nickname === 'string' ? team.nickname.trim() : ''
  if (location && nickname) return `${location} ${nickname}`.trim()
  if (typeof team.name === 'string' && team.name.trim()) return team.name.trim()
  if (typeof team.abbrev === 'string' && team.abbrev.trim()) return team.abbrev.trim()
  return fallback
}

function parseEspnRosterEntries(entries: unknown): {
  playerIds: string[]
  starterIds: string[]
  reserveIds: string[]
  playerMap: Record<string, { name: string; position: string; team: string }>
} {
  const playerIds: string[] = []
  const starterIds: string[] = []
  const reserveIds: string[] = []
  const playerMap: Record<string, { name: string; position: string; team: string }> = {}

  if (!Array.isArray(entries)) {
    return { playerIds, starterIds, reserveIds, playerMap }
  }

  for (const entry of entries) {
    if (!isRecord(entry)) continue
    const playerPoolEntry = isRecord(entry.playerPoolEntry) ? entry.playerPoolEntry : {}
    const player = isRecord(playerPoolEntry.player) ? playerPoolEntry.player : {}
    const playerId = String(entry.playerId ?? player.id ?? playerPoolEntry.id ?? '').trim()
    if (!playerId) continue

    const lineupSlotId = toPositiveInt(entry.lineupSlotId, 20)
    const isReserve = ESPN_RESERVE_SLOTS.has(lineupSlotId)
    const playerName =
      typeof player.fullName === 'string' && player.fullName.trim()
        ? player.fullName.trim()
        : `Player ${playerId}`
    const positionId = toPositiveInt(player.defaultPositionId, 0)
    const teamId = toPositiveInt(player.proTeamId, 0)

    playerIds.push(playerId)
    if (isReserve) {
      reserveIds.push(playerId)
    } else {
      starterIds.push(playerId)
    }
    playerMap[playerId] = {
      name: playerName,
      position: ESPN_POSITION_LABELS[positionId] ?? 'N/A',
      team: ESPN_TEAM_ABBREVIATIONS[teamId] ?? '',
    }
  }

  return { playerIds, starterIds, reserveIds, playerMap }
}

function getEspnTeamRank(team: Record<string, any>): number | null {
  return (
    parseNumber(team.rankCalculatedFinal, null) ??
    parseNumber(team.currentProjectedRank, null) ??
    parseNumber(team.playoffSeed, null) ??
    parseNumber(team.record?.overall?.rank, null)
  )
}

function computeEspnStandingsRanks(teams: EspnImportTeam[]): Map<string, number> {
  const ranked = [...teams].sort((a, b) => {
    const gamesA = a.wins + a.losses + a.ties
    const gamesB = b.wins + b.losses + b.ties
    const pctA = gamesA > 0 ? (a.wins + a.ties * 0.5) / gamesA : 0
    const pctB = gamesB > 0 ? (b.wins + b.ties * 0.5) / gamesB : 0
    if (pctB !== pctA) return pctB - pctA
    if (b.pointsFor !== a.pointsFor) return b.pointsFor - a.pointsFor
    if ((a.pointsAgainst ?? Number.POSITIVE_INFINITY) !== (b.pointsAgainst ?? Number.POSITIVE_INFINITY)) {
      return (a.pointsAgainst ?? Number.POSITIVE_INFINITY) - (b.pointsAgainst ?? Number.POSITIVE_INFINITY)
    }
    return a.teamName.localeCompare(b.teamName)
  })

  return new Map(ranked.map((team, index) => [team.teamId, index + 1]))
}

function parseEspnTeams(raw: any, settings: EspnImportSettings | null): EspnImportTeam[] {
  const members = buildEspnMemberDirectory(raw?.members)
  const teamsRaw = Array.isArray(raw?.teams) ? raw.teams : []
  const teams = teamsRaw
    .filter(isRecord)
    .map((team: Record<string, any>) => {
      const teamId = String(team.id ?? '').trim()
      if (!teamId) return null

      const { managerId, managerName } = resolveEspnOwners(team, members)
      const roster = parseEspnRosterEntries(team.roster?.entries)
      const record = isRecord(team.record?.overall) ? team.record.overall : {}
      const acquisitionBudgetSpent = parseNumber(team.transactionCounter?.acquisitionBudgetSpent, null)
      const faabRemaining =
        parseNumber(team.waiverBudgetRemaining, null) ??
        (settings?.acquisitionBudget != null && acquisitionBudgetSpent != null
          ? Math.max(0, settings.acquisitionBudget - acquisitionBudgetSpent)
          : null)

      return {
        teamId,
        managerId,
        managerName,
        teamName: buildEspnTeamName(team, managerName),
        logoUrl: typeof team.logo === 'string' ? team.logo : null,
        wins: parseNumber(record.wins, 0) ?? 0,
        losses: parseNumber(record.losses, 0) ?? 0,
        ties: parseNumber(record.ties, 0) ?? 0,
        rank: getEspnTeamRank(team),
        pointsFor: parseNumber(record.pointsFor, 0) ?? 0,
        pointsAgainst: parseNumber(record.pointsAgainst, null),
        faabRemaining,
        waiverPriority: parseNumber(team.waiverRank, null),
        rosterPlayerIds: roster.playerIds,
        starterPlayerIds: roster.starterIds,
        reservePlayerIds: roster.reserveIds,
        playerMap: roster.playerMap,
      }
    })
    .filter(Boolean) as EspnImportTeam[]

  const computedRanks = computeEspnStandingsRanks(teams)
  for (const team of teams) {
    if (team.rank == null) {
      team.rank = computedRanks.get(team.teamId) ?? null
    }
  }

  return teams
}

function normalizeEspnSwidSegment(id: string): string {
  return id.replace(/[{}]/g, '').trim().toLowerCase()
}

/**
 * Resolve the logged-in ESPN member's fantasy team id from raw league JSON using SWID cookie.
 */
export function resolveEspnViewerTeamId(raw: unknown, swid: string | null | undefined): string | null {
  if (!swid || !isRecord(raw)) return null
  const target = normalizeEspnSwidSegment(swid)
  if (!target) return null

  const teamsRaw = Array.isArray(raw.teams) ? raw.teams : []
  for (const team of teamsRaw) {
    if (!isRecord(team)) continue
    const teamId = String(team.id ?? '').trim()
    if (!teamId) continue

    const ownerRefs = Array.isArray(team.owners) ? team.owners : []
    for (const ownerRef of ownerRefs) {
      const oid =
        isRecord(ownerRef) && ownerRef
          ? String(ownerRef.id ?? ownerRef.memberId ?? ownerRef.guid ?? '').trim()
          : String(ownerRef ?? '').trim()
      if (oid && normalizeEspnSwidSegment(oid) === target) {
        return teamId
      }
    }

    if (team.primaryOwner != null) {
      const ps = String(team.primaryOwner).trim()
      if (ps && normalizeEspnSwidSegment(ps) === target) {
        return teamId
      }
    }
  }

  return null
}

function resolveEspnCommissionerTeamIds(raw: unknown): string[] {
  if (!isRecord(raw)) return []
  const members = buildEspnMemberDirectory(raw.members)
  const commissionerIds = new Set(
    Array.from(members.values())
      .filter((member) => member.isCommissioner)
      .map((member) => normalizeEspnSwidSegment(member.id))
      .filter(Boolean)
  )
  if (commissionerIds.size === 0) return []

  const teamIds = new Set<string>()
  const teamsRaw = Array.isArray(raw.teams) ? raw.teams : []
  for (const team of teamsRaw) {
    if (!isRecord(team)) continue
    const teamId = String(team.id ?? '').trim()
    if (!teamId) continue

    const ownerRefs = Array.isArray(team.owners) ? team.owners : []
    const ownerIds = ownerRefs
      .map((ownerRef) => {
        if (isRecord(ownerRef)) {
          return String(ownerRef.id ?? ownerRef.memberId ?? ownerRef.guid ?? '').trim()
        }
        return String(ownerRef ?? '').trim()
      })
      .filter(Boolean)

    if (
      ownerIds.some((ownerId) => commissionerIds.has(normalizeEspnSwidSegment(ownerId))) ||
      (team.primaryOwner != null && commissionerIds.has(normalizeEspnSwidSegment(String(team.primaryOwner))))
    ) {
      teamIds.add(teamId)
    }
  }

  return Array.from(teamIds)
}

function upsertEspnMatchup(
  weeks: Map<number, EspnImportScheduleWeek['matchups']>,
  week: number,
  teamId1: string,
  teamId2: string,
  points1?: number,
  points2?: number
) {
  if (!teamId1 || !teamId2) return
  if (!weeks.has(week)) {
    weeks.set(week, [])
  }
  const matchups = weeks.get(week)!
  const matchupKey = [teamId1, teamId2].sort().join('::')
  const existing = matchups.find((matchup) => [matchup.teamId1, matchup.teamId2].sort().join('::') === matchupKey)
  if (existing) {
    if (typeof points1 === 'number') existing.points1 = points1
    if (typeof points2 === 'number') existing.points2 = points2
    return
  }

  matchups.push({
    teamId1,
    teamId2,
    points1,
    points2,
  })
}

function parseEspnSchedule(raw: any, season: number, currentWeek: number | null): EspnImportScheduleWeek[] {
  const weeks = new Map<number, EspnImportScheduleWeek['matchups']>()
  const scheduleRaw = Array.isArray(raw?.schedule) ? raw.schedule : []

  for (const matchup of scheduleRaw) {
    if (!isRecord(matchup)) continue
    const week = parseNumber(matchup.matchupPeriodId, null)
    if (week == null || week < 1) continue
    const home = isRecord(matchup.home) ? matchup.home : {}
    const away = isRecord(matchup.away) ? matchup.away : {}
    const teamId1 = String(home.teamId ?? '').trim()
    const teamId2 = String(away.teamId ?? '').trim()
    upsertEspnMatchup(
      weeks,
      week,
      teamId1,
      teamId2,
      parseNumber(home.totalPoints, null) ?? undefined,
      parseNumber(away.totalPoints, null) ?? undefined
    )
  }

  const scoreboardMatchups = Array.isArray(raw?.scoreboard?.matchups) ? raw.scoreboard.matchups : []
  const scoreboardWeek = currentWeek ?? parseNumber(raw?.scoringPeriodId, null)
  if (scoreboardWeek != null) {
    for (const matchup of scoreboardMatchups) {
      if (!isRecord(matchup)) continue
      const home = isRecord(matchup.home) ? matchup.home : {}
      const away = isRecord(matchup.away) ? matchup.away : {}
      const teamId1 = String(home.teamId ?? '').trim()
      const teamId2 = String(away.teamId ?? '').trim()
      upsertEspnMatchup(
        weeks,
        scoreboardWeek,
        teamId1,
        teamId2,
        parseNumber(home.totalPoints, null) ?? undefined,
        parseNumber(away.totalPoints, null) ?? undefined
      )
    }
  }

  return Array.from(weeks.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([week, matchups]) => ({
      week,
      season,
      matchups,
    }))
}

function toEspnIsoDate(value: unknown): string | null {
  const parsed = parseNumber(value, null)
  if (parsed == null) return null
  const millis = parsed < 1_000_000_000_000 ? parsed * 1000 : parsed
  const date = new Date(millis)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function buildEspnPlayerDirectory(teams: EspnImportTeam[]): Map<string, EspnPlayerSummary> {
  const directory = new Map<string, EspnPlayerSummary>()

  for (const team of teams) {
    for (const [playerId, player] of Object.entries(team.playerMap)) {
      directory.set(playerId, {
        name: player.name ?? null,
        position: player.position ?? null,
        team: player.team ?? null,
      })
    }
  }

  return directory
}

function resolveEspnPlayerSummary(
  playerId: string,
  playerDirectory: Map<string, EspnPlayerSummary>,
  rawPlayer?: unknown
): EspnPlayerSummary {
  const fallback = playerDirectory.get(playerId)
  const container = isRecord(rawPlayer) ? rawPlayer : {}
  const fromPool = isRecord(container.playerPoolEntry) && isRecord(container.playerPoolEntry.player)
    ? container.playerPoolEntry.player
    : null
  const player = fromPool ?? (isRecord(container.player) ? container.player : container)
  const fullName =
    typeof player.fullName === 'string' && player.fullName.trim()
      ? player.fullName.trim()
      : typeof player.name === 'string' && player.name.trim()
        ? player.name.trim()
        : fallback?.name ?? null
  const positionId = parseNumber(player.defaultPositionId, null)
  const proTeamId = parseNumber(player.proTeamId, null)
  const position =
    typeof player.position === 'string' && player.position.trim()
      ? player.position.trim()
      : positionId != null
        ? ESPN_POSITION_LABELS[positionId] ?? fallback?.position ?? null
        : fallback?.position ?? null
  const team =
    typeof player.proTeamAbbrev === 'string' && player.proTeamAbbrev.trim()
      ? player.proTeamAbbrev.trim()
      : proTeamId != null
        ? ESPN_TEAM_ABBREVIATIONS[proTeamId] ?? fallback?.team ?? null
        : fallback?.team ?? null

  return {
    name: fullName,
    position,
    team,
  }
}

function parseEspnDraftPicks(
  raw: any,
  playerDirectory: Map<string, EspnPlayerSummary>
): EspnImportDraftPick[] {
  const draftDetail =
    isRecord(raw?.draftDetail) ? raw.draftDetail : isRecord(raw?.content?.draftDetail) ? raw.content.draftDetail : null
  const picks = Array.isArray(draftDetail?.picks) ? draftDetail.picks : []
  const sourceDraftId =
    draftDetail && (draftDetail.id != null || draftDetail.guid != null)
      ? String(draftDetail.id ?? draftDetail.guid)
      : null

  return picks
    .map((pick: unknown) => {
      if (!isRecord(pick)) return null
      const round = parseNumber(pick.roundId ?? pick.round, null)
      const pickNumber = parseNumber(pick.roundPickNumber ?? pick.pickNumber, null)
      const overallPickNumber = parseNumber(pick.overallPickNumber, pickNumber)
      const teamId = String(pick.teamId ?? pick.bidTeamId ?? '').trim()
      const playerId = String(pick.playerId ?? pick.targetId ?? '').trim()
      if (round == null || pickNumber == null || overallPickNumber == null || !teamId || !playerId) {
        return null
      }

      const player = resolveEspnPlayerSummary(playerId, playerDirectory, pick)
      return {
        round,
        pickNumber,
        overallPickNumber,
        teamId,
        playerId,
        playerName: player.name,
        position: player.position,
        team: player.team,
        sourceDraftId,
        bidAmount: parseNumber(pick.bidAmount, null),
        isKeeper:
          typeof pick.keeper === 'boolean'
            ? pick.keeper
            : typeof pick.reservedForKeeper === 'boolean'
              ? pick.reservedForKeeper
              : null,
      }
    })
    .filter(Boolean) as EspnImportDraftPick[]
}

function parseEspnTransactions(
  raw: any,
  playerDirectory: Map<string, EspnPlayerSummary>
): EspnImportTransaction[] {
  const topics = Array.isArray(raw?.topics) ? raw.topics : Array.isArray(raw?.content?.topics) ? raw.content.topics : []
  const transactions: EspnImportTransaction[] = []

  for (const [topicIndex, topic] of topics.entries()) {
    if (!isRecord(topic)) continue
    const messages = Array.isArray(topic.messages) ? topic.messages : []
    const createdAt = toEspnIsoDate(topic.date)
    const topicStatus =
      typeof topic.status === 'string' && topic.status.trim() ? topic.status.trim().toLowerCase() : 'processed'
    const topicId = topic.id != null ? String(topic.id).trim() : ''

    for (const [messageIndex, message] of messages.entries()) {
      if (!isRecord(message)) continue
      const messageTypeId = parseNumber(message.messageTypeId, null)
      if (messageTypeId == null || !(messageTypeId in ESPN_ACTIVITY_TYPE_MAP)) continue

      const activity = ESPN_ACTIVITY_TYPE_MAP[messageTypeId]
      const playerId = String(message.targetId ?? message.playerId ?? '').trim()
      const fromId = String(message.from ?? '').trim()
      const toId = String(message.to ?? '').trim()
      const forId = String(message.for ?? '').trim()
      const adds: Record<string, string> = {}
      const drops: Record<string, string> = {}
      const teamIds: string[] = []
      let bidAmount: number | null = null
      let tradePartnerTeamId: string | null = null

      switch (messageTypeId) {
        case 178:
          if (playerId && toId) adds[playerId] = toId
          if (toId) teamIds.push(toId)
          break
        case 179:
          if (playerId && toId) drops[playerId] = toId
          if (toId) teamIds.push(toId)
          break
        case 180:
          if (playerId && toId) adds[playerId] = toId
          if (toId) teamIds.push(toId)
          bidAmount = parseNumber(fromId, null)
          break
        case 181:
          if (playerId && toId) drops[playerId] = toId
          if (toId) teamIds.push(toId)
          break
        case 239:
          if (playerId && forId) drops[playerId] = forId
          if (forId) teamIds.push(forId)
          break
        case 244:
          if (playerId && fromId) drops[playerId] = fromId
          if (playerId && toId) adds[playerId] = toId
          if (fromId) teamIds.push(fromId)
          if (toId) teamIds.push(toId)
          tradePartnerTeamId = toId || null
          break
      }

      const player = playerId ? resolveEspnPlayerSummary(playerId, playerDirectory, message) : null
      const uniqueTeamIds = Array.from(new Set(teamIds.filter(Boolean)))
      if (!playerId && uniqueTeamIds.length === 0) continue

      transactions.push({
        transactionId:
          String(message.id ?? '').trim() ||
          [topicId, String(topic.date ?? ''), String(messageTypeId), playerId, fromId, toId, forId, String(topicIndex), String(messageIndex)]
            .filter(Boolean)
            .join(':'),
        type: activity.type,
        typeDescription: activity.description,
        status: topicStatus,
        createdAt,
        teamIds: uniqueTeamIds,
        adds,
        drops,
        playerId: playerId || null,
        playerName: player?.name ?? null,
        position: player?.position ?? null,
        team: player?.team ?? null,
        bidAmount,
        tradePartnerTeamId,
        messageTypeId,
      })
    }
  }

  return transactions
}

function inferEspnSeasonFinished(args: {
  season: number
  currentWeek: number | null
  raw: any
}): boolean {
  if (args.season < CURRENT_IMPORT_SEASON) return true

  const finalScoringPeriod = parseNumber(args.raw?.status?.finalScoringPeriod, null)
  if (finalScoringPeriod != null && args.currentWeek != null) {
    return args.currentWeek >= finalScoringPeriod
  }

  return false
}

async function discoverEspnPreviousSeasons(args: {
  leagueId: string
  season: number
  auth: EspnAuthContext
  maxPreviousSeasons: number
  minSeason: number
}): Promise<Array<{ season: string; sourceLeagueId: string }>> {
  const previousSeasons: Array<{ season: string; sourceLeagueId: string }> = []

  for (
    let candidateSeason = args.season - 1;
    candidateSeason >= args.minSeason && previousSeasons.length < args.maxPreviousSeasons;
    candidateSeason -= 1
  ) {
    try {
      await loadEspnLeagueRaw({
        leagueId: args.leagueId,
        season: candidateSeason,
        auth: args.auth,
        views: ESPN_DISCOVERY_VIEWS,
      })
      previousSeasons.push({
        season: String(candidateSeason),
        sourceLeagueId: args.leagueId,
      })
    } catch (error) {
      if (error instanceof EspnImportLeagueNotFoundError) {
        break
      }
      if (error instanceof EspnImportConnectionError) {
        break
      }
      throw error
    }
  }

  return previousSeasons
}

function fillEspnPointsAgainst(teams: EspnImportTeam[], schedule: EspnImportScheduleWeek[]) {
  const pointsAgainstByTeam = new Map<string, number>()

  for (const week of schedule) {
    for (const matchup of week.matchups) {
      if (typeof matchup.points2 === 'number') {
        pointsAgainstByTeam.set(
          matchup.teamId1,
          (pointsAgainstByTeam.get(matchup.teamId1) ?? 0) + matchup.points2
        )
      }
      if (typeof matchup.points1 === 'number') {
        pointsAgainstByTeam.set(
          matchup.teamId2,
          (pointsAgainstByTeam.get(matchup.teamId2) ?? 0) + matchup.points1
        )
      }
    }
  }

  for (const team of teams) {
    if (team.pointsAgainst == null && pointsAgainstByTeam.has(team.teamId)) {
      team.pointsAgainst = pointsAgainstByTeam.get(team.teamId) ?? null
    }
  }
}

export async function fetchEspnLeagueForImport(
  userId: string,
  sourceInput: string,
  options: EspnFetchOptions = {}
): Promise<EspnImportPayload> {
  const opts = { ...DEFAULT_FETCH_OPTIONS, ...options }
  const { leagueId, season } = parseEspnSourceInput(sourceInput)
  const auth = await getEspnAuthForUser(userId)
  const raw = await loadEspnLeagueRaw({
    leagueId,
    season,
    auth,
    views: ESPN_IMPORT_VIEWS,
  })
  const [draftRaw, transactionsRaw] = await Promise.all([
    loadOptionalEspnLeagueRaw({
      leagueId,
      season,
      auth,
      views: ESPN_DRAFT_VIEWS,
    }),
    loadOptionalEspnTransactionsRaw({
      leagueId,
      season,
      auth,
    }),
  ])

  const settings = parseEspnSettings(raw)
  const currentWeek =
    parseNumber(raw?.status?.currentMatchupPeriod, null) ??
    parseNumber(raw?.scoringPeriodId, null)
  const league: EspnImportLeague = {
    leagueId,
    name:
      typeof raw?.settings?.name === 'string' && raw.settings.name.trim()
        ? raw.settings.name.trim()
        : `ESPN League ${leagueId}`,
    sport: 'NFL',
    season,
    size: parseNumber(raw?.settings?.size, Array.isArray(raw?.teams) ? raw.teams.length : 0) ?? 0,
    currentWeek,
    isFinished: inferEspnSeasonFinished({ season, currentWeek, raw }),
    playoffTeamCount: settings?.playoffTeamCount ?? null,
    regularSeasonLength:
      settings?.regularSeasonMatchupCount ?? settings?.matchupPeriodCount ?? null,
  }

  const teams = parseEspnTeams(raw, settings)
  if (teams.length === 0) {
    throw new EspnImportLeagueNotFoundError(
      `ESPN league "${leagueId}" was found, but no team data was available for import.`
    )
  }

  const schedule = parseEspnSchedule(raw, season, currentWeek)
  fillEspnPointsAgainst(teams, schedule)
  const playerDirectory = buildEspnPlayerDirectory(teams)
  const draftPicks = parseEspnDraftPicks(draftRaw, playerDirectory)
  const transactions = parseEspnTransactions(transactionsRaw, playerDirectory)
  const previousSeasons = opts.includePreviousSeasons
    ? await discoverEspnPreviousSeasons({
        leagueId,
        season,
        auth,
        maxPreviousSeasons: opts.maxPreviousSeasons,
        minSeason: opts.minSeason,
      })
    : []

  const viewerTeamId = resolveEspnViewerTeamId(raw, auth.swid)
  const commissionerTeamIds = resolveEspnCommissionerTeamIds(raw)

  return {
    sourceInput,
    league,
    settings,
    teams,
    schedule,
    transactions,
    draftPicks,
    transactionsFetched: transactionsRaw != null,
    draftFetched: draftRaw != null,
    previousSeasons,
    viewerTeamId,
    commissionerTeamIds,
  }
}
