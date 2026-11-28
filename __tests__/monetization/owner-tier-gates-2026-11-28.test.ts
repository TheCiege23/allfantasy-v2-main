// @vitest-environment node
/**
 * Server gates for the owner's tier decisions of 2026-11-28, each route run against all five customer
 * tiers. Plans resolve through the REAL rules (tierMatrixHarness) and the REAL `requireFeatureEntitlement`
 * / `FeatureGateService`; only the database read of the plan, the token balance and the model are replaced.
 *
 * Every row asserts BOTH directions: the tiers the owner named reach the model, every other tier is
 * refused and the model is never called.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TIERS, setTier, type Tier } from './tierMatrixHarness'

const session = vi.fn()
vi.mock('next-auth', () => ({ getServerSession: (...a: unknown[]) => session(...a) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/subscription/EntitlementResolver', async () => (await import('./tierMatrixHarness')).resolverModule())

// No tokens: a locked tier's token fallback is refused for balance, never charged.
vi.mock('@/lib/tokens/TokenSpendService', () => {
  class TokenSpendRuleNotFoundError extends Error {}
  class TokenSpendService {
    async getBalance() {
      return { balance: 0, spendableBalance: 0 }
    }
    async previewSpendWithEntitlement() {
      return { canSpend: false, tokenCost: 2, currentBalance: 0 }
    }
  }
  return { TokenSpendService, TokenSpendRuleNotFoundError }
})
vi.mock('@/lib/tokens/paidToolBilling', () => ({
  withPaidToolBilling: (h: unknown) => h,
  paidToolNotDelivered: () => undefined,
  replayPaidToolRequest: async () => null,
  preparePaidToolCharge: async () => {
    throw new Error('no charge may be prepared in this test')
  },
}))

// The draft engine writes the Chimmy explanation when asked to; recorded, never run for real.
const draftAssist = vi.fn()
vi.mock('@/lib/draft-ai-engine', () => ({
  runDraftAIAssist: (...a: unknown[]) => {
    draftAssist(...a)
    return Promise.resolve({
      recommendation: { recommendation: null, alternatives: [], explanation: 'deterministic', evidence: [] },
      explanation: 'ai',
      aiExplanationUsed: true,
    })
  },
}))

beforeEach(() => {
  session.mockReset()
  session.mockResolvedValue({ user: { id: 'u1', email: null } })
  draftAssist.mockReset()
})

const req = (url: string, body: unknown) =>
  new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost' },
    body: JSON.stringify(body),
  }) as never

describe('2. the draft-room AI pick explanation opens for AF Pro, AF Legacy and AF Supreme', () => {
  const ALLOWED: Tier[] = ['pro', 'legacy', 'supreme']
  for (const tier of TIERS) {
    const open = ALLOWED.includes(tier)
    it(`${tier}: ${open ? 'explanation written' : 'refused, the model never runs'}`, async () => {
      setTier(tier)
      const { POST } = (await import('@/app/api/draft/recommend/route')) as unknown as {
        POST: (r: never) => Promise<Response>
      }
      const res = await POST(
        req('http://localhost/api/draft/recommend', {
          available: [{ name: 'Player A', position: 'QB', adp: 10 }],
          teamRoster: [],
          rosterSlots: ['QB'],
          includeAIExplanation: true,
        }),
      )
      const json = (await res.json()) as { code?: string }
      if (open) {
        expect(res.status).toBe(200)
        expect(draftAssist).toHaveBeenCalledTimes(1)
        expect((draftAssist.mock.calls[0] as unknown[])[1]).toMatchObject({ explanation: true })
      } else {
        expect([res.status, json.code]).toEqual([402, 'insufficient_token_balance'])
        expect(draftAssist).not.toHaveBeenCalled()
      }
    })
  }

  it('free: the basic recommendation (no explanation asked) stays free', async () => {
    setTier('free')
    const { POST } = (await import('@/app/api/draft/recommend/route')) as unknown as {
      POST: (r: never) => Promise<Response>
    }
    const res = await POST(
      req('http://localhost/api/draft/recommend', { available: [{ name: 'Player A', position: 'QB' }], teamRoster: [], rosterSlots: ['QB'] }),
    )
    expect(res.status).toBe(200)
    expect((draftAssist.mock.calls[0] as unknown[])[1]).toMatchObject({ explanation: false })
  })
})
