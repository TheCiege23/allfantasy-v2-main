import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockNextRequest } from "@/__tests__/helpers/createMockNextRequest"
const getServerSessionMock = vi.hoisted(() => vi.fn())
const userSubscriptionFindFirstMock = vi.hoisted(() => vi.fn())
const tokenLedgerFindFirstMock = vi.hoisted(() => vi.fn())
const entitlementResolveMock = vi.hoisted(() => vi.fn())
const tokenBalanceResolveMock = vi.hoisted(() => vi.fn())
const appUserFindUniqueMock = vi.hoisted(() => vi.fn())

vi.mock('next-auth', () => ({
  getServerSession: getServerSessionMock,
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    userSubscription: {
      findFirst: userSubscriptionFindFirstMock,
    },
    tokenLedger: {
      findFirst: tokenLedgerFindFirstMock,
    },
    appUser: {
      findUnique: appUserFindUniqueMock,
    },
  },
}))

vi.mock('@/lib/subscription/EntitlementResolver', () => ({
  EntitlementResolver: class {
    resolveForUser = entitlementResolveMock
  },
}))

vi.mock('@/lib/tokens/TokenBalanceResolver', () => ({
  TokenBalanceResolver: class {
    resolveForUser = tokenBalanceResolveMock
  },
}))

describe('GET /api/monetization/post-purchase-sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: 'user-1' } })
    entitlementResolveMock.mockResolvedValue({
      entitlement: {
        plans: [],
        status: 'none',
        currentPeriodEnd: null,
        gracePeriodEnd: null,
      },
      hasAccess: false,
      message: 'Upgrade to access this feature.',
    })
    tokenBalanceResolveMock.mockResolvedValue({
      balance: 0,
      lifetimePurchased: 0,
      lifetimeSpent: 0,
      lifetimeRefunded: 0,
      updatedAt: new Date('2026-03-30T00:00:00.000Z').toISOString(),
    })
    userSubscriptionFindFirstMock.mockResolvedValue(null)
    tokenLedgerFindFirstMock.mockResolvedValue(null)
    appUserFindUniqueMock.mockResolvedValue({ stateRestrictionLevel: null })
  })

  it('returns no_session sync status without session id', async () => {
    const { GET } = await import('@/app/api/monetization/post-purchase-sync/route')
    const res = await GET(createMockNextRequest('http://localhost/api/monetization/post-purchase-sync'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.syncStatus).toBe('no_session')
    expect(body.syncEvidence).toMatchObject({
      subscription: false,
      tokens: false,
    })
    expect(body.entitlement).toMatchObject({
      plans: [],
      status: 'none',
    })
    expect(body.tokenBalance).toMatchObject({
      balance: 0,
    })
  })

  it('returns synced when subscription evidence exists for session id', async () => {
    userSubscriptionFindFirstMock.mockResolvedValue({ id: 'sub-1' })
    entitlementResolveMock.mockResolvedValue({
      entitlement: {
        plans: ['pro'],
        status: 'active',
        currentPeriodEnd: null,
        gracePeriodEnd: null,
      },
      hasAccess: true,
      message: 'Access granted.',
    })

    const { GET } = await import('@/app/api/monetization/post-purchase-sync/route')
    const res = await GET(
      createMockNextRequest('http://localhost/api/monetization/post-purchase-sync?session_id=cs_test_123')
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.syncStatus).toBe('synced')
    expect(body.sessionId).toBe('cs_test_123')
    expect(body.syncEvidence).toMatchObject({
      subscription: true,
      tokens: false,
    })
    expect(body.entitlement).toMatchObject({
      plans: ['pro'],
      status: 'active',
    })
  })

  // The paid-state card check refunded the purchase (lib/subscription/paidStateRefusal):
  // without this the buyer waits on "still finalizing" for a purchase that is never coming.
  it('returns refused for an unlanded purchase on a card-locked account', async () => {
    appUserFindUniqueMock.mockResolvedValue({ stateRestrictionLevel: 'card_paid_block' })
    const { GET } = await import('@/app/api/monetization/post-purchase-sync/route')
    const res = await GET(
      createMockNextRequest('http://localhost/api/monetization/post-purchase-sync?session_id=cs_test_nv')
    )
    const body = await res.json()
    expect(body.syncStatus).toBe('refused')
    expect(body.syncMessage).toContain('refunded in full')
  })

  it('stays pending on an unlocked account, and on the signup flag the owner chose not to use', async () => {
    for (const level of [null, 'paid_block']) {
      appUserFindUniqueMock.mockResolvedValue({ stateRestrictionLevel: level })
      const { GET } = await import('@/app/api/monetization/post-purchase-sync/route')
      const res = await GET(
        createMockNextRequest('http://localhost/api/monetization/post-purchase-sync?session_id=cs_test_ok')
      )
      expect((await res.json()).syncStatus).toBe('pending')
    }
  })

  it('never reports a purchase that DID land as refused', async () => {
    appUserFindUniqueMock.mockResolvedValue({ stateRestrictionLevel: 'card_paid_block' })
    tokenLedgerFindFirstMock.mockResolvedValue({ id: 'led-1' })
    const { GET } = await import('@/app/api/monetization/post-purchase-sync/route')
    const res = await GET(
      createMockNextRequest('http://localhost/api/monetization/post-purchase-sync?session_id=cs_test_landed')
    )
    expect((await res.json()).syncStatus).toBe('synced')
  })
})
