'use client'

import { useEffect, useState, type RefObject } from 'react'

/**
 * Keep a bottom-anchored element inside the VISIBLE viewport when the on-screen
 * keyboard opens.
 *
 * 🛑 WHY `100dvh` IS NOT ENOUGH, AND THIS IS THE WHOLE REASON THE HOOK EXISTS.
 * The dynamic viewport units account for browser chrome — the collapsing address
 * bar — and NOT for the virtual keyboard. The keyboard's effect on layout is
 * governed by the viewport meta's `interactive-widget`, whose default is
 * `resizes-visual`: the VISUAL viewport shrinks, the LAYOUT viewport does not.
 *
 * So on a phone, with `h-[calc(100dvh-8.5rem)]`, focusing the composer opens the
 * keyboard, `100dvh` does not change, the container does not change, and the
 * composer stays exactly where it was — underneath the keyboard.
 *
 * Verified against origin/main before writing this, as code facts rather than
 * recollection:
 *
 *   `interactive-widget`   set NOWHERE in the repo (so `resizes-visual` applies)
 *   `visualViewport`       used NOWHERE in the repo
 *   `env(keyboard-inset-*)` used NOWHERE in the repo
 *   ChimmyChat.tsx:834     the composer is a `flex-shrink-0` sibling below a
 *                          `min-h-0 flex-1 overflow-y-auto` message list
 *   no `resize` listener on the chat container — nothing compensates
 *
 * ⚠ THE CONSEQUENCE IS SPEC-DERIVED, NOT MEASURED, and that distinction is kept
 * on purpose: a soft keyboard cannot be opened in headless Chromium, so unlike a
 * touch-target size this was never put on a scale. The FACTS above are measured;
 * the conclusion drawn from them is reasoning.
 *
 * ⚠ WHY SCOPED HERE RATHER THAN `interactive-widget=resizes-content` IN
 * `app/layout.tsx`. That one line is the better fix and changes keyboard
 * semantics for EVERY page in the app — and nobody can check it on a real device
 * right now. A hook on one surface is verifiable in isolation and reversible.
 * If a device becomes available, prefer the viewport meta and delete this.
 */

/** What the DOM told us, so the decision below can be tested without a DOM. */
export type ViewportSample = {
  /** `getBoundingClientRect().top` of the element — relative to the LAYOUT viewport. */
  elementTop: number
  /** `visualViewport.height` — shrinks when the keyboard opens. */
  visualHeight: number
  /** `visualViewport.offsetTop` — how far the visual viewport has scrolled within the layout one. */
  visualOffsetTop: number
  /** `window.innerHeight` — the LAYOUT viewport, unchanged by the keyboard. */
  innerHeight: number
}

/**
 * How much smaller the visual viewport must be before we intervene, in CSS px.
 *
 * ⚠ A THRESHOLD, NOT `visualHeight < innerHeight`, AND THE REASON IS FALSE
 * POSITIVES RATHER THAN TIDINESS. Those two values differ by a few pixels
 * routinely — sub-pixel rounding, a partially-collapsed address bar — and
 * overriding the height on every one of those would fight the stylesheet on
 * desktop for no benefit. No virtual keyboard is anywhere near this small, so
 * the gap is unambiguous when it matters.
 */
export const KEYBOARD_MIN_INSET = 80

/**
 * The height the element should take, or `null` to leave the stylesheet alone.
 *
 * Pure on purpose — see the note in `phone-smoke.spec.ts` about
 * `targetRatchet.ts`. The arithmetic is the part that can be wrong, and it can be
 * proven in milliseconds; the DOM wiring around it is four lines.
 */
export function computeVisibleHeight(s: ViewportSample): number | null {
  const inset = s.innerHeight - s.visualHeight
  if (!Number.isFinite(inset) || inset < KEYBOARD_MIN_INSET) return null

  /*
   * The element should end where the VISIBLE region ends.
   *
   * `elementTop` is relative to the layout viewport; the visible region runs from
   * `visualOffsetTop` to `visualOffsetTop + visualHeight` in those same
   * coordinates. So the available height is the distance from the element's top
   * to that bottom edge.
   *
   * ⚠ `visualOffsetTop` is not decoration. iOS scrolls the visual viewport to
   * keep the focused field visible, so ignoring it computes a height for a
   * region the user is no longer looking at.
   */
  const visibleBottom = s.visualOffsetTop + s.visualHeight
  const height = visibleBottom - s.elementTop

  /* A non-positive height would collapse the chat entirely; leave the CSS. */
  return height > 0 ? height : null
}

/**
 * Track the visible height available to `ref`, or `null` when the stylesheet
 * should be left alone.
 *
 * ⚠ Listens to BOTH `resize` and `scroll` on the visual viewport. The keyboard
 * fires `resize`; iOS then SCROLLS the visual viewport to reveal the focused
 * field, which changes `offsetTop` without another resize. Listening to resize
 * alone leaves the element sized for the wrong region.
 */
export function useVisibleViewportHeight(ref: RefObject<HTMLElement | null>): number | null {
  const [height, setHeight] = useState<number | null>(null)

  useEffect(() => {
    /*
     * ⚠ Absent on older Safari and in SSR. Returning early leaves `height` at
     * `null`, which means "use the stylesheet" — so the surface degrades to
     * exactly today's behaviour rather than to a broken one.
     */
    const vv = typeof window === 'undefined' ? undefined : window.visualViewport
    if (!vv) return

    let frame = 0
    const measure = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const el = ref.current
        if (!el) return
        setHeight(
          computeVisibleHeight({
            elementTop: el.getBoundingClientRect().top,
            visualHeight: vv.height,
            visualOffsetTop: vv.offsetTop,
            innerHeight: window.innerHeight,
          }),
        )
      })
    }

    measure()
    vv.addEventListener('resize', measure)
    vv.addEventListener('scroll', measure)
    return () => {
      cancelAnimationFrame(frame)
      vv.removeEventListener('resize', measure)
      vv.removeEventListener('scroll', measure)
    }
  }, [ref])

  return height
}
