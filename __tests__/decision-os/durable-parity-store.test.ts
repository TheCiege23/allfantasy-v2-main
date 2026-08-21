import { describe, it, expect, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import {
  persistParityEvent,
  awaitPendingParityWrites,
  listPersistedParityEvents,
  agreementOf,
  isParityEvent,
} from '@/lib/decision-os/core/parity/durableParityStore'
import { summarizeFlipReadiness } from '@/lib/decision-os/core/parity/flipReadiness'

function capture() {
  const rows: Array<Record<string, unknown>> = []
  const db = {
    decisionParityRecord: {
      create: async (args: { data: Record<string, unknown> }) => { rows.push(args.data); return {} },
    },
  } as never
  return { rows, db }
}

const ev = (event: string, flags: Record<string, unknown> = {}) =>
  ({ event, decision_type: 'manager.lineup.set', decision_id: 'd1', flags, at: new Date().toISOString() }) as never

describe('what gets written', () => {
  it('persists both parity events', async () => {
    const { rows, db } = capture()
    persistParityEvent(ev('decision.shadow_parity', { agreement: true }), db)
    persistParityEvent(ev('decision.validator_parity', { validator_parity_ran: true }), db)
    await awaitPendingParityWrites()
    expect(rows).toHaveLength(2)
  })

  it('does not persist non-parity telemetry', async () => {
    // High-frequency, no bearing on the flip decision. It still reaches the log drain via
    // emitDecisionTelemetry's own console.log — this module deliberately does not touch that.
    const { rows, db } = capture()
    persistParityEvent(ev('decision.issued'), db)
    persistParityEvent(ev('decision.live_enrichment'), db)
    persistParityEvent(ev('decision.adopted'), db)
    await awaitPendingParityWrites()
    expect(rows).toHaveLength(0)
  })

  it('lifts surface/league/user out of flags into columns the gate groups by', async () => {
    const { rows, db } = capture()
    persistParityEvent(ev('decision.shadow_parity', { surface: 'trade_console', leagueId: 'L1', userId: 'u1', agreement: false }), db)
    await awaitPendingParityWrites()
    expect(rows[0]).toMatchObject({ surface: 'trade_console', leagueId: 'L1', userId: 'u1', agreement: false })
  })
})

describe('it can never break a decision', () => {
  it('does not throw when the write rejects', async () => {
    const db = { decisionParityRecord: { create: async () => { throw new Error('table missing') } } } as never
    expect(() => persistParityEvent(ev('decision.shadow_parity', { agreement: true }), db)).not.toThrow()
    await awaitPendingParityWrites()
  })

  it('does not throw when the delegate does not exist at all', () => {
    // True before the migration is applied. Reaching for `.create` on undefined throws
    // SYNCHRONOUSLY, before any `.catch` can attach.
    expect(() => persistParityEvent(ev('decision.shadow_parity', { agreement: true }), {} as never)).not.toThrow()
  })

  it('does not throw when create returns a non-promise', () => {
    const db = { decisionParityRecord: { create: () => undefined } } as never
    expect(() => persistParityEvent(ev('decision.shadow_parity'), db)).not.toThrow()
  })
})

describe('flushing before the instance is frozen', () => {
  it('reports how many writes it awaited', async () => {
    const { db } = capture()
    persistParityEvent(ev('decision.shadow_parity', { agreement: true }), db)
    persistParityEvent(ev('decision.shadow_parity', { agreement: false }), db)
    expect(await awaitPendingParityWrites()).toBe(2)
  })

  it('returns 0 when nothing is in flight', async () => {
    expect(await awaitPendingParityWrites()).toBe(0)
  })

  it('actually waits for the row to land', async () => {
    // The whole point: on Vercel the instance can be frozen the moment the response is sent, so an
    // un-awaited write is lost rather than eventually consistent.
    const rows: unknown[] = []
    const db = {
      decisionParityRecord: {
        create: (args: { data: unknown }) =>
          new Promise((r) => setTimeout(() => { rows.push(args.data); r({}) }, 25)),
      },
    } as never
    persistParityEvent(ev('decision.shadow_parity', { agreement: true }), db)
    expect(rows).toHaveLength(0)
    await awaitPendingParityWrites()
    expect(rows).toHaveLength(1)
  })

  it('gives up at the timeout instead of holding the invocation open', async () => {
    // A slow database must not hold a cron until its platform duration kill, which runs no user
    // code at all and loses the work anyway.
    const db = { decisionParityRecord: { create: () => new Promise(() => {}) } } as never
    persistParityEvent(ev('decision.shadow_parity', { agreement: true }), db)
    const started = Date.now()
    await awaitPendingParityWrites(50)
    expect(Date.now() - started).toBeLessThan(1000)
  })
})

describe('agreement extraction must not drift from the gate', () => {
  it('reads `agreement` first, then falls back to `sameTopPlayer`', () => {
    expect(agreementOf({ agreement: true })).toBe(true)
    expect(agreementOf({ agreement: false })).toBe(false)
    expect(agreementOf({ sameTopPlayer: true })).toBe(true)
    expect(agreementOf({ agreement: false, sameTopPlayer: true })).toBe(false)
  })

  it('returns null — never false — when no signal is present', () => {
    // The distinction the gate rests on: a comparison WITHOUT a verdict is reported separately and
    // must never be counted as agreement.
    expect(agreementOf({})).toBeNull()
    expect(agreementOf(undefined)).toBeNull()
    expect(agreementOf({ agreement: 'yes' })).toBeNull()
    expect(agreementOf({ sameTopPlayer: 1 })).toBeNull()
  })
})

describe('reading it back', () => {
  it('returns [] when the delegate is absent, so callers fall back rather than crash', async () => {
    expect(await listPersistedParityEvents({} as never)).toEqual([])
  })

  it('round-trips into the flip gate and reaches `ready`', async () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({
      event: 'decision.shadow_parity',
      decisionType: 'manager.lineup.set',
      surface: 'today_card',
      decisionId: `d${i}`,
      leagueId: 'L1',
      userId: 'u1',
      agreement: i > 0,
      flags: { surface: 'today_card', ran: true, agreement: i > 0 },
      recordedAt: new Date(),
    }))
    const db = { decisionParityRecord: { findMany: async () => rows } } as never
    const events = await listPersistedParityEvents(db)
    const [summary] = summarizeFlipReadiness(events)
    expect(summary.comparisons).toBe(50)
    expect(summary.agreements).toBe(49)
    expect(summary.agreementRate).toBeCloseTo(0.98, 2)
    expect(summary.readiness).toBe('ready')
  })

  it('stays `accumulating` below the comparison floor, however high the agreement', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      event: 'decision.shadow_parity', decisionType: 'manager.lineup.set', surface: 'today_card',
      decisionId: `d${i}`, leagueId: null, userId: null, agreement: true,
      flags: { surface: 'today_card', ran: true, agreement: true }, recordedAt: new Date(),
    }))
    const db = { decisionParityRecord: { findMany: async () => rows } } as never
    const [summary] = summarizeFlipReadiness(await listPersistedParityEvents(db))
    expect(summary.agreementRate).toBe(1)
    expect(summary.readiness).toBe('accumulating')
  })
})

describe('skips are not comparisons', () => {
  it('an event without `ran: true` is a SKIP and never reaches the agreement rate', async () => {
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
