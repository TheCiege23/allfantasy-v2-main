import 'server-only'

import { providerIdentityColumn } from '@/lib/player-identity/resolveProviderRosterPlayers'
import { reduceCrosswalk } from '@/lib/core-app/crosswalkRules'
import { readEspnNcaabClassYears } from '@/lib/espn/ncaabRosterSnapshot'
import type { TradeValuationGap } from './tradeGrade'
import { playerIdSpaceFor } from './tradePlayers'
import { readImportedPlayerMetadata } from '@/lib/league-import/importedPlayerMetadata'
import { fantraxSoccerExportKey, hasFantraxSoccerPool, validateFantraxSoccerExport } from '@/lib/league-import/fantrax/soccerPlayerExport'
import { coercePlayerAge } from '@/lib/sports-data/playerAge'
import { bridgeNcaafRosterIdsToCfbdIds } from '@/lib/redraft/ncaafGameLogIdBridge'
import { loadRookieDraftEvidence } from './rookieDraftEvidence'
import { readFantraxProspectAdp } from '@/lib/adp/fantraxProspectAdp'
import { readNbaProspectRanks } from '@/lib/adp/nbaProspectRanks'
import { isNativePlatform } from '@/lib/league/isNativeLeague'
import { collegePlayerIds } from '@/lib/c2c/campusLineup'
import { planProFantraxIdentityLinks, proTeamCode, type ProFantraxSport } from '@/lib/player-identity/proFantraxIdentityPlan'

import { prisma } from '@/lib/prisma'
import { buildLeagueStatScorer, type LeagueStatScorer } from '@/lib/redraft/scoringEngine'
import { resolveLeagueScoringRules } from '@/lib/redraft/leagueScoringRules'
import { getDailySportNormalizer } from '@/lib/scoring-runtime/dailySportStatNormalization'
import { resolveRedraftRosterConfig } from '@/lib/redraft/rosterConfigResolver'
import { allowedPositionsForSlot } from '@/lib/redraft/lineupValidation'
import { normalizeSeasonType } from '@/lib/scores/gameScoreProviders'
import { getCategoryPresetDefinitions } from '@/lib/category-scoring'
import { nativeCategoryScoringContext } from '@/lib/category-scoring/nativeCategoryScoringContext'
import type { CategoryDefinition } from '@/lib/category-scoring/types'
import { rosteredIdsOf } from './ncaafRedraftContext'
import { categoryList, categoryPerGameValues, groupedCategoryValues } from './sportCategoryValue'
import { isPitchingCategory, isPitchingSlot, MLB_CLUBS, MLB_REGULAR_SEASON_GAMES, toTeamGameLines } from './mlbTeamGame'
import { blendSoccerSeasons, clubMatchCounts } from './soccerBoard'
import { soccerSeasonLines, type SoccerGameRow } from '@/lib/af-projections/soccerSeasonLines'
import { eplGoalKeyForRollingMatch, ownGoalsByPlayer, readEplGoalReceipt } from '@/lib/sports-data/soccerOwnGoalEvidence'
import {
  boardReadinessReason,
  categoryLeagueReason,
  indexBoard,
  meetsSampleBar,
  multiSeasonFormatReason,
  replacementFromLineups,
  replacementFromRosters,
  sampleGamesFromReasons,
  type BoardPlayer,
  type LineupSlot,
  type PointsGradedSport,
  type SportPointsContext,
} from './sportPointsValue'
import { FULL_SEASON_GAMES, isDynastyGradedSport, isDynastyLeagueType } from './sportDynastyValue'

/**
 * What a daily-sport points grade is priced from, read once per league — or once per request with no
 * league (the open analyzer). See `./sportPointsValue.ts` for the rules.
 *
 * DB-first: `AFProjectionSnapshot` (keyed on `PlayerIdentityMap.id` for these sports — 100% of NBA, NHL,
 * NCAAB and MLB rows join, measured 2026-10-09), `PlayerIdentityMap`, rosters and the `SportsGame`
 * schedule. No provider call.
 */

export type SportPointsLeague = {
  id: string
  platform?: string | null
  platformLeagueId?: string | null
  settings: unknown
  leagueType: string | null
  leagueSize: number | null
  /** The league's season and status: in a dynasty league they say which rookie draft is next. */
  season?: number | null
  status?: string | null
}

export type SportPointsBaseResult = { ok: true; ctx: SportPointsContext } | { ok: false; reason: string; valuationGap?: TradeValuationGap }

const DEFAULT_TEAMS = 12

/**
 * Below this share of a league's rostered ids mapping onto the board, the rosters cannot say who is a
 * free agent — an unmapped rostered star would read as available and raise the replacement level for his
 * whole position — so the waiver wire is estimated from standard lineups instead.
 */
const MIN_ROSTER_MAPPING = 0.5

function readRates(adjustmentFactors: unknown): Record<string, unknown> | null {
  if (!adjustmentFactors || typeof adjustmentFactors !== 'object' || Array.isArray(adjustmentFactors)) return null
  const f = adjustmentFactors as Record<string, unknown>
  const rates = f.perGameRates ?? f.componentRates ?? null
  return rates && typeof rates === 'object' && !Array.isArray(rates) ? (rates as Record<string, unknown>) : null
}

/** A stored MLB line, already in the engine's keys: its finite numbers, as they are. */
function engineKeyedLine(raw: unknown): { stats: Record<string, number>; unmappedKeys: string[] } {
  const stats: Record<string, number> = {}
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw)) if (typeof v === 'number' && Number.isFinite(v)) stats[k] = v
  }
  return { stats, unmappedKeys: [] }
}

function reasonsOf(adjustmentFactors: unknown): unknown {
  return adjustmentFactors && typeof adjustmentFactors === 'object' ? (adjustmentFactors as Record<string, unknown>).confidenceReasons : null
}

function sourceSeasonOf(adjustmentFactors: unknown): number | null {
  const raw = adjustmentFactors && typeof adjustmentFactors === 'object' ? (adjustmentFactors as Record<string, unknown>).sourceSeason : null
  const n = Number(raw)
  return raw != null && Number.isFinite(n) ? n : null
}

/** The earlier season most of the board still projects from, or null when it projects from this one. */
function baselineSeasonOf(board: readonly BoardPlayer[], season: number): number | null {
  const counts = new Map<number, number>()
  for (const p of board) if (p.sourceSeason != null && p.sourceSeason < season) counts.set(p.sourceSeason, (counts.get(p.sourceSeason) ?? 0) + 1)
  const [top] = [...counts].sort((a, b) => b[1] - a[1])
  return top && top[1] / board.length > 0.5 ? top[0] : null
}

/** "2026-27" for a season keyed 2026 — winter seasons span two calendar years. Baseball's is one: "2027". */
export function seasonLabelFor(season: number, sport?: PointsGradedSport): string {
  if (sport === 'MLB') return String(season)
  return `${season}-${String((season + 1) % 100).padStart(2, '0')}`
}

type GamesLeft = { season: number; games: number; scheduleKnown: boolean }

/**
 * The season a deal is priced over and the regular-season games each team still has in it. Null when the
 * schedule has no row for the season (unknown, not over) — except baseball's, whose length is fixed: an
 * MLB season with no schedule posted yet is the offseason, and the grade prices the whole 162-game season
 * ahead, saying so (`scheduleKnown: false`).
 *
 * 🛑 AN MLB SEASON WHOSE REGULAR SEASON IS OVER IS PRICED AS THE NEXT ONE. Postseason games carry a NULL
 * `seasonType` (production, 2026-10-10: five 2026 games left, all untyped, among the clubs still playing),
 * so the count below cannot tell them from regular-season games and would price an October deal on the
 * three or four playoff games a handful of clubs have left. Fantasy baseball ends with the regular season;
 * what an October deal buys is next season. Every club plays to the last regular-season day, so fewer than
 * half of them with a game left is the end of it — whatever the rows are labelled.
 */
async function seasonGamesLeft(sport: PointsGradedSport, season: number, now: Date, scheduleSource?: 'thesportsdb'): Promise<GamesLeft | null> {
  const counted = await gamesRemaining(sport, season, now, scheduleSource)
  if (sport !== 'MLB') return counted == null ? null : { season, games: counted.games, scheduleKnown: true }
  if (counted == null) return { season, games: MLB_REGULAR_SEASON_GAMES, scheduleKnown: false }
  if (counted.teams * 2 >= MLB_CLUBS) return { season, games: counted.games, scheduleKnown: true }
  const next = await gamesRemaining(sport, season + 1, now)
  return next != null && next.teams * 2 >= MLB_CLUBS
    ? { season: season + 1, games: next.games, scheduleKnown: true }
    : { season: season + 1, games: MLB_REGULAR_SEASON_GAMES, scheduleKnown: false }
}

/**
 * Regular-season games each team still has, averaged across the teams that have one, and how many teams
 * that is. Null when the schedule has no row for the season at all (unknown, not over); zero games when it
 * has rows and none are still to be played.
 */
async function gamesRemaining(
  sport: PointsGradedSport,
  season: number,
  now: Date,
  scheduleSource?: 'thesportsdb',
): Promise<{ games: number; teams: number } | null> {
  const scope = { sport: { equals: sport, mode: 'insensitive' as const }, season, ...(scheduleSource ? { source: scheduleSource } : {}) }
  const [anyRow, upcoming] = await Promise.all([
    prisma.sportsGame.findFirst({ where: scope, select: { id: true } }).catch(() => null),
    prisma.sportsGame
      .findMany({
        where: { ...scope, startTime: { gte: now } },
        select: { homeTeam: true, awayTeam: true, seasonType: true },
      })
      .catch(() => [] as Array<{ homeTeam: string; awayTeam: string; seasonType: string | null }>),
  ])
  if (!anyRow) return null
  const perTeam = new Map<string, number>()
  for (const g of upcoming) {
    /*
     * ⚠ EVERY UPCOMING NBA, NHL AND NCAAB GAME HAS A NULL `seasonType` (production, 2026-10-09), so a
     * "regular season only" filter counted zero games for every sport. Only games the schedule marks as
     * pre- or postseason are left out; the few unlabelled preseason games add a game or two per team at
     * most, and one multiplier on every player cannot move the letter.
     */
    const type = normalizeSeasonType(g.seasonType)
    if (type === 'pre' || type === 'post') continue
    for (const t of [g.homeTeam, g.awayTeam]) perTeam.set(t, (perTeam.get(t) ?? 0) + 1)
  }
  if (perTeam.size === 0) return { games: 0, teams: 0 }
  const total = [...perTeam.values()].reduce((a, b) => a + b, 0)
  return { games: Math.round(total / perTeam.size), teams: perTeam.size }
}

/** The lineup the waiver wire is estimated from: the league's slots, or the sport's defaults. */
export function lineupSlotsFor(sport: PointsGradedSport, settings: unknown): { slots: LineupSlot[]; benchPerTeam: number } {
  const config = resolveRedraftRosterConfig(sport, settings)
  const slots: LineupSlot[] = [...config.starterCapacities].map(([token, count]) => ({
    slot: token,
    eligible: allowedPositionsForSlot(sport, token),
    count,
  }))
  return { slots, benchPerTeam: config.benchSlots }
}

/** How the open analyzer (no league) is asked to score a daily-sport deal. */
export type SportScoringFormat = 'points' | 'nba_9cat' | 'nba_8cat_standard' | 'mlb_5x5' | 'mlb_6x6'

/** Category presets the open analyzer offers, per sport. */
const OPEN_CATEGORY_PRESETS: Partial<Record<PointsGradedSport, readonly SportScoringFormat[]>> = {
  /*
   * Not college basketball: its stat feed carries no shot attempts (its normalizer maps points through
   * threes, no FGA/FTA), so FG% and FT% would read as zero for everyone and silently drop out.
   */
  NBA: ['nba_9cat', 'nba_8cat_standard'],
  // Every stat the 5x5 and 6x6 read is on the board (h/ab for AVG, er/outs for ERA, p_h/p_bb for WHIP).
  MLB: ['mlb_5x5', 'mlb_6x6'],
}

type Valuation =
  | { kind: 'points'; scorer: LeagueStatScorer }
  | { kind: 'categories'; categories: readonly CategoryDefinition[] }

/**
 * How this deal is valued: a league's stored category preset when it has one it can read, its own points
 * scoring otherwise; with no league, the format the open analyzer asked for (points by default).
 */
function valuationFor(
  sport: PointsGradedSport,
  league: SportPointsLeague | null,
  format: SportScoringFormat | null | undefined,
  verifiedSoccerOwnGoals?: boolean,
): Valuation | { refuse: string } {
  if (league) {
    const native = nativeCategoryScoringContext(league.settings, sport)
    // The league's own (possibly commissioner-edited) list, not the preset's.
    const categories = native ? native.categories : null
    if (categories?.length) return { kind: 'categories', categories }
    // A category league whose categories cannot be read must never fall back to a points grade.
    const unreadable = categoryLeagueReason(league.settings, sport)
    if (unreadable) return { refuse: unreadable }
  } else if (format && format !== 'points') {
    if (!(OPEN_CATEGORY_PRESETS[sport] ?? []).includes(format)) {
      return { refuse: `Category grades are not available for ${sport} yet, so this deal is not graded on categories.` }
    }
    const categories = getCategoryPresetDefinitions(format)
    if (categories?.length) return { kind: 'categories', categories }
  }
  const scorer = buildLeagueStatScorer({ sport, settings: league?.settings ?? null, verifiedSoccerOwnGoals })
  return scorer ? { kind: 'points', scorer } : { refuse: `No ${sport} scoring is configured, so this deal cannot be graded.` }
}

export async function loadSportPointsBase(args: {
  sport: PointsGradedSport
  league: SportPointsLeague | null
  /** The open analyzer's scoring choice; ignored in a league, which is scored by its own settings. */
  format?: SportScoringFormat | null
  now?: Date
  campusOnly?: boolean
}): Promise<SportPointsBaseResult> {
  const { sport, league } = args
  const now = args.now ?? new Date()

  if (league) {
    const format = multiSeasonFormatReason(league.leagueType, sport)
    if (format) return { ok: false, reason: format }
  }
  const valuation = valuationFor(sport, league, args.format)
  if ('refuse' in valuation) return { ok: false, reason: valuation.refuse }
  /*
   * NBA, NHL and college projections store the vendor's stat names and go through the box-score
   * normalizer here. MLB's are stored ALREADY in the engine's keys (`mlbPerGameRates`) — the normalizer
   * expects one game's batting OR pitching box and would read a stored line as nothing — so they are read
   * as they are.
   */
  const normalize = sport === 'MLB' ? engineKeyedLine : getDailySportNormalizer(sport)
  if (!normalize) return { ok: false, reason: `No ${sport} scoring is configured, so this deal cannot be graded.` }

  const campus = args.campusOnly === true && sport === 'NCAAB' && league && isNativePlatform(league.platform)
  const space = campus ? { provider: 'espn' } : league ? playerIdSpaceFor({ platform: league.platform ?? null, sport }) : null
  const column = typeof space === 'object' && space ? providerIdentityColumn(space.provider)
    : space === 'sleeper' ? 'sleeperId' : space === 'rolling_insights' ? 'rollingInsightsId' : null
  const provider = typeof space === 'object' && space ? space.provider : undefined
  const storedRosters = league ? await prisma.roster.findMany({ where: { leagueId: league.id }, select: { playerData: true } }).catch(() => []) : []
  const rosterRows = campus ? storedRosters.map(({ playerData }) => ({
    playerData: { players: [...collegePlayerIds(playerData)].flatMap((id) => /^espn:ncaab:(\d+)$/.exec(id)?.[1] ?? []) },
  })) : storedRosters
  const canLinkFromRoster = provider === 'yahoo' || provider === 'espn' || (provider === 'fantrax' && sport === 'SOCCER')
  const claims = canLinkFromRoster ? providerRosterClaims(rosterRows, provider) : []
  const published = sport === 'SOCCER' && provider === 'fantrax' && league && valuation.kind === 'points'
    ? await loadPublishedSoccerLines(league, rosterRows, now) : null
  const source = published ?? (sport === 'SOCCER' ? await loadSoccerLines(now, column, claims) : await loadSnapshotLines(sport, normalize, now, column, claims))
  if (!source.ok) return source
  const { season, games, lines, verifiedSoccerOwnGoals } = source
  const sourcedValuation = verifiedSoccerOwnGoals ? valuationFor(sport, league, args.format, true) : valuation
  if ('refuse' in sourcedValuation) return { ok: false, reason: sourcedValuation.refuse }
  const finished = await finishBoard({ sport, league, valuation: sourcedValuation, season, games, lines, verifiedSoccerOwnGoals, publishedSoccerPoints: Boolean(published), rosterProvider: provider, rosterRows, campusOnly: Boolean(campus) })
  if (!finished.ok || !league || !isDynastyGradedSport(sport) || !isDynastyLeagueType(league.leagueType)) return finished
  const boardIds = finished.ctx.board.map((p) => p.id)
  const nextDraftYear = nextRookieDraftYear(league, season, games.games, FULL_SEASON_GAMES[sport])
  if (sport === 'NCAAB') {
    const [classes, identities] = await Promise.all([
      readEspnNcaabClassYears(prisma, season + 1, now),
      prisma.playerIdentityMap.findMany({ where: { sport, id: { in: boardIds } }, select: { id: true, espnId: true } }),
    ])
    const classYears = new Map<string, number>()
    for (const [espnId, id] of reduceCrosswalk(identities.map((row) => ({ from: row.espnId, to: row.id })))) {
      const year = classes.get(espnId)
      if (year != null) classYears.set(id, year)
    }
    return { ok: true, ctx: { ...finished.ctx, dynasty: { ages: new Map(), classYears, nextDraftYear } } }
  }
  const [ages, rookieDraftEvidence, prospectAdp, nbaProspectRanks] = await Promise.all([
    loadBoardAges(sport, boardIds, now),
    sport === 'NBA' || sport === 'NHL' || sport === 'MLB' ? loadRookieDraftEvidence(league, now) : undefined,
    sport === 'NHL' || sport === 'MLB' ? readFantraxProspectAdp(sport, now) : undefined,
    sport === 'NBA' && isNativePlatform(league.platform) ? readNbaProspectRanks(nextDraftYear, now) : undefined,
  ])
  if (!ages) return { ok: false, reason: `The ${sport} players’ ages could not be read just now, so this dynasty deal cannot be graded.` }
  return { ok: true, ctx: { ...finished.ctx, dynasty: { ages, nextDraftYear, rookieDraftEvidence, prospectAdp, nbaProspectRanks } } }
}

/** League statuses that mean this season's rookie draft has been held. */
const DRAFT_HELD_STATUSES = new Set(['in_season', 'post_season', 'complete', 'completed'])

/**
 * The year of the next rookie draft: the league's season once its draft is behind it is next year's.
 * With no season on the league, the priced season stands in — a season already under way (fewer games
 * left than a full one) has had its draft.
 */
export function nextRookieDraftYear(
  league: Pick<SportPointsLeague, 'season' | 'status'>,
  pricedSeason: number,
  gamesRemaining: number,
  fullSeasonGames: number,
): number {
  const held = DRAFT_HELD_STATUSES.has(String(league.status ?? '').trim().toLowerCase())
  if (league.season != null && Number.isFinite(league.season)) return held ? league.season + 1 : league.season
  return gamesRemaining < fullSeasonGames ? pricedSeason + 1 : pricedSeason
}

/**
 * Today's age for each board player, by identity id. Read from `SportsPlayer` through the ids the
 * identity map was built on — the Rolling Insights id first, the Sleeper id second — and only when the
 * two agree to within the year the Rolling Insights age is accurate to (`lib/sports-data/playerAge.ts`).
 * Null when the read fails; a player missing from the map has no age on file.
 */
async function loadBoardAges(sport: PointsGradedSport, boardIds: readonly string[], now: Date): Promise<Map<string, number> | null> {
  const ids = [...new Set(boardIds)]
  if (ids.length === 0) return new Map()
  const identities = await prisma.playerIdentityMap
    .findMany({ where: { id: { in: ids } }, select: { id: true, rollingInsightsId: true, sleeperId: true, dob: true } })
    .catch(() => null)
  if (!identities) return null
  const riIds = identities.map((i) => i.rollingInsightsId).filter((v): v is string => Boolean(v))
  const sleeperIds = identities.map((i) => i.sleeperId).filter((v): v is string => Boolean(v))
  if (riIds.length === 0 && sleeperIds.length === 0) return pickBoardAges(identities, [], now)
  const rows = await prisma.sportsPlayer
    .findMany({
      where: {
        sport: { in: [sport, sport.toLowerCase()] },
        AND: [{ OR: [{ age: { not: null } }, { dob: { not: null } }] }],
        OR: [
          ...(riIds.length ? [{ source: 'rolling_insights', externalId: { in: riIds } }] : []),
          ...(sleeperIds.length ? [{ sleeperId: { in: sleeperIds } }] : []),
        ],
      },
      select: { source: true, externalId: true, sleeperId: true, age: true, dob: true },
    })
    .catch(() => null)
  if (!rows) return null
  return pickBoardAges(identities, rows, now)
}

/** Pure half of `loadBoardAges`: one age per identity, or none when its sources disagree. */
export function pickBoardAges(
  identities: ReadonlyArray<{ id: string; rollingInsightsId: string | null; sleeperId: string | null; dob?: string | null }>,
  rows: ReadonlyArray<{ source: string | null; externalId: string | null; sleeperId: string | null; age: number | null; dob?: string | null }>,
  now: Date = new Date(),
): Map<string, number> {
  const riAge = new Map<string, Set<number>>()
  const sleeperAge = new Map<string, Set<number>>()
  const add = (m: Map<string, Set<number>>, key: string, age: number) => (m.get(key) ?? m.set(key, new Set()).get(key)!).add(age)
  for (const r of rows) {
    const age = coercePlayerAge(r.dob, now) ?? (r.age != null && Number.isFinite(r.age) && r.age >= 14 && r.age <= 60 ? r.age : null)
    if (age == null) continue
    if (r.source === 'rolling_insights' && r.externalId) add(riAge, r.externalId, age)
    if (r.sleeperId) add(sleeperAge, r.sleeperId, age)
  }
  const out = new Map<string, number>()
  for (const i of identities) {
    const fromSleeper = [...(i.sleeperId ? sleeperAge.get(i.sleeperId) ?? [] : [])]
    const dobAge = coercePlayerAge(i.dob, now)
    const ages = [...(i.rollingInsightsId ? riAge.get(i.rollingInsightsId) ?? [] : []), ...fromSleeper, ...(dobAge == null ? [] : [dobAge])]
    if (ages.length === 0) continue
    // Two sources a year apart is the birthday; further apart, one of them is wrong and neither is used.
    if (Math.max(...ages) - Math.min(...ages) > 1) continue
    // Sleeper's age is exact where Rolling Insights' is good to a year, so Sleeper's wins when both agree.
    out.set(i.id, fromSleeper.length ? Math.min(...fromSleeper) : Math.min(...ages))
  }
  return out
}

const identitySelect = { id: true, rollingInsightsId: true, sleeperId: true, espnId: true, fantraxId: true, mflId: true, fleaflickerId: true } as const
type RosterIdColumn = Exclude<keyof typeof identitySelect, 'id'> | null
const crosswalkSelect = { ...identitySelect, canonicalName: true, currentTeam: true, position: true } as const

type RosterRow = { playerData: unknown }
type RosterClaim = { fantraxId: string; name: string; position: string; team: string }

/** Keep only complete, uncontradicted claims from this league’s stored provider rosters. */
function providerRosterClaims(rows: readonly RosterRow[], provider: string): RosterClaim[] {
  const claims = new Map<string, RosterClaim>()
  const conflicts = new Set<string>()
  for (const { playerData } of rows) {
    for (const id of rosteredIdsOf(playerData)) {
      const p = readImportedPlayerMetadata(playerData, provider, id)
      if (!p?.team || !p.position) continue
      const claim = { fantraxId: id, name: p.name, team: p.team, position: p.position }
      const prior = claims.get(id)
      if (prior && JSON.stringify(prior) !== JSON.stringify(claim)) conflicts.add(id)
      claims.set(id, claim)
    }
  }
  return [...claims.values()].filter((claim) => !conflicts.has(claim.fantraxId))
}

/** The strict name, recognized club, and role matcher is reused with this provider’s ID space. */
function rosterProjectionLinks(
  sport: ProFantraxSport,
  column: RosterIdColumn,
  identities: Array<{ id: string; rollingInsightsId: string | null; canonicalName: string; currentTeam: string | null; position: string | null } & Partial<Record<NonNullable<RosterIdColumn>, string | null>>>,
  claims: RosterClaim[],
): Map<string, string> {
  const links = reduceCrosswalk(identities.map((i) => ({ from: column ? i[column] : null, to: i.id })))
  if (!claims.length) return links
  const planned = planProFantraxIdentityLinks(sport, claims, identities.map((row) => ({ ...row, fantraxId: column ? row[column] ?? null : null })))
  for (const link of planned.links) links.set(link.fantraxId, link.id)
  return links
}

export async function loadImportedTradeIdentityCoverage(league: { id: string; platform: string; sport: string }) {
  const rows = await prisma.roster.findMany({ where: { leagueId: league.id }, select: { playerData: true } })
  const ids = [...new Set(rows.flatMap((row) => rosteredIdsOf(row.playerData)))]
  if (!ids.length) return { rostered: 0, linked: 0 }
  if (league.sport === 'NCAAF' && league.platform === 'espn') {
    const bridge = await bridgeNcaafRosterIdsToCfbdIds(prisma, ids, 'espn')
    return { rostered: ids.length, linked: bridge.cfbdIds.length }
  }
  const sport = league.sport
  if (sport !== 'NBA' && sport !== 'NHL' && sport !== 'MLB' && sport !== 'SOCCER') return { rostered: ids.length, linked: 0 }
  const identities = await prisma.playerIdentityMap.findMany({ where: { sport }, select: crosswalkSelect })
  const links = rosterProjectionLinks(sport, providerIdentityColumn(league.platform), identities, providerRosterClaims(rows, league.platform))
  return { rostered: ids.length, linked: ids.filter((id) => links.has(id)).length }
}

type BoardLine = Omit<BoardPlayer, 'perGame'> & { stats: Record<string, number>; publishedPerGame?: number }
/** `season` is the one priced: the lines' own, or the next one once an MLB regular season is over. */
type LinesResult =
  | { ok: true; season: number; games: GamesLeft; lines: BoardLine[]; verifiedSoccerOwnGoals?: boolean }
  | { ok: false; reason: string; valuationGap?: TradeValuationGap }

async function loadPublishedSoccerLines(league: SportPointsLeague, rosters: readonly RosterRow[], now: Date): Promise<Extract<LinesResult, { ok: true }> | null> {
  if (!league.platformLeagueId || !league.season) return null
  const cacheKey = fantraxSoccerExportKey(league.id)
  const row = await prisma.sportsDataCache.findUnique({ where: { cacheKey }, select: { data: true } }).catch(() => null)
  const verified = row && validateFantraxSoccerExport(row.data, league, now)
  if (!verified || rosters.length === 0) return null
  const { board } = verified
  if (!hasFantraxSoccerPool(board.players, rosters.flatMap((r) => rosteredIdsOf(r.playerData)))) return null
  const byId = board.players.map((p) => p.fantraxId)
  const games = await seasonGamesLeft('SOCCER', board.season, now, 'thesportsdb')
  if (!games) return null
  const identities = await prisma.playerIdentityMap.findMany({
    where: { sport: 'SOCCER', fantraxId: { in: byId } }, select: { id: true, fantraxId: true },
  }).catch(() => [])
  const links = reduceCrosswalk(identities.map((i) => ({ from: i.fantraxId, to: i.id })))
  const lines = board.players.map((p) => ({
    id: links.get(p.fantraxId) ?? 'fantrax:' + p.fantraxId,
    name: p.name, position: p.position, aliases: [], rosterAlias: p.fantraxId,
    sampleGames: p.appearances, sourceSeason: board.season, stats: {}, publishedPerGame: p.fantasyPoints / p.clubMatches,
  }))
  return { ok: true, season: board.season, games, lines }
}

type StoredSoccerMatch = SoccerGameRow & { gameId: string; providerGameId: string | null }

/** Attach goals only when every match contributing to the linked board has a complete receipt. */
async function loadSoccerOwnGoals(
  rows: readonly StoredSoccerMatch[],
  linked: ReadonlySet<string>,
  names: ReadonlyMap<string, string>,
  now: Date,
): Promise<Map<string, Map<string, number>> | null> {
  if (!linked.size) return null
  const matchId = (row: StoredSoccerMatch) => row.providerGameId ?? row.gameId.split(':')[0]!
  const relevantMatches = new Set(rows.filter((row) => linked.has(row.playerId)).map(matchId))
  const keys = new Map<string, string>()
  for (const id of relevantMatches) {
    const key = eplGoalKeyForRollingMatch(id)
    if (!key) return null
    keys.set(id, key)
  }
  if (!keys.size) return null
  const cached = await prisma.sportsDataCache.findMany({
    where: { cacheKey: { in: [...keys.values()] }, expiresAt: { gt: now } },
    select: { cacheKey: true, data: true },
  }).catch(() => [])
  const receipts = new Map(cached.map((row) => [row.cacheKey, readEplGoalReceipt(row.data)]))
  const participants = new Map<string, Array<{ playerId: string; name: string | null; team: string | null }>>()
  for (const row of rows) {
    const id = matchId(row)
    if (!keys.has(id)) continue
    const group = participants.get(id) ?? []
    group.push({ playerId: row.playerId, name: names.get(row.playerId) ?? null, team: row.team })
    participants.set(id, group)
  }
  const goals = new Map<string, Map<string, number>>()
  for (const [id, key] of keys) {
    const receipt = receipts.get(key)
    const matched = receipt && ownGoalsByPlayer(receipt, participants.get(id) ?? [])
    if (!matched) return null
    goals.set(id, matched)
  }
  return goals
}

/**
 * Soccer reads its MATCH ROWS, both seasons, never the stored projections — those choose one season per
 * player and so rest on four to six matches in October. `./soccerBoard.ts` blends the seasons and puts
 * every player on his club's match scale; only players who have played this season are on the board.
 */
async function loadSoccerLines(now: Date, column: RosterIdColumn, claims: RosterClaim[]): Promise<LinesResult> {
  const latest = await prisma.playerGameStat
    .findFirst({ where: { sportType: 'SOCCER' }, orderBy: { season: 'desc' }, select: { season: true } })
    .catch(() => null)
  if (!latest) return { ok: false, reason: 'No soccer match data is on file, so this deal cannot be graded yet.', valuationGap: 'missing_projections' }
  const season = latest.season
  const select = { playerId: true, gameId: true, providerGameId: true, team: true, gameDate: true, normalizedStatMap: true } as const
  const [current, prior, games] = await Promise.all([
    prisma.playerGameStat.findMany({ where: { sportType: 'SOCCER', season }, select }).catch(() => null),
    prisma.playerGameStat.findMany({ where: { sportType: 'SOCCER', season: season - 1 }, select }).catch(() => null),
    // TheSportsDB's Soccer schedule ingest is scoped to the EPL. Fantrax EPL
    // players should use that schedule instead of mixing it with other leagues.
    seasonGamesLeft('SOCCER', season, now, column === 'fantraxId' ? 'thesportsdb' : undefined),
  ])
  if (!current || !prior) return { ok: false, reason: 'The soccer match data could not be read just now.', valuationGap: 'missing_projections' }
  if (games == null) {
    return { ok: false, reason: `The ${seasonLabelFor(season, 'SOCCER')} soccer schedule is not on file, so the matches left to play cannot be counted.`, valuationGap: 'missing_schedule' }
  }

  const ids = [...new Set((column === 'fantraxId' ? [...current, ...prior] : current).map((r) => r.playerId))]
  // Fantrax ids must be unique across the sport, even when a competing identity has no match rows.
  const where = column === 'fantraxId'
    ? { sport: 'SOCCER', ...(claims.length ? {} : { OR: [{ id: { in: ids } }, { fantraxId: { not: null } }] }) }
    : { id: { in: ids } }
  const identities = await prisma.playerIdentityMap
    .findMany({ where, select: crosswalkSelect })
    .catch(() => [])
  const fantraxLinks = column === 'fantraxId'
    ? rosterProjectionLinks('SOCCER', column, identities, claims)
    : null
  const names = new Map(identities.map((i) => [i.id, i.canonicalName]))
  const currentIds = new Set(current.map((row) => row.playerId))
  const linked = fantraxLinks && new Set([...fantraxLinks.values()].filter((id) => currentIds.has(id)))
  if (linked && linked.size === 0) {
    return { ok: false, reason: 'No Soccer match projections are linked to a verified Fantrax player ID.', valuationGap: 'unresolved_player' }
  }
  // A roster-derived link can establish who is traded before the public EPL crosswalk lands.
  // Other EPL projections still supply a replacement pool, but cannot resolve a traded asset.
  const eligible = linked && new Set(linked)
  if (eligible && claims.length) {
    for (const row of current) if (proTeamCode('SOCCER', row.team)) eligible.add(row.playerId)
  }
  const ownGoals = eligible && await loadSoccerOwnGoals([...current, ...prior], eligible, names, now)
  const withGoals = (rows: StoredSoccerMatch[]) => ownGoals ? rows.map((row) => ({
    ...row,
    ownGoals: ownGoals.get(row.providerGameId ?? row.gameId.split(':')[0]!)?.get(row.playerId) ?? 0,
  })) : rows
  const board = blendSoccerSeasons({
    current: soccerSeasonLines(withGoals(current), names, season),
    prior: soccerSeasonLines(withGoals(prior), new Map(), season - 1),
    clubMatches: { current: clubMatchCounts(current), prior: clubMatchCounts(prior) },
  })
  const aliasesById = new Map(identities.map((i) => [i.id, [i.rollingInsightsId, i.sleeperId].filter((v): v is string => Boolean(v))]))
  const rosterAliasById = fantraxLinks
    ? new Map([...fantraxLinks].map(([alias, id]) => [id, alias]))
    : new Map(identities.map((i) => [i.id, column ? i[column]?.trim() : null]))
  const lines: BoardLine[] = []
  for (const b of board) {
    if (!b.name || !b.position || (eligible && !eligible.has(b.playerId))) continue
    lines.push({ id: b.playerId, name: b.name, position: b.position, sampleGames: b.sampleGames, aliases: aliasesById.get(b.playerId) ?? [], rosterAlias: rosterAliasById.get(b.playerId), sourceSeason: season, stats: b.stats })
  }
  if (fantraxLinks && lines.length === 0) {
    return { ok: false, reason: 'No Soccer match projections are linked to a verified Fantrax player ID.', valuationGap: 'unresolved_player' }
  }
  return { ok: true, season, games, lines, ...(ownGoals ? { verifiedSoccerOwnGoals: true } : {}) }
}

/** Every other sport reads its stored projections (`AFProjectionSnapshot`), one row per player. */
async function loadSnapshotLines(
  sport: PointsGradedSport,
  normalize: (raw: unknown) => { stats: Record<string, number> },
  now: Date,
  column: RosterIdColumn,
  claims: RosterClaim[],
): Promise<LinesResult> {
  /*
   * 🛑 THE NEWEST RUN'S SEASON, NEVER THE HIGHEST SEASON ON FILE. The projection writer stamps MLB with the
   * newest season that still has an unplayed game (`writeAfProjectionSnapshots`' target-season bound), and
   * between postseason rounds there is none: production went 2026 (to 10-07) -> 2027 (10-08, 10-09) ->
   * 2026 (10-10). A label change writes NEW rows, so the 2027 rows of 10-09 stayed behind, stale, and the
   * highest season was theirs — fielding-only lines, from before the batting and pitching rates landed —
   * while the day's run sat under 2026 and no MLB deal could be graded. One run writes one season, so the
   * newest row names it.
   */
  const latest = await prisma.aFProjectionSnapshot
    .findFirst({
      where: { sport: { equals: sport, mode: 'insensitive' }, week: null },
      orderBy: { computedAt: 'desc' },
      select: { season: true },
    })
    .catch(() => null)
  if (!latest) return { ok: false, reason: `No ${sport} projections are on file, so this deal cannot be graded yet.`, valuationGap: 'missing_projections' }
  const season = latest.season

  const [rows, games] = await Promise.all([
    prisma.aFProjectionSnapshot
      .findMany({
        where: { sport: { equals: sport, mode: 'insensitive' }, season, week: null },
        select: { playerId: true, playerName: true, position: true, adjustmentFactors: true },
      })
      .catch(() => null),
    seasonGamesLeft(sport, season, now),
  ])
  if (!rows) return { ok: false, reason: `The ${sport} projections could not be read just now.`, valuationGap: 'missing_projections' }
  if (games == null) return { ok: false, reason: `The ${seasonLabelFor(season, sport)} ${sport} schedule is not on file, so the games left to play cannot be counted.`, valuationGap: 'missing_schedule' }

  const projected = { id: { in: rows.map((r) => r.playerId) } }
  const providerColumn = column === 'rollingInsightsId' || column === 'sleeperId' ? null : column
  const proSport = sport === 'NBA' || sport === 'NHL' || sport === 'MLB' ? sport : null
  const rosterClaims = proSport ? claims : []
  const identities = await prisma.playerIdentityMap
    .findMany({
      where: rosterClaims.length ? { sport } : providerColumn ? { sport, OR: [projected, { [providerColumn]: { not: null } }] } : projected,
      select: crosswalkSelect,
    })
    .catch(() => [])
  const providerLinks = proSport && rosterClaims.length
    ? rosterProjectionLinks(proSport, providerColumn, identities, rosterClaims)
    : providerColumn ? reduceCrosswalk(identities.map((i) => ({ from: i[providerColumn], to: i.id }))) : null
  const aliasesById = new Map(identities.map((i) => [i.id, [i.rollingInsightsId, i.sleeperId].filter((v): v is string => Boolean(v))]))
  const rosterAliasById = providerLinks
    ? new Map([...providerLinks].map(([alias, id]) => [id, alias]))
    : new Map(identities.map((i) => [i.id, column ? i[column]?.trim() : null]))

  // Every scoreable projection as a per-game stat line first; the valuation is applied once all are read.
  const lines: BoardLine[] = []
  for (const r of rows) {
    const rates = readRates(r.adjustmentFactors)
    if (!rates) continue
    const { stats } = normalize(rates)
    if (Object.keys(stats).length === 0) continue
    // Derived from ONE game's line by the normalizer; on a season average they would fire every night.
    delete stats.dbl_dbl
    delete stats.trpl_dbl
    // NHL rate bonuses are per game too: on an average line they would score the season's rate.
    delete stats.g_sv_pct_bonus
    delete stats.g_gaa_bonus
    delete stats.sh_pct_bonus
    lines.push({
      id: r.playerId,
      name: r.playerName,
      position: String(r.position ?? '').trim().toUpperCase(),
      sampleGames: sampleGamesFromReasons(reasonsOf(r.adjustmentFactors)),
      aliases: aliasesById.get(r.playerId) ?? [],
      rosterAlias: rosterAliasById.get(r.playerId),
      sourceSeason: sourceSeasonOf(r.adjustmentFactors),
      stats,
    })
  }
  return { ok: true, season: games.season, games, lines }
}

/** Value every line under the league's scoring, then build the board, its readiness and its waiver wire. */
async function finishBoard(args: {
  sport: PointsGradedSport
  league: SportPointsLeague | null
  valuation: Valuation
  season: number
  games: { games: number; scheduleKnown: boolean }
  lines: BoardLine[]
  verifiedSoccerOwnGoals?: boolean
  publishedSoccerPoints?: boolean
  rosterProvider?: string
  rosterRows: readonly RosterRow[]
  campusOnly?: boolean
}): Promise<SportPointsBaseResult> {
  const { sport, league, valuation, season, games, lines, verifiedSoccerOwnGoals, rosterProvider } = args
  const savedTeamCount = league?.leagueSize
  const hasSavedTeamCount = typeof savedTeamCount === 'number' && Number.isInteger(savedTeamCount) && savedTeamCount >= 2
  const teams = hasSavedTeamCount ? savedTeamCount : DEFAULT_TEAMS
  const lineup = lineupSlotsFor(sport, league?.settings ?? null)
  let scoringBasis: SportPointsContext['scoringBasis'] = league ? 'league' : 'default'
  if (!args.publishedSoccerPoints && sport === 'SOCCER' && league?.platform?.toLowerCase() === 'fantrax' && valuation.kind === 'points') {
    const rules = resolveLeagueScoringRules({ sport, settings: league.settings, verifiedSoccerOwnGoals })
    if (rules?.fantraxSoccer) {
      scoringBasis = rules.fantraxSoccer.gaps.length ? 'partial_fantrax_soccer' : 'league'
    } else {
      const leagueWeights = Object.entries(rules?.overrides ?? {})
      const defaultWeights = resolveLeagueScoringRules({ sport, settings: null })?.overrides ?? {}
      if (leagueWeights.length === Object.keys(defaultWeights).length &&
          leagueWeights.every(([key, weight]) => weight === defaultWeights[key])) scoringBasis = 'default_in_league'
    }
  }

  // Baseball onto one scale first: per TEAM game, pitchers split into SP and RP (`./mlbTeamGame.ts`).
  const valued: Array<(typeof lines)[number] & { hitter?: boolean; pitcher?: boolean }> =
    sport === 'MLB' ? toTeamGameLines(lines) : lines

  let perGameOf: (line: (typeof valued)[number]) => number
  if (valuation.kind === 'points') {
    perGameOf = (line) => line.publishedPerGame ?? valuation.scorer(line.stats, line.position)
  } else {
    /*
     * The pool a category's average and spread are measured over is the players the league rosters —
     * teams × (starters + bench) — never the whole board, where hundreds of deep-bench lines would set
     * the scale. Thin projections are valued but never set it (`meetsSampleBar`).
     */
    const starters = lineup.slots.reduce((s, slot) => s + slot.count, 0)
    const asPlayer = (l: (typeof valued)[number]) => ({ id: l.id, stats: l.stats, eligible: meetsSampleBar(l) })
    let values: ReturnType<typeof categoryPerGameValues>
    if (sport === 'MLB') {
      // Hitters against hitters on the hitting categories, pitchers against pitchers on the pitching ones;
      // each pool is the league's slots for that group plus its share of the bench.
      const pitchingSlots = lineup.slots.filter((s) => isPitchingSlot(s.eligible)).reduce((s, slot) => s + slot.count, 0)
      const hittingSlots = starters - pitchingSlots
      const pool = (slots: number) => teams * (slots + (starters > 0 ? (lineup.benchPerTeam * slots) / starters : 0))
      values = groupedCategoryValues([
        { players: valued.filter((l) => l.hitter).map(asPlayer), categories: valuation.categories.filter((c) => !isPitchingCategory(c)), poolSize: pool(hittingSlots) },
        { players: valued.filter((l) => l.pitcher).map(asPlayer), categories: valuation.categories.filter(isPitchingCategory), poolSize: pool(pitchingSlots) },
      ])
    } else {
      values = categoryPerGameValues(valued.map(asPlayer), valuation.categories, teams * (starters + lineup.benchPerTeam))
    }
    perGameOf = (line) => values.get(line.id)?.total ?? Number.NaN
  }
  const board: BoardPlayer[] = []
  for (const line of valued) {
    const perGame = perGameOf(line)
    if (!Number.isFinite(perGame)) continue
    const { stats: _stats, publishedPerGame: _published, ...player } = line
    board.push({ ...player, perGame })
  }
  const notReady = boardReadinessReason({ sport, board, season, seasonLabel: seasonLabelFor(season, sport) })
  if (notReady) return { ok: false, reason: notReady, valuationGap: 'projection_coverage' }
  const baseline = baselineSeasonOf(board, season)

  let replacementByPosition = replacementFromLineups(board, { teams, slots: lineup.slots, benchPerTeam: lineup.benchPerTeam })
  let rosterIndex: ReadonlyMap<string, BoardPlayer> | undefined
  const requireProviderId = sport === 'SOCCER' && league?.platform?.trim().toLowerCase() === 'fantrax'
  if (league) {
    rosterIndex = indexBoard(board, rosterProvider ? 'provider' : true)
    const rostered = [...new Set(args.rosterRows.flatMap((r) => rosteredIdsOf(r.playerData)))]
    if (args.campusOnly && rostered.length === 0) return { ok: false, reason: 'No verified Campus roster IDs are saved.', valuationGap: 'unresolved_player' }
    if (rostered.length > 0) {
      const onBoard = new Set<string>()
      let mapped = 0
      for (const id of rostered) {
        const hit = rosterIndex.get(id) ?? (league.platform?.toLowerCase() === 'sleeper' ? rosterIndex.get(id.replace(/^sleeper:/, '')) : undefined)
        if (hit) {
          onBoard.add(hit.id)
          mapped += 1
        }
      }
      if (mapped / rostered.length >= MIN_ROSTER_MAPPING) replacementByPosition = replacementFromRosters(board, onBoard)
      else if (args.campusOnly) return { ok: false, reason: 'Too few Campus roster IDs link to current college projections.', valuationGap: 'projection_coverage' }
    }
  }

  return {
    ok: true,
    ctx: {
      sport,
      board,
      replacementByPosition,
      ...(rosterIndex ? { rosterIndex } : {}),
      ...(requireProviderId ? { requireProviderId } : {}),
      ...(rosterProvider ? { rosterProvider } : {}),
      window: {
        season,
        seasonLabel: seasonLabelFor(season, sport),
        gamesRemaining: games.games,
        baselineSeasonLabel: baseline != null ? seasonLabelFor(baseline, sport) : null,
        ...(games.scheduleKnown ? {} : { scheduleKnown: false }),
      },
      scoringBasis,
      ...(verifiedSoccerOwnGoals ? { verifiedSoccerOwnGoals } : {}),
      ...(args.publishedSoccerPoints ? { publishedSoccerPoints: true } : {}),
      teams,
      ...(league && !hasSavedTeamCount ? { teamCountAssumed: true } : {}),
      valueKind: valuation.kind,
      categoryList: valuation.kind === 'categories' ? categoryList(valuation.categories) : null,
    },
  }
}
