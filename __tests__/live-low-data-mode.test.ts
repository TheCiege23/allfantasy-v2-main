import { describe, expect, it } from 'vitest'

import {
  LOW_DATA_POLL_MULTIPLIER,
  lowDataExplanation,
  resolveLowDataMode,
  readConnectionSignals,
} from '@/lib/live/lowDataMode'

/*
 * Low-data mode on the live screens.
 *
 * ⚠ THE CASE THIS SUITE EXISTS FOR IS THE ONE THAT DOES NOTHING. The Network
 * Information API is Chromium-only, so on Safari and Firefox both signals are
 * null and auto-detection cannot fire at all. If the manual override were ever
 * allowed to lose to a signal — or to be ignored when no signal exists — the
 * feature would be silently inert for a large share of real phones while still
 * advertising itself in the UI.
 */

const none = { saveData: null, effectiveType: null }

describe('resolveLowDataMode', () => {
  it('is off when nothing says otherwise', () => {
    expect(resolveLowDataMode({ override: null, signals: none })).toEqual({
      lowData: false,
      source: 'default',
    })
  })

  it('turns itself on when the OS data saver is set', () => {
    expect(
      resolveLowDataMode({ override: null, signals: { saveData: true, effectiveType: '4g' } }),
    ).toEqual({ lowData: true, source: 'connection' })
  })

  it.each(['slow-2g', '2g', '3g'])('turns itself on for a %s connection', (effectiveType) => {
    expect(
      resolveLowDataMode({ override: null, signals: { saveData: false, effectiveType } }),
    ).toEqual({ lowData: true, source: 'connection' })
  })

  it('leaves a 4g connection alone', () => {
    expect(
      resolveLowDataMode({ override: null, signals: { saveData: false, effectiveType: '4g' } }),
    ).toEqual({ lowData: false, source: 'default' })
  })

  /*
   * ⚠ BOTH DIRECTIONS OF THE OVERRIDE MATTER, AND THE "OFF" ONE IS THE EASY BUG.
   * A reader who turned the mode OFF on a 3G connection has told us something the
   * radio cannot — that they want the pictures anyway. Letting `saveData` win
   * there re-decides for them on the very next poll, which is how a setting turns
   * into a thing that fights you.
   */
  it('respects an explicit OFF even on a connection that would trigger it', () => {
    expect(
      resolveLowDataMode({
        override: false,
        signals: { saveData: true, effectiveType: 'slow-2g' },
      }),
    ).toEqual({ lowData: false, source: 'user' })
  })

  it('respects an explicit ON on a fast connection', () => {
    expect(
      resolveLowDataMode({ override: true, signals: { saveData: false, effectiveType: '4g' } }),
    ).toEqual({ lowData: true, source: 'user' })
  })

  /* Safari and Firefox: no signals at all. The toggle is the only way in. */
  it('is off, not on, when the browser reports nothing', () => {
    expect(resolveLowDataMode({ override: null, signals: none }).lowData).toBe(false)
    expect(resolveLowDataMode({ override: true, signals: none })).toEqual({
      lowData: true,
      source: 'user',
    })
  })
})

describe('readConnectionSignals', () => {
  /*
   * ⚠ IT MUST NOT THROW ON A BROWSER THAT HAS NO SUCH API. jsdom has no
   * `navigator.connection`, which makes it the right stand-in for Safari here.
   */
  it('reports nulls rather than throwing where the API is absent', () => {
    expect(readConnectionSignals()).toEqual({ saveData: null, effectiveType: null })
  })
})

describe('explanation', () => {
  it('says why the mode is on when the browser chose it', () => {
    expect(lowDataExplanation({ lowData: true, source: 'connection' })).toMatch(/automatically/i)
  })

  it('describes the effect when the reader chose it', () => {
    expect(lowDataExplanation({ lowData: true, source: 'user' })).toMatch(/fewer images/i)
  })

  it('describes the full-fat state when it is off', () => {
    expect(lowDataExplanation({ lowData: false, source: 'default' })).toMatch(/full images/i)
  })
})

describe('poll multiplier', () => {
  /*
   * ⚠ SLOWER, NEVER OFF. A live scoreboard that stops updating is not a cheaper
   * live scoreboard, it is a broken one. Pinned so nobody "optimises" it upward
   * into uselessness.
   */
  it('slows the live cadence without stopping it', () => {
    expect(LOW_DATA_POLL_MULTIPLIER).toBeGreaterThan(1)
    expect(20_000 * LOW_DATA_POLL_MULTIPLIER).toBeLessThanOrEqual(90_000)
  })
})
