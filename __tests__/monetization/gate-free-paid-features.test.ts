// @vitest-environment node
/**
 * Features the catalog sells as paid but that ran free (2026-11-10 audit). Each route must now refuse a
 * user without the plan BEFORE it spends anything — no model call, no daily-limit consumption — and must
 * check the catalog's own key for that feature.
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

// Anything that costs money or quota: must never be reached by a locked user.
const spend = vi.fn()
vi.mock('@/lib/ai/league-settings-ai/claude', () => ({ callClaudeJson: (...a: unknown[]) => { spend('claude'); return Promise.reject(new Error('should not run')) } }))
vi.mock('@/lib/rate-limit-daily', () => ({ consumeDailyLimit: (...a: unknown[]) => { spend('daily'); return Promise.resolve({ ok: true }) } }))
vi.mock('@/lib/ai-matchup-engine/runLeagueMatchupAiEngine', () => ({ runLeagueMatchupAiEngine: () => { spend('matchup-engine'); throw new Error('should not run') } }))
// Building the client is free (the roadmap route does it at module load); a completion request is the spend.
vi.mock('@/lib/ai/openai-route-client', () => ({ getOpenAIRouteClient: () => ({ chat: { completions: { create: () => { spend('openai'); return Promise.reject(new Error('should not run')) } } } }) }))
vi.mock('@/lib/openai-client', () => ({ openaiChatText: () => { spend('openai'); throw new Error('should not run') } }))
vi.mock('@/lib/rate-limit', async (orig) => ({ ...(await orig<object>()), consumeRateLimit: (...a: unknown[]) => { spend('rate'); return { success: true } } }))
vi.mock('@/lib/dynasty-intelligence/DynastyIntelligenceAI', () => ({ getDynastyAIInsight: () => { spend('dynasty-ai'); throw new Error('should not run') } }))
vi.mock('@/lib/weather/afProjectionService', () => ({
  getAFProjection: () => { spend('weather'); return Promise.resolve({}) },
  getAFProjectionBatch: () => { spend('weather'); return Promise.resolve([]) },
}))

const post = (body: unknown) => new Request('http://x/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

beforeEach(() => {
  session.mockReset()
  session.mockResolvedValue({ user: { id: 'u1', email: null } })
  gateCalls.length = 0
  allowed = new Set()
  spend.mockReset()
})

const CASES: { name: string; key: string; call: () => Promise<Response> }[] = [
  { name: 'AI power rankings', key: 'commissioner_power_rankings', call: async () => (await import('@/app/api/ai/power-rankings/route')).POST(post({ leagueId: 'L1' })) },
  { name: 'AI matchup preview', key: 'pro_matchup_analysis', call: async () => (await import('@/app/api/ai/matchup-preview/route')).POST(post({ leagueId: 'L1', week: 3 })) },
  {
    name: 'league matchup AI',
    key: 'pro_matchup_analysis',
    call: async () => (await import('@/app/api/leagues/[leagueId]/ai/matchup/route')).POST(post({ season: 2026, week: 3 }) as never, { params: Promise.resolve({ leagueId: 'L1' }) }),
  },
  { name: 'dynasty 3–5 year roadmap', key: 'ai_planning_3_5_year', call: async () => (await import('@/app/api/rankings/dynasty-roadmap/route')).POST(post({ sport: 'NFL' }) as never) },
  { name: 'franchise roadmap', key: 'ai_planning_3_5_year', call: async () => (await import('@/app/api/franchise-roadmap/route')).POST(post({}) as never) },
  { name: 'lineup optimizer', key: 'pro_lineup_optimizer', call: async () => (await import('@/app/api/lineup-optimizer/route')).POST(post({}) as never) },
  { name: 'lineup optimize', key: 'pro_lineup_optimizer', call: async () => (await import('@/app/api/lineup/optimize/route')).POST(post({})) },
]

describe('a user without the plan is refused before anything is spent', () => {
  for (const c of CASES) {
    it(c.name, async () => {
      const res = await c.call()
      expect(res.status).toBe(403)
      expect((await res.json()).code).toBe('feature_not_entitled')
      expect(gateCalls).toContain(c.key)
      expect(spend).not.toHaveBeenCalled()
    })
  }

  it('signed-out callers are still refused first, without reaching the gate', async () => {
    session.mockResolvedValue(null)
    for (const c of CASES) {
      gateCalls.length = 0
      const res = await c.call()
      expect(res.status, c.name).toBe(401)
      expect(gateCalls, c.name).toEqual([])
    }
  })
})

describe('weather-adjusted projections', () => {
  const route = () => import('@/app/api/weather/af-projection/route')
  const one = { playerId: 'p1', playerName: 'A', sport: 'NFL', position: 'WR', baselineProjection: 10 }

  it('was open to anyone; now needs a sign-in', async () => {
    session.mockResolvedValue(null)
    expect((await (await route()).POST(post(one) as never)).status).toBe(401)
    expect(spend).not.toHaveBeenCalled()
  })

  it('opens for either plan that sells it, and refuses neither', async () => {
    expect((await (await route()).POST(post(one) as never)).status).toBe(403)
    expect(gateCalls).toEqual(['pro_af_projections', 'commissioner_weather_projections'])
    expect(spend).not.toHaveBeenCalled()

    allowed = new Set(['commissioner_weather_projections'])
    expect((await (await route()).POST(post(one) as never)).status).toBe(200)
    allowed = new Set(['pro_af_projections'])
    expect((await (await route()).POST(post(one) as never)).status).toBe(200)
  })

  it('caps a batch so one request cannot fan out over a player pool', async () => {
    allowed = new Set(['pro_af_projections'])
    const players = Array.from({ length: 61 }, (_, i) => ({ ...one, playerId: `p${i}` }))
    expect((await (await route()).POST(post({ players }) as never)).status).toBe(400)
    expect(spend).not.toHaveBeenCalled()
    expect((await (await route()).POST(post({ players: players.slice(0, 60) }) as never)).status).toBe(200)
  })
})

describe('dynasty intelligence', () => {
  const get = async (q: string) => (await import('@/app/api/dynasty-intelligence/route')).GET(new Request(`http://x/api/dynasty-intelligence?${q}`) as never)

  it('the AI insight needs a sign-in and the Dynasty Projections plan', async () => {
    session.mockResolvedValue(null)
    expect((await get('sport=NFL&position=WR&ai=1')).status).toBe(401)
    session.mockResolvedValue({ user: { id: 'u1' } })
    expect((await get('sport=NFL&position=WR&ai=1')).status).toBe(403)
    expect(gateCalls).toEqual(['war_room_dynasty_projections'])
    expect(spend).not.toHaveBeenCalled()
  })

  it('the deterministic numbers without ai=1 are unchanged — no sign-in, no gate', async () => {
    session.mockResolvedValue(null)
    const res = await get('sport=NFL&position=WR&age=25&baseValue=5000')
    expect(res.status).toBe(200)
    expect(gateCalls).toEqual([])
  })
})
