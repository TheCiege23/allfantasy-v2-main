import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/merged-devy-c2c/C2CLeagueConfig', () => ({
  getC2CConfig: vi.fn(async () => ({ collegeActiveLineupSlots: { QB: 1, RB: 1, WR: 1, FLEX: 1 } })),
}))

import { footballCampusMoveLock } from '@/lib/c2c/footballCampusMoveLock'
import { checkCampusSave } from '@/lib/c2c/campusLineupCheck'
import { campusPointsForMatchup } from '@/lib/c2c/campusScoring'
import {
  footballCampusWeekKey,
  loadFootballCampusWeekStarters,
  persistFootballCampusWeekSnapshot,
  pickFootballCampusWeek,
} from '@/lib/c2c/footballCampusWeekSnapshot'

/*
 * NFL C2C campus lineup (owner's decision, 2026-11-24): each college player locks at his own school's
 * kickoff, and every save records that week's campus starters so a later change never rewrites a past week.
 */

const NOW = new Date('2026-09-12T18:00:00Z') // Saturday afternoon
const game = (home: string, away: string, start: string | null, status: string | null = 'scheduled') => ({ homeTeam: home, awayTeam: away, startTime: start, status })

describe('footballCampusMoveLock', () => {
  const schools = new Map([['p-uga', 'Georgia'], ['p-osu', 'Ohio State'], ['p-bye', 'Navy'], ['p-tbd', 'Utah']])
  const games = [
    game('Georgia', 'Auburn', '2026-09-12T16:00:00Z', 'in_progress'),
    game('Ohio State', 'Michigan', '2026-09-12T23:30:00Z'),
    game('Utah', 'BYU', null),
  ]

  it('locks a player whose game has kicked off, frees one whose game is later', () => {
    const out = footballCampusMoveLock({ changedPlayerIds: ['p-uga', 'p-osu'], schoolForPlayer: schools, games, now: NOW })
    expect(out).toEqual({ lockedPlayerIds: ['p-uga'], unknownPlayerIds: [] })
  })

  it('locks by kickoff time even while the status still says scheduled', () => {
    const late = [game('Ohio State', 'Michigan', '2026-09-12T17:00:00Z', 'scheduled')]
    expect(footballCampusMoveLock({ changedPlayerIds: ['p-osu'], schoolForPlayer: schools, games: late, now: NOW }).lockedPlayerIds).toEqual(['p-osu'])
  })

  it('a school with no game this week is free; an unknown school or game time is not checked, so not free', () => {
    const out = footballCampusMoveLock({ changedPlayerIds: ['p-bye', 'p-tbd', 'p-nobody'], schoolForPlayer: schools, games, now: NOW })
    expect(out.lockedPlayerIds).toEqual([])
    expect(out.unknownPlayerIds.sort()).toEqual(['p-nobody', 'p-tbd'])
  })

  it('an unreadable schedule checks nobody', () => {
    expect(footballCampusMoveLock({ changedPlayerIds: ['p-osu'], schoolForPlayer: schools, games: null, now: NOW }).unknownPlayerIds).toEqual(['p-osu'])
  })
})

describe('checkCampusSave: NFL C2C kickoff lock', () => {
  const league = { id: 'L1', platform: 'af', sport: 'NFL', leagueVariant: 'c2c' }
  const lineup = (campus: string[]) => ({ lineup_sections: { devy: [{ id: '111' }, { id: '222' }], campus } })
  type G = ReturnType<typeof game>
  const makeDb = (cfbGames: G[]) => ({
    redraftRosterPlayer: { findMany: vi.fn(async () => [{ playerId: '111', position: 'QB', playerName: 'UGA QB' }, { playerId: '222', position: 'WR', playerName: 'OSU WR' }]) },
    sportsGame: {
      findMany: vi.fn(async ({ where }: { where: { sport: unknown } }) =>
        where.sport === 'NCAAF'
          ? cfbGames.map((g) => ({ week: 2, ...g }))
          : [{ week: 1, startTime: '2026-09-11T00:20:00Z' }],
      ),
    },
    sportsPlayer: {
      findMany: vi.fn(async ({ where }: { where: { externalId: { in: string[] } } }) =>
        where.externalId.in.map((externalId) => ({ externalId, college: externalId === '111' ? 'Georgia' : externalId === '222' ? 'Ohio State' : null, team: null })),
      ),
    },
    playerIdentityMap: { findMany: vi.fn(async () => []) },
  })
  const games = [game('Georgia', 'Auburn', '2026-09-12T16:00:00Z', 'in_progress'), game('Ohio State', 'Michigan', '2026-09-12T23:30:00Z')]
  const save = (db: unknown, before: unknown, after: unknown) =>
    checkCampusSave(db as never, { league, redraftRosterId: 'R1', before, after, season: 2026, week: 1, now: NOW })

  it('refuses starting a player whose game has started', async () => {
    const issues = await save(makeDb(games), lineup([]), lineup(['111']))
    expect(issues.map((i) => i.message)).toEqual(['A college player’s game has started, so that campus spot is locked.'])
  })

  it('refuses benching a started player, even by emptying the campus lineup', async () => {
    expect((await save(makeDb(games), lineup(['111']), lineup([]))).map((i) => i.code)).toEqual(['campus_ineligible'])
  })

  it('allows a player whose game has not kicked off', async () => {
    expect(await save(makeDb(games), lineup([]), lineup(['222']))).toEqual([])
  })

  it('refuses a player whose school the schedule has never seen', async () => {
    const db = makeDb([game('Michigan', 'Ohio Stat', '2026-09-12T23:30:00Z')])
    expect((await save(db, lineup([]), lineup(['222']))).map((i) => i.code)).toEqual(['campus_ineligible'])
  })

  it('an unchanged campus lineup is never re-judged', async () => {
    expect(await save(makeDb(games), lineup(['111']), lineup(['111']))).toEqual([])
  })
})

describe('football campus weekly snapshot', () => {
  const memoryCache = () => {
    const rows = new Map<string, unknown>()
    return {
      rows,
      sportsDataCache: {
        upsert: vi.fn(async ({ where, create }: { where: { cacheKey: string }; create: { data: unknown } }) => { rows.set(where.cacheKey, create.data) }),
        findMany: vi.fn(async ({ where }: { where: { OR: Array<{ cacheKey: { startsWith: string } }> } }) =>
          [...rows].filter(([k]) => where.OR.some((o) => k.startsWith(o.cacheKey.startsWith))).map(([cacheKey, data]) => ({ cacheKey, data })),
        ),
      },
    }
  }

  it('picks the latest saved week at or before the scored week', () => {
    const s = (week: number, starters: string[]) => ({ season: 2026, week, savedAt: '', starters })
    const snaps = [s(1, ['a']), s(3, ['b']), s(5, ['c'])]
    expect(pickFootballCampusWeek(snaps, 2026, 4)?.starters).toEqual(['b'])
    expect(pickFootballCampusWeek(snaps, 2026, 5)?.starters).toEqual(['c'])
    expect(pickFootballCampusWeek(snaps, 2026, 0)).toBeNull()
    expect(pickFootballCampusWeek(snaps, 2025, 9)).toBeNull()
  })

  it('a week saves its starters, and a later week never rewrites it', async () => {
    const db = memoryCache()
    await persistFootballCampusWeekSnapshot(db as never, { redraftRosterId: 'H', season: 2026, week: 1, playerData: { lineup_sections: { campus: ['111'] } }, now: NOW })
    await persistFootballCampusWeekSnapshot(db as never, { redraftRosterId: 'H', season: 2026, week: 3, playerData: { lineup_sections: { campus: ['222'] } }, now: NOW })
    expect(db.rows.has(footballCampusWeekKey('H', 2026, 1))).toBe(true)
    const wk = async (week: number) => (await loadFootballCampusWeekStarters(db as never, { redraftRosterIds: ['H', 'A'], season: 2026, week })).get('H')
    expect(await wk(1)).toEqual(['111'])
    expect(await wk(2)).toEqual(['111'])
    expect(await wk(3)).toEqual(['222'])
    expect((await loadFootballCampusWeekStarters(db as never, { redraftRosterIds: ['A'], season: 2026, week: 3 })).has('A')).toBe(false)
  })

  it('scoring a past week reads that week’s snapshot, not the current lineup', async () => {
    const cache = memoryCache()
    await persistFootballCampusWeekSnapshot(cache as never, { redraftRosterId: 'H', season: 2026, week: 1, playerData: { lineup_sections: { campus: ['111'] } }, now: NOW })
    const db = {
      ...cache,
      // The CURRENT lineup has moved on to 222.
      roster: { findMany: vi.fn(async () => [{ redraftRosterId: 'H', playerData: { lineup_sections: { campus: ['222'] } } }, { redraftRosterId: 'A', playerData: {} }]) },
      redraftRosterPlayer: { findMany: vi.fn(async () => [{ rosterId: 'H', playerId: '111', position: 'QB' }, { rosterId: 'H', playerId: '222', position: 'WR' }]) },
      playerGameStat: { findMany: vi.fn(async () => []) },
      sportsGame: {
        findMany: vi.fn(async ({ where }: { where: { sport: unknown } }) =>
          where.sport === 'NCAAF' ? [{ week: 2, startTime: '2026-09-12T16:00:00Z' }] : [{ week: 1, startTime: '2026-09-11T00:20:00Z' }],
        ),
      },
      sportsPlayer: { findMany: vi.fn(async ({ where }: { where: { externalId: { in: string[] } } }) => where.externalId.in.map((externalId) => ({ externalId }))) },
      playerIdentityMap: { findMany: vi.fn(async () => []) },
    }
    const out = await campusPointsForMatchup(db as never, { season: 2026, nflWeek: 1, homeRosterId: 'H', awayRosterId: 'A' })
    expect(out?.home.players.map((p) => p.playerId)).toEqual(['111'])
  })
})
