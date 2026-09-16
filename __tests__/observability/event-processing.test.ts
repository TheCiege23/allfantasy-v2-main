// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { enrichAndScrubEvent, type SentryEventLike } from '@/lib/observability/eventProcessing'
import { buildServerSentryOptions } from '@/lib/observability/serverSentryOptions'

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
const SESSION_JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.c2lnbmF0dXJlLXZhbHVl'
const CRON_SECRET = 'cronSECRETvalue987654'
const RSC_TOKEN = 'riTOKENvalue123456'

function coreTransaction(): SentryEventLike {
  return {
    type: 'transaction',
    request: {
      url: 'https://www.allfantasy.ai/core/trades?league=cm123',
      method: 'GET',
      headers: { 'user-agent': IPHONE, cookie: `__Secure-next-auth.session-token=${SESSION_JWT}`, rsc: '1' },
      cookies: { '__Secure-next-auth.session-token': SESSION_JWT },
    },
    contexts: { trace: { data: { 'af.db.count': 12, 'http.target': `/core/trades?league=cm123` } } },
  }
}

describe('enrichAndScrubEvent', () => {
  it('tags a /core render with screen, device, navigation kind and league scope, on the event and the root span', () => {
    const event = enrichAndScrubEvent(coreTransaction())!
    const expected = {
      'af.surface': 'core',
      'af.screen': 'trades',
      'af.device': 'mobile',
      'af.nav': 'rsc',
      'af.league_scoped': 'yes',
    }
    expect(event.tags).toMatchObject(expected)
    // Root-span attributes are what the spans dataset queries, so they must carry the dimensions too…
    expect(event.contexts?.trace?.data).toMatchObject(expected)
    // …without disturbing the database totals already there.
    expect(event.contexts?.trace?.data?.['af.db.count']).toBe(12)
  })

  it('classifies BEFORE scrubbing: the user-agent is read, then the cookie is gone', () => {
    const input = coreTransaction()
    expect(JSON.stringify(input)).toContain(SESSION_JWT)
    const event = enrichAndScrubEvent(input)!
    expect(event.tags?.['af.device']).toBe('mobile')
    expect(JSON.stringify(event)).not.toContain(SESSION_JWT)
    expect(event.request).not.toHaveProperty('cookies')
  })

  it('prefers a dimension stamped when the span started over one derived when it is sent', () => {
    const event = coreTransaction()
    event.contexts!.trace!.data!['af.screen'] = 'week' // the browser stamped this at start; the user has since moved on
    const out = enrichAndScrubEvent(event)!
    expect(out.tags?.['af.screen']).toBe('week')
    expect(out.contexts?.trace?.data?.['af.screen']).toBe('week')
  })

  it('scrubs a provider token out of an error message, extras and breadcrumbs', () => {
    // Neutral host on purpose: the rule is host-agnostic, and a provider URL literal trips the DB-first guard.
    const url = `https://provider.example/api/v1/live/2026-09-14/NFL?RSC_token=${RSC_TOKEN}`
    const event: SentryEventLike = {
      exception: { values: [{ value: `fetch failed: ${url}` }] },
      extra: { lastUrl: url, attempt: 2 },
      breadcrumbs: [{ data: { url } }],
      request: { url: 'https://worker.example/api/cron/live-score-tick', headers: { authorization: `Bearer ${CRON_SECRET}` } },
    }
    expect(JSON.stringify(event)).toContain(RSC_TOKEN)
    expect(JSON.stringify(event)).toContain(CRON_SECRET)
    const out = enrichAndScrubEvent(event)!
    expect(JSON.stringify(out)).not.toContain(RSC_TOKEN)
    expect(JSON.stringify(out)).not.toContain(CRON_SECRET)
    expect(out.tags).toMatchObject({ 'af.surface': 'job', 'af.job': 'live-score-tick' })
    expect(out.extra?.attempt).toBe(2)
  })

  it('leaves an event without a request untagged but still scrubbed', () => {
    const out = enrichAndScrubEvent({ message: `boom RSC_token=${RSC_TOKEN}` })!
    expect(out.tags).toBeUndefined()
    expect(out.message).not.toContain(RSC_TOKEN)
  })

  it('passes null through', () => {
    expect(enrichAndScrubEvent(null)).toBeNull()
  })
})

/**
 * 🛑 A NUMBER ON THE ROOT SPAN IS SENT BUT NOT QUERYABLE, AND THE TWO ARE INDISTINGUISHABLE UNTIL
 * YOU TRY TO AGGREGATE. Measured off the wire 2026-09-16: `af.shell_ms` and every `af.db.*` really
 * did arrive in `contexts.trace.data` — and Sentry answered "Unknown attribute" to every aggregate,
 * because it indexes a transaction's searchable fields from tags and measurements only. Four of the
 * five budget queries in docs/observability/TRACING.md could not run for that reason.
 */
describe('budget promotion', () => {
  const withTrace = (data: Record<string, unknown>): SentryEventLike => ({
    ...coreTransaction(),
    contexts: { trace: { data: { ...data } } },
  })

  it('promotes the budgetable numbers to measurements, with units', () => {
    const event = enrichAndScrubEvent(
      withTrace({ 'af.shell_ms': 2135, 'af.db.count': 99, 'af.db.ms': 812.5, 'af.db.max_ms': 240.1, 'af.db.errors': 2 }),
    )!
    expect(event.measurements).toEqual({
      'af.shell_ms': { value: 2135, unit: 'millisecond' },
      'af.db.count': { value: 99, unit: 'none' },
      'af.db.ms': { value: 812.5, unit: 'millisecond' },
      'af.db.max_ms': { value: 240.1, unit: 'millisecond' },
      'af.db.errors': { value: 2, unit: 'none' },
    })
  })

  it('leaves the value on the span as well — a single trace must still read correctly', () => {
    const event = enrichAndScrubEvent(withTrace({ 'af.shell_ms': 2135 }))!
    expect(event.contexts?.trace?.data?.['af.shell_ms']).toBe(2135)
  })

  /* `af.sync_job` has the same defect in its string flavour, and needs a tag rather than a measurement. */
  it('promotes af.sync_job to a tag so jobs can be grouped', () => {
    const event = enrichAndScrubEvent(withTrace({ 'af.sync_job': 'trade-grade-notify' }))!
    expect(event.tags?.['af.sync_job']).toBe('trade-grade-notify')
    expect(event.measurements?.['af.sync_job']).toBeUndefined()
  })

  /*
   * ⚠ CLOSED VOCABULARY. Promoting "anything numeric" would put unbounded cardinality in the bill,
   * and `af.db.slowest` is a STRING — a query description — that must never become a measurement.
   */
  it('promotes nothing outside the table, and never a string as a number', () => {
    const event = enrichAndScrubEvent(
      withTrace({ 'af.db.slowest': 'SELECT 1', 'af.db.count': '99', 'some.other.ms': 5, 'af.shell_ms': Number.NaN }),
    )!
    expect(event.measurements).toBeUndefined()
  })

  it('does not touch an error event, which has no measurements', () => {
    const event = enrichAndScrubEvent({ ...withTrace({ 'af.shell_ms': 10 }), type: undefined })!
    expect(event.measurements).toBeUndefined()
  })

  it('never overwrites a measurement the SDK already set', () => {
    const base = withTrace({ 'af.shell_ms': 2135 })
    base.measurements = { 'af.shell_ms': { value: 1, unit: 'millisecond' } }
    expect(enrichAndScrubEvent(base)!.measurements?.['af.shell_ms']).toEqual({ value: 1, unit: 'millisecond' })
  })
})

describe('buildServerSentryOptions', () => {
  const requestDataCalls: unknown[] = []
  const sentry = {
    requestDataIntegration: (options: unknown) => {
      requestDataCalls.push(options)
      return { name: 'RequestData', options }
    },
  }

  it('replaces the flat sample rate with the sampler and turns off cookie and body capture', () => {
    const options = buildServerSentryOptions({ dsn: 'https://k@o1.ingest.sentry.io/1', environment: 'production', sentry, env: {} })
    expect(options).not.toHaveProperty('tracesSampleRate')
    expect(typeof options.tracesSampler).toBe('function')
    expect(requestDataCalls.at(-1)).toEqual({ include: { cookies: false, data: false } })
    expect(options.integrations).toEqual([{ name: 'RequestData', options: { include: { cookies: false, data: false } } }])
    for (const hook of ['beforeSend', 'beforeSendTransaction', 'beforeSendSpan', 'beforeBreadcrumb']) {
      expect(typeof options[hook]).toBe('function')
    }
  })

  it('wires the sampler to the environment: production rations, anything else traces', () => {
    const production = buildServerSentryOptions({ dsn: 'x', environment: 'production', sentry, env: {} })
    const development = buildServerSentryOptions({ dsn: 'x', environment: 'development', sentry, env: {} })
    const input = { normalizedRequest: { url: '/api/cron/draft-tick', headers: { 'user-agent': 'allfantasy-cron-fast-loop/1' } } }
    const sample = (o: Record<string, unknown>) => (o.tracesSampler as (i: unknown) => number)(input)
    expect([sample(production), sample(production)]).toEqual([1, 0])
    expect([sample(development), sample(development)]).toEqual([1, 1])
  })

  it('still builds when the SDK module has no requestDataIntegration', () => {
    const options = buildServerSentryOptions({ dsn: 'x', environment: 'production', sentry: {}, env: {} })
    expect(options.integrations).toEqual([])
  })
})
