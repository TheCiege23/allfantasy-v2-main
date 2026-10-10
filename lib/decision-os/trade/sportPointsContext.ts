import 'server-only'

import { prisma } from '@/lib/prisma'
import { buildLeagueStatScorer, type LeagueStatScorer } from '@/lib/redraft/scoringEngine'
import { getDailySportNormalizer } from '@/lib/scoring-runtime/dailySportStatNormalization'
import { resolveRedraftRosterConfig } from '@/lib/redraft/rosterConfigResolver'
import { allowedPositionsForSlot } from '@/lib/redraft/lineupValidation'
import { normalizeSeasonType } from '@/lib/scores/gameScoreProviders'
import { getCategoryPresetDefinitions } from '@/lib/category-scoring'
import { nativeCategoryScoringContext } from '@/lib/category-scoring/nativeCategoryScoringContext'
import type { CategoryDefinition } from '@/lib/category-scoring/types'
import { rosteredIdsOf } from './ncaafRedraftContext'
import { categoryList, categoryPerGameValues, groupedCategoryValues } from './sportCategoryValue'
import { isPitchingCategory, isPitchingSlot, MLB_REGULAR_SEASON_GAMES, toTeamGameLines } from './mlbTeamGame'
import { blendSoccerSeasons, clubMatchCounts } from './soccerBoard'
import { soccerSeasonLines } from '@/lib/af-projections/soccerSeasonLines'
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
  settings: unknown
  leagueType: string | null
  leagueSize: number | null
}

export type SportPointsBaseResult = { ok: true; ctx: SportPointsContext } | { ok: false; reason: string }

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

/**
 * Regular-season games each team still has. Null when the schedule has no row for the season (unknown,
 * not over) — except baseball's, whose length is fixed: an MLB season with no schedule posted yet is the
 * offseason, and the grade prices the whole 162-game season ahead, saying so (`scheduleKnown: false`).
 */
async function seasonGamesLeft(
  sport: PointsGradedSport,
  season: number,
  now: Date,
): Promise<{ games: number; scheduleKnown: boolean } | null> {
  const counted = await gamesRemaining(sport, season, now)
  if (counted != null) return { games: counted, scheduleKnown: true }
  return sport === 'MLB' ? { games: MLB_REGULAR_SEASON_GAMES, scheduleKnown: false } : null
}

/**
 * Regular-season games each team still has, averaged across teams. Null when the schedule has no row for
 * the season at all (unknown, not over); 0 when it has rows and none are still to be played.
 */
async function gamesRemaining(sport: PointsGradedSport, season: number, now: Date): Promise<number | null> {
  const [anyRow, upcoming] = await Promise.all([
    prisma.sportsGame.findFirst({ where: { sport: { equals: sport, mode: 'insensitive' }, season }, select: { id: true } }).catch(() => null),
    prisma.sportsGame
      .findMany({
        where: { sport: { equals: sport, mode: 'insensitive' }, season, startTime: { gte: now } },
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
  if (perTeam.size === 0) return 0
  const total = [...perTeam.values()].reduce((a, b) => a + b, 0)
  return Math.round(total / perTeam.size)
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
): Valuation | { refuse: string } {
  if (league) {
    const native = nativeCategoryScoringContext(league.settings, sport)
    const categories = native ? getCategoryPresetDefinitions(native.presetId) : null
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
  const scorer = buildLeagueStatScorer({ sport, settings: league?.settings ?? null })
  return scorer ? { kind: 'points', scorer } : { refuse: `No ${sport} scoring is configured, so this deal cannot be graded.` }
}

export async function loadSportPointsBase(args: {
  sport: PointsGradedSport
  league: SportPointsLeague | null
  /** The open analyzer's scoring choice; ignored in a league, which is scored by its own settings. */
  format?: SportScoringFormat | null
  now?: Date
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

  const source = sport === 'SOCCER' ? await loadSoccerLines(now) : await loadSnapshotLines(sport, normalize, now)
  if (!source.ok) return source
  const { season, games, lines } = source
  return finishBoard({ sport, league, valuation, season, games, lines })
}

type BoardLine = Omit<BoardPlayer, 'perGame'> & { stats: Record<string, number> }
type LinesResult =
  | { ok: true; season: number; games: { games: number; scheduleKnown: boolean }; lines: BoardLine[] }
  | { ok: false; reason: string }

/**
 * Soccer reads its MATCH ROWS, both seasons, never the stored projections — those choose one season per
 * player and so rest on four to six matches in October. `./soccerBoard.ts` blends the seasons and puts
 * every player on his club's match scale; only players who have played this season are on the board.
 */
async function loadSoccerLines(now: Date): Promise<LinesResult> {
  const latest = await prisma.playerGameStat
    .findFirst({ where: { sportType: 'SOCCER' }, orderBy: { season: 'desc' }, select: { season: true } })
    .catch(() => null)
  if (!latest) return { ok: false, reason: 'No soccer match data is on file, so this deal cannot be graded yet.' }
  const season = latest.season
  const select = { playerId: true, gameId: true, team: true, gameDate: true, normalizedStatMap: true } as const
  const [current, prior, games] = await Promise.all([
    prisma.playerGameStat.findMany({ where: { sportType: 'SOCCER', season }, select }).catch(() => null),
    prisma.playerGameStat.findMany({ where: { sportType: 'SOCCER', season: season - 1 }, select }).catch(() => null),
    seasonGamesLeft('SOCCER', season, now),
  ])
  if (!current || !prior) return { ok: false, reason: 'The soccer match data could not be read just now.' }
  if (games == null) {
    return { ok: false, reason: `The ${seasonLabelFor(season, 'SOCCER')} soccer schedule is not on file, so the matches left to play cannot be counted.` }
  }

  const ids = [...new Set(current.map((r) => r.playerId))]
  const identities = await prisma.playerIdentityMap
    .findMany({ where: { id: { in: ids } }, select: { id: true, canonicalName: true, rollingInsightsId: true, sleeperId: true } })
    .catch(() => [] as Array<{ id: string; canonicalName: string; rollingInsightsId: string | null; sleeperId: string | null }>)
  const board = blendSoccerSeasons({
    current: soccerSeasonLines(current, new Map(identities.map((i) => [i.id, i.canonicalName])), season),
    prior: soccerSeasonLines(prior, new Map(), season - 1),
    clubMatches: { current: clubMatchCounts(current), prior: clubMatchCounts(prior) },
  })
  const aliasesById = new Map(identities.map((i) => [i.id, [i.rollingInsightsId, i.sleeperId].filter((v): v is string => Boolean(v))]))
  const lines: BoardLine[] = []
  for (const b of board) {
    if (!b.name || !b.position) continue
    lines.push({ id: b.playerId, name: b.name, position: b.position, sampleGames: b.sampleGames, aliases: aliasesById.get(b.playerId) ?? [], sourceSeason: season, stats: b.stats })
  }
  return { ok: true, season, games, lines }
}

/** Every other sport reads its stored projections (`AFProjectionSnapshot`), one row per player. */
async function loadSnapshotLines(
  sport: PointsGradedSport,
  normalize: (raw: unknown) => { stats: Record<string, number> },
  now: Date,
): Promise<LinesResult> {
  const latest = await prisma.aFProjectionSnapshot
    .findFirst({
      where: { sport: { equals: sport, mode: 'insensitive' }, week: null },
      orderBy: { season: 'desc' },
      select: { season: true },
    })
    .catch(() => null)
  if (!latest) return { ok: false, reason: `No ${sport} projections are on file, so this deal cannot be graded yet.` }
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
  if (!rows) return { ok: false, reason: `The ${sport} projections could not be read just now.` }
  if (games == null) return { ok: false, reason: `The ${seasonLabelFor(season, sport)} ${sport} schedule is not on file, so the games left to play cannot be counted.` }

  const identities = await prisma.playerIdentityMap
    .findMany({
      where: { id: { in: rows.map((r) => r.playerId) } },
      select: { id: true, rollingInsightsId: true, sleeperId: true },
    })
    .catch(() => [] as Array<{ id: string; rollingInsightsId: string | null; sleeperId: string | null }>)
  const aliasesById = new Map(identities.map((i) => [i.id, [i.rollingInsightsId, i.sleeperId].filter((v): v is string => Boolean(v))]))

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
    lines.push({
      id: r.playerId,
      name: r.playerName,
      position: String(r.position ?? '').trim().toUpperCase(),
      sampleGames: sampleGamesFromReasons(reasonsOf(r.adjustmentFactors)),
      aliases: aliasesById.get(r.playerId) ?? [],
      sourceSeason: sourceSeasonOf(r.adjustmentFactors),
      stats,
    })
  }
  return { ok: true, season, games, lines }
}

/** Value every line under the league's scoring, then build the board, its readiness and its waiver wire. */
async function finishBoard(args: {
  sport: PointsGradedSport
  league: SportPointsLeague | null
  valuation: Valuation
  season: number
  games: { games: number; scheduleKnown: boolean }
  lines: BoardLine[]
}): Promise<SportPointsBaseResult> {
  const { sport, league, valuation, season, games, lines } = args
  const teams = league?.leagueSize && league.leagueSize > 1 ? league.leagueSize : DEFAULT_TEAMS
  const lineup = lineupSlotsFor(sport, league?.settings ?? null)

  // Baseball onto one scale first: per TEAM game, pitchers split into SP and RP (`./mlbTeamGame.ts`).
  const valued: Array<(typeof lines)[number] & { hitter?: boolean; pitcher?: boolean }> =
    sport === 'MLB' ? toTeamGameLines(lines) : lines

  let perGameOf: (line: (typeof valued)[number]) => number
  if (valuation.kind === 'points') {
    perGameOf = (line) => valuation.scorer(line.stats, line.position)
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
    const { stats: _stats, ...player } = line
    board.push({ ...player, perGame })
  }
  const notReady = boardReadinessReason({ sport, board, season, seasonLabel: seasonLabelFor(season, sport) })
  if (notReady) return { ok: false, reason: notReady }
  const baseline = baselineSeasonOf(board, season)

  let replacementByPosition = replacementFromLineups(board, { teams, slots: lineup.slots, benchPerTeam: lineup.benchPerTeam })
  if (league) {
    const rosterRows = await prisma.roster.findMany({ where: { leagueId: league.id }, select: { playerData: true } }).catch(() => null)
    const rostered = rosterRows ? [...new Set(rosterRows.flatMap((r) => rosteredIdsOf(r.playerData)))] : []
    if (rostered.length > 0) {
      const index = indexBoard(board)
      const onBoard = new Set<string>()
      let mapped = 0
      for (const id of rostered) {
        const bare = id.includes(':') ? id.slice(id.indexOf(':') + 1) : id
        const hit = index.get(id) ?? index.get(bare)
        if (hit) {
          onBoard.add(hit.id)
          mapped += 1
        }
      }
      if (mapped / rostered.length >= MIN_ROSTER_MAPPING) replacementByPosition = replacementFromRosters(board, onBoard)
    }
  }

  return {
    ok: true,
    ctx: {
      sport,
      board,
      replacementByPosition,
      window: {
        season,
        seasonLabel: seasonLabelFor(season, sport),
        gamesRemaining: games.games,
        baselineSeasonLabel: baseline != null ? seasonLabelFor(baseline, sport) : null,
        ...(games.scheduleKnown ? {} : { scheduleKnown: false }),
      },
      scoringBasis: league ? 'league' : 'default',
      teams,
      valueKind: valuation.kind,
      categoryList: valuation.kind === 'categories' ? categoryList(valuation.categories) : null,
    },
  }
}
