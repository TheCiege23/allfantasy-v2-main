import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const resendSend = vi.hoisted(() => vi.fn(async () => ({ ok: true })))
vi.mock('@/lib/resend-client', () => ({ sendNotificationEmail: resendSend }))

import {
  classifyProviderFailure,
  reportAllProvidersDown,
  reportProviderFailure,
  __resetProviderOutageAlertsForTests,
} from '@/lib/ai-orchestration/providerOutageAlert'

/*
 * The provider responses below are the ones measured from production accounts on 2026-09-20
 * and 2026-09-22 — not invented shapes. xAI's is the one that matters most: exhausted credits
 * arrive as a 403 "permission-denied", which a naive status check reads as a bad key.
 */
const OPENAI_BILLING =
  '429 Your account is not active, please check your billing details on our website. billing_not_active'
const XAI_CREDITS =
  '403 Your team d55d831f has either used all available credits or reached its monthly spending limit.'

const send = vi.fn(async () => ({ ok: true }))
const HOUR = 3_600_000

beforeEach(() => {
  vi.clearAllMocks()
  __resetProviderOutageAlertsForTests(send)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('classifyProviderFailure', () => {
  it.each([
    [429, OPENAI_BILLING, 'billing'],
    [403, XAI_CREDITS, 'billing'],
    ['failed', XAI_CREDITS, 'billing'],
    [402, 'Payment Required', 'billing'],
    [401, 'Incorrect API key provided', 'auth'],
    ['failed', 'invalid_api_key', 'auth'],
    [429, 'Rate limit reached for requests', 'other'],
    ['timeout', 'Request timed out', 'other'],
    [500, 'Internal server error', 'other'],
    [503, 'no key', 'other'],
  ] as const)('%s %s -> %s', (status, detail, kind) => {
    expect(classifyProviderFailure(status, detail)).toBe(kind)
  })
})

describe('reportProviderFailure', () => {
  it('emails once per provider+kind per window, then again after it', () => {
    const t0 = Date.parse('2026-09-22T12:00:00Z')
    reportProviderFailure({ provider: 'grok', status: 403, detail: XAI_CREDITS, surface: 'chimmy_tool_loop', now: t0 })
    reportProviderFailure({ provider: 'grok', status: 403, detail: XAI_CREDITS, surface: 'chimmy_live_search', now: t0 + HOUR })
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0]).toContain('grok')
    expect(send.mock.calls[0][1]).toContain('Rotating the key will not help')

    reportProviderFailure({ provider: 'grok', status: 403, detail: XAI_CREDITS, surface: 'chimmy_tool_loop', now: t0 + 7 * HOUR })
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('throttles each provider independently', () => {
    reportProviderFailure({ provider: 'grok', status: 403, detail: XAI_CREDITS, surface: 's', now: 0 })
    reportProviderFailure({ provider: 'openai', status: 429, detail: OPENAI_BILLING, surface: 's', now: 0 })
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('does not alert on a transient failure', () => {
    const kind = reportProviderFailure({ provider: 'openai', status: 429, detail: 'Rate limit reached', surface: 's' })
    expect(kind).toBe('other')
    expect(send).not.toHaveBeenCalled()
    expect(console.error).not.toHaveBeenCalled()
  })

  it('redacts credentials from the log line and the email', () => {
    /* Assembled at runtime so no key-shaped literal sits in a public repo for scanners to flag. */
    const key = ['sk', 'proj', 'X'.repeat(40)].join('-')
    const detail = `billing_not_active for api_key=${key} at /v1/x?RSC_token=supersecrettoken123456`
    reportProviderFailure({ provider: 'openai', status: 429, detail, surface: 's' })
    const logged = String((console.error as ReturnType<typeof vi.fn>).mock.calls[0][0])
    const emailed = String(send.mock.calls[0][1])
    for (const out of [logged, emailed]) {
      expect(out).not.toContain(key)
      expect(out).not.toContain('supersecrettoken123456')
    }
  })

  it('never lets a sender that throws synchronously escape', () => {
    __resetProviderOutageAlertsForTests(() => {
      throw new Error('boom')
    })
    expect(() =>
      reportProviderFailure({ provider: 'grok', status: 403, detail: XAI_CREDITS, surface: 's' }),
    ).not.toThrow()
  })
})

describe('reportAllProvidersDown', () => {
  it('always logs, and emails at most once an hour', () => {
    const failures = [
      { provider: 'openai', detail: OPENAI_BILLING },
      { provider: 'grok', detail: XAI_CREDITS },
      { provider: 'deepseek', detail: 'invalid_response' },
    ]
    reportAllProvidersDown({ featureKey: 'chimmy_chat', stage: 'all_calls_failed', failures, now: 0 })
    reportAllProvidersDown({ featureKey: 'chimmy_chat', stage: 'all_calls_failed', failures, now: HOUR / 2 })
    expect(console.error).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0]).toMatch(/ALL AI providers are down/)
    expect(send.mock.calls[0][1]).toContain('deepseek')

    reportAllProvidersDown({ featureKey: 'chimmy_chat', stage: 'all_calls_failed', failures, now: HOUR + 1 })
    expect(send).toHaveBeenCalledTimes(2)
  })
})

describe('under vitest with no sender installed', () => {
  /* The guard that keeps every OTHER suite from emailing the owner via the production .env. */
  it('sends nothing', () => {
    __resetProviderOutageAlertsForTests(null)
    resendSend.mockClear()
    reportAllProvidersDown({ featureKey: 'chimmy_chat', stage: 'all_calls_failed', failures: [] })
    reportProviderFailure({ provider: 'grok', status: 403, detail: XAI_CREDITS, surface: 's' })
    expect(resendSend).not.toHaveBeenCalled()
  })
})
