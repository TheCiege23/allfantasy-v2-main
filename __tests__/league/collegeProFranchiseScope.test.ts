// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

const pair = (role: 'pro' | 'college', otherLeagueId: string) => ({ collegeProPair: { role, otherLeagueId, linkedByUserId: 'commish', linkedAt: '' } })
const LEAGUES: Record<string, { id: string; name: string; settings: Record<string, unknown> }> = {
  peach: { id: 'peach', name: 'Peach Bowl (C2C)', settings: pair('pro', 'cream') },
  cream: { id: 'cream', name: 'Cream Bowl', settings: pair('college', 'peach') },
  rtgNcaab: { id: 'rtgNcaab', name: 'Road To Glory NCAA Basketball', settings: pair('college', 'rtgNba') },
  rtgNba: { id: 'rtgNba', name: 'Road To Glory NBA', settings: pair('pro', 'rtgNcaab') },
  solo: { id: 'solo', name: 'Road to glory', settings: {} },
}
const findMany = vi.hoisted(() => vi.fn())

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findUnique: vi.fn(async (q: { where: { id: string } }) => LEAGUES[q.where.id] ?? null),
      findMany: findMany.mockImplementation(async (q: { where: { id: { in: string[] } } }) => q.where.id.in.map((id) => LEAGUES[id]).filter(Boolean)),
    },
  },
}))

import { franchiseLeagueIds, franchiseTagsFor } from '@/lib/league/collegePro/franchiseScope'

describe('a paired college + pro league as one franchise', () => {
  it('a league scope covers both halves, and an unpaired league only itself', async () => {
    expect(await franchiseLeagueIds('cream')).toEqual(['cream', 'peach'])
    expect(await franchiseLeagueIds('solo')).toEqual(['solo'])
  })

  it('tags both halves with one franchise, keyed by the pro half and named pro first', async () => {
    const tags = await franchiseTagsFor(['cream', 'solo', 'peach', 'rtgNcaab'])
    expect(tags.get('peach')).toEqual({ franchiseId: 'peach', franchiseName: 'Peach Bowl (C2C) + Cream Bowl' })
    expect(tags.get('cream')).toEqual(tags.get('peach'))
    expect(tags.has('solo')).toBe(false)
    // Only the college half had a notice: the pro half's name is read separately, once.
    expect(tags.get('rtgNcaab')).toEqual({ franchiseId: 'rtgNba', franchiseName: 'Road To Glory NBA + Road To Glory NCAA Basketball' })
  })

  it('no leagues, no query', async () => {
    findMany.mockClear()
    expect((await franchiseTagsFor([])).size).toBe(0)
    expect(findMany).not.toHaveBeenCalled()
  })
})
