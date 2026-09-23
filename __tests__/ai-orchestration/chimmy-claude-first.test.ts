import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({
  available: [] as string[],
  chat: vi.fn(),
  reportAllProvidersDown: vi.fn(),
  reportProviderFailure: vi.fn(),
}))

/*
 * A role-aware registry: each role answers through `h.chat(role, request)`. 'anthropic' is kept out
 * of getAvailableProviders exactly as the real registry keeps it out of ROLES.
 */
vi.mock('@/lib/ai-orchestration/provider-registry', () => ({
  getAvailableFromRequested: (roles: string[]) => roles.filter((r) => h.available.includes(r)),
  getAvailableProviders: () => h.available.filter((r) => r !== 'anthropic'),
  getProvider: (role: string) => ({
    role,
    chat: (req: unknown) => h.chat(role, req),
    isAvailable: () => h.available.includes(role),
  }),
}))
vi.mock('@/lib/ai-orchestration/sports-context-enricher', () => ({
  enrichEnvelopeWithSportsData: async (e: unknown) => e,
}))
vi.mock('@/lib/time-engine/userContext', () => ({ buildAiTimeContextPayload: async () => null }))
vi.mock('@/lib/ai-orchestration/tracing', () => ({
  generateTraceId: () => 'trace-test',
  logOrchestrationResult: async () => {},
}))
vi.mock('@/lib/ai-orchestration/providerOutageAlert', () => ({
  reportAllProvidersDown: h.reportAllProvidersDown,
  reportProviderFailure: h.reportProviderFailure,
}))

import { runUnifiedOrchestration } from '@/lib/ai-orchestration/orchestration-service'

function request(featureType: string) {
  return {
    envelope: {
      featureType,
      sport: 'NFL',
      userMessage: 'Who should I start at flex?',
      deterministicPayload: { week: 7, flexCandidates: 2 },
    },
    mode: 'single_model',
    options: { maxRetries: 0, timeoutMs: 2000, skipCache: true },
  } as never
}

const ok = (provider: string, text: string) => ({ text, model: `${provider}-model`, provider, status: 'ok' })
const failed = (provider: string, error: string) => ({ text: '', model: '', provider, status: 'failed', error })

const calledRoles = () => h.chat.mock.calls.map((c) => c[0])

beforeEach(() => {
  vi.clearAllMocks()
  h.available = []
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('Chimmy push path: Claude first, alone', () => {
  it('asks ONLY Claude when Claude answers — no legacy provider is billed', async () => {
    h.available = ['anthropic', 'openai', 'deepseek', 'grok']
    h.chat.mockImplementation(async (role: string) => ok(role, 'Start Drake London.'))

    const out = await runUnifiedOrchestration(request('chimmy_chat'))

    expect(calledRoles()).toEqual(['anthropic'])
    expect(out.ok).toBe(true)
    expect(JSON.stringify(out)).toContain('Start Drake London.')
    expect(h.reportAllProvidersDown).not.toHaveBeenCalled()
  })

  it('gives Claude a longer ceiling than the legacy 25s-style timeout', async () => {
    h.available = ['anthropic']
    h.chat.mockImplementation(async (role: string) => ok(role, 'ok'))

    await runUnifiedOrchestration(request('chimmy_chat'))

    expect(h.chat.mock.calls[0][1].timeoutMs).toBeGreaterThanOrEqual(45_000)
  })

  it('falls back to the legacy providers only when Claude fails, and reports Claude', async () => {
    h.available = ['anthropic', 'openai']
    h.chat.mockImplementation(async (role: string) =>
      role === 'anthropic' ? failed('anthropic', 'credit balance is too low') : ok(role, 'Legacy answer.'),
    )

    const out = await runUnifiedOrchestration(request('chimmy_chat'))

    expect(calledRoles()[0]).toBe('anthropic')
    expect(calledRoles()).toContain('openai')
    expect(JSON.stringify(out)).toContain('Legacy answer.')
    expect(h.reportProviderFailure).toHaveBeenCalledWith(expect.objectContaining({ provider: 'anthropic' }))
    expect(h.reportAllProvidersDown).not.toHaveBeenCalled()
  })

  it('declares the outage only when Claude AND the legacy set all fail', async () => {
    h.available = ['anthropic', 'openai']
    h.chat.mockImplementation(async (role: string) => failed(role, 'down'))

    const out = await runUnifiedOrchestration(request('chimmy_chat'))

    expect(calledRoles()).toEqual(['anthropic', 'openai'])
    expect(h.reportAllProvidersDown).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'all_calls_failed',
        failures: [expect.objectContaining({ provider: 'anthropic' }), expect.objectContaining({ provider: 'openai' })],
      }),
    )
    expect(JSON.stringify(out)).toContain("Chimmy's AI models are unavailable right now")
  })

  it('without an Anthropic key, runs the legacy routing exactly as before', async () => {
    h.available = ['openai', 'deepseek', 'grok']
    h.chat.mockImplementation(async (role: string) => ok(role, 'Legacy answer.'))

    await runUnifiedOrchestration(request('chimmy_chat'))

    expect(calledRoles()).not.toContain('anthropic')
    expect(calledRoles().length).toBeGreaterThan(0)
  })
})

describe('other AI features are not moved to Claude', () => {
  it('a non-Chimmy feature never calls Claude, even with its key configured', async () => {
    h.available = ['anthropic', 'openai']
    h.chat.mockImplementation(async (role: string) => ok(role, 'answer'))

    await runUnifiedOrchestration(request('some_other_tool'))

    expect(calledRoles()).not.toContain('anthropic')
  })
})
