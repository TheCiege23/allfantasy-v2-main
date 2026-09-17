// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({ rows: [] as Array<{ cacheKey: string; data: unknown }>, upsert: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: { sportsDataCache: { findMany: vi.fn(async () => h.rows), upsert: h.upsert } },
}))

import {
  computeLeagueSim,
  leagueSimCacheKey,
  leagueSimHash,
  MODEL_VERSION,
  readLeagueSimStamps,
  readLeagueSims,
  writeLeagueSimMarker,
  writeLeagueSims,
} from '@/lib/core-app/seasonOutlookSims'
import type { SimInput } from '@/lib/core-app/outlookSim'

const SIM: SimInput = {
  teams: ['a', 'b', 'c', 'd'].map((id, i) => ({ rosterId: id, wins: i, losses: 3 - i, pointsFor: 300 + i, profile: { mu: 100 + i, sigma: 15, n: 20 } })),
  remaining: [
    { week: 5, a: 'a', b: 'b' },
    { week: 5, a: 'c', b: 'd' },
  ],
  playoffTeams: 2,
  byeTeams: 0,
}

beforeEach(() => {
  h.rows = []
  h.upsert.mockReset().mockResolvedValue({})
})

describe('leagueSimHash', () => {
  it('ignores ordering but not content', () => {
    const shuffled: SimInput = { ...SIM, teams: [...SIM.teams].reverse(), remaining: [...SIM.remaining].reverse() }
    expect(leagueSimHash(shuffled, 1)).toBe(leagueSimHash(SIM, 1))
    const scored: SimInput = { ...SIM, teams: SIM.teams.map((t) => (t.rosterId === 'a' ? { ...t, wins: t.wins + 1 } : t)) }
    expect(leagueSimHash(scored, 1)).not.toBe(leagueSimHash(SIM, 1))
    expect(leagueSimHash({ ...SIM, byeTeams: 1 }, 1)).not.toBe(leagueSimHash(SIM, 1))
    expect(leagueSimHash(SIM, 2)).not.toBe(leagueSimHash(SIM, 1))
  })
})

describe('stored runs', () => {
  it('stores one row per league, and reads back only the current model version', async () => {
    const run = computeLeagueSim(SIM, 1, 300)
    expect(run.model).toBe(MODEL_VERSION)
    await writeLeagueSims([['p1', run]])
    expect(h.upsert.mock.calls[0][0].where.cacheKey).toBe(leagueSimCacheKey('p1'))

    h.rows = [
      { cacheKey: leagueSimCacheKey('p1'), data: run },
      { cacheKey: leagueSimCacheKey('p2'), data: { ...run, model: MODEL_VERSION - 1 } },
      { cacheKey: leagueSimCacheKey('p3'), data: { junk: true } },
    ]
    const read = await readLeagueSims(['p1', 'p2', 'p3'])
    expect([...read.keys()]).toEqual(['p1'])
  })

  it('🛑 a marker is never served as a run, but its check time is read', async () => {
    await writeLeagueSimMarker('p9', 'unsimulated')
    const marker = h.upsert.mock.calls[0][0].create.data
    expect(marker).toMatchObject({ model: MODEL_VERSION, marker: 'unsimulated' })
    h.rows = [
      { cacheKey: leagueSimCacheKey('p9'), data: marker },
      { cacheKey: leagueSimCacheKey('p1'), data: computeLeagueSim(SIM, 1, 100) },
    ]
    expect([...(await readLeagueSims(['p9', 'p1'])).keys()]).toEqual(['p1'])
    const stamps = await readLeagueSimStamps(['p9', 'p1'])
    expect(stamps.get('p9')).toBe(Date.parse(marker.checkedAt))
    expect(stamps.has('p1')).toBe(true)
  })

  it('never throws on a failed write', async () => {
    h.upsert.mockRejectedValue(new Error('db down'))
    await expect(writeLeagueSims([['p1', computeLeagueSim(SIM, 1, 100)]])).resolves.toBe(0)
  })
})
