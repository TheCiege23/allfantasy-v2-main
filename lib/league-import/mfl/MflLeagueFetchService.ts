import { XMLParser } from 'fast-xml-parser'

import { prisma } from '@/lib/prisma'
import { getDecryptedAuth } from '@/lib/league-sync-core'
import type {
  MflImportDraftPick,
  MflImportLeague,
  MflImportPayload,
  MflImportScheduleWeek,
  MflImportSettings,
  MflImportTeam,
  MflImportTransaction,
} from '@/lib/league-import/adapters/mfl/types'

const CURRENT_IMPORT_SEASON = new Date().getFullYear()
const MFL_XML_PARSER = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' })

type MflApiContext = {
  apiKey: string
}

export interface MflFetchOptions {
  includePreviousSeasons?: boolean
  maxPreviousSeasons?: number
  minSeason?: number
}

type MflFranchiseProfile = {
  franchiseId: string
  managerId: string
  managerName: string
  teamName: string
  logoUrl: string | null
  wins: number
  losses: number
  ties: number
  rank: number | null
  pointsFor: number
  pointsAgainst: number | null
  faabRemaining: number | null
  waiverPriority: number | null
}

type ParsedMflRoster = {
  franchiseId: string
  playerIds: string[]
  starterIds: string[]
  reserveIds: string[]
  lineupBreakdownAvailable: boolean
}

class MflApiResponseError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export class MflImportConnectionError extends Error {}

export class MflImportLeagueNotFoundError extends Error {}

const DEFAULT_FETCH_OPTIONS: Required<MflFetchOptions> = {
  includePreviousSeasons: true,
  maxPreviousSeasons: 8,
  minSeason: 2010,
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
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
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    return normalized === '1' || normalized === 'true' || normalized === 'yes'
  }
  return false
}

function parseIsoDate(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const timestamp = value > 2_000_000_000 ? value : value * 1000
    return new Date(timestamp).toISOString()
  }
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value)
    if (Number.isFinite(numeric)) {
      const timestamp = numeric > 2_000_000_000 ? numeric : numeric * 1000
      return new Date(timestamp).toISOString()
    }
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString()
    }
  }
  return null
}

function readMflValue(record: Record<string, any>, keys: string[]): unknown {
  for (const key of keys) {
    if (key in record && record[key] != null && record[key] !== '') {
      return record[key]
    }
  }
  return undefined
}

function stringifyMflValue(record: Record<string, any>, keys: string[], fallback = ''): string {
  const value = readMflValue(record, keys)
  if (value == null) return fallback
  return String(value).trim() || fallback
}

function numberFromMflValue(record: Record<string, any>, keys: string[], fallback: number | null = null): number | null {
  return parseNumber(readMflValue(record, keys), fallback)
}

function normalizeMflPositionLabel(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^A-Z0-9_/-]/gi, '')
    .toUpperCase()
}

export function parseMflSourceInput(sourceInput: string): { leagueId: string; season: number } {
  const trimmed = sourceInput.trim()
  if (!trimmed) {
    throw new MflImportLeagueNotFoundError('MFL league ID is required.')
  }

  let leagueId = ''
  let season = CURRENT_IMPORT_SEASON

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      const url = new URL(trimmed)
      const leagueParam = url.searchParams.get('L') ?? url.searchParams.get('leagueId')
      const seasonParam = url.searchParams.get('YEAR') ?? url.searchParams.get('year')
      if (leagueParam) {
        leagueId = leagueParam.replace(/\D/g, '')
      }
      if (seasonParam) {
        season = parseNumber(seasonParam, season) ?? season
      }
      if (!season) {
        const pathSeason = url.pathname.match(/\/(\d{4})\//)
        if (pathSeason) {
          season = parseNumber(pathSeason[1], CURRENT_IMPORT_SEASON) ?? CURRENT_IMPORT_SEASON
        }
      }
    } catch {
      // Fall through to shorthand parsing.
    }
  }

  if (!leagueId) {
    const seasonFirst = trimmed.match(/^(\d{4})[:/](\d+)$/)
    const leagueFirst = trimmed.match(/^(\d+)[@:](\d{4})$/)
    const leagueIdMatch = trimmed.match(/[?&]L=(\d+)/i)

    if (seasonFirst) {
      season = parseNumber(seasonFirst[1], season) ?? season
      leagueId = seasonFirst[2]
    } else if (leagueFirst) {
      leagueId = leagueFirst[1]
      season = parseNumber(leagueFirst[2], season) ?? season
    } else if (leagueIdMatch) {
      leagueId = leagueIdMatch[1]
    } else if (/^\d+$/.test(trimmed)) {
      leagueId = trimmed
    }
  }

  if (!leagueId) {
    throw new MflImportLeagueNotFoundError(
      'Enter an MFL league ID, a full MFL league URL, or a season-prefixed value like 2026:12345.'
    )
  }

  return { leagueId, season }
}

function buildMflEndpointUrl(args: {
  season: number
  leagueId: string
  type: string
  apiKey: string
}): string {
  const params = new URLSearchParams({
    TYPE: args.type,
    L: args.leagueId,
    APIKEY: args.apiKey,
    JSON: '1',
  })
  return `https://api.myfantasyleague.com/${args.season}/export?${params.toString()}`
}

async function getMflAuthForUser(userId: string): Promise<MflApiContext> {
  const auth = await getDecryptedAuth(userId, 'mfl')
  if (!auth?.apiKey) {
    throw new MflImportConnectionError(
      'Save your MFL API key in League Sync before importing from MyFantasyLeague.'
    )
  }
  return { apiKey: auth.apiKey }
}

function parseMflApiBody(body: string): any {
  try {
    return JSON.parse(body)
  } catch {
    return MFL_XML_PARSER.parse(body)
  }
}

function resolveMflErrorMessage(parsed: any, rawBody: string): string | null {
  if (typeof parsed?.error === 'string' && parsed.error.trim()) return parsed.error.trim()
  if (typeof parsed?.error?.message === 'string' && parsed.error.message.trim()) return parsed.error.message.trim()
  if (typeof parsed?.status?.error === 'string' && parsed.status.error.trim()) return parsed.status.error.trim()
  const textMatch = rawBody.match(/<error>([^<]+)<\/error>/i)
  if (textMatch?.[1]) return textMatch[1].trim()
  return null
}

function throwMflApiFailure(status: number, message: string): never {
  const normalized = message.toLowerCase()
  if (
    normalized.includes('league not found') ||
    normalized.includes('unknown league') ||
    normalized.includes('invalid league') ||
    normalized.includes('not found')
  ) {
    throw new MflImportLeagueNotFoundError(message)
  }
  if (
    normalized.includes('api key') ||
    normalized.includes('authentication') ||
    normalized.includes('authorized') ||
    normalized.includes('access denied') ||
    normalized.includes('permission')
  ) {
    throw new MflImportConnectionError(message)
  }
  throw new MflApiResponseError(status, message)
}

async function fetchMflEndpoint(args: {
  season: number
  leagueId: string
  type: string
  apiKey: string
}): Promise<any> {
  const response = await fetch(buildMflEndpointUrl(args), {
    cache: 'no-store',
    headers: {
      Accept: 'application/json, text/xml;q=0.9, */*;q=0.8',
      'User-Agent': 'Mozilla/5.0 (compatible; AllFantasy/1.0)',
    },
  })

  const body = await response.text()
  const parsed = parseMflApiBody(body)
  const message = resolveMflErrorMessage(parsed, body)

  if (!response.ok) {
    throwMflApiFailure(response.status, message || body || response.statusText)
  }

  if (message) {
    throwMflApiFailure(response.status, message)
  }

  return parsed
}

/**
 * Import Security Closure phase — real membership verification. MFL's real
 * `TYPE=myleagues` export (confirmed live via a direct, unauthenticated
 * call: `{"leagues":{}}` for no key, a real structured envelope, not a 404)
 * returns exactly the leagues+franchise the API key's own owner is
 * associated with — the only real signal MFL exposes for "is this key
 * actually linked to a member of this league." It does NOT expose a
 * commissioner/admin flag (confirmed absent from every real MFL response
 * shape this codebase's own franchise parser already handles) — that
 * remains a user-attested claim, handled by `commissionerGate.ts`'s
 * existing attestation mechanism, not fabricated as provider-verified here.
 */
export async function fetchMflUserLeagues(
  apiKey: string,
  season: number,
): Promise<Array<{ leagueId: string; franchiseId: string | null }>> {
  const params = new URLSearchParams({ TYPE: 'myleagues', APIKEY: apiKey, JSON: '1' })
  const url = `https://api.myfantasyleague.com/${season}/export?${params.toString()}`
  const response = await fetch(url, {
    cache: 'no-store',
    headers: {
      Accept: 'application/json, text/xml;q=0.9, */*;q=0.8',
      'User-Agent': 'Mozilla/5.0 (compatible; AllFantasy/1.0)',
    },
  })
  const body = await response.text()
  const parsed = parseMflApiBody(body)
  const message = resolveMflErrorMessage(parsed, body)
  if (!response.ok || message) {
    throwMflApiFailure(response.status, message || body || response.statusText)
  }
  const entries = toArray(parsed?.leagues?.league)
  return entries
    .map((entry) => ({
      leagueId: stringifyMflValue(entry, ['league_id', 'id']),
      franchiseId: stringifyMflValue(entry, ['franchise_id', 'franchiseId']) || null,
    }))
    .filter((entry) => entry.leagueId)
}

async function discoverMflPreviousSeasons(args: {
  leagueId: string
  season: number
  apiKey: string
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
      await fetchMflEndpoint({
        season: candidateSeason,
        leagueId: args.leagueId,
        type: 'league',
        apiKey: args.apiKey,
      })
      previousSeasons.push({
        season: String(candidateSeason),
        sourceLeagueId: args.leagueId,
      })
    } catch (error) {
      if (error instanceof MflImportLeagueNotFoundError) {
        break
      }
      if (error instanceof MflImportConnectionError) {
        break
      }
      throw error
    }
  }

  return previousSeasons
}

function parseMflSettings(leagueRaw: any): MflImportSettings | null {
  const league = isRecord(leagueRaw?.league) ? leagueRaw.league : isRecord(leagueRaw) ? leagueRaw : null
  if (!league) return null

  const startersRoot = isRecord(league.starters) ? league.starters : {}
  const starterPositions = toArray(startersRoot.position)
    .map((position) => (isRecord(position) ? position : null))
    .filter(Boolean)
    .map((position) => ({
      position: normalizeMflPositionLabel(stringifyMflValue(position!, ['name', 'position', 'id'], 'STARTER')),
      count: numberFromMflValue(position!, ['count', 'limit', 'qty'], 0) ?? 0,
    }))
    .filter((slot) => slot.count > 0)

  const taxiCount =
    numberFromMflValue(league, ['taxi_squad', 'taxiSquad', 'taxi_limit', 'taxiLimit'], null) ?? 0
  if (taxiCount > 0) {
    starterPositions.push({ position: 'TAXI', count: taxiCount })
  }

  return {
    scoringType: stringifyMflValue(league, ['scoring_type', 'scoringType'], '') || null,
    draftType: stringifyMflValue(league, ['draft_type', 'draftType'], '') || null,
    rosterPositions: starterPositions,
    usesFaab:
      readMflValue(league, ['uses_faab', 'usesFaab', 'faab']) != null
        ? parseBoolean(readMflValue(league, ['uses_faab', 'usesFaab', 'faab']))
        : null,
    acquisitionBudget: numberFromMflValue(league, ['faab_budget', 'faabBudget', 'salary_cap_amount'], null),
    waiverType: stringifyMflValue(league, ['waiver_type', 'waiverType', 'currentWaiverType'], '') || null,
    usesTaxi: taxiCount > 0 ? true : null,
    raw: league,
  }
}

function parseMflLeague(
  leagueRaw: any,
  source: { leagueId: string; season: number },
  settings: MflImportSettings | null
): MflImportLeague {
  const league = isRecord(leagueRaw?.league) ? leagueRaw.league : isRecord(leagueRaw) ? leagueRaw : {}
  const franchises = toArray(league?.franchises?.franchise)
  const currentWeek = numberFromMflValue(league, ['current_week', 'currentWeek', 'week'], null)
  const regularSeasonLength =
    numberFromMflValue(league, ['lastRegularSeasonWeek', 'last_regular_season_week', 'regularSeasonLength'], null)
  const playoffTeamCount =
    numberFromMflValue(league, ['playoff_teams', 'playoffTeams', 'playoff_team_count'], null)

  return {
    leagueId: source.leagueId,
    name: stringifyMflValue(league, ['name'], `MFL League ${source.leagueId}`),
    sport: 'NFL',
    season: source.season,
    size: franchises.length || numberFromMflValue(league, ['franchise_count', 'count'], 0) || 0,
    currentWeek,
    isFinished: source.season < CURRENT_IMPORT_SEASON,
    playoffTeamCount,
    regularSeasonLength,
    url: stringifyMflValue(league, ['url', 'baseURL', 'baseUrl'], '') || null,
  }
}

function buildMflFranchiseProfiles(leagueRaw: any, standingsRaw: any): Map<string, MflFranchiseProfile> {
  const profiles = new Map<string, MflFranchiseProfile>()

  const mergeFranchise = (franchiseRecord: Record<string, any>) => {
    const franchiseId = stringifyMflValue(franchiseRecord, ['id', 'franchise_id', 'franchiseId'])
    if (!franchiseId) return

    const current = profiles.get(franchiseId) ?? {
      franchiseId,
      managerId: franchiseId,
      managerName: `Manager ${franchiseId}`,
      teamName: `Franchise ${franchiseId}`,
      logoUrl: null,
      wins: 0,
      losses: 0,
      ties: 0,
      rank: null,
      pointsFor: 0,
      pointsAgainst: null,
      faabRemaining: null,
      waiverPriority: null,
    }

    const managerName =
      stringifyMflValue(franchiseRecord, ['owner_name', 'ownerName', 'owner_names'], '') ||
      stringifyMflValue(franchiseRecord, ['username', 'user_name', 'userName'], '') ||
      current.managerName
    const managerId =
      stringifyMflValue(franchiseRecord, ['owner_id', 'ownerId', 'user_id', 'userId'], '') ||
      stringifyMflValue(franchiseRecord, ['id'], current.managerId)

    profiles.set(franchiseId, {
      franchiseId,
      managerId,
      managerName,
      teamName: stringifyMflValue(franchiseRecord, ['name', 'franchise_name', 'franchiseName'], current.teamName),
      logoUrl:
        stringifyMflValue(franchiseRecord, ['icon', 'logo', 'logo_url', 'logoUrl'], '') || current.logoUrl,
      wins: numberFromMflValue(franchiseRecord, ['wins', 'h2hw'], current.wins) ?? current.wins,
      losses: numberFromMflValue(franchiseRecord, ['losses', 'h2hl'], current.losses) ?? current.losses,
      ties: numberFromMflValue(franchiseRecord, ['ties', 'h2ht'], current.ties) ?? current.ties,
      rank: numberFromMflValue(franchiseRecord, ['rank', 'standing', 'overall_rank'], current.rank),
      pointsFor:
        numberFromMflValue(franchiseRecord, ['pf', 'points_for', 'pointsFor'], current.pointsFor) ??
        current.pointsFor,
      pointsAgainst: numberFromMflValue(franchiseRecord, ['pa', 'points_against', 'pointsAgainst'], current.pointsAgainst),
      faabRemaining: numberFromMflValue(
        franchiseRecord,
        ['faab_balance', 'faabBalance', 'bbid_balance', 'bbidBalance'],
        current.faabRemaining
      ),
      waiverPriority: numberFromMflValue(
        franchiseRecord,
        ['waiverpriority', 'waiver_priority', 'waiverPriority', 'waiver_order'],
        current.waiverPriority
      ),
    })
  }

  const leagueFranchises = toArray(leagueRaw?.league?.franchises?.franchise)
  for (const franchise of leagueFranchises) {
    if (isRecord(franchise)) mergeFranchise(franchise)
  }

  const standingFranchises = toArray(standingsRaw?.standings?.franchise ?? standingsRaw?.league?.standings?.franchise)
  for (const franchise of standingFranchises) {
    if (isRecord(franchise)) mergeFranchise(franchise)
  }

  return profiles
}

function parseMflRosters(rostersRaw: any): ParsedMflRoster[] {
  const franchises = toArray(rostersRaw?.rosters?.franchise ?? rostersRaw?.league?.rosters?.franchise)
  return franchises
    .map((franchise) => {
      if (!isRecord(franchise)) return null
      const franchiseId = stringifyMflValue(franchise, ['id', 'franchise_id', 'franchiseId'])
      if (!franchiseId) return null

      const playerEntries = toArray(franchise.player)
      const playerIds: string[] = []
      const starterIds: string[] = []
      const reserveIds: string[] = []
      let lineupBreakdownAvailable = false

      for (const playerEntry of playerEntries) {
        if (isRecord(playerEntry)) {
          const playerId = stringifyMflValue(playerEntry, ['id', 'player_id', 'playerId'])
          if (!playerId) continue

          const rosterStatus = stringifyMflValue(playerEntry, ['status', 'type', 'lineup_status', 'lineupStatus', 'slot']).toLowerCase()
          const normalizedStatus = rosterStatus.replace(/\s+/g, '_')
          const isStarter =
            normalizedStatus.includes('starter') ||
            normalizedStatus.includes('starting') ||
            normalizedStatus.includes('lineup')
          const isReserve =
            normalizedStatus.includes('bench') ||
            normalizedStatus.includes('reserve') ||
            normalizedStatus.includes('taxi') ||
            normalizedStatus === 'ir'

          playerIds.push(playerId)
          if (isStarter) {
            starterIds.push(playerId)
            lineupBreakdownAvailable = true
          } else if (isReserve) {
            reserveIds.push(playerId)
            lineupBreakdownAvailable = true
          }
          continue
        }

        const playerId = String(playerEntry ?? '').trim()
        if (playerId) {
          playerIds.push(playerId)
        }
      }

      if (!lineupBreakdownAvailable && reserveIds.length === 0) {
        reserveIds.push(...playerIds)
      }

      return {
        franchiseId,
        playerIds,
        starterIds,
        reserveIds,
        lineupBreakdownAvailable,
      }
    })
    .filter(Boolean) as ParsedMflRoster[]
}

function extractMflMatchupSides(matchup: Record<string, any>): Array<{ franchiseId: string; score?: number }> {
  const franchiseItems = toArray(matchup.franchise)
    .map((franchise) => {
      if (!isRecord(franchise)) return null
      const franchiseId = stringifyMflValue(franchise, ['id', 'franchise_id', 'franchiseId'])
      if (!franchiseId) return null
      return {
        franchiseId,
        score: numberFromMflValue(franchise, ['score', 'points', 'pf'], null) ?? undefined,
      }
    })
    .filter(Boolean) as Array<{ franchiseId: string; score?: number }>

  if (franchiseItems.length >= 2) {
    return franchiseItems.slice(0, 2)
  }

  const directFirst = stringifyMflValue(matchup, ['franchise1', 'team1', 'home'], '')
  const directSecond = stringifyMflValue(matchup, ['franchise2', 'team2', 'away'], '')
  if (directFirst && directSecond) {
    return [
      {
        franchiseId: directFirst,
        score: numberFromMflValue(matchup, ['score1', 'points1', 'homeScore'], null) ?? undefined,
      },
      {
        franchiseId: directSecond,
        score: numberFromMflValue(matchup, ['score2', 'points2', 'awayScore'], null) ?? undefined,
      },
    ]
  }

  return []
}

function parseMflSchedule(scheduleRaw: any, season: number): MflImportScheduleWeek[] {
  const weeks = toArray(scheduleRaw?.schedule?.week ?? scheduleRaw?.league?.schedule?.week)
  return weeks
    .map((weekRecord) => {
      if (!isRecord(weekRecord)) return null
      const week = numberFromMflValue(weekRecord, ['week', 'id'], null)
      if (week == null || week < 1) return null
      const matchups = toArray(weekRecord.matchup)
        .map((matchup) => {
          if (!isRecord(matchup)) return null
          const sides = extractMflMatchupSides(matchup)
          if (sides.length < 2) return null
          return {
            franchiseId1: sides[0].franchiseId,
            franchiseId2: sides[1].franchiseId,
            points1: sides[0].score,
            points2: sides[1].score,
          }
        })
        .filter(Boolean) as MflImportScheduleWeek['matchups']

      if (matchups.length === 0) return null
      return {
        week,
        season,
        matchups,
      }
    })
    .filter(Boolean) as MflImportScheduleWeek[]
}

function parseMflTransactions(transactionsRaw: any): MflImportTransaction[] {
  const transactions = toArray(
    transactionsRaw?.transactions?.transaction ?? transactionsRaw?.league?.transactions?.transaction
  )

  return transactions
    .map((transaction) => {
      if (!isRecord(transaction)) return null
      const transactionId = stringifyMflValue(transaction, ['id', 'transaction_id', 'transactionId'])
      if (!transactionId) return null

      const franchiseIds = new Set<string>()
      for (const franchise of toArray(transaction.franchise)) {
        if (!isRecord(franchise)) continue
        const franchiseId = stringifyMflValue(franchise, ['id', 'franchise_id', 'franchiseId'])
        if (franchiseId) franchiseIds.add(franchiseId)
      }
      for (const key of ['franchise1', 'franchise2', 'from_franchise', 'to_franchise']) {
        const franchiseId = stringifyMflValue(transaction, [key], '')
        if (franchiseId) franchiseIds.add(franchiseId)
      }

      const adds: Record<string, string> = {}
      const drops: Record<string, string> = {}
      for (const player of toArray(transaction.player)) {
        if (!isRecord(player)) continue
        const playerId = stringifyMflValue(player, ['id', 'player_id', 'playerId'])
        if (!playerId) continue
        const action = stringifyMflValue(player, ['action', 'type', 'status']).toLowerCase()
        const toFranchise = stringifyMflValue(player, ['to_franchise', 'franchise_id', 'destination_franchise'], '')
        const fromFranchise = stringifyMflValue(player, ['from_franchise', 'source_franchise'], '')
        if (toFranchise) franchiseIds.add(toFranchise)
        if (fromFranchise) franchiseIds.add(fromFranchise)
        if (toFranchise && (action.includes('add') || action.includes('waiver') || action.includes('claim'))) {
          adds[playerId] = toFranchise
        }
        if (fromFranchise && action.includes('drop')) {
          drops[playerId] = fromFranchise
        }
      }

      return {
        transactionId,
        type: stringifyMflValue(transaction, ['type', 'transaction_type', 'transactionType'], 'trade').toLowerCase(),
        status: stringifyMflValue(transaction, ['status'], 'completed').toLowerCase(),
        createdAt:
          parseIsoDate(readMflValue(transaction, ['timestamp', 'created', 'date', 'time'])) ?? null,
        franchiseIds: Array.from(franchiseIds),
        adds,
        drops,
      }
    })
    .filter(Boolean) as MflImportTransaction[]
}

function parseMflDraftResults(draftRaw: any): Array<{
  round: number
  pickNumber: number
  franchiseId: string
  playerId: string
}> {
  const directPicks = toArray(
    draftRaw?.draftResults?.draftUnit ??
      draftRaw?.draftResults?.draftPick ??
      draftRaw?.draftResults?.pick ??
      draftRaw?.draft?.draftUnit
  )

  const nestedRoundPicks = toArray(draftRaw?.draftResults?.round)
    .filter(isRecord)
    .flatMap((round) => toArray(round.pick ?? round.draftUnit ?? round.selection))

  const picks = [...directPicks, ...nestedRoundPicks]

  return picks
    .map((pick) => {
      if (!isRecord(pick)) return null
      const round = numberFromMflValue(pick, ['round', 'roundNumber'], null)
      const pickNumber = numberFromMflValue(pick, ['pick', 'pickNumber', 'overall_pick', 'overallPick'], null)
      const franchiseId = stringifyMflValue(pick, ['franchise', 'franchise_id', 'franchiseId', 'team'])
      const playerId = stringifyMflValue(pick, ['player', 'player_id', 'playerId', 'id'])
      if (round == null || pickNumber == null || !franchiseId || !playerId) return null
      return { round, pickNumber, franchiseId, playerId }
    })
    .filter(Boolean) as Array<{
      round: number
      pickNumber: number
      franchiseId: string
      playerId: string
    }>
}

async function loadMflPlayerMap(playerIds: string[]): Promise<Record<string, { name: string; position: string; team: string }>> {
  const uniqueIds = Array.from(new Set(playerIds.filter(Boolean)))
  if (uniqueIds.length === 0) return {}

  const identities = (await (prisma as any).playerIdentityMap.findMany({
    where: {
      mflId: { in: uniqueIds },
    },
    select: {
      mflId: true,
      canonicalName: true,
      position: true,
      currentTeam: true,
    },
  })) as Array<{
    mflId: string | null
    canonicalName: string | null
    position: string | null
    currentTeam: string | null
  }>

  return identities.reduce((acc: Record<string, { name: string; position: string; team: string }>, identity) => {
    if (!identity?.mflId) return acc
    acc[String(identity.mflId)] = {
      name: identity.canonicalName ?? String(identity.mflId),
      position: identity.position ?? 'N/A',
      team: identity.currentTeam ?? '',
    }
    return acc
  }, {})
}

function buildMflTeams(args: {
  profiles: Map<string, MflFranchiseProfile>
  parsedRosters: ParsedMflRoster[]
  playerMap: Record<string, { name: string; position: string; team: string }>
}): {
  teams: MflImportTeam[]
  lineupBreakdownAvailable: boolean
} {
  const rosterByFranchise = new Map(args.parsedRosters.map((roster) => [roster.franchiseId, roster]))
  const franchiseIds = Array.from(
    new Set<string>([...Array.from(args.profiles.keys()), ...Array.from(rosterByFranchise.keys())])
  )

  let lineupBreakdownAvailable = false
  const teams = franchiseIds.map((franchiseId) => {
    const profile = args.profiles.get(franchiseId) ?? {
      franchiseId,
      managerId: franchiseId,
      managerName: `Manager ${franchiseId}`,
      teamName: `Franchise ${franchiseId}`,
      logoUrl: null,
      wins: 0,
      losses: 0,
      ties: 0,
      rank: null,
      pointsFor: 0,
      pointsAgainst: null,
      faabRemaining: null,
      waiverPriority: null,
    }
    const roster = rosterByFranchise.get(franchiseId) ?? {
      franchiseId,
      playerIds: [],
      starterIds: [],
      reserveIds: [],
      lineupBreakdownAvailable: false,
    }
    lineupBreakdownAvailable ||= roster.lineupBreakdownAvailable

    const teamPlayerMap = roster.playerIds.reduce<Record<string, { name: string; position: string; team: string }>>(
      (acc, playerId) => {
        if (args.playerMap[playerId]) {
          acc[playerId] = args.playerMap[playerId]
        }
        return acc
      },
      {}
    )

    return {
      franchiseId,
      managerId: profile.managerId,
      managerName: profile.managerName,
      teamName: profile.teamName,
      logoUrl: profile.logoUrl,
      wins: profile.wins,
      losses: profile.losses,
      ties: profile.ties,
      rank: profile.rank,
      pointsFor: profile.pointsFor,
      pointsAgainst: profile.pointsAgainst,
      faabRemaining: profile.faabRemaining,
      waiverPriority: profile.waiverPriority,
      rosterPlayerIds: roster.playerIds,
      starterPlayerIds: roster.starterIds,
      reservePlayerIds: roster.reserveIds,
      playerMap: teamPlayerMap,
    }
  })

  return { teams, lineupBreakdownAvailable }
}

function fillMflPointsAgainst(teams: MflImportTeam[], schedule: MflImportScheduleWeek[]) {
  const pointsAgainstByFranchise = new Map<string, number>()

  for (const week of schedule) {
    for (const matchup of week.matchups) {
      if (typeof matchup.points2 === 'number') {
        pointsAgainstByFranchise.set(
          matchup.franchiseId1,
          (pointsAgainstByFranchise.get(matchup.franchiseId1) ?? 0) + matchup.points2
        )
      }
      if (typeof matchup.points1 === 'number') {
        pointsAgainstByFranchise.set(
          matchup.franchiseId2,
          (pointsAgainstByFranchise.get(matchup.franchiseId2) ?? 0) + matchup.points1
        )
      }
    }
  }

  for (const team of teams) {
    if (team.pointsAgainst == null && pointsAgainstByFranchise.has(team.franchiseId)) {
      team.pointsAgainst = pointsAgainstByFranchise.get(team.franchiseId) ?? null
    }
  }
}

function attachMflPlayerDetailsToDraftPicks(args: {
  picks: Array<{ round: number; pickNumber: number; franchiseId: string; playerId: string }>
  playerMap: Record<string, { name: string; position: string; team: string }>
}): MflImportDraftPick[] {
  return args.picks.map((pick) => ({
    round: pick.round,
    pickNumber: pick.pickNumber,
    franchiseId: pick.franchiseId,
    playerId: pick.playerId,
    playerName: args.playerMap[pick.playerId]?.name ?? null,
    position: args.playerMap[pick.playerId]?.position ?? null,
    team: args.playerMap[pick.playerId]?.team ?? null,
  }))
}

export async function fetchMflLeagueForImport(
  userId: string,
  sourceInput: string,
  options: MflFetchOptions = {}
): Promise<MflImportPayload> {
  const opts = { ...DEFAULT_FETCH_OPTIONS, ...options }
  const source = parseMflSourceInput(sourceInput)
  const auth = await getMflAuthForUser(userId)

  let leagueRaw: any
  let rostersRaw: any
  try {
    ;[leagueRaw, rostersRaw] = await Promise.all([
      fetchMflEndpoint({ ...source, type: 'league', apiKey: auth.apiKey }),
      fetchMflEndpoint({ ...source, type: 'rosters', apiKey: auth.apiKey }),
    ])
  } catch (error) {
    if (error instanceof MflImportConnectionError || error instanceof MflImportLeagueNotFoundError) {
      throw error
    }
    if (error instanceof MflApiResponseError) {
      throw new MflImportLeagueNotFoundError(
        `MFL league "${source.leagueId}" was not found for season ${source.season}.`
      )
    }
    throw error
  }

  const optionalResults = await Promise.allSettled([
    fetchMflEndpoint({ ...source, type: 'standings', apiKey: auth.apiKey }),
    fetchMflEndpoint({ ...source, type: 'schedule', apiKey: auth.apiKey }),
    fetchMflEndpoint({ ...source, type: 'transactions', apiKey: auth.apiKey }),
    fetchMflEndpoint({ ...source, type: 'draftResults', apiKey: auth.apiKey }),
  ])

  const standingsRaw = optionalResults[0].status === 'fulfilled' ? optionalResults[0].value : null
  const scheduleRaw = optionalResults[1].status === 'fulfilled' ? optionalResults[1].value : null
  const transactionsRaw = optionalResults[2].status === 'fulfilled' ? optionalResults[2].value : null
  const draftRaw = optionalResults[3].status === 'fulfilled' ? optionalResults[3].value : null

  const settings = parseMflSettings(leagueRaw)
  const league = parseMflLeague(leagueRaw, source, settings)
  const profiles = buildMflFranchiseProfiles(leagueRaw, standingsRaw)
  const parsedRosters = parseMflRosters(rostersRaw)

  const allReferencedPlayerIds = Array.from(
    new Set(
      parsedRosters.flatMap((roster) => roster.playerIds).concat(
        parseMflDraftResults(draftRaw).map((pick) => pick.playerId)
      )
    )
  )
  const playerMap = await loadMflPlayerMap(allReferencedPlayerIds)
  const { teams, lineupBreakdownAvailable } = buildMflTeams({
    profiles,
    parsedRosters,
    playerMap,
  })

  if (teams.length === 0) {
    throw new MflImportLeagueNotFoundError(
      `MFL league "${source.leagueId}" was found, but no franchise data was available for import.`
    )
  }

  const schedule = scheduleRaw ? parseMflSchedule(scheduleRaw, source.season) : []
  fillMflPointsAgainst(teams, schedule)

  const transactions = transactionsRaw ? parseMflTransactions(transactionsRaw) : []
  const draftPicks = attachMflPlayerDetailsToDraftPicks({
    picks: draftRaw ? parseMflDraftResults(draftRaw) : [],
    playerMap,
  })
  const previousSeasons = opts.includePreviousSeasons
    ? await discoverMflPreviousSeasons({
        leagueId: source.leagueId,
        season: source.season,
        apiKey: auth.apiKey,
        maxPreviousSeasons: opts.maxPreviousSeasons,
        minSeason: opts.minSeason,
      })
    : []

  return {
    sourceInput,
    league,
    settings,
    teams,
    schedule,
    transactions,
    draftPicks,
    playerMap,
    lineupBreakdownAvailable,
    previousSeasons,
  }
}
