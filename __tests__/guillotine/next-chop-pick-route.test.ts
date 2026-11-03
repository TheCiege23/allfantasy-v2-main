// @vitest-environment node
/**
 * POST /api/leagues/[id]/guillotine/summary saves a chopped manager's "Who's next?" pick, and GET
 * carries the viewer's pick state (lib/guillotine/nextChopPickStore.ts).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  session: vi.fn(), access: vi.fn(), isG: vi.fn(), config: vi.fn(), summary: vi.fn(), escapes: vi.fn(),
  week: vi.fn(), roster: vi.fn(), home: vi.fn(), watch: vi.fn(), commish: vi.fn(), load: vi.fn(), save: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: h.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/live-draft-engine/auth', () => ({ canAccessLeagueDraft: h.access }))
vi.mock('@/lib/guillotine/GuillotineLeagueConfig', () => ({ isGuillotineLeague: h.isG, getGuillotineConfig: h.config }))
vi.mock('@/lib/guillotine/GuillotineWeeklySummaryService', () => ({ buildWeeklySummary: h.summary }))
vi.mock('@/lib/share/guillotineEscape', () => ({ getGuillotineEscapesForUser: h.escapes }))
vi.mock('@/lib/league-specialty/guillotineHome', () => ({ buildGuillotineHomeExtras: h.home }))
vi.mock('@/lib/guillotine/guillotineCurrentWeek', () => ({ resolveGuillotineCurrentWeek: h.week, findViewerRosterId: h.roster }))
vi.mock('@/lib/guillotine/chopWatchLoad', () => ({ loadChopWatch: h.watch }))
vi.mock('@/lib/commissioner/permissions', () => ({ isCommissioner: h.commish, assertCommissioner: vi.fn() }))
vi.mock('@/lib/guillotine/guillotineAdvancedSettings', () => ({ readGuillotineAdvanced: vi.fn(async () => null), saveGuillotineAdvanced: vi.fn() }))
vi.mock('@/lib/guillotine/nextChopPickStore', () => ({ loadNextChopPickState: h.load, saveNextChopPick: h.save }))

import { NextRequest } from 'next/server'
import { GET, POST } from '@/app/api/leagues/[leagueId]/guillotine/summary/route'

const params = { params: Promise.resolve({ leagueId: 'lg1' }) }
const post = (body: unknown) =>
  POST(new NextRequest('https://allfantasy.test/api/leagues/lg1/guillotine/summary', { method: 'POST', body: JSON.stringify(body) }), params)
const STATE = { week: 6, canPick: true, myPick: 'c', candidates: [], leaderboard: [], lastResult: null }

beforeEach(() => {
  for (const f of Object.values(h)) f.mockReset()
  h.session.mockResolvedValue({ user: { id: 'u1' } })
  h.access.mockResolvedValue(true)
  h.isG.mockResolvedValue(true)
  h.config.mockResolvedValue(null)
  h.summary.mockResolvedValue({ leagueId: 'lg1', weekOrPeriod: 5, recentChopEvents: [] })
  h.escapes.mockResolvedValue([])
  h.week.mockResolvedValue(5)
  h.roster.mockResolvedValue('r-me')
  h.watch.mockResolvedValue(null)
  h.commish.mockResolvedValue(false)
  h.load.mockResolvedValue(STATE)
})

describe('Who’s next — the route', () => {
  it('GET carries the viewer’s pick state, for their roster', async () => {
    const body = await (await GET(new NextRequest('https://allfantasy.test/api/leagues/lg1/guillotine/summary'), params)).json()
    expect(h.load).toHaveBeenCalledWith('lg1', 'r-me')
    expect(body.nextChopPick).toEqual(STATE)
  })

  it('POST saves the pick for the viewer’s roster and returns the new state', async () => {
    h.save.mockResolvedValue({ ok: true, week: 6 })
    const res = await post({ action: 'next_chop_pick', week: 6, rosterId: 'c' })
    expect(res.status).toBe(200)
    expect(h.save).toHaveBeenCalledWith({ leagueId: 'lg1', viewerRosterId: 'r-me', userId: 'u1', week: 6, pickedRosterId: 'c' })
    expect((await res.json()).nextChopPick).toEqual(STATE)
  })

  it('a refusal comes back with its reason and status', async () => {
    for (const [reason, status] of [['not_chopped', 403], ['closed', 409], ['not_alive', 400]] as const) {
      h.save.mockResolvedValueOnce({ ok: false, reason })
      const res = await post({ action: 'next_chop_pick', week: 6, rosterId: 'c' })
      expect(res.status).toBe(status)
      expect((await res.json()).code).toBe(reason)
    }
  })

  it('a malformed body, a non-member or a signed-out caller never reaches the store', async () => {
    expect((await post({ action: 'something_else', week: 6, rosterId: 'c' })).status).toBe(400)
    expect((await post({ action: 'next_chop_pick', week: 'six', rosterId: 'c' })).status).toBe(400)
    h.access.mockResolvedValue(false)
    expect((await post({ action: 'next_chop_pick', week: 6, rosterId: 'c' })).status).toBe(403)
    h.session.mockResolvedValue(null)
    expect((await post({ action: 'next_chop_pick', week: 6, rosterId: 'c' })).status).toBe(401)
    expect(h.save).not.toHaveBeenCalled()
  })
})
