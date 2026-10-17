/**
 * Which clubs the defence box-score cron fetches. It read only `DEF`/`DST` rows and took the team label
 * upper-cased raw: an ESPN / Fleaflicker `D/ST` was never fetched, and a Sleeper DEF row whose team reads
 * "Arizona Cardinals" asked the provider for a team called "ARIZONA CARDINALS".
 */
import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { resolveRosteredDefenseTeams } from '@/lib/redraft/teamDefenseProvider'
import { canonicalTeamDefenseId } from '@/lib/scoring-runtime/nflStatNormalization'
import { planTeamDefenseImport } from '@/lib/redraft/teamDefenseProvider'
import type { SportWeekResolution } from '@/lib/season-week/types'

describe('canonicalTeamDefenseId — the one key a defence box score lives under', () => {
  it('both id forms resolve to nfl:def:<ABBR>', () => {
    expect(canonicalTeamDefenseId('KC', 'DEF')).toBe('nfl:def:KC')
    expect(canonicalTeamDefenseId('KC', 'D/ST')).toBe('nfl:def:KC')
    expect(canonicalTeamDefenseId('nfl:def:kc', null)).toBe('nfl:def:KC')
  })

  it('🛑 a bare code is a defence only on a defence row; a numeric or named id never is', () => {
    expect(canonicalTeamDefenseId('KC', 'WR')).toBeNull()
    expect(canonicalTeamDefenseId('KC', null)).toBeNull()
    expect(canonicalTeamDefenseId('4984', 'DEF')).toBeNull()
    expect(canonicalTeamDefenseId('-16012', 'D/ST')).toBeNull()
    expect(canonicalTeamDefenseId('name:Denver Defense:DEF:DEN', 'DEF')).toBeNull()
  })
})

type Game = { week: number; homeTeam: string; awayTeam: string; seasonType?: string; homeScore?: number | null }

function fakePrisma(rows: Array<Record<string, unknown>>, games: Game[] = [], cache: Array<{ playerId: string; payload: unknown }> = []) {
  return {
    sportsGame: {
      // Evaluates the parts of the query that decide a week: regular season, finished, before the current week.
      findMany: vi.fn(async (args: { where: { seasonType: string; week: { lt: number } } }) =>
        games.filter(
          (g) =>
            (g.seasonType ?? 'regular') === args.where.seasonType &&
            g.week < args.where.week.lt &&
            g.homeScore !== null,
        ),
      ),
    },
    playerGameLogCache: {
      findMany: vi.fn(async (args: { where: { playerId: { in: string[] } } }) => cache.filter((c) => args.where.playerId.in.includes(c.playerId))),
    },
    redraftRoster: { findMany: vi.fn(async () => [{ id: 'r1' }]) },
    redraftRosterPlayer: {
      // Evaluates the position filter, so a row the query would not return is not returned.
      findMany: vi.fn(async (args: { where: { position: { in: string[] } } }) =>
        rows.filter((r) => args.where.position.in.includes(String(r.position))),
      ),
    },
  } as unknown as PrismaClient
}

async function teams(rows: Array<Record<string, unknown>>) {
  const buckets = await resolveRosteredDefenseTeams(fakePrisma(rows), [{ id: 's1', season: 2026, currentWeek: 3 }])
  return [...(buckets.get('2026:3')?.teams ?? [])].sort()
}

describe('resolveRosteredDefenseTeams — one club code per rostered defence', () => {
  it('🛑 Sleeper\'s bare id names the club, whatever its team label says', async () => {
    expect(await teams([{ playerId: 'ARI', position: 'DEF', team: 'Arizona Cardinals' }])).toEqual(['ARI'])
  })

  it('🛑 an imported `D/ST` is fetched: ESPN by its team code, Fleaflicker by its nickname', async () => {
    expect(
      await teams([
        { playerId: '-16012', position: 'D/ST', team: 'KC' },
        { playerId: '2330', position: 'D/ST', team: 'Ravens' },
      ]),
    ).toEqual(['BAL', 'KC'])
  })

  it('a synthetic `nfl:def:` id still names its club; a label that names no club adds nothing', async () => {
    expect(
      await teams([
        { playerId: 'nfl:def:BUF', position: 'DEF', team: null },
        { playerId: 'name:Mystery Defense:DEF', position: 'DEF', team: 'Mystery' },
      ]),
    ).toEqual(['BUF'])
  })
})

/*
 * 🛑 The cron fetched `RedraftSeason.currentWeek`, which nothing keeps on the NFL's week: on production
 * 2026-10-13 the defence cache held weeks 1 and 3 only while weeks 1-5 had final scores.
 */
describe('planTeamDefenseImport — the NFL\'s own week, plus a bounded fill of missed weeks', () => {
  const week = (sportWeek: number, seasonType = 'regular') =>
    async () => ({ ok: true, sportWeek, seasonType, state: 'played', slate: {}, nextSportWeek: null, source: 'schedule' }) as unknown as SportWeekResolution
  const kcAndBuf = [
    { playerId: 'KC', position: 'DEF', team: 'KC' },
    { playerId: 'BUF', position: 'DEF', team: 'BUF' },
  ]
  const game = (w: number, homeTeam: string, awayTeam: string, extra: Partial<Game> = {}): Game => ({ week: w, homeTeam, awayTeam, homeScore: 20, ...extra })
  const plan = (rows: Array<Record<string, unknown>>, games: Game[], cache: Array<{ playerId: string; payload: unknown }>, deps: Parameters<typeof planTeamDefenseImport>[2]) =>
    planTeamDefenseImport(fakePrisma(rows, games, cache), [{ id: 's1', season: 2026, currentWeek: 1 }], deps)

  it('🛑 fetches the schedule\'s week (5), not the season\'s stored week (1)', async () => {
    const { buckets } = await plan(kcAndBuf, [], [], { resolveWeek: week(5), maxBackfillWeeks: 0 })
    expect(buckets).toEqual([{ season: 2026, week: 5, teams: ['BUF', 'KC'], reason: 'current' }])
  })

  it('a schedule that names no regular-season week falls back to the stored week, and says so', async () => {
    const { buckets, warnings } = await plan(kcAndBuf, [], [], { resolveWeek: week(2, 'pre'), maxBackfillWeeks: 0 })
    expect(buckets[0]).toMatchObject({ week: 1, reason: 'current' })
    expect(warnings.join(' ')).toMatch(/stored week 1/)
  })

  it('🛑 fills earlier finished weeks a rostered club played and has no cached line — newest first, only the clubs missing', async () => {
    const games = [
      game(1, 'KC', 'BUF'),
      game(2, 'KC', 'NYJ'), game(2, 'BUF', 'MIA'),
      game(3, 'KC', 'DEN'), // BUF on bye
      game(4, 'BUF', 'KC'),
      game(4, 'KC', 'LV', { seasonType: 'pre' }), // a preseason week 4 is not week 4
    ]
    const cache = [
      { playerId: 'nfl:def:KC', payload: [{ week: 1, def_sack: 2 }, { week: 3, def_sack: 1 }] },
      { playerId: 'nfl:def:BUF', payload: [{ week: 1, def_sack: 3 }, { week: 4, def_sack: 1 }] },
    ]
    const { buckets } = await plan(kcAndBuf, games, cache, { resolveWeek: week(5) })
    expect(buckets).toEqual([
      { season: 2026, week: 5, teams: ['BUF', 'KC'], reason: 'current' },
      { season: 2026, week: 4, teams: ['KC'], reason: 'backfill' },
      { season: 2026, week: 2, teams: ['BUF', 'KC'], reason: 'backfill' },
    ])
  })

  it('🛑 bounded: at most maxBackfillWeeks earlier weeks per run, the newest first', async () => {
    const games = [game(1, 'KC', 'BUF'), game(2, 'KC', 'BUF'), game(3, 'KC', 'BUF'), game(4, 'KC', 'BUF')]
    const { buckets } = await plan(kcAndBuf, games, [], { resolveWeek: week(5), maxBackfillWeeks: 2 })
    expect(buckets.filter((b) => b.reason === 'backfill').map((b) => b.week)).toEqual([4, 3])
  })

  it('an unfinished game is not a week to fill', async () => {
    const { buckets } = await plan(kcAndBuf, [game(4, 'KC', 'BUF', { homeScore: null })], [], { resolveWeek: week(5) })
    expect(buckets.filter((b) => b.reason === 'backfill')).toEqual([])
  })
})
