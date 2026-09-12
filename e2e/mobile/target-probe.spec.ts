import { expect, test } from "@playwright/test"
import { probeGeometry } from "./geometryProbe"

/**
 * The control for the geometry probe's `visible()` predicate.
 *
 * 🛑 ITS ABSENCE IS WHY THIS LANE WAS RED FROM THE DAY IT LANDED, AND WHY THE
 * CAUSE TOOK THREE WRONG DIAGNOSES TO FIND.
 *
 * The landing page's mobile menu is `<details><summary>` with the nav duplicated
 * inside `.af-lp-mobile-panel`. A link inside a CLOSED `<details>` reports
 * `display: block`, `visibility: visible`, `opacity: 1` and a non-zero rect in
 * BOTH engines — so it passed every test in `visible()` and was measured as a
 * tap target no user can reach. Laid out inside a narrow flex item it came back
 * 20px WIDE, which looks so exactly like a page that rendered with no CSS that a
 * whole stylesheet-loss investigation was built on it.
 *
 * ⚠ THE MISTAKE UNDERNEATH ALL THREE WRONG ANSWERS WAS THE SAME: those labels
 * exist TWICE in the DOM. `.af-lp-nav-links` is `display: none` below 720px, so
 * "these cannot be measured" was true of the copy I checked and false of the
 * page. A census of one source, which CLAUDE.md records four separate times.
 *
 * ⚠ NO DEV SERVER AND NO DATABASE — `page.setContent` is the whole fixture.
 * Nothing about this control needs the environment that defeated three earlier
 * attempts to control this lane.
 */

/** The landing page's menu shape, reduced to the part that matters. */
/**
 * ⚠ EVERY FIXTURE MUST CARRY THE VIEWPORT META, AND THIS WAS NOT OBVIOUS.
 * `page.setContent` builds a document with no `<meta name="viewport">`, and a
 * mobile emulation without it falls back to a ~980px LAYOUT viewport — so a
 * fixture meant to be a 390px phone is silently almost a thousand pixels wide.
 *
 * Found when the new overflow assertion refused to fire on a 700px box in a
 * "390px" viewport: 700 fits in 980. The earlier tests in this file were
 * unaffected only because they assert PRESENCE and absence rather than widths,
 * which is luck, not design.
 *
 * 🛑 AND `minimum-scale=1` IS LOAD-BEARING, WHICH TOOK A SECOND MEASUREMENT TO
 * FIND. With `width=device-width,initial-scale=1` ALONE, Chromium's mobile
 * emulation EXPANDS the layout viewport to fit overflowing content, so the
 * overflow check cannot see it. Measured on a 700px box:
 *
 *     chromium  initial-scale=1 only     innerWidth 708  scrollWidth 708  detects FALSE
 *     chromium  + minimum-scale=1        innerWidth 393  scrollWidth 708  detects true
 *     webkit    either                   innerWidth 390  scrollWidth 708  detects true
 *
 * So `scrollWidth > innerWidth` is engine-dependent: WebKit reports the overflow
 * and Chromium can silently absorb it by growing the viewport. The check is
 * sound on the real app — `app/layout.tsx` produced `innerWidth 390` on
 * `/commissioner-os` and the lane caught 481px there — but a FIXTURE must pin
 * the scale or it tests a viewport that resizes itself out of the defect.
 *
 * ⚠ Worth knowing beyond this file: `app/layout.tsx` sets no `minimumScale`, so
 * on Chrome Android a page wider than the device may zoom out instead of
 * scrolling sideways. That is a product question, not a test one, and it is not
 * changed here.
 */
const META =
  '<meta name="viewport" content="width=device-width,initial-scale=1,minimum-scale=1">'

const MOBILE_MENU = META + `
  <style>
    .af-lp-mobile-actions { display: flex; align-items: center; gap: 8px }
    .af-lp-mobile-panel a { display: block; padding: 6px }
    .af-tall { display: block; min-width: 44px; min-height: 44px }
  </style>
  <div class="af-lp-mobile-actions">
    <a class="af-tall" href="/start">Get started</a>
    <details class="af-lp-mobile-menu">
      <summary aria-label="Open navigation menu">menu</summary>
      <div class="af-lp-mobile-panel">
        <a href="#how">How it works</a>
        <a href="#pricing">Pricing</a>
        <a class="af-lp-partners" href="/core/partners">PartnersAPI</a>
      </div>
    </details>
  </div>`

const OPTS = { minTarget: 44, minFont: 16 }

test.describe("@mobile target probe", () => {
  test("does NOT measure controls inside a CLOSED <details>", async ({ page }) => {
    await page.setContent(MOBILE_MENU)
    const report = await page.evaluate(probeGeometry, OPTS)

    const labels = report.smallTargets.map((t) => t.label)
    expect(labels).not.toContain("How it works")
    expect(labels).not.toContain("Pricing")
    expect(labels).not.toContain("PartnersAPI")
    /* The reachable control is 44px, so nothing at all should be reported. */
    expect(report.smallTargets).toEqual([])
  })

  test("DOES measure them once the <details> is open", async ({ page }) => {
    /*
     * ⚠ The other half, and the one that stops the fix becoming a blanket
     * exemption. Skipping every `<details>` descendant would hide genuinely
     * undersized controls in an OPEN menu — a gate that cannot fail. Opening it
     * must bring them straight back.
     */
    await page.setContent(MOBILE_MENU.replace("<details", "<details open"))
    const report = await page.evaluate(probeGeometry, OPTS)

    const labels = report.smallTargets.map((t) => t.label)
    expect(labels).toContain("How it works")
    expect(labels).toContain("Pricing")
  })

  test("still measures an ordinary undersized control", async ({ page }) => {
    /* The predicate must not have been narrowed into uselessness. */
    await page.setContent(META + `<a href="#" style="display:block;width:20px;height:20px">x</a>`)
    const report = await page.evaluate(probeGeometry, OPTS)

    expect(report.smallTargets).toHaveLength(1)
    expect(report.smallTargets[0]).toMatchObject({ w: 20, h: 20 })
  })

  test("still skips a genuinely hidden control", async ({ page }) => {
    await page.setContent(META + `
      <a href="#" style="display:none">gone</a>
      <a href="#" style="visibility:hidden">invisible</a>
      <a href="#" style="opacity:0;display:block;width:20px;height:20px">transparent</a>`)
    const report = await page.evaluate(probeGeometry, OPTS)

    expect(report.smallTargets).toEqual([])
  })

  /* ─── OVERFLOW MUST NAME ITS CULPRIT ─── */

  test("names the overflowing element, widest first", async ({ page }) => {
    /*
     * 🛑 THE FIELD THIS EXERCISES WAS ADDED BECAUSE AN OVERFLOW FAILURE NAMED
     * NOBODY. `/commissioner-os` reported `scrollWidth 481 vs viewport 390` and
     * nothing else — 91px too wide, both engines, no indication of which element.
     * That is arithmetic, not a finding, and on a surface that only renders in CI
     * it costs a whole round-trip to localise.
     */
    await page.setContent(META + `
      <div style="width:700px;height:20px" id="wide">wide</div>
      <div style="width:300px;height:20px">narrow</div>`)
    const report = await page.evaluate(probeGeometry, OPTS)

    expect(report.overflow).toBe(true)
    expect(report.overflowing.length).toBeGreaterThan(0)
    /* Widest first, so the reader sees the container rather than a leaf. */
    expect(report.overflowing[0]!.w).toBe(700)
    expect(report.overflowing.map((o) => o.w)).not.toContain(300)
  })

  test("orders offenders widest-first, so the container beats its leaves", async ({ page }) => {
    /*
     * 🛑 THE ORDERING WAS UNPROVEN UNTIL THIS CASE EXISTED. The test above has a
     * single overflowing element, so `[0]` is the same whichever way the list is
     * sorted — reversing the comparator left it green. A guard whose ordering is
     * untested can silently report a 40px leaf instead of the 900px container
     * dragging it off-screen, which is exactly the answer nobody can act on.
     */
    await page.setContent(META + `
      <div style="width:900px" id="outer">
        <div style="width:500px;height:20px" id="inner">leaf</div>
      </div>`)
    const report = await page.evaluate(probeGeometry, OPTS)

    const widths = report.overflowing.map((o) => o.w)
    expect(widths.length).toBeGreaterThanOrEqual(2)
    expect(widths[0]).toBe(900)
    /* Strictly descending, not merely "the biggest is first". */
    expect([...widths].sort((a, b) => b - a)).toEqual(widths)
  })

  test("reports NO offenders on a page that fits", async ({ page }) => {
    /*
     * ⚠ The abstain half. A list that is non-empty on a page that fits would send
     * every reader hunting a culprit that does not exist — and it shares the
     * overflow flag's 2px tolerance precisely so the two can never disagree.
     */
    await page.setContent(META + `<div style="width:300px;height:20px">fits</div>`)
    const report = await page.evaluate(probeGeometry, OPTS)

    expect(report.overflow).toBe(false)
    expect(report.overflowing).toEqual([])
  })

  test("still flags a sub-16px form field", async ({ page }) => {
    await page.setContent(META + `<input type="text" style="font-size:13px" class="af-search-input">`)
    const report = await page.evaluate(probeGeometry, OPTS)

    expect(report.smallFields).toHaveLength(1)
    expect(report.smallFields[0].fontPx).toBe(13)
  })

  test("does not flag a sub-16px field inside a closed <details> either", async ({ page }) => {
    await page.setContent(META + `<details><summary>s</summary><input type="text" style="font-size:13px"></details>`)
    const report = await page.evaluate(probeGeometry, OPTS)

    expect(report.smallFields).toEqual([])
  })
})
