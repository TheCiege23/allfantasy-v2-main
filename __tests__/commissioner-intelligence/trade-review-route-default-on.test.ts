import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The commissioner trade-review panel is ON by default (owner, 2026-10-26: switch it on across the
 * site). `COMMISSIONER_TRADE_REVIEW_ENABLED=false` stays as the kill switch.
 */
const h = vi.hoisted(() => ({ session: vi.fn(), assert: vi.fn(), provider: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: h.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/commissioner/permissions', () => ({ assertCommissioner: h.assert }))
vi.mock('@/lib/decision-os/commissioner-intelligence/trade-review', () => ({ createLiveTradeReviewDataProvider: h.provider }))

import { GET } from '@/app/api/app/leagues/[leagueId]/commissioner/trade-review/route'

const call = () => GET({} as never, { params: Promise.resolve({ leagueId: 'L1' }) })
const original = process.env.COMMISSIONER_TRADE_REVIEW_ENABLED

beforeEach(() => {
  vi.resetAllMocks()
  h.session.mockResolvedValue(null)
})
afterEach(() => {
  if (original === undefined) delete process.env.COMMISSIONER_TRADE_REVIEW_ENABLED
  else process.env.COMMISSIONER_TRADE_REVIEW_ENABLED = original
})

describe('commissioner trade-review route switch', () => {
  it('is on when the variable is unset: the request reaches the auth check', async () => {
    delete process.env.COMMISSIONER_TRADE_REVIEW_ENABLED
    const res = await call()
    expect(res.status).toBe(401)
    expect(h.session).toHaveBeenCalled()
  })

  it('is on when the variable is "true"', async () => {
    process.env.COMMISSIONER_TRADE_REVIEW_ENABLED = 'true'
    expect((await call()).status).toBe(401)
  })

  it('"false" switches it off and nothing is read', async () => {
    process.env.COMMISSIONER_TRADE_REVIEW_ENABLED = 'false'
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ enabled: false })
    expect(h.session).not.toHaveBeenCalled()
  })
})
