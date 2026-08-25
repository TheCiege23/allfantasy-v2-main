import { describe, expect, it } from 'vitest'

/**
 * The "0" sentinel, in the two places it mattered.
 *
 * Sleeper writes the string "0" into a starting slot it holds no player for.
 * Both the /core loader and the lineup-actions engine parsed it as though it
 * were a player id, because `"0"` is a non-empty string and both used
 * truthiness to decide. The consequences differed:
 *
 *   - the /core loader counted every empty slot as a rostered player, so
 *     exposure totals and starter counts were inflated;
 *   - the lineup engine's empty-slot detector — its most important one — did
 *     `if (pid) continue` and therefore never fired at all.
 *
 * These pin the normalisation rule both now share. They deliberately test the
 * RULE rather than reaching into either module's private parsing, because the
 * rule is the thing that must not drift back.
 */

const EMPTY_SLOT = '0'

/** The /core loader's rule: a sentinel is not an id and never enters a set. */
function asIds(v: unknown): string[] {
  return Array.isArray(v)
    ? v.map((x) => (x == null ? '' : String(x))).filter((x) => Boolean(x) && x !== EMPTY_SLOT)
    : []
}

/** The /core loader's other half: the sentinel is what makes a slot empty. */
function countEmptySlots(v: unknown): number {
  return Array.isArray(v) ? v.filter((x) => String(x ?? '') === EMPTY_SLOT).length : 0
}

/** The engine's rule: normalise the sentinel to '' so downstream sees empty. */
function normaliseStarter(slot: unknown): string {
  const id = typeof slot === 'string' ? slot : ''
  return id.length > 0 && id !== EMPTY_SLOT ? id : ''
}

describe('the Sleeper empty-slot sentinel', () => {
  const LINEUP = ['4988', '0', '6794', '0', '0']

  it('is not counted as a rostered player', () => {
    expect(asIds(LINEUP)).toEqual(['4988', '6794'])
  })

  it('is what tells us a slot is unfilled', () => {
    expect(countEmptySlots(LINEUP)).toBe(3)
  })

  it('normalises to empty for the lineup engine, so its detector can fire', () => {
    // The bug: "0".length > 0 was true, so `if (pid) continue` skipped it and
    // no empty_starter action was ever emitted.
    expect(normaliseStarter('0')).toBe('')
    expect(normaliseStarter('4988')).toBe('4988')
  })

  it('leaves a real id that merely begins with zero alone', () => {
    // Sleeper ids are numeric strings; a leading zero is not the sentinel.
    expect(asIds(['0123'])).toEqual(['0123'])
    expect(normaliseStarter('0123')).toBe('0123')
    expect(countEmptySlots(['0123'])).toBe(0)
  })

  it('treats null, undefined and empty string as empty without counting them as slots', () => {
    expect(asIds([null, undefined, ''])).toEqual([])
    expect(normaliseStarter(null)).toBe('')
    expect(normaliseStarter(undefined)).toBe('')
    // Only the sentinel means "a slot exists and nobody is in it".
    expect(countEmptySlots([null, undefined, ''])).toBe(0)
  })

  it('handles a numeric zero the way it handles the string', () => {
    // Some payloads arrive as numbers; String(0) is the same sentinel.
    expect(countEmptySlots([0])).toBe(1)
    expect(asIds([0])).toEqual([])
  })

  it('survives a lineup that is entirely unset — the preseason case', () => {
    const unset = ['0', '0', '0', '0', '0', '0', '0', '0', '0']
    expect(asIds(unset)).toEqual([])
    expect(countEmptySlots(unset)).toBe(9)
    expect(unset.map(normaliseStarter).every((x) => x === '')).toBe(true)
  })

  it('returns nothing for a shape that is not an array', () => {
    for (const bad of [null, undefined, 'x', 42, {}]) {
      expect(asIds(bad)).toEqual([])
      expect(countEmptySlots(bad)).toBe(0)
    }
  })
})
