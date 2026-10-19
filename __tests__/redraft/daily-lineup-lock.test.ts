import { describe, expect, it } from 'vitest'

import {
  computeLineupLock,
  hydrateRedraftLineupLocks,
  readLineupLockSettings,
  resolveLineupLockMode,
} from '@/lib/redraft/lineupLock'
import { scheduleKeyPrefix, type ScheduleGame } from '@/lib/sports-data/riSeasonSchedule'

/**
 * DAILY LINEUP LOCKS (NBA / NHL / MLB), opt-in per league.
 *
 * Before this, `sportConfig.lineupLockType: 'daily'` silently fell back to `per_player_kickoff`, which
 * for a daily sport locks a player at his team's FIRST game of the fantasy WEEK and keeps him locked
 * for the rest of it. A real daily lock locks a player only at his own game start on the CURRENT US
 * Eastern day, and lets him move again on the next day.
 *
 * ⚠ The daily mode is honoured ONLY when the league opts in (`dailyLineupsEnabled: true`) AND the sport
 * plays daily. Without the flag, 'daily' keeps today's behaviour (per_player_kickoff) but says so in a
 * warning, so no existing league changes. Daily scoring is lib/redraft/dailyScoring.ts; see
 * docs/DAILY_LINEUPS_DESIGN.md for why that matters before anyone turns the flag on.
 */

const DAILY_ON = { sportConfig: { lineupLockType: 'daily', dailyLineupsEnabled: true } }
const DAILY_REQUESTED_NOT_ENABLED = { sportConfig: { lineupLockType: 'daily' } }

type Game = { homeTeam: string; awayTeam: string; startTime: Date; status: string }

/** `SportsGame` rows as `readWeekGames` reads them (NBA / NHL). */
function sportsGameDb(games: Game[]) {
  return {
    sportsGame: {
      findMany: async () =>
        games.map((g) => ({
          ...g,
          source: 'thesportsdb',
          fetchedAt: new Date('2026-10-01T06:00:00.000Z'),
          season: 2026,
          week: 500,
        })),
    },
  } as never
}

function lockedMap(players: Array<{ playerId: string; isLocked?: boolean | null }>) {
  return Object.fromEntries(players.map((p) => [p.playerId, Boolean(p.isLocked)]))
}

// ── NBA ─────────────────────────────────────────────────────────────────────
// NBA 2026 opens Tue 2026-10-20, so week 1 is Oct 20 – Oct 26 (Eastern days). EDT = UTC-4.
const NBA_GAMES: Game[] = [
  // Tue Oct 20, 7:30pm ET.
  { homeTeam: 'Boston Celtics', awayTeam: 'New York Knicks', startTime: new Date('2026-10-20T23:30:00.000Z'), status: 'FT' },
  // Tue Oct 20, 10:00pm ET — the UTC instant is already Oct 21, but it is TUESDAY's game.
  { homeTeam: 'Los Angeles Lakers', awayTeam: 'Golden State Warriors', startTime: new Date('2026-10-21T02:00:00.000Z'), status: 'FT' },
  // Wed Oct 21, 7:00pm ET — Boston plays again.
  { homeTeam: 'Boston Celtics', awayTeam: 'Miami Heat', startTime: new Date('2026-10-21T23:00:00.000Z'), status: 'NS' },
]
const NBA_PLAYERS = [
  { playerId: 'tatum', team: 'Boston Celtics' },
  { playerId: 'lebron', team: 'Los Angeles Lakers' },
  { playerId: 'butler', team: 'Miami Heat' },
]

async function nbaLocks(now: string, leagueSettings: unknown) {
  const { players, warnings } = await hydrateRedraftLineupLocks(sportsGameDb(NBA_GAMES), {
    sport: 'NBA',
    season: 2026,
    week: 1,
    rosterId: 'r1',
    leagueSettings,
    players: NBA_PLAYERS,
    now: new Date(now),
  })
  return { locked: lockedMap(players), warnings }
}

describe('daily lock — NBA', () => {
  it('Tuesday 8pm ET: only the player whose game tonight has tipped is locked', async () => {
    const { locked } = await nbaLocks('2026-10-21T00:00:00.000Z', DAILY_ON)
    expect(locked).toEqual({ tatum: true, lebron: false, butler: false })
  })

  it('a 10pm ET tip is Tuesday’s game even though its UTC date is Wednesday', async () => {
    const { locked } = await nbaLocks('2026-10-21T03:00:00.000Z', DAILY_ON)
    expect(locked).toEqual({ tatum: true, lebron: true, butler: false })
  })

  it('across the day boundary the lock resets: Wednesday morning nobody is locked', async () => {
    const { locked } = await nbaLocks('2026-10-21T13:00:00.000Z', DAILY_ON)
    expect(locked).toEqual({ tatum: false, lebron: false, butler: false })
  })

  it('Wednesday night locks the players whose Wednesday game started — and not Tuesday’s Laker', async () => {
    const { locked } = await nbaLocks('2026-10-21T23:30:00.000Z', DAILY_ON)
    expect(locked).toEqual({ tatum: true, lebron: false, butler: true })
  })

  it('the same Wednesday morning under per_player_kickoff keeps Tuesday’s players locked for the week (unchanged)', async () => {
    const { locked, warnings } = await nbaLocks('2026-10-21T13:00:00.000Z', { sportConfig: { lineupLockType: 'per_player_kickoff' } })
    expect(locked).toEqual({ tatum: true, lebron: true, butler: false })
    expect(warnings).toEqual([])
  })

  it('daily mode says it is active and that each day is scored on its own', async () => {
    const { warnings } = await nbaLocks('2026-10-21T13:00:00.000Z', DAILY_ON)
    expect(warnings.some((w) => /daily lineup lock/i.test(w) && /each day's starters/i.test(w))).toBe(true)
    expect(warnings.some((w) => /still a weekly/i.test(w))).toBe(false)
  })
})

describe("'daily' without the opt-in flag keeps today's behaviour, but is no longer silent", () => {
  it('locks exactly as per_player_kickoff does', async () => {
    const asDaily = await nbaLocks('2026-10-21T13:00:00.000Z', DAILY_REQUESTED_NOT_ENABLED)
    const asKickoff = await nbaLocks('2026-10-21T13:00:00.000Z', {})
    expect(asDaily.locked).toEqual(asKickoff.locked)
    expect(asDaily.locked).toEqual({ tatum: true, lebron: true, butler: false })
  })

  it('and warns that the requested daily mode is not in effect', async () => {
    const { warnings } = await nbaLocks('2026-10-21T13:00:00.000Z', DAILY_REQUESTED_NOT_ENABLED)
    expect(warnings.some((w) => /daily/i.test(w) && /per_player_kickoff/.test(w))).toBe(true)
  })
})

// ── NHL ─────────────────────────────────────────────────────────────────────
// NHL 2026 opens Tue 2026-09-29: week 1 is Sep 29 – Oct 5.
const NHL_GAMES: Game[] = [
  // Tue Sep 29, 9pm ET.
  { homeTeam: 'Calgary Flames', awayTeam: 'Edmonton Oilers', startTime: new Date('2026-09-30T01:00:00.000Z'), status: 'FT' },
  // Thu Oct 1, 7pm ET.
  { homeTeam: 'Edmonton Oilers', awayTeam: 'Vancouver Canucks', startTime: new Date('2026-10-01T23:00:00.000Z'), status: 'NS' },
  // Fri Oct 2, 7pm ET.
  { homeTeam: 'Montreal Canadiens', awayTeam: 'Toronto Maple Leafs', startTime: new Date('2026-10-02T23:00:00.000Z'), status: 'NS' },
]
const NHL_PLAYERS = [
  { playerId: 'mcdavid', team: 'Edmonton Oilers' },
  { playerId: 'matthews', team: 'Toronto Maple Leafs' },
]

async function nhlLocks(now: string, leagueSettings: unknown) {
  const { players } = await hydrateRedraftLineupLocks(sportsGameDb(NHL_GAMES), {
    sport: 'NHL',
    season: 2026,
    week: 1,
    rosterId: 'r1',
    leagueSettings,
    players: NHL_PLAYERS,
    now: new Date(now),
  })
  return lockedMap(players)
}

describe('daily lock — NHL', () => {
  it('Wednesday (no Oilers game) McDavid is movable under daily, locked under per_player_kickoff', async () => {
    expect(await nhlLocks('2026-09-30T16:00:00.000Z', DAILY_ON)).toEqual({ mcdavid: false, matthews: false })
    expect(await nhlLocks('2026-09-30T16:00:00.000Z', {})).toEqual({ mcdavid: true, matthews: false })
  })

  it('Thursday after puck drop McDavid locks again for that day only', async () => {
    expect(await nhlLocks('2026-10-01T23:30:00.000Z', DAILY_ON)).toEqual({ mcdavid: true, matthews: false })
    expect(await nhlLocks('2026-10-02T14:00:00.000Z', DAILY_ON)).toEqual({ mcdavid: false, matthews: false })
    expect(await nhlLocks('2026-10-02T23:05:00.000Z', DAILY_ON)).toEqual({ mcdavid: false, matthews: true })
  })
})

// ── MLB (Rolling Insights season schedule slate) ────────────────────────────
// MLB 2026 opens 2026-03-25: week 1 is Mar 25 – Mar 31. EDT = UTC-4.
function riGame(overrides: Partial<ScheduleGame> & { day: string }): ScheduleGame {
  return {
    gameId: `g-${overrides.day}-${overrides.homeTeam}-${overrides.startTime ?? 'tbd'}`,
    startTime: null,
    status: 'scheduled',
    seasonType: 'regular',
    eventName: null,
    replacedBy: null,
    ...overrides,
  }
}

function riCacheDb(games: ScheduleGame[]) {
  const prefix = scheduleKeyPrefix('MLB', 2026)
  const byKey = new Map<string, ScheduleGame[]>()
  for (const g of games) byKey.set(`${prefix}${g.day}`, [...(byKey.get(`${prefix}${g.day}`) ?? []), g])
  return {
    sportsGame: { findMany: async () => [] },
    sportsDataCache: {
      findUnique: async ({ where }: { where: { cacheKey: string } }) => (where.cacheKey === `${prefix}meta` ? { data: {} } : null),
      findMany: async ({ where }: { where: { cacheKey: { in: string[] } } }) =>
        where.cacheKey.in.filter((k) => byKey.has(k)).map((k) => ({ cacheKey: k, data: { games: byKey.get(k) } })),
    },
  } as never
}

const MLB_GAMES: ScheduleGame[] = [
  // Thu Mar 26, 1:05pm ET day game.
  riGame({ day: '2026-03-26', startTime: '2026-03-26T17:05:00.000Z', homeTeam: 'New York Yankees', awayTeam: 'Boston Red Sox', status: 'completed' }),
  // Thu Mar 26, 10:10pm ET — Thursday's game, Friday in UTC.
  riGame({ day: '2026-03-26', startTime: '2026-03-27T02:10:00.000Z', homeTeam: 'Los Angeles Dodgers', awayTeam: 'San Diego Padres', status: 'completed' }),
  // Sat Mar 28 doubleheader: 1:20pm and 7:05pm ET.
  riGame({ day: '2026-03-28', startTime: '2026-03-28T17:20:00.000Z', homeTeam: 'Chicago Cubs', awayTeam: 'Milwaukee Brewers' }),
  riGame({ day: '2026-03-28', startTime: '2026-03-28T23:05:00.000Z', homeTeam: 'Chicago Cubs', awayTeam: 'Milwaukee Brewers' }),
  // Sun Mar 29: a postponed Yankees game must not lock anyone.
  riGame({ day: '2026-03-29', startTime: '2026-03-29T17:35:00.000Z', homeTeam: 'New York Yankees', awayTeam: 'Boston Red Sox', status: 'postponed' }),
  // Mon Mar 30: no start time announced — locks at the start of that Eastern day (early, never late).
  riGame({ day: '2026-03-30', startTime: null, homeTeam: 'Los Angeles Dodgers', awayTeam: 'San Diego Padres' }),
]
const MLB_PLAYERS = [
  { playerId: 'judge', team: 'New York Yankees' },
  { playerId: 'ohtani', team: 'Los Angeles Dodgers' },
  { playerId: 'happ', team: 'Chicago Cubs' },
]

async function mlbLocks(now: string, leagueSettings: unknown) {
  const { players } = await hydrateRedraftLineupLocks(riCacheDb(MLB_GAMES), {
    sport: 'MLB',
    season: 2026,
    week: 1,
    rosterId: 'r1',
    leagueSettings,
    players: MLB_PLAYERS,
    now: new Date(now),
  })
  return lockedMap(players)
}

describe('daily lock — MLB', () => {
  it('Thursday afternoon: the day game has started, the night game has not', async () => {
    expect(await mlbLocks('2026-03-26T18:00:00.000Z', DAILY_ON)).toEqual({ judge: true, ohtani: false, happ: false })
  })

  it('the 10:10pm ET game locks Thursday night and releases Friday morning', async () => {
    expect(await mlbLocks('2026-03-27T02:30:00.000Z', DAILY_ON)).toEqual({ judge: true, ohtani: true, happ: false })
    expect(await mlbLocks('2026-03-27T14:00:00.000Z', DAILY_ON)).toEqual({ judge: false, ohtani: false, happ: false })
  })

  it('a doubleheader locks at the first game of the day', async () => {
    expect(await mlbLocks('2026-03-28T17:00:00.000Z', DAILY_ON)).toEqual({ judge: false, ohtani: false, happ: false })
    expect(await mlbLocks('2026-03-28T17:30:00.000Z', DAILY_ON)).toEqual({ judge: false, ohtani: false, happ: true })
  })

  it('a postponed game locks nobody; a game with no start time locks from the start of its Eastern day', async () => {
    expect(await mlbLocks('2026-03-29T18:00:00.000Z', DAILY_ON)).toEqual({ judge: false, ohtani: false, happ: false })
    expect(await mlbLocks('2026-03-30T05:00:00.000Z', DAILY_ON)).toEqual({ judge: false, ohtani: true, happ: false })
  })

  it('per_player_kickoff on the same Friday morning still holds the week-first-game locks (unchanged)', async () => {
    expect(await mlbLocks('2026-03-27T14:00:00.000Z', {})).toEqual({ judge: true, ohtani: true, happ: false })
  })
})

// ── Existing modes and other sports are untouched ───────────────────────────
describe('existing lock modes are unchanged', () => {
  it('first_game_of_week and manual behave as before', async () => {
    const fg = await nbaLocks('2026-10-21T13:00:00.000Z', { sportConfig: { lineupLockType: 'first_game_of_week' } })
    expect(Object.values(fg.locked).every(Boolean)).toBe(true)
    const manual = await nbaLocks('2026-10-21T13:00:00.000Z', { sportConfig: { lineupLockType: 'manual', lineupLockManualWeeks: [1] } })
    expect(Object.values(manual.locked).every(Boolean)).toBe(true)
    const manualOpen = await nbaLocks('2026-10-21T13:00:00.000Z', { sportConfig: { lineupLockType: 'manual' } })
    expect(Object.values(manualOpen.locked).some(Boolean)).toBe(false)
  })

  it('an emergency unlock still wins in daily mode', async () => {
    const { locked } = await nbaLocks('2026-10-21T00:00:00.000Z', {
      sportConfig: { ...DAILY_ON.sportConfig, lineupLockOverrides: [{ week: 1, playerId: 'tatum' }] },
    })
    expect(locked.tatum).toBe(false)
  })

  it('NFL ignores daily even with the flag on', async () => {
    const db = {
      sportsGame: {
        findMany: async () => [{ homeTeam: 'KC', awayTeam: 'BUF', startTime: new Date('2026-09-13T17:00:00.000Z') }],
      },
    } as never
    const args = {
      sport: 'NFL',
      season: 2026,
      week: 1,
      rosterId: 'r1',
      players: [{ playerId: 'mahomes', team: 'KC' }],
      // Monday after the Sunday game: per_player_kickoff keeps him locked; a daily reset would not.
      now: new Date('2026-09-14T15:00:00.000Z'),
    }
    const daily = await hydrateRedraftLineupLocks(db, { ...args, leagueSettings: DAILY_ON })
    const kickoff = await hydrateRedraftLineupLocks(db, { ...args, leagueSettings: {} })
    expect(daily.players[0].isLocked).toBe(true)
    expect(kickoff.players[0].isLocked).toBe(true)
  })

  it('readLineupLockSettings without a sport never resolves daily (callers that pass no sport are unchanged)', () => {
    expect(readLineupLockSettings(DAILY_ON).mode).toBe('per_player_kickoff')
    expect(readLineupLockSettings(DAILY_ON, 'NBA').mode).toBe('daily')
    expect(readLineupLockSettings(DAILY_ON, 'NFL').mode).toBe('per_player_kickoff')
    expect(readLineupLockSettings(DAILY_REQUESTED_NOT_ENABLED, 'NBA').mode).toBe('per_player_kickoff')
    expect(resolveLineupLockMode('daily')).toBe('per_player_kickoff')
  })

  it('pure decision: daily locks only on today’s kickoff', () => {
    const now = new Date('2026-10-21T13:00:00.000Z')
    expect(computeLineupLock({ mode: 'daily', now, playerKickoffUtc: new Date('2026-10-20T23:30:00.000Z'), playerKickoffTodayUtc: null })).toBe(false)
    expect(computeLineupLock({ mode: 'daily', now, playerKickoffTodayUtc: new Date('2026-10-21T12:00:00.000Z') })).toBe(true)
    expect(computeLineupLock({ mode: 'daily', now, playerKickoffTodayUtc: new Date('2026-10-21T23:00:00.000Z') })).toBe(false)
  })
})
