import { prisma } from '@/lib/prisma'
import { assertLeagueMember } from '@/lib/league/league-access'
import { normalizeGameStatus } from '@/lib/sports/gameStatus'
import { readRiScheduleWindow, type ScheduleGame } from '@/lib/sports-data/riScheduleCache'
import { resolveDailySportWeekWindow } from '@/lib/season-week/dailySportSeasonStarts'
import { resolveRedraftRosterLookupReadOnly } from './redraftRosterIdentity'
import { calculateScoreFromSportConfig, isScoringStarterSlot } from './scoringEngine'
import { loadWeekLineups, weekSlotType } from './weekLineupSlots'
import {
  dailySlotFor,
  dayKey,
  daysInWindow,
  daysOnRoster,
  droppedInWindow,
  loadDailyLockStarts,
  lockStartOnFor,
  isDailyLineupScoringEnabled,
  loadDailyLineups,
} from './dailyLineups'
import { normalizeLockTeam } from './lineupLock'
import { isSealedWeek } from './weekSealed'
import {
  compareGamesChronologically,
  readGamesCountSetting,
  selectCountingGames,
  type GamesCountSetting,
  type WeekGame,
} from './gamesCount'
import { gamesCountDb, gamesCountTablesExist, loadWeekGameScores, warnGamesCountStorageMissing, type GamesCountDb } from './gamesCountStore'

/**
 * The manager's side of "which games count" (lib/redraft/gamesCount.ts): read a started player's games
 * this week, pick which count (best-N) or lock one in (lock-in).
 *
 * Every refusal is decided here, in this order, so the API route is a thin wrapper:
 *   - not a member of the league (403/404), no roster in it (403);
 *   - the league counts every game (409) — and nothing below runs, so neither new table is queried;
 *   - the week is final: his matchup is final, or the whole week is sealed (409);
 *   - the player is not on the manager's roster this week (404), or was not STARTED (409) — in a
 *     daily-lineup league, started means started on the day of the game in question;
 *   - pick: wrong mode (409), more than N or no games (400), a game that is not one of his started
 *     games this week (400);
 *   - lock: wrong mode (409), already locked (409), not one of his started games (400), the game has not
 *     finished (409), or his NEXT game has already started (409).
 *
 * 🛑 "HIS NEXT GAME HAS STARTED" IS WHAT MAKES LOCK-IN A DECISION AND NOT HINDSIGHT. Without it a
 * manager could watch the next game and then lock the earlier one, which turns lock-in into best-of-all.
 * Two signals, either refuses: a stat row for a later game this week (he has played in it), or a later
 * scheduled game for his team that has started. The team signal matches his roster team to the
 * schedule with the lineup lock's own key (`normalizeLockTeam`); a team it cannot match leaves only the
 * stat-row signal, which still closes the window once the next game's first stats are ingested.
 *
 * Game "finished" is the Rolling Insights schedule's status (the slate the week finalizer seals on),
 * through `normalizeGameStatus`. No schedule, or a game it does not list, is NOT finished — lock-in
 * fails closed.
 */

export type GamesCountRefusal = { ok: false; status: 400 | 403 | 404 | 409; code: string; error: string }

export type GamesCountGameView = {
  gameId: string
  day: string
  startTime: string | null
  points: number
  finished: boolean
  /** On a day he was started (always, in a weekly-lineup league). Only eligible games can count. */
  eligible: boolean
  counted: boolean
}

export type GamesCountState = {
  ok: true
  leagueId: string
  week: number
  setting: GamesCountSetting
  weekFinal: boolean
  playerId: string
  started: boolean
  games: GamesCountGameView[]
  countedGameIds: string[]
  points: number
  choice: { pickedGameIds: string[]; lockedGameId: string | null }
}

export type GamesCountAction =
  | { action: 'pick'; gameIds: unknown }
  | { action: 'clear_picks' }
  | { action: 'lock'; gameId: unknown }

function refuse(status: GamesCountRefusal['status'], code: string, error: string): GamesCountRefusal {
  return { ok: false, status, code, error }
}

type Context = {
  leagueId: string
  sport: string
  setting: Exclude<GamesCountSetting, { mode: 'all' }>
  seasonYear: number
  week: number
  rosterId: string
  weekFinal: boolean
  player: { playerId: string; sport: string; position: string | null; team: string | null }
  startedDays: Set<string>
  games: (WeekGame & { stats: Record<string, number> })[]
  schedule: Map<string, ScheduleGame> | null
  choice: { pickedGameIds: string[]; lockedGameId: string | null }
  db: GamesCountDb
}

async function loadContext(args: {
  leagueId: string
  userId: string
  playerIds: readonly string[]
  week?: unknown
  db?: GamesCountDb
}): Promise<Context | GamesCountRefusal> {
  const leagueId = String(args.leagueId ?? '').trim()
  const playerIds = [...new Set(args.playerIds.map((id) => String(id ?? '').trim()).filter(Boolean))]
  if (!leagueId || playerIds.length === 0) return refuse(400, 'bad_request', 'leagueId and playerId are required')

  const gate = await assertLeagueMember(leagueId, args.userId)
  if (!gate.ok) return refuse(gate.status, gate.status === 404 ? 'league_not_found' : 'not_a_member', gate.status === 404 ? 'League not found' : 'Forbidden')

  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { sport: true, settings: true } })
  if (!league) return refuse(404, 'league_not_found', 'League not found')
  const sport = String(league.sport ?? '').toUpperCase()
  const setting = readGamesCountSetting(league.settings, sport)
  if (setting.mode === 'all') return refuse(409, 'games_count_off', 'This league counts every game; there is nothing to choose.')
  // Fail safe: a non-default mode without its tables is scored as every game, so there is nothing to choose.
  if (!(await gamesCountTablesExist(args.db ?? prisma))) {
    warnGamesCountStorageMissing('api', leagueId)
    return refuse(409, 'games_count_storage_unavailable', 'This league counts every game for now; choosing games is not available yet.')
  }

  const lookup = await resolveRedraftRosterLookupReadOnly({ userId: args.userId, leagueId })
  if (!lookup.season || !lookup.roster || lookup.roster.leagueId !== leagueId) {
    return refuse(403, 'no_roster', 'You do not have a team in this league.')
  }
  const season = await prisma.redraftSeason.findFirst({
    where: { id: lookup.season.id },
    select: { id: true, season: true, currentWeek: true },
  })
  if (!season) return refuse(404, 'season_not_found', 'Season not found')

  const rawWeek = args.week ?? season.currentWeek
  const week = Number(rawWeek)
  if (!Number.isInteger(week) || week < 1) return refuse(400, 'bad_week', 'week must be a positive integer')

  const window = resolveDailySportWeekWindow(sport, season.season, week)
  if (!window) return refuse(409, 'no_week_window', `${sport} ${season.season} week ${week} has no date window yet.`)

  const matchups = await prisma.redraftMatchup.findMany({
    where: { seasonId: season.id, week },
    select: { status: true, awayRosterId: true, homeRosterId: true },
  })
  const rosterId = lookup.roster.id
  const own = matchups.filter((m) => m.homeRosterId === rosterId || m.awayRosterId === rosterId)
  const weekFinal = own.some((m) => m.status === 'final') || isSealedWeek(matchups)

  const rosterPlayer = await prisma.redraftRosterPlayer.findFirst({
    where: { rosterId, playerId: { in: playerIds }, ...droppedInWindow(window) },
    select: { rosterId: true, playerId: true, sport: true, position: true, team: true, slotType: true, addedAt: true, droppedAt: true },
  })
  if (!rosterPlayer) return refuse(404, 'not_on_roster', 'That player is not on your roster this week.')

  // Started: in a daily-lineup league, the days he held a starting slot (the scoring engine's rule); in a
  // weekly league, the whole week when this week's lineup starts him.
  // The scorer's drop/add-day rule (`daysOnRoster`), so a game offered here is one the scorer can count.
  const lockStarts = await loadDailyLockStarts(prisma, { sport, season: season.season, week })
  const days = daysOnRoster(rosterPlayer, daysInWindow(window), lockStartOnFor(lockStarts, rosterPlayer))
  const weekLineups = await loadWeekLineups(prisma, { redraftRosterIds: [rosterId], season: season.season, week })
  let startedDays: Date[]
  if (isDailyLineupScoringEnabled(league.settings, sport)) {
    const daily = await loadDailyLineups(prisma, { redraftRosterIds: [rosterId], window })
    startedDays = days.filter((d) =>
      isScoringStarterSlot(dailySlotFor(daily, rosterId, rosterPlayer.playerId, d) ?? weekSlotType(rosterPlayer, weekLineups)),
    )
  } else {
    startedDays = rosterPlayer.droppedAt == null && isScoringStarterSlot(weekSlotType(rosterPlayer, weekLineups)) ? days : []
  }

  const db = args.db ?? gamesCountDb()
  const stored =
    (await loadWeekGameScores(db, { playerIds: [rosterPlayer.playerId], sport: rosterPlayer.sport, season: season.season, week })).get(
      rosterPlayer.playerId,
    ) ?? []
  const games: Context['games'] = []
  for (const g of stored) {
    games.push({
      gameId: g.gameId,
      day: g.day,
      startTime: g.startTime,
      stats: g.stats,
      points: await calculateScoreFromSportConfig(leagueId, rosterPlayer.playerId, week, g.stats, rosterPlayer.position),
    })
  }
  const choiceRow = await db.redraftGamesCountChoice.findUnique({
    where: { rosterId_season_week_playerId: { rosterId, season: season.season, week, playerId: rosterPlayer.playerId } },
  })
  const scheduleGames = await readRiScheduleWindow(prisma as never, { sport, season: season.season, window })

  return {
    leagueId,
    sport,
    setting,
    seasonYear: season.season,
    week,
    rosterId,
    weekFinal,
    player: { playerId: rosterPlayer.playerId, sport: rosterPlayer.sport, position: rosterPlayer.position, team: rosterPlayer.team },
    startedDays: new Set(startedDays.map((d) => dayKey(d))),
    games,
    schedule: scheduleGames ? new Map(scheduleGames.map((g) => [g.gameId, g])) : null,
    choice: { pickedGameIds: choiceRow?.pickedGameIds ?? [], lockedGameId: choiceRow?.lockedGameId ?? null },
    db,
  }
}

function isFinished(ctx: Context, gameId: string): boolean {
  const g = ctx.schedule?.get(gameId)
  return Boolean(g && normalizeGameStatus(g.status) === 'final')
}

function view(ctx: Context): GamesCountState {
  const eligible = ctx.games.filter((g) => ctx.startedDays.has(g.day))
  const counted = selectCountingGames(ctx.setting, eligible, ctx.choice)
  const countedIds = new Set(counted.countedGameIds)
  return {
    ok: true,
    leagueId: ctx.leagueId,
    week: ctx.week,
    setting: ctx.setting,
    weekFinal: ctx.weekFinal,
    playerId: ctx.player.playerId,
    started: ctx.startedDays.size > 0,
    games: ctx.games.map((g) => ({
      gameId: g.gameId,
      day: g.day,
      startTime: g.startTime,
      points: Math.round(g.points * 100) / 100,
      finished: isFinished(ctx, g.gameId),
      eligible: ctx.startedDays.has(g.day),
      counted: countedIds.has(g.gameId),
    })),
    countedGameIds: counted.countedGameIds,
    points: Math.round(counted.points * 100) / 100,
    choice: ctx.choice,
  }
}

/** The instant a scheduled game starts: its start time, else the start of its Eastern day (early, never late). */
function scheduledStart(g: Pick<ScheduleGame, 'startTime' | 'day'>): number {
  const t = g.startTime ? Date.parse(g.startTime) : NaN
  return Number.isFinite(t) ? t : Date.parse(`${g.day}T04:00:00.000Z`)
}

/** Why the player's next game makes `target` too late to lock, or null. */
function nextGameStartedReason(ctx: Context, target: Context['games'][number], now: Date): string | null {
  if (ctx.games.some((g) => g.gameId !== target.gameId && compareGamesChronologically(g, target) > 0)) {
    return 'He has already played a later game this week.'
  }
  const teamKey = normalizeLockTeam(ctx.sport, ctx.player.team)
  const targetSchedule = ctx.schedule?.get(target.gameId)
  if (!teamKey || !ctx.schedule) return null
  const targetStart = targetSchedule ? scheduledStart(targetSchedule) : Date.parse(`${target.day}T04:00:00.000Z`)
  for (const g of ctx.schedule.values()) {
    if (g.gameId === target.gameId || g.replacedBy) continue
    const status = String(g.status ?? '').toLowerCase()
    if (status === 'replaced' || status === 'postponed') continue
    const teams = [g.homeTeam, g.awayTeam].map((t) => normalizeLockTeam(ctx.sport, t))
    if (!teams.includes(teamKey)) continue
    const start = scheduledStart(g)
    if (start > targetStart && start <= now.getTime()) return 'His next game has already started.'
  }
  return null
}

export async function getGamesCountState(args: {
  leagueId: string
  userId: string
  playerIds: readonly string[]
  week?: unknown
  db?: GamesCountDb
}): Promise<GamesCountState | GamesCountRefusal> {
  const ctx = await loadContext(args)
  if ('ok' in ctx) return ctx
  return view(ctx)
}

export async function applyGamesCountAction(args: {
  leagueId: string
  userId: string
  playerId: string
  week?: unknown
  input: GamesCountAction
  now?: Date
  db?: GamesCountDb
}): Promise<GamesCountState | GamesCountRefusal> {
  const ctx = await loadContext({ leagueId: args.leagueId, userId: args.userId, playerIds: [args.playerId], week: args.week, db: args.db })
  if ('ok' in ctx) return ctx
  if (ctx.weekFinal) return refuse(409, 'week_final', 'This week is final; its scores can no longer change.')
  if (ctx.startedDays.size === 0) return refuse(409, 'not_started', 'He was not in your starting lineup this week.')

  const now = args.now ?? new Date()
  const eligible = new Map(ctx.games.filter((g) => ctx.startedDays.has(g.day)).map((g) => [g.gameId, g]))
  const where = { rosterId_season_week_playerId: { rosterId: ctx.rosterId, season: ctx.seasonYear, week: ctx.week, playerId: ctx.player.playerId } }
  const base = { leagueId: ctx.leagueId, rosterId: ctx.rosterId, season: ctx.seasonYear, week: ctx.week, playerId: ctx.player.playerId }

  const input = args.input
  if (input.action === 'pick' || input.action === 'clear_picks') {
    if (ctx.setting.mode !== 'best_n') return refuse(409, 'wrong_mode', 'This league does not use best-N games.')
    let picked: string[] = []
    if (input.action === 'pick') {
      const ids = Array.isArray(input.gameIds) ? input.gameIds.map((x) => String(x ?? '').trim()) : null
      if (!ids || ids.length === 0 || ids.some((x) => !x) || new Set(ids).size !== ids.length || ids.length > ctx.setting.n) {
        return refuse(400, 'bad_pick', `Pick between 1 and ${ctx.setting.n} different games.`)
      }
      if (ids.some((id) => !eligible.has(id))) {
        return refuse(400, 'game_not_eligible', 'Every pick must be one of his games on a day he was started.')
      }
      picked = ids
    }
    await ctx.db.redraftGamesCountChoice.upsert({
      where,
      create: { ...base, pickedGameIds: picked, updatedByUserId: args.userId },
      update: { pickedGameIds: picked, updatedByUserId: args.userId },
    })
    return view({ ...ctx, choice: { ...ctx.choice, pickedGameIds: picked } })
  }

  if (input.action === 'lock') {
    if (ctx.setting.mode !== 'lock_in') return refuse(409, 'wrong_mode', 'This league does not use lock-in.')
    if (ctx.choice.lockedGameId) return refuse(409, 'already_locked', 'A game is already locked in for him this week.')
    const gameId = String(input.gameId ?? '').trim()
    const target = eligible.get(gameId)
    if (!target) return refuse(400, 'game_not_eligible', 'That is not one of his games on a day he was started.')
    if (!isFinished(ctx, gameId)) return refuse(409, 'game_not_finished', 'That game has not finished yet.')
    const late = nextGameStartedReason(ctx, target, now)
    if (late) return refuse(409, 'next_game_started', late)
    await ctx.db.redraftGamesCountChoice.upsert({
      where,
      create: { ...base, lockedGameId: gameId, lockedAt: now, updatedByUserId: args.userId },
      update: { lockedGameId: gameId, lockedAt: now, updatedByUserId: args.userId },
    })
    return view({ ...ctx, choice: { ...ctx.choice, lockedGameId: gameId } })
  }

  return refuse(400, 'bad_action', 'action must be pick, clear_picks or lock')
}
