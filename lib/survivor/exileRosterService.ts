import 'server-only'
import type { Prisma } from '@prisma/client'
import { fromZonedTime } from 'date-fns-tz'
import { prisma } from '@/lib/prisma'
import { isNativePlatform } from '@/lib/dashboard/platform-label'
import { dailySportWeekForInstant, resolveDailySportWeekWindow } from '@/lib/season-week/dailySportSeasonStarts'
import { easternCalendarDay } from '@/lib/sports-data/easternGameDay'
import { withSurvivorSetupTransaction } from './survivorSetupTransaction'
import { addExilePlayer, dropExilePlayer, emptyExileRoster, readExileRoster } from './exileRosterRules'
import { keyPositionForSport } from './constants'
import { buildLeagueStatScorer } from '@/lib/redraft/scoringEngine'
import { buildWeekKickoffMap, normalizeLockTeam } from '@/lib/redraft/lineupLock'
import { DATE_WINDOWED_SPORTS } from '@/lib/redraft/weekGames'

type Db = Prisma.TransactionClient
const easternMidnight = (day: Date) => fromZonedTime(`${day.toISOString().slice(0, 10)}T00:00:00`, 'America/New_York')

export async function exileWeekWindow(db: Db, sport: string, season: number, week: number) {
  const daily = resolveDailySportWeekWindow(sport, season, week)
  if (daily) return { start: easternMidnight(daily.start), end: easternMidnight(daily.end) }
  if (sport !== 'NFL' && sport !== 'NCAAF') return null
  const first = await db.gameSchedule.findFirst({ where: { sportType: sport, season, weekOrRound: week, startTime: { not: null } }, orderBy: { startTime: 'asc' }, select: { startTime: true } })
  if (!first?.startTime) return null
  const day = easternCalendarDay(first.startTime)
  if (!day) return null
  // Football's weekly Exile pool runs Tuesday through Monday on Eastern calendar days.
  day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 5) % 7)
  return { start: easternMidnight(day), end: easternMidnight(new Date(day.getTime() + 7 * 86400000)) }
}

/**
 * The Exile scoring period that holds `now`: the one whose Eastern-calendar window contains it.
 *
 * ⚠ NOT `dailySportWeekForInstant` ON ITS OWN. That reads a daily sport's gameweek on UTC-midnight
 * date keys (it labels a schedule's game dates), while an Exile period runs Eastern midnight to Eastern
 * midnight. Between 8 PM and midnight Eastern on a period's last night the two disagree: the UTC read
 * already names the NEXT period, whose Eastern window has not opened, so every castaway (Chimmy too)
 * saw a "locked" period instead of the one still running. Measured on the MLB rehearsal: Chimmy's turn
 * at 03:37 UTC on 9 June 2027 (11:37 PM Eastern, 8 June) read week 12 while week 11 was still live.
 * So the UTC answer is only a guess, checked against the real windows either side of it.
 */
export async function exileWeekForInstant(db: Db, sport: string, season: number, now: Date): Promise<number | null> {
  const guess = dailySportWeekForInstant(sport, season, now)
  if (guess == null) return null
  for (const week of [guess, guess - 1, guess + 1]) {
    if (week < 1) continue
    const window = await exileWeekWindow(db, sport, season, week)
    if (window && now >= window.start && now < window.end) return week
  }
  return guess
}

async function context(db: Db, leagueId: string, now: Date) {
  const league = await db.league.findUnique({ where: { id: leagueId }, select: { platform: true, sport: true, season: true, settings: true, survivorMode: true, leagueVariant: true } })
  if (!league || !isNativePlatform(league.platform) || (!league.survivorMode && league.leagueVariant !== 'survivor')) throw new Error('A native Survivor league is required.')
  const island = await db.exileIsland.findUnique({ where: { leagueId } })
  if (!island?.isActive) throw new Error('Exile is not active.')
  const game = await db.survivorGameState.findUnique({ where: { leagueId }, select: { currentWeek: true, phase: true } })
  if (!game || ['pre_draft', 'drafting', 'complete'].includes(game.phase)) throw new Error('Exile waivers are not open.')
  const day = easternCalendarDay(now)
  if (!day) throw new Error('Invalid scoring date.')
  const week = (await exileWeekForInstant(db, league.sport, league.season, now)) ?? Math.max(1, game.currentWeek)
  const window = await exileWeekWindow(db, league.sport, league.season, week)
  if (!window) throw new Error('The verified scoring calendar is not available yet.')
  return { league, island, week, window }
}

/**
 * Each team's first game in an Exile period, keyed by `normalizeLockTeam`.
 *
 * 🛑 NBA, NHL AND MLB EXILE NEVER OPENED. This read `GameSchedule`, which holds NFL alone, so every
 * daily-sport claim failed "This team has no verified game in this scoring period" — for every exiled
 * manager, human or Chimmy. Measured on the season-rehearsal branch: `game_schedules` carries 339 NFL
 * rows and nothing else, and the NBA and NHL rehearsals finished with no Exile week played. A daily
 * sport now reads the same games its lineups lock on (`buildWeekKickoffMap`: the Eastern-day window
 * over `SportsGame`), matched on the same team key, so "Edmonton Oilers" on a player row finds the
 * schedule's game whichever feed spelled it. Football keeps its schedule.
 */
export async function exileFirstGames(db: Db, sport: string, season: number, week: number, start: Date, end: Date): Promise<Map<string, Date>> {
  const firsts = new Map<string, Date>()
  const keep = (team: string | null | undefined, at: Date | null | undefined) => {
    if (!team || !at || at < start || at >= end) return
    const key = normalizeLockTeam(sport, team)
    const seen = firsts.get(key)
    if (key && (!seen || at < seen)) firsts.set(key, at)
  }
  if (DATE_WINDOWED_SPORTS.includes(sport.toUpperCase())) {
    const kickoffs = await buildWeekKickoffMap(prisma, { sport, season, week })
    for (const [key, at] of kickoffs.byTeam) if (at >= start && at < end) firsts.set(key, at)
    return firsts
  }
  const games = await db.gameSchedule.findMany({ where: { sportType: sport, startTime: { gte: start, lt: end } }, select: { homeTeam: true, awayTeam: true, startTime: true } })
  for (const g of games) { keep(g.homeTeam, g.startTime); keep(g.awayTeam, g.startTime) }
  return firsts
}

export function exileTeamKey(sport: string, team: string): string {
  return normalizeLockTeam(sport, team)
}

export async function mutateExileRoster(params: { leagueId: string; userId: string; week: number; playerId: string; action: 'claim' | 'drop' | 'move'; slot?: string }, now = new Date()) {
  return withSurvivorSetupTransaction(params.leagueId, async db => {
    const { league, island, week, window } = await context(db, params.leagueId, now)
    if (params.week !== week || now < window.start || now >= window.end) throw new Error('Use the current Exile scoring period.')
    const manager = await db.survivorPlayer.findUnique({ where: { leagueId_userId: { leagueId: params.leagueId, userId: params.userId } }, select: { playerState: true } })
    if (manager?.playerState !== 'exile') throw new Error('Only an exiled manager can manage this roster.')
    const entries = await db.exileWeeklyEntry.findMany({ where: { exileId: island.id, week } })
    const existing = entries.find(e => e.userId === params.userId)
    const roster = readExileRoster(existing?.submittedLineup) ?? emptyExileRoster()
    const taken = entries.filter(e => e.userId !== params.userId).map(e => readExileRoster(e.submittedLineup)).filter(r => r && !r.closedAt).map(r => r!.team!).filter(Boolean)
    let team = roster.team
    const player = params.action === 'claim' ? await db.player.findFirst({ where: { id: params.playerId, sport: { equals: league.sport, mode: 'insensitive' }, active: true }, select: { id: true, name: true, position: true, team: true } }) : roster.players.find(p => p.id === params.playerId)
    if (!player?.team) throw new Error('An active player with a verified team is required.')
    team ??= player.team.trim().toUpperCase()
    const firstAt = (await exileFirstGames(db, league.sport, league.season, week, window.start, window.end)).get(exileTeamKey(league.sport, team))
    const first = firstAt ? { startTime: firstAt } : null
    if (!first?.startTime) throw new Error('This team has no verified game in this scoring period.')
    if (first.startTime <= now || roster.closedAt) throw new Error('This team’s roster is locked for the scoring period.')
    let next = roster
    if (params.action === 'claim') next = addExilePlayer(roster, { id: player.id, name: player.name, position: player.position, team: player.team.trim().toUpperCase() }, league.sport, league.settings, taken, params.slot)
    if (params.action === 'drop') next = dropExilePlayer(roster, params.playerId)
    if (params.action === 'move') {
      if (!params.slot) throw new Error('Choose a roster slot.')
      const current = roster.players.find(p => p.id === params.playerId)!
      next = addExilePlayer({ ...roster, players: roster.players.filter(p => p.id !== params.playerId) }, current, league.sport, league.settings, taken, params.slot)
    }
    next.lockedAt = next.team ? first.startTime.toISOString() : null
    await db.exileWeeklyEntry.upsert({ where: { exileId_userId_week: { exileId: island.id, userId: params.userId, week } }, create: { exileId: island.id, leagueId: params.leagueId, userId: params.userId, week, submittedLineup: next as unknown as Prisma.InputJsonValue }, update: { submittedLineup: next as unknown as Prisma.InputJsonValue } })
    await db.survivorAuditEntry.create({ data: { leagueId: params.leagueId, week, category: 'exile', action: `exile_roster_${params.action}`, actorUserId: params.userId, targetUserId: params.userId, data: { playerId: params.playerId, team: next.team, slot: params.slot ?? null }, isVisibleToPublic: false, isVisibleToCommissioner: true } })
    return { ok: true, week, roster: next }
  })
}

export async function getExileWaivers(leagueId: string, userId: string, search = '', now = new Date()) {
  return withSurvivorSetupTransaction(leagueId, async db => {
    const { league, island, week, window } = await context(db, leagueId, now)
    const manager = await db.survivorPlayer.findUnique({ where: { leagueId_userId: { leagueId, userId } }, select: { playerState: true } })
    if (manager?.playerState !== 'exile') throw new Error('Only exiled managers can access Exile waivers.')
    const entries = await db.exileWeeklyEntry.findMany({ where: { exileId: island.id, week } })
    const saved = readExileRoster(entries.find(e => e.userId === userId)?.submittedLineup)
    const roster = saved && !saved.closedAt && now < window.end ? saved : emptyExileRoster()
    const takenTeamIds = entries.filter(e => e.userId !== userId).map(e => readExileRoster(e.submittedLineup)).filter(r => r && !r.closedAt).map(r => r!.team!).filter(Boolean)
    const anchor = keyPositionForSport(league.sport)
    const players = await db.player.findMany({ where: { sport: { equals: league.sport, mode: 'insensitive' }, active: true, team: roster.team ? { equals: roster.team, mode: 'insensitive' } : { not: null }, ...(roster.anchorId ? {} : { position: { contains: anchor.code, mode: 'insensitive' } }), ...(search ? { name: { contains: search.slice(0, 80), mode: 'insensitive' } } : {}) }, select: { id: true, name: true, position: true, team: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: 80 })
    const slots = (await import('@/lib/redraft/rosterConfigResolver')).resolveRedraftRosterConfig(league.sport, league.settings)
    return { week, sport: league.sport, anchor, roster, takenTeamIds, players, slots: [...slots.starterCapacities.keys(), ...(slots.benchSlots ? ['BENCH'] : [])], endsAt: window.end.toISOString(), locked: now < window.start || Boolean(roster.lockedAt && new Date(roster.lockedAt) <= now) }
  })
}

/** Release at the calendar boundary even if scoring is delayed. The immutable envelope is the score snapshot. */
export async function closeExpiredExileRosters(leagueId: string, now = new Date()) {
  return withSurvivorSetupTransaction(leagueId, async db => {
    const league = await db.league.findUnique({ where: { id: leagueId }, select: { platform: true, sport: true, season: true } })
    if (!league || !isNativePlatform(league.platform)) return 0
    const entries = await db.exileWeeklyEntry.findMany({ where: { leagueId } })
    let released = 0
    for (const entry of entries) {
      const roster = readExileRoster(entry.submittedLineup)
      if (!roster || roster.closedAt) continue
      const window = await exileWeekWindow(db, league.sport, league.season, entry.week)
      if (!window || now < window.end) continue
      await db.exileWeeklyEntry.update({ where: { id: entry.id }, data: { submittedLineup: { ...roster, closedAt: window.end.toISOString() } as unknown as Prisma.InputJsonValue } })
      released++
    }
    return released
  })
}

/** Publish a scoring-ready marker only from final, covered player scores; never from default zeroes. */
export async function finalizeExileRosterResults(leagueId: string, week: number) {
  return withSurvivorSetupTransaction(leagueId, async db => {
    const league = await db.league.findUnique({ where: { id: leagueId }, select: { sport: true, season: true, settings: true, platform: true } })
    if (!league || !isNativePlatform(league.platform)) return false
    if (await db.survivorAuditEntry.findFirst({ where: { leagueId, week, action: 'exile_results_finalized' }, select: { id: true } })) return true
    const entries = await db.exileWeeklyEntry.findMany({ where: { leagueId, week } })
    if (!entries.length) return false
    const scorer = buildLeagueStatScorer(league)
    if (!scorer) return false
    const results: { id: string; score: number; userId: string }[] = []
    for (const entry of entries) {
      const roster = readExileRoster(entry.submittedLineup)
      if (!roster?.closedAt) return false
      const starters = roster.players.filter(p => p.slot !== 'BENCH')
      if (!starters.length) continue
      let score = 0
      for (const player of starters) {
        const row = await db.playerWeeklyScore.findUnique({ where: { playerId_week_season_sport: { playerId: player.id, week, season: league.season, sport: league.sport } } })
        if (!row?.isFinalized || !row.stats || typeof row.stats !== 'object' || Array.isArray(row.stats)) return false
        const points = scorer(row.stats as Record<string, number>, player.position)
        if (!Number.isFinite(points)) return false
        score += points
      }
      results.push({ id: entry.id, userId: entry.userId, score: Math.round(score * 100) / 100 })
    }
    if (!results.length) return false
    for (const result of results) await db.exileWeeklyEntry.update({ where: { id: result.id }, data: { weeklyScore: result.score } })
    await db.survivorAuditEntry.create({ data: { leagueId, week, category: 'exile', action: 'exile_results_finalized', data: { source: 'closed_exile_rosters_v1', userIds: results.map(r => r.userId) }, isVisibleToPublic: false, isVisibleToCommissioner: true } })
    return true
  })
}
