import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { buildWeekKickoffMap, hydrateRedraftLineupLocks } from '@/lib/redraft/lineupLock'
import { parseRiScheduleSeason, scheduleKeyPrefix, type ScheduleGame } from '@/lib/sports-data/riSeasonSchedule'

/**
 * 🛑 NCAAB PLAYERS NEVER LOCKED — a manager could start a player after his games were played. The
 * only complete NCAAB slate is the Rolling Insights season schedule, and it was parsed without its
 * teams. It keeps them now, in Rolling Insights' own formal naming — the same as the player pool.
 *
 * NCAAB 2026-27 opens 2026-11-02, so week 1 is Nov 2 – Nov 8.
 */

const FIXTURE = path.join(process.cwd(), 'contracts/rolling-insights/fixtures/schedule-season.NCAABB.json')

describe('parseRiScheduleSeason keeps the teams (committed 2025-26 fixture)', () => {
  const raw = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))
  const rows: unknown[] = Array.isArray(raw) ? raw : (raw.data?.NCAABB ?? raw.data ?? Object.values(raw)[0])
  const games = parseRiScheduleSeason(rows)

  it('carries both team names and ids on every game', () => {
    expect(games.length).toBe(6027)
    const first = games.find((g) => g.gameId === '20251102-100-358')!
    expect(first).toMatchObject({ awayTeam: 'Winthrop University', homeTeam: 'Queens University of Charlotte', awayTeamId: '100', homeTeamId: '358' })
    expect(games.filter((g) => !g.homeTeam || !g.awayTeam)).toHaveLength(0)
  })
})

function game(overrides: Partial<ScheduleGame> & { day: string }): ScheduleGame {
  return {
    gameId: `g-${Math.random().toString(36).slice(2)}`,
    startTime: null,
    status: 'scheduled',
    seasonType: 'regular',
    eventName: null,
    replacedBy: null,
    ...overrides,
  }
}

/** The SportsDataCache rows readRiScheduleWindow reads: a season marker plus one row per Eastern day. */
function cacheDb(games: ScheduleGame[] | null) {
  const prefix = scheduleKeyPrefix('NCAAB', 2026)
  const byKey = new Map<string, ScheduleGame[]>()
  for (const g of games ?? []) byKey.set(`${prefix}${g.day}`, [...(byKey.get(`${prefix}${g.day}`) ?? []), g])
  let sportsGameReads = 0
  return {
    reads: () => sportsGameReads,
    db: {
      sportsGame: { findMany: async () => { sportsGameReads += 1; return [] } },
      sportsDataCache: {
        findUnique: async ({ where }: { where: { cacheKey: string } }) => (games && where.cacheKey === `${prefix}meta` ? { data: {} } : null),
        findMany: async ({ where }: { where: { cacheKey: { in: string[] } } }) =>
          where.cacheKey.in.filter((k) => byKey.has(k)).map((k) => ({ cacheKey: k, data: { games: byKey.get(k) } })),
      },
    } as never,
  }
}

const WEEK1: ScheduleGame[] = [
  // Monday Nov 2, 7pm ET.
  game({ day: '2026-11-02', startTime: '2026-11-03T00:00:00.000Z', homeTeam: 'Duke University', awayTeam: 'Winthrop University', status: 'completed' }),
  // Duke's SECOND game of the week — the lock is at his FIRST.
  game({ day: '2026-11-06', startTime: '2026-11-07T00:00:00.000Z', homeTeam: 'Duke University', awayTeam: 'Queens University of Charlotte' }),
  // Wednesday, no time announced: locks at the start of the Eastern day.
  game({ day: '2026-11-04', startTime: null, homeTeam: 'Gonzaga University', awayTeam: 'Baylor University' }),
  // A game that was replaced — its replacement is its own row; it must not lock anyone.
  game({ day: '2026-11-03', startTime: '2026-11-03T23:00:00.000Z', homeTeam: 'Villanova University', awayTeam: 'Grand Canyon University', status: 'replaced', replacedBy: 'g-x' }),
  // A synced-before-teams row.
  game({ day: '2026-11-05', startTime: '2026-11-06T00:00:00.000Z' }),
]

const PLAYERS = [
  { playerId: 'duke-g', team: 'Duke University' },
  { playerId: 'zags-f', team: 'Gonzaga University' },
  { playerId: 'nova-c', team: 'Villanova University' }, // only a replaced game this week
  { playerId: 'hartford', team: 'University of Hartford' }, // no Division I schedule
]

async function locksAt(now: string, games: ScheduleGame[] | null = WEEK1, leagueSettings: unknown = {}) {
  const c = cacheDb(games)
  const { players, warnings } = await hydrateRedraftLineupLocks(c.db, {
    sport: 'NCAAB', season: 2026, week: 1, rosterId: 'r1', leagueSettings, players: PLAYERS, now: new Date(now),
  })
  return { locked: Object.fromEntries(players.map((p) => [p.playerId, p.isLocked])), warnings, sportsGameReads: c.reads() }
}

describe('NCAAB lineup lock', () => {
  it('🛑 locks each player at his team’s FIRST game of the week, read from the Rolling Insights schedule', async () => {
    const before = await locksAt('2026-11-02T23:59:00.000Z')
    expect(before.locked['duke-g']).toBe(false)
    const after = await locksAt('2026-11-03T00:01:00.000Z')
    expect(after.locked['duke-g']).toBe(true)
    expect(after.sportsGameReads).toBe(0) // never the partial SportsGame feed
  })

  it('a game with no start time locks at the start of its Eastern day — early, never late', async () => {
    expect((await locksAt('2026-11-04T03:59:00.000Z')).locked['zags-f']).toBe(false)
    expect((await locksAt('2026-11-04T04:00:00.000Z')).locked['zags-f']).toBe(true)
  })

  it('a replaced game locks no one; a school with no Division I schedule fails open', async () => {
    const { locked } = await locksAt('2026-11-08T12:00:00.000Z')
    expect(locked['nova-c']).toBe(false)
    expect(locked['hartford']).toBe(false)
  })

  it('says so when rows were synced before team names were kept', async () => {
    const { warnings } = await locksAt('2026-11-03T12:00:00.000Z')
    expect(warnings.some((w) => /1 NCAAB game\(s\) this week were synced before team names/.test(w))).toBe(true)
  })

  it('no schedule synced for the season: fails open and says so (never read as "no games")', async () => {
    const { locked, warnings, sportsGameReads } = await locksAt('2026-11-08T12:00:00.000Z', null)
    expect(Object.values(locked).every((v) => v === false)).toBe(true)
    expect(warnings[0]).toMatch(/schedule is not synced yet/)
    expect(sportsGameReads).toBe(0)
  })

  it('postseason games are not the regular slate', async () => {
    const map = await buildWeekKickoffMap(
      cacheDb([game({ day: '2026-11-02', startTime: '2026-11-03T00:00:00.000Z', homeTeam: 'Duke University', awayTeam: 'Winthrop University', seasonType: 'post' })]).db,
      { sport: 'NCAAB', season: 2026, week: 1 },
    )
    expect(map.byTeam.size).toBe(0)
  })

  it('first_game_of_week locks the whole lineup at the week’s first game', async () => {
    const { locked } = await locksAt('2026-11-03T00:30:00.000Z', WEEK1, { sportConfig: { lineupLockType: 'first_game_of_week' } })
    expect(Object.values(locked).every((v) => v === true)).toBe(true)
  })
})
