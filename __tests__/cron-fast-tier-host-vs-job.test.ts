import { describe, expect, it } from 'vitest'
// @ts-expect-error -- .mjs script, no types.
import {
  classifyFailure,
  detectHostOutages,
  insideOutage,
  isSystemicFailure,
} from '../scripts/cron-fast-tier-loop.mjs'

/**
 * A workflow that goes red when the HOST blinks is a workflow people stop reading — and this one
 * had already gone red on four scheduled runs in a row.
 *
 * MEASURED 2026-08-24T01:13Z, one 55-minute window: four unrelated jobs (draft-tick,
 * legacy-import-drain, live-score-tick, import-scores) all ended on HTTP 502 within the same
 * minute, while import-scores had succeeded 25 of 27 times moments earlier. That is a redeploy,
 * not four broken routes.
 *
 * In the same window `draft-pool-prewarm` fired 3 times and succeeded 0 — genuinely broken, and it
 * has to stay distinguishable from that noise.
 */

const t = (min: number) => 1_700_000_000_000 + min * 60_000

describe('classifyFailure', () => {
  it('treats gateway statuses as the host', () => {
    for (const s of [502, 503, 504]) expect(classifyFailure(s, `HTTP ${s}`)).toBe('host')
  })

  it('treats dropped connections as the host', () => {
    expect(classifyFailure(null, 'fetch failed')).toBe('host')
    expect(classifyFailure(null, 'ECONNREFUSED 127.0.0.1:8080')).toBe('host')
    expect(classifyFailure(null, 'socket hang up')).toBe('host')
  })

  it('treats application statuses as the job', () => {
    // A 401 or a 404 will not fix itself, and a 500 came out of the handler.
    for (const s of [401, 404, 500]) expect(classifyFailure(s, `HTTP ${s}`)).toBe('job')
  })

  it('treats a timeout as the job, so an always-timing-out route stays visible', () => {
    // draft-pool-prewarm timed out 3/3 while every neighbour answered. Blanket-excusing timeouts
    // as "host" would have hidden the one genuinely broken job in the run.
    expect(classifyFailure(null, 'timed out after 180000ms')).toBe('job')
  })
})

describe('detectHostOutages', () => {
  it('groups simultaneous gateway failures across jobs into one outage', () => {
    const f = [
      { path: '/a', at: t(10), kind: 'host', error: 'HTTP 502' },
      { path: '/b', at: t(10), kind: 'host', error: 'HTTP 502' },
      { path: '/c', at: t(10), kind: 'host', error: 'HTTP 502' },
    ]
    const out = detectHostOutages(f)
    expect(out).toHaveLength(1)
    expect(out[0].paths.size).toBe(3)
  })

  it('does NOT call a single job 502ing an outage', () => {
    // A route that dies mid-request makes the platform return a gateway error for that route
    // alone. Excusing it would let a broken handler hide behind the right status code.
    const f = [
      { path: '/a', at: t(10), kind: 'host', error: 'HTTP 502' },
      { path: '/a', at: t(12), kind: 'host', error: 'HTTP 502' },
      { path: '/a', at: t(14), kind: 'host', error: 'HTTP 502' },
    ]
    expect(detectHostOutages(f)).toEqual([])
  })

  it('keeps far-apart outages separate', () => {
    const f = [
      { path: '/a', at: t(0), kind: 'host', error: 'HTTP 502' },
      { path: '/b', at: t(0), kind: 'host', error: 'HTTP 502' },
      { path: '/a', at: t(40), kind: 'host', error: 'HTTP 502' },
      { path: '/b', at: t(40), kind: 'host', error: 'HTTP 502' },
    ]
    expect(detectHostOutages(f)).toHaveLength(2)
  })

  it('ignores job-class failures entirely', () => {
    const f = [
      { path: '/a', at: t(5), kind: 'job', error: 'HTTP 500' },
      { path: '/b', at: t(5), kind: 'job', error: 'HTTP 500' },
    ]
    expect(detectHostOutages(f)).toEqual([])
  })
})

describe('isSystemicFailure with outages', () => {
  const outage = [{ start: t(30), end: t(31), paths: new Set(['/a', '/b']) }]

  it('does not blame a low-frequency job whose every attempt fell in an outage', () => {
    // fantasy-os-exec-sync fires 3 times in 55 minutes. One outage can consume all three.
    const stat = {
      attempts: 3,
      succeeded: 0,
      failures: [
        { path: '/x', at: t(30), kind: 'host', error: 'HTTP 502' },
        { path: '/x', at: t(30), kind: 'host', error: 'HTTP 502' },
        { path: '/x', at: t(31), kind: 'host', error: 'HTTP 502' },
      ],
    }
    expect(isSystemicFailure(stat, outage)).toBe(false)
  })

  it('STILL flags a route that fails on its own, outside any outage', () => {
    // This is draft-pool-prewarm: 3 fired, 0 ok, timing out while the host was demonstrably up.
    const stat = {
      attempts: 3,
      succeeded: 0,
      failures: [
        { path: '/prewarm', at: t(5), kind: 'job', error: 'timed out after 180000ms' },
        { path: '/prewarm', at: t(15), kind: 'job', error: 'timed out after 180000ms' },
        { path: '/prewarm', at: t(50), kind: 'job', error: 'timed out after 180000ms' },
      ],
    }
    expect(isSystemicFailure(stat, outage)).toBe(true)
  })

  it('never flags a job that succeeded even once', () => {
    const stat = {
      attempts: 27,
      succeeded: 25,
      failures: [{ path: '/import', at: t(55), kind: 'host', error: 'HTTP 502' }],
    }
    expect(isSystemicFailure(stat, outage)).toBe(false)
  })
})

describe('insideOutage', () => {
  const outage = [{ start: t(30), end: t(31), paths: new Set(['/a', '/b']) }]

  it('includes slack either side, since a request starts before it fails', () => {
    expect(insideOutage(t(30), outage)).toBe(true)
    expect(insideOutage(t(29), outage)).toBe(true)
    expect(insideOutage(t(5), outage)).toBe(false)
  })
})
