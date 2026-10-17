/**
 * POST /api/trades/evaluate — session, validation, and how a refusal maps to an HTTP status.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getServerSession, evaluateStoredTrade } = vi.hoisted(() => ({ getServerSession: vi.fn(), evaluateStoredTrade: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/decision-os/trade/evaluateStoredTrade', () => ({ evaluateStoredTrade }))

import { POST } from '@/app/api/trades/evaluate/route'

const req = (body: unknown) =>
  ({ json: async () => body }) as unknown as Parameters<typeof POST>[0]

let n = 0
beforeEach(() => {
  getServerSession.mockReset()
  // A fresh user per test, so the in-memory rate limit never carries between tests.
  getServerSession.mockResolvedValue({ user: { id: `u-${++n}` } })
  evaluateStoredTrade.mockReset()
})

const BODY = { leagueId: 'L1', trade: { kind: 'af', tradeId: 'T1' } }

describe('POST /api/trades/evaluate', () => {
  it('401 without a session, and nothing is evaluated', async () => {
    getServerSession.mockResolvedValue(null)
    expect((await POST(req(BODY))).status).toBe(401)
    expect(evaluateStoredTrade).not.toHaveBeenCalled()
  })

  it.each([
    [{}],
    [{ leagueId: 'L1' }],
    [{ leagueId: 'L1', trade: { kind: 'provider', provider: 'yahoo', providerTradeId: 'x' } }], // Sleeper only
    [{ leagueId: 'L1', trade: { kind: 'af' } }],
  ])('400 on an invalid body %j', async (body) => {
    expect((await POST(req(body))).status).toBe(400)
    expect(evaluateStoredTrade).not.toHaveBeenCalled()
  })

  it('passes the SESSION user — never one from the body — and returns the receipt', async () => {
    evaluateStoredTrade.mockResolvedValue({ ok: true, receipt: { grade: { graded: true } }, trade: { id: 'T1' }, perspectiveTeamId: 'r1', viewerInTrade: true })
    const res = await POST(req({ ...BODY, userId: 'someone-else' }))
    expect(res.status).toBe(200)
    expect(evaluateStoredTrade).toHaveBeenCalledWith(expect.objectContaining({ leagueId: 'L1', ref: { kind: 'af', tradeId: 'T1' }, userId: `u-${n}` }))
    expect(await res.json()).toMatchObject({ ok: true, perspectiveTeamId: 'r1' })
  })

  it.each([
    ['not_member', 403],
    ['not_party', 403],
    ['not_found', 404],
    ['unresolved_player', 200], // "can't evaluate yet" is an answer, not an error
    ['asset_moved', 200],
  ])('refusal %s → %i', async (code, status) => {
    evaluateStoredTrade.mockResolvedValue({ ok: false, refusal: { code, reason: 'r', missingAssets: [] } })
    const res = await POST(req(BODY))
    expect(res.status).toBe(status)
    expect(await res.json()).toMatchObject({ ok: false, refusal: { code } })
  })
})
