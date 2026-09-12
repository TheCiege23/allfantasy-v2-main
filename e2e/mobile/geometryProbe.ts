/**
 * The geometry half of the phone gate's measurement, extracted so it can be
 * driven by a real browser in `target-probe.spec.ts`.
 *
 * MOVED HERE AFTER THE INLINE VERSION COST A DAY. `visible()` below decides
 * which controls count as tap targets, and it could not see a closed
 * `<details>` -- so this lane measured the landing page's COLLAPSED mobile menu
 * on every run since it landed, reported its links as 20px-wide tap targets,
 * and stayed red for a reason nobody could reproduce.
 *
 * Inline in the spec, nothing could exercise that predicate. Exported, a
 * fixture proves it in milliseconds. That is the same repair `probeStylesheets`
 * needed and the same one `targetRatchet.ts` already argues for: a measurement
 * that only runs inside a CI browser is a measurement nobody can control.
 *
 * Passed to `page.evaluate`, so it must be SELF-CONTAINED -- no imports, no
 * closure over module scope.
 */
export type GeometryProbeOptions = { minTarget: number; minFont: number }

export type GeometryReport = {
  overflow: boolean
  scrollWidth: number
  innerWidth: number
  smallFields: { tag: string; cls: string; fontPx: number }[]
  smallTargets: { tag: string; cls: string; label: string; w: number; h: number }[]
  /**
   * The elements whose right edge exceeds the viewport, widest first.
   *
   * 🛑 ADDED AFTER AN OVERFLOW FAILURE THAT NAMED NO CULPRIT. `/commissioner-os`
   * reported `scrollWidth 481 vs viewport 390` and nothing else — 91px too wide,
   * in both engines, with no indication of WHICH element. That is arithmetic, not
   * a finding: nobody reading it can act, and neither could I.
   *
   * A check that detects a defect but cannot say where it is costs a whole extra
   * CI round-trip to localise, and on a surface that only renders in CI that is
   * the difference between a fix and a guess.
   */
  overflowing: { tag: string; cls: string; w: number; right: number }[]
}

export function probeGeometry({ minTarget, minFont }: GeometryProbeOptions): GeometryReport {

  const visible = (el: Element): boolean => {
    /*
     * 🛑 A CLOSED `<details>` IS INVISIBLE TO EVERY OTHER TEST HERE, AND
     * IT IS WHY THIS LANE HAS BEEN RED SINCE THE DAY IT LANDED.
     *
     * The landing page's mobile menu is `<details><summary>` with the
     * nav duplicated inside `.af-lp-mobile-panel`. Measured in BOTH
     * engines, a link inside a CLOSED details reports:
     *
     *   display block · visibility visible · opacity 1 · 52x66 · rects > 0
     *
     * so it passes every check below and gets measured as a tap target
     * the user cannot reach. The panel is laid out inside a narrow flex
     * item, which is where "How it works" at 20px WIDE comes from — text
     * wrapping one character per line, reported as a real control.
     *
     * ⚠ THAT NUMBER IS WHY THIS COST A DAY. 20px-wide links looked
     * exactly like a page that had rendered with no CSS, and a whole
     * stylesheet-loss investigation was built on it — including a
     * confident claim to a peer that their CSS diagnosis was wrong. The
     * page was styled the entire time. `getComputedStyle` cannot see a
     * closed details; only the ancestor query can.
     */
    if (el.closest("details:not([open])")) return false
    const cs = getComputedStyle(el)
    if (cs.display === "none" || cs.visibility === "hidden") return false
    if (Number(cs.opacity) === 0) return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }

  /*
   * Fields whose computed font-size is under 16px, which is the size iOS
   * Safari zooms the page in on focus — and it does not zoom back out.
   * Only types that actually take a text caret can trigger it.
   */
  const zoomingTypes = ["checkbox", "radio", "range", "color", "submit", "button", "reset", "hidden", "image", "file"]
  const smallFields: { tag: string; cls: string; fontPx: number }[] = []
  document.querySelectorAll("input, select, textarea").forEach((el) => {
    if (!visible(el)) return
    const tag = el.tagName.toLowerCase()
    const type = (el.getAttribute("type") || "").toLowerCase()
    if (tag === "input" && zoomingTypes.includes(type)) return
    const fontPx = parseFloat(getComputedStyle(el).fontSize)
    if (fontPx < minFont) {
      smallFields.push({ tag, cls: String(el.className || "").slice(0, 40), fontPx })
    }
  })

  /*
   * Targets are measured only INSIDE the initial viewport. A control
   * further down the page can be undersized for reasons this gate is not
   * trying to police yet; what must hold on every PR is that the first
   * screen a phone user sees is tappable.
   */
  const smallTargets: { tag: string; cls: string; label: string; w: number; h: number }[] = []
  document.querySelectorAll('button, a[href], [role="button"]').forEach((el) => {
    if (!visible(el)) return
    const r = el.getBoundingClientRect()
    if (r.top < 0 || r.bottom > window.innerHeight) return
    /*
     * Round BEFORE comparing, and report the same rounded number.
     * Comparing the raw rect while printing a rounded one produced a
     * finding that read `44x44` and looked like a bug in the check: the
     * control was 43.98px, which is 44px to anyone who taps it.
     */
    const w = Math.round(r.width)
    const h = Math.round(r.height)
    if (h >= minTarget && w >= minTarget) return
    /*
     * An inline link inside a paragraph is text, not a tap target, and
     * holding body copy to 44px would mean 44px line height. Skip any
     * anchor whose parent is a text block.
     */
    const parentTag = el.parentElement?.tagName.toLowerCase() ?? ""
    if (el.tagName === "A" && ["p", "li", "span", "small", "label"].includes(parentTag)) return
    smallTargets.push({
      tag: el.tagName.toLowerCase(),
      cls: String(el.className || "").slice(0, 40),
      label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30),
      w,
      h,
    })
  })

  /*
   * Who is actually sticking out. Walk every element once and keep the ones whose
   * right edge clears the viewport.
   *
   * ⚠ `right > innerWidth + 2` uses the SAME 2px tolerance as the overflow flag
   * below, so the two can never disagree — a list that is empty while the flag is
   * true would send the reader hunting for a culprit that the check does not
   * believe in either.
   *
   * ⚠ Sorted widest-first and capped: one overflowing container usually drags a
   * dozen descendants past the edge with it, and the useful answer is the widest
   * ancestor rather than every leaf inside it.
   */
  const overflowing: { tag: string; cls: string; w: number; right: number }[] = []
  document.querySelectorAll("*").forEach((el) => {
    const r = el.getBoundingClientRect()
    if (r.width <= 0 || r.right <= window.innerWidth + 2) return
    const cls = typeof el.className === "string" ? el.className : String(el.getAttribute("class") || "")
    overflowing.push({
      tag: el.tagName.toLowerCase(),
      cls: cls.slice(0, 60),
      w: Math.round(r.width),
      right: Math.round(r.right),
    })
  })
  overflowing.sort((a, b) => b.w - a.w)

  return {
    /* +2px: sub-pixel layout rounding is not a sideways-scrolling page. */
    overflow: document.documentElement.scrollWidth > window.innerWidth + 2,
    overflowing: overflowing.slice(0, 8),
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    smallFields,
    smallTargets,
  }
}
