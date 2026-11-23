// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  leagues: {} as Record<string, { id: string; name: string; platform: string; sport: string; settings: Record<string, unknown> }>,
  access: new Set<string>(),
  resolve: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findUnique: vi.fn(async (q: { where: { id: string } }) => h.leagues[q.where.id] ?? null),
      findMany: vi.fn(async (q: { where: { id: { in: string[] } } }) => q.where.id.in.map((id) => h.leagues[id]).filter(Boolean)),
    },
  },
}))
vi.mock('@/lib/league-access', () => ({ resolveLeagueAccess: vi.fn(async (id: string) => (h.access.has(id) ? { id } : null)) }))
vi.mock('@/lib/league/collegePro/leaguePair', () => ({ resolveCollegeProPair: h.resolve }))

import { loadCollegeProPairLink } from '@/lib/league/collegePro/pairLink'
import { isCollegeProLeague } from '@/lib/league/collegePro/format'

const pair = (role: 'pro' | 'college', otherLeagueId: string) => ({ collegeProPair: { role, otherLeagueId, linkedByUserId: 'commish', linkedAt: '2026-11-22' } })

beforeEach(() => {
  h.resolve.mockReset().mockResolvedValue(null)
  h.access = new Set(['peach', 'cream'])
  h.leagues = {
    peach: { id: 'peach', name: 'Peach Bowl (C2C)', platform: 'sleeper', sport: 'NFL', settings: pair('pro', 'cream') },
    cream: { id: 'cream', name: 'Cream Bowl', platform: 'fantrax', sport: 'NCAAF', settings: pair('college', 'peach') },
    rtgFb: { id: 'rtgFb', name: 'Road To Glory NCAA Football ', platform: 'fantrax', sport: 'NCAAF', settings: {} },
    rtgNfl: { id: 'rtgNfl', name: 'Road To Glory NFL', platform: 'fantrax', sport: 'NFL', settings: {} },
  }
})

describe('the league this one is paired with', () => {
  it('reads the league-wide record and names both halves', async () => {
    expect(await loadCollegeProPairLink('peach', 'connor')).toEqual({
      applies: true,
      role: 'pro',
      self: { leagueId: 'peach', name: 'Peach Bowl (C2C)', platform: 'sleeper', sport: 'NFL', label: 'NFL', canOpen: true },
      other: { leagueId: 'cream', name: 'Cream Bowl', platform: 'fantrax', sport: 'NCAAF', label: 'College', canOpen: true },
    })
    expect(h.resolve).not.toHaveBeenCalled()
  })

  it('does not link a half the viewer cannot open, but still names it', async () => {
    h.access.delete('cream')
    const link = await loadCollegeProPairLink('peach', 'connor')
    expect(link.applies && link.other).toMatchObject({ name: 'Cream Bowl', canOpen: false })
  })

  it('a pair kept only on the linker’s franchise link is found through it', async () => {
    h.resolve.mockResolvedValue({ viewingRole: 'college', sides: [{ leagueId: 'rtgFb' }, { leagueId: 'rtgNfl' }] })
    const link = await loadCollegeProPairLink('rtgFb', 'commish')
    expect(link).toMatchObject({ applies: true, role: 'college', self: { name: 'Road To Glory NCAA Football' }, other: { leagueId: 'rtgNfl', label: 'NFL' } })
  })

  it('a league in no pair has no link', async () => {
    expect(await loadCollegeProPairLink('rtgFb', 'stranger')).toEqual({ applies: false })
  })
})

describe('isCollegeProLeague', () => {
  it('is true for a C2C or Devy type, or for any half of a recorded pair', () => {
    expect(isCollegeProLeague({ leagueType: 'c2c' })).toBe(true)
    expect(isCollegeProLeague({ leagueType: 'devy_dynasty' })).toBe(true)
    expect(isCollegeProLeague({ leagueType: 'dynasty', settings: pair('college', 'x') })).toBe(true)
    expect(isCollegeProLeague({ leagueType: 'dynasty', settings: {} })).toBe(false)
    expect(isCollegeProLeague({ leagueType: 'redraft' })).toBe(false)
  })
})
