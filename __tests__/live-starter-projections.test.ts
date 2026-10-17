import { beforeEach, describe, expect, it, vi } from 'vitest'
import { priceStarterProjections, type ProjectionRow } from '@/lib/live/starterProjectionPricing'
import { formatLeagueProjection, formatStarterProjection, type StarterGroup } from '@/lib/live/liveTieInGroups'

const ppr = { scoring_settings: { rec: 1, rec_yd: 0.1, rec_td: 6 } }
const half = { scoring_settings: { rec: 0.5, rec_yd: 0.1, rec_td: 6 } }

const row = (playerId: string, stats: Record<string, number>, over: Partial<ProjectionRow> = {}): ProjectionRow => ({
  playerId,
  season: 2026,
  week: 5,
  stats: { stats },
  fetchedAt: new Date('2026-10-11T12:00:00Z'),
  ...over,
})

const league = (key: string, settings: unknown, playerIds: string[]) => ({ key, season: 2026, week: 5, settings, playerIds })

describe('priceStarterProjections', () => {
  const rows = [row('p1', { rec: 6, rec_yd: 70 })]

  it("prices one player under each league's own rules", () => {
    const out = priceStarterProjections([league('A', ppr, ['p1']), league('B', half, ['p1'])], rows, new Set())
    expect(out.get('A:p1')).toEqual({ projected: 13, out: false })
    expect(out.get('B:p1')).toEqual({ projected: 10, out: false })
  })

  it('a ruled-out starter is 0, marked out — not his projection', () => {
    const out = priceStarterProjections([league('A', ppr, ['p1'])], rows, new Set(['p1']))
    expect(out.get('A:p1')).toEqual({ projected: 0, out: true })
  })

  it('no league rules: no number at all, never a generic PPR stand-in', () => {
    const out = priceStarterProjections([league('A', { name: 'no rules here' }, ['p1'])], rows, new Set())
    expect(out.has('A:p1')).toBe(false)
  })

  it('a starter with no row stays unpriced', () => {
    const out = priceStarterProjections([league('A', ppr, ['p2'])], rows, new Set())
    expect(out.has('A:p2')).toBe(false)
  })

  it('only this league-week counts, and the newest row wins', () => {
    const older = row('p1', { rec: 1 }, { fetchedAt: new Date('2026-10-10T00:00:00Z') })
    const newer = row('p1', { rec: 4 }, { fetchedAt: new Date('2026-10-11T09:00:00Z') })
    const lastWeek = row('p1', { rec: 9 }, { week: 4, fetchedAt: new Date('2026-10-12T00:00:00Z') })
    const out = priceStarterProjections([league('A', ppr, ['p1'])], [newer, lastWeek, older], new Set())
    expect(out.get('A:p1')).toEqual({ projected: 4, out: false })
  })
})

describe('formatStarterProjection', () => {
  const group = (leagues: StarterGroup['leagues']): StarterGroup => ({
    playerId: 'p1',
    playerName: 'P One',
    position: 'WR',
    imageUrl: null,
    team: 'ATL',
    leagues,
  })
  const l = (leagueId: string, projected: number | null, projectedOut = false) => ({
    leagueId,
    leagueName: leagueId,
    points: 0,
    projected,
    projectedOut,
  })

  it('a range across leagues, a single value when they agree', () => {
    expect(formatStarterProjection(group([l('A', 13), l('B', 10)]), null)).toBe('proj 10.0–13.0')
    expect(formatStarterProjection(group([l('A', 13), l('B', 13)]), null)).toBe('proj 13.0')
  })
  it('the held league’s own number', () => {
    expect(formatStarterProjection(group([l('A', 13), l('B', 10)]), 'B')).toBe('proj 10.0')
  })
  it('"out" only when out everywhere; a dash when nothing priced — never "proj 0.0"', () => {
    expect(formatStarterProjection(group([l('A', 0, true), l('B', 0, true)]), null)).toBe('out')
    expect(formatStarterProjection(group([l('A', 0, true), l('B', 9)]), null)).toBe('proj 9.0')
    expect(formatStarterProjection(group([l('A', null), l('B', null)]), null)).toBe('—')
    expect(formatLeagueProjection(l('A', null))).toBe('—')
    expect(formatLeagueProjection(l('A', 0, true))).toBe('out')
  })
})

const findMany = vi.fn()
vi.mock('@/lib/prisma', () => ({ prisma: { fantasyProjection: { findMany: (...a: unknown[]) => findMany(...a) } } }))
vi.mock('@/lib/core-app/injuryStatusById', () => ({
  namesBySleeperId: () => new Map(),
  readInjuryStatusById: async () => new Map([['p9', 'Out']]),
}))

describe('loadStarterProjections (the cached read)', () => {
  beforeEach(() => {
    findMany.mockReset()
    findMany.mockResolvedValue([
      { playerId: 'p8', season: '2026', week: 5, stats: { stats: { rec: 2 } }, fetchedAt: new Date() },
    ])
  })

  it('reads nothing when no starter has a game still to start', async () => {
    const { loadStarterProjections } = await import('@/lib/live/starterProjections')
    const out = await loadStarterProjections({ leagues: [league('A', ppr, [])], identities: [] })
    expect(out.size).toBe(0)
    expect(findMany).not.toHaveBeenCalled()
  })

  it('prices, applies injuries, and serves the same question from cache on the next poll', async () => {
    const { loadStarterProjections } = await import('@/lib/live/starterProjections')
    const input = { leagues: [league('Z', ppr, ['p8', 'p9'])], identities: [] }
    const first = await loadStarterProjections(input)
    expect(first.get('Z:p8')).toEqual({ projected: 2, out: false })
    expect(first.get('Z:p9')).toEqual({ projected: 0, out: true })
    await loadStarterProjections(input)
    expect(findMany).toHaveBeenCalledTimes(1)
    expect(findMany.mock.calls[0]![0]).toMatchObject({
      where: { sport: 'NFL', playerId: { in: ['p8', 'p9'] }, season: { in: ['2026'] }, week: { in: [5] }, source: { not: 'allfantasy' } },
    })
  })
})
