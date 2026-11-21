import { beforeEach, describe, expect, it, vi } from 'vitest'
import { carryAfOwnedLeagueSettings } from '@/lib/league/afOwnedLeagueSettings'
import { combinedTotal, readCollegeProScoring } from '@/lib/league/collegePro/format'

const h = vi.hoisted(() => ({
  session: { user: { id: 'commish' } } as { user?: { id?: string } } | null,
  league: null as Record<string, unknown> | null,
  update: vi.fn(async () => ({})),
}))

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => h.session) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { update: h.update } } }))
vi.mock('@/lib/commissioner/permissions', () => ({
  assertCommissioner: vi.fn(async (_leagueId: string, userId: string) => {
    if (userId !== 'commish' || !h.league) throw Object.assign(new Error('Forbidden'), { status: 403 })
    return { league: h.league }
  }),
}))
vi.mock('@/lib/league/collegePro/loadCollegeProRoster', () => ({ loadCollegeProRoster: vi.fn() }))

import { POST } from '@/app/api/league/college-pro-roster/route'

const post = (body: unknown) =>
  POST(new Request('http://x/api/league/college-pro-roster', { method: 'POST', body: JSON.stringify(body) }) as never)

beforeEach(() => {
  h.session = { user: { id: 'commish' } }
  h.league = { id: 'peach', leagueType: 'c2c', leagueVariant: null, settings: { scoring_settings: { rec: 1 }, inviteCode: 'abc' } }
  h.update.mockClear()
})

describe('college + pro scoring setting', () => {
  it('defaults to separate, the owner decision', () => {
    expect(readCollegeProScoring(null)).toBe('separate')
    expect(readCollegeProScoring({})).toBe('separate')
    expect(readCollegeProScoring({ collegeProScoring: 'nonsense' })).toBe('separate')
    expect(readCollegeProScoring({ collegeProScoring: 'combined' })).toBe('combined')
  })

  it('combines the two halves, and says null only when neither has scored', () => {
    expect(combinedTotal(93.56, 111.8)).toBe(205.36)
    expect(combinedTotal(93.56, null)).toBe(93.56)
    expect(combinedTotal(null, null)).toBeNull()
  })

  it('survives a re-import from Sleeper', () => {
    const kept = carryAfOwnedLeagueSettings({ collegeProScoring: 'combined', scoring_settings: { rec: 1 } }, { scoring_settings: { rec: 0.5 } })
    expect(kept.collegeProScoring).toBe('combined')
    expect(kept.scoring_settings).toEqual({ rec: 0.5 })
  })
})

describe('POST /api/league/college-pro-roster', () => {
  it('lets the commissioner switch to combined, merging into the existing settings', async () => {
    const res = await post({ leagueId: 'peach', scoring: 'combined' })
    expect(res.status).toBe(200)
    expect(h.update).toHaveBeenCalledWith({
      where: { id: 'peach' },
      data: { settings: { scoring_settings: { rec: 1 }, inviteCode: 'abc', collegeProScoring: 'combined' } },
    })
  })

  it('refuses anyone who is not the commissioner, and writes nothing', async () => {
    h.session = { user: { id: 'manager' } }
    const res = await post({ leagueId: 'peach', scoring: 'combined' })
    expect(res.status).toBe(403)
    expect(h.update).not.toHaveBeenCalled()
  })

  it('refuses an unknown mode and a league that is not C2C or Devy', async () => {
    expect((await post({ leagueId: 'peach', scoring: 'weighted' })).status).toBe(400)
    h.league = { id: 'redraft', leagueType: 'redraft', settings: {} }
    expect((await post({ leagueId: 'redraft', scoring: 'combined' })).status).toBe(400)
    expect(h.update).not.toHaveBeenCalled()
  })

  it('requires a signed-in user', async () => {
    h.session = null
    expect((await post({ leagueId: 'peach', scoring: 'combined' })).status).toBe(401)
  })
})
