import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The daily Stripe key check (lib/billing/stripeKeyHealth.ts + /api/cron/stripe-key-health).
 * Exists because the live key expired and checkout was down for about a month with nothing saying so.
 */

const { sendEmail, heartbeats } = vi.hoisted(() => ({
  sendEmail: vi.fn(),
  heartbeats: [] as Array<{ jobName: string; outcome: any }>,
}))
vi.mock('@/lib/resend-client', () => ({ sendNotificationEmail: sendEmail }))
// The real wrapper writes sync_job_runs; here it runs the job and records what it would have written.
vi.mock('@/lib/production-health/syncJobRunTelemetry', () => ({
  withSyncJobRun: async (ctx: { jobName: string }, fn: () => Promise<unknown>, extract?: (r: any) => unknown) => {
    const result = await fn()
    heartbeats.push({ jobName: ctx.jobName, outcome: extract ? extract(result) : {} })
    return result
  },
}))

import { checkStripeKeyHealth, stripeKeyMode } from '@/lib/billing/stripeKeyHealth'

const LIVE = 'sk_live_' + 'x'.repeat(40)
const env = (over: Record<string, string | undefined> = {}) =>
  ({ NODE_ENV: 'production', STRIPE_SECRET_KEY: LIVE, ...over }) as unknown as NodeJS.ProcessEnv
const client = (retrieve: () => Promise<unknown>) => () => ({ accounts: { retrieve } }) as any
const stripeError = (type: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(`${type}: Expired API Key provided: ${LIVE.slice(0, 12)}****`), { type, ...extra })

describe('checkStripeKeyHealth', () => {
  it('is ok when Stripe accepts the key and charges are enabled', async () => {
    const r = await checkStripeKeyHealth({ env: env(), makeClient: client(async () => ({ id: 'acct_1', charges_enabled: true })) })
    expect(r).toEqual({ state: 'ok', mode: 'live', accountId: 'acct_1' })
  })

  it('🛑 an EXPIRED key is a definitive problem — the 2026-11-16 outage', async () => {
    const r = await checkStripeKeyHealth({
      env: env(),
      makeClient: client(async () => { throw stripeError('StripeAuthenticationError', { code: 'api_key_expired', statusCode: 401 }) }),
    })
    expect(r.state).toBe('problem')
    expect(r).toMatchObject({ reason: expect.stringMatching(/EXPIRED/) })
  })

  it('an invalid or revoked key is a definitive problem', async () => {
    const r = await checkStripeKeyHealth({
      env: env(),
      makeClient: client(async () => { throw stripeError('StripeAuthenticationError', { statusCode: 401 }) }),
    })
    expect(r).toMatchObject({ state: 'problem', reason: expect.stringMatching(/rejected/) })
  })

  it('a missing key is a problem, and Stripe is never called', async () => {
    const retrieve = vi.fn()
    const r = await checkStripeKeyHealth({ env: env({ STRIPE_SECRET_KEY: '' }), makeClient: client(retrieve) })
    expect(r).toMatchObject({ state: 'problem', mode: 'unset' })
    expect(retrieve).not.toHaveBeenCalled()
  })

  it('a TEST key in production is a problem', async () => {
    const r = await checkStripeKeyHealth({ env: env({ STRIPE_SECRET_KEY: 'sk_test_abc' }), makeClient: client(async () => ({ id: 'a' })) })
    expect(r).toMatchObject({ state: 'problem', mode: 'test' })
  })

  it('charges disabled by Stripe is a problem even though the key works', async () => {
    const r = await checkStripeKeyHealth({
      env: env(),
      makeClient: client(async () => ({ id: 'a', charges_enabled: false, requirements: { disabled_reason: 'rejected.fraud' } })),
    })
    expect(r).toMatchObject({ state: 'problem', reason: expect.stringMatching(/rejected\.fraud/) })
  })

  it('a restricted key without account access still authenticated — ok, not an outage', async () => {
    const r = await checkStripeKeyHealth({
      env: env({ STRIPE_SECRET_KEY: 'rk_live_abc' }),
      makeClient: client(async () => { throw stripeError('StripePermissionError', { statusCode: 403 }) }),
    })
    expect(r).toMatchObject({ state: 'ok', mode: 'restricted-live' })
  })

  it('Stripe unreachable or 5xx is inconclusive, not a key problem', async () => {
    for (const err of [stripeError('StripeConnectionError'), stripeError('StripeAPIError', { statusCode: 500 })]) {
      const r = await checkStripeKeyHealth({ env: env(), makeClient: client(async () => { throw err }) })
      expect(r.state).toBe('inconclusive')
    }
  })

  it('never puts the key in its result', async () => {
    const r = await checkStripeKeyHealth({
      env: env(),
      makeClient: client(async () => { throw stripeError('StripeAuthenticationError', { code: 'api_key_expired' }) }),
    })
    expect(JSON.stringify(r)).not.toMatch(/sk_live|x{10}/)
  })

  it('names the key mode from its prefix only', () => {
    expect(['sk_live_a', 'sk_test_a', 'rk_live_a', 'rk_test_a', 'pk_live_a', '', undefined].map(stripeKeyMode)).toEqual([
      'live', 'test', 'restricted-live', 'restricted-test', 'unrecognised', 'unset', 'unset',
    ])
  })
})

describe('GET /api/cron/stripe-key-health', () => {
  const SECRET = 'cron-secret-test'
  const saved = { ...process.env }
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    sendEmail.mockReset().mockResolvedValue({ ok: true })
    heartbeats.length = 0
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    process.env.CRON_SECRET = SECRET
    process.env.RAILWAY_SERVICE_NAME = 'allfantasy-v2-worker'
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.doUnmock('@/lib/billing/stripeKeyHealth')
    process.env = { ...saved }
  })

  async function call(selfHealth: unknown, query = '') {
    vi.doMock('@/lib/billing/stripeKeyHealth', () => ({ checkStripeKeyHealth: vi.fn(async () => selfHealth) }))
    const { GET } = await import('@/app/api/cron/stripe-key-health/route')
    const { NextRequest } = await import('next/server')
    return GET(new NextRequest(`http://worker.test/api/cron/stripe-key-health${query}`, { headers: { authorization: `Bearer ${SECRET}` } }))
  }
  const webAnswers = (health: unknown, status = 200) =>
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ service: 'allfantasy-v2-main', health }), { status }))
  const OK = { state: 'ok', mode: 'live', accountId: 'acct_1' }

  it('refuses a caller without the cron secret', async () => {
    vi.doMock('@/lib/billing/stripeKeyHealth', () => ({ checkStripeKeyHealth: vi.fn() }))
    const { GET } = await import('@/app/api/cron/stripe-key-health/route')
    const { NextRequest } = await import('next/server')
    const res = await GET(new NextRequest('http://worker.test/api/cron/stripe-key-health'))
    expect(res.status).toBe(401)
  })

  it('200 and no email when both the worker and the web keys are fine', async () => {
    webAnswers(OK)
    const res = await call(OK)
    expect(res.status).toBe(200)
    expect(sendEmail).not.toHaveBeenCalled()
    expect(fetchMock.mock.calls[0]![0]).toBe('https://www.allfantasy.ai/api/cron/stripe-key-health?scope=self')
  })

  it("🛑 the WEB service's expired key is caught even when the worker's key is fine", async () => {
    webAnswers({ state: 'problem', mode: 'live', reason: 'The Stripe secret key has EXPIRED, so checkout is failing.' })
    const res = await call(OK)
    expect(res.status).toBe(503)
    expect(sendEmail).toHaveBeenCalledTimes(1)
    const mail = sendEmail.mock.calls[0]![0]
    expect(mail.to).toBe('allfantasysportsapp@gmail.com')
    expect(mail.bodyHtml).toMatch(/allfantasy-v2-main: The Stripe secret key has EXPIRED/)
  })

  it("the worker's own problem is emailed too", async () => {
    webAnswers(OK)
    const res = await call({ state: 'problem', mode: 'unset', reason: 'STRIPE_SECRET_KEY is not set, so checkout cannot start.' })
    expect(res.status).toBe(503)
    expect(sendEmail.mock.calls[0]![0].bodyHtml).toMatch(/allfantasy-v2-worker: STRIPE_SECRET_KEY is not set/)
  })

  it('a web service that refuses the secret is a problem: its key would go unmonitored', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"error":"Unauthorized"}', { status: 401 }))
    const res = await call(OK)
    expect(res.status).toBe(503)
    expect(sendEmail.mock.calls[0]![0].bodyHtml).toMatch(/CRON_SECRET differs/)
  })

  it('a Stripe blip or an unreachable web service turns the run red but emails nobody', async () => {
    fetchMock.mockRejectedValueOnce(new Error('timeout'))
    const res = await call({ state: 'inconclusive', mode: 'live', reason: 'Could not reach Stripe' })
    expect(res.status).toBe(503)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('?scope=self only reports this service — no web call, no email, even with a problem', async () => {
    const res = await call({ state: 'problem', mode: 'live', reason: 'expired' }, '?scope=self')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ service: 'allfantasy-v2-worker', health: { state: 'problem' } })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('🛑 records a heartbeat for the freshness monitor: success / partial / failed', async () => {
    webAnswers(OK)
    await call(OK)
    expect(heartbeats).toEqual([expect.objectContaining({ jobName: 'cron-stripe-key-health' })])
    expect(heartbeats[0]!.outcome.status).toBe('success')

    heartbeats.length = 0
    fetchMock.mockRejectedValueOnce(new Error('timeout'))
    await call({ state: 'inconclusive', mode: 'live', reason: 'Could not reach Stripe' })
    expect(heartbeats[0]!.outcome.status).toBe('partial')

    heartbeats.length = 0
    webAnswers({ state: 'problem', mode: 'live', reason: 'The Stripe secret key has EXPIRED, so checkout is failing.' })
    await call(OK)
    expect(heartbeats[0]!.outcome).toMatchObject({
      status: 'failed',
      errors: ['allfantasy-v2-main: The Stripe secret key has EXPIRED, so checkout is failing.'],
    })
    expect(JSON.stringify(heartbeats)).not.toMatch(/sk_live|sk_test/)
  })

  it("?scope=self records no heartbeat — only the worker's scheduled run proves the job fires", async () => {
    await call(OK, '?scope=self')
    expect(heartbeats).toEqual([])
  })

  it('on the web service itself it does not call itself', async () => {
    process.env.RAILWAY_SERVICE_NAME = 'allfantasy-v2-main'
    const res = await call(OK)
    expect(res.status).toBe(200)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
