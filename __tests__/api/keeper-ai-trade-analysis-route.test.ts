/**
 * POST /api/keeper/ai/trade-analysis — the keeper surface grades through THE canonical grader.
 *
 * It used to return a hardcoded B/B/"counter" for every trade, then a 501. Every letter, value and
 * withheld reason here must be the one `evaluateStoredTrade` (→ evaluateTrade → gradeDeal) returned.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { requireAfSub, evaluateStoredTrade, recordTradeSurfaceShadow } = vi.hoisted(() => ({
  requireAfSub: vi.fn(),
  evaluateStoredTrade: vi.fn(),
  recordTradeSurfaceShadow: vi.fn(),
}))
vi.mock('@/lib/redraft/ai/requireAfSub', () => ({ requireAfSub }))
vi.mock('@/lib/decision-os/trade/evaluateStoredTrade', () => ({ evaluateStoredTrade }))
vi.mock('@/lib/decision-os/trade/surfaceShadow', () => ({ recordTradeSurfaceShadow }))

import { POST } from '@/app/api/keeper/ai/trade-analysis/route'
import { NO_LEAGUE_REASON } from '@/lib/decision-os/trade/evaluateTrade'

const req = (body: unknown) => ({ json: async () => body }) as unknown as Parameters<typeof POST>[0]

/** A canonical grade no placeholder could produce by accident: D for the viewer, B for the partner. */
const CANONICAL = {
  graded: true as const,
  letter: 'D' as const,
  partnerLetter: 'B' as const,
  percentDiff: -17,
  giveValue: 4321,
  getValue: 3587,
  basis: 'Keeper · 12 teams · PPR',
}
const receiptWith = (grade: unknown) => ({ grade, partnerGrade: { graded: false, reason: 'mirror', basis: null } })

beforeEach(() => {
  requireAfSub.mockReset().mockResolvedValue('user-1')
  evaluateStoredTrade.mockReset()
  recordTradeSurfaceShadow.mockReset()
})

describe('POST /api/keeper/ai/trade-analysis', () => {
  it('returns the entitlement gate response untouched, and grades nothing', async () => {
    requireAfSub.mockResolvedValue(new Response(null, { status: 402 }))
    expect((await POST(req({ leagueId: 'L1', tradeId: 'T1' }))).status).toBe(402)
    expect(evaluateStoredTrade).not.toHaveBeenCalled()
  })

  it('the letter, values and basis are EXACTLY the canonical grade (no hardcoded B/B)', async () => {
    evaluateStoredTrade.mockResolvedValue({ ok: true, receipt: receiptWith(CANONICAL), perspectiveTeamId: 'r1', viewerInTrade: true })
    const res = await POST(req({ leagueId: 'L1', trade: { kind: 'af', tradeId: 'T1' } }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('graded')
    expect(body.grade).toEqual(CANONICAL)
    expect(body.grade.letter).toBe('D')
    expect(body.grade.partnerLetter).toBe('B')
    expect(evaluateStoredTrade).toHaveBeenCalledWith(
      expect.objectContaining({ leagueId: 'L1', ref: { kind: 'af', tradeId: 'T1' }, userId: 'user-1', surface: 'keeper-ai-trade-analysis' }),
    )
    expect(recordTradeSurfaceShadow).toHaveBeenCalledWith(expect.objectContaining({ surface: 'keeper', surfaceVerdict: 'D', surfaceAnalysisMode: 'canonical' }))
  })

  it('a legacy { tradeId } body is an AllFantasy-native trade reference', async () => {
    evaluateStoredTrade.mockResolvedValue({ ok: true, receipt: receiptWith(CANONICAL), perspectiveTeamId: 'r1', viewerInTrade: true })
    await POST(req({ leagueId: 'L1', tradeId: 'T9' }))
    expect(evaluateStoredTrade).toHaveBeenCalledWith(expect.objectContaining({ ref: { kind: 'af', tradeId: 'T9' } }))
  })

  it('a WITHHELD canonical grade stays withheld, with the grader’s own reason and no letter', async () => {
    const withheld = { graded: false, reason: 'A verified keeper cost is missing for Bijan Robinson.', basis: null }
    evaluateStoredTrade.mockResolvedValue({ ok: true, receipt: receiptWith(withheld), perspectiveTeamId: 'r1', viewerInTrade: true })
    const body = await (await POST(req({ leagueId: 'L1', tradeId: 'T1' }))).json()
    expect(body).toMatchObject({ available: false, status: 'withheld', reason: withheld.reason, grade: withheld })
    expect(JSON.stringify(body.grade)).not.toMatch(/"letter"/)
  })

  it('no league context → an honest withheld state, and the grader is never asked', async () => {
    const res = await POST(req({ tradeId: 'T1' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ available: false, status: 'withheld', reason: NO_LEAGUE_REASON, grade: null })
    expect(evaluateStoredTrade).not.toHaveBeenCalled()
  })

  it('400 without any trade reference', async () => {
    expect((await POST(req({ leagueId: 'L1' }))).status).toBe(400)
    expect(evaluateStoredTrade).not.toHaveBeenCalled()
  })

  it.each([
    ['not_member', 403],
    ['not_found', 404],
    ['asset_moved', 200],
  ])('refusal %s → %i, with the refusal reason and no grade', async (code, status) => {
    evaluateStoredTrade.mockResolvedValue({ ok: false, refusal: { code, reason: 'why', missingAssets: [] } })
    const res = await POST(req({ leagueId: 'L1', tradeId: 'T1' }))
    expect(res.status).toBe(status)
    expect(await res.json()).toMatchObject({ available: false, status: 'refused', reason: 'why', grade: null })
  })
})
