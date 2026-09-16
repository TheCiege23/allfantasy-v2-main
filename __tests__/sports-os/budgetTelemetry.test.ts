import { beforeEach, describe, expect, it, vi } from 'vitest'

type Attrs = Record<string, unknown>
const rootAttrs: Attrs = {}
const spanAttrs: Attrs[] = []

let activeSpan: { setAttributes: (a: Attrs) => void; isRecording: () => boolean } | null = null
let rootRecording = true

vi.mock('@sentry/nextjs', () => ({
  getActiveSpan: () => activeSpan,
  getRootSpan: () => ({
    isRecording: () => rootRecording,
    setAttributes: (a: Attrs) => Object.assign(rootAttrs, a),
  }),
}))

const { recordBudget, recordBudgetOnActiveSpan, recordBudgetSince, measure } = await import(
  '@/lib/sports-os/budgetTelemetry'
)

function makeSpan(recording = true) {
  const own: Attrs = {}
  spanAttrs.push(own)
  return { setAttributes: (a: Attrs) => Object.assign(own, a), isRecording: () => recording, own }
}

describe('sports-os budget telemetry', () => {
  beforeEach(() => {
    for (const k of Object.keys(rootAttrs)) delete rootAttrs[k]
    spanAttrs.length = 0
    rootRecording = true
    activeSpan = makeSpan()
  })

  it('writes phase, verdict and ratio on the root span', () => {
    recordBudget({ phase: 'shell', device: 'desktop' }, 5_000)
    expect(rootAttrs['af.budget.shell_ms']).toBe(5_000)
    expect(rootAttrs['af.budget.shell_verdict']).toBe('over')
    expect(typeof rootAttrs['af.budget.shell_ratio']).toBe('number')
  })

  it('keeps each repeated occurrence on its OWN span', () => {
    /*
     * 🛑 THE REASON THE SPAN-SCOPED VARIANT EXISTS. The attribute name is keyed on the PHASE, so
     * nineteen cards writing `af.budget.card_ms` to one root span is not nineteen measurements —
     * it is one measurement of whichever card happened to finish last.
     */
    const a = makeSpan()
    activeSpan = a
    recordBudgetOnActiveSpan({ phase: 'card', name: 'dash34' }, 100)

    const b = makeSpan()
    activeSpan = b
    recordBudgetOnActiveSpan({ phase: 'card', name: 'week' }, 9_000)

    expect(a.own['af.budget.card_ms']).toBe(100)
    expect(b.own['af.budget.card_ms']).toBe(9_000)
    // The root span must be untouched by a per-occurrence write.
    expect(rootAttrs['af.budget.card_ms']).toBeUndefined()
  })

  it('applies the per-card override, so a fan-out read is not judged as one card', () => {
    const a = makeSpan()
    activeSpan = a
    // `dash34` feeds eight cards from one read and has a wider budget than a single card.
    recordBudgetOnActiveSpan({ phase: 'card', name: 'dash34' }, 1_100)
    expect(a.own['af.budget.card_verdict']).toBe('within')

    const b = makeSpan()
    activeSpan = b
    recordBudgetOnActiveSpan({ phase: 'card', name: 'week' }, 1_100)
    expect(b.own['af.budget.card_verdict']).toBe('warn')
  })

  it('never throws and still returns a verdict when there is no span at all', () => {
    activeSpan = null
    expect(recordBudget({ phase: 'shell' }, 100).verdict).toBe('within')
    expect(recordBudgetOnActiveSpan({ phase: 'card' }, 100).verdict).toBe('within')
    expect(rootAttrs['af.budget.shell_ms']).toBeUndefined()
  })

  it('skips a span that is no longer recording rather than writing to it', () => {
    const closed = makeSpan(false)
    activeSpan = closed
    recordBudgetOnActiveSpan({ phase: 'card' }, 100)
    expect(closed.own['af.budget.card_ms']).toBeUndefined()

    rootRecording = false
    activeSpan = makeSpan()
    recordBudget({ phase: 'shell' }, 100)
    expect(rootAttrs['af.budget.shell_ms']).toBeUndefined()
  })

  it('survives a Sentry that throws', () => {
    activeSpan = {
      isRecording: () => true,
      setAttributes: () => {
        throw new Error('sentry exploded')
      },
    }
    // Telemetry must never fail a render.
    expect(() => recordBudgetOnActiveSpan({ phase: 'card' }, 100)).not.toThrow()
  })

  it('measures from a start instant', () => {
    recordBudgetSince({ phase: 'shell', device: 'desktop' }, 1_000, 1_350)
    expect(rootAttrs['af.budget.shell_ms']).toBe(350)
  })

  it('measures a rejection and re-throws it unchanged', async () => {
    // A read that fails after nine seconds is the most over-budget thing on the page; dropping it
    // because it threw is how a timeout looks fast in the data.
    let t = 0
    const clock = () => t
    const boom = new Error('read failed')
    await expect(
      measure({ phase: 'card' }, async () => {
        t = 9_000
        throw boom
      }, clock),
    ).rejects.toBe(boom)
    expect(rootAttrs['af.budget.card_ms']).toBe(9_000)
    expect(rootAttrs['af.budget.card_verdict']).toBe('over')
  })
})
