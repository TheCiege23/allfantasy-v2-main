import { describe, expect, it } from 'vitest'
import { AIAccessResolver } from '@/lib/ai-access/AIAccessResolver'

/**
 * `hasSubscription` means "holds Chimmy chat" (ai_chat). /pricing and the /core plan chip used it as
 * "is this viewer on a plan", so a paying AF Commissioner — no ai_chat — was shown as Free.
 * `hasPlan` is the plan question.
 */
function resolverWith(plans: string[]) {
  const entitlement = {
    resolveForUser: async () => ({
      entitlement: { plans, status: plans.length ? 'active' : 'none', currentPeriodEnd: null, gracePeriodEnd: null },
      hasAccess: plans.includes('pro') || plans.includes('supreme'),
      message: '',
    }),
  }
  const tokens = { getBalance: async () => ({ balance: 0 }) }
  return new AIAccessResolver(entitlement as never, tokens as never)
}

describe('AIAccessResolver.hasPlan', () => {
  it('is true for AF Commissioner even though it does not hold ai_chat', async () => {
    const status = await resolverWith(['commissioner']).resolveForUser({ userId: 'u' })
    expect(status.hasSubscription).toBe(false)
    expect(status.hasPlan).toBe(true)
  })

  it('is true for AF Pro', async () => {
    const status = await resolverWith(['pro']).resolveForUser({ userId: 'u' })
    expect(status.hasSubscription).toBe(true)
    expect(status.hasPlan).toBe(true)
  })

  it('is false with no plan', async () => {
    const status = await resolverWith([]).resolveForUser({ userId: 'u' })
    expect(status.hasPlan).toBe(false)
  })
})
