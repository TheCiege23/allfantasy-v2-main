import { describe, it, expect, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import {
  createDurableParitySink,
  listPersistedParityEvents,
  agreementOf,
  isParityEvent,
} from '@/lib/decision-os/core/parity/durableParityStore'
import { summarizeFlipReadiness } from '@/lib/decision-os/core/parity/flipReadiness'

function sinkWithCapture() {
  const rows: Array<Record<string, unknown>> = []
  const db = {
    decisionParityRecord: {
      create: async (args: { data: Record<string, unknown> }) => { rows.push(args.data); return {} },
    },
  } as never
  return { rows, sink: createDurableParitySink(db) }
}

const ev = (event: string, flags: Record<string, unknown> = {}) =>
  ({ event, decision_type: 'manager.lineup.set', decision_id: 'd1', flags, at: new Date().toISOString() }) as never

describe('durable parity store — what gets written', () => {
  it('persists both parity events', async () => {
    const { rows, sink } = sinkWithCapture()
    sink(ev('decision.shadow_parity', { agreement: true }))
    sink(ev('decision.validator_parity', { validator_parity_ran: true }))
    await new Promise((r) => setTimeout(r, 0)) // the write is fire-and-forget
    expect(rows).toHaveLength(2)
  })

  it('ignores non-parity telemetry entirely', async () => {
    // These are high-frequency and have no bearing on the flip decision; persisting them would be
    // write amplification with no consumer.
    const { rows, sink } = sinkWithCapture()
    sink(ev('decision.issued'))
    sink(ev('decision.live_enrichment'))
    sink(ev('decision.adopted'))
    await new Promise((r) => setTimeout(r, 0))
    expect(rows).toHaveLength(0)
  })

  it('lifts surface/league/user out of flags into columns the gate groups by', async () => {
    const { rows, sink } = sinkWithCapture()
    sink(ev('decision.shadow_parity', { surface: 'trade_console', leagueId: 'L1', userId: 'u1', agreement: false }))
    await new Promise((r) => setTimeout(r, 0))
    expect(rows[0]).toMatchObject({ surface: 'trade_console', leagueId: 'L1', userId: 'u1', agreement: false })
  })

  it('never throws when the write fails', async () => {
    // Telemetry must never break, delay, or fail a decision.
    const db = { decisionParityRecord: { create: async () => { throw new Error('table missing') } } } as never
    const sink = createDurableParitySink(db)
    expect(() => sink(ev('decision.shadow_parity', { agreement: true }))).not.toThrow()
    await new Promise((r) => setTimeout(r, 0))
  })

  it('never throws when the delegate does not exist at all', () => {
    const sink = createDurableParitySink({} as never)
    expect(() => sink(ev('decision.shadow_parity', { agreement: true }))).not.toThrow()
  })
})

describe('agreement extraction must not drift from the gate', () => {
  // `agreementOf` is a copy of flipReadiness's private `agreementSignal`, lifted into a column so
  // the gate can be computed in SQL. If the two ever disagree about the same event, the persisted
  // gate and the in-memory gate would reach different verdicts — worse than either being wrong.
  it('reads `agreement` first', () => {
    expect(agreementOf({ agreement: true })).toBe(true)
    expect(agreementOf({ agreement: false })).toBe(false)
  })

  it('falls back to `sameTopPlayer`', () => {
    expect(agreementOf({ sameTopPlayer: true })).toBe(true)
    expect(agreementOf({ sameTopPlayer: false })).toBe(false)
  })

  it('prefers `agreement` when BOTH are present', () => {
    expect(agreementOf({ agreement: false, sameTopPlayer: true })).toBe(false)
  })

  it('returns null — never false — when no signal is present', () => {
    // The distinction the whole gate rests on: a comparison WITHOUT a verdict is reported
    // separately and must never be counted as agreement.
    expect(agreementOf({})).toBeNull()
    expect(agreementOf(undefined)).toBeNull()
    expect(agreementOf({ agreement: 'yes' })).toBeNull()
    expect(agreementOf({ sameTopPlayer: 1 })).toBeNull()
  })
})

describe('reading it back', () => {
  it('returns [] when the delegate is absent, so callers fall back rather than crash', async () => {
    // True before the migration is applied.
    expect(await listPersistedParityEvents({} as never)).toEqual([])
  })

  it('round-trips into the flip gate and reaches `ready`', async () => {
    // The point of the whole change: 50 persisted comparisons at >=95% agreement is exactly what
    // the in-memory store could never accumulate.
    const rows = Array.from({ length: 50 }, (_, i) => ({
      event: 'decision.shadow_parity',
      decisionType: 'manager.lineup.set',
      surface: 'today_card',
      decisionId: `d${i}`,
      leagueId: 'L1',
      userId: 'u1',
      agreement: i > 0, // 49/50 agree = 98%
      // `ran: true` is what makes the gate treat this as a COMPARISON rather than a skip.
      flags: { surface: 'today_card', ran: true, agreement: i > 0 },
      recordedAt: new Date(),
    }))
    const db = { decisionParityRecord: { findMany: async () => rows } } as never

    const events = await listPersistedParityEvents(db)
    expect(events).toHaveLength(50)

    const [summary] = summarizeFlipReadiness(events)
    expect(summary.comparisons).toBe(50)
    expect(summary.agreements).toBe(49)
    expect(summary.disagreements).toBe(1)
    expect(summary.agreementRate).toBeCloseTo(0.98, 2)
    expect(summary.readiness).toBe('ready')
  })

  it('stays `accumulating` below the comparison floor, however high the agreement', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      event: 'decision.shadow_parity',
      decisionType: 'manager.lineup.set',
      surface: 'today_card',
      decisionId: `d${i}`,
      leagueId: null, userId: null,
      agreement: true,
      flags: { surface: 'today_card', ran: true, agreement: true },
      recordedAt: new Date(),
    }))
    const db = { decisionParityRecord: { findMany: async () => rows } } as never
    const [summary] = summarizeFlipReadiness(await listPersistedParityEvents(db))
    expect(summary.agreementRate).toBe(1)
    expect(summary.readiness).toBe('accumulating')
  })
})

describe('skips are not comparisons', () => {
  it('an event without `ran: true` is a SKIP and never reaches the agreement rate', async () => {
    // The gate counts a comparison only when the slice actually ran one. An event that records why
    // it could NOT compare must not dilute -- or inflate -- the agreement rate.
    const rows = [
      { event: 'decision.shadow_parity', decisionType: 'manager.lineup.set', surface: 'today_card',
        decisionId: 'd1', leagueId: null, userId: null, agreement: null,
        flags: { surface: 'today_card', ran: false, reason: 'inputs_unavailable' }, recordedAt: new Date() },
    ]
    const db = { decisionParityRecord: { findMany: async () => rows } } as never
    const [summary] = summarizeFlipReadiness(await listPersistedParityEvents(db))
    expect(summary.comparisons).toBe(0)
    expect(summary.skips).toBe(1)
    expect(summary.skipReasons).toEqual({ inputs_unavailable: 1 })
    expect(summary.agreementRate).toBeNull()
    expect(summary.readiness).toBe('no_signal')
  })
})

describe('isParityEvent', () => {
  it('accepts exactly the two the gate is defined on', () => {
    expect(isParityEvent('decision.shadow_parity')).toBe(true)
    expect(isParityEvent('decision.validator_parity')).toBe(true)
    expect(isParityEvent('decision.issued')).toBe(false)
    expect(isParityEvent('decision.live_enrichment')).toBe(false)
  })
})
