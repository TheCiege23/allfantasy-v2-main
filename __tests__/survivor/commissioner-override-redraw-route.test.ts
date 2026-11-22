/**
 * /api/survivor/commissioner: `override_tribal` runs the full override (lib/survivor/survivorTribalOverride.ts)
 * and passes its refusals through; `rebalance` / `redraw_tribes` use the current redraw (runShuffle), not the
 * legacy tribeEngine.rebalanceTribes that moved only SurvivorTribeMember rows; GET ?type=tribal_override
 * returns the form's target.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  db: { survivorCommissionerAction: { create: vi.fn(async () => ({})), findMany: vi.fn(async () => []) } },
  override: vi.fn(),
  target: vi.fn(),
  shuffle: vi.fn(),
  legacyRebalance: vi.fn(),
}))
vi.mock('next-auth', () => ({ getServerSession: async () => ({ user: { id: 'commish' } }) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: h.db }))
vi.mock('@/lib/league/permissions', () => ({ requireCommissionerRole: async () => undefined }))
vi.mock('@/lib/survivor/survivorHostGuard', () => ({ survivorHostGuard: async () => null }))
vi.mock('@/lib/survivor/gameStateMachine', () => ({ advancePhase: vi.fn() }))
vi.mock('@/lib/survivor/exileEngine', () => ({ processReturnFromExile: vi.fn() }))
vi.mock('@/lib/survivor/tribeEngine', () => ({ rebalanceTribes: h.legacyRebalance }))
vi.mock('@/lib/survivor/SurvivorTribeShuffleEngine', () => ({ runShuffle: h.shuffle }))
vi.mock('@/lib/survivor/survivorTribalOverride', () => ({ overrideTribalResult: h.override, readTribalOverrideTarget: h.target }))
vi.mock('@/lib/survivor/SurvivorLeagueConfig', () => ({ getSurvivorConfig: vi.fn() }))
vi.mock('@/lib/survivor/notificationEngine', () => ({ enqueueNotification: vi.fn() }))
vi.mock('@/lib/redraft/voidPendingTradesForElimination', () => ({ voidPendingRedraftTradesForRoster: vi.fn(async () => undefined) }))
vi.mock('@/lib/survivor/survivorCouncilPause', () => ({ setCouncilPaused: vi.fn() }))
vi.mock('@/lib/survivor/SurvivorSitOutEngine', () => ({ maybeTriggerSurvivorTribeShuffleRecommendation: vi.fn() }))

import { GET, POST } from '@/app/api/survivor/commissioner/route'

const post = (body: object) => POST(new Request('https://example.test/api/survivor/commissioner', { method: 'POST', body: JSON.stringify({ leagueId: 'L1', ...body }) }) as never)

beforeEach(() => vi.clearAllMocks())

describe('override_tribal', () => {
  it('runs the full override and returns its outcome', async () => {
    h.override.mockResolvedValueOnce({ ok: true, councilId: 'c1', reinstatedUserId: 'u-wrong', eliminatedUserId: 'u-right', restoredPlayerIds: ['p'], claimedElsewherePlayerIds: [], eliminationApplied: true })
    const res = await post({ action: 'override_tribal', councilId: 'c1', eliminateUserId: 'u-right', notes: 'fix' })
    expect(res.status).toBe(200)
    expect(h.override).toHaveBeenCalledWith({ leagueId: 'L1', councilId: 'c1', eliminateUserId: 'u-right', actorUserId: 'commish', notes: 'fix' })
    expect(await res.json()).toMatchObject({ reinstatedUserId: 'u-wrong', restoredPlayerIds: ['p'] })
    expect(h.db.survivorCommissionerAction.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ actionType: 'override_tribal', targetUserId: 'u-right' }) }))
  })

  it('passes a refusal through with its status and code, logging nothing', async () => {
    h.override.mockResolvedValueOnce({ ok: false, status: 409, code: 'not_latest', error: 'Only the most recent Tribal Council can be changed.' })
    const res = await post({ action: 'override_tribal', councilId: 'c0', eliminateUserId: 'u-right' })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Only the most recent Tribal Council can be changed.', code: 'not_latest' })
    expect(h.db.survivorCommissionerAction.create).not.toHaveBeenCalled()
  })

  it('needs a council and a manager', async () => {
    expect((await post({ action: 'override_tribal', councilId: 'c1' })).status).toBe(400)
    expect(h.override).not.toHaveBeenCalled()
  })
})

describe('redrawing the tribes', () => {
  it.each(['rebalance', 'redraw_tribes'])('%s uses the current redraw, never the legacy rebalance', async (action) => {
    h.shuffle.mockResolvedValueOnce({ ok: true, tribes: [{}, {}] })
    const res = await post({ action })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, tribeCount: 2 })
    expect(h.shuffle).toHaveBeenCalledWith('L1', { actorUserId: 'commish' })
    expect(h.legacyRebalance).not.toHaveBeenCalled()
  })

  it('a redraw that cannot run says why', async () => {
    h.shuffle.mockResolvedValueOnce({ ok: false, error: 'A redraw is available only between councils before the merge.' })
    const res = await post({ action: 'redraw_tribes' })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'A redraw is available only between councils before the merge.' })
  })
})

describe('GET ?type=tribal_override', () => {
  it('returns the latest council the form can change', async () => {
    h.target.mockResolvedValueOnce({ councilId: 'c1', week: 4, eliminatedUserId: 'u', eliminatedName: 'U', resolved: true, candidates: [] })
    const res = await GET({ nextUrl: new URL('https://example.test/api/survivor/commissioner?leagueId=L1&type=tribal_override') } as never)
    expect(await res.json()).toEqual({ target: { councilId: 'c1', week: 4, eliminatedUserId: 'u', eliminatedName: 'U', resolved: true, candidates: [] } })
  })
})
