// @vitest-environment node
import { describe, expect, it } from 'vitest'

import {
  PRODUCTION_BUDGETS,
  categoryFor,
  createTracesSampler,
  type TracesSamplerInput,
} from '@/lib/observability/sampling'
import { classifyRequest } from '@/lib/observability/requestContext'

const BROWSER = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
const CRON = 'allfantasy-cron-fast-loop/1'

function request(url: string, headers: Record<string, string> = { 'user-agent': BROWSER }): TracesSamplerInput {
  return { name: 'GET', normalizedRequest: { url, method: 'GET', headers } }
}

/** A controllable clock, so bucket refill is exact rather than timing-dependent. */
function clock(start = 1_000_000) {
  let now = start
  return { now: () => now, advance: (ms: number) => (now += ms) }
}

const HOUR = 3_600_000

describe('categoryFor', () => {
  it('puts a cron dispatch under job even though its user-agent is not a browser', () => {
    expect(categoryFor(classifyRequest({ url: '/api/cron/draft-tick', headers: { 'user-agent': CRON } }))).toBe('job')
  })

  it('sends crawlers to their own tiny budget instead of the page budget', () => {
    expect(categoryFor(classifyRequest({ url: '/players/josh-allen', headers: { 'user-agent': 'Googlebot/2.1' } }))).toBe('bot')
  })
})

describe('createTracesSampler — never traced', () => {
  const sampler = createTracesSampler({ production: true })

  it.each([
    ['the healthcheck poll', request('/api/af-debug/sha')],
    ['a static asset', request('/_next/static/chunks/app.js')],
    ['a router prefetch of a /core screen', request('/core/trades', { 'user-agent': BROWSER, rsc: '1', 'next-router-prefetch': '1' })],
  ])('%s', (_label, input) => {
    expect(sampler(input)).toBe(0)
  })

  it('still refuses health checks and prefetches outside production and in sample-all mode', () => {
    expect(createTracesSampler({ production: false })(request('/api/af-debug/sha'))).toBe(0)
    expect(createTracesSampler({ production: true, sampleAll: true })(request('/core/x', { rsc: '1', 'next-router-prefetch': '1' }))).toBe(0)
  })
})

describe('createTracesSampler — /core renders', () => {
  it('samples every render of a screen up to its hourly budget, then declines, then refills', () => {
    const c = clock()
    const sampler = createTracesSampler({ production: true, now: c.now })
    const perRoute = PRODUCTION_BUDGETS.core.perRoutePerHour

    const decisions = Array.from({ length: perRoute + 5 }, () => sampler(request('/core/trades?league=abc')))
    expect(decisions.slice(0, perRoute).every((d) => d === 1)).toBe(true)
    expect(decisions.slice(perRoute)).toEqual([0, 0, 0, 0, 0])

    // Another screen has its own budget.
    expect(sampler(request('/core/waivers'))).toBe(1)

    // Tokens refill continuously: one route token every HOUR / perRoute.
    c.advance(HOUR / perRoute + 1)
    expect(sampler(request('/core/trades'))).toBe(1)
    expect(sampler(request('/core/trades'))).toBe(0)
  })

  it('is not affected by how the league query is spelled (one screen, one budget)', () => {
    const sampler = createTracesSampler({
      production: true,
      budgets: { ...PRODUCTION_BUDGETS, core: { perRoutePerHour: 2, perCategoryPerHour: 100 } },
      now: clock().now,
    })
    expect([sampler(request('/core/week?league=a')), sampler(request('/core/week?league=b')), sampler(request('/core/week'))]).toEqual([1, 1, 0])
  })
})

describe('createTracesSampler — jobs and the category ceiling', () => {
  it('gives a minute-cadence cron the same small budget as any other job', () => {
    const c = clock()
    const sampler = createTracesSampler({ production: true, now: c.now })
    const fires = Array.from({ length: 60 }, () => {
      const decision = sampler(request('/api/cron/draft-tick', { 'user-agent': CRON }))
      c.advance(60_000)
      return decision
    })
    // 0.5 traces per hour with a capacity of one: the first fire, and nothing more within the hour.
    expect(fires.filter((d) => d === 1)).toHaveLength(1)
    // A different job is not starved by the busy one.
    expect(sampler(request('/api/cron/morning-briefing', { 'user-agent': CRON }))).toBe(1)
  })

  it('stops at the category ceiling without spending route tokens it cannot use', () => {
    const c = clock()
    const budgets = { ...PRODUCTION_BUDGETS, api: { perRoutePerHour: 5, perCategoryPerHour: 2 } }
    const sampler = createTracesSampler({ production: true, budgets, now: c.now })
    expect(sampler(request('/api/a/one'))).toBe(1)
    expect(sampler(request('/api/b/two'))).toBe(1)
    expect(sampler(request('/api/c/three'))).toBe(0) // category exhausted
    // Once the category refills, /api/c still has its full route bucket — the refusal did not drain it.
    c.advance(HOUR / 2 + 1)
    expect(sampler(request('/api/c/three'))).toBe(1)
  })
})

describe('createTracesSampler — parents, environments and failure', () => {
  it('spends from the budget even when the browser parent was sampled', () => {
    const sampler = createTracesSampler({
      production: true,
      budgets: { ...PRODUCTION_BUDGETS, core: { perRoutePerHour: 1, perCategoryPerHour: 10 } },
      now: clock().now,
    })
    expect(sampler({ ...request('/core/home', { rsc: '1' }), parentSampled: true })).toBe(1)
    expect(sampler({ ...request('/core/home', { rsc: '1' }), parentSampled: true })).toBe(0)
  })

  it('samples everything worth tracing outside production, or in sample-all mode', () => {
    expect(createTracesSampler({ production: false })(request('/api/cron/draft-tick'))).toBe(1)
    const incident = createTracesSampler({ production: true, sampleAll: true })
    expect([1, 2, 3].map(() => incident(request('/api/cron/draft-tick', { 'user-agent': CRON })))).toEqual([1, 1, 1])
  })

  it('classifies Next route-handler spans that arrive without a request from their name', () => {
    const c = clock()
    const sampler = createTracesSampler({ production: true, now: c.now })
    expect(sampler({ name: 'GET /app/api/cron/import-scores' })).toBe(1)
    expect(sampler({ name: 'GET /app/api/cron/import-scores' })).toBe(0) // same job budget
  })

  it('returns a small flat RATE (the SDK rolls the dice) for root spans with nothing to classify', () => {
    const sampler = createTracesSampler({ production: true })
    expect(sampler({ name: 'background-task' })).toBe(0.05)
    // A non-string url is "nothing to classify", not the landing page.
    expect(sampler({ normalizedRequest: { url: 42 as unknown as string } })).toBe(0.05)
  })

  it('bounds the route map so an endless crawl cannot grow it without limit', () => {
    const sampler = createTracesSampler({ production: true, maxRouteKeys: 10, now: clock().now })
    for (let i = 0; i < 50; i++) sampler(request(`/api/r${String.fromCharCode(97 + (i % 26))}x/${i}`))
    expect(() => sampler(request('/api/still/works'))).not.toThrow()
  })

  it('declines rather than throwing when reading its input throws', () => {
    const sampler = createTracesSampler({ production: true })
    const hostile = Object.defineProperty({} as TracesSamplerInput, 'normalizedRequest', {
      get() {
        throw new Error('boom')
      },
    })
    expect(sampler(hostile)).toBe(0)
  })
})
