import { describe, expect, it } from 'vitest'

import { hydrateRedraftLineupLocks, normalizeLockTeam } from '@/lib/redraft/lineupLock'

/**
 * 🛑 NHL PLAYERS NEVER LOCKED. The lock's schedule lookup was wired for NFL only, and an NHL matchup
 * scores the whole week's games for whoever sits in a starter slot at scoring time — so a manager
 * could start a player after his games were played. These pin the NHL lock: read from the same
 * Eastern-day week window the week is scored and closed on.
 *
 * NHL 2026 opens 2026-09-29, so week 1 is Sep 29 – Oct 5 (Eastern days).
 */

type Game = { homeTeam: string; awayTeam: string; startTime: Date; status: string }

function schedule(games: Game[]) {
  return {
    sportsGame: {
      findMany: async () =>
        games.map((g) => ({
          ...g,
          source: 'thesportsdb',
          fetchedAt: new Date('2026-09-29T06:00:00.000Z'),
          season: 2026,
          // The junk week value the feed writes for a daily sport.
          week: 500,
        })),
    },
  } as never
}

const GAMES: Game[] = [
  // Tue Sep 29, 9pm ET — the UTC instant is already Sep 30.
  { homeTeam: 'Calgary Flames', awayTeam: 'Edmonton Oilers', startTime: new Date('2026-09-30T01:00:00.000Z'), status: 'FT' },
  // Fri Oct 2, 7pm ET.
  { homeTeam: 'Montreal Canadiens', awayTeam: 'Toronto Maple Leafs', startTime: new Date('2026-10-02T23:00:00.000Z'), status: 'NS' },
  // Week 2 — must not lock anyone for week 1.
  { homeTeam: 'Boston Bruins', awayTeam: 'St. Louis Blues', startTime: new Date('2026-10-07T23:00:00.000Z'), status: 'NS' },
]

const PLAYERS = [
  { playerId: 'mcdavid', team: 'Edmonton Oilers' },
  { playerId: 'matthews', team: 'Toronto Maple Leafs' },
  // Accented on the roster, plain in the schedule.
  { playerId: 'suzuki', team: 'Montréal Canadiens' },
  // His team's only game is in week 2.
  { playerId: 'kyrou', team: 'St Louis Blues' },
]

async function locksAt(now: string, leagueSettings: unknown = {}, games = GAMES) {
  const { players, warnings } = await hydrateRedraftLineupLocks(schedule(games), {
    sport: 'NHL',
    season: 2026,
    week: 1,
    rosterId: 'r1',
    leagueSettings,
    players: PLAYERS,
    now: new Date(now),
  })
  return { locked: Object.fromEntries(players.map((p) => [p.playerId, p.isLocked])), warnings }
}

describe('NHL lineup lock', () => {
  it('locks a player once his team’s first game of the week has started, and no one else', async () => {
    const { locked, warnings } = await locksAt('2026-10-01T12:00:00.000Z')
    expect(locked).toEqual({ mcdavid: true, matthews: false, suzuki: false, kyrou: false })
    expect(warnings).toEqual([])
  })

  it('later in the week the Friday game locks both its teams — accents and punctuation do not matter', async () => {
    const { locked } = await locksAt('2026-10-03T12:00:00.000Z')
    expect(locked).toEqual({ mcdavid: true, matthews: true, suzuki: true, kyrou: false })
  })

  it('first_game_of_week locks the whole lineup at the week’s first puck drop', async () => {
    const { locked } = await locksAt('2026-09-30T02:00:00.000Z', { sportConfig: { lineupLockType: 'first_game_of_week' } })
    expect(Object.values(locked).every(Boolean)).toBe(true)
  })

  it('an empty week falls open with a warning, never locks by guess', async () => {
    const { locked, warnings } = await locksAt('2026-10-03T12:00:00.000Z', {}, [])
    expect(Object.values(locked).some(Boolean)).toBe(false)
    expect(warnings[0]).toContain('No NHL games found')
  })

  it('[control] NCAAB is still not locked from SportsGame — its schedule there is incomplete', async () => {
    const { warnings } = await hydrateRedraftLineupLocks(schedule(GAMES), {
      sport: 'NCAAB',
      season: 2026,
      week: 1,
      rosterId: 'r1',
      leagueSettings: {},
      players: PLAYERS,
      now: new Date('2026-10-03T12:00:00.000Z'),
    })
    expect(warnings[0]).toContain('not locked')
  })
})

describe('normalizeLockTeam', () => {
  it('matches full names across feeds without the NFL alias table', () => {
    expect(normalizeLockTeam('NHL', 'St. Louis Blues')).toBe(normalizeLockTeam('NHL', 'St Louis Blues'))
    expect(normalizeLockTeam('NHL', 'Montréal Canadiens')).toBe(normalizeLockTeam('NHL', 'Montreal Canadiens'))
    // The NFL table maps LA → LAR; an NHL team name must never go through it.
    expect(normalizeLockTeam('NHL', 'LA')).toBe('LA')
    expect(normalizeLockTeam('NFL', 'LA')).toBe('LAR')
  })
})
