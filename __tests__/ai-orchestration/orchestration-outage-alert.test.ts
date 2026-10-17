import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({
  available: [] as string[],
  chat: vi.fn(),
  reportAllProvidersDown: vi.fn(),
  reportProviderFailure: vi.fn(),
}))

vi.mock('@/lib/ai-orchestration/provider-registry', () => ({
  getAvailableFromRequested: () => h.available,
  getAvailableProviders: () => h.available,
  getProvider: (role: string) => ({ role, chat: h.chat, isAvailable: () => true }),
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

const OPENAI_BILLING = '429 Your account is not active, please check your billing details. billing_not_active'

function request() {
  return {
    envelope: {
      featureType: 'outage_alert_test',
      sport: 'NFL',
      userMessage: 'Who should I start at flex?',
      deterministicPayload: { week: 7, flexCandidates: 2 },
    },
    mode: 'single_model',
    options: { maxRetries: 0, timeoutMs: 2000, skipCache: true },
  } as never
}

beforeEach(() => {
  vi.clearAllMocks()
  h.available = []
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

/*
 * 🛑 THE OUTAGE HAS TO BE VISIBLE ON BOTH SIDES: the owner gets an alert, and the user's
 * reply says it is not an answer. On 2026-09-20 it was neither — the fallback read as a poor
 * answer with a MEDIUM confidence badge, and the only record was a status enum in a log.
 */
describe('when no AI provider answers', () => {
  it('alerts before execution when nothing is available to call', async () => {
    const out = await runUnifiedOrchestration(request())
    expect(h.reportAllProvidersDown).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'before_execution', featureKey: 'outage_alert_test' }),
    )
    expect(out.ok).toBe(true)
    expect(JSON.stringify(out)).toContain("Chimmy's AI models are unavailable right now")
  })

  it('reports each billing failure and then the all-down outage, with a LOW-confidence reply', async () => {
    h.available = ['openai']
    h.chat.mockResolvedValue({ text: '', model: '', provider: 'openai', status: 'failed', error: OPENAI_BILLING })

    const out = await runUnifiedOrchestration(request())

    expect(h.reportProviderFailure).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'openai', detail: OPENAI_BILLING, surface: 'outage_alert_test' }),
    )
    expect(h.reportAllProvidersDown).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'all_calls_failed',
        failures: [expect.objectContaining({ provider: 'openai', detail: OPENAI_BILLING })],
      }),
    )
    expect(out.ok).toBe(true)
    const body = JSON.stringify(out)
    expect(body).toContain("Chimmy's AI models are unavailable right now")
    expect(body).toContain('Deterministic guidance from NFL context')
    const pct = Number(body.match(/"confidencePct":(\d+)/)?.[1] ?? body.match(/"scorePct":(\d+)/)?.[1])
    expect(pct).toBeLessThanOrEqual(35)
  })

  it('does not raise the outage alert when a provider answers', async () => {
    h.available = ['openai']
    h.chat.mockResolvedValue({ text: 'Start Drake London.', model: 'gpt', provider: 'openai', status: 'ok' })
    await runUnifiedOrchestration(request())
    expect(h.reportAllProvidersDown).not.toHaveBeenCalled()
    expect(h.reportProviderFailure).not.toHaveBeenCalled()
  })
})

/*
 * 🛑 THE OUTAGE REPLY NAMES WHAT IT HAD, NEVER A VALUE (2026-09-29). It used to print the
 * deterministic payload as raw `key: value` pairs ("week: 7; flexCandidates: 2") — internal field
 * names and unlabelled numbers presented as guidance.
 */
describe('the outage reply itself', () => {
  function answerText(out: unknown): string {
    const o = out as { data?: { primaryAnswer?: string }; primaryAnswer?: string; response?: { primaryAnswer?: string } }
    const text = o.data?.primaryAnswer ?? o.response?.primaryAnswer ?? o.primaryAnswer
    if (typeof text !== 'string') throw new Error('no primaryAnswer on the result: ' + JSON.stringify(out).slice(0, 300))
    return text
  }

  it('prints no payload value and no raw field name, only readable names of what it had', async () => {
    const text = answerText(await runUnifiedOrchestration(request()))
    expect(text).toContain("Chimmy's AI models are unavailable right now")
    expect(text).toContain('Deterministic guidance from NFL context')
    expect(text).toContain('AI explanation is temporarily unavailable')
    expect(text).toContain('flex candidates')
    expect(text).not.toMatch(/week: 7|flexCandidates|: 2(?![0-9])/)
  })
})
