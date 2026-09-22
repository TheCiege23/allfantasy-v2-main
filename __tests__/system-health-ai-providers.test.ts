import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({ probe: vi.fn() }))

vi.mock('@/lib/admin-dashboard/aiProviderEntitlementProbe', () => ({ probeAiProviders: h.probe }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: vi.fn(async () => [{ ok: 1 }]),
    legacyImportJob: { count: vi.fn(async () => 0) },
    sportsInjury: { findFirst: vi.fn(async () => null) },
    sportsNews: { findFirst: vi.fn(async () => null) },
    rankingsSnapshot: { findFirst: vi.fn(async () => null) },
    platformNotification: { findMany: vi.fn(async () => []) },
    league: { findMany: vi.fn(async () => []) },
    appUser: { findMany: vi.fn(async () => []) },
    draftSession: { findMany: vi.fn(async () => []) },
  },
}))
vi.mock('@/lib/admin-dashboard/SportsAlertLatencyResolver', () => ({ getSportsAlertLatency: vi.fn(async () => null) }))
vi.mock('@/lib/clear-sports/client', () => ({
  runClearSportsHealthCheck: vi.fn(async () => ({ configured: true, available: true, checkedAt: 'now' })),
}))
vi.mock('@/lib/clear-sports', () => ({ getClearSportsToolStates: vi.fn(() => ({})) }))
vi.mock('@/lib/sports-router', () => ({ getSportsData: vi.fn(async () => null) }))
vi.mock('@/lib/agents/cache', () => ({ readAgentCache: vi.fn(async () => null), writeAgentCache: vi.fn(async () => {}) }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: vi.fn(async () => {}) }))
vi.mock('@/lib/agents/workers/import-maximizer', () => ({ runImportMaximizer: vi.fn(async () => null) }))

import { getSystemHealth } from '@/lib/admin-dashboard/SystemHealthResolver'
import { runSystemHealthMonitor } from '@/lib/agents/workers/api-health-monitor'

const checkedAt = '2026-09-22T12:00:00.000Z'
/* The production state measured 2026-09-22 with a real 1-token completion per account. */
const MEASURED = [
  { id: 'openai', label: 'OpenAI', state: 'billing', model: 'gpt-4o', httpStatus: 429, detail: 'billing_not_active', checkedAt },
  { id: 'xai', label: 'xAI (Grok)', state: 'billing', model: 'grok-4.5', httpStatus: 403, detail: 'used all available credits', checkedAt },
  { id: 'deepseek', label: 'DeepSeek', state: 'answering', model: 'deepseek-chat', httpStatus: 200, detail: null, checkedAt },
]

const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  for (const k of ['ANTHROPIC_API_KEY', 'ELEVENLABS_API_KEY', 'RESEND_API_KEY', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY']) {
    vi.stubEnv(k, '')
  }
  h.probe.mockResolvedValue(MEASURED)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

const calledHosts = () => fetchMock.mock.calls.map(([u]) => String(u))

/*
 * 🛑 BOTH HEALTH CHECKS CALLED A DEAD AI ACCOUNT HEALTHY. SystemHealthResolver probed /v1/models
 * with no key and counted the 401 as "active"; api-health-monitor probed /models WITH the key,
 * which returns 200 on an account whose billing is inactive. Only a completion tells the truth.
 */
describe('admin SystemHealthResolver', () => {
  it('never reports an AI provider with a billing error as "active"', async () => {
    const { api } = await getSystemHealth()
    expect(api.openai.status).toBe('billing-error')
    expect(api.grok.status).toBe('billing-error')
    expect(api.deepseek.status).toBe('active')
  })

  it('no longer sends the unauthenticated /v1/models request', async () => {
    await getSystemHealth()
    expect(calledHosts().some((u) => u.includes('api.openai.com') || u.includes('api.x.ai'))).toBe(false)
  })

  it('reports "unknown", not "active", when the probe cannot run', async () => {
    h.probe.mockRejectedValue(new Error('boom'))
    const { api } = await getSystemHealth()
    expect(api.openai.status).toBe('unknown')
    expect(api.grok.status).toBe('unknown')
  })

  it('keeps the non-AI provider checks as they were', async () => {
    const { api } = await getSystemHealth()
    expect(api.sleeper.status).toBe('active')
    expect(calledHosts().some((u) => u.includes('api.sleeper.app'))).toBe(true)
  })
})

describe('api-health-monitor (serves /api/system/health)', () => {
  it('reports a billing-dead OpenAI and xAI as down, with the reason, and DeepSeek as up', async () => {
    const snap = await runSystemHealthMonitor({ runImports: false, notifyAdmins: false })
    expect(snap.providers.openai.status).toBe('down')
    expect(snap.providers.openai.details).toMatch(/billing.*rotating the key will not help.*HTTP 429/)
    expect(snap.providers.xai.status).toBe('down')
    expect(snap.providers.deepseek.status).toBe('up')
    expect(snap.overall).toBe('degraded')
    expect(calledHosts().some((u) => u.endsWith('/models'))).toBe(false)
  })

  it('treats a probe that could not run as down/unknown, never up', async () => {
    h.probe.mockRejectedValue(new Error('boom'))
    const snap = await runSystemHealthMonitor({ runImports: false, notifyAdmins: false })
    for (const id of ['openai', 'xai', 'deepseek']) {
      expect(snap.providers[id].status).toBe('down')
      expect(snap.providers[id].details).toMatch(/unknown/)
    }
  })
})
