/**
 * A daily-sport starter with no game row: a real 0 only with EVIDENCE he did not play
 * (lib/redraft/dailySportParticipation.ts). The twin of ncaafWeekParticipation for NBA / NHL / MLB.
 *
 * Teams and names are the production NHL ones: PlayerIdentityMap holds `currentTeam` in capitals,
 * TheSportsDB's `SportsGame` holds the club's own spelling.
 */
import { describe, expect, it, vi } from 'vitest'

import { DAILY_ZERO_VERDICTS, loadDailyWindowParticipation } from '@/lib/redraft/dailySportParticipation'

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const WINDOW = { start: day('2026-10-13'), end: day('2026-10-20') }

type Pim = { id: string; status: string | null; currentTeam: string | null }
type Game = { homeTeam: string; awayTeam: string; startTime: Date; status: string }
type Stat = { playerId: string; gameDate: Date }

function db(pims: Pim[], games: Game[], stats: Stat[]) {
  const playerGameStat = {
    findMany: vi.fn(async ({ where }: { where: { playerId: { in: string[] } } }) =>
      stats.filter((s) => where.playerId.in.includes(s.playerId)),
    ),
  }
  return {
    playerGameStat,
    db: {
      playerIdentityMap: {
        findMany: vi.fn(async ({ where }: { where: Record<string, { in: string[] }> }) => {
          if (where.id) return pims.filter((p) => where.id.in.includes(p.id))
          if (where.currentTeam) return pims.filter((p) => p.currentTeam && where.currentTeam.in.includes(p.currentTeam))
          return []
        }),
      },
      playerGameStat,
      sportsGame: {
        findMany: vi.fn(async () =>
          games.map((g) => ({ ...g, source: 'thesportsdb', fetchedAt: day('2026-10-24'), season: 2026, week: 7, seasonType: null })),
        ),
      },
      sportsDataCache: { findUnique: vi.fn(async () => null), findMany: vi.fn(async () => []) },
    } as never,
  }
}

const verdicts = (d: ReturnType<typeof db>['db'], ids: string[]) =>
  loadDailyWindowParticipation(d, { sport: 'NHL', sportKeys: ['NHL'], season: 2026, week: 3, window: WINDOW, identityIds: ids, now: day('2026-10-25') })

// Florida played twice that week (Tue 13 Oct, 23:00Z Thu = Thu Eastern), both final.
const FLA_GAMES: Game[] = [
  { homeTeam: 'Florida Panthers', awayTeam: 'Boston Bruins', startTime: new Date('2026-10-13T23:00:00Z'), status: 'FT' },
  { homeTeam: 'Ottawa Senators', awayTeam: 'Florida Panthers', startTime: new Date('2026-10-15T23:30:00Z'), status: 'AOT' },
]
const scratch: Pim = { id: 'pim-scratch', status: 'ACT', currentTeam: 'FLORIDA PANTHERS' }
const teammate: Pim = { id: 'pim-mate', status: 'ACT', currentTeam: 'FLORIDA PANTHERS' }
const BOTH_DAYS: Stat[] = [
  { playerId: 'pim-mate', gameDate: day('2026-10-13') },
  { playerId: 'pim-mate', gameDate: day('2026-10-15') },
]

describe('loadDailyWindowParticipation', () => {
  it('an INACT identity is a real 0, with no schedule read at all', async () => {
    const { db: d } = db([{ id: 'pim-ness', status: 'INACT', currentTeam: 'WASHINGTON CAPITALS' }], [], [])
    const v = await verdicts(d, ['pim-ness'])
    expect(v('pim-ness')).toBe('inactive')
    expect(DAILY_ZERO_VERDICTS.has('inactive')).toBe(true)
    expect((d as any).sportsGame.findMany).not.toHaveBeenCalled()
  })

  it('every game of his team final AND ingested for the team that day: a real 0', async () => {
    const { db: d } = db([scratch, teammate], FLA_GAMES, BOTH_DAYS)
    expect((await verdicts(d, ['pim-scratch']))('pim-scratch')).toBe('no_stat')
  })

  it('POSITIVE CONTROL: one of those games with no ingested row for the team stays missing', async () => {
    // The 15 Oct game is final, but nobody from Florida has a row that day: a data gap, not a scratch.
    const { db: d } = db([scratch, teammate], FLA_GAMES, BOTH_DAYS.slice(0, 1))
    const v = (await verdicts(d, ['pim-scratch']))('pim-scratch')
    expect(v).toBe('not_ingested')
    expect(DAILY_ZERO_VERDICTS.has(v)).toBe(false)
  })

  it('a game of his team not final yet: pending', async () => {
    const games = [FLA_GAMES[0], { ...FLA_GAMES[1], status: 'NS' }]
    const { db: d } = db([scratch, teammate], games, BOTH_DAYS)
    expect((await verdicts(d, ['pim-scratch']))('pim-scratch')).toBe('pending')
  })

  it('a postponed game is a blank, not an open game', async () => {
    const games = [FLA_GAMES[0], { ...FLA_GAMES[1], status: 'Postponed' }]
    const { db: d } = db([scratch, teammate], games, BOTH_DAYS.slice(0, 1))
    expect((await verdicts(d, ['pim-scratch']))('pim-scratch')).toBe('no_stat')
  })

  it('no game for his team in the window is MISSING, not a bye (a name that did not match looks the same)', async () => {
    const { db: d } = db([{ ...scratch, currentTeam: 'UTAH MAMMOTH' }], FLA_GAMES, [])
    expect((await verdicts(d, ['pim-scratch']))('pim-scratch')).toBe('no_games')
  })

  it('matches the schedule spelling the way the lineup lock does ("ST. LOUIS" / "Montréal")', async () => {
    const games: Game[] = [
      { homeTeam: 'St. Louis Blues', awayTeam: 'Montréal Canadiens', startTime: new Date('2026-10-14T00:00:00Z'), status: 'FT' },
    ]
    const stl: Pim = { id: 'pim-stl', status: 'ACT', currentTeam: 'ST. LOUIS BLUES' }
    const mtl: Pim = { id: 'pim-mtl', status: 'ACT', currentTeam: 'MONTREAL CANADIENS' }
    const { db: d } = db(
      [stl, mtl, { id: 'stl-mate', status: 'ACT', currentTeam: 'ST. LOUIS BLUES' }, { id: 'mtl-mate', status: 'ACT', currentTeam: 'MONTREAL CANADIENS' }],
      games,
      [{ playerId: 'stl-mate', gameDate: day('2026-10-13') }, { playerId: 'mtl-mate', gameDate: day('2026-10-13') }],
    )
    const v = await verdicts(d, ['pim-stl', 'pim-mtl'])
    expect([v('pim-stl'), v('pim-mtl')]).toEqual(['no_stat', 'no_stat'])
  })

  it('no team, or no identity: missing', async () => {
    const { db: d } = db([{ id: 'pim-x', status: 'ACT', currentTeam: null }], FLA_GAMES, [])
    const v = await verdicts(d, ['pim-x', 'tsdb_unbridged'])
    expect(v('pim-x')).toBe('unmatched')
    expect(v('tsdb_unbridged')).toBe('no_identity')
  })

  it('MLB reads the Rolling Insights schedule, and an unsynced one is "cannot tell"', async () => {
    const { db: d } = db([{ id: 'pim-mlb', status: 'ACT', currentTeam: 'NEW YORK METS' }], [], [])
    const v = await loadDailyWindowParticipation(d, {
      sport: 'MLB', sportKeys: ['MLB'], season: 2026, week: 3, window: WINDOW, identityIds: ['pim-mlb'],
    })
    expect(v('pim-mlb')).toBe('unmatched')
    expect((d as any).sportsGame.findMany).not.toHaveBeenCalled()
  })
})
