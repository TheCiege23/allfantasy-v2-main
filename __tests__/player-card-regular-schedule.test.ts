import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ games: [] as any[], findMany: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { sportsGame: { findMany: h.findMany } } }))

import { loadSchedule } from '@/lib/core-app/playerCard'

function game(over: Record<string, unknown> = {}) {
  return { homeTeam: 'DET', awayTeam: 'NYJ', startTime: new Date('2026-09-27T17:00:00Z'), seasonType: 'regular', venue: null, week: 3, ...over }
}

beforeEach(() => {
  h.games = []
  h.findMany.mockReset().mockImplementation(async ({ where }) => h.games.filter(row => {
    const matchingType = where.OR
      ? where.OR.some((clause: any) => clause.seasonType === row.seasonType)
      : where.seasonType.in.includes(row.seasonType)
    return matchingType && row.week >= where.week.gte && row.week <= where.week.lte
  }))
})

describe('player-card regular-season fixtures', () => {
  it('does not select an earlier untyped preseason fixture with the same week number', async () => {
    h.games = [
      game({ homeTeam: 'PIT', startTime: new Date('2026-08-21T23:00:00Z'), seasonType: null }),
      game({ homeTeam: 'PIT', startTime: new Date('2026-08-21T23:00:00Z'), seasonType: 'pre' }),
      game(),
    ]
    const result = await loadSchedule('NYJ', 2026, 3, 3, 5.1)
    expect(result.schedule).toMatchObject({ available: true, data: { weeks: [{ week: 3, opponent: 'DET', home: false, bye: false, projection: 5.1 }] } })
  })

  it.each(['REG', 'reg', 'Regular', 'regular_season', 'regularseason'])('accepts confirmed regular-season spelling %s', async seasonType => {
    h.games = [game({ seasonType })]
    expect((await loadSchedule('New York Jets', 2026, 3, null, null)).schedule).toMatchObject({ available: true, data: { weeks: [{ opponent: 'DET', projection: null }] } })
  })

  it('does not invent a schedule or bye from untyped or preseason rows alone', async () => {
    h.games = [game({ seasonType: null }), game({ seasonType: 'pre' })]
    expect(await loadSchedule('NYJ', 2026, 3, null, null)).toMatchObject({ schedule: { available: false }, byeWeek: null })
  })

  it('keeps later fixtures without fabricating later projections', async () => {
    h.games = [game(), game({ week: 4, homeTeam: 'NYJ', awayTeam: 'BUF', startTime: new Date('2026-10-04T17:00:00Z') })]
    const result = await loadSchedule('NYJ', 2026, 3, 3, 5.1)
    expect(result.schedule).toMatchObject({ available: true, data: { weeks: [
      { week: 3, opponent: 'DET', projection: 5.1 },
      { week: 4, opponent: 'BUF', projection: null },
    ] } })
  })
})

describe('player-card bye coverage', () => {
  const clubs = ['BUF','MIA','NE','BAL','CIN','CLE','PIT','HOU','IND','JAX','TEN','DEN','KC','LAC','LV','DAL','NYG','PHI','WAS','CHI','DET','GB','MIN','ATL']
  function fullSlate() {
    return Array.from({ length: 12 }, (_, i) => game({ homeTeam: clubs[i * 2], awayTeam: clubs[i * 2 + 1] }))
  }

  it('does not report a bye from a partial confirmed regular slate', async () => {
    h.games = [game({ awayTeam: 'BUF' })]
    expect(await loadSchedule('NYJ', 2026, 3, null, null)).toMatchObject({ schedule: { available: false }, byeWeek: null })
  })

  it('deduplicates provider fixtures before deciding the week is covered', async () => {
    h.games = Array.from({ length: 13 }, () => game({ homeTeam: 'Detroit Lions', awayTeam: 'Buffalo Bills' }))
    expect(await loadSchedule('NYJ', 2026, 3, null, null)).toMatchObject({ schedule: { available: false }, byeWeek: null })
  })

  it('can report a bye when the confirmed regular slate has sufficient distinct fixtures', async () => {
    h.games = fullSlate()
    expect(await loadSchedule('NYJ', 2026, 3, null, null)).toMatchObject({ schedule: { available: true, data: { weeks: [{ week: 3, bye: true, opponent: null, projection: null }] } }, byeWeek: 3 })
  })

  it('does not label a missing kickoff as a bye when the club has a fixture', async () => {
    h.games = [...fullSlate(), game({ startTime: null })]
    expect(await loadSchedule('NYJ', 2026, 3, null, null)).toMatchObject({ schedule: { available: false }, byeWeek: null })
  })
})
