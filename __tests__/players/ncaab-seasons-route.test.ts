import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockNextRequest } from '@/__tests__/helpers/createMockNextRequest'

/** GET /api/players/ncaab-seasons: signed-in only, a Rolling Insights id only, Postgres only. */

const hm = vi.hoisted(() => ({ getServerSession: vi.fn(), loadNcaabPlayerSeasons: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: hm.getServerSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/players/ncaabPlayerSeasons', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/players/ncaabPlayerSeasons')>()),
  loadNcaabPlayerSeasons: hm.loadNcaabPlayerSeasons,
}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

const get = async (query: string) => {
  const { GET } = await import('@/app/api/players/ncaab-seasons/route')
  return GET(createMockNextRequest(`http://localhost/api/players/ncaab-seasons${query}`) as any)
}

beforeEach(() => {
  vi.clearAllMocks()
  hm.getServerSession.mockResolvedValue({ user: { id: 'user-1' } })
  hm.loadNcaabPlayerSeasons.mockResolvedValue({ seasons: [{ season: 2026 }], games: [] })
})

describe('GET /api/players/ncaab-seasons', () => {
  it('returns the stored seasons for a Rolling Insights id', async () => {
    const res = await get('?playerId=11119')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ seasons: [{ season: 2026 }], games: [] })
    expect(hm.loadNcaabPlayerSeasons).toHaveBeenCalledWith('11119')
  })

  it('refuses a visitor who is not signed in, before any read', async () => {
    hm.getServerSession.mockResolvedValue(null)
    const res = await get('?playerId=11119')
    expect(res.status).toBe(401)
    expect(hm.loadNcaabPlayerSeasons).not.toHaveBeenCalled()
  })

  it('refuses an id that is not a Rolling Insights id', async () => {
    for (const query of ['', '?playerId=', '?playerId=espn:ncaab:1', "?playerId=1%27%20OR%201=1"]) {
      const res = await get(query)
      expect(res.status, query).toBe(400)
    }
    expect(hm.loadNcaabPlayerSeasons).not.toHaveBeenCalled()
  })

  it('answers 500, not an empty season list, when the read fails', async () => {
    hm.loadNcaabPlayerSeasons.mockRejectedValue(new Error('db down'))
    const res = await get('?playerId=11119')
    expect(res.status).toBe(500)
  })
})
