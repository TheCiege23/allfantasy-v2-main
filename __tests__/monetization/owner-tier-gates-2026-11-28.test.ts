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

// Anything that would spend in the devy / C2C / IDP / keeper routes: each model module's functions are
// recorded and never run. Past the plan gate, the league read below refuses, so an allowed tier stops
// visibly AFTER the gate (403 'Forbidden', no `feature_not_entitled`).
const spend = vi.fn()
const spyAll = async (load: () => Promise<Record<string, unknown>>) => {
  const mod = await load()
  return Object.fromEntries(
    Object.entries(mod).map(([k, v]) => [
      k,
      typeof v === 'function'
        ? (...a: unknown[]) => {
            spend(k, a)
            return Promise.reject(new Error('model must not run in this test'))
          }
        : v,
    ]),
  )
}
vi.mock('@/lib/devy/ai/devyChimmy', async (orig) => spyAll(orig as never))
vi.mock('@/lib/c2c/ai/c2cChimmy', async (orig) => spyAll(orig as never))
vi.mock('@/lib/idp/ai/idpChimmy', async (orig) => spyAll(orig as never))
vi.mock('@/lib/idp/ai/idpCapChimmy', async (orig) => spyAll(orig as never))
vi.mock('@/lib/decision-os/trade/evaluateStoredTrade', () => ({
  evaluateStoredTrade: (...a: unknown[]) => {
    spend('evaluateStoredTrade', a)
    return Promise.resolve({ ok: false, refusal: { code: 'not_member', reason: 'not yours' } })
  },
}))
vi.mock('@/lib/decision-os/trade/surfaceShadow', () => ({ recordTradeSurfaceShadow: () => undefined }))
const dbProxy: unknown = new Proxy(() => undefined, {
  get: (_t, k) => (k === 'then' ? undefined : dbProxy),
  apply: () => Promise.reject(new Error('db not available in this test')),
})
vi.mock('@/lib/prisma', () => ({ prisma: dbProxy }))
vi.mock('@/lib/league/league-access', () => ({ assertLeagueMember: async () => ({ ok: false, status: 403 }) }))
vi.mock('@/lib/live-draft-engine/auth', async (orig) => ({
  ...(await (orig as () => Promise<Record<string, unknown>>)()),
  canAccessLeagueDraft: async () => false,
}))
vi.mock('@/lib/league/commissionerAccess', () => ({
  assertCommissionerAccess: async () => {
    throw new Error('not commissioner')
  },
  canCommissionerAct: async () => false,
}))

// AF Legacy portfolio history: the Sleeper read that follows the gate. Recorded; it finds nobody.
const sleeperRead = vi.fn()
vi.mock('@/lib/sleeper-client', () => ({
  resolveSleeperUser: async (...a: unknown[]) => {
    sleeperRead(...a)
    return null
  },
  getLeagueUsers: async () => [],
  getLeagueRosters: async () => [],
  getLeagueHistory: async () => [],
  getLeagueTransactions: async () => [],
}))
vi.mock('@/lib/telemetry/usage', () => ({ withApiUsage: () => (h: unknown) => h }))

beforeEach(() => {
  session.mockReset()
  session.mockResolvedValue({ user: { id: 'u1', email: null } })
  draftAssist.mockReset()
  spend.mockReset()
  sleeperRead.mockReset()
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

type Handler = (req: never, ctx?: never) => Promise<Response>
async function call(path: string, url: string, body: unknown, method: 'POST' | 'GET' = 'POST') {
  const mod = (await import(/* @vite-ignore */ path)) as Record<string, Handler>
  const request = new Request(url, {
    method,
    headers: { 'content-type': 'application/json', origin: 'http://localhost' },
    ...(method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {}),
  }) as never
  try {
    const res = await mod[method]!(request)
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
    return { status: res.status, json }
  } catch (error) {
    return { status: 599, json: { error: String(error) } as Record<string, unknown> }
  }
}

/** The plan gate refused: 402 from requireEntitlement, or 403 feature_not_entitled from requireFeatureEntitlement. */
const planRefused = (r: { status: number; json: Record<string, unknown> }) =>
  (r.status === 402 && r.json.upgrade === true) || (r.status === 403 && r.json.code === 'feature_not_entitled')

const AF_INTELLIGENCE: Tier[] = ['pro', 'commissioner', 'supreme']
const COMMISSIONER_SUPREME: Tier[] = ['commissioner', 'supreme']

type GateRow = { name: string; path: string; url: string; body: unknown; method?: 'POST' | 'GET'; allowed: Tier[]; featureId?: string }

const ROWS: GateRow[] = [
  {
    name: '3a. AF Legacy portfolio history',
    path: '@/server/api-route-modules/legacy/portfolio/history/route',
    url: 'http://localhost/api/legacy/portfolio/history?leagueId=L1&userId=sam&mode=atTime',
    body: undefined,
    method: 'GET',
    allowed: ['legacy', 'supreme'],
  },
  {
    name: '3c. devy member prospect read (DevyPlayerModal)',
    path: '@/app/api/devy/ai/route',
    url: 'http://localhost/api/devy/ai',
    body: { action: 'prospect_eval', leagueId: 'L1', playerId: 'p1' },
    allowed: AF_INTELLIGENCE,
    featureId: 'af_intelligence',
  },
  {
    name: '3c. C2C member campus read (C2CPlayerModal)',
    path: '@/app/api/c2c/ai/route',
    url: 'http://localhost/api/c2c/ai',
    body: { action: 'campus_eval', leagueId: 'L1', playerId: 'p1' },
    allowed: AF_INTELLIGENCE,
    featureId: 'af_intelligence',
  },
  {
    name: '3c. IDP member defender read (IDPPlayerModal)',
    path: '@/app/api/idp/ai/route',
    url: 'http://localhost/api/idp/ai',
    body: { action: 'defender_eval', leagueId: 'L1', playerId: 'p1', week: 3 },
    allowed: AF_INTELLIGENCE,
    featureId: 'af_intelligence',
  },
  {
    name: '3c. devy host tool (constitution) keeps the Commissioner gate',
    path: '@/app/api/devy/ai/route',
    url: 'http://localhost/api/devy/ai',
    body: { action: 'constitution', leagueId: 'L1' },
    allowed: COMMISSIONER_SUPREME,
    featureId: 'commissioner_ai_tools',
  },
  {
    name: '3c. C2C host tool (commissioner_chat) keeps the Commissioner gate',
    path: '@/app/api/c2c/ai/route',
    url: 'http://localhost/api/c2c/ai',
    body: { action: 'commissioner_chat', leagueId: 'L1', message: 'hi' },
    allowed: COMMISSIONER_SUPREME,
    featureId: 'commissioner_ai_tools',
  },
  {
    name: '3c. IDP host tool (power_rankings) keeps the Commissioner gate',
    path: '@/app/api/idp/ai/route',
    url: 'http://localhost/api/idp/ai',
    body: { action: 'power_rankings', leagueId: 'L1', week: 3 },
    allowed: COMMISSIONER_SUPREME,
    featureId: 'commissioner_ai_tools',
  },
  {
    name: '3d. keeper member trade analysis',
    path: '@/app/api/keeper/ai/trade-analysis/route',
    url: 'http://localhost/api/keeper/ai/trade-analysis',
    body: { leagueId: 'L1', trade: { kind: 'af', tradeId: 't1' } },
    allowed: AF_INTELLIGENCE,
    featureId: 'af_intelligence',
  },
]

describe('3. each route opens for exactly the tiers the owner named; locked tiers never reach a model or read', () => {
  for (const row of ROWS) {
    for (const tier of TIERS) {
      const open = row.allowed.includes(tier)
      it(`${row.name} — ${tier}: ${open ? 'past the gate' : 'locked, nothing spent'}`, async () => {
        setTier(tier)
        const r = await call(row.path, row.url, row.body, row.method)
        expect(planRefused(r), JSON.stringify(r)).toBe(!open)
        if (!open) {
          expect(spend).not.toHaveBeenCalled()
          expect(sleeperRead).not.toHaveBeenCalled()
          if (row.featureId && r.status === 402) expect(r.json.featureId).toBe(row.featureId)
        }
        // Past the gate the league read refuses; nothing here may reach a model either way.
        expect(spend.mock.calls.filter(([k]) => k !== 'evaluateStoredTrade')).toEqual([])
      })
    }
  }

  it('3a. portfolio history signed out: 401 sign_in_required before any Sleeper read', async () => {
    session.mockResolvedValue(null)
    setTier('legacy')
    const r = await call(ROWS[0]!.path, ROWS[0]!.url, undefined, 'GET')
    expect([r.status, r.json.code]).toEqual([401, 'sign_in_required'])
    expect(sleeperRead).not.toHaveBeenCalled()
  })

  it('3a. portfolio history, AF Legacy: past the gate the Sleeper read runs', async () => {
    setTier('legacy')
    await call(ROWS[0]!.path, ROWS[0]!.url, undefined, 'GET')
    expect(sleeperRead).toHaveBeenCalledWith('sam')
  })

  it('3c. the member reads need no commissioner role: an AF Pro member gets past the gate on all three', async () => {
    setTier('pro')
    for (const row of ROWS.filter((r) => r.name.startsWith('3c.') && r.name.includes('member'))) {
      const r = await call(row.path, row.url, row.body)
      expect([row.name, planRefused(r)]).toEqual([row.name, false])
    }
  })

  it('3d. keeper trade analysis: an allowed tier reaches the canonical grader', async () => {
    setTier('commissioner')
    await call(ROWS[7]!.path, ROWS[7]!.url, ROWS[7]!.body)
    expect(spend.mock.calls.map(([k]) => k)).toEqual(['evaluateStoredTrade'])
  })
})
