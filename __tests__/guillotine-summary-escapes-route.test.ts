// @vitest-environment node
/**
 * The guillotine summary route carries YOUR escapes (shareable moments, 2026-09-14) — for the
 * signed-in member only, and a failed escape read never fails the summary.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ session: vi.fn(), access: vi.fn(), isG: vi.fn(), config: vi.fn(), summary: vi.fn(), escapes: vi.fn(), week: vi.fn(), roster: vi.fn() }))

vi.mock('next-auth', () => ({ getServerSession: h.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/live-draft-engine/auth', () => ({ canAccessLeagueDraft: h.access }))
vi.mock('@/lib/guillotine/GuillotineLeagueConfig', () => ({ isGuillotineLeague: h.isG, getGuillotineConfig: h.config }))
vi.mock('@/lib/guillotine/GuillotineWeeklySummaryService', () => ({ buildWeeklySummary: h.summary }))
vi.mock('@/lib/share/guillotineEscape', () => ({ getGuillotineEscapesForUser: h.escapes }))
// The route now resolves the current week and the viewer's roster (2026-10-13); never reach a real DB.
vi.mock('@/lib/guillotine/guillotineCurrentWeek', () => ({ resolveGuillotineCurrentWeek: h.week, findViewerRosterId: h.roster }))

import { NextRequest } from 'next/server'
import { GET } from '@/app/api/leagues/[leagueId]/guillotine/summary/route'

const call = (query = '?week=5') =>
  GET(new NextRequest(`https://allfantasy.test/api/leagues/lg1/guillotine/summary${query}`), { params: Promise.resolve({ leagueId: 'lg1' }) })

beforeEach(() => {
  for (const f of Object.values(h)) f.mockReset()
  h.session.mockResolvedValue({ user: { id: 'u1' } })
  h.access.mockResolvedValue(true)
  h.isG.mockResolvedValue(true)
  h.config.mockResolvedValue(null)
  h.summary.mockResolvedValue({ leagueId: 'lg1', weekOrPeriod: 5, recentChopEvents: [] })
  h.week.mockResolvedValue(7)
  h.roster.mockResolvedValue('roster-me')
})

describe('GET /api/leagues/[leagueId]/guillotine/summary — myEscapes', () => {
  it('🛑 includes the signed-in user’s escapes', async () => {
    const escapes = [{ weekOrPeriod: 4, myPoints: 93.5, chopLine: 90.3, margin: 3.2, choppedCount: 1 }]
    h.escapes.mockResolvedValue(escapes)
    const res = await call()
    expect(res.status).toBe(200)
    expect((await res.json()).myEscapes).toEqual(escapes)
    expect(h.escapes).toHaveBeenCalledWith('lg1', 'u1')
  })

  it('🛑 a failed escape read is none — the summary still returns', async () => {
    h.escapes.mockRejectedValue(new Error('db'))
    const res = await call()
    expect(res.status).toBe(200)
    expect((await res.json()).myEscapes).toEqual([])
  })

  it('no escape read for a non-member or a signed-out caller', async () => {
    h.access.mockResolvedValue(false)
    expect((await call()).status).toBe(403)
    h.session.mockResolvedValue(null)
    expect((await call()).status).toBe(401)
    expect(h.escapes).not.toHaveBeenCalled()
  })
})

describe('GET /api/leagues/[leagueId]/guillotine/summary — the current week and your roster (2026-10-13)', () => {
  beforeEach(() => h.escapes.mockResolvedValue([]))

  it('🛑 no ?week= means the CURRENT week, not week 1', async () => {
    h.config.mockResolvedValue({ eliminationStartWeek: 3 })
    await call('')
    expect(h.week).toHaveBeenCalledWith('lg1', { eliminationStartWeek: 3 })
    expect(h.summary).toHaveBeenCalledWith(expect.objectContaining({ weekOrPeriod: 7 }))
  })

  it('an explicit ?week= still wins, without resolving', async () => {
    await call('?week=5')
    expect(h.week).not.toHaveBeenCalled()
    expect(h.summary).toHaveBeenCalledWith(expect.objectContaining({ weekOrPeriod: 5 }))
  })

  it("carries the viewer's roster id, and a failed lookup is just null", async () => {
    expect((await (await call()).json()).myRosterId).toBe('roster-me')
    expect(h.roster).toHaveBeenCalledWith('lg1', 'u1')
    h.roster.mockRejectedValue(new Error('db'))
    const res = await call()
    expect(res.status).toBe(200)
    expect((await res.json()).myRosterId).toBeNull()
  })
})
