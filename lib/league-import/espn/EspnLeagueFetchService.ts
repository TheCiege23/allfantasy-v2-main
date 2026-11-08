import { isEspnMlbSource } from './EspnMlbSource'
import { getDecryptedAuth } from '@/lib/league-sync-core'
import {
  EspnApiResponseError,
  EspnFormatChangedError,
  EspnUnavailableError,
  assertEspnLeagueObject,
  buildEspnCookieHeader as buildCookieHeaderFromCredentials,
  espnCurrentFantasySeason,
  espnDefaultSeasonCandidates,
  fetchEspnLeagueJson,
} from './espnFantasyClient'
import {
  ESPN_ACTIVITY_MESSAGE_TYPE_IDS,
  ESPN_ACTIVITY_TYPE_MAP,
  ESPN_LINEUP_SLOT_LABELS as ESPN_SLOT_LABELS,
  ESPN_POSITION_LABELS,
  ESPN_TEAM_ABBREVIATIONS,
} from './espnLookups'
import { recordEspnCookiesAccepted, recordEspnCookiesRejected } from './espnConnectionHealth'
import { fillEspnPlayerDirectory, type EspnPlayerSummary } from './espnPlayerDirectoryFill'
import type {
  EspnImportDraftPick,
  EspnImportLeague,
  EspnImportPayload,
  EspnImportScheduleWeek,
  EspnImportSettings,
  EspnImportTeam,
  EspnImportTransaction,
} from '@/lib/league-import/adapters/espn/types'

const ESPN_IMPORT_VIEWS = ['mTeam', 'mRoster', 'mMatchup', 'mScoreboard', 'mSettings']
const ESPN_DISCOVERY_VIEWS = ['mTeam', 'mSettings']
const ESPN_DRAFT_VIEWS = ['mDraftDetail']
const ESPN_TRANSACTIONS_MIN_SEASON = 2019

/**
 * The id tables moved to `./espnLookups` (one copy for the whole repo). Re-exported here because
 * the athlete adapter, the roster crosswalk and several tests import them from this module.
 */
export { ESPN_POSITION_LABELS, ESPN_TEAM_ABBREVIATIONS }
export { EspnApiResponseError, EspnFormatChangedError, EspnUnavailableError }

/**
 * ESPN's `lineupSlotId` for the bench and for injured reserve.
 *
 * 🛑 THESE WERE ONE SET AND EVERY BENCH PLAYER WAS IMPORTED ONTO IR. `reserve_ids`
 * is rendered as the "Injured Reserve" section by every consumer — My Team, the
 * league home roster card, the canonical lineup bridge, the trade context
 * assemblers — and the bench is derived as `players − starters − reserve − taxi`.
 * So folding slot 20 in here did not merely mislabel a section: it emptied the
 * bench and told managers their healthy players were hurt. Measured on production
 * 2026-09-04, before the fix: ESPN rosters averaged 4.2 of 9.3 players filed as
 * reserve (45%), and every sampled roster had `lineup_sections.bench = []` with
 * the whole bench sitting under `ir`. Sleeper, which reports real IR, averaged 0.4.
 *
 * Only slot 21 is injured reserve. The bench belongs to neither list — it is
 * derived — so a bench player is filed as a starter here by NOT being pushed
 * anywhere.
 */
const ESPN_BENCH_SLOT = 20
const ESPN_IR_SLOT = 21

type EspnAuthContext = {
  swid: string | null
  espnS2: string | null
  /** Whose STORED cookies these are — set only by `getEspnAuthForUser`, so health is recorded only for them. */
  userId?: string
}

type EspnMemberSummary = {
  id: string
  displayName: string
  isCommissioner?: boolean
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

/**
 * A `lineupSlotId`, which is legitimately ZERO.
 *
 * 🛑 SLOT 0 IS QB — `ESPN_SLOT_LABELS` at the top of THIS FILE says so. Reading
 * it with `toPositiveInt(…, 20)` rejected the 0 as falsy and handed back the
 * BENCH slot instead, so every ESPN league's starting quarterback was imported as
 * a non-starter — and, while the bench and IR shared one set above, shown on
 * injured reserve. The table was right and the parser three hundred lines below
 * it never asked.
 *
 * Kept separate from `toPositiveInt` on purpose: that helper's callers here read
 * `defaultPositionId` and `proTeamId`, where 0 genuinely means "unknown" and the
 * fallback is what makes the lookup miss cleanly.
 */
function toSlotId(value: unknown, fallback: number): number {
  const parsed = parseNumber(value, null)
  return parsed != null && parsed >= 0 ? Math.floor(parsed) : fallback
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

/**
 * Sports ESPN fantasy runs that this importer does NOT read. Their URLs carry a `leagueId` too, so
 * without this a basketball league URL was silently requested as a FOOTBALL league and came back
 * "not found" — the one error that sends people to re-check an id that was right all along.
 */
const ESPN_UNSUPPORTED_URL_SPORTS: Record<string, string> = {
  basketball: 'basketball',
  'womens-basketball': "women's basketball",
  hockey: 'hockey',
}

export type EspnLeagueInput = {
  leagueId: string
  season: number
  /** False when the user gave only an id: the season was defaulted and may be the wrong one. */
  seasonExplicit: boolean
}

const MAX_ESPN_LEAGUE_ID_DIGITS = 15

/**
 * Pull the league id (and season, when present) out of whatever the user pasted: a bare id, any
 * fantasy.espn.com football URL (league, team, matchup, standings pages all carry `leagueId=`), a
 * bare query string, or the `2025:123` / `123@2025` shorthands.
 */
export function parseEspnLeagueInput(sourceInput: string, now: Date = new Date()): EspnLeagueInput {
  const trimmed = String(sourceInput ?? '').trim()
  if (!trimmed) {
    throw new EspnImportLeagueNotFoundError('ESPN league ID is required.')
  }

  let leagueId = ''
  let season: number | null = null

  const looksLikeUrl = /^https?:\/\//i.test(trimmed) || /^(www\.)?fantasy\.espn\.com\//i.test(trimmed)
  if (looksLikeUrl) {
    try {
      const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
      const sport = url.pathname.split('/').filter(Boolean)[0]?.toLowerCase() ?? ''
      if (/(^|\.)espn\.com$/i.test(url.hostname) && ESPN_UNSUPPORTED_URL_SPORTS[sport]) {
        throw new EspnImportLeagueNotFoundError(
          `That link is an ESPN ${ESPN_UNSUPPORTED_URL_SPORTS[sport]} league. AllFantasy imports ESPN football and baseball leagues.`,
        )
      }
      const leagueIdParam = url.searchParams.get('leagueId')
      const seasonIdParam = url.searchParams.get('seasonId')
      if (leagueIdParam) leagueId = leagueIdParam.replace(/\D/g, '')
      if (seasonIdParam) season = toPositiveInt(seasonIdParam, 0) || null
    } catch (error) {
      if (error instanceof EspnImportLeagueNotFoundError) throw error
      // Fall through to shorthand parsing.
    }
  }

  if (!leagueId) {
    const seasonFirst = trimmed.match(/^(\d{4})[:/](\d+)$/)
    const leagueFirst = trimmed.match(/^(\d+)[@:](\d{4})$/)
    const leagueIdMatch = trimmed.match(/leagueId=(\d+)/i)
    const seasonIdMatch = trimmed.match(/seasonId=(\d{4})/i)

    if (seasonFirst) {
      season = toPositiveInt(seasonFirst[1], 0) || null
      leagueId = seasonFirst[2]
    } else if (leagueFirst) {
      leagueId = leagueFirst[1]
      season = toPositiveInt(leagueFirst[2], 0) || null
    } else if (leagueIdMatch) {
      leagueId = leagueIdMatch[1]
      if (seasonIdMatch) season = toPositiveInt(seasonIdMatch[1], 0) || null
    } else if (/^\d+$/.test(trimmed)) {
      leagueId = trimmed
    }
  }

  if (!leagueId) {
    throw new EspnImportLeagueNotFoundError(
      'Enter an ESPN league ID, a full ESPN league URL, or a season-prefixed value like 2025:12345678.'
    )
  }
  if (leagueId.length > MAX_ESPN_LEAGUE_ID_DIGITS) {
    throw new EspnImportLeagueNotFoundError(
      "That number is too long to be an ESPN league ID. It's the leagueId= number in your league's URL."
    )
  }

  const seasonExplicit = season != null
  return { leagueId, season: season ?? now.getFullYear(), seasonExplicit }
}

export function parseEspnSourceInput(sourceInput: string): { leagueId: string; season: number } {
  const { leagueId, season } = parseEspnLeagueInput(sourceInput)
  return { leagueId, season }
}

/**
 * Seasons to try for a bare league id, in order. ESPN keys every read on a season, and the
 * calendar year is wrong for part of the year: in January the NFL fantasy season that just ended is
 * last year's, and through the summer a league that has not been renewed yet only exists under last
 * year. So a 404 on the first guess retries the other one — one extra request, only on a miss,
 * instead of telling someone with a correct id that their league does not exist.
 */
export function espnSeasonCandidates(input: EspnLeagueInput, now: Date = new Date()): number[] {
  if (input.seasonExplicit) return [input.season]
  return espnDefaultSeasonCandidates(now)
}

/**
 * All HTTP goes through `./espnFantasyClient` (timeout, retries with backoff, short cache, format
 * check, secret-safe errors). Definitive statuses still throw `EspnApiResponseError` so the
 * cookie-fallback and private-league messaging below keep their exact semantics; exhausted retries
 * throw `EspnUnavailableError`, whose message is the user-facing "temporarily unavailable" text.
 */
async function fetchEspnJson(
  leagueId: string,
  season: number,
  cookieHeader?: string | null,
  views: string[] = ESPN_IMPORT_VIEWS,
  extraHeaders?: Record<string, string>,
  subPath?: 'communication/',
): Promise<any> {
  const raw = await fetchEspnLeagueJson(
    { game: 'ffl', season, leagueId, views, subPath },
    { cookieHeader: cookieHeader ?? null, extraHeaders },
  )
  if (!subPath) assertEspnLeagueObject(raw)
  return raw
}

async function getEspnAuthForUser(userId: string): Promise<EspnAuthContext> {
  const auth = await getDecryptedAuth(userId, 'espn')
  return {
    swid: auth?.espnSwid ?? null,
    espnS2: auth?.espnS2 ?? null,
    userId,
  }
}

function buildEspnCookieHeader(context: EspnAuthContext): string | null {
  return buildCookieHeaderFromCredentials(context)
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
      const raw = await fetchEspnJson(args.leagueId, args.season, attempt, args.views ?? ESPN_IMPORT_VIEWS)
      if (attempt && args.auth.userId) void recordEspnCookiesAccepted(args.auth.userId)
      return raw
    } catch (error) {
      lastError = error

      if (!(error instanceof EspnApiResponseError)) {
        throw error
      }

      /*
       * ESPN refused the STORED cookies. Recorded even when the cookieless retry below then reads
       * a public league fine: the connection is still dead, every private league and the
       * team-ownership check will fail, and the user should hear about it now rather than later.
       */
      if (attempt && args.auth.userId && (error.status === 401 || error.status === 403)) {
        void recordEspnCookiesRejected(args.auth.userId)
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

  /*
   * ⚠ BOTH OF THESE NAME THE DEVICE, AND NEITHER USED TO. Connecting or reconnecting ESPN needs
   * the browser extension or a cookie pasted out of devtools, and neither works on a mobile
   * browser — so "Connect ESPN in Settings" sent a phone user to a settings page where the only
   * two paths available to them are the two that cannot run. They retry, fail identically, and
   * nothing on the way tells them why. See the matching note in `checkEspn`, which is the message
   * a PUBLIC league produces; these two are the private and expired cases.
   *
   * Kept to one added clause each: these are already long, and a wall of text at the moment
   * something failed is read by nobody.
   */
  if (lastError instanceof EspnApiResponseError && (lastError.status === 401 || lastError.status === 403)) {
    if (cookieHeader) {
      throw new EspnImportConnectionError(
        'Your saved ESPN cookies no longer unlock this league. Reconnect ESPN in Settings → ' +
          'Connected Accounts and try again — that step needs a desktop browser, as mobile ' +
          'browsers cannot read the cookie.'
      )
    }
    throw new EspnImportConnectionError(
      'This ESPN league is private, so importing it needs your ESPN account connected. Connect ' +
        'ESPN in Settings → Connected Accounts. That step needs a desktop browser once (it reads ' +
        'a cookie, and mobile browsers cannot); after that this league imports from any device.'
    )
  }

  throw lastError instanceof Error ? lastError : new Error('Failed to load ESPN league data.')
}

/**
 * `loadEspnLeagueRaw` across `espnSeasonCandidates`: a bare id that 404s for the defaulted season
 * is retried for the adjacent one before anyone is told the league does not exist. An explicit
 * season (from a URL or `2025:123`) is never second-guessed.
 */
export async function loadEspnLeagueRawForInput(args: {
  input: EspnLeagueInput
  auth: EspnAuthContext
  views: string[]
}): Promise<{ raw: any; season: number }> {
  const candidates = espnSeasonCandidates(args.input)
  let notFound: EspnImportLeagueNotFoundError | null = null
  for (const season of candidates) {
    try {
      const raw = await loadEspnLeagueRaw({ leagueId: args.input.leagueId, season, auth: args.auth, views: args.views })
      return { raw, season }
    } catch (error) {
      if (!(error instanceof EspnImportLeagueNotFoundError)) throw error
      notFound = error
    }
  }
  if (candidates.length > 1) {
    throw new EspnImportLeagueNotFoundError(
      `We couldn't find ESPN league ${args.input.leagueId} for ${candidates.join(' or ')}. ` +
        'Check the leagueId= number in your league URL, or paste the full URL so we use its season.',
    )
  }
  throw notFound ?? new EspnImportLeagueNotFoundError(`ESPN league "${args.input.leagueId}" was not found.`)
}

async function loadOptionalEspnUrlRaw(args: {
  leagueId: string
  season: number
  views: string[]
  subPath?: 'communication/'
  auth: EspnAuthContext
  extraHeaders?: Record<string, string>
}): Promise<any | null> {
  const cookieHeader = buildEspnCookieHeader(args.auth)
  const attempts = cookieHeader ? [cookieHeader, null] : [null]

  for (const attempt of attempts) {
    try {
      return await fetchEspnJson(args.leagueId, args.season, attempt, args.views, args.extraHeaders, args.subPath)
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
    leagueId: args.leagueId,
    season: args.season,
    views: args.views,
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
    leagueId: args.leagueId,
    season: args.season,
    views: ['kona_league_communication'],
    subPath: 'communication/',
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

/** An ESPN SWID / member id, braced or not. Never a person's name. */
const ESPN_GUID_PATTERN = /^\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?$/i

/**
 * A display name that is really an id. `buildEspnMemberDirectory` stores a nameless member's id
 * as its `displayName`, and the owner fallbacks below do the same, so "has a displayName" is not
 * "has a name".
 */
function isEspnIdStandIn(name: string, ownerId: string): boolean {
  const trimmed = name.trim()
  return !trimmed || trimmed === ownerId || ESPN_GUID_PATTERN.test(trimmed)
}

function resolveEspnOwners(team: Record<string, any>, members: Map<string, EspnMemberSummary>) {
  const ownerRefs = Array.isArray(team.owners) ? team.owners : []
  const resolvedOwners: Array<EspnMemberSummary & { ownerId: string }> = []

  for (const ownerRef of ownerRefs) {
    if (isRecord(ownerRef)) {
      const ownerId = String(ownerRef.id ?? ownerRef.memberId ?? ownerRef.guid ?? '').trim()
      const displayName =
        typeof ownerRef.displayName === 'string' && ownerRef.displayName.trim()
          ? ownerRef.displayName.trim()
          : `${typeof ownerRef.firstName === 'string' ? ownerRef.firstName : ''} ${typeof ownerRef.lastName === 'string' ? ownerRef.lastName : ''}`.trim()
      if (ownerId || displayName) {
        resolvedOwners.push({
          ownerId,
          id: ownerId || displayName || String(team.id ?? 'manager'),
          displayName: displayName || members.get(ownerId)?.displayName || ownerId || String(team.id ?? 'Manager'),
        })
      }
      continue
    }

    const ownerId = String(ownerRef ?? '').trim()
    if (!ownerId) continue
    resolvedOwners.push({ ...(members.get(ownerId) ?? { id: ownerId, displayName: ownerId }), ownerId })
  }

  const uniqueOwners = resolvedOwners.filter(
    (owner, index, array) =>
      array.findIndex((candidate) => candidate.id === owner.id && candidate.displayName === owner.displayName) === index
  )

  const managerId = uniqueOwners[0]?.id ?? String(team.primaryOwner ?? team.id ?? 'manager')
  const managerName = uniqueOwners
    .map((owner) => owner.displayName)
    .filter((name, index) => !isEspnIdStandIn(name ?? '', uniqueOwners[index].ownerId))
    .join(' / ')

  /*
   * 🛑 THIS FELL BACK TO THE OWNER ID, AND ON ESPN THAT IS A SWID GUID. A public league read
   * without cookies often has no `members`, so nothing resolves an owner id to a person and
   * `LeagueTeam.ownerName` became '{EC0584BF-…}' for every team (measured on the test DB, two
   * leagues). Fall back to the team's own name, then `Manager <team id>`.
   *
   * ⚠ DISPLAY ONLY. `managerId` above stays the raw owner id: it is a join key (claims,
   * `platformUserId`, the viewer-team match) and must never be prettified.
   */
  const teamNo = String(team.id ?? '').trim()
  return {
    managerId,
    managerName: managerName || buildEspnTeamName(team, teamNo ? `Manager ${teamNo}` : 'Manager'),
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

function parseEspnRosterEntries(
  entries: unknown,
  /** Collects `defaultPositionId`s with no label, for one log line per import (GAPS.md L-03). */
  unmappedPositions?: Map<number, number>,
): {
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

    const lineupSlotId = toSlotId(entry.lineupSlotId, ESPN_BENCH_SLOT)
    const isReserve = lineupSlotId === ESPN_IR_SLOT
    const isBench = lineupSlotId === ESPN_BENCH_SLOT
    const playerName =
      typeof player.fullName === 'string' && player.fullName.trim()
        ? player.fullName.trim()
        : `Player ${playerId}`
    const positionId = toPositiveInt(player.defaultPositionId, 0)
    const teamId = toPositiveInt(player.proTeamId, 0)

    playerIds.push(playerId)
    // Bench is deliberately in neither list: consumers derive it as
    // `players − starters − reserve − taxi`, so pushing it anywhere here is what
    // put it on IR.
    if (isReserve) {
      reserveIds.push(playerId)
    } else if (!isBench) {
      starterIds.push(playerId)
    }
    const positionLabel = ESPN_POSITION_LABELS[positionId]
    if (!positionLabel && positionId > 0 && unmappedPositions) {
      unmappedPositions.set(positionId, (unmappedPositions.get(positionId) ?? 0) + 1)
    }
    playerMap[playerId] = {
      name: playerName,
      position: positionLabel ?? 'N/A',
      team: ESPN_TEAM_ABBREVIATIONS[teamId] ?? '',
    }
  }

  return { playerIds, starterIds, reserveIds, playerMap }
}

/**
 * A team's standing, in the order ESPN's own fields can be trusted for it.
 *
 * 🛑 MEASURED ON A REAL LEAGUE (contracts/espn/fixtures/fantasy-league.NFL.2026.json, week 9):
 *   - `rankCalculatedFinal` / `rankFinal` are 0 for EVERY team until the season ends. 0 is a number,
 *     so `??` took it and every mid-season ESPN import stored `currentRank: 0` for all teams.
 *   - `currentProjectedRank` is ESPN's simulation of where a team will FINISH, not where it stands:
 *     the 3-5 team seeded 8th was projected 9th, the 2-6 team seeded 9th projected 8th.
 *   - `playoffSeed` is the current standing (1..size), already ordered by the league's tiebreak rule.
 * So: a real final rank once there is one, else the current seed, else the computed fallback.
 */
function getEspnTeamRank(team: Record<string, any>): number | null {
  const positive = (value: unknown) => {
    const n = parseNumber(value, null)
    return n != null && n > 0 ? n : null
  }
  return (
    positive(team.rankCalculatedFinal) ??
    positive(team.rankFinal) ??
    positive(team.playoffSeed) ??
    positive(team.record?.overall?.rank)
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
  const unmappedPositions = new Map<number, number>()
  const teams = teamsRaw
    .filter(isRecord)
    .map((team: Record<string, any>) => {
      const teamId = String(team.id ?? '').trim()
      if (!teamId) return null

      const { managerId, managerName } = resolveEspnOwners(team, members)
      const roster = parseEspnRosterEntries(team.roster?.entries, unmappedPositions)
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
        // ESPN's division id; names live in settings.scheduleSettings.divisions.
        divisionId: team.divisionId != null && String(team.divisionId).trim() !== '' ? String(team.divisionId) : null,
        faabRemaining,
        waiverPriority: parseNumber(team.waiverRank, null),
        rosterPlayerIds: roster.playerIds,
        starterPlayerIds: roster.starterIds,
        reservePlayerIds: roster.reserveIds,
        playerMap: roster.playerMap,
      }
    })
    .filter(Boolean) as EspnImportTeam[]

  /*
   * ⚠ IDP POSITIONS ARE UNMAPPED ON PURPOSE, AND THIS IS HOW THEY GET MAPPED. ESPN's defensive
   * `defaultPositionId`s have never been seen in a capture (GAPS.md L-03), and guessing them would
   * label players wrong with no way to notice. They import as 'N/A'; this line names the ids, with
   * counts, so the first real IDP import says exactly what to add to `ESPN_POSITION_LABELS`.
   * Ids and counts only — no player or league names.
   */
  if (unmappedPositions.size > 0) {
    const detail = [...unmappedPositions.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([id, count]) => `${id}x${count}`)
      .join(', ')
    console.warn(`[espn-import] unmapped defaultPositionId(s): ${detail} (imported as N/A; see contracts/espn/GAPS.md L-03)`)
  }

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
  points2?: number,
  categories1?: Record<string, number>,
  categories2?: Record<string, number>,
) {
  /*
   * 🛑 THIS LINE USED TO READ `if (!teamId1 || !teamId2) return`, AND IT DISCARDED THE
   * POINTS WITH THE ENTRY. ESPN serves a side with no opponent for a total-points or
   * knockout league — `detectEspnMatchupFrequency` already recognises the format and the
   * adapter already says so in its coverage note ("no paired head-to-head schedule to
   * import") — but the parser dropped those entries silently, so the collector saw an
   * empty schedule and wrote nothing at all.
   *
   * Measured on production 2026-09-20: "Washington Pro Knockout PPR League" is in season
   * with 18 teams and recorded `weeksWritten: 0, weeksUnchanged: 0` while its five ESPN
   * siblings recorded 13–17 weeks unchanged. It renders nothing on any WeeklyMatchup
   * surface.
   */
  if (!teamId1 && !teamId2) return

  if (!weeks.has(week)) {
    weeks.set(week, [])
  }
  const matchups = weeks.get(week)!

  /*
   * One side only. Normalised onto `teamId1` so everything downstream reads one shape,
   * and keyed apart from pairs so a solo entry can never dedupe against one.
   */
  if (!teamId1 || !teamId2) {
    const soloId = teamId1 || teamId2
    const soloPoints = teamId1 ? points1 : points2
    const existingSolo = matchups.find((m) => m.teamId2 == null && m.teamId1 === soloId)
    if (existingSolo) {
      if (typeof soloPoints === 'number') existingSolo.points1 = soloPoints
      return
    }
    matchups.push({ teamId1: soloId, teamId2: null, points1: soloPoints, points2: undefined })
    return
  }

  const matchupKey = [teamId1, teamId2].sort().join('::')
  const existing = matchups.find(
    (matchup) =>
      matchup.teamId2 != null && [matchup.teamId1, matchup.teamId2].sort().join('::') === matchupKey,
  )
  if (existing) {
    if (typeof points1 === 'number') existing.points1 = points1
    if (typeof points2 === 'number') existing.points2 = points2
    if (categories1 && categories2) {
      existing.categories1 = categories1
      existing.categories2 = categories2
    }
    return
  }

  matchups.push({
    teamId1,
    teamId2,
    points1,
    points2,
    categories1,
    categories2,
  })
}

function parseEspnCategoryTotals(side: Record<string, unknown>, statIds: readonly string[]): Record<string, number> | undefined {
  if (statIds.length < 2 || statIds.length > 40) return undefined
  const cumulative = isRecord(side.cumulativeScore) ? side.cumulativeScore : null
  const byStat = cumulative && isRecord(cumulative.scoreByStat) ? cumulative.scoreByStat : null
  if (!byStat) return undefined
  const totals: Record<string, number> = {}
  for (const id of statIds) {
    const entry = byStat[id]
    const score = isRecord(entry) ? parseNumber(entry.score, null) : null
    if (score == null) return undefined
    totals[id] = score
  }
  return totals
}

function parseEspnSchedule(raw: any, season: number, currentWeek: number | null): EspnImportScheduleWeek[] {
  const weeks = new Map<number, EspnImportScheduleWeek['matchups']>()
  const scheduleRaw = Array.isArray(raw?.schedule) ? raw.schedule : []
  const scoring = raw?.settings?.scoringSettings
  const categoryIds: string[] = String(scoring?.scoringType ?? '').toUpperCase().includes('CATEGOR') && Array.isArray(scoring?.scoringItems)
    ? [...new Set<string>(scoring.scoringItems.map((item: any): string => String(item?.statId ?? '')).filter((id: string) => /^\d{1,4}$/.test(id)))]
    : []

  // `${week}:${teamA}:${teamB}` (both orders) for every matchup ESPN has not decided yet.
  const undecided = new Set<string>()
  for (const matchup of scheduleRaw) {
    if (!isRecord(matchup)) continue
    const week = parseNumber(matchup.matchupPeriodId, null)
    if (week == null || week < 1) continue
    const home = isRecord(matchup.home) ? matchup.home : {}
    const away = isRecord(matchup.away) ? matchup.away : {}
    const teamId1 = String(home.teamId ?? '').trim()
    const teamId2 = String(away.teamId ?? '').trim()
    if (String(matchup.winner ?? '').toUpperCase() === 'UNDECIDED') {
      undecided.add(`${week}:${teamId1}:${teamId2}`)
      undecided.add(`${week}:${teamId2}:${teamId1}`)
    }
    upsertEspnMatchup(
      weeks,
      week,
      teamId1,
      teamId2,
      parseNumber(home.totalPoints, null) ?? undefined,
      parseNumber(away.totalPoints, null) ?? undefined,
      parseEspnCategoryTotals(home, categoryIds),
      parseEspnCategoryTotals(away, categoryIds),
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
        parseNumber(away.totalPoints, null) ?? undefined,
        parseEspnCategoryTotals(home, categoryIds),
        parseEspnCategoryTotals(away, categoryIds),
      )
    }
  }

  return Array.from(weeks.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([week, matchups]) => ({
      week,
      season,
      matchups: matchups.map((m) =>
        undecided.has(`${week}:${m.teamId1}:${m.teamId2 ?? ''}`) ? { ...m, undecided: true } : m,
      ),
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

/**
 * ESPN's activity feed -> our transaction shape.
 *
 * Exported so the unmapped-code tally below can be TESTED. That behaviour is the
 * only thing standing between "ESPN sent no trades" and "ESPN sent trades we do
 * not recognise", and it lived where nothing could reach it.
 */
export function parseEspnTransactions(
  raw: any,
  playerDirectory: Map<string, EspnPlayerSummary>
): EspnImportTransaction[] {
  const topics = Array.isArray(raw?.topics) ? raw.topics : Array.isArray(raw?.content?.topics) ? raw.content.topics : []
  const transactions: EspnImportTransaction[] = []
  /*
   * 🛑 AN UNMAPPED `messageTypeId` USED TO VANISH IN SILENCE, AND THAT IS WHY WE
   * COULD NOT SAY WHY ESPN YIELDS NO TRADES. Measured on production 2026-09-08:
   * ESPN leagues hold 39 transaction rows -- waiver/add/drop only -- and ZERO of
   * type `trade`, while Sleeper holds 18,657. `ESPN_ACTIVITY_TYPE_MAP` carries
   * exactly ONE trade code (244), and every code absent from it was dropped by a
   * bare `continue` with no counter, no log and no error.
   *
   * That makes two very different states indistinguishable: "these leagues had no
   * trades" and "ESPN sent trades under a code we do not know". This tally
   * separates them. It deliberately does NOT guess additional codes -- `contracts/espn/`
   * does not cover this activity feed (no ENDPOINTS.yaml entry, no fixture), so any code
   * added from memory would silently MISLABEL real transactions, which is worse than
   * dropping them.
   */
  const unmappedTypeCounts = new Map<number, number>()

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
      if (messageTypeId == null) continue
      if (!(messageTypeId in ESPN_ACTIVITY_TYPE_MAP)) {
        unmappedTypeCounts.set(messageTypeId, (unmappedTypeCounts.get(messageTypeId) ?? 0) + 1)
        continue
      }

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

  /*
   * One line per parse, only when something was actually dropped. Codes and counts
   * only -- no player, team or league identifiers, because this runs on a public
   * repo's production logs.
   */
  if (unmappedTypeCounts.size > 0) {
    const dropped = [...unmappedTypeCounts.values()].reduce((a, b) => a + b, 0)
    const detail = [...unmappedTypeCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id, n]) => `${id}x${n}`)
      .join(' ')
    console.warn(
      `[espn-activity] dropped ${dropped} message(s) with unmapped messageTypeId: ${detail}`,
    )
  }

  return transactions
}

function inferEspnSeasonFinished(args: {
  season: number
  currentWeek: number | null
  raw: any
}): boolean {
  /*
   * Read at call time, not module load: a server that started in December otherwise keeps last
   * year's value forever. And the FANTASY season, not the calendar year — in January the 2026
   * playoffs may still be running, so 2026 must not read as finished just because it is 2027.
   */
  if (args.season < espnCurrentFantasySeason()) return true

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
      /*
       * ⚠ A SOLO ENTRY CONTRIBUTES TO NOBODY'S POINTS-AGAINST. There is no opponent, so
       * these points were not scored against anyone — crediting them to a null key would
       * be inventing an opponent to blame.
       */
      if (typeof matchup.points1 === 'number' && matchup.teamId2 != null) {
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
  if (isEspnMlbSource(sourceInput)) {
    const { fetchEspnMlbLeagueForImport } = await import('./EspnMlbLeagueFetchService')
    return fetchEspnMlbLeagueForImport(userId, sourceInput, options)
  }
  const opts = { ...DEFAULT_FETCH_OPTIONS, ...options }
  const input = parseEspnLeagueInput(sourceInput)
  const { leagueId } = input
  const auth = await getEspnAuthForUser(userId)
  const { raw, season } = await loadEspnLeagueRawForInput({ input, auth, views: ESPN_IMPORT_VIEWS })
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
  let draftPicks = parseEspnDraftPicks(draftRaw, playerDirectory)
  /*
   * A pick names its player from the CURRENT rosters, so a player drafted and since dropped had no
   * name or position (GAPS.md D-01). Fill those from the id itself (team defenses) or our own player
   * table, never from ESPN, then label the picks again. Transactions below read the same directory.
   */
  const unlabeled = draftPicks
    .filter((p) => !p.playerName || !p.position || p.position === 'N/A')
    .map((p) => p.playerId)
  if (unlabeled.length > 0 && (await fillEspnPlayerDirectory(playerDirectory, unlabeled)) > 0) {
    draftPicks = parseEspnDraftPicks(draftRaw, playerDirectory)
  }
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
    viewerEspnConnected: buildEspnCookieHeader(auth) !== null,
    commissionerTeamIds,
  }
}

/**
 * Lean per-league schedule read for the weekly-matchup parity sync: ONE league
 * request (mMatchup + mScoreboard + mSettings views) instead of the full import fan-out
 * (roster, draft, transactions, previous-season probes). Reuses the same
 * cookie fallback as the import — public leagues need no credentials at all;
 * a private league whose stored cookies don't unlock it throws
 * `EspnImportConnectionError` so the caller can skip it with an honest note.
 */
export async function fetchEspnScheduleForSync(
  userId: string,
  leagueId: string,
  season: number
): Promise<EspnImportScheduleWeek[]> {
  if (isEspnMlbSource(leagueId)) {
    const { fetchEspnMlbLeagueForImport } = await import('./EspnMlbLeagueFetchService')
    return (await fetchEspnMlbLeagueForImport(userId, `${season}:${leagueId}`, { includePreviousSeasons: false })).schedule
  }
  const auth = await getEspnAuthForUser(userId)
  const raw = await loadEspnLeagueRaw({
    leagueId,
    season,
    auth,
    views: ['mMatchup', 'mScoreboard', 'mSettings'],
  })
  const currentWeek =
    parseNumber(raw?.status?.currentMatchupPeriod, null) ??
    parseNumber(raw?.scoringPeriodId, null)
  return parseEspnSchedule(raw, season, currentWeek)
}

/**
 * Test seam for the roster-slot split. Exported rather than made public because
 * the slot classification is where the bench/IR conflation lived and it needs a
 * regression test that does not require a live ESPN league.
 */
export { parseEspnRosterEntries as parseEspnRosterEntriesForTest }
export { resolveEspnOwners as resolveEspnOwnersForTest }

/**
 * Test seam for the schedule parse, exported for the same reason as the roster one: the
 * unpaired branch is where a whole league's scoring was being discarded, and it needs a
 * regression test that does not require a live ESPN league or its cookies.
 */
export { parseEspnSchedule as parseEspnScheduleForTest }

/**
 * The activity the trade windows read, for the Decision OS activity ingest
 * (app/api/cron/decision-os-activity-ingest): every team's owner (member SWID,
 * the id the importer stores as `LeagueTeam.platformUserId`) and the
 * communication feed's transactions, dated by ESPN. One `mTeam` read plus the
 * feed — not the whole import — because the ingest runs for every ESPN league
 * every day and rosters are not what it needs.
 *
 * `transactionsFetched` is false when ESPN served no feed (a season before the
 * feed existed, or a fetch that failed after the cookie fallback); the caller
 * must not read an empty list as "nobody moved".
 */
export async function fetchEspnActivityForSync(
  userId: string,
  leagueId: string,
  season: number
): Promise<{
  teams: Array<{ teamId: string; managerId: string }>
  transactions: EspnImportTransaction[]
  transactionsFetched: boolean
}> {
  if (isEspnMlbSource(leagueId)) {
    // MLB communication is not covered by the captured contract. Never poll NFL for this id.
    return { teams: [], transactions: [], transactionsFetched: false }
  }
  const auth = await getEspnAuthForUser(userId)
  const raw = await loadEspnLeagueRaw({ leagueId, season, auth, views: ['mTeam'] })
  const teams = parseEspnTeams(raw, null)
  const transactionsRaw = await loadOptionalEspnTransactionsRaw({ leagueId, season, auth })
  const transactions = transactionsRaw != null ? parseEspnTransactions(transactionsRaw, buildEspnPlayerDirectory(teams)) : []
  return {
    teams: teams.map((t) => ({ teamId: t.teamId, managerId: t.managerId })),
    transactions,
    transactionsFetched: transactionsRaw != null,
  }
}

export { buildEspnMemberDirectory, resolveEspnOwners, resolveEspnCommissionerTeamIds, parseEspnSettings }
