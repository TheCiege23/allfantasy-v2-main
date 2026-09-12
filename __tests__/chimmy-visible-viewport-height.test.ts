import { describe, expect, it } from 'vitest'
import {
  computeVisibleHeight,
  KEYBOARD_MIN_INSET,
  type ViewportSample,
} from '@/app/chimmy/hooks/useVisibleViewportHeight'

/**
 * The control for the keyboard-inset arithmetic.
 *
 * 🛑 THE DEFECT BEING FIXED CANNOT BE REPRODUCED IN A HEADLESS BROWSER — a soft
 * keyboard cannot be opened — so the arithmetic is the only part that can be put
 * on a scale, and it is where the bug would be. The DOM wiring around it is four
 * lines and a listener pair.
 *
 * ⚠ That is also the limit of what this file proves, stated so nobody reads it as
 * more. It does NOT prove the composer is visible with a keyboard open on a real
 * iPhone. It proves that given a visual viewport the numbers come out right.
 * `phone-smoke.spec.ts` learned the harder version of this lesson: a unit test of
 * a helper is not evidence about the surface.
 */

const sample = (o: Partial<ViewportSample> = {}): ViewportSample => ({
  elementTop: 136,
  visualHeight: 844,
  visualOffsetTop: 0,
  innerHeight: 844,
  ...o,
})

describe('computeVisibleHeight', () => {
  it('leaves the stylesheet alone when no keyboard is open', () => {
    /* visualHeight === innerHeight: nothing is covering anything. */
    expect(computeVisibleHeight(sample())).toBeNull()
  })

  it('leaves the stylesheet alone for a few pixels of chrome rounding', () => {
    /*
     * ⚠ THIS IS WHY THE THRESHOLD EXISTS. These two values differ routinely by a
     * handful of pixels, and overriding the height on every one would fight the
     * stylesheet on desktop forever for no benefit.
     */
    expect(computeVisibleHeight(sample({ visualHeight: 840 }))).toBeNull()
    expect(computeVisibleHeight(sample({ visualHeight: 844 - (KEYBOARD_MIN_INSET - 1) }))).toBeNull()
  })

  /* ─── THE BRANCH THAT MATTERS ─── */

  it('sizes to the visible region when the keyboard is open', () => {
    /* iPhone 12: 844 tall, ~336px keyboard, chat starting 136px down. */
    const h = computeVisibleHeight(sample({ visualHeight: 508 }))
    expect(h).toBe(508 - 136)
  })

  it('respects visualOffsetTop when iOS scrolls the visual viewport', () => {
    /*
     * ⚠ NOT DECORATION. iOS scrolls the visual viewport to reveal the focused
     * field, changing offsetTop WITHOUT a further resize. Ignoring it sizes the
     * element for a region the user is no longer looking at — and the error is
     * silent, because the number still looks plausible.
     */
    const h = computeVisibleHeight(sample({ visualHeight: 508, visualOffsetTop: 60 }))
    expect(h).toBe(60 + 508 - 136)
  })

  it('fires exactly at the threshold, not one pixel later', () => {
    /* An off-by-one here would leave the smallest real keyboards unhandled. */
    expect(computeVisibleHeight(sample({ visualHeight: 844 - KEYBOARD_MIN_INSET }))).not.toBeNull()
  })

  /* ─── ABSTAIN RATHER THAN PRODUCE A NONSENSE HEIGHT ─── */

  it('returns null rather than a non-positive height', () => {
    /*
     * A keyboard tall enough to cover the element's own top edge would otherwise
     * yield 0 or a negative height and collapse the chat to nothing — strictly
     * worse than the bug being fixed. Leave the CSS.
     */
    expect(computeVisibleHeight(sample({ visualHeight: 100, elementTop: 400 }))).toBeNull()
    expect(computeVisibleHeight(sample({ visualHeight: 136, elementTop: 136 }))).toBeNull()
  })

  it('returns null on non-finite input', () => {
    /*
     * ⚠ `NaN` compares false against every threshold, so without an explicit
     * guard a garbage reading falls through to the arithmetic and produces
     * `NaN` px — which React will happily set and the browser will ignore,
     * leaving no trace of why the layout is wrong.
     */
    expect(computeVisibleHeight(sample({ visualHeight: Number.NaN }))).toBeNull()
    expect(computeVisibleHeight(sample({ innerHeight: Number.NaN }))).toBeNull()
  })

  it('does not fire when the visual viewport is LARGER than the layout viewport', () => {
    /* Pinch-zoom out. A negative inset must not be read as a keyboard. */
    expect(computeVisibleHeight(sample({ visualHeight: 1000 }))).toBeNull()
  })
})
