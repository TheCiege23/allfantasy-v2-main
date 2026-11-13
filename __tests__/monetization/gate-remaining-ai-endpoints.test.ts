// @vitest-environment node
/**
 * Second batch from the 2026-11-10 plan-features audit: endpoints whose only lock was in the browser, or
 * none. Each must refuse a user without the plan BEFORE the model call or computation it guards.
 */
import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const session = vi.fn()
vi.mock('next-auth', () => ({ getServerSession: (...a: unknown[]) => session(...a) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

const gateCalls: string[] = []
let allowed = new Set<string>()
vi.mock('@/lib/subscription/entitlement-middleware', () => ({
  requireFeatureEntitlement: vi.fn(async ({ featureId }: { featureId: string }) => {
    gateCalls.push(featureId)
    return allowed.has(featureId)
      ? { ok: true, decision: {}, tokenSpend: null, tokenPreview: null }
      : { ok: false, response: NextResponse.json({ error: 'Premium feature', code: 'feature_not_entitled' }, { status: 403 }) }
  }),
}))

const spend = vi.fn()
vi.mock('@/lib/ai/league-settings-ai/claude', () => ({ callClaudeJson: () => { spend('claude'); return Promise.reject(new Error('should not run')) } }))
vi.mock('@/lib/rate-limit-daily', () => ({ consumeDailyLimit: () => { spend('daily'); return Promise.resolve({ ok: true }) } }))

// War Room: deterministic picks always; the narrative (an OpenAI call) only with the plan.
vi.mock('@/lib/war-room/war-room-api', () => ({
  requireUserId: async () => ({ ok: true, userId: 'u1' }),
  requireLeagueWarRoom: async () => ({ ok: true, ctx: { leagueId: 'L1', sport: 'NFL' } }),
}))
vi.mock('@/lib/war-room/draft-intelligence-engine', () => ({
  runWarRoomDraftIntelligence: () => ({ version: 1, confidencePct: 70, pickNow: { playerName: 'A' }, strategyMode: 'balanced' }),
}))
const narrative = vi.fn(async () => ({ text: 'story', source: 'openai' }))
vi.mock('@/lib/war-room/war-room-narrative', () => ({ buildWarRoomNarrativeLayer: (...a: unknown[]) => narrative(...a) }))
vi.mock('@/lib/war-room/war-room-persist', () => ({ logAiRecommendation: async () => ({ id: 'log1' }) }))

// Legacy season strategy: the computation is the thing a free caller must not reach.
vi.mock('@/lib/telemetry/usage', () => ({ withApiUsage: () => (h: unknown) => h }))
vi.mock('@/lib/legacy/requireLegacySleeperIdentity', () => ({
  requireLegacySleeperIdentity: async () => ({ ok: true, identity: { sleeperUsername: 'sam', actorId: 'u1', source: 'session' } }),
}))
const compute = vi.fn(async () => ({ strategy: {} }))
vi.mock('@/lib/season-strategy', () => ({ getOrComputeStrategy: (...a: unknown[]) => compute(...a), getStrategyHistory: async () => [] }))

const post = (body: unknown) => new Request('http://x/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

beforeEach(() => {
  session.mockReset()
  session.mockResolvedValue({ user: { id: 'u1', email: null } })
  gateCalls.length = 0
  allowed = new Set()
  spend.mockReset()
  narrative.mockClear()
  compute.mockClear()
})

describe('League Settings AI panels with no server check', () => {
  it('Chimmy setup needs commissioner_ai_tools, checked before the model call', async () => {
    const res = await (await import('@/app/api/ai/chimmy-setup/route')).POST(post({ leagueId: 'L1' }))
    expect(res.status).toBe(403)
    expect(gateCalls).toEqual(['commissioner_ai_tools'])
    expect(spend).not.toHaveBeenCalled()
  })

  it('trash talk needs pro_start_sit (the key its panel already prompts for)', async () => {
    const res = await (await import('@/app/api/ai/trash-talk/route')).POST(post({ leagueId: 'L1' }))
    expect(res.status).toBe(403)
    expect(gateCalls).toEqual(['pro_start_sit'])
    expect(spend).not.toHaveBeenCalled()
  })

  it('signed-out callers still get 401 before the gate', async () => {
    session.mockResolvedValue(null)
    expect((await (await import('@/app/api/ai/chimmy-setup/route')).POST(post({}))).status).toBe(401)
    expect((await (await import('@/app/api/ai/trash-talk/route')).POST(post({}))).status).toBe(401)
    expect(gateCalls).toEqual([])
  })
})

describe('War Room recommend', () => {
  const call = async (body: Record<string, unknown>) =>
    (await import('@/app/api/war-room/recommend/route')).POST(post({ leagueId: 'L1', ...body }) as never)

  it('without the plan: deterministic picks, no narrative, no model call', async () => {
    const res = await call({ includeNarrative: true })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.intelligence.pickNow.playerName).toBe('A')
    expect(json.narrative).toBeNull()
    expect(json.narrativeLocked).toBe(true)
    expect(narrative).not.toHaveBeenCalled()
    expect(gateCalls).toEqual(['draft_strategy_build'])
  })

  it('with the plan: the narrative is built', async () => {
    allowed = new Set(['draft_strategy_build'])
    const json = await (await call({ includeNarrative: true })).json()
    expect(narrative).toHaveBeenCalledTimes(1)
    expect(json.narrativeLocked).toBe(false)
  })

  it('a caller that does not ask for the narrative is never gated (the free War Room tab)', async () => {
    const json = await (await call({})).json()
    expect(json.narrativeLocked).toBe(false)
    expect(gateCalls).toEqual([])
  })
})

describe('Legacy season strategy', () => {
  it('needs planning_tools before computing', async () => {
    const { POST } = await import('@/server/api-route-modules/legacy/season-strategy/route')
    const res = await (POST as (r: Request) => Promise<Response>)(post({ league_id: 'L1', roster_id: 1 }))
    expect(res.status).toBe(403)
    expect(gateCalls).toEqual(['planning_tools'])
    expect(compute).not.toHaveBeenCalled()
    allowed = new Set(['planning_tools'])
    expect((await (POST as (r: Request) => Promise<Response>)(post({ league_id: 'L1', roster_id: 1 }))).status).toBe(200)
    expect(compute).toHaveBeenCalledTimes(1)
  })
})
