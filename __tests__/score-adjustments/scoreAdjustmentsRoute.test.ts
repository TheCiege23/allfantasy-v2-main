import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('server-only', () => ({}))
const svc = vi.hoisted(() => ({ add: vi.fn(), remove: vi.fn(), week: vi.fn() }))
const commish = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'u1' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique: vi.fn(async () => ({ settings: {} })) } } }))
vi.mock('@/lib/commissioner/permissions', () => ({ assertCommissioner: commish }))
vi.mock('@/lib/score-adjustments/scoreAdjustmentService', () => ({
  ADJUSTMENT_SERVICE_ERROR_TEXT: { not_points: 'points leagues only' },
  addScoreAdjustment: svc.add, removeScoreAdjustment: svc.remove, readAdjustmentWeek: svc.week,
}))

const statCorrections = vi.hoisted(() => vi.fn(async () => ({ covered: true, latest: null })))
const applyCorrections = vi.hoisted(() => vi.fn())
vi.mock('@/lib/stat-corrections/statCorrectionService', () => ({
  readStatCorrections: statCorrections,
  commissionerApplyStatCorrections: applyCorrections,
  APPLY_STAT_CORRECTION_ERROR_TEXT: { not_in_review: 'not in review', not_covered: 'not covered', no_review: 'no review' },
}))

import { GET, POST } from '@/app/api/commissioner/leagues/[leagueId]/operations/route'

const params = { params: Promise.resolve({ leagueId: 'L' }) }
const post = (body: unknown) => POST(new NextRequest('http://x/api', { method: 'POST', body: JSON.stringify(body) }), params)

describe('score adjustments on the commissioner operations route', () => {
  beforeEach(() => { vi.clearAllMocks(); commish.mockResolvedValue(undefined) })

  it('is commissioner-only for both reading and writing', async () => {
    commish.mockRejectedValue(new Error('Forbidden'))
    expect((await GET(new NextRequest('http://x/api?view=score_adjustments'), params)).status).toBe(403)
    expect((await GET(new NextRequest('http://x/api?view=stat_corrections'), params)).status).toBe(403)
    expect(statCorrections).not.toHaveBeenCalled()
    expect((await post({ action: 'stat_correction_apply', matchupId: 'all' })).status).toBe(403)
    expect(applyCorrections).not.toHaveBeenCalled()
    expect((await post({ action: 'score_adjustment_add' })).status).toBe(403)
    expect(svc.add).not.toHaveBeenCalled()
    expect(svc.week).not.toHaveBeenCalled()
  })

  it('adds with the signed-in user as the author, and maps refusals to a status and plain message', async () => {
    svc.add.mockResolvedValueOnce({ ok: true, adjustment: { id: 'a' }, net: -5 })
    const ok = await post({ action: 'score_adjustment_add', matchupId: 'm', rosterId: 'r', points: -5, reason: 'penalty' })
    expect(ok.status).toBe(200)
    expect(svc.add).toHaveBeenCalledWith('L', 'u1', expect.objectContaining({ points: -5 }))
    svc.add.mockResolvedValueOnce({ ok: false, error: 'not_points' })
    const refused = await post({ action: 'score_adjustment_add' })
    expect(refused.status).toBe(409)
    expect(await refused.json()).toEqual({ error: 'points leagues only', code: 'not_points' })
    svc.add.mockResolvedValueOnce({ ok: false, error: 'bad_reason' })
    expect((await post({ action: 'score_adjustment_add' })).status).toBe(400)
  })

  it('removes by id and reads one week', async () => {
    svc.remove.mockResolvedValueOnce({ ok: true, adjustment: { id: 'a' }, net: 0 })
    expect((await post({ action: 'score_adjustment_remove', adjustmentId: 'a' })).status).toBe(200)
    expect(svc.remove).toHaveBeenCalledWith('L', 'u1', 'a')
    svc.week.mockResolvedValueOnce({ week: 3, weeks: [1, 2, 3], scoringMode: 'points', matchups: [], adjustments: [] })
    const res = await GET(new NextRequest('http://x/api?view=score_adjustments&week=3'), params)
    expect(svc.week).toHaveBeenCalledWith('L', '3')
    expect(await res.json()).toMatchObject({ week: 3 })
  })
  it('reads the stat-correction review for the league', async () => {
    const res = await GET(new NextRequest('http://x/api?view=stat_corrections'), params)
    expect(res.status).toBe(200)
    expect(statCorrections).toHaveBeenCalledWith('L')
    expect(await res.json()).toEqual({ covered: true, latest: null })
  })
  it('applies stat corrections only for a named matchup or an explicit all', async () => {
    expect((await post({ action: 'stat_correction_apply' })).status).toBe(400)
    expect(applyCorrections).not.toHaveBeenCalled()

    applyCorrections.mockResolvedValueOnce({ ok: true, week: 7, adjustmentsAdded: 2 })
    const ok = await post({ action: 'stat_correction_apply', matchupId: 'all' })
    expect(ok.status).toBe(200)
    expect(applyCorrections).toHaveBeenCalledWith('L', 'u1', 'all')
    expect(await ok.json()).toEqual({ status: 'ok', week: 7, adjustmentsAdded: 2 })

    applyCorrections.mockResolvedValueOnce({ ok: false, error: 'not_in_review' })
    const missing = await post({ action: 'stat_correction_apply', matchupId: 'm9' })
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({ error: 'not in review', code: 'not_in_review' })

    applyCorrections.mockResolvedValueOnce({ ok: false, error: 'not_points' })
    expect((await post({ action: 'stat_correction_apply', matchupId: 'm1' })).status).toBe(409)
  })
})
