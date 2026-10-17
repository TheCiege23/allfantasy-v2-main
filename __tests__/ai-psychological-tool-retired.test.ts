/**
 * Milestone 32 (owner decision 2026-09-29): manager characterisation is shown to
 * nobody. The unified tool registry listed a `psychological` tool ("Psychological
 * System") on GET /api/ai/tools, and /api/ai/run and /api/ai/compare would run it —
 * an LLM explanation of a caller-supplied manager profile. It is retired: not
 * listed, and refused before any provider is called, under every alias.
 *
 * Each refusal is paired with a positive control through the same route, so a
 * test cannot pass because the route refuses everything.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  runUnifiedOrchestration: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: h.getServerSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/ai-orchestration', () => ({ runUnifiedOrchestration: h.runUnifiedOrchestration }))

const PSYCH_ALIASES = [
  'psychological',
  'psychology',
  'psychological_profiles',
  'psychological-system',
  'Psychological System',
]

const PROFILE_CONTEXT = {
  profile: { style: 'aggressive', risk: 'high' },
  evidence: ['Trade frequency above league median'],
}

const RANKINGS_CONTEXT = { ordering: ['Team A', 'Team B'], tiers: { tier1: ['Team A'] } }

function post(url: string, body: Record<string, unknown>): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.getServerSession.mockResolvedValue({ user: { id: 'user-1' } })
  // A provider-side failure: enough for the control to prove orchestration was reached.
  h.runUnifiedOrchestration.mockResolvedValue({
    ok: false,
    status: 503,
    error: { code: 'provider_unavailable', message: 'down', userMessage: 'down', provider: 'openai', traceId: 't' },
  })
})

describe('registry — the psychological tool is retired', () => {
  it('is absent from the registry and unsupported under every alias', async () => {
    const { getAIToolRegistry, getToolRegistration, validateToolRequest } = await import(
      '@/lib/ai-tool-registry'
    )
    const keys = getAIToolRegistry().map((t) => t.toolKey)
    expect(keys).toContain('rankings')
    expect(keys.filter((k) => /psych/i.test(k))).toEqual([])
    expect(getAIToolRegistry().filter((t) => /psych/i.test(t.toolName))).toEqual([])
    for (const alias of PSYCH_ALIASES) {
      expect(getToolRegistration(alias)).toBeNull()
      expect(validateToolRequest(alias, PROFILE_CONTEXT).error).toMatch(/Unsupported tool/)
    }
  })
})

describe('GET /api/ai/tools', () => {
  it('lists no psychological tool', async () => {
    const { GET } = await import('@/app/api/ai/tools/route')
    const res = await GET()
    const body = (await res.json()) as { tools: Array<{ toolKey: string; toolName: string }> }
    expect(body.tools.map((t) => t.toolKey)).toContain('trade_analyzer')
    expect(JSON.stringify(body.tools)).not.toMatch(/psycholog/i)
  })
})

describe.each([
  ['/api/ai/run', () => import('@/app/api/ai/run/route')],
  ['/api/ai/compare', () => import('@/app/api/ai/compare/route')],
])('POST %s', (path, load) => {
  it('control: a registered tool reaches orchestration', async () => {
    const { POST } = await load()
    await POST(post(`http://localhost${path}`, { tool: 'rankings', sport: 'NFL', deterministicContext: RANKINGS_CONTEXT }))
    expect(h.runUnifiedOrchestration).toHaveBeenCalledTimes(1)
  })

  it.each(PSYCH_ALIASES)('refuses tool "%s" with 400 and never calls a provider', async (alias) => {
    const { POST } = await load()
    const res = await POST(post(`http://localhost${path}`, { tool: alias, sport: 'NFL', deterministicContext: PROFILE_CONTEXT }))
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message?: string }).message).toMatch(/Unsupported tool/)
    expect(h.runUnifiedOrchestration).not.toHaveBeenCalled()
  })
})
