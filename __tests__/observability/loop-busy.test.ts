// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * `af.loop.busy_pct` — how busy the server thread was while a /core card waited (2026-10-07).
 *
 * The reading exists to separate "waited on CPU" from "waited on I/O", so it is tested from both
 * sides: a window spent spinning must read high and a window spent idle must read low. A reading
 * that only ever came back one way could not tell the two apart.
 */

const h = vi.hoisted(() => ({ startSpan: vi.fn() }))
vi.mock('@sentry/nextjs', () => ({ startSpan: h.startSpan }))

import { loopBusyPctSince, markLoop } from '@/lib/observability/loopBusy'
import { traceCard } from '@/lib/observability/cardTelemetry'

function spin(ms: number) {
  const end = performance.now() + ms
  while (performance.now() < end) {
    // Busy on purpose: this is the CPU-bound window.
  }
}

const idle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

afterEach(() => {
  vi.unstubAllGlobals()
  h.startSpan.mockReset()
})

describe('loopBusyPctSince', () => {
  it('reads HIGH over a window the thread spent computing', () => {
    const mark = markLoop()
    expect(mark).not.toBeNull()
    spin(80)
    expect(loopBusyPctSince(mark)).toBeGreaterThanOrEqual(80)
  })

  it('reads LOW over a window the thread spent waiting', async () => {
    const mark = markLoop()
    await idle(150)
    expect(loopBusyPctSince(mark)).toBeLessThan(40)
  })

  it('is a whole percent between 0 and 100', () => {
    const mark = markLoop()
    spin(5)
    const pct = loopBusyPctSince(mark)!
    expect(Number.isInteger(pct)).toBe(true)
    expect(pct).toBeGreaterThanOrEqual(0)
    expect(pct).toBeLessThanOrEqual(100)
  })

  it('is null, never a throw, where the runtime cannot measure (a browser has performance without it)', () => {
    vi.stubGlobal('performance', { now: () => 0 })
    expect(markLoop()).toBeNull()
    expect(loopBusyPctSince(null)).toBeNull()
    expect(loopBusyPctSince({ idle: 0, active: 0, utilization: 0 })).toBeNull()
  })
})

describe('traceCard stamps the card span', () => {
  it('writes af.loop.busy_pct on the card span, high for a card that computed', async () => {
    const span = { setAttribute: vi.fn() }
    h.startSpan.mockImplementation((_options: unknown, callback: (s: unknown) => unknown) => callback(span))
    await expect(
      traceCard('trades', async () => {
        spin(60)
        return 'traded'
      }),
    ).resolves.toBe('traded')
    const call = span.setAttribute.mock.calls.find(([key]) => key === 'af.loop.busy_pct')
    expect(call, 'the card span carries the reading').toBeTruthy()
    expect(call![1]).toBeGreaterThanOrEqual(80)
  })

  it('reads low for a card that only waited', async () => {
    const span = { setAttribute: vi.fn() }
    h.startSpan.mockImplementation((_options: unknown, callback: (s: unknown) => unknown) => callback(span))
    await traceCard('drafts', () => idle(150).then(() => 'waited'))
    const call = span.setAttribute.mock.calls.find(([key]) => key === 'af.loop.busy_pct')
    expect(call![1]).toBeLessThan(40)
  })

  it('still hands the card its value when the SDK passes no span', async () => {
    h.startSpan.mockImplementation((_options: unknown, callback: () => unknown) => callback())
    await expect(traceCard('week', async () => 'week data')).resolves.toBe('week data')
  })
})
