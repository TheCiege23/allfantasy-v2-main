import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The league-free defender board priced on NEXT week from Thursday night to Monday. With no window,
 * `priceIdpBoard` projects "newest stat week + 1", and the newest stat week is partial for half the
 * week — 2026-10-03, a Saturday, week 4 held 144 players (Thursday's game) against ~2,320 in a full
 * week. A league passes its own `current_week`; this board now passes the week being played.
 */

const h = vi.hoisted(() => ({ week: null as { season: string; week: number } | null, throws: false }))

vi.mock('@/lib/idp-projections/leagueIdpVorp', () => ({
  priceIdpBoard: vi.fn(async () => ({ ok: true })),
}))
vi.mock('@/lib/core-app/playerProjections', () => ({
  latestProjectionWeek: vi.fn(async () => {
    if (h.throws) throw new Error('db down')
    return h.week
  }),
}))

const { loadCanonicalDefenderBoard } = await import('@/lib/values/canonicalDefenderBoard')
const { priceIdpBoard } = await import('@/lib/idp-projections/leagueIdpVorp')

const prisma = { sportsPlayer: { findMany: async () => [{ sleeperId: 'lb1' }] } } as never

beforeEach(() => {
  h.week = null
  h.throws = false
  vi.mocked(priceIdpBoard).mockClear()
})

describe('canonical defender board — which week it prices', () => {
  it('passes the week being played (week 4 on a Saturday), not newest-stat-week + 1', async () => {
    h.week = { season: '2026', week: 4 }
    await loadCanonicalDefenderBoard({ prisma })
    expect(vi.mocked(priceIdpBoard).mock.calls[0]![0]).toMatchObject({ projectionWindow: { season: 2026, week: 4 } })
  })

  it('with no week on file, passes no window — the pricer’s old rule, unchanged', async () => {
    await loadCanonicalDefenderBoard({ prisma })
    expect(vi.mocked(priceIdpBoard).mock.calls[0]![0]).not.toHaveProperty('projectionWindow')
  })

  it('a failed week read fails open to the old rule, never throws', async () => {
    h.throws = true
    await expect(loadCanonicalDefenderBoard({ prisma })).resolves.toBeTruthy()
    expect(vi.mocked(priceIdpBoard).mock.calls[0]![0]).not.toHaveProperty('projectionWindow')
  })
})
