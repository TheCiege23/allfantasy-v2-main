import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `traceCard` — one span per read that feeds a /core card.
 *
 * The rules that matter are the failure ones: telemetry must never change what the card gets, never
 * run a read twice, and never turn a loader's rejection into a synchronous throw the caller's
 * `.catch` cannot see.
 */

const h = vi.hoisted(() => ({ startSpan: vi.fn() }))
vi.mock('@sentry/nextjs', () => ({ startSpan: h.startSpan }))

import { traceCard } from '@/lib/observability/cardTelemetry'

beforeEach(() => {
  h.startSpan.mockReset()
  // The SDK's behaviour: run the callback and return what it returns.
  h.startSpan.mockImplementation((_options: unknown, callback: () => unknown) => callback())
})

describe('traceCard', () => {
  it('names the span after the read, in a closed vocabulary, only inside a traced request', async () => {
    await expect(traceCard('career', async () => 'career data')).resolves.toBe('career data')
    expect(h.startSpan).toHaveBeenCalledTimes(1)
    expect(h.startSpan.mock.calls[0][0]).toEqual({
      name: 'career',
      op: 'core.card',
      onlyIfParent: true,
      attributes: { 'af.card': 'career' },
    })
  })

  it("hands back the read's own rejection", async () => {
    const failure = new Error('read failed')
    await expect(traceCard('trades', async () => Promise.reject(failure))).rejects.toBe(failure)
  })

  it('turns a loader that throws synchronously into a rejection the caller can catch', async () => {
    const failure = new Error('threw before returning a promise')
    const load = (() => {
      throw failure
    }) as unknown as () => Promise<string>
    const result = traceCard('week', load)
    expect(result).toBeInstanceOf(Promise)
    await expect(result).rejects.toBe(failure)
  })

  it('runs the read untraced when Sentry fails before starting it', async () => {
    h.startSpan.mockImplementation(() => {
      throw new Error('sentry is broken')
    })
    const load = vi.fn(async () => 'still loaded')
    await expect(traceCard('drafts', load)).resolves.toBe('still loaded')
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('never starts the read twice when Sentry fails after starting it', async () => {
    h.startSpan.mockImplementation((_options: unknown, callback: () => unknown) => {
      callback()
      throw new Error('sentry failed while ending the span')
    })
    const load = vi.fn(async () => 'loaded once')
    await expect(traceCard('schedule', load)).resolves.toBe('loaded once')
    expect(load).toHaveBeenCalledTimes(1)
  })
})
