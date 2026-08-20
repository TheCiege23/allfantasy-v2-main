import { decrypt, encrypt } from '@/lib/league-auth-crypto'
import { prisma } from '@/lib/prisma'
import type {
  YahooImportDraftPick,
  YahooImportLeague,
  YahooImportPayload,
  YahooImportScheduleWeek,
  YahooImportSettings,
  YahooImportTeam,
  YahooImportTransaction,
} from '@/lib/league-import/adapters/yahoo/types'

const YAHOO_API_BASE = 'https://fantasysports.yahooapis.com/fantasy/v2' // db-first-exception: ingestion service endpoint
const YAHOO_LEAGUE_LIST_URL =
  `${YAHOO_API_BASE}/users;use_login=1/games;game_keys=nfl,nba,mlb,nhl/leagues?format=json`
const YAHOO_RESERVE_POSITIONS = new Set(['BN', 'BE', 'IR', 'IL', 'NA', 'DL'])

type YahooApiFetchContext = {
  userId: string
  accessToken: string
  refreshToken: string | null
}

export type YahooLeagueLookup = {
  leagueKey: string
  season: number | null
  sport: string | null
  name: string | null
  numTeams: number | null
}

type YahooStandingDetails = {
  wins: number
  losses: number
  ties: number
  rank: number | null
  pointsFor: number
  pointsAgainst: number | null
  faabBalance: number | null
  clinchedPlayoffs: boolean
  managerId: string
  managerGuid: string | null
  managerName: string
  teamName: string
  logoUrl: string | null
}

type YahooTeamMetadata = {
  teamName: string
  logoUrl: string | null
  waiverPriority: number | null
  managerId: string
  managerGuid: string | null
  managerName: string
  isCommissioner: boolean
}

export class YahooApiResponseError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export class YahooImportConnectionError extends Error {}

export class YahooImportLeagueNotFoundError extends Error {}

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

function parseBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') return value === '1' || value.toLowerCase() === 'true'
  return false
}

function getYahooProperty(source: unknown, key: string): any {
  if (!source) return undefined
  if (Array.isArray(source)) {
    for (const item of source) {
      if (isRecord(item) && key in item) return item[key]
    }
    return undefined
  }
  if (isRecord(source) && key in source) return source[key]
  return undefined
}

function getYahooCollectionItems(source: unknown): any[] {
  if (!isRecord(source)) return []
  return Object.keys(source)
    .filter((key) => key !== 'count')
    .map((key) => source[key])
    .filter(Boolean)
}

function mergeYahooEntityFragments(wrapper: unknown, entityKey: string): Record<string, any> {
  const entity = isRecord(wrapper) ? wrapper[entityKey] : wrapper
  if (Array.isArray(entity)) {
    const fragments = Array.isArray(entity[0]) ? entity[0] : entity
    const merged: Record<string, any> = {}
    for (const fragment of fragments) {
      if (isRecord(fragment)) Object.assign(merged, fragment)
    }
    return merged
  }
  if (isRecord(entity)) return { ...entity }
  return {}
}

function getYahooManagers(source: unknown): Array<Record<string, any>> {
  const managers = getYahooProperty(source, 'managers')
  if (Array.isArray(managers)) {
    return managers.flatMap((item) => {
      if (isRecord(item) && Array.isArray(item.manager)) {
        return item.manager.filter(isRecord)
      }
      if (isRecord(item) && isRecord(item.manager)) {
        return [item.manager]
      }
      return isRecord(item) ? [item] : []
    })
  }
  if (isRecord(managers) && Array.isArray(managers.manager)) {
    return managers.manager.filter(isRecord)
  }
  if (isRecord(managers) && isRecord(managers.manager)) {
    return [managers.manager]
  }
  return []
}

function isTruthyProviderFlag(value: unknown): boolean {
  if (value === true) return true
  const normalized = String(value ?? '').trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes'
}

function isYahooCommissionerManager(manager: Record<string, any>): boolean {
  return [
    manager.is_commissioner,
    manager.isCommissioner,
    manager.is_co_commissioner,
    manager.isCoCommissioner,
    manager.is_co_manager,
    manager.isCoManager,
    manager.co_manager,
  ].some(isTruthyProviderFlag)
}

function getYahooLogoUrl(source: unknown): string | null {
  const logos = getYahooProperty(source, 'team_logos')
  if (Array.isArray(logos)) {
    for (const item of logos) {
      if (isRecord(item) && Array.isArray(item.team_logo) && isRecord(item.team_logo[0])) {
        return item.team_logo[0].url ?? null
      }
      if (isRecord(item) && isRecord(item.team_logo)) {
        return item.team_logo.url ?? null
      }
    }
  }
  if (isRecord(logos) && Array.isArray(logos.team_logo) && isRecord(logos.team_logo[0])) {
    return logos.team_logo[0].url ?? null
  }
  if (isRecord(logos) && isRecord(logos.team_logo)) {
    return logos.team_logo.url ?? null
  }
  return null
}

function inferSportFromYahooUrl(url: string | null | undefined): string | null {
  const normalized = (url ?? '').toLowerCase()
  if (normalized.includes('football.')) return 'NFL'
  if (normalized.includes('basketball.')) return 'NBA'
  if (normalized.includes('baseball.')) return 'MLB'
  if (normalized.includes('hockey.')) return 'NHL'
  return null
}

function buildManagerIdentity(source: unknown, fallback: string): {
  managerId: string
  managerGuid: string | null
  managerName: string
} {
  const manager = getYahooManagers(source)[0] ?? {}
  const managerId = String(manager.manager_id ?? manager.guid ?? fallback)
  const managerGuid = typeof manager.guid === 'string' ? manager.guid : null
  const managerName =
    typeof manager.nickname === 'string' && manager.nickname.trim()
      ? manager.nickname.trim()
      : typeof manager.guid === 'string'
        ? manager.guid
        : fallback
  return { managerId, managerGuid, managerName }
}

function createImportTeam(
  teamKey: string,
  standing: YahooStandingDetails | undefined,
  metadata: YahooTeamMetadata | undefined,
  roster: ReturnType<typeof parseYahooRoster>
): YahooImportTeam {
  const manager = metadata ?? standing
  return {
    teamKey,
    teamId: teamKey.split('.t.')[1] ?? teamKey,
    managerId: manager?.managerId ?? teamKey,
    managerGuid: manager?.managerGuid ?? null,
    managerName: manager?.managerName ?? standing?.teamName ?? metadata?.teamName ?? teamKey,
    teamName: standing?.teamName ?? metadata?.teamName ?? teamKey,
    logoUrl: metadata?.logoUrl ?? standing?.logoUrl ?? null,
    wins: standing?.wins ?? 0,
    losses: standing?.losses ?? 0,
    ties: standing?.ties ?? 0,
    rank: standing?.rank ?? null,
    pointsFor: standing?.pointsFor ?? 0,
    pointsAgainst: standing?.pointsAgainst ?? null,
    faabBalance: standing?.faabBalance ?? null,
    waiverPriority: metadata?.waiverPriority ?? null,
    clinchedPlayoffs: standing?.clinchedPlayoffs ?? false,
    rosterPlayerIds: roster.playerIds,
    starterPlayerIds: roster.starterIds,
    reservePlayerIds: roster.reserveIds,
    playerMap: roster.playerMap,
  }
}

function buildYahooWeekRange(startWeek: number | null, endWeek: number | null): number[] {
  if (startWeek == null || endWeek == null || endWeek < startWeek) return []
  const weeks: number[] = []
  for (let week = startWeek; week <= endWeek; week += 1) {
    weeks.push(week)
  }
  return weeks
}

async function getYahooAuthForUser(userId: string): Promise<YahooApiFetchContext> {
  const auth = await (prisma as any).leagueAuth.findUnique({
    where: { userId_platform: { userId, platform: 'yahoo' } },
  })
  if (!auth?.oauthToken) {
    throw new YahooImportConnectionError('Connect Yahoo in League Sync before importing from Yahoo.')
  }

  return {
    userId,
    accessToken: decrypt(auth.oauthToken),
    refreshToken: auth.oauthSecret ? decrypt(auth.oauthSecret) : null,
  }
}

async function refreshYahooAccessToken(context: YahooApiFetchContext): Promise<string> {
  const clientId = process.env.YAHOO_CLIENT_ID
  const clientSecret = process.env.YAHOO_CLIENT_SECRET
  if (!clientId || !clientSecret || !context.refreshToken) {
    throw new YahooImportConnectionError('Reconnect Yahoo in League Sync before importing from Yahoo.')
  }

  const response = await fetch('https://api.login.yahoo.com/oauth2/get_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: context.refreshToken,
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new YahooImportConnectionError(`Yahoo token refresh failed: ${body || response.statusText}`)
  }

  const tokens = await response.json()
  const accessToken = String(tokens.access_token ?? '')
  const refreshToken = typeof tokens.refresh_token === 'string' ? tokens.refresh_token : context.refreshToken

  await (prisma as any).leagueAuth.update({
    where: { userId_platform: { userId: context.userId, platform: 'yahoo' } },
    data: {
      oauthToken: encrypt(accessToken),
      oauthSecret: refreshToken ? encrypt(refreshToken) : undefined,
      updatedAt: new Date(),
    },
  })

  context.accessToken = accessToken
  context.refreshToken = refreshToken
  return accessToken
}

async function fetchYahooLoggedInUserGuid(context: YahooApiFetchContext): Promise<string | null> {
  const data = await yahooApiFetchJson(`${YAHOO_API_BASE}/users;use_login=1?format=json`, context)
  const usersWrapper = data?.fantasy_content?.users
  if (!isRecord(usersWrapper)) return null
  for (const key of Object.keys(usersWrapper)) {
    if (key === 'count') continue
    const block = usersWrapper[key]
    if (!isRecord(block)) continue
    const userArr = block.user
    if (Array.isArray(userArr) && userArr[0]) {
      const merged = mergeYahooEntityFragments({ user: userArr[0] }, 'user')
      const guid = typeof merged.guid === 'string' ? merged.guid.trim() : ''
      if (guid) return guid
    }
  }
  return null
}

const YAHOO_FETCH_RETRIES = 3
const YAHOO_FETCH_TIMEOUT_MS = 12000

const yahooFetchDelay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Resilient Yahoo GET: per-request timeout plus bounded retries with exponential
 * backoff on TRANSIENT failures only (network error / timeout / 5xx / 429).
 * Definitive statuses (401/403/404/other 4xx) return immediately so auth and
 * not-found semantics stay exact. Exhausted retries surface as a
 * YahooApiResponseError with status 0 and an honest attempt count — never a
 * silent null. The token-refresh POST is intentionally NOT retried here; it has
 * its own single-shot path in refreshYahooAccessToken.
 */
async function yahooRequestWithResilience(url: string, accessToken: string): Promise<Response> {
  let lastError: unknown = null
  for (let attempt = 0; attempt < YAHOO_FETCH_RETRIES; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), YAHOO_FETCH_TIMEOUT_MS)
    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        signal: controller.signal,
      })
      clearTimeout(timer)
      if ((response.status >= 500 || response.status === 429) && attempt < YAHOO_FETCH_RETRIES - 1) {
        await yahooFetchDelay(300 * 2 ** attempt)
        continue
      }
      return response
    } catch (err) {
      clearTimeout(timer)
      lastError = err
      if (attempt < YAHOO_FETCH_RETRIES - 1) {
        await yahooFetchDelay(300 * 2 ** attempt)
        continue
      }
    }
  }
  throw new YahooApiResponseError(
    0,
    `Yahoo request failed after ${YAHOO_FETCH_RETRIES} attempts (${
      lastError instanceof Error ? lastError.message : 'network error'
    }).`,
  )
}

async function yahooApiFetchJson(url: string, context: YahooApiFetchContext): Promise<any> {
  let response = await yahooRequestWithResilience(url, context.accessToken)
  if (response.status === 401 && context.refreshToken) {
    const refreshedToken = await refreshYahooAccessToken(context)
    response = await yahooRequestWithResilience(url, refreshedToken)
  }

  if (!response.ok) {
    const body = await response.text()
    throw new YahooApiResponseError(response.status, body || response.statusText)
  }

  return response.json()
}

async function listYahooLeaguesForUser(context: YahooApiFetchContext): Promise<YahooLeagueLookup[]> {
  const leaguesData = await yahooApiFetchJson(YAHOO_LEAGUE_LIST_URL, context)
  const games = leaguesData?.fantasy_content?.users?.[0]?.user?.[1]?.games
  const leagues: YahooLeagueLookup[] = []

  if (isRecord(games)) {
    for (const gameKey of Object.keys(games)) {
      if (gameKey === 'count') continue
      const game = games[gameKey]?.game
      const gameInfo = game?.[0]
      const gameLeagues = game?.[1]?.leagues
      if (!isRecord(gameLeagues)) continue

      for (const leagueKey of Object.keys(gameLeagues)) {
        if (leagueKey === 'count') continue
        const leagueData = gameLeagues[leagueKey]?.league?.[0]
        if (!leagueData?.league_key) continue
        leagues.push({
          leagueKey: String(leagueData.league_key),
          season: parseNumber(leagueData.season, null),
          sport: typeof gameInfo?.code === 'string' ? gameInfo.code.toUpperCase() : null,
          name: typeof leagueData?.name === 'string' ? leagueData.name : null,
          numTeams: parseNumber(leagueData?.num_teams, null),
        })
      }
    }
  }

  return leagues
}

/**
 * Public discovery entry: list every fantasy league on the user's CONNECTED
 * Yahoo account (`users;use_login=1` — no account identifier is needed, and
 * none is accepted, because Yahoo scopes the list to the OAuth session).
 *
 * Throws `YahooImportConnectionError` when Yahoo isn't connected in League
 * Sync, and `YahooApiResponseError` when the Yahoo API rejects the call.
 */
export async function listYahooLeaguesForAccount(userId: string): Promise<YahooLeagueLookup[]> {
  const context = await getYahooAuthForUser(userId)
  return listYahooLeaguesForUser(context)
}

async function resolveYahooLeagueLookup(
  sourceInput: string,
  context: YahooApiFetchContext
): Promise<{ leagueKey: string; season: number | null; sport: string | null; resolvedFromLeagueList: boolean }> {
  const trimmed = sourceInput.trim()
  if (!trimmed) {
    throw new YahooImportLeagueNotFoundError('Yahoo league key is required.')
  }

  if (trimmed.includes('.l.')) {
    return { leagueKey: trimmed, season: null, sport: null, resolvedFromLeagueList: false }
  }

  const candidates = (await listYahooLeaguesForUser(context))
    .filter((league) => league.leagueKey === trimmed || league.leagueKey.endsWith(`.l.${trimmed}`))
    .sort((a, b) => (b.season ?? 0) - (a.season ?? 0))

  const match = candidates[0]
  if (!match) {
    throw new YahooImportLeagueNotFoundError(
      `Yahoo league "${trimmed}" was not found in your connected Yahoo account. Use the full league key if needed.`
    )
  }

  return {
    leagueKey: match.leagueKey,
    season: match.season,
    sport: match.sport,
    resolvedFromLeagueList: true,
  }
}

async function discoverYahooPreviousSeasons(
  currentLeague: YahooImportLeague,
  context: YahooApiFetchContext
): Promise<Array<{ season: string; sourceLeagueId: string }>> {
  const currentName = currentLeague.name.trim().toLowerCase()
  if (!currentName) return []

  const candidates = await listYahooLeaguesForUser(context)
  const previousSeasons = candidates
    .filter((league) => {
      if (!league.leagueKey || league.leagueKey === currentLeague.leagueKey) return false
      if ((league.sport ?? '').toUpperCase() !== currentLeague.sport.toUpperCase()) return false
      if ((league.name ?? '').trim().toLowerCase() !== currentName) return false
      if (league.season == null || currentLeague.season == null) return true
      return league.season < currentLeague.season
    })
    .filter((league) => {
      if (currentLeague.numTeams <= 0 || league.numTeams == null) return true
      return league.numTeams === currentLeague.numTeams
    })
    .sort((a, b) => (b.season ?? 0) - (a.season ?? 0))
    .map((league) => ({
      season: String(league.season ?? 'unknown'),
      sourceLeagueId: league.leagueKey,
    }))

  return previousSeasons
}

function parseYahooSettings(settingsData: any): YahooImportSettings | null {
  const leagueNode = settingsData?.fantasy_content?.league
  const settings = getYahooProperty(leagueNode, 'settings')
  if (!settings) return null

  const rosterPositions = getYahooCollectionItems(getYahooProperty(settings, 'roster_positions'))
    .map((wrapper) => mergeYahooEntityFragments(wrapper, 'roster_position'))
    .filter((slot) => slot.position)
    .map((slot) => ({
      position: String(slot.position).trim(),
      count: parseNumber(slot.count, 0) ?? 0,
    }))

  const statCategories = getYahooCollectionItems(
    getYahooProperty(getYahooProperty(settings, 'stat_categories'), 'stats')
  )
    .map((wrapper) => mergeYahooEntityFragments(wrapper, 'stat'))
    .filter((stat) => stat.stat_id)
    .map((stat) => ({
      statId: String(stat.stat_id),
      name: typeof stat.name === 'string' ? stat.name : null,
      displayName: typeof stat.display_name === 'string' ? stat.display_name : null,
      enabled: stat.enabled != null ? parseBoolean(stat.enabled) : null,
      positionType: typeof stat.position_type === 'string' ? stat.position_type : null,
    }))

  const statModifiers = getYahooCollectionItems(
    getYahooProperty(getYahooProperty(settings, 'stat_modifiers'), 'stats')
  )
    .map((wrapper) => mergeYahooEntityFragments(wrapper, 'stat'))
    .filter((stat) => stat.stat_id)
    .map((stat) => ({
      statId: String(stat.stat_id),
      value: parseNumber(stat.value, 0) ?? 0,
    }))

  return {
    draftType: typeof settings.draft_type === 'string' ? settings.draft_type : null,
    scoringType: typeof settings.scoring_type === 'string' ? settings.scoring_type : null,
    usesPlayoff: settings.uses_playoff != null ? parseBoolean(settings.uses_playoff) : null,
    playoffStartWeek: parseNumber(settings.playoff_start_week, null),
    usesPlayoffReseeding:
      settings.uses_playoff_reseeding != null ? parseBoolean(settings.uses_playoff_reseeding) : null,
    usesLockEliminatedTeams:
      settings.uses_lock_eliminated_teams != null ? parseBoolean(settings.uses_lock_eliminated_teams) : null,
    usesFaab: settings.uses_faab != null ? parseBoolean(settings.uses_faab) : null,
    tradeEndDate: typeof settings.trade_end_date === 'string' ? settings.trade_end_date : null,
    tradeRatifyType: typeof settings.trade_ratify_type === 'string' ? settings.trade_ratify_type : null,
    rosterPositions,
    statCategories,
    statModifiers,
    raw: settings,
  }
}

function parseYahooStandings(standingsData: any): Map<string, YahooStandingDetails> {
  const leagueNode = standingsData?.fantasy_content?.league
  const standings = getYahooProperty(leagueNode, 'standings')
  const teams = getYahooCollectionItems(getYahooProperty(standings, 'teams'))
  const standingsByTeamKey = new Map<string, YahooStandingDetails>()

  for (const wrapper of teams) {
    const team = mergeYahooEntityFragments(wrapper, 'team')
    const teamKey = String(team.team_key ?? '')
    if (!teamKey) continue
    const outcomeTotals = getYahooProperty(getYahooProperty(team, 'team_standings'), 'outcome_totals')
    const managerIdentity = buildManagerIdentity(team, teamKey)
    standingsByTeamKey.set(teamKey, {
      wins: parseNumber(outcomeTotals?.wins, 0) ?? 0,
      losses: parseNumber(outcomeTotals?.losses, 0) ?? 0,
      ties: parseNumber(outcomeTotals?.ties, 0) ?? 0,
      rank: parseNumber(getYahooProperty(team, 'team_standings')?.rank, null),
      pointsFor: parseNumber(getYahooProperty(team, 'team_points')?.total, 0) ?? 0,
      pointsAgainst: null,
      faabBalance: parseNumber(team.faab_balance, null),
      clinchedPlayoffs: parseBoolean(team.clinched_playoffs),
      managerId: managerIdentity.managerId,
      managerGuid: managerIdentity.managerGuid,
      managerName: managerIdentity.managerName,
      teamName: typeof team.name === 'string' ? team.name : managerIdentity.managerName,
      logoUrl: getYahooLogoUrl(team),
    })
  }

  return standingsByTeamKey
}

function parseYahooTeamsMetadata(teamsData: any): Map<string, YahooTeamMetadata> {
  const leagueNode = teamsData?.fantasy_content?.league
  const teams = getYahooCollectionItems(getYahooProperty(leagueNode, 'teams'))
  const metadataByTeamKey = new Map<string, YahooTeamMetadata>()

  for (const wrapper of teams) {
    const team = mergeYahooEntityFragments(wrapper, 'team')
    const teamKey = String(team.team_key ?? '')
    if (!teamKey) continue
    const managerIdentity = buildManagerIdentity(team, teamKey)
    const isCommissioner = getYahooManagers(team).some(isYahooCommissionerManager)
    metadataByTeamKey.set(teamKey, {
      teamName: typeof team.name === 'string' ? team.name : managerIdentity.managerName,
      logoUrl: getYahooLogoUrl(team),
      waiverPriority: parseNumber(team.waiver_priority, null),
      managerId: managerIdentity.managerId,
      managerGuid: managerIdentity.managerGuid,
      managerName: managerIdentity.managerName,
      isCommissioner,
    })
  }

  return metadataByTeamKey
}

function parseYahooRoster(rosterData: any): {
  playerIds: string[]
  starterIds: string[]
  reserveIds: string[]
  playerMap: Record<string, { name: string; position: string; team: string }>
} {
  const teamNode = rosterData?.fantasy_content?.team
  const roster = getYahooProperty(teamNode, 'roster')
  const players = getYahooCollectionItems(getYahooProperty(roster, 'players'))

  const playerIds: string[] = []
  const starterIds: string[] = []
  const reserveIds: string[] = []
  const playerMap: Record<string, { name: string; position: string; team: string }> = {}

  for (const wrapper of players) {
    const player = mergeYahooEntityFragments(wrapper, 'player')
    const playerId = String(player.player_key ?? player.player_id ?? '')
    if (!playerId) continue

    const selectedPosition = getYahooProperty(player, 'selected_position')
    const startingStatus = getYahooProperty(player, 'starting_status')
    const selectedSlot = typeof selectedPosition?.position === 'string' ? selectedPosition.position : ''
    const isStarting =
      startingStatus?.is_starting != null
        ? parseBoolean(startingStatus.is_starting)
        : selectedSlot
          ? !YAHOO_RESERVE_POSITIONS.has(selectedSlot.toUpperCase())
          : false

    const fullName =
      typeof getYahooProperty(player, 'name')?.full === 'string'
        ? getYahooProperty(player, 'name').full
        : playerId
    const position =
      typeof player.display_position === 'string'
        ? player.display_position
        : typeof selectedSlot === 'string' && selectedSlot
          ? selectedSlot
          : 'N/A'
    const teamAbbr =
      typeof player.editorial_team_abbr === 'string'
        ? player.editorial_team_abbr
        : typeof player.editorial_team_key === 'string'
          ? player.editorial_team_key
          : 'N/A'

    playerIds.push(playerId)
    if (isStarting) starterIds.push(playerId)
    if (!isStarting || YAHOO_RESERVE_POSITIONS.has(selectedSlot.toUpperCase())) reserveIds.push(playerId)
    playerMap[playerId] = {
      name: fullName,
      position,
      team: teamAbbr,
    }
  }

  return { playerIds, starterIds, reserveIds, playerMap }
}

function parseYahooScoreboard(scoreboardData: any, season: number): YahooImportScheduleWeek[] {
  const leagueNode = scoreboardData?.fantasy_content?.league
  const scoreboard = getYahooProperty(leagueNode, 'scoreboard')
  const week = parseNumber(getYahooProperty(scoreboard, 'week'), null)
  const matchupWrappers = getYahooCollectionItems(getYahooProperty(scoreboard, 'matchups'))
  if (!week || matchupWrappers.length === 0) return []

  const matchups = matchupWrappers
    .map((wrapper) => {
      const matchup = mergeYahooEntityFragments(wrapper, 'matchup')
      const teams = getYahooCollectionItems(getYahooProperty(matchup, 'teams'))
        .map((teamWrapper) => mergeYahooEntityFragments(teamWrapper, 'team'))
        .filter((team) => team.team_key)

      if (teams.length !== 2) return null
      const points1 = parseNumber(getYahooProperty(teams[0], 'team_points')?.total, null)
      const points2 = parseNumber(getYahooProperty(teams[1], 'team_points')?.total, null)
      return {
        teamKey1: String(teams[0].team_key),
        teamKey2: String(teams[1].team_key),
        points1: points1 ?? undefined,
        points2: points2 ?? undefined,
      }
    })
    .filter(Boolean) as YahooImportScheduleWeek['matchups']

  if (matchups.length === 0) return []
  return [{ week, season, matchups }]
}

function parseYahooTeamMatchups(matchupsData: any, season: number): YahooImportScheduleWeek[] {
  const teamNode = matchupsData?.fantasy_content?.team
  const matchupWrappers = getYahooCollectionItems(getYahooProperty(teamNode, 'matchups'))
  const weeks = new Map<number, YahooImportScheduleWeek['matchups']>()

  for (const wrapper of matchupWrappers) {
    const matchup = mergeYahooEntityFragments(wrapper, 'matchup')
    const week = parseNumber(matchup.week, null)
    if (week == null) continue

    const teams = getYahooCollectionItems(getYahooProperty(matchup, 'teams'))
      .map((teamWrapper) => mergeYahooEntityFragments(teamWrapper, 'team'))
      .filter((team) => team.team_key)

    if (teams.length !== 2) continue
    const points1 = parseNumber(getYahooProperty(teams[0], 'team_points')?.total, null)
    const points2 = parseNumber(getYahooProperty(teams[1], 'team_points')?.total, null)

    if (!weeks.has(week)) {
      weeks.set(week, [])
    }
    weeks.get(week)!.push({
      teamKey1: String(teams[0].team_key),
      teamKey2: String(teams[1].team_key),
      points1: points1 ?? undefined,
      points2: points2 ?? undefined,
    })
  }

  return Array.from(weeks.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([week, matchups]) => ({
      week,
      season,
      matchups,
    }))
}

function parseYahooTransactions(transactionsData: any): YahooImportTransaction[] {
  const leagueNode = transactionsData?.fantasy_content?.league
  const transactionWrappers = getYahooCollectionItems(getYahooProperty(leagueNode, 'transactions'))

  return transactionWrappers
    .map((wrapper) => {
      const transaction = mergeYahooEntityFragments(wrapper, 'transaction')
      const transactionId = String(transaction.transaction_key ?? transaction.transaction_id ?? '')
      if (!transactionId) return null

      const teamKeys = new Set<string>()
      const adds: Record<string, string> = {}
      const drops: Record<string, string> = {}
      const playerWrappers = getYahooCollectionItems(getYahooProperty(transaction, 'players'))

      for (const playerWrapper of playerWrappers) {
        const player = mergeYahooEntityFragments(playerWrapper, 'player')
        const playerId = String(player.player_key ?? player.player_id ?? '')
        const transactionData = getYahooProperty(player, 'transaction_data')
        const actionType = String(transactionData?.type ?? '').toLowerCase()
        const destinationTeamKey = String(transactionData?.destination_team_key ?? '')
        const sourceTeamKey = String(transactionData?.source_team_key ?? '')

        if (destinationTeamKey) teamKeys.add(destinationTeamKey)
        if (sourceTeamKey) teamKeys.add(sourceTeamKey)
        if (playerId && destinationTeamKey && actionType.includes('add')) adds[playerId] = destinationTeamKey
        if (playerId && sourceTeamKey && actionType === 'drop') drops[playerId] = sourceTeamKey
      }

      return {
        transactionId,
        type: String(transaction.type ?? 'trade').toLowerCase(),
        status: String(transaction.status ?? 'completed').toLowerCase(),
        createdAt:
          typeof transaction.timestamp === 'string' && transaction.timestamp
            ? new Date(Number(transaction.timestamp) * 1000).toISOString()
            : typeof transaction.timestamp === 'number'
              ? new Date(transaction.timestamp * 1000).toISOString()
              : null,
        teamKeys: Array.from(teamKeys),
        adds,
        drops,
      }
    })
    .filter(Boolean) as YahooImportTransaction[]
}

function parseYahooDraftResults(draftResultsData: any): YahooImportDraftPick[] {
  const leagueNode = draftResultsData?.fantasy_content?.league
  const draftResultWrappers = getYahooCollectionItems(getYahooProperty(leagueNode, 'draft_results'))

  return draftResultWrappers
    .map((wrapper) => {
      const draftResult = mergeYahooEntityFragments(wrapper, 'draft_result')
      const player = mergeYahooEntityFragments(getYahooProperty(draftResult, 'player'), 'player')
      const playerNameData = getYahooProperty(player, 'name')
      const playerId = String(
        draftResult.player_key ??
          draftResult.player_id ??
          player.player_key ??
          player.player_id ??
          ''
      )
      const teamKey = String(
        draftResult.team_key ??
          draftResult.destination_team_key ??
          draftResult.owner_team_key ??
          ''
      )
      const round = parseNumber(draftResult.round, null)
      const pickNumber =
        parseNumber(draftResult.pick, null) ??
        parseNumber(draftResult.pick_number, null) ??
        parseNumber(draftResult.overall_pick, null)

      if (!playerId || !teamKey || round == null || pickNumber == null) return null

      return {
        round,
        pickNumber,
        teamKey,
        playerId,
        playerName:
          typeof playerNameData?.full === 'string'
            ? playerNameData.full
            : typeof player.full_name === 'string'
              ? player.full_name
              : null,
        position:
          typeof player.display_position === 'string'
            ? player.display_position
            : typeof player.primary_position === 'string'
              ? player.primary_position
              : null,
        team:
          typeof player.editorial_team_abbr === 'string'
            ? player.editorial_team_abbr
            : typeof player.editorial_team_key === 'string'
              ? player.editorial_team_key
              : null,
      }
    })
    .filter(Boolean) as YahooImportDraftPick[]
}

export async function fetchYahooLeagueForImport(
  userId: string,
  sourceInput: string
): Promise<YahooImportPayload> {
  const context = await getYahooAuthForUser(userId)
  const loggedInGuid = await fetchYahooLoggedInUserGuid(context).catch(() => null)
  const resolvedLeague = await resolveYahooLeagueLookup(sourceInput, context)
  const leagueKey = resolvedLeague.leagueKey

  let metadataData: any
  try {
    metadataData = await yahooApiFetchJson(`${YAHOO_API_BASE}/league/${leagueKey}?format=json`, context)
  } catch (error) {
    if (error instanceof YahooApiResponseError && (error.status === 401 || error.status === 404)) {
      throw new YahooImportLeagueNotFoundError(
        `Yahoo league "${leagueKey}" was not found or is not available to your connected Yahoo account.`
      )
    }
    throw error
  }

  const [settingsResult, standingsResult, teamsResult, scoreboardResult, transactionsResult, draftResultsResult] =
    await Promise.allSettled([
      yahooApiFetchJson(`${YAHOO_API_BASE}/league/${leagueKey}/settings?format=json`, context),
      yahooApiFetchJson(`${YAHOO_API_BASE}/league/${leagueKey}/standings?format=json`, context),
      yahooApiFetchJson(`${YAHOO_API_BASE}/league/${leagueKey}/teams?format=json`, context),
      yahooApiFetchJson(`${YAHOO_API_BASE}/league/${leagueKey}/scoreboard?format=json`, context),
      yahooApiFetchJson(
        `${YAHOO_API_BASE}/league/${leagueKey}/transactions;types=add,drop,trade;count=100?format=json`,
        context
      ),
      yahooApiFetchJson(`${YAHOO_API_BASE}/league/${leagueKey}/draftresults?format=json`, context),
    ])

  const leagueNode = mergeYahooEntityFragments({ league: metadataData?.fantasy_content?.league }, 'league')
  const league: YahooImportLeague = {
    leagueKey: String(leagueNode?.league_key ?? leagueKey),
    leagueId: String(leagueNode?.league_id ?? leagueKey.split('.l.')[1] ?? leagueKey),
    name: String(leagueNode?.name ?? 'Yahoo League'),
    sport:
      resolvedLeague.sport ??
      inferSportFromYahooUrl(typeof leagueNode?.url === 'string' ? leagueNode.url : null) ??
      'NFL',
    season: parseNumber(leagueNode?.season, resolvedLeague.season),
    numTeams: parseNumber(leagueNode?.num_teams, 0) ?? 0,
    draftStatus: typeof leagueNode?.draft_status === 'string' ? leagueNode.draft_status : null,
    currentWeek: parseNumber(leagueNode?.current_week, null),
    startWeek: parseNumber(leagueNode?.start_week, null),
    endWeek: parseNumber(leagueNode?.end_week, null),
    isFinished: parseBoolean(leagueNode?.is_finished),
    url: typeof leagueNode?.url === 'string' ? leagueNode.url : null,
  }

  const settings =
    settingsResult.status === 'fulfilled' ? parseYahooSettings(settingsResult.value) : null
  const standingsByTeamKey =
    standingsResult.status === 'fulfilled'
      ? parseYahooStandings(standingsResult.value)
      : new Map<string, YahooStandingDetails>()
  const metadataByTeamKey =
    teamsResult.status === 'fulfilled'
      ? parseYahooTeamsMetadata(teamsResult.value)
      : new Map<string, YahooTeamMetadata>()

  const teamKeys = Array.from(
    new Set<string>([
      ...Array.from(standingsByTeamKey.keys()),
      ...Array.from(metadataByTeamKey.keys()),
    ])
  )

  if (teamKeys.length === 0) {
    throw new YahooImportLeagueNotFoundError(
      `Yahoo league "${leagueKey}" was found, but no team data was available for import.`
    )
  }

  const expectedScheduleWeeks = buildYahooWeekRange(
    league.startWeek,
    league.isFinished
      ? league.endWeek
      : (league.currentWeek ?? league.endWeek)
  )

  const rosterResults = await Promise.allSettled(
    teamKeys.map(async (teamKey) => {
      const rosterData = await yahooApiFetchJson(`${YAHOO_API_BASE}/team/${teamKey}/roster/players?format=json`, context)
      return [teamKey, parseYahooRoster(rosterData)] as const
    })
  )
  const rostersByTeamKey = new Map<string, ReturnType<typeof parseYahooRoster>>()
  for (const result of rosterResults) {
    if (result.status === 'fulfilled') {
      rostersByTeamKey.set(result.value[0], result.value[1])
    }
  }

  const teams: YahooImportTeam[] = teamKeys.map((teamKey) =>
    createImportTeam(
      teamKey,
      standingsByTeamKey.get(teamKey),
      metadataByTeamKey.get(teamKey),
      rostersByTeamKey.get(teamKey) ?? { playerIds: [], starterIds: [], reserveIds: [], playerMap: {} }
    )
  )

  const scheduleByWeek = new Map<number, YahooImportScheduleWeek['matchups']>()
  if (expectedScheduleWeeks.length > 0) {
    const weekParam = expectedScheduleWeeks.join(',')
    const matchupResults = await Promise.allSettled(
      teamKeys.map(async (teamKey) => {
        const matchupData = await yahooApiFetchJson(
          `${YAHOO_API_BASE}/team/${teamKey}/matchups;weeks=${weekParam}?format=json`,
          context
        )
        return parseYahooTeamMatchups(matchupData, league.season ?? new Date().getFullYear())
      })
    )

    for (const result of matchupResults) {
      if (result.status !== 'fulfilled') continue
      for (const week of result.value) {
        if (!scheduleByWeek.has(week.week)) {
          scheduleByWeek.set(week.week, [])
        }
        const weekEntries = scheduleByWeek.get(week.week)!
        for (const matchup of week.matchups) {
          const matchupKey = [matchup.teamKey1, matchup.teamKey2].sort().join('::')
          const exists = weekEntries.some((existing) => {
            const existingKey = [existing.teamKey1, existing.teamKey2].sort().join('::')
            return existingKey === matchupKey
          })
          if (!exists) {
            weekEntries.push(matchup)
          }
        }
      }
    }
  }

  if (scheduleByWeek.size === 0 && scoreboardResult.status === 'fulfilled') {
    for (const week of parseYahooScoreboard(scoreboardResult.value, league.season ?? new Date().getFullYear())) {
      scheduleByWeek.set(week.week, week.matchups)
    }
  }

  const schedule = Array.from(scheduleByWeek.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([week, matchups]) => ({
      week,
      season: league.season ?? new Date().getFullYear(),
      matchups,
    }))

  const pointsAgainstByTeam = new Map<string, number>()
  for (const week of schedule) {
    for (const matchup of week.matchups) {
      if (typeof matchup.points2 === 'number') {
        pointsAgainstByTeam.set(
          matchup.teamKey1,
          (pointsAgainstByTeam.get(matchup.teamKey1) ?? 0) + matchup.points2
        )
      }
      if (typeof matchup.points1 === 'number') {
        pointsAgainstByTeam.set(
          matchup.teamKey2,
          (pointsAgainstByTeam.get(matchup.teamKey2) ?? 0) + matchup.points1
        )
      }
    }
  }
  for (const team of teams) {
    const pointsAgainst = pointsAgainstByTeam.get(team.teamKey)
    if (typeof pointsAgainst === 'number') {
      team.pointsAgainst = pointsAgainst
    }
  }

  const viewerTeamKey =
    loggedInGuid && teams.length > 0
      ? teams.find((t) => t.managerGuid === loggedInGuid || t.managerId === loggedInGuid)?.teamKey ?? null
      : null
  const commissionerTeamKeys = teamKeys.filter((teamKey) => metadataByTeamKey.get(teamKey)?.isCommissioner)

  const transactions =
    transactionsResult.status === 'fulfilled' ? parseYahooTransactions(transactionsResult.value) : []
  const draftPicks =
    draftResultsResult.status === 'fulfilled' ? parseYahooDraftResults(draftResultsResult.value) : []
  const previousSeasons = await discoverYahooPreviousSeasons(league, context)

  return {
    sourceInput,
    resolvedFromLeagueList: resolvedLeague.resolvedFromLeagueList,
    league,
    settings,
    teams,
    schedule,
    scheduleWeeksExpected: expectedScheduleWeeks.length > 0 ? expectedScheduleWeeks.length : null,
    scheduleWeeksCovered: schedule.length,
    transactions,
    draftPicks,
    previousSeasons,
    viewerTeamKey,
    commissionerTeamKeys,
  }
}
