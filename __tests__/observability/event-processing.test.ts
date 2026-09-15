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
