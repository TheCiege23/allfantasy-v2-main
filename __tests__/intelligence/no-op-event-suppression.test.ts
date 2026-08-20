import { describe, it, expect } from 'vitest'
import { isNoOpEvent, categorize } from '@/lib/intelligence/projections/snapshotProjection'

/**
 * Regression cover for the finding on production 2026-08-20: 7,740 of 7,833 domain events — 98.8%
 * of the entire store — were `transaction.waiver.window_processed` with `processed: 0`, emitted
 * every five minutes by the waiver cron whether or not it did anything.
 *
 * They were counted as waiver activity, so the Decision OS evidence packet told an AI model a league
 * had hundreds of waiver events when the true number was zero.
 */
const ev = (type: string, payload: unknown) => ({ type, payload }) as never

describe('no-op event suppression', () => {
  it('treats an empty waiver window as a no-op', () => {
    expect(isNoOpEvent(ev('transaction.waiver.window_processed', { processed: 0 }))).toBe(true)
  })

  it('tolerates the count arriving as a string, as JSON round-trips can produce', () => {
    expect(isNoOpEvent(ev('transaction.waiver.window_processed', { processed: '0' }))).toBe(true)
  })

  it('does NOT suppress a window that processed something', () => {
    expect(isNoOpEvent(ev('transaction.waiver.window_processed', { processed: 1 }))).toBe(false)
    expect(isNoOpEvent(ev('transaction.waiver.window_processed', { processed: 12 }))).toBe(false)
  })

  it('treats an ABSENT count as real, not as a no-op', () => {
    // Only an explicit zero is provable. Guessing that a missing field means "nothing happened"
    // would silently drop real activity — the opposite failure, and a worse one.
    expect(isNoOpEvent(ev('transaction.waiver.window_processed', {}))).toBe(false)
    expect(isNoOpEvent(ev('transaction.waiver.window_processed', null))).toBe(false)
  })

  it('never suppresses any other event type, even with processed: 0', () => {
    // Narrow by design: this is a fix for one over-emitting producer, not a general rule that a
    // zero-valued payload means nothing happened.
    for (const t of [
      'transaction.waiver.processed',
      'transaction.trade.processed',
      'roster.lineup.set',
      'draft.pick.made',
      'competition.score.updated',
    ]) {
      expect(`${t}:${isNoOpEvent(ev(t, { processed: 0 }))}`).toBe(`${t}:false`)
    }
  })

  it('positive control — the suppressed type really does categorise as waiver activity', () => {
    // This is WHY suppression is needed: categorize() matches on prefix and never sees the payload,
    // so without the guard every empty window increments waiverCount.
    expect(categorize('transaction.waiver.window_processed')).toBe('waiver')
  })
})
