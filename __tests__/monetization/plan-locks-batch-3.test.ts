// @vitest-environment node
/**
 * Third batch from the 2026-11-10 plan-features audit — the owner's decisions of 2026-11-11:
 *   1. Trade Finder is locked to AF Legacy (`legacy_trade_finder`).
 *   2. Best-ball roster construction is locked (`roster_construction_planning`).
 *   3. HOH nomination / POV analysis and cap advice are AF Pro, not Commissioner.
 *   4. Draft Rankings (`draft_rankings`) is the AI read of the draft-results rankings.
 * Each lock must refuse BEFORE the model call or computation it guards.
 */
import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const session = vi.fn()
vi.mock('next-auth', () => ({ getServerSession: (...a: unknown[]) => session(...a) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/telemetry/usage', () => ({ withApiUsage: () => (h: unknown) => h }))

const gateCalls: string[] = []
let allowed = new Set<string>()
const refuse = () =>
  NextResponse.json(
    { error: 'Premium feature', code: 'feature_not_entitled', message: 'This is part of AF Legacy.', upgradePath: '/war-room' },
    { status: 403 },
  )
vi.mock('@/lib/subscription/entitlement-middleware', () => ({
  requireFeatureEntitlement: vi.fn(async ({ featureId }: { featureId: string }) => {
    gateCalls.push(featureId)
    return allowed.has(featureId) ? { ok: true, decision: {}, tokenSpend: null, tokenPreview: null } : { ok: false, response: refuse() }
  }),
}))
vi.mock('@/lib/subscription/requireEntitlement', () => ({
  requireEntitlement: vi.fn(async (featureId: string) => {
    gateCalls.push(featureId)
    return allowed.has(featureId) ? 'u1' : refuse()
  }),
}))
vi.mock('@/lib/redraft/ai/requireAfSub', () => ({
  requireAfSub: vi.fn(async () => {
    gateCalls.push('commissioner_ai_tools')
    return allowed.has('commissioner_ai_tools') ? 'u1' : refuse()
  }),
}))

const spend = vi.fn()
vi.mock('@/lib/openai-client', () => ({
  openaiChatJson: () => { spend('openai'); return Promise.reject(new Error('should not run')) },
  openaiChatText: () => { spend('openai'); return Promise.reject(new Error('should not run')) },
  parseJsonContentFromChatCompletion: () => null,
}))
vi.mock('@/lib/prisma', () => ({
  prisma: new Proxy({}, { get: () => new Proxy({}, { get: () => () => { spend('prisma'); return Promise.resolve(null) } }) }),
}))
vi.mock('@/lib/rate-limit', async (orig) => ({
  ...(await orig<object>()),
  consumeRateLimit: () => { spend('rate-limit'); return { success: true, remaining: 1, retryAfterSec: 0 } },
}))
vi.mock('@/lib/trade-pre-analysis', () => ({
  getPreAnalysisStatus: () => { spend('pre-analysis'); return Promise.resolve(null) },
  runPreAnalysis: () => { spend('pre-analysis'); return Promise.resolve() },
}))

// Best-ball War Room.
vi.mock('@/lib/get-current-user', () => ({ getCurrentUser: async () => ({ id: 'u1', email: null }) }))
vi.mock('@/lib/best-ball-war-room/bestBallWarRoomContext', () => ({
  buildBestBallWarRoomContext: async () => ({
    ok: true,
    context: { isCommissioner: false, userRosterId: 'r1', teams: [{ rosterId: 'r1', isUserTeam: true, players: [] }] },
  }),
}))
const construction = vi.fn(() => ({ grade: 'A', rosterSize: 20, byPosition: [], weaknesses: [] }))
vi.mock('@/lib/best-ball-war-room/bestBallRosterConstructionEngine', () => ({
  evaluateUserRosterConstruction: (...a: unknown[]) => construction(...a),
  evaluateRosterConstruction: (...a: unknown[]) => construction(...a),
}))
vi.mock('@/lib/best-ball-war-room/bestBallDepthEngine', () => ({ evaluateDepth: () => ({ depth: 1 }) }))

// Draft results.
vi.mock('@/lib/live-draft-engine/auth', () => ({ canAccessLeagueDraft: async () => true }))
vi.mock('@/lib/post-draft-manager-ranking', () => ({
  getDraftResults: async () => ({ leagueId: 'L1', managerRankings: [{ rosterId: 'r1', grade: 'A' }] }),
}))
const enhance = vi.fn(async (payload: Record<string, unknown>, aiExplain: boolean) => ({ ...payload, aiExplanationEnabled: aiExplain }))
vi.mock('@/lib/post-draft-manager-ranking/aiExplanationService', () => ({
  maybeEnhanceDraftResultsWithAi: (...a: [Record<string, unknown>, boolean]) => enhance(...a),
}))

const json = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const leagueParams = { params: Promise.resolve({ leagueId: 'L1' }) }

beforeEach(() => {
  session.mockReset()
  session.mockResolvedValue({ user: { id: 'u1', email: null } })
  gateCalls.length = 0
  allowed = new Set()
  spend.mockReset()
  construction.mockClear()
  enhance.mockClear()
})

describe('1. Trade Finder is AF Legacy', () => {
  it('the /api/trade-finder cost gate asks for legacy_trade_finder', async () => {
    const { AI_COST_GATES } = await import('@/lib/ai-protection/costGate')
    expect(AI_COST_GATES.trade_finder.featureId).toBe('legacy_trade_finder')
    expect(AI_COST_GATES.trade_finder.paidFromLaunch).toBe(true)
  })

  it('trade partner match refuses before any lookup or OpenAI call', async () => {
    const { GET } = await import('@/app/api/trade-partner-match/route')
    const res = await GET(new Request('http://x/api/trade-partner-match?leagueId=L1'))
    expect(res.status).toBe(403)
    expect(gateCalls).toEqual(['legacy_trade_finder'])
    expect(spend).not.toHaveBeenCalled()
  })

  it('trade partner match still sends signed-out callers a 401 first', async () => {
    session.mockResolvedValue(null)
    const { GET } = await import('@/app/api/trade-partner-match/route')
    expect((await GET(new Request('http://x/api/trade-partner-match?leagueId=L1'))).status).toBe(401)
    expect(gateCalls).toEqual([])
  })

  it('matchmaking (Find Best Partners) refuses before rate limits or the pre-analysis', async () => {
    const { POST } = await import('@/app/api/trade-finder/matchmaking/route')
    const res = await (POST as (r: Request) => Promise<Response>)(new Request('http://x/api', json({ leagueId: 'L1' })))
    expect(res.status).toBe(403)
    expect(gateCalls).toEqual(['legacy_trade_finder'])
    expect(spend).not.toHaveBeenCalled()
  })
})

describe('2. Best-ball roster construction is locked', () => {
  it('without the plan: the state comes back with no construction and constructionLocked', async () => {
    const { GET } = await import('@/app/api/leagues/[leagueId]/best-ball-war-room/handler')
    const body = await (await GET(new Request('http://x') as never, leagueParams)).json()
    expect(body.constructionLocked).toBe(true)
    expect(body.construction).toBeNull()
    expect(body.depth).toEqual({ depth: 1 })
    expect(construction).not.toHaveBeenCalled()
    expect(gateCalls).toEqual(['roster_construction_planning'])
  })

  it('with the plan: construction is computed and returned', async () => {
    allowed = new Set(['roster_construction_planning'])
    const { GET } = await import('@/app/api/leagues/[leagueId]/best-ball-war-room/handler')
    const body = await (await GET(new Request('http://x') as never, leagueParams)).json()
    expect(body.constructionLocked).toBe(false)
    expect(body.construction.grade).toBe('A')
  })

  it('the roster-construction POST refuses before computing', async () => {
    const { POST } = await import('@/app/api/leagues/[leagueId]/best-ball-war-room/[action]/route')
    const res = await POST(new Request('http://x', json({})) as never, {
      params: Promise.resolve({ leagueId: 'L1', action: 'roster-construction' }),
    })
    expect(res.status).toBe(403)
    expect(construction).not.toHaveBeenCalled()
  })
})

describe('3. HOH nomination, POV analysis and cap advice are AF Pro', () => {
  it.each(['commissioner_nomination_analysis', 'commissioner_pov_analysis', 'commissioner_cap_advice'] as const)(
    '%s opens for Pro and Supreme, not Commissioner',
    async (key) => {
      const { canUseFeature, getEntitlement, getUpgradeUrl } = await import('@/lib/monetization/entitlements')
      expect(canUseFeature(key, 'af_pro')).toBe(true)
      expect(canUseFeature(key, 'af_supreme')).toBe(true)
      expect(canUseFeature(key, 'af_commissioner')).toBe(false)
      expect(getUpgradeUrl(key)).toBe('/pro')
      expect(getEntitlement(key).upgradeLabel).toBe('Get AF Pro')
    },
  )

  it('the IDP Cap Room cap-advice action checks the Pro key, not Commissioner AI tools', async () => {
    const { POST } = await import('@/app/api/idp/ai/route')
    const res = await POST(new Request('http://x', json({ leagueId: 'L1', action: 'cap_advice' })) as never)
    expect(res.status).toBe(403)
    expect(gateCalls).toEqual(['commissioner_cap_advice'])
  })

  it('every other IDP action keeps the Commissioner AI gate', async () => {
    const { POST } = await import('@/app/api/idp/ai/route')
    await POST(new Request('http://x', json({ leagueId: 'L1', action: 'weekly_recap' })) as never)
    expect(gateCalls).toEqual(['commissioner_ai_tools'])
  })
})

describe('4. Draft Rankings is the AI read of the draft results', () => {
  const get = async (q: string) => {
    const { GET } = await import('@/app/api/leagues/[leagueId]/draft-results/handler')
    return (await GET(new Request(`http://x/api/leagues/L1/draft-results${q}`), leagueParams)).json()
  }

  it('without the plan: rankings come back, AI explanations are skipped and the lock says why', async () => {
    const body = await get('?aiExplain=1')
    expect(enhance).toHaveBeenCalledWith(expect.anything(), false)
    expect(body.managerRankings).toHaveLength(1)
    expect(body.aiExplainLocked).toEqual({ message: 'This is part of AF Legacy.', upgradePath: '/war-room' })
    expect(gateCalls).toEqual(['draft_rankings'])
  })

  it('with the plan: AI explanations run', async () => {
    allowed = new Set(['draft_rankings'])
    const body = await get('?aiExplain=1')
    expect(enhance).toHaveBeenCalledWith(expect.anything(), true)
    expect(body.aiExplainLocked).toBeNull()
  })

  it('the free rankings (no aiExplain) are never gated', async () => {
    const body = await get('')
    expect(gateCalls).toEqual([])
    expect(body.aiExplainLocked).toBeNull()
    expect(enhance).toHaveBeenCalledWith(expect.anything(), false)
  })
})
