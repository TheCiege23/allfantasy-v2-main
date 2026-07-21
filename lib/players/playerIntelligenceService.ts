import { prisma } from '@/lib/prisma'
import {
  fetchFantasyCalcValues,
  getValuationCacheAgeMs,
  type FantasyCalcPlayer,
  type FantasyCalcSettings,
} from '@/lib/fantasycalc'
// Reuse the canonical normalizers rather than writing new ones: their long-form
// position table and team folding were derived from the actual distinct values in
// production, and identity matching has to agree with the canonical project's.
import { normalizePosition, normalizeTeam } from '@/lib/canonical/canonicalIdentity'
import { normalizePlayerName } from '@/lib/player-assets/resolvePlayerHeadshot'
import {
  assessFreshness,
  getMetricAvailability,
  isSupportedSport,
  type FreshnessAssessment,
  type MetricAvailability,
  type SupportedSport,
} from './player-data-availability'

/**
 * Player Intelligence service — assembles one truthful view of a player from the
 * sources that actually exist in production.
 *
 * Composition, and why each source is used:
 *   identity + bio + headshot  →  `SportsPlayer`      (deduped, see below)
 *   injury status              →  `SportsInjury`
 *   season production          →  `player_season_stats` (NFL only, 2023-2025)
 *   market value / ranks/trend →  live FantasyCalc API
 *
 * The DB's own value/projection/trending tables are empty in production
 * (`allfantasy_market_player_values` 0, `AFProjectionSnapshot` 0, `trending_players` 0),
 * so market figures come from FantasyCalc rather than from those tables. Weekly
 * projections and ownership percentages have no source at all and are deliberately
 * absent from this service's output — see `player-data-availability.ts`.
 *
 * Two production characteristics this module has to defend against:
 *
 * 1. `SportsPlayer` is keyed `@@unique([sport, externalId, source])`, so a player
 *    appears once PER INGESTING SOURCE. NFL holds 15,043 rows carrying only 11,960
 *    distinct `sleeperId`s. Joining without deduping multiplies rows and renders the
 *    same player several times. `dedupeBySleeperId` collapses them, preferring the
 *    most complete and most recently observed row.
 *
 * 2. `SportsPlayer.status` is a MIXED column: it holds roster values (Active,
 *    Inactive, Free Agent, Retired) AND injury values (Questionable, IR, PUP, Out)
 *    in the same field. Treating it as an injury status labels ~10,900 healthy NFL
 *    players as having an "injury status" of `Active`. `splitRosterAndInjuryStatus`
 *    separates the two meanings.
 */

/** A metric that may legitimately have no value. Never collapse this to a bare number. */
export interface MetricValue<T> {
  value: T | null
  availability: MetricAvailability
}

function available<T>(value: T | null, sport: string, metric: Parameters<typeof getMetricAvailability>[1]): MetricValue<T> {
  return { value, availability: getMetricAvailability(sport, metric) }
}

export interface PlayerIntelligenceRecord {
  /** Stable key for the UI. Sleeper id where present, else the SportsPlayer row id. */
  key: string
  sportsPlayerId: string
  sleeperId: string | null
  name: string
  sport: string

  position: MetricValue<string>
  team: MetricValue<string>
  headshotUrl: MetricValue<string>

  age: number | null
  college: string | null
  jerseyNumber: number | null
  heightIn: string | null
  weightLb: string | null

  /** Roster standing (Active / Free Agent / Retired ...), split out of the mixed column. */
  rosterStatus: string | null
  /** Injury designation only. Null means "no injury reported", not "healthy unknown". */
  injuryStatus: MetricValue<PlayerInjury>

  seasonStats: MetricValue<PlayerSeasonProduction>
  market: MetricValue<PlayerMarketSnapshot>

  /** When the underlying player row was last observed from its provider. */
  freshness: FreshnessAssessment
}

export interface PlayerInjury {
  status: string
  description: string | null
  reportedAt: Date | null
  source: string
}

export interface PlayerSeasonProduction {
  season: string
  gamesPlayed: number | null
  fantasyPoints: number | null
  fantasyPointsPerGame: number | null
  source: string
}

export interface PlayerMarketSnapshot {
  /** FantasyCalc market value, derived from real trade volume. */
  value: number
  overallRank: number
  positionRank: number
  /** 30-day change in market value. Positive = rising. */
  trend30Day: number
  /** Higher means the market disagrees with itself more about this player. */
  volatility: number | null
  /**
   * The league settings this value was computed under. A value is only meaningful
   * relative to these — the same player is worth different amounts in a superflex
   * league than a 1-QB league, which is exactly why this is carried through.
   */
  settings: FantasyCalcSettings
  /** True when settings came from a real league rather than the generic default. */
  leagueSpecific: boolean
}

export interface PlayerIntelligenceQuery {
  sport: string
  /** Free-text name search. Omit to browse by market rank. */
  query?: string
  limit?: number
  /**
   * League settings to value players under. When omitted, a documented generic
   * default is used and `market.leagueSpecific` is false so the UI can say so.
   */
  leagueSettings?: FantasyCalcSettings
}

export interface PlayerIntelligenceResult {
  players: PlayerIntelligenceRecord[]
  /**
   * Honest degradation channel. Any source that failed or was empty is reported
   * here rather than silently yielding a shorter list. Surface these in the UI.
   */
  dataGaps: string[]
  marketDataAgeMs: number | null
}

/**
 * Generic settings used when no league is selected. Deliberately the most common
 * redraft shape rather than something exotic, and always disclosed as generic.
 */
export const GENERIC_MARKET_SETTINGS: FantasyCalcSettings = {
  isDynasty: false,
  numQbs: 1,
  numTeams: 12,
  ppr: 1,
}

const DEFAULT_LIMIT = 24
const MAX_LIMIT = 100

/** Values that describe roster standing rather than an injury designation. */
const ROSTER_STATUS_VALUES = new Set([
  'active',
  'inactive',
  'act',
  'inact',
  'retired',
  'free agent',
  'na',
  'practice squad',
])

export function splitRosterAndInjuryStatus(raw: string | null | undefined): {
  rosterStatus: string | null
  injuryStatus: string | null
} {
  if (!raw) return { rosterStatus: null, injuryStatus: null }
  const trimmed = raw.trim()
  if (!trimmed) return { rosterStatus: null, injuryStatus: null }

  if (ROSTER_STATUS_VALUES.has(trimmed.toLowerCase())) {
    return { rosterStatus: trimmed, injuryStatus: null }
  }
  // Anything not recognised as a roster state is an injury designation
  // (Questionable, Doubtful, Out, IR, Injured Reserve, PUP, Suspended ...).
  return { rosterStatus: null, injuryStatus: trimmed }
}

type SportsPlayerRow = {
  id: string
  sport: string
  name: string
  position: string | null
  team: string | null
  number: number | null
  age: number | null
  height: string | null
  weight: string | null
  college: string | null
  imageUrl: string | null
  sleeperId: string | null
  status: string | null
  source: string
  fetchedAt: Date
}

/**
 * Identity key for rows that carry no `sleeperId`. Mirrors the canonical project's
 * fallback strategy — name + position + TEAM.
 *
 * Team is load-bearing, not decorative: keying on (name, position) alone fused
 * genuinely different people at production scale (5,826 groups containing rows from
 * the same ingesting source, which never lists one person twice). Adding team cut
 * that to 137. Returns null when team is missing so that an unteamed row is left
 * distinct — showing a duplicate is a cosmetic problem, whereas merging two
 * different players is data corruption.
 */
/**
 * Collapses a specific position onto the generic label for its family, used ONLY
 * when building the identity key — the displayed position is never rewritten.
 *
 * Providers disagree about how granular a defensive position is for the SAME
 * player: production has Tony Jefferson as `S` from rolling_insights and `DB` from
 * Sleeper and TheSportsDB, which left him rendered twice. The mapping is
 * deliberately specific→generic only, never specific→specific, so it resolves
 * "is this the generic or the precise label for one player" without ever claiming
 * a cornerback and a safety are the same person.
 */
const POSITION_FAMILY: Record<string, string> = {
  S: 'DB', FS: 'DB', SS: 'DB', CB: 'DB',
  OLB: 'LB', ILB: 'LB', MLB: 'LB',
  DE: 'DL', DT: 'DL', NT: 'DL',
  OT: 'OL', G: 'OL', C: 'OL', T: 'OL',
}

function identityKey(row: SportsPlayerRow): string | null {
  const team = normalizeTeam(row.team)
  if (!team) return null
  const position = normalizePosition(row.position)
  if (!position) return null
  const family = POSITION_FAMILY[position] ?? position
  return `${normalizePlayerName(row.name)}|${family}|${team}`
}

/**
 * Collapse per-source duplicates to one row per player.
 *
 * Two passes are required because `sleeperId` is not populated on every row. In
 * production, NFL holds 17,257 rows of which only 15,043 carry a `sleeperId`, and
 * the same player routinely appears both with and without one — Justin Jefferson
 * has six rows across five sources, two of them id-less. Keying on `sleeperId`
 * alone therefore left the id-less rows as separate players and rendered him four
 * times in search results.
 *
 * Pass 1 learns `identity → sleeperId` from the rows that have an id. Pass 2 lets
 * id-less rows adopt that id, so every representation of one player lands in the
 * same bucket. Rows that match no known identity keep their own key and stay
 * distinct.
 *
 * Note this correctly preserves genuinely different people who share a name: the
 * WR on MIN (sleeperId 6794) and the LB on CLE (13524) have different identities
 * and remain two separate players.
 *
 * Within a bucket, preference is completeness first (a row with a team and a
 * headshot beats a bare one), then recency as a tie-break.
 */
export function dedupeBySleeperId(rows: SportsPlayerRow[]): SportsPlayerRow[] {
  const identityToSleeperId = new Map<string, string>()
  for (const row of rows) {
    if (!row.sleeperId) continue
    const key = identityKey(row)
    if (key && !identityToSleeperId.has(key)) {
      identityToSleeperId.set(key, row.sleeperId)
    }
  }

  const byKey = new Map<string, SportsPlayerRow>()
  for (const row of rows) {
    const identity = identityKey(row)
    const resolvedId =
      row.sleeperId ?? (identity ? identityToSleeperId.get(identity) : undefined)
    const key = resolvedId ?? identity ?? `row:${row.id}`

    const incumbent = byKey.get(key)
    if (!incumbent || completenessScore(row) > completenessScore(incumbent)) {
      // Stamp the resolved id onto the survivor. The winning row is chosen on
      // completeness, which can select a row that has the only headshot but no
      // `sleeperId` — and `sleeperId` is the join key for BOTH market value and
      // season stats. Without this, a correctly-deduped player silently loses
      // their market value because the surviving row cannot be looked up.
      byKey.set(key, resolvedId && !row.sleeperId ? { ...row, sleeperId: resolvedId } : row)
    }
  }

  return Array.from(byKey.values())
}

function completenessScore(row: SportsPlayerRow): number {
  let score = 0
  if (row.team) score += 4
  if (row.imageUrl) score += 3
  if (row.position) score += 2
  if (row.age != null) score += 1
  // Recency breaks ties without ever outweighing a materially fuller record.
  score += Math.min(0.9, row.fetchedAt.getTime() / 1e15)
  return score
}

export async function getPlayerIntelligence(
  params: PlayerIntelligenceQuery,
): Promise<PlayerIntelligenceResult> {
  const dataGaps: string[] = []
  const sport = params.sport.toUpperCase()
  const limit = Math.min(MAX_LIMIT, Math.max(1, params.limit ?? DEFAULT_LIMIT))

  if (!isSupportedSport(sport)) {
    return {
      players: [],
      dataGaps: [`${sport} is not a supported sport — no players are stored for it.`],
      marketDataAgeMs: null,
    }
  }

  const settings = params.leagueSettings ?? GENERIC_MARKET_SETTINGS
  const leagueSpecific = Boolean(params.leagueSettings)

  // Market data first: for NFL it also supplies the browse ordering when there is
  // no search term, because "top of the trade market" is a meaningful default and
  // alphabetical is not.
  const market = await loadMarketValues(sport, settings, dataGaps)

  const trimmedQuery = params.query?.trim() ?? ''
  const rows = await loadPlayerRows({ sport, query: trimmedQuery, limit, market })

  if (rows.length === 0) {
    return { players: [], dataGaps, marketDataAgeMs: getMarketAge(sport, settings) }
  }

  const sleeperIds = rows.map((r) => r.sleeperId).filter((id): id is string => Boolean(id))

  const [seasonStats, injuries] = await Promise.all([
    loadSeasonStats(sport, sleeperIds, dataGaps),
    loadInjuries(sport, rows, dataGaps),
  ])

  const players = rows.map((row) =>
    assemble({ row, sport, market, seasonStats, injuries, settings, leagueSpecific }),
  )

  return { players, dataGaps, marketDataAgeMs: getMarketAge(sport, settings) }
}

function getMarketAge(sport: string, settings: FantasyCalcSettings): number | null {
  if (sport !== 'NFL') return null
  return getValuationCacheAgeMs(settings)
}

async function loadMarketValues(
  sport: string,
  settings: FantasyCalcSettings,
  dataGaps: string[],
): Promise<Map<string, FantasyCalcPlayer>> {
  const map = new Map<string, FantasyCalcPlayer>()
  // FantasyCalc is an NFL trade market. Calling it for other sports would return
  // NFL players under a non-NFL heading, which is worse than having no values.
  if (sport !== 'NFL') return map

  try {
    const values = await fetchFantasyCalcValues(settings)
    for (const entry of values) {
      const sleeperId = entry.player?.sleeperId
      if (sleeperId) map.set(String(sleeperId), entry)
    }
    if (map.size === 0) {
      dataGaps.push('The trade market returned no values — market ranks are unavailable right now.')
    }
  } catch {
    dataGaps.push(
      'Live market values could not be loaded. Player identity and injury data below are unaffected.',
    )
  }
  return map
}

async function loadPlayerRows(args: {
  sport: SupportedSport
  query: string
  limit: number
  market: Map<string, FantasyCalcPlayer>
}): Promise<SportsPlayerRow[]> {
  const { sport, query, limit, market } = args

  const select = {
    id: true,
    sport: true,
    name: true,
    position: true,
    team: true,
    number: true,
    age: true,
    height: true,
    weight: true,
    college: true,
    imageUrl: true,
    sleeperId: true,
    status: true,
    source: true,
    fetchedAt: true,
  } as const

  if (query.length >= 2) {
    // Over-fetch because per-source duplicates collapse afterwards; without the
    // multiplier a 24-row request can return well under 24 distinct players.
    const rows = await prisma.sportsPlayer.findMany({
      where: { sport, name: { contains: query, mode: 'insensitive' } },
      select,
      take: limit * 4,
    })
    return rankSearchResults(dedupeBySleeperId(rows), query, market).slice(0, limit)
  }

  // No search term: browse the top of the market. For NFL that is a real ordering;
  // for other sports there is no market, so fall back to players with a current
  // team, which at least excludes retired and unsigned rows.
  if (sport === 'NFL' && market.size > 0) {
    const topIds = Array.from(market.values())
      .sort((a, b) => a.overallRank - b.overallRank)
      .slice(0, limit * 2)
      .map((entry) => String(entry.player.sleeperId))

    const rows = await prisma.sportsPlayer.findMany({
      where: { sport, sleeperId: { in: topIds } },
      select,
    })
    const deduped = dedupeBySleeperId(rows)
    const order = new Map(topIds.map((id, index) => [id, index]))
    return deduped
      .sort((a, b) => (order.get(a.sleeperId ?? '') ?? 1e9) - (order.get(b.sleeperId ?? '') ?? 1e9))
      .slice(0, limit)
  }

  const rows = await prisma.sportsPlayer.findMany({
    where: { sport, team: { not: null } },
    select,
    orderBy: { name: 'asc' },
    take: limit * 4,
  })
  return dedupeBySleeperId(rows).slice(0, limit)
}

/**
 * Relevance ordering. Prisma's `contains` gives no ranking, so an unranked search
 * for "allen" buries Josh Allen under every other Allen in the league.
 */
function rankSearchResults(
  rows: SportsPlayerRow[],
  query: string,
  market: Map<string, FantasyCalcPlayer>,
): SportsPlayerRow[] {
  const q = query.toLowerCase()

  return rows
    .map((row) => {
      const name = row.name.toLowerCase()
      let score = 0
      if (name === q) score += 100
      else if (name.startsWith(q)) score += 60
      else if (name.split(/\s+/).some((part) => part.startsWith(q))) score += 40
      else score += 10

      // A player the trade market ranks is far more likely to be the one being
      // searched for than an identically-named practice-squad player.
      const entry = row.sleeperId ? market.get(row.sleeperId) : undefined
      if (entry) score += Math.max(0, 30 - entry.overallRank / 20)
      if (row.team) score += 5

      return { row, score }
    })
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.row)
}

async function loadSeasonStats(
  sport: SupportedSport,
  sleeperIds: string[],
  dataGaps: string[],
): Promise<Map<string, PlayerSeasonProduction>> {
  const map = new Map<string, PlayerSeasonProduction>()
  if (sport !== 'NFL' || sleeperIds.length === 0) return map

  // `player_season_stats.playerId` carries the Sleeper id for the rolling_insights
  // source, which covers 87.9% of stat rows. Rows outside that overlap simply have
  // no stats attached rather than being dropped from the result.
  const rows = await prisma.playerSeasonStats.findMany({
    where: { sport, playerId: { in: sleeperIds } },
    select: {
      playerId: true,
      season: true,
      gamesPlayed: true,
      fantasyPoints: true,
      fantasyPointsPerGame: true,
      source: true,
    },
    orderBy: { season: 'desc' },
  })

  for (const row of rows) {
    // orderBy season desc means the first row seen per player is the latest season.
    if (map.has(row.playerId)) continue
    map.set(row.playerId, {
      season: row.season,
      gamesPlayed: row.gamesPlayed,
      fantasyPoints: row.fantasyPoints,
      fantasyPointsPerGame: row.fantasyPointsPerGame,
      source: row.source,
    })
  }

  if (rows.length === 0) {
    dataGaps.push('No season statistics matched these players.')
  }
  return map
}

async function loadInjuries(
  sport: SupportedSport,
  rows: SportsPlayerRow[],
  dataGaps: string[],
): Promise<Map<string, PlayerInjury>> {
  const map = new Map<string, PlayerInjury>()
  const names = rows.map((r) => r.name)
  if (names.length === 0) return map

  try {
    // SportsInjury.playerId is sparsely populated, so match on name within sport.
    // Name matching is imprecise across identically-named players; injuries are
    // therefore treated as advisory and always shown with their report date.
    const injuries = await prisma.sportsInjury.findMany({
      where: { sport, playerName: { in: names } },
      select: {
        playerName: true,
        status: true,
        description: true,
        date: true,
        source: true,
        fetchedAt: true,
      },
      orderBy: { fetchedAt: 'desc' },
    })

    for (const injury of injuries) {
      if (map.has(injury.playerName)) continue
      if (!injury.status) continue
      map.set(injury.playerName, {
        status: injury.status,
        description: injury.description,
        reportedAt: injury.date ?? injury.fetchedAt,
        source: injury.source,
      })
    }
  } catch {
    dataGaps.push('Injury data could not be loaded for this view.')
  }

  return map
}

function assemble(args: {
  row: SportsPlayerRow
  sport: SupportedSport
  market: Map<string, FantasyCalcPlayer>
  seasonStats: Map<string, PlayerSeasonProduction>
  injuries: Map<string, PlayerInjury>
  settings: FantasyCalcSettings
  leagueSpecific: boolean
}): PlayerIntelligenceRecord {
  const { row, sport, market, seasonStats, injuries, settings, leagueSpecific } = args

  const { rosterStatus, injuryStatus: statusDerivedInjury } = splitRosterAndInjuryStatus(row.status)

  // A dedicated SportsInjury report is richer and better attributed than the
  // designation embedded in the mixed status column, so it wins when present.
  const reportedInjury = injuries.get(row.name) ?? null
  const injury: PlayerInjury | null =
    reportedInjury ??
    (statusDerivedInjury
      ? {
          status: statusDerivedInjury,
          description: null,
          reportedAt: row.fetchedAt,
          source: row.source,
        }
      : null)

  const marketEntry = row.sleeperId ? market.get(row.sleeperId) : undefined
  const marketSnapshot: PlayerMarketSnapshot | null = marketEntry
    ? {
        value: marketEntry.value,
        overallRank: marketEntry.overallRank,
        positionRank: marketEntry.positionRank,
        trend30Day: marketEntry.trend30Day,
        volatility: marketEntry.maybeMovingStandardDeviationPerc,
        settings,
        leagueSpecific,
      }
    : null

  return {
    key: row.sleeperId ?? row.id,
    sportsPlayerId: row.id,
    sleeperId: row.sleeperId,
    name: row.name,
    sport,

    // Normalized for display: only the NFL has multiple ingesting sources, and the
    // non-Sleeper ones emit long form, so ~7.6% of rows would otherwise render
    // "Wide Receiver" where every other row shows "WR".
    position: available(normalizePosition(row.position) || row.position, sport, 'identity'),
    team: available(row.team, sport, 'identity'),
    headshotUrl: available(row.imageUrl, sport, 'headshot'),

    age: row.age,
    college: row.college,
    jerseyNumber: row.number,
    heightIn: row.height,
    weightLb: row.weight,

    rosterStatus,
    injuryStatus: available(injury, sport, 'injuryStatus'),

    seasonStats: available(
      row.sleeperId ? seasonStats.get(row.sleeperId) ?? null : null,
      sport,
      'seasonStats',
    ),
    market: available(marketSnapshot, sport, 'marketValue'),

    freshness: assessFreshness(row.fetchedAt),
  }
}
