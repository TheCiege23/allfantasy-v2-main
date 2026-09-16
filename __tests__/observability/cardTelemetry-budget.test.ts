import { beforeEach, describe, expect, it, vi } from 'vitest'

type Attrs = Record<string, unknown>
let cardSpan: { setAttributes: (a: Attrs) => void; isRecording: () => boolean; own: Attrs } | null = null
let spanClosedAt: number | null = null
let writeAt: number | null = null
let tick = 0

function makeSpan() {
  const own: Attrs = {}
  return {
    own,
    isRecording: () => true,
    setAttributes: (a: Attrs) => {
      writeAt = ++tick
      Object.assign(own, a)
    },
  }
}

vi.mock('@sentry/nextjs', () => ({
  getActiveSpan: () => cardSpan,
  getRootSpan: () => cardSpan,
  startSpan: (_opts: unknown, fn: (s: unknown) => unknown) => {
    const out = fn(cardSpan)
    // Sentry closes the span when the returned promise settles. Record when that happens so the
    // test can prove the attribute write strictly precedes it.
    if (out && typeof (out as Promise<unknown>).then === 'function') {
      return (out as Promise<unknown>).then(
        (v) => {
          spanClosedAt = ++tick
          return v
        },
        (e) => {
          spanClosedAt = ++tick
          throw e
        },
      )
    }
    spanClosedAt = ++tick
    return out
  },
}))

const { traceCard } = await import('@/lib/observability/cardTelemetry')

describe('traceCard budget instrumentation', () => {
  beforeEach(() => {
    cardSpan = makeSpan()
    spanClosedAt = null
    writeAt = null
    tick = 0
  })

  it('writes the budget onto the card span BEFORE the span closes', async () => {
    /*
     * 🛑 THE ORDERING IS THE WHOLE POINT. Attaching a side effect with `.finally` and returning the
     * ORIGINAL promise races the span's own close, and a late attribute write on a closed span is
     * silently dropped — a telemetry bug that leaves no trace anywhere.
     */
    await traceCard('dash34', async () => 'ok')

    expect(cardSpan!.own['af.budget.card_ms']).toBeTypeOf('number')
    expect(writeAt).not.toBeNull()
    expect(spanClosedAt).not.toBeNull()
    expect(writeAt!).toBeLessThan(spanClosedAt!)
  })

  it('still returns the loader’s value untouched', async () => {
    await expect(traceCard('week', async () => ({ n: 1 }))).resolves.toEqual({ n: 1 })
  })

  it('measures a rejection and re-throws it unchanged', async () => {
    const boom = new Error('read failed')
    await expect(traceCard('trades', async () => { throw boom })).rejects.toBe(boom)
    // Dropping a failed read because it threw is how a timeout looks fast in the data.
    expect(cardSpan!.own['af.budget.card_ms']).toBeTypeOf('number')
  })

  it('reaches the caller’s catch for a loader that throws synchronously', async () => {
    const boom = new Error('sync throw')
    await expect(
      traceCard('career', (() => {
        throw boom
      }) as unknown as () => Promise<never>),
    ).rejects.toBe(boom)
  })

  it('never starts the read twice when Sentry itself fails', async () => {
    const sentry = await import('@sentry/nextjs')
    const spy = vi.spyOn(sentry, 'startSpan').mockImplementation(() => {
      throw new Error('sentry down')
    })
    const load = vi.fn(async () => 'once')

    await expect(traceCard('rivals', load)).resolves.toBe('once')
    // The pre-existing guarantee: the fallback hands back the read that already started.
    expect(load).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })
})
