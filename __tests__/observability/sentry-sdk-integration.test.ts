// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as Sentry from '@sentry/nextjs'

import { observeDbOperation } from '@/lib/observability/dbTelemetry'
import { annotateJobTrace } from '@/lib/observability/jobTelemetry'
import { buildServerSentryOptions } from '@/lib/observability/serverSentryOptions'

/*
 * THE REAL SDK, NOT A FAKE. The unit suites prove each module against stand-ins; this one proves the
 * claims that only the SDK can falsify — that a slow query becomes a child of the request span, that
 * root-span attributes and tags land on the transaction Sentry would receive, that the sampler is
 * handed the request, and that cookies and credentials are gone from what is actually serialised.
 *
 * Envelopes are captured by an in-memory transport, so nothing leaves the process. The DSN is a
 * syntactically valid placeholder.
 */

type EnvelopeItem = { header: { type?: string }; payload: Record<string, any> }
const items: EnvelopeItem[] = []

function captureEnvelope(body: string | Uint8Array): void {
  const text = typeof body === 'string' ? body : new TextDecoder().decode(body)
  const lines = text.split('\n').filter((line) => line.length > 0)
  for (let i = 1; i + 1 < lines.length; i += 2) {
    items.push({ header: JSON.parse(lines[i]), payload: JSON.parse(lines[i + 1]) })
  }
}

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
const SESSION_JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.c2lnbmF0dXJlLXZhbHVl'
const CRON_SECRET = 'cronSECRETvalue987654'
const RSC_TOKEN = 'riTOKENvalue123456'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

type NormalizedRequest = { url: string; method: string; headers: Record<string, string> }

/** Run `body` as the root span of a request, the way the http integration would present it. */
async function asRequest<T>(request: NormalizedRequest, name: string, body: () => Promise<T>): Promise<{ traceId: string; result: T }> {
  return Sentry.withIsolationScope(async (scope) => {
    scope.setSDKProcessingMetadata({ normalizedRequest: request })
    return Sentry.startSpan({ name, op: 'http.server', forceTransaction: true }, async (span) => ({
      traceId: span.spanContext().traceId,
      result: await body(),
    }))
  })
}

function transactionFor(traceId: string) {
  return items.find((item) => item.header.type === 'transaction' && item.payload.contexts?.trace?.trace_id === traceId)?.payload
}

beforeAll(() => {
  const options = buildServerSentryOptions({
    dsn: 'https://publickey@o1.ingest.sentry.io/1',
    environment: 'production',
    sentry: Sentry,
    env: {},
  })
  Sentry.init({
    ...options,
    transport: (transportOptions) =>
      Sentry.createTransport(transportOptions, async (request) => {
        captureEnvelope(request.body)
        return { statusCode: 200 }
      }),
  } as Parameters<typeof Sentry.init>[0])
})

afterAll(async () => {
  await Sentry.close(2_000)
})

describe('a sampled /core render, through the real SDK', () => {
  it('carries per-request database totals, the screen dimensions, one slow-query child span, and no credentials', async () => {
    const request: NormalizedRequest = {
      url: 'https://www.allfantasy.ai/core/trades?league=cm123',
      method: 'GET',
      headers: {
        'user-agent': IPHONE,
        cookie: `__Secure-next-auth.session-token=${SESSION_JWT}`,
        authorization: `Bearer ${CRON_SECRET}`,
      },
    }
    // Positive control: the request really does carry both secrets going in.
    expect(JSON.stringify(request)).toContain(SESSION_JWT)
    expect(JSON.stringify(request)).toContain(CRON_SECRET)

    const { traceId } = await asRequest(request, 'GET /core/[[...screen]]', async () => {
      await observeDbOperation({ model: 'League', operation: 'findMany' }, async () => {
        await sleep(5)
        return []
      })
      await observeDbOperation({ model: 'WeeklyMatchup', operation: 'findMany' }, async () => {
        await sleep(160)
        return []
      })
      await Sentry.startSpan(
        {
          name: `GET https://rest.datafeeds.rolling-insights.com/api/v1/live/2026-09-14/NFL?RSC_token=${RSC_TOKEN}`,
          op: 'http.client',
          attributes: { 'http.query': `RSC_token=${RSC_TOKEN}` },
        },
        async () => sleep(1),
      )
    })
    await Sentry.flush(2_000)

    const tx = transactionFor(traceId)
    expect(tx, 'the /core render should have been sampled and sent').toBeTruthy()

    const data = tx!.contexts.trace.data
    expect(data['af.db.count']).toBe(2)
    expect(data['af.db.ms']).toBeGreaterThanOrEqual(150)
    expect(data['af.db.slowest']).toBe('WeeklyMatchup.findMany')
    expect(data).toMatchObject({ 'af.surface': 'core', 'af.screen': 'trades', 'af.device': 'mobile', 'af.league_scoped': 'yes' })
    expect(tx!.tags).toMatchObject({ 'af.screen': 'trades', 'af.device': 'mobile' })

    const dbSpans = (tx!.spans as Array<Record<string, any>>).filter((span) => span.op === 'db.prisma')
    expect(dbSpans.map((span) => span.description)).toEqual(['WeeklyMatchup.findMany'])
    expect(dbSpans[0].parent_span_id).toBe(tx!.contexts.trace.span_id)
    expect(dbSpans[0].timestamp - dbSpans[0].start_timestamp).toBeGreaterThanOrEqual(0.15)

    expect(tx!.request?.cookies).toBeUndefined()
    /*
     * ⚠ TWO LAYERS REMOVE THE COOKIE, AND THIS LINE IS THE ONLY ONE THAT TELLS THEM APART. The SDK's
     * `requestDataIntegration({ include: { cookies: false } })` deletes the header KEY; the scrubber in
     * redaction.ts would only have replaced its VALUE with `[Filtered]`. Every other assertion here
     * passed with the SDK layer switched back on (measured by mutation) — without this one, a
     * regression in the first layer would be invisible behind the second.
     */
    expect(tx!.request?.headers).not.toHaveProperty('cookie')
    expect(tx!.request?.headers?.authorization).toBe('[Filtered]')
    const serialised = JSON.stringify(tx)
    expect(serialised).not.toContain(SESSION_JWT)
    expect(serialised).not.toContain(CRON_SECRET)
    expect(serialised).not.toContain(RSC_TOKEN)
  })
})

describe('what is not sampled, through the real SDK', () => {
  it('sends nothing for the healthcheck poll, and database work inside it records nothing', async () => {
    const { traceId } = await asRequest(
      { url: 'https://allfantasy-v2-main-production.up.railway.app/api/af-debug/sha', method: 'GET', headers: { 'user-agent': 'curl/8.4.0' } },
      'GET /api/af-debug/sha',
      async () => observeDbOperation({ model: 'League', operation: 'count' }, async () => sleep(150)),
    )
    await Sentry.flush(2_000)
    expect(transactionFor(traceId)).toBeUndefined()
  })
})

describe('a scheduled job, through the real SDK', () => {
  it('records its trace id for sync_job_runs, and says honestly when a later run was not sampled', async () => {
    const cron: NormalizedRequest = {
      url: 'https://allfantasy-v2-worker-production.up.railway.app/api/cron/morning-briefing',
      method: 'GET',
      headers: { 'user-agent': 'allfantasy-cron-dispatch/1', authorization: `Bearer ${CRON_SECRET}` },
    }

    const first = await asRequest(cron, 'GET /api/cron/morning-briefing', async () => annotateJobTrace('morning-briefing'))
    const second = await asRequest(cron, 'GET /api/cron/morning-briefing', async () => annotateJobTrace('morning-briefing'))
    await Sentry.flush(2_000)

    expect(first.result).toEqual({ traceId: first.traceId, traceSampled: true })
    const tx = transactionFor(first.traceId)
    expect(tx!.contexts.trace.data['af.sync_job']).toBe('morning-briefing')
    expect(tx!.tags).toMatchObject({ 'af.surface': 'job', 'af.job': 'morning-briefing' })
    expect(JSON.stringify(tx)).not.toContain(CRON_SECRET)

    // The job budget is spent: a trace id still exists, but there is no trace to open.
    expect(second.result).toEqual({ traceId: second.traceId, traceSampled: false })
    expect(transactionFor(second.traceId)).toBeUndefined()
  })
})

describe('an error event, through the real SDK', () => {
  it('is tagged with its screen and loses provider tokens and cookies', async () => {
    let eventId = ''
    await Sentry.withIsolationScope(async (scope) => {
      scope.setSDKProcessingMetadata({
        normalizedRequest: {
          url: 'https://www.allfantasy.ai/core/matchup',
          method: 'GET',
          headers: { 'user-agent': IPHONE, cookie: `__Secure-next-auth.session-token=${SESSION_JWT}` },
        },
      })
      eventId = Sentry.captureException(new Error(`fetch failed: https://rest.datafeeds.rolling-insights.com/api/v1/x?RSC_token=${RSC_TOKEN}`))
    })
    await Sentry.flush(2_000)

    const event = items.find((item) => item.header.type === 'event' && item.payload.event_id === eventId)?.payload
    expect(event, 'the error event should have been sent').toBeTruthy()
    expect(event!.tags).toMatchObject({ 'af.screen': 'matchup', 'af.device': 'mobile' })
    expect(event!.request?.cookies).toBeUndefined()
    const serialised = JSON.stringify(event)
    expect(serialised).not.toContain(SESSION_JWT)
    expect(serialised).not.toContain(RSC_TOKEN)
    expect(serialised).toContain('RSC_token=***')
  })
})
