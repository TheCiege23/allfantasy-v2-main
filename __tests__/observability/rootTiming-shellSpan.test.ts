import { beforeEach, describe, expect, it, vi } from 'vitest'

type SpanOpts = {
  name: string
  op: string
  onlyIfParent?: boolean
  startTime?: Date | number
  attributes?: Record<string, unknown>
}

const created: Array<SpanOpts & { endedAt?: Date | number }> = []
let activeSpanExists = true
let startInactiveThrows = false

vi.mock('@sentry/nextjs', () => ({
  getActiveSpan: () => (activeSpanExists ? {} : null),
  getRootSpan: () => ({ isRecording: () => true, setAttributes: () => undefined }),
  startInactiveSpan: (opts: SpanOpts) => {
    if (startInactiveThrows) throw new Error('sentry down')
    const record: SpanOpts & { endedAt?: Date | number } = { ...opts }
    created.push(record)
    return {
      end: (t?: Date | number) => {
        record.endedAt = t
      },
    }
  },
}))

const { recordCompletedSpan } = await import('@/lib/observability/rootTiming')

const START = 1_700_000_000_000

describe('recordCompletedSpan', () => {
  beforeEach(() => {
    created.length = 0
    activeSpanExists = true
    startInactiveThrows = false
  })

  it('back-dates the span so its duration is the real phase duration', () => {
    /*
     * 🛑 THE DURATION IS THE ENTIRE POINT. The span is the shell phase on the trace's waterfall, and
     * its native `span.duration` aggregates with no typed form (`af.shell_ms` aggregates too, as
     * `tags[af.shell_ms,number]`). A span created at the END without back-dating would read as ~0ms
     * and be worse than no span at all, because it would look like a measurement.
     */
    recordCompletedSpan({ name: 'shell', op: 'core.shell', startedAtMs: START, endedAtMs: START + 1_250 })

    expect(created).toHaveLength(1)
    expect(created[0].startTime).toEqual(new Date(START))
    expect(created[0].endedAt).toEqual(new Date(START + 1_250))
  })

  it('is INACTIVE, so it cannot re-parent the cards that stream behind it', () => {
    // startInactiveSpan does not put itself on the scope. An active shell span would silently
    // re-parent every core.card span under a span that had already ended.
    recordCompletedSpan({ name: 'shell', op: 'core.shell', startedAtMs: START })
    expect(created).toHaveLength(1)
    // The mock only implements startInactiveSpan; a switch to startSpan would throw here.
  })

  it('creates nothing on an unsampled request', () => {
    recordCompletedSpan({ name: 'shell', op: 'core.shell', startedAtMs: START })
    expect(created[0].onlyIfParent).toBe(true)
  })

  it('carries the grouping attributes onto the span itself', () => {
    // So an aggregate query can group without joining back to the root span.
    recordCompletedSpan({
      name: 'shell',
      op: 'core.shell',
      startedAtMs: START,
      attributes: { 'af.screen': 'home', 'af.device': 'mobile' },
    })
    expect(created[0].attributes).toEqual({ 'af.screen': 'home', 'af.device': 'mobile' })
  })

  it('never produces a negative duration when the clock goes backwards', () => {
    recordCompletedSpan({ name: 'shell', op: 'core.shell', startedAtMs: START, endedAtMs: START - 500 })
    expect(created[0].endedAt).toEqual(new Date(START))
  })

  it('never throws when Sentry does', () => {
    // Telemetry must never fail a render.
    startInactiveThrows = true
    expect(() => recordCompletedSpan({ name: 'shell', op: 'core.shell', startedAtMs: START })).not.toThrow()
  })
})
