// @vitest-environment node
/**
 * Server gates, owner's decisions of 2026-11-16. Every route here ran its model for anyone who called it
 * directly — the lock was on the screen only. Each must refuse a caller without the plan BEFORE the model:
 *
 *   AF Pro      /api/waiver-ai, /api/ai/waiver                        ai_waivers
 *               /api/ai/draft/recommend                               pro_draft_ai
 *               /api/coach/advice, /api/ai/run, /api/ai/compare       player_ai_recommendations
 *   AF Legacy   the five /af-legacy actions the screen already locks, with the key that lock names.
 */
import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const session = vi.fn()
vi.mock('next-auth', () => ({ getServerSession: (...a: unknown[]) => session(...a) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/telemetry/usage', () => ({ withApiUsage: () => (h: unknown) => h }))

const gateCalls: Array<{ featureId: string; userId: string }> = []
vi.mock('@/lib/subscription/entitlement-middleware', () => ({
  requireFeatureEntitlement: vi.fn(async ({ featureId, userId }: { featureId: string; userId: string }) => {
    gateCalls.push({ featureId, userId })
    return {
      ok: false,
      response: NextResponse.json({ error: 'Premium feature', code: 'feature_not_entitled' }, { status: 403 }),
    }
  }),
}))

// Anything that would spend: the model clients and the database.
const spend = vi.fn()
const spendProxy: unknown = new Proxy(() => undefined, {
  get: () => spendProxy,
  apply: () => {
    spend()
    return Promise.reject(new Error('should not run'))
  },
})
vi.mock('@/lib/openai-client', () => ({
  openaiChatJson: () => { spend('openai'); return Promise.reject(new Error('should not run')) },
  openaiChatText: () => { spend('openai'); return Promise.reject(new Error('should not run')) },
  parseJsonContentFromChatCompletion: () => null,
  getOpenAIConfig: () => ({}),
  getOpenAIClient: () => spendProxy,
}))
vi.mock('@/lib/ai/openai-route-client', () => ({ getOpenAIRouteClient: () => spendProxy }))
vi.mock('@/lib/prisma', () => ({ prisma: spendProxy }))
vi.mock('@/lib/feature-toggle', () => ({ isAIAssistantEnabled: async () => true, isToolWaiverAIEnabled: async () => true }))
vi.mock('@/lib/ai-protection', () => ({ runAiProtection: async () => { spend('rate'); return null } }))
vi.mock('@/lib/ai-coach', () => ({ getAICoachResponse: () => { spend('coach'); throw new Error('should not run') }, normalizeAdviceType: (t: unknown) => t }))
vi.mock('@/lib/ai/aiDraftHelper', () => ({ runDraftWarRoomRecommendation: () => { spend('draft'); throw new Error('should not run') } }))
vi.mock('@/lib/legacy/requireLegacySleeperIdentity', () => ({
  requireLegacySleeperIdentity: async () => ({ ok: true, identity: { sleeperUsername: 'sam', actorId: 'u1', source: 'session' } }),
}))

// Two legacy routes check the request's Origin first (CSRF); that is not what these tests are about.
vi.mock('@/lib/api-auth', async (orig) => ({ ...(await orig<typeof import('@/lib/api-auth')>()), validateRequestOrigin: () => true }))

const post = (body: unknown) =>
  new Request('http://x/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) as never

type Handler = (req: never) => Promise<Response>
const load = async (path: string): Promise<Handler> => ((await import(/* @vite-ignore */ path)) as { POST: Handler }).POST

beforeEach(() => {
  session.mockReset()
  session.mockResolvedValue({ user: { id: 'u1', email: null } })
  gateCalls.length = 0
  spend.mockReset()
})

const CASES: Array<{ name: string; path: string; featureId: string; body: unknown }> = [
  { name: 'Waiver Chimmy screen', path: '@/app/api/waiver-ai/route', featureId: 'ai_waivers', body: { sleeper_username: 'sam' } },
  { name: 'Chimmy waiver engine', path: '@/app/api/ai/waiver/route', featureId: 'ai_waivers', body: {} },
  { name: 'draft-room Chimmy advice', path: '@/app/api/ai/draft/recommend/route', featureId: 'pro_draft_ai', body: { leagueId: 'L1' } },
  { name: 'coach advice', path: '@/app/api/coach/advice/route', featureId: 'player_ai_recommendations', body: { type: 'lineup' } },
  { name: 'Chimmy workbench run', path: '@/app/api/ai/run/route', featureId: 'player_ai_recommendations', body: { tool: 'waiver', sport: 'NFL' } },
  { name: 'Chimmy workbench compare', path: '@/app/api/ai/compare/route', featureId: 'player_ai_recommendations', body: { tool: 'waiver', sport: 'NFL' } },
  { name: 'AF Legacy trade proposals', path: '@/server/api-route-modules/legacy/trade/proposal-generator/route', featureId: 'legacy_trade_proposals', body: {
    leagueId: 'L1', username: 'sam', myRosterId: 1, targetRosterId: 2,
    desiredAssets: [{ type: 'player', name: 'A' }],
    myTeam: { displayName: 'Me', players: [] }, targetTeam: { displayName: 'Them', players: [] },
  } },
  { name: 'AF Legacy waiver Chimmy', path: '@/server/api-route-modules/legacy/waiver/analyze/route', featureId: 'legacy_waiver_analysis', body: { sleeper_username: 'sam' } },
  { name: 'AF Legacy team direction', path: '@/server/api-route-modules/legacy/rankings/analyze/route', featureId: 'legacy_rankings_analysis', body: { sleeper_username: 'sam', league_id: 'L1' } },
  { name: 'AF Legacy market board', path: '@/server/api-route-modules/legacy/social-pulse/route', featureId: 'legacy_social_pulse', body: { sport: 'NFL', format: 'redraft', players: ['A'] } },
  { name: 'AF Legacy manager comparison', path: '@/server/api-route-modules/legacy/compare/route', featureId: 'legacy_manager_compare', body: { username_a: 'sam', username_b: 'kim' } },
  // Owner's decision 2026-11-17: the four AF Legacy AI tools that ran free.
  { name: 'AF Legacy trade ideas', path: '@/server/api-route-modules/legacy/trade-ideas/route', featureId: 'legacy_trade_proposals', body: { leagueId: 'L1', username: 'sam' } },
  { name: 'AF Legacy goal proposals', path: '@/server/api-route-modules/legacy/trade/goal-proposals/route', featureId: 'legacy_trade_proposals', body: { leagueId: 'L1', username: 'sam', goal: 'rebuild' } },
  { name: 'AF Legacy Trade Hub report', path: '@/server/api-route-modules/legacy/trade/analyze/route', featureId: 'legacy_trade_hub', body: { sport: 'NFL', format: 'dynasty', sleeper_username_a: 'sam', sleeper_username_b: 'kim', assetsA: [{ type: 'player', player: { id: 'p1', name: 'Player One' } }], assetsB: [{ type: 'player', player: { id: 'p2', name: 'Player Two' } }] } },
  { name: 'AF Legacy Chimmy career report', path: '@/server/api-route-modules/legacy/ai/run/route', featureId: 'legacy_ai_report', body: { sleeper_username: 'sam' } },
]

describe('each paid route refuses a caller without the plan, before anything is spent', () => {
  for (const c of CASES) {
    it(`${c.name} → 403 on ${c.featureId}`, async () => {
      const res = await (await load(c.path))(post(c.body))
      expect(res.status).toBe(403)
      expect(gateCalls).toEqual([{ featureId: c.featureId, userId: 'u1' }])
      expect(spend).not.toHaveBeenCalled()
    })
  }
})

describe('signing in comes first, and is new on the two routes that took anonymous callers', () => {
  it('/api/waiver-ai: a signed-out caller is asked to sign in (it ran the model for them before)', async () => {
    session.mockResolvedValue(null)
    const res = await (await load('@/app/api/waiver-ai/route'))(post({ sleeper_username: 'sam' }))
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ code: 'sign_in', error: 'Sign in to use Waiver Chimmy.' })
    expect(gateCalls).toEqual([])
    expect(spend).not.toHaveBeenCalled()
  })

  it('/api/legacy/compare: it took no session at all; now sign in, then the plan', async () => {
    session.mockResolvedValue(null)
    const res = await (await load('@/server/api-route-modules/legacy/compare/route'))(post({ username_a: 'sam', username_b: 'kim' }))
    expect(res.status).toBe(401)
    expect(gateCalls).toEqual([])
    expect(spend).not.toHaveBeenCalled()
  })
})

describe('the keys name the plans the owner chose', () => {
  it('Pro keys → AF Pro, Legacy keys → AF Legacy', async () => {
    const { getRequiredPlanForFeature } = await import('@/lib/subscription/feature-access')
    for (const k of ['ai_waivers', 'pro_draft_ai', 'player_ai_recommendations', 'legacy_trade_finder'] as const) {
      expect([k, getRequiredPlanForFeature(k)]).toEqual([k, 'pro'])
    }
    for (const k of ['legacy_trade_proposals', 'legacy_waiver_analysis', 'legacy_rankings_analysis', 'legacy_social_pulse', 'legacy_manager_compare', 'legacy_trade_hub', 'legacy_ai_report'] as const) {
      expect([k, getRequiredPlanForFeature(k)]).toEqual([k, 'war_room'])
    }
  })
})
