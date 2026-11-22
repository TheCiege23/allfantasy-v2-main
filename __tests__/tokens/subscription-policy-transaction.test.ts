// @vitest-environment node
import { expect, it, vi } from 'vitest'
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/dev-admin/access', () => ({ isSubscriptionEntitlementBypassUserId: () => false }))
import { resolveTokenChargeDecisionForUser } from '@/lib/tokens/subscription-policy'

it('pricing reads entitlements from the supplied transaction without checking out another connection', async () => {
  const subscriptions = vi.fn().mockResolvedValue([]), grants = vi.fn().mockResolvedValue([])
  const db = { userSubscription: { findMany: subscriptions }, adminSubscriptionGrant: { findMany: grants } } as any
  expect(await resolveTokenChargeDecisionForUser({ userId: 'ordinary', ruleCode: 'ai_chimmy_chat_message', baseTokenCost: 3, db })).toMatchObject({ effectiveTokenCost: 3, subscriptionEligible: false })
  expect(subscriptions).toHaveBeenCalledOnce(); expect(grants).toHaveBeenCalledOnce()
})

it('an entitlement read failure cannot silently fall back to charging a normal user', async () => {
  const db = { userSubscription: { findMany: vi.fn().mockRejectedValue(new Error('read unavailable')) },
    adminSubscriptionGrant: { findMany: vi.fn().mockResolvedValue([]) } } as any
  await expect(resolveTokenChargeDecisionForUser({ userId: 'ordinary', ruleCode: 'ai_chimmy_chat_message', baseTokenCost: 3, db })).rejects.toThrow('read unavailable')
})
