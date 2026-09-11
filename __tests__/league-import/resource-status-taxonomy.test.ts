/**
 * IMP-04 — the resource status taxonomy, and the seven roster scenarios it has to survive.
 *
 * The rule under test is one sentence: only an OBSERVATION may replace stored data. Everything
 * here is a way of getting that wrong.
 */

import { describe, expect, it } from 'vitest'

import {
  buildObservation,
  describeStatus,
  isAuthoritativeStatus,
  isKnownStatus,
  rollUpStatus,
  type ResourceFetchStatus,
} from '@/lib/league-import/resourceStatus'

describe('which statuses may replace stored data', () => {
  it('admits exactly the two observed states', () => {
    const admitted: ResourceFetchStatus[] = ['fetched', 'fetched_empty']
    const refused: ResourceFetchStatus[] = ['not_fetched', 'unauthorized', 'failed', 'partial']

    for (const s of admitted) expect(isAuthoritativeStatus(s)).toBe(true)
    for (const s of refused) expect(isAuthoritativeStatus(s)).toBe(false)
  })

  it('treats an absent status as authoritative, for adapters with no failure mode', () => {
    expect(isAuthoritativeStatus(undefined)).toBe(true)
    expect(isAuthoritativeStatus(null)).toBe(true)
  })

  it('distinguishes a known-empty roster from an unknown one', () => {
    /* This is the whole point: both have zero players, only one is a fact. */
    expect(isKnownStatus('fetched_empty')).toBe(true)
    expect(isKnownStatus('failed')).toBe(false)
  })
})

describe('rollUpStatus', () => {
  it('is fetched when every child was observed and any had content', () => {
    expect(rollUpStatus(['fetched', 'fetched_empty', 'fetched'])).toBe('fetched')
  })

  it('is fetched_empty only when every child was observed and all were empty', () => {
    expect(rollUpStatus(['fetched_empty', 'fetched_empty'])).toBe('fetched_empty')
  })

  it('is partial when some children were observed and some were not', () => {
    expect(rollUpStatus(['fetched', 'failed', 'fetched'])).toBe('partial')
  })

  it('does NOT report partial when nothing was observed', () => {
    /*
     * "Partly read" when nothing was read is the same false-green in miniature — it implies
     * some of the data is current. The most actionable reason wins instead.
     */
    expect(rollUpStatus(['failed', 'failed'])).toBe('failed')
    expect(rollUpStatus(['unauthorized', 'failed'])).toBe('unauthorized')
    expect(rollUpStatus([])).toBe('not_fetched')
  })

  it('surfaces unauthorized over failed, because only one needs a human', () => {
    expect(rollUpStatus(['unauthorized', 'failed', 'not_fetched'])).toBe('unauthorized')
  })
})

describe('observation timestamps', () => {
  const NOW = new Date('2026-09-09T12:00:00.000Z')
  const EARLIER = '2026-09-01T08:00:00.000Z'

  it('advances lastGoodAt on an observation', () => {
    const o = buildObservation('fetched', NOW, EARLIER)
    expect(o.observedAt).toBe(NOW.toISOString())
    expect(o.lastGoodAt).toBe(NOW.toISOString())
  })

  it('does NOT advance lastGoodAt on a preserved write', () => {
    /*
     * The badge must say when the data was TRUE, not when we last tried. Advancing here is
     * how "updated just now" ends up over week-old data.
     */
    const o = buildObservation('failed', NOW, EARLIER)
    expect(o.observedAt).toBe(NOW.toISOString())
    expect(o.lastGoodAt).toBe(EARLIER)
  })

  it('reports a null lastGoodAt when nothing good was ever observed', () => {
    const o = buildObservation('unauthorized', NOW, null)
    expect(o.lastGoodAt).toBeNull()
  })

  it('describes each status without leaking provider detail', () => {
    const all: ResourceFetchStatus[] = [
      'fetched',
      'fetched_empty',
      'not_fetched',
      'unauthorized',
      'failed',
      'partial',
    ]
    for (const s of all) {
      const text = describeStatus(s)
      expect(text.length).toBeGreaterThan(0)
      /* No credential, no id, no league name — these reach user-visible surfaces. */
      expect(text).not.toMatch(/token|cookie|secret|password|@/i)
    }
  })
})

describe('the seven roster scenarios', () => {
  /*
   * Expressed against the rule rather than against a database, because the rule is what every
   * writer consults. A writer that asks `isAuthoritativeStatus` behaves correctly in all seven
   * by construction; one that re-derives its own answer is the bug.
   */
  const mayReplace = (s: ResourceFetchStatus | undefined) => isAuthoritativeStatus(s)

  it('1. one failed roster among twelve — the eleven write, the twelfth is preserved', () => {
    const twelve: ResourceFetchStatus[] = [...Array(11).fill('fetched'), 'failed']
    expect(twelve.filter(mayReplace)).toHaveLength(11)
    expect(rollUpStatus(twelve)).toBe('partial')
  })

  it('2. all roster fetches fail — nothing writes, and the league is not partial', () => {
    const all: ResourceFetchStatus[] = Array(12).fill('failed')
    expect(all.filter(mayReplace)).toHaveLength(0)
    expect(rollUpStatus(all)).toBe('failed')
  })

  it('3. a legitimately empty roster still writes', () => {
    /* A pre-draft league must not be frozen at its import-day state. */
    expect(mayReplace('fetched_empty')).toBe(true)
    expect(rollUpStatus(['fetched_empty'])).toBe('fetched_empty')
  })

  it('4. an authorization failure preserves and is distinguishable from a transient one', () => {
    expect(mayReplace('unauthorized')).toBe(false)
    expect(rollUpStatus(['unauthorized', 'unauthorized'])).toBe('unauthorized')
    expect(describeStatus('unauthorized')).toMatch(/reconnect/i)
  })

  it('5. a FIRST import with a failure must not publish an empty roster', () => {
    /*
     * The subtlest of the seven. With no stored row there is nothing to preserve, and the
     * tempting move is "write the placeholder, some row beats none". That publishes an empty
     * roster every reader may treat as "this manager has nobody" — the exact false statement
     * the taxonomy exists to prevent. The status must remain unobserved.
     */
    expect(mayReplace('failed')).toBe(false)
    expect(isKnownStatus('failed')).toBe(false)
  })

  it('6. a refresh with a failure keeps the previous observation time', () => {
    const NOW = new Date('2026-09-09T12:00:00.000Z')
    const o = buildObservation('failed', NOW, '2026-09-02T00:00:00.000Z')
    expect(o.lastGoodAt).toBe('2026-09-02T00:00:00.000Z')
  })

  it('7. recovery on the next successful request writes and advances', () => {
    const NOW = new Date('2026-09-09T12:00:00.000Z')
    const o = buildObservation('fetched', NOW, '2026-09-02T00:00:00.000Z')
    expect(mayReplace('fetched')).toBe(true)
    expect(o.lastGoodAt).toBe(NOW.toISOString())
  })
})
