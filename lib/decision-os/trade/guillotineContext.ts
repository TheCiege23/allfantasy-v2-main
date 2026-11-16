import 'server-only'

import { prisma } from '@/lib/prisma'
import { reduceCrosswalk } from '@/lib/core-app/crosswalkRules'
import { computeLeagueProjectedPoints, hasScoringRules, NO_LEAGUE_SCORING_REASON } from '@/lib/projections/leagueScoring'
import { lineupSeatsFromSettings } from '@/lib/core-app/slotEligibility'
import { isTeamEliminated } from '@/lib/core-app/teamElimination'
import { rosteredIdsOf } from './ncaafRedraftContext'
import { scoringRulesFrom } from './scoringContextFromWorld'
import { allowedPositionsForSlot } from '@/lib/redraft/lineupValidation'
import { getDailyRedraftRosterLayout, type DailyRedraftSport } from '@/lib/sportConfig/dailySportRedraftRoster'
import { BENCH_SLOTS, startingSlots } from '@/lib/core-app/slotEligibility'
import { getGuillotineSportConfig } from '@/lib/guillotine/sportConfig'
import { dailySportWeekForInstant, resolveDailySportSeasonStart } from '@/lib/season-week/dailySportSeasonStarts'
import { indexBoard, sampleGamesFromReasons, type BoardPlayer } from './sportPointsValue'
import { lineupSlotsFor, loadSportPointsBase, seasonLabelFor } from './sportPointsContext'
import {
  guillotineTradeSport,
  minReplacementGamesFor,
  releaseValue,
  slotReplacement,
  survivalCurve,
  wireValue,
  type GuillotineContext,
  type GuillotineRoster,
  type GuillotineSeat,
  type GuillotineTradeSport,
} from './guillotineValue'

/**
 * What a guillotine grade is priced from, read once per league. See `./guillotineValue.ts` for the rules.
 * Daily sport leagues read their points board and native period calendar instead;
 * what follows describes the NFL read.
 *
 * DB-first: the league's settings (lineup, scoring), its rosters (who is alive, who is rostered, the FAAB
 * each live team holds), the NFL season projections (`AFProjectionSnapshot`, keyed on
 * `PlayerIdentityMap.id`) and their Sleeper ids. No provider call.
 *
 * ⚠ A CHOPPED SLEEPER TEAM IS ONLY VISIBLE AS AN EMPTY ROSTER. An imported Sleeper guillotine league
 * records no `eliminatedAt` and no `guillotine_roster_states` row (Guillotine League 26 (1), 2026-10-11:
 * 18 teams, none marked, 4 rosters empty) — so "alive" is `isTeamEliminated`, which reads the provider's
 * flag and the emptied roster.
 */

/**
 * Below this share of the live rosters' ids mapping onto the board, the rosters cannot say who is a free
 * agent — an unmapped rostered star would read as available and raise the replacement level for his whole
 * slot — so the deal is refused rather than priced against an imaginary waiver wire.
 */
const MIN_ROSTER_MAPPING = 0.5

const RECEPTION_KEYS = ['rec', 'receptions', 'receiving.REC'] as const

export function readRates(adjustmentFactors: unknown): Record<string, unknown> | null {
  if (!adjustmentFactors || typeof adjustmentFactors !== 'object' || Array.isArray(adjustmentFactors)) return null
  const f = adjustmentFactors as Record<string, unknown>
  const rates = f.perGameRates ?? f.componentRates ?? null
  return rates && typeof rates === 'object' && !Array.isArray(rates) ? (rates as Record<string, unknown>) : null
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

/**
 * Points a game under the league's rules, with its position-based reception bonus.
 *
 * ⚠ `computeLeagueProjectedPoints` TAKES NO POSITION, so a TE premium (`bonus_rec_te`, which this league
 * scores) matches no projected stat and adds nothing. It is added here from the receptions the line
 * carries — the same for `bonus_rec_rb` / `_wr` / `_qb`.
 */
export function leaguePointsPerGame(rates: Record<string, unknown> | null, rules: Record<string, unknown>, position: string): number | null {
  const scored = computeLeagueProjectedPoints(rates, rules)
  if (!scored || !Number.isFinite(scored.points)) return null
  const bonus = num(rules[`bonus_rec_${position.trim().toLowerCase()}`])
  if (!bonus || !rates) return scored.points
  let receptions: number | null = null
  for (const k of RECEPTION_KEYS) {
    receptions = num(rates[k])
    if (receptions != null) break
  }
  return scored.points + (receptions ?? 0) * bonus
}

function lineupLabel(seats: readonly GuillotineSeat[]): string {
  const counts = new Map<string, number>()
  for (const s of seats) counts.set(s.slot, (counts.get(s.slot) ?? 0) + 1)
  return [...counts].map(([slot, n]) => `${n} ${slot}`).join(', ')
}

export type GuillotineContextResult = { ok: true; ctx: GuillotineContext } | { ok: false; reason: string }

export type GuillotineLeague = {
  id: string
  platform?: string | null
  settings: unknown
  leagueSize: number | null
  /** NFL when absent. */
  sport?: string | null
}

/** NFL or a supported daily sport, by the league's sport. */
export async function loadGuillotineContext(league: GuillotineLeague, now: Date = new Date()): Promise<GuillotineContextResult> {
  const sport = league.sport == null ? 'NFL' : guillotineTradeSport(league.sport)
  if (sport === 'NBA' || sport === 'NHL' || sport === 'MLB') return loadDailyGuillotineContext(league, sport, now)
  if (sport !== 'NFL') return { ok: false, reason: 'This sport does not have a Guilly trade model.' }
  return loadNflGuillotineContext(league)
}

/** Zombie players use the same league-scored projection board, with the best free agent as the replacement. */
export async function loadZombiePlayerContext(league: GuillotineLeague): Promise<GuillotineContextResult> {
  if (String(league.sport ?? 'NFL').toUpperCase() !== 'NFL') {
    return { ok: false, reason: 'Zombie player values currently cover NFL leagues only.' }
  }
  return loadNflGuillotineContext(league, 'zombie')
}

const ESPN_NFL_SEAT_NAMES = new Map([
  ['BE', 'BN'], ['D/ST', 'DEF'], ['RB/WR', 'WRRB_FLEX'], ['WR/TE', 'REC_FLEX'], ['DP', 'IDP_FLEX'],
])

/** ESPN imports persist counts (for example RB:2) instead of one entry per slot. */
function espnNflLineupSettings(settings: unknown): unknown {
  const saved = (settings as { roster_positions?: unknown } | null)?.roster_positions
  if (!Array.isArray(saved)) return settings
  const slots: string[] = []
  for (const raw of saved) {
    const slot = /^([A-Z/_]+)(?::(\d+))?$/.exec(String(raw).trim().toUpperCase())
    const count = Number(slot?.[2] ?? 1)
    if (!slot || !Number.isInteger(count) || count > 100) return null
    const label = slot[1]!
    slots.push(...Array<string>(count).fill(ESPN_NFL_SEAT_NAMES.get(label) ?? label))
  }
  return { roster_positions: slots }
}

async function loadNflGuillotineContext(league: GuillotineLeague, mode: 'guillotine' | 'zombie' = 'guillotine'): Promise<GuillotineContextResult> {
  const format = mode === 'zombie' ? 'Zombie' : 'Guilly'
  const platform = league.platform?.trim().toLowerCase() ?? ''
  const espn = platform === 'espn'
  const seatsRaw = lineupSeatsFromSettings(espn ? espnNflLineupSettings(league.settings) : league.settings)
  if (!seatsRaw) return { ok: false, reason: `This league’s starting lineup could not be read, so a ${format} grade cannot be priced.` }
  const seats: GuillotineSeat[] = seatsRaw.map((s) => ({ slot: s.slot, eligible: s.eligible }))
  const rules = scoringRulesFrom(league.settings)
  if (!rules || !hasScoringRules(rules)) return { ok: false, reason: NO_LEAGUE_SCORING_REASON }

  // The newest run's season (one run writes one season) — never the highest season on file.
  const latest = await prisma.aFProjectionSnapshot
    .findFirst({ where: { sport: 'NFL', week: null }, orderBy: { computedAt: 'desc' }, select: { season: true } })
    .catch(() => null)
  if (!latest) return { ok: false, reason: `No NFL projections are on file, so this ${format} trade cannot be graded yet.` }

  const [rows, savedRosters] = await Promise.all([
    prisma.aFProjectionSnapshot
      .findMany({
        where: { sport: 'NFL', season: latest.season, week: null },
        select: { playerId: true, playerName: true, position: true, adjustmentFactors: true, rosWeeksRemaining: true },
      })
      .catch(() => null),
    prisma.roster.findMany({ where: { leagueId: league.id }, select: { playerData: true, faabRemaining: true, redraftRosterId: true } }).catch(() => null),
  ])
  if (!rows) return { ok: false, reason: 'The NFL projections could not be read just now.' }
  if (!savedRosters) return { ok: false, reason: 'This league’s rosters could not be read just now.' }
  let rosterRows = savedRosters
  if (espn && league.leagueSize && savedRosters.length > league.leagueSize) {
    const linkedRosters = savedRosters.filter((row) => row.redraftRosterId)
    if (linkedRosters.length !== league.leagueSize) {
      return { ok: false, reason: 'The imported ESPN league has more saved rosters than teams, and the active season roster links are incomplete.' }
    }
    rosterRows = linkedRosters
  }

  /*
   * 🛑 NATIVE AND SLEEPER ROSTERS USE SLEEPER IDS. Rolling Insights' bare numbers share Sleeper's range, and the board index drops
   * an id two players answer to: with both on the board, Bijan Robinson (Sleeper 9509, RI 7408) lost his
   * own Sleeper id to that clash, his roster spot matched nothing, and he became the "best free agent"
   * for every slot (production, 2026-10-11) — zeroing every value in the league. These rosters and the
   * deals graded there carry Sleeper ids. ESPN rosters use only verified ESPN aliases, so a
   * coincident Sleeper number cannot select a different player or pollute the waiver wire.
   */
  const rosterIds = espn ? [...new Set(rosterRows.flatMap((r) => rosteredIdsOf(r.playerData)))] : []
  const identities = await prisma.playerIdentityMap
    .findMany({
      where: espn ? { sport: 'NFL', espnId: { in: rosterIds } } : { id: { in: rows.map((r) => r.playerId) } },
      select: { id: true, sleeperId: true, espnId: true },
    }).catch(() => [])
  const aliasesById = new Map(identities.map((i) => [i.id, i.sleeperId ? [i.sleeperId] : []]))
  const espnById = espn ? new Map([...reduceCrosswalk(identities.map((i) => ({ from: i.espnId, to: i.id })))]
    .map(([providerId, id]) => [id, providerId])) : null

  const board: BoardPlayer[] = []
  const weeksLeft: number[] = []
  for (const r of rows) {
    const position = String(r.position ?? '').trim().toUpperCase()
    const perGame = leaguePointsPerGame(readRates(r.adjustmentFactors), rules, position)
    if (perGame == null) continue
    const f = (r.adjustmentFactors ?? {}) as Record<string, unknown>
    board.push({
      id: r.playerId,
      name: r.playerName,
      position,
      perGame,
      sampleGames: sampleGamesFromReasons(f.confidenceReasons),
      aliases: espn ? [] : aliasesById.get(r.playerId) ?? [],
      ...(espn ? { rosterAlias: espnById?.get(r.playerId) } : {}),
      sourceSeason: num(f.sourceSeason),
    })
    if (typeof r.rosWeeksRemaining === 'number') weeksLeft.push(r.rosWeeksRemaining)
  }
  if (board.length === 0) return { ok: false, reason: 'No NFL projection could be scored on this league’s rules.' }
  weeksLeft.sort((a, b) => a - b)
  const nflWeeksLeft = weeksLeft.length ? weeksLeft[Math.floor(weeksLeft.length / 2)]! : 0

  return assembleGuillotineContext({ sport: 'NFL', board, seats, rosterRows, leagueSize: league.leagueSize, weeksLeft: nflWeeksLeft, gamesPerWeek: null, mode, espn })
}

/**
 * The NBA regular-season weeks a guillotine league has left to chop, the week in progress included — on the
 * period calendar the native chop runs on (`dailySportWeekForInstant`: seven Eastern days from the recorded
 * opener) and the guillotine profile's 24 regular-season weeks. Null when that season's opener is not
 * recorded: a guessed anchor would count the wrong weeks with confidence.
 */
export function dailyGuillotineWeeksLeft(sport: DailyRedraftSport, season: number, now: Date): number | null {
  const opener = resolveDailySportSeasonStart(sport, season)
  const total = getGuillotineSportConfig(sport)?.regularSeasonWeeks
  if (!opener || !total) return null
  const week = dailySportWeekForInstant(sport, season, now)
  if (week != null) return Math.max(0, total - week + 1)
  // Before the opener (its Eastern midnight falls a few hours after the UTC date it is stored under).
  return now.getTime() < Date.parse(opener) + 86_400_000 ? total : null
}

/** Kept for callers that use the original NBA calendar helper. */
export function nbaGuillotineWeeksLeft(season: number, now: Date): number | null {
  return dailyGuillotineWeeksLeft('NBA', season, now)
}

/** A daily sport's real starting positions; unknown imported slots refuse the grade. */
function dailySeats(sport: DailyRedraftSport, settings: unknown): GuillotineSeat[] | null {
  const layout = getDailyRedraftRosterLayout(sport)
  if (!layout) return null
  const positions = new Set(layout.starters.flatMap((s) => s.eligiblePositions))
  const seat = (slot: string): GuillotineSeat | null => {
    const eligible = allowedPositionsForSlot(sport, slot).filter((p) => positions.has(p))
    return eligible.length ? { slot: slot.toUpperCase(), eligible } : null
  }
  // A Sleeper import stores `roster_positions`; the redraft resolver reads the native slot map (or the defaults).
  const imported = startingSlots(settings)
  const tokens = imported
    ? imported.filter((t) => !BENCH_SLOTS.has(t) && t !== 'IL' && t !== 'IR' && t !== 'NA')
    : lineupSlotsFor(sport, settings).slots.flatMap((s) => Array.from({ length: s.count }, () => s.slot))
  const seats: GuillotineSeat[] = []
  for (const t of tokens) {
    const s = seat(t)
    if (!s) return null
    seats.push(s)
  }
  return seats.length ? seats : null
}

/**
 * A daily sport guillotine league's context. The board is the sport's points board (`loadSportPointsBase`: the league's
 * own scoring, `AFProjectionSnapshot` keyed on `PlayerIdentityMap.id`, its readiness and dynasty refusals),
 * put on the WEEK — see `./guillotineValue.ts`. No provider call.
 */
async function loadDailyGuillotineContext(league: GuillotineLeague, sport: DailyRedraftSport, now: Date): Promise<GuillotineContextResult> {
  const seats = dailySeats(sport, league.settings)
  if (!seats) return { ok: false, reason: 'This league’s starting lineup could not be read, so a Guilly grade cannot be priced.' }
  const base = await loadSportPointsBase({
    sport,
    league: { id: league.id, settings: league.settings, leagueType: 'guillotine', leagueSize: league.leagueSize },
    now,
  })
  if (!base.ok) return base
  // A guillotine chops the lowest POINTS total; a category score answers a different question.
  if (base.ctx.valueKind === 'categories') {
    return { ok: false, reason: `This Guilly league scores ${sport} by categories, and the chop is decided on points, so this deal is not graded.` }
  }
  const { season, gamesRemaining } = base.ctx.window
  const weeksLeft = dailyGuillotineWeeksLeft(sport, season, now)
  if (weeksLeft == null) {
    return { ok: false, reason: `The ${seasonLabelFor(season, sport)} ${sport} season’s opening date is not on file, so the Guilly weeks left cannot be counted.` }
  }
  if (weeksLeft > 0 && !(gamesRemaining > 0)) {
    return { ok: false, reason: `No ${seasonLabelFor(season, sport)} ${sport} games are left on the schedule, so this Guilly trade cannot be graded.` }
  }
  const gamesPerWeek = weeksLeft > 0 ? gamesRemaining / weeksLeft : 0
  const weekly = base.ctx.board.map((p) => ({ ...p, perGame: p.perGame * gamesPerWeek }))

  const rosterRows = await prisma.roster.findMany({ where: { leagueId: league.id }, select: { playerData: true, faabRemaining: true } }).catch(() => null)
  if (!rosterRows) return { ok: false, reason: 'This league’s rosters could not be read just now.' }

  /*
   * 🛑 ONE ID SPACE, NEVER BOTH. The points board answers to Rolling Insights AND Sleeper ids, and their bare
   * numbers overlap: an id two players answer to is dropped from the index, so a rostered star would read as
   * a free agent and raise his slot's replacement level for the whole league (the NFL's Bijan Robinson,
   * 2026-10-11 — see the NFL loader). The rosters are in one space; the board is matched in whichever of the
   * two maps more of them, and only that one.
   */
  const identities = await prisma.playerIdentityMap
    .findMany({ where: { id: { in: weekly.map((p) => p.id) } }, select: { id: true, rollingInsightsId: true, sleeperId: true } })
    .catch(() => [] as Array<{ id: string; rollingInsightsId: string | null; sleeperId: string | null }>)
  const byId = new Map(identities.map((i) => [i.id, i]))
  const inSpace = (key: 'sleeperId' | 'rollingInsightsId') =>
    weekly.map((p) => {
      const alias = byId.get(p.id)?.[key]
      return { ...p, aliases: alias ? [alias] : [] }
    })
  const rosteredIds = rosterRows.flatMap((r) => rosteredIdsOf(r.playerData))
  const mappedIn = (b: readonly BoardPlayer[]) => {
    const index = indexBoard(b)
    return rosteredIds.filter((id) => index.has(id) || index.has(id.includes(':') ? id.slice(id.indexOf(':') + 1) : id)).length
  }
  const sleeper = inSpace('sleeperId')
  const ri = inSpace('rollingInsightsId')
  const board = mappedIn(ri) > mappedIn(sleeper) ? ri : sleeper
  return assembleGuillotineContext({ sport, board, seats, rosterRows, leagueSize: league.leagueSize, weeksLeft, gamesPerWeek })
}

/** Who is alive and rostered, the wire, the survival curve and what FAAB buys — the same for every sport. */
function assembleGuillotineContext(args: {
  sport: GuillotineTradeSport
  board: BoardPlayer[]
  seats: GuillotineSeat[]
  rosterRows: ReadonlyArray<{ playerData: unknown; faabRemaining: number | null }>
  leagueSize: number | null
  weeksLeft: number
  gamesPerWeek: number | null
  mode?: 'guillotine' | 'zombie'
  espn?: boolean
}): GuillotineContextResult {
  const { sport, board, seats, rosterRows, weeksLeft } = args
  const minGames = minReplacementGamesFor(sport)
  const index = indexBoard(board, args.espn ? 'provider' : false)
  const live: GuillotineRoster[] = []
  const rostered = new Set<string>()
  let ids = 0
  let mapped = 0
  for (const r of rosterRows) {
    if (args.mode !== 'zombie' && isTeamEliminated({ playerData: r.playerData, league: { guillotineMode: true }, eliminationRecorded: false })) continue
    const players: string[] = []
    for (const id of rosteredIdsOf(r.playerData)) {
      ids += 1
      const bare = id.includes(':') ? id.slice(id.indexOf(':') + 1) : id
      const hit = index.get(id) ?? (args.espn ? undefined : index.get(bare))
      if (!hit) continue
      mapped += 1
      players.push(hit.id)
      rostered.add(hit.id)
    }
    live.push({ players, faab: typeof r.faabRemaining === 'number' ? r.faabRemaining : null })
  }
  if (live.length < 2) return { ok: false, reason: args.mode === 'zombie' ? 'Fewer than two team rosters are on file for this Zombie league.' : 'Fewer than two teams are alive in this Guilly league, so there is nothing left to trade for.' }
  if (ids === 0 || mapped / ids < MIN_ROSTER_MAPPING) {
    return { ok: false, reason: 'This league’s rosters could not be matched to projected players, so the waiver wire cannot be priced.' }
  }

  // Zombie has free, instant adds and no chopped-player auction: the best available player is replacement.
  const replacementBySlot = slotReplacement(board, rostered, seats, args.mode === 'zombie' ? 0 : live.length, minGames)
  const survival = args.mode === 'zombie' ? [Math.max(0, weeksLeft)] : survivalCurve(live.length, weeksLeft)
  const byId = new Map(board.map((p) => [p.id, p]))
  return {
    ok: true,
    ctx: {
      sport,
      board,
      ...(args.espn ? { espnRosterIndex: index } : {}),
      seats,
      replacementBySlot,
      teamsAlive: live.length,
      startingTeams: Math.max(rosterRows.length, args.leagueSize ?? 0),
      weeksLeft,
      gamesPerWeek: args.gamesPerWeek,
      minReplacementGames: minGames,
      survival,
      liveFaab: live.reduce((s, r) => s + Math.max(0, r.faab ?? 0), 0),
      releaseValue: args.mode === 'zombie' ? 0 : releaseValue({ rosters: live, board: byId, seats, replacementBySlot, survival }),
      wireValue: args.mode === 'zombie' ? 0 : wireValue({ board, rostered, seats, replacementBySlot, survival, minGames }),
      lineupLabel: lineupLabel(seats),
    },
  }
}
