// @vitest-environment node
/**
 * Weekly upsets (shareable moments, 2026-09-14): a win counts as an upset only by the odds SAVED
 * before kickoff — never recomputed — and a missing snapshot table is simply no upsets.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  teamFindMany: vi.fn(),
  teamFindFirst: vi.fn(),
  leagueFind: vi.fn(),
  matchupFind: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: h.queryRaw,
    leagueTeam: { findMany: h.teamFindMany, findFirst: h.teamFindFirst },
    league: { findUnique: h.leagueFind },
    weeklyMatchup: { findUnique: h.matchupFind },
  },
}))

import {
  UPSET_MAX_WIN_PROBABILITY,
  claimedRosters,
  formatWinChance,
  getUpsetForCard,
  getWeeklyUpsetsForUser,
  isUpset,
  readOddsSnapshots,
} from '@/lib/share/weeklyUpset'

const MISSING = Object.assign(new Error('relation "matchup_odds_snapshots" does not exist'), { code: 'P2010', meta: { code: '42P01' } })

const snapRow = (over: Record<string, unknown> = {}) => ({
  league_id: 'sl-ice',
  season: 2026,
  week: 1,
  roster_id: '4',
  opponent_roster_id: '9',
  win_probability: 0.22,
  projected_points: 96.3,
  opponent_projected_points: 110.8,
  ...over,
})

type Row = { leagueId: string; leagueName: string; pointsFor: number; pointsAgainst: number; won: boolean }
const row = (leagueId: string, pointsFor: number, pointsAgainst: number, won = pointsFor > pointsAgainst): Row => ({
  leagueId,
  leagueName: leagueId.replace('af-', '').toUpperCase(),
  pointsFor,
  pointsAgainst,
  won,
})
const played = (rows: Row[]) => ({ season: 2026, week: 1, rows })
const league = (key: string) => ({ id: `af-${key}`, platformLeagueId: `sl-${key}` })

/** The SQL text and bound values of the n-th raw query. */
const rawCall = (n = 0) => {
  const [strings, ...values] = h.queryRaw.mock.calls[n] as [TemplateStringsArray, ...unknown[]]
  return { sql: strings.join('?'), values }
}

beforeEach(() => {
  for (const f of Object.values(h)) f.mockReset()
})

describe('isUpset / formatWinChance / claimedRosters', () => {
  it('🛑 an upset is a win outright with saved odds of at most 40%', () => {
    const win = { pointsFor: 112.4, pointsAgainst: 98.1, won: true }
    expect(UPSET_MAX_WIN_PROBABILITY).toBe(0.4)
    expect(isUpset(win, 0.22)).toBe(true)
    expect(isUpset(win, 0.4)).toBe(true)
    expect(isUpset(win, 0.41)).toBe(false)
    expect(isUpset({ pointsFor: 90, pointsAgainst: 98.1, won: false }, 0.22)).toBe(false)
    // A row flagged won with no winning margin, or a margin with no win flag, is not a win outright.
    expect(isUpset({ pointsFor: 98.1, pointsAgainst: 98.1, won: true }, 0.22)).toBe(false)
    expect(isUpset({ pointsFor: 112.4, pointsAgainst: 98.1, won: false }, 0.22)).toBe(false)
  })

  it('🛑 no saved odds, no upset — null, undefined and NaN are never a chance', () => {
    const win = { pointsFor: 112.4, pointsAgainst: 98.1, won: true }
    expect(isUpset(win, null)).toBe(false)
    expect(isUpset(win, undefined)).toBe(false)
    expect(isUpset(win, Number.NaN)).toBe(false)
  })

  it('formats the chance as a whole percent; under half a percent is "<1%", never "0%"', () => {
    expect(formatWinChance(0.224)).toBe('22%')
    expect(formatWinChance(0.4)).toBe('40%')
    expect(formatWinChance(0.005)).toBe('1%')
    expect(formatWinChance(0.004)).toBe('<1%')
  })

  it('🛑 claimed rosters keep the platform id as written; blank ids skip; a league claimed twice has none', () => {
    const m = claimedRosters([
      { leagueId: 'af-mfl', externalId: '0001' },
      { leagueId: 'af-ice', externalId: ' 4 ' },
      { leagueId: 'af-blank', externalId: '  ' },
      { leagueId: 'af-null', externalId: null },
      { leagueId: 'af-two', externalId: '3' },
      { leagueId: 'af-two', externalId: '5' },
    ])
    expect([...m.entries()]).toEqual([
      ['af-mfl', '0001'],
      ['af-ice', '4'],
    ])
  })
})

describe('readOddsSnapshots', () => {
  it('🛑 reads only that season and week, for exactly those rosters', async () => {
    h.queryRaw.mockResolvedValue([snapRow(), snapRow({ league_id: 'sl-mfl', roster_id: '0001', win_probability: '0.08', season: '2026', week: '1' })])
    const out = await readOddsSnapshots(
      [
        { leagueId: 'sl-ice', rosterId: '4' },
        { leagueId: 'sl-mfl', rosterId: '0001' },
      ],
      2026,
      1,
    )
    const { sql, values } = rawCall()
    expect(sql).toContain('FROM "matchup_odds_snapshots"')
    expect(sql).toContain('WHERE "season" = ? AND "week" = ?')
    expect(sql).toContain('("league_id", "roster_id") IN (?)')
    expect(values.slice(0, 2)).toEqual([2026, 1])
    expect((values[2] as { values: unknown[] }).values).toEqual(['sl-ice', '4', 'sl-mfl', '0001'])
    expect(out).toEqual([
      { leagueId: 'sl-ice', season: 2026, week: 1, rosterId: '4', opponentRosterId: '9', winProbability: 0.22, projectedPoints: 96.3, opponentProjectedPoints: 110.8 },
      { leagueId: 'sl-mfl', season: 2026, week: 1, rosterId: '0001', opponentRosterId: '9', winProbability: 0.08, projectedPoints: 96.3, opponentProjectedPoints: 110.8 },
    ])
  })

  it('no keys, no read', async () => {
    expect(await readOddsSnapshots([], 2026, 1)).toEqual([])
    expect(h.queryRaw).not.toHaveBeenCalled()
  })

  it('🛑 a parked migration (42P01) is no odds; any other failure propagates', async () => {
    h.queryRaw.mockRejectedValue(MISSING)
    expect(await readOddsSnapshots([{ leagueId: 'sl-ice', rosterId: '4' }], 2026, 1)).toEqual([])
    h.queryRaw.mockRejectedValue(new Error('connection reset'))
    await expect(readOddsSnapshots([{ leagueId: 'sl-ice', rosterId: '4' }], 2026, 1)).rejects.toThrow('connection reset')
  })
})

describe('getWeeklyUpsetsForUser', () => {
  it('🛑 your wins with saved odds of at most 40%, longest odds first, from YOUR claimed rosters', async () => {
    h.teamFindMany.mockResolvedValue([
      { leagueId: 'af-ice', externalId: '4' },
      { leagueId: 'af-dyn', externalId: '0007' },
    ])
    h.queryRaw.mockResolvedValue([
      snapRow({ win_probability: 0.35 }),
      snapRow({ league_id: 'sl-dyn', roster_id: '0007', win_probability: 0.08 }),
    ])
    const out = await getWeeklyUpsetsForUser('u1', [league('ice'), league('dyn')], played([row('af-ice', 112.4, 98.1), row('af-dyn', 120, 100)]))
    expect(h.teamFindMany.mock.calls[0][0]).toEqual({
      where: { leagueId: { in: ['af-ice', 'af-dyn'] }, claimedByUserId: 'u1' },
      select: { leagueId: true, externalId: true },
    })
    const { values } = rawCall()
    expect(values.slice(0, 2)).toEqual([2026, 1])
    expect((values[2] as { values: unknown[] }).values).toEqual(['sl-ice', '4', 'sl-dyn', '0007'])
    expect(out).toEqual([
      { leagueId: 'af-dyn', leagueName: 'DYN', season: 2026, week: 1, winProbability: 0.08, winChance: '8%', pointsFor: 120, pointsAgainst: 100 },
      { leagueId: 'af-ice', leagueName: 'ICE', season: 2026, week: 1, winProbability: 0.35, winChance: '35%', pointsFor: 112.4, pointsAgainst: 98.1 },
    ])
  })

  it('🛑 not upsets: a loss (never read), a favourite’s win, a win with no saved odds', async () => {
    h.teamFindMany.mockResolvedValue([
      { leagueId: 'af-dyn', externalId: '7' },
      { leagueId: 'af-blz', externalId: '2' },
    ])
    h.queryRaw.mockResolvedValue([snapRow({ league_id: 'sl-dyn', roster_id: '7', win_probability: 0.62 })])
    const out = await getWeeklyUpsetsForUser(
      'u1',
      [league('ice'), league('dyn'), league('blz')],
      played([row('af-ice', 90, 98.1), row('af-dyn', 120, 100), row('af-blz', 101, 99)]),
    )
    expect(h.teamFindMany.mock.calls[0][0].where.leagueId).toEqual({ in: ['af-dyn', 'af-blz'] })
    expect(out).toEqual([])
  })

  it('🛑 a snapshot for a DIFFERENT roster of the league is not yours', async () => {
    h.teamFindMany.mockResolvedValue([{ leagueId: 'af-ice', externalId: '4' }])
    h.queryRaw.mockResolvedValue([snapRow({ roster_id: '9', win_probability: 0.1 })])
    expect(await getWeeklyUpsetsForUser('u1', [league('ice')], played([row('af-ice', 112.4, 98.1)]))).toEqual([])
  })

  it('nothing to read: no played week, no wins, no platform id, no claim — and no odds read', async () => {
    expect(await getWeeklyUpsetsForUser('u1', [league('ice')], { ...played([row('af-ice', 112.4, 98.1)]), season: null })).toEqual([])
    expect(await getWeeklyUpsetsForUser('u1', [league('ice')], { ...played([row('af-ice', 112.4, 98.1)]), week: null })).toEqual([])
    expect(await getWeeklyUpsetsForUser('u1', [league('ice')], played([row('af-ice', 90, 98.1)]))).toEqual([])
    expect(await getWeeklyUpsetsForUser('u1', [{ id: 'af-ice', platformLeagueId: null }], played([row('af-ice', 112.4, 98.1)]))).toEqual([])
    expect(h.teamFindMany).not.toHaveBeenCalled()
    h.teamFindMany.mockResolvedValue([
      { leagueId: 'af-ice', externalId: '4' },
      { leagueId: 'af-ice', externalId: '5' },
    ])
    expect(await getWeeklyUpsetsForUser('u1', [league('ice')], played([row('af-ice', 112.4, 98.1)]))).toEqual([])
    expect(h.queryRaw).not.toHaveBeenCalled()
  })

  it('a parked migration is no upsets, not an error', async () => {
    h.teamFindMany.mockResolvedValue([{ leagueId: 'af-ice', externalId: '4' }])
    h.queryRaw.mockRejectedValue(MISSING)
    expect(await getWeeklyUpsetsForUser('u1', [league('ice')], played([row('af-ice', 112.4, 98.1)]))).toEqual([])
  })

  it('reads at most 12 leagues per render', async () => {
    const keys = Array.from({ length: 13 }, (_, i) => `l${i}`)
    h.teamFindMany.mockResolvedValue([])
    await getWeeklyUpsetsForUser('u1', keys.map(league), played(keys.map((k) => row(`af-${k}`, 110, 100))))
    expect(h.teamFindMany.mock.calls[0][0].where.leagueId.in).toEqual(keys.slice(0, 12).map((k) => `af-${k}`))
  })
})

describe('getUpsetForCard', () => {
  const arrange = () => {
    // A padded id is still your roster — and still finds your team's name.
    h.teamFindMany.mockResolvedValue([{ leagueId: 'af-ice', externalId: ' 4 ', teamName: ' Ice Kings FC ' }])
    h.leagueFind.mockResolvedValue({ name: 'Ice Kings', platformLeagueId: 'sl-ice' })
    h.matchupFind.mockResolvedValue({ pointsFor: 112.4, pointsAgainst: 98.1, win: 1 })
    h.queryRaw.mockResolvedValue([snapRow()])
    h.teamFindFirst.mockResolvedValue({ teamName: 'Gooby Gang' })
  }

  it('🛑 your claimed team, its scored win that week, and the odds saved for it', async () => {
    arrange()
    expect(await getUpsetForCard('u1', 'af-ice', 2026, 1)).toEqual({
      leagueId: 'af-ice',
      leagueName: 'Ice Kings',
      season: 2026,
      week: 1,
      winProbability: 0.22,
      winChance: '22%',
      pointsFor: 112.4,
      pointsAgainst: 98.1,
      teamName: 'Ice Kings FC',
      opponentName: 'Gooby Gang',
      projectedPoints: 96.3,
      opponentProjectedPoints: 110.8,
    })
    expect(h.teamFindMany.mock.calls[0][0].where).toEqual({ leagueId: 'af-ice', claimedByUserId: 'u1' })
    expect(h.matchupFind.mock.calls[0][0].where).toEqual({
      leagueId_seasonYear_week_rosterId: { leagueId: 'sl-ice', seasonYear: 2026, week: 1, rosterId: '4' },
    })
    expect((rawCall().values[2] as { values: unknown[] }).values).toEqual(['sl-ice', '4'])
    expect(h.teamFindFirst.mock.calls[0][0].where).toEqual({ leagueId: 'af-ice', externalId: '9' })
  })

  it('🛑 no claim of yours in the league is null before any other read', async () => {
    arrange()
    h.teamFindMany.mockResolvedValue([])
    expect(await getUpsetForCard('u1', 'af-ice', 2026, 1)).toBeNull()
    expect(h.leagueFind).not.toHaveBeenCalled()
    expect(h.matchupFind).not.toHaveBeenCalled()
    expect(h.queryRaw).not.toHaveBeenCalled()
  })

  it('🛑 null for: no platform id, no result row, a loss, a favourite, no saved odds, a parked table', async () => {
    const cases: Array<() => void> = [
      () => h.leagueFind.mockResolvedValue({ name: 'Ice Kings', platformLeagueId: null }),
      () => h.leagueFind.mockResolvedValue(null),
      () => h.matchupFind.mockResolvedValue(null),
      () => h.matchupFind.mockResolvedValue({ pointsFor: 90, pointsAgainst: 98.1, win: 0 }),
      // More points but not recorded as a win (e.g. a later correction) is not a win outright.
      () => h.matchupFind.mockResolvedValue({ pointsFor: 112.4, pointsAgainst: 98.1, win: 0 }),
      () => h.queryRaw.mockResolvedValue([snapRow({ win_probability: 0.55 })]),
      () => h.queryRaw.mockResolvedValue([]),
      () => h.queryRaw.mockRejectedValue(MISSING),
    ]
    for (const breakIt of cases) {
      arrange()
      breakIt()
      expect(await getUpsetForCard('u1', 'af-ice', 2026, 1)).toBeNull()
    }
    expect(h.teamFindFirst).not.toHaveBeenCalled()
  })

  it('🛑 names are never an email: yours falls back to "Your team", theirs to none, a blank league to "Your league"', async () => {
    arrange()
    h.teamFindMany.mockResolvedValue([{ leagueId: 'af-ice', externalId: '4', teamName: 'me@example.com' }])
    h.teamFindFirst.mockResolvedValue({ teamName: 'rival@example.com' })
    h.leagueFind.mockResolvedValue({ name: '  ', platformLeagueId: 'sl-ice' })
    expect(await getUpsetForCard('u1', 'af-ice', 2026, 1)).toMatchObject({ teamName: 'Your team', opponentName: null, leagueName: 'Your league' })
    h.teamFindFirst.mockResolvedValue(null)
    expect(await getUpsetForCard('u1', 'af-ice', 2026, 1)).toMatchObject({ opponentName: null })
  })
})
