// @vitest-environment node
/**
 * The route half of Chimmy's written recap: GET `?view=recap` carries the writeup view next to the
 * recap, and POST maps each refusal to its status — 402 for a commissioner without AF Commissioner.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  session: vi.fn(),
  access: vi.fn(),
  recap: vi.fn(),
  view: vi.fn(),
  generate: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: h.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/league-access', () => ({ resolveLeagueAccess: h.access }))
vi.mock('@/lib/season-recap/seasonRecapService', () => ({ getSeasonRecap: h.recap }))
vi.mock('@/lib/season-recap/seasonRecapAiService', () => ({ seasonRecapWriteupView: h.view, generateSeasonRecapWriteup: h.generate }))

import { GET, POST } from '@/app/api/league/[leagueId]/season-history/route'

const LEAGUE = 'lg-route-801'
const ctx = { params: Promise.resolve({ leagueId: LEAGUE }) }
const post = (body: unknown) => new Request(`https://allfantasy.test/api/league/${LEAGUE}/season-history`, { method: 'POST', body: JSON.stringify(body) })

beforeEach(() => {
  vi.clearAllMocks()
  h.session.mockResolvedValue({ user: { id: 'usr-route-802' } })
  h.access.mockResolvedValue({ isMember: true })
})

describe('season-history: the written recap', () => {
  it('GET ?view=recap returns the writeup view for this viewer and language', async () => {
    h.recap.mockResolvedValue({ recap: { season: 2026 }, stored: true })
    h.view.mockResolvedValue({ writeup: null, isCommissioner: true, entitled: false, upgradePath: '/pricing' })
    const res = await GET(new Request(`https://allfantasy.test/api/league/${LEAGUE}/season-history?season=2026&view=recap&lang=es`), ctx)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ stored: true, writeup: { isCommissioner: true, entitled: false } })
    expect(h.view).toHaveBeenCalledWith(LEAGUE, 2026, { season: 2026 }, 'usr-route-802', 'es')
  })

  it('POST by a commissioner without the plan is a 402 with the upgrade path', async () => {
    h.generate.mockResolvedValue({ ok: false, error: 'not_entitled', upgradePath: '/pricing' })
    const res = await POST(post({ season: 2026 }), ctx)
    expect(res.status).toBe(402)
    expect(await res.json()).toEqual({ ok: false, error: 'not_entitled', upgradePath: '/pricing' })
    expect(h.generate).toHaveBeenCalledWith({ leagueId: LEAGUE, season: 2026, userId: 'usr-route-802', language: 'en', regenerate: false })
  })

  it('POST maps the other refusals', async () => {
    for (const [error, status] of [['commissioner_only', 403], ['daily_cap', 429], ['fact_guard', 422], ['not_found', 404]] as const) {
      h.generate.mockResolvedValueOnce({ ok: false, error })
      expect((await POST(post({ season: 2026, lang: 'es' }), ctx)).status).toBe(status)
    }
  })

  it('POST signed out is a 401 and reaches nothing', async () => {
    h.session.mockResolvedValue(null)
    expect((await POST(post({ season: 2026 }), ctx)).status).toBe(401)
    expect(h.generate).not.toHaveBeenCalled()
  })
})
