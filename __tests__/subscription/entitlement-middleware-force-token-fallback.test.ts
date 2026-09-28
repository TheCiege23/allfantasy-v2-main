import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  evaluate: vi.fn(),
  getBalance: vi.fn(),
  preview: vi.fn(),
  spend: vi.fn(),
}))

vi.mock('@/lib/subscription/FeatureGateService', () => ({
  FeatureGateService: class {
    evaluateUserFeatureAccess = h.evaluate
  },
}))
vi.mock('@/lib/tokens/TokenSpendService', async () => {
  const actual = await vi.importActual<typeof import('@/lib/tokens/TokenSpendService')>('@/lib/tokens/TokenSpendService')
  return {
    ...actual,
    TokenSpendService: class {
      getBalance = h.getBalance
      previewSpendWithEntitlement = h.preview
      spendTokensForRule = h.spend
    },
  }
})

import { requireFeatureEntitlement } from '@/lib/subscription/entitlement-middleware'

/**
 * `forceTokenFallback` — a plan that includes a feature up to an allowance (Chimmy: AF Pro, 100 a
 * day) sends its holder down the token path once the allowance is used. It must change nothing for
 * any caller that does not ask for it.
 */

const ALLOWED = { allowed: true, entitlement: { plans: ['pro'], status: 'active' }, requiredPlan: 'pro', upgradePath: '/pricing' }
const BASE = { userId: 'u1', featureId: 'ai_chat' as const, allowTokenFallback: true, tokenRuleCode: 'ai_chimmy_chat_message' as never }

beforeEach(() => {
  vi.clearAllMocks()
  h.evaluate.mockResolvedValue(ALLOWED)
  h.getBalance.mockResolvedValue({ balance: 50 })
  h.preview.mockResolvedValue({ canSpend: true, tokenCost: 10, ruleCode: 'ai_chimmy_chat_message' })
  h.spend.mockResolvedValue({ id: 'ledger-1', balanceAfter: 40 })
})

describe('requireFeatureEntitlement forceTokenFallback', () => {
  it('lets a plan holder through free by default — unchanged for every existing caller', async () => {
    const out = await requireFeatureEntitlement({ ...BASE, confirmTokenSpend: true })
    expect(out).toMatchObject({ ok: true, tokenSpend: null })
    expect(h.spend).not.toHaveBeenCalled()
  })

  it('asks a plan holder to consent to tokens once forced, exactly as a free account', async () => {
    const out = await requireFeatureEntitlement({ ...BASE, forceTokenFallback: true, confirmTokenSpend: false })
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.response.status).toBe(409)
    await expect(out.response.json()).resolves.toMatchObject({ code: 'token_confirmation_required' })
    expect(h.spend).not.toHaveBeenCalled()
  })

  it('charges the plan holder once they consent', async () => {
    const out = await requireFeatureEntitlement({ ...BASE, forceTokenFallback: true, confirmTokenSpend: true })
    expect(out).toMatchObject({ ok: true, tokenSpend: { id: 'ledger-1' } })
  })

  it('is ignored without allowTokenFallback — never turns an allowed plan into a locked one', async () => {
    const out = await requireFeatureEntitlement({ ...BASE, allowTokenFallback: false, forceTokenFallback: true })
    expect(out).toMatchObject({ ok: true, tokenSpend: null })
  })
})
