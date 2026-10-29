/**
 * A full redraft season, draft to renewal, driven through the REAL engines on the in-memory Prisma
 * (`./inMemoryPrisma`). Shared by the NFL, MLB, NBA and NHL full-season suites.
 *
 * 🛑 THE TEST FILE MUST `vi.mock('@/lib/prisma', () => ({ prisma: inMemoryPrisma.client }))`. Every
 * engine below writes through `@/lib/prisma`; without the mock they would reach whatever database the
 * environment names (the vitest guard pins that to 127.0.0.1:1, so they would fail, not write).
 *
 * Engines exercised, none reimplemented:
 *   - creation defaults: `buildRedraftSettingsSnapshot` / `buildDailyRedraftSettingsSnapshot`,
 *     `getDefaultLeagueSettings`, `redraftPlayoffShapeFor` + `applyPlayoffShapeToSettings`,
 *     `defaultMedianGameFor`;
 *   - draft order: `getDraftOrderEntry` (snake); the schedule: `generateSchedule`, persisted the way
 *     `finalizeDraftToRedraftSeason` does (median rows dropped, byes kept);
 *   - every week: `processWaiverWindow`, `recalculateMatchupsForSeasonWeek` (weekly lineups for NFL,
 *     daily lineups and daily stats for MLB, NBA and NHL, bye rows for median / the extra matchup),
 *     `updateStandings`;
 *   - playoffs: `generateNflRedraftPlayoffRuntimeBracket` (rules from `resolveCanonicalLeagueRules`),
 *     `scoreActivePlayoffRound`, `advanceNflRedraftPlayoffRuntimeRound`,
 *     `finalizeNflRedraftPlayoffRuntimeSeason`;
 *   - rollover: `renewRedraftLeague`, or for a dynasty league (`dynasty: true`, phase 8, 2026-10-29)
 *     `ensureDynastyNextSeason` (next season's shell + every roster carried) and the rookie draft
 *     order (`computeRookieDraftOrder`, worst to first).
 *
 * The only stand-ins: stat lines are generated (seeded, deterministic) instead of ingested, and the
 * week finalizer's seal is granted (it needs a live game slate) — `finalizeWeek` is the one injected dep.
 */
import { vi } from 'vitest'
import { getDraftOrderEntry, type DraftRuntimeSlot } from '@/lib/draft-runtime/canonicalDraftRuntime'
import { buildRedraftSettingsSnapshot } from '@/lib/league-concepts/redraftDefaults'
import { buildDailyRedraftSettingsSnapshot } from '@/lib/league-concepts/dailySportRedraftDefaults'
import { getDefaultLeagueSettings } from '@/lib/sport-defaults/LeagueDefaultSettingsService'
import { applyPlayoffShapeToSettings, redraftPlayoffShapeFor, type RedraftPlayoffShape } from '@/lib/league-defaults/redraftPlayoffFit'
import { defaultMedianGameFor } from '@/lib/league/oddTeamLeagues'
import { getRedraftSportConfig } from '@/lib/redraft/sportConfig'
import { allowedPositionsForSlot } from '@/lib/redraft/lineupValidation'
import { generateSchedule } from '@/lib/redraft/scheduleEngine'
import { buildLeagueStatScorer, isScoringStarterSlot, recalculateMatchupsForSeasonWeek } from '@/lib/redraft/scoringEngine'
import { updateStandings } from '@/lib/redraft/standingsEngine'
import { processWaiverWindow } from '@/lib/redraft/waiverEngine'
import { EXTRA_MATCHUP_SETTINGS_KEY, type ExtraMatchupSettings } from '@/lib/redraft/oddTeamExtraMatchupRules'
import { resolveDailySportWeekWindow } from '@/lib/season-week/dailySportSeasonStarts'
import { normalizeMlbGameStats } from '@/lib/scoring-runtime/mlbStatNormalization'
import { aggregateWeeklyStats, normalizeNbaGameStats, normalizeNhlGameStats, type NormalizedGameStats } from '@/lib/scoring-runtime/dailySportStatNormalization'
import {
  advanceNflRedraftPlayoffRuntimeRound,
  finalizeNflRedraftPlayoffRuntimeSeason,
  generateNflRedraftPlayoffRuntimeBracket,
} from '@/lib/playoff-runtime/resolveNflRedraftPlayoffRuntime'
import { scoreActivePlayoffRound } from '@/lib/playoff-runtime/playoffRoundScoring'
import { resolveNflRedraftScheduleRuntime } from '@/lib/schedule-runtime/resolveNflRedraftScheduleRuntime'
import { renewRedraftLeague } from '@/lib/redraft/offseason/renewRedraftLeague'
import { ensureDynastyNextSeason } from '@/lib/redraft/offseason/startDynastyNewSeason'
import { computeRookieDraftOrder } from '@/lib/league/rookieDraftOrder'
import type { InMemoryPrisma } from './inMemoryPrisma'

export type SimSport = 'NFL' | 'MLB' | 'NBA' | 'NHL'

export type FullSeasonSimInput = {
  sport: SimSport
  teamCount: number
  /** Default: the creation default for the size (on for an odd count). */
  medianGame?: boolean
  /** The odd-team extra matchup (lib/redraft/oddTeamExtraMatchupRules.ts). Default: off. */
  extraMatchup?: ExtraMatchupSettings | null
  seed?: number
  /** Regular-season weeks in which every team scores exactly the same (every game a tie). */
  tieWeeks?: number[]
  /** Every playoff week ties too, so each playoff game is settled by its tiebreak. */
  tiePlayoffs?: boolean
  /** A dynasty league: same season, but it rolls over by carrying every roster, not by a redraft. */
  dynasty?: boolean
}

type Row = Record<string, any>

export type SimWeekSnapshot = {
  week: number
  matchups: Row[]
  standings: Row[]
  /** Engine's matchup scores vs the harness's own sum over started slots (and days, for MLB). */
  scoreChecks: Array<{ matchupId: string; rosterId: string; engine: number; expected: number }>
  waiverResults: Array<{ claimId: string; status: string; reason?: string }>
  waiverClaims: Row[]
}

export type FullSeasonSimResult = {
  input: Required<Omit<FullSeasonSimInput, 'extraMatchup' | 'tieWeeks' | 'tiePlayoffs' | 'dynasty'>> & {
    dynasty: boolean
    extraMatchup: ExtraMatchupSettings | null
    tieWeeks: number[]
    tiePlayoffs: boolean
  }
  leagueId: string
  seasonId: string
  seasonYear: number
  shape: RedraftPlayoffShape
  regularSeasonWeeks: number
  league: Row
  draft: {
    slotOrder: DraftRuntimeSlot[]
    picks: Array<{ overall: number; round: number; slot: number; rosterId: string; playerId: string }>
    rounds: number
  }
  rosterIds: string[]
  schedule: Row[]
  weeks: SimWeekSnapshot[]
  /** Roster rows (records, seeds) right after the last regular-season week. */
  regularSeasonFinal: Row[]
  /** `resolveNflRedraftScheduleRuntime` at the end of the regular season (the schedule tab's read). */
  scheduleRuntime: Awaited<ReturnType<typeof resolveNflRedraftScheduleRuntime>>
  /** Roster rows after `updateStandings` ran for each playoff week. */
  playoffWeekStandings: Array<{ week: number; rosters: Row[]; matchups: Row[] }>
  bracket: {
    generated: Awaited<ReturnType<typeof generateNflRedraftPlayoffRuntimeBracket>>
    roundsAtEnd: Row[]
    matchupsAtEnd: Row[]
    scoring: Array<{ week: number; outcome: string; lower?: string; advances: string[] }>
    /** `RedraftRoster.playoffSeed` as the bracket generator left it. */
    seedsAtBracket: Array<{ id: string; playoffSeed: number | null }>
    /** The regular-season result flipped after the bracket was drawn (scores swapped). */
    correction: { matchupId: string; before: { homeScore: number; awayScore: number } } | null
  }
  finalized: Awaited<ReturnType<typeof finalizeNflRedraftPlayoffRuntimeSeason>>
  seasonAtEnd: Row
  /** The redraft renewal; never run for a dynasty league (its value is then a refusal placeholder). */
  renewal: Awaited<ReturnType<typeof renewRedraftLeague>>
  /** A dynasty league's rollover: next season, every roster carried, and the rookie draft order. */
  dynastyRollover: {
    next: Awaited<ReturnType<typeof ensureDynastyNextSeason>>
    rookieOrder: Awaited<ReturnType<typeof computeRookieDraftOrder>>
  } | null
  previousDraftSlotOrder: DraftRuntimeSlot[]
  db: InMemoryPrisma
}

const DAY_MS = 86_400_000

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}

function rngFor(seed: number, key: string): () => number {
  return mulberry32(hash(`${seed}:${key}`))
}

function int(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1))
}

/** The position a generated player at this starter slot plays: the slot's first eligible position. */
function positionFor(sport: SimSport, slot: string): string {
  if (sport === 'NFL' && slot === 'FLX') return 'RB'
  if (sport === 'MLB' && slot === 'UTIL') return 'OF'
  if (sport === 'MLB' && slot === 'P') return 'RP'
  return allowedPositionsForSlot(sport, slot)[0] ?? slot
}

const PITCHERS = new Set(['SP', 'RP', 'P'])
/** Positions a daily UTIL slot cannot take: pitchers, and NHL goalies. */
const NOT_UTIL = new Set([...PITCHERS, 'G'])

/** Every sport but NFL sets lineups and scores by the day (lib/redraft/dailyLineups.ts). */
function isDailySport(sport: SimSport): boolean {
  return sport !== 'NFL'
}

/** The calendar day in New York of an instant, as the UTC-midnight date key the daily rows use. */
function easternDayKey(t: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(t)
  const get = (type: string) => Number(parts.find((x) => x.type === type)?.value)
  return Date.UTC(get('year'), get('month') - 1, get('day'))
}

/** One generated NFL week for a player. `skill` shifts the mean. */
function nflWeekStats(position: string, rng: () => number, skill: number): Record<string, number> {
  const s = skill
  switch (position) {
    case 'QB':
      return { pass_yds: int(rng, 150, 320) + s * 4, pass_td: int(rng, 0, 3), pass_int: int(rng, 0, 2), rush_yds: int(rng, 0, 40) }
    case 'RB':
      return { rush_yds: int(rng, 20, 120) + s * 2, rush_td: int(rng, 0, 2), rec: int(rng, 0, 6), rec_yds: int(rng, 0, 50) }
    case 'WR':
    case 'TE':
      return { rec: int(rng, 1, 9), rec_yds: int(rng, 10, 120) + s * 2, rec_td: int(rng, 0, 2) }
    case 'K':
      return { fg_0_39: int(rng, 0, 3), fg_40_49: int(rng, 0, 2), xp_made: int(rng, 0, 5) }
    case 'DEF':
      return { def_sack: int(rng, 0, 5), def_int: int(rng, 0, 2), def_fr: int(rng, 0, 1) }
    default:
      return { rec: int(rng, 0, 4) }
  }
}

/** One generated MLB box line, as the Rolling Insights ingest stores it (`{ group, stats }`). */
function mlbBoxLine(position: string, rng: () => number, skill: number, dayIndex: number): { group: string; stats: Record<string, number> } | null {
  if (position === 'SP') {
    // Two starts a week: days 0 and 5. Innings in baseball notation.
    if (dayIndex !== 0 && dayIndex !== 5) return null
    const whole = int(rng, 4, 7)
    const outs = int(rng, 0, 2)
    const er = int(rng, 0, 5)
    return { group: 'pitching', stats: { IP: Number(`${whole}.${outs}`), ER: er, K: int(rng, 2, 10) + Math.floor(skill / 4), W: rng() < 0.4 ? 1 : 0, L: rng() < 0.3 ? 1 : 0, H: int(rng, 2, 9), BB: int(rng, 0, 4) } }
  }
  if (position === 'RP') {
    if (dayIndex % 2 === 1) return null
    return { group: 'pitching', stats: { IP: rng() < 0.5 ? 1 : 0.2, ER: rng() < 0.2 ? 1 : 0, K: int(rng, 0, 3), S: rng() < 0.25 ? 1 : 0, HLD: rng() < 0.25 ? 1 : 0 } }
  }
  if (dayIndex === 3) return null // off day
  const single = int(rng, 0, 2)
  const double = rng() < 0.25 ? 1 : 0
  const hr = rng() < 0.12 + skill / 200 ? 1 : 0
  return { group: 'batting', stats: { AB: 4, H: single + double + hr, '1B': single, '2B': double, '3B': 0, HR: hr, R: int(rng, 0, 2), RBI: int(rng, 0, 3), BB: int(rng, 0, 1), SO: int(rng, 0, 2), SB: rng() < 0.1 ? 1 : 0 } }
}

/** One generated NBA game line, in the feed's field names: four games a week, every other day. */
function nbaBoxLine(position: string, rng: () => number, skill: number, dayIndex: number): { stats: Record<string, number> } | null {
  if (dayIndex % 2 === 1) return null
  const big = position === 'C' || position === 'PF'
  const threes = big ? int(rng, 0, 1) : int(rng, 0, 5)
  const fgm = int(rng, 3, 11) + Math.floor(skill / 5)
  const ftm = int(rng, 0, 6)
  return {
    stats: {
      points: fgm * 2 + threes + ftm,
      total_rebounds: big ? int(rng, 5, 14) : int(rng, 1, 7),
      assists: big ? int(rng, 0, 4) : int(rng, 2, 11),
      steals: int(rng, 0, 3),
      blocks: big ? int(rng, 0, 4) : int(rng, 0, 1),
      turnovers: int(rng, 0, 5),
      three_points_made: threes,
      field_goals_made: fgm,
      field_goals_attempted: fgm + int(rng, 3, 10),
      free_throws_made: ftm,
      free_throws_attempted: ftm + int(rng, 0, 2),
    },
  }
}

/**
 * One generated NHL game line, as the ingest stores it (`{ group, stats }` plus the goalie context
 * `normalizedStatMapFor` adds). Skaters play three games a week; a goalie starts two.
 */
function nhlBoxLine(position: string, rng: () => number, skill: number, dayIndex: number): Record<string, unknown> | null {
  if (position === 'G') {
    if (dayIndex !== 1 && dayIndex !== 4) return null
    const shots = int(rng, 22, 38)
    const allowed = rng() < 0.12 ? 0 : int(rng, 1, 5)
    const won = rng() < 0.5 + skill / 100
    return {
      group: 'goalies',
      gameFinal: true,
      teamGoaliesUsed: 1,
      teamWon: won,
      stats: { saves: shots - allowed, goals_allowed: allowed, shots_against: shots, time_on_ice_minutes: 60, ...(won ? {} : { loss: 1 }) },
    }
  }
  if (dayIndex !== 0 && dayIndex !== 2 && dayIndex !== 5) return null
  const defense = position === 'D'
  return {
    group: 'skaters',
    stats: {
      goals: rng() < (defense ? 0.1 : 0.3) + skill / 200 ? 1 : 0,
      assists: int(rng, 0, defense ? 1 : 2),
      plus_minus: int(rng, -2, 2),
      shots_on_goal: int(rng, 0, defense ? 3 : 5),
      hits: int(rng, 0, 4),
      blocks: defense ? int(rng, 0, 4) : int(rng, 0, 1),
      penalty_minutes: rng() < 0.2 ? 2 : 0,
      power_play_goals: 0,
      power_play_assists: rng() < 0.15 ? 1 : 0,
    },
  }
}

/** A daily sport's generated line for one day, and the normalizer the ingest runs on it. */
function dailyBoxLine(sport: SimSport, position: string, rng: () => number, skill: number, dayIndex: number): unknown | null {
  if (sport === 'MLB') return mlbBoxLine(position, rng, skill, dayIndex)
  if (sport === 'NBA') return nbaBoxLine(position, rng, skill, dayIndex)
  return nhlBoxLine(position, rng, skill, dayIndex)
}

function dailyNormalizer(sport: SimSport): (raw: unknown) => NormalizedGameStats {
  if (sport === 'MLB') return normalizeMlbGameStats
  if (sport === 'NBA') return normalizeNbaGameStats
  return normalizeNhlGameStats
}

const DAILY_BENCH: Partial<Record<SimSport, string[]>> = { MLB: ['OF', 'SP'], NBA: ['PG', 'C'], NHL: ['C', 'G'] }
const FREE_AGENT_POSITION: Record<SimSport, string> = { NFL: 'WR', MLB: 'OF', NBA: 'PG', NHL: 'C' }

export async function runRedraftFullSeasonSimulation(db: InMemoryPrisma, input: FullSeasonSimInput): Promise<FullSeasonSimResult> {
  db.reset()
  const p = db.client
  const { sport, teamCount } = input
  const seed = input.seed ?? 7
  const medianGame = input.medianGame ?? defaultMedianGameFor(teamCount, null)
  const extraMatchup = input.extraMatchup ?? null
  const tieWeeks = input.tieWeeks ?? []
  const tiePlayoffs = input.tiePlayoffs ?? false
  const dynasty = input.dynasty ?? false
  const daily = isDailySport(sport)
  // The first season each daily sport's opener is recorded for (dailySportSeasonStarts.ts).
  const seasonYear = sport === 'MLB' ? 2027 : 2026
  const leagueId = `sim-${sport.toLowerCase()}-${teamCount}${medianGame ? '-median' : ''}${extraMatchup?.enabled ? '-extra' : ''}${dynasty ? '-dynasty' : ''}`
  const commissionerId = 'user-1'

  // ─── League, created with the sport's real defaults. ───
  const shape = redraftPlayoffShapeFor({ sport, leagueSize: teamCount, leagueType: dynasty ? 'dynasty' : 'redraft' })
  if (!shape) throw new Error(`no playoff shape for ${sport} ${teamCount}`)
  const concept =
    daily
      ? buildDailyRedraftSettingsSnapshot({ sport: sport as Parameters<typeof buildDailyRedraftSettingsSnapshot>[0]['sport'], teamCount })
      : buildRedraftSettingsSnapshot({ sport, teamCount } as Parameters<typeof buildRedraftSettingsSnapshot>[0])
  const defaults = getDefaultLeagueSettings(sport) as unknown as Row
  let settings: Row = {
    ...defaults,
    ...(concept as Row),
    playoff_structure: { ...(defaults.playoff_structure ?? {}) },
    standings_tiebreakers: defaults.standings_tiebreakers,
  }
  settings = applyPlayoffShapeToSettings(settings, shape)
  if (daily) settings.sportConfig = { ...(settings.sportConfig ?? {}), lineupLockType: 'daily', dailyLineupsEnabled: true }
  if (extraMatchup) settings[EXTRA_MATCHUP_SETTINGS_KEY] = extraMatchup

  const league = await p.league.create({
    data: {
      id: leagueId,
      name: `Sim ${sport} ${teamCount}`,
      userId: commissionerId,
      sport,
      season: seasonYear,
      leagueType: dynasty ? 'dynasty' : 'redraft',
      isDynasty: dynasty,
      leagueSize: teamCount,
      platform: 'allfantasy',
      status: 'active',
      lifecycleState: 'in_season',
      medianGame,
      playoffTeams: shape.playoffTeams,
      playoffStartWeek: shape.playoffStartWeek,
      playoffWeeksPerRound: 1,
      waiverBudget: 100,
      settings,
    },
  })

  // ─── Draft: a snake over the league's seats. ───
  const cfg = getRedraftSportConfig(sport)
  const starterSlots = [...cfg.starterSlots]
  const benchCount = 2
  const rounds = starterSlots.length + benchCount
  const slotOrder: DraftRuntimeSlot[] = Array.from({ length: teamCount }, (_, i) => ({
    slot: i + 1,
    rosterId: `seat-${i + 1}`,
    displayName: `Team ${i + 1}`,
    userId: `user-${i + 1}`,
  }))

  const season = await p.redraftSeason.create({
    data: {
      leagueId,
      sport,
      season: seasonYear,
      status: 'active',
      totalWeeks: shape.seasonWeeks,
      playoffStartWeek: shape.playoffStartWeek,
      currentWeek: 1,
      medianGame,
    },
  })
  const seasonId = season.id as string

  const rosterIdBySeat = new Map<string, string>()
  for (const seat of slotOrder) {
    const roster = await p.redraftRoster.create({
      data: {
        seasonId,
        leagueId,
        ownerId: seat.userId,
        ownerName: `Owner ${seat.slot}`,
        teamName: seat.displayName,
        faabBalance: 100,
        waiverPriority: seat.slot,
      },
    })
    rosterIdBySeat.set(seat.rosterId, roster.id)
    // The generic roster, team and entry seat a native league carries (renewal reads them).
    await p.roster.create({ data: { id: `generic-${seat.slot}`, leagueId, platformUserId: seat.userId, redraftRosterId: roster.id, playerData: {} } })
    await p.leagueTeam.create({ data: { leagueId, externalId: `generic-${seat.slot}`, ownerName: `Owner ${seat.slot}`, teamName: seat.displayName, claimedByUserId: seat.userId } })
    await p.leagueEntrySlot.create({ data: { leagueId, slotNumber: seat.slot, rosterId: `generic-${seat.slot}` } })
  }
  const rosterIds = slotOrder.map((s) => rosterIdBySeat.get(s.rosterId)!)

  // Each team's draft board: one player per starter slot, then the bench.
  const skillByRoster = new Map<string, number>()
  const boards = new Map<string, Array<{ playerId: string; position: string; slotType: string }>>()
  rosterIds.forEach((rosterId, i) => {
    skillByRoster.set(rosterId, int(rngFor(seed, `skill:${i}`), 0, 20))
    const board = starterSlots.map((slot, k) => ({ playerId: `${sport}-t${i + 1}-p${k + 1}`, position: positionFor(sport, slot), slotType: slot }))
    const benchPositions = DAILY_BENCH[sport] ?? ['WR', 'RB']
    benchPositions.slice(0, benchCount).forEach((position, k) =>
      board.push({ playerId: `${sport}-t${i + 1}-bn${k + 1}`, position, slotType: 'BN' }),
    )
    boards.set(rosterId, board)
  })

  // The draft happens before opening day. Left to the default (now), a daily sport whose season spans the
  // real calendar would have no players for the days before the test ran (NHL scored nothing for four weeks).
  const draftedAt = daily ? new Date(resolveDailySportWeekWindow(sport, seasonYear, 1)!.start.getTime() - 7 * DAY_MS) : undefined
  const picks: FullSeasonSimResult['draft']['picks'] = []
  const pickedByRoster = new Map<string, number>()
  for (let overall = 1; overall <= rounds * teamCount; overall++) {
    const entry = getDraftOrderEntry({ overall, teamCount, draftType: 'snake', thirdRoundReversal: false, slotOrder })
    const rosterId = rosterIdBySeat.get(entry.rosterId)!
    const index = pickedByRoster.get(rosterId) ?? 0
    pickedByRoster.set(rosterId, index + 1)
    const player = boards.get(rosterId)![index]!
    picks.push({ overall, round: entry.round, slot: entry.slot, rosterId, playerId: player.playerId })
    await p.redraftRosterPlayer.create({
      data: {
        rosterId,
        playerId: player.playerId,
        playerName: player.playerId,
        position: player.position,
        team: 'SIM',
        sport,
        slotType: player.slotType,
        acquisitionType: 'drafted',
        ...(draftedAt ? { addedAt: draftedAt } : {}),
      },
    })
  }
  await p.draftSession.create({
    data: {
      leagueId,
      status: 'completed',
      draftType: 'snake',
      rounds,
      teamCount,
      thirdRoundReversal: false,
      timerSeconds: 90,
      slotOrder: slotOrder.map((s) => ({ ...s, rosterId: `generic-${s.slot}` })),
      version: 1,
    },
  })
  await p.leagueSettings.create({ data: { leagueId } })

  // ─── Schedule, persisted as `finalizeDraftToRedraftSeason` writes it. ───
  const slots = generateSchedule(rosterIds.map((id) => ({ id })), shape.seasonWeeks, shape.playoffStartWeek, sport, { medianGame })
  for (const slot of slots) {
    if (slot.type === 'median') continue
    await p.redraftMatchup.create({
      data: { seasonId, leagueId, week: slot.week, type: 'regular', homeRosterId: slot.home, awayRosterId: slot.away, isMedianMatchup: false },
    })
  }
  const schedule = db.table('redraftMatchup').map((r) => ({ ...r }))
  const regularSeasonWeeks = shape.regularSeasonEndWeek

  const scorer = buildLeagueStatScorer({ sport, settings })
  if (!scorer) throw new Error(`no scorer for ${sport}`)

  // Free agents for the waiver wire.
  const freeAgents = Array.from({ length: regularSeasonWeeks * 2 }, (_, i) => ({
    playerId: `${sport}-fa${i + 1}`,
    position: FREE_AGENT_POSITION[sport],
  }))

  /** Write a week of stats for every rostered player (and the free agents). */
  const writeWeekStats = async (week: number) => {
    const window = daily ? resolveDailySportWeekWindow(sport, seasonYear, week) : null
    // Everyone rostered at any point of the week: a player dropped mid-week still played his games.
    const players = db
      .table('redraftRosterPlayer')
      .filter((r) => r.droppedAt == null || (window != null && r.droppedAt.getTime() >= window.start.getTime()))
    const ids = new Map<string, { position: string; rosterId: string | null }>()
    for (const pl of players) ids.set(pl.playerId, { position: pl.position, rosterId: pl.rosterId })
    for (const fa of freeAgents) if (!ids.has(fa.playerId)) ids.set(fa.playerId, { position: fa.position, rosterId: null })
    if (daily && !window) throw new Error(`no ${sport} week window for week ${week}`)
    const tie = tieWeeks.includes(week) || (tiePlayoffs && week >= shape.playoffStartWeek)
    for (const [playerId, info] of ids) {
      // A tie week: the line depends on the position alone, so every team's lineup scores the same.
      const skill = tie ? 5 : info.rosterId ? skillByRoster.get(info.rosterId) ?? 5 : 5
      const rng = rngFor(seed, tie ? `stats:${info.position}:${week}` : `stats:${playerId}:${week}`)
      if (sport === 'NFL') {
        await p.playerWeeklyScore.create({ data: { playerId, week, season: seasonYear, sport, stats: nflWeekStats(info.position, rng, skill), isFinalized: true } })
        continue
      }
      const normalize = dailyNormalizer(sport)
      const lines: unknown[] = []
      for (let d = 0; d < 7; d++) {
        const line = dailyBoxLine(sport, info.position, rng, skill, d)
        if (!line) continue
        lines.push(line)
        const normalized = normalize(line).stats
        await p.playerDailyScore.create({
          data: { playerId, sport, season: seasonYear, scoringDay: new Date(window!.start.getTime() + d * DAY_MS), stats: normalized, isFinalized: true },
        })
      }
      await p.playerWeeklyScore.create({
        data: { playerId, week, season: seasonYear, sport, stats: aggregateWeeklyStats(lines, normalize).stats, isFinalized: true },
      })
    }
  }

  const clearStats = () => {
    db.tables.set('playerWeeklyScore', [])
    db.tables.set('playerDailyScore', [])
  }

  /** The team's score by the league's rules, computed here rather than by the engine. */
  const expectedRosterScore = (rosterId: string, week: number): number => {
    const players = db.table('redraftRosterPlayer').filter((r) => r.rosterId === rosterId)
    let total = 0
    if (sport === 'NFL') {
      for (const pl of players) {
        if (pl.droppedAt != null || !isScoringStarterSlot(pl.slotType)) continue
        const row = db.table('playerWeeklyScore').find((r) => r.playerId === pl.playerId && r.week === week)
        if (row) total += scorer(row.stats, pl.position)
      }
      return Math.round(total * 100) / 100
    }
    const window = resolveDailySportWeekWindow(sport, seasonYear, week)!
    const dailyRows = db.table('redraftDailyLineup').filter((r) => r.rosterId === rosterId)
    // The Eastern calendar day of an instant. NBA and NHL seasons cross both daylight-saving changes.
    const easternDay = easternDayKey
    for (const pl of players) {
      for (let d = 0; d < 7; d++) {
        const day = new Date(window.start.getTime() + d * DAY_MS)
        if (pl.addedAt && easternDay(pl.addedAt) > day.getTime()) continue
        if (pl.droppedAt && easternDay(pl.droppedAt) < day.getTime()) continue
        const saved = dailyRows
          .filter((r) => r.playerId === pl.playerId && r.scoringDay.getTime() <= day.getTime())
          .sort((a, b) => b.scoringDay.getTime() - a.scoringDay.getTime())[0]
        const slot = saved?.slotType ?? pl.slotType
        if (!isScoringStarterSlot(slot)) continue
        const line = db.table('playerDailyScore').find((r) => r.playerId === pl.playerId && r.scoringDay.getTime() === day.getTime())
        if (line) total += scorer(line.stats, pl.position)
      }
    }
    return Math.round(total * 100) / 100
  }

  // ─── The regular season. ───
  const weeks: SimWeekSnapshot[] = []
  let faIndex = 0
  for (let week = 1; week <= regularSeasonWeeks; week++) {
    await p.redraftSeason.update({ where: { id: seasonId }, data: { currentWeek: week } })

    // Waivers between weeks: two teams want the same free agent; the higher bid wins.
    let waiverResults: SimWeekSnapshot['waiverResults'] = []
    if (week >= 2) {
      const fa = freeAgents[faIndex++]!
      const a = rosterIds[(week - 2) % teamCount]!
      const b = rosterIds[(week - 1) % teamCount]!
      // MLB, every third week: the winning claim drops an OF STARTER, settled mid-week (Thursday). His
      // days up to and including the drop day still count (lib/redraft/dailyLineups.ts `daysOnRoster`).
      const midWeekStarterDrop = sport === 'MLB' && week % 3 === 0
      for (const [rosterId, bid] of [[a, 7], [b, 3]] as const) {
        const active = db.table('redraftRosterPlayer').filter((r) => r.rosterId === rosterId && r.droppedAt == null)
        const starterDrop = midWeekStarterDrop && rosterId === a ? active.find((r) => r.slotType === 'OF') : undefined
        const drop =
          starterDrop ??
          active
            .filter((r) => /^bn|^bench$/i.test(String(r.slotType)))
            .sort((x, y) => String(x.playerId).localeCompare(String(y.playerId)))[0]
        await p.redraftWaiverClaim.create({
          data: {
            seasonId,
            leagueId,
            rosterId,
            addPlayerId: fa.playerId,
            addPlayerName: fa.playerId,
            dropPlayerId: drop?.playerId ?? null,
            dropPlayerName: drop?.playerId ?? null,
            bidAmount: bid,
            priority: 1,
            submittedAt: new Date(Date.UTC(seasonYear, 0, 1) + week * 1000),
          },
        })
      }
      if (midWeekStarterDrop) {
        const window = resolveDailySportWeekWindow(sport, seasonYear, week)!
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(new Date(window.start.getTime() + 3 * DAY_MS + 16 * 3_600_000)) // Thursday 12:00 ET
      }
      // NBA / NHL: claims settle the evening before the week opens. Their seasons span the real
      // calendar, so a wall-clock run would land a claim mid-season and make the result date-dependent.
      const settleBeforeWeek = sport === 'NBA' || sport === 'NHL'
      if (settleBeforeWeek) {
        const window = resolveDailySportWeekWindow(sport, seasonYear, week)!
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(new Date(window.start.getTime() - 6 * 3_600_000))
      }
      try {
        waiverResults = await processWaiverWindow(leagueId, seasonId, new Date())
      } finally {
        if (midWeekStarterDrop || settleBeforeWeek) vi.useRealTimers()
      }
    }

    // Daily sports: a mid-week lineup change — a bench player starts at UTIL from day 4, the UTIL starter sits.
    if (daily) {
      const window = resolveDailySportWeekWindow(sport, seasonYear, week)!
      const rosterId = rosterIds[week % teamCount]!
      const roster = db.table('redraftRosterPlayer').filter((r) => r.rosterId === rosterId && r.droppedAt == null)
      const util = roster.find((r) => r.slotType === 'UTIL')
      const benchHitter = roster.find((r) => /^bn$|^bench$/i.test(String(r.slotType)) && !NOT_UTIL.has(String(r.position)))
      if (util && benchHitter) {
        const day = new Date(window.start.getTime() + 3 * DAY_MS)
        await p.redraftDailyLineup.createMany({
          data: [
            { rosterId, playerId: benchHitter.playerId, scoringDay: day, slotType: 'UTIL', leagueId, season: seasonYear, week },
            { rosterId, playerId: util.playerId, scoringDay: day, slotType: 'BN', leagueId, season: seasonYear, week },
          ],
        })
      }
    }

    await writeWeekStats(week)
    await recalculateMatchupsForSeasonWeek(seasonId, week)
    await updateStandings(seasonId, week)

    const matchups = db.table('redraftMatchup').filter((r) => r.week === week).map((r) => ({ ...r }))
    const scoreChecks: SimWeekSnapshot['scoreChecks'] = []
    for (const m of matchups) {
      if (!m.awayRosterId) continue
      scoreChecks.push({ matchupId: m.id, rosterId: m.homeRosterId, engine: m.homeScore, expected: expectedRosterScore(m.homeRosterId, week) })
      scoreChecks.push({ matchupId: m.id, rosterId: m.awayRosterId, engine: m.awayScore, expected: expectedRosterScore(m.awayRosterId, week) })
    }
    weeks.push({
      week,
      matchups,
      standings: db.table('redraftRoster').filter((r) => r.seasonId === seasonId).map((r) => ({ ...r })),
      scoreChecks,
      waiverResults,
      waiverClaims: db.table('redraftWaiverClaim').filter((r) => r.seasonId === seasonId).map((r) => ({ ...r })),
    })
    clearStats()
  }
  const regularSeasonFinal = db.table('redraftRoster').filter((r) => r.seasonId === seasonId).map((r) => ({ ...r }))
  // The schedule tab's own read of the same season (its leader line and playoff picture).
  const scheduleRuntime = await resolveNflRedraftScheduleRuntime({ seasonId })

  // ─── Playoffs. ───
  await p.redraftSeason.update({ where: { id: seasonId }, data: { currentWeek: shape.playoffStartWeek } })
  const generated = await generateNflRedraftPlayoffRuntimeBracket({ seasonId, actorUserId: commissionerId, lockBracket: true })
  const seedsAtBracket = db.table('redraftRoster').filter((r) => r.seasonId === seasonId).map((r) => ({ id: r.id, playoffSeed: r.playoffSeed }))
  // A late stat correction to the last regular-season week, landing after the bracket: the top seed's
  // game flips. Records must take it; the seeds, settled at the playoff start, must not.
  const topSeedId = seedsAtBracket.find((r) => r.playoffSeed === 1)?.id
  const corrected = db
    .table('redraftMatchup')
    .find((r) => r.week === regularSeasonWeeks && r.awayRosterId && (r.homeRosterId === topSeedId || r.awayRosterId === topSeedId))
  const correction = corrected
    ? { matchupId: corrected.id as string, before: { homeScore: corrected.homeScore, awayScore: corrected.awayScore } }
    : null
  if (corrected) {
    await p.redraftMatchup.update({ where: { id: corrected.id }, data: { homeScore: corrected.awayScore, awayScore: corrected.homeScore } })
  }
  const scoring: FullSeasonSimResult['bracket']['scoring'] = []
  const playoffWeekStandings: FullSeasonSimResult['playoffWeekStandings'] = []
  for (let week = shape.playoffStartWeek; week <= shape.seasonWeeks; week++) {
    await writeWeekStats(week)
    await updateStandings(seasonId, week)
    playoffWeekStandings.push({
      week,
      rosters: db.table('redraftRoster').filter((r) => r.seasonId === seasonId).map((r) => ({ ...r })),
      matchups: db.table('redraftMatchup').filter((r) => r.week === week).map((r) => ({ ...r })),
    })
    const scored = await scoreActivePlayoffRound(
      { seasonId, calendarWeek: week },
      { finalizeWeek: (async () => ({ finalized: true, alreadyFinal: false })) as never },
    )
    const advances: string[] = []
    for (let guard = 0; guard < 4; guard++) {
      const advanced = await advanceNflRedraftPlayoffRuntimeRound({ seasonId, week, actorUserId: commissionerId })
      advances.push(advanced.ok ? advanced.status : advanced.code)
      if (!advanced.ok) break
    }
    scoring.push({ week, outcome: scored.outcome, lower: scored.lowerBracket?.outcome, advances })
  }
  const finalized = await finalizeNflRedraftPlayoffRuntimeSeason({ seasonId, actorUserId: commissionerId })
  const seasonAtEnd = { ...db.table('redraftSeason').find((r) => r.id === seasonId)! }
  const roundsAtEnd = db.table('redraftPlayoffRound').filter((r) => r.seasonId === seasonId).map((r) => ({ ...r }))
  const matchupsAtEnd = db.table('redraftPlayoffMatchup').filter((r) => r.seasonId === seasonId).map((r) => ({ ...r }))

  // ─── Rollover. ───
  let renewal: Awaited<ReturnType<typeof renewRedraftLeague>>
  let dynastyRollover: FullSeasonSimResult['dynastyRollover'] = null
  if (dynasty) {
    renewal = { ok: false, status: 409, code: 'DYNASTY_LEAGUE', error: 'A dynasty league carries its rosters.' } as never
    // Order first: it reads the season just played, before a new season exists.
    const rookieOrder = await computeRookieDraftOrder(leagueId, 'worst_to_first')
    dynastyRollover = { next: await ensureDynastyNextSeason(leagueId, seasonId), rookieOrder }
  } else {
    renewal = await renewRedraftLeague(leagueId, commissionerId, { random: rngFor(seed, 'renew') })
  }

  return {
    input: { sport, teamCount, medianGame, extraMatchup, seed, tieWeeks, tiePlayoffs, dynasty },
    leagueId,
    seasonId,
    seasonYear,
    shape,
    regularSeasonWeeks,
    league,
    draft: { slotOrder, picks, rounds },
    rosterIds,
    schedule,
    weeks,
    regularSeasonFinal,
    scheduleRuntime,
    playoffWeekStandings,
    bracket: { generated, roundsAtEnd, matchupsAtEnd, scoring, seedsAtBracket, correction },
    finalized,
    seasonAtEnd,
    renewal,
    dynastyRollover,
    previousDraftSlotOrder: slotOrder.map((s) => ({ ...s, rosterId: `generic-${s.slot}` })),
    db,
  }
}
