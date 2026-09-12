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
const MOBILE_MENU = `
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
    await page.setContent(`<a href="#" style="display:block;width:20px;height:20px">x</a>`)
    const report = await page.evaluate(probeGeometry, OPTS)

    expect(report.smallTargets).toHaveLength(1)
    expect(report.smallTargets[0]).toMatchObject({ w: 20, h: 20 })
  })

  test("still skips a genuinely hidden control", async ({ page }) => {
    await page.setContent(`
      <a href="#" style="display:none">gone</a>
      <a href="#" style="visibility:hidden">invisible</a>
      <a href="#" style="opacity:0;display:block;width:20px;height:20px">transparent</a>`)
    const report = await page.evaluate(probeGeometry, OPTS)

    expect(report.smallTargets).toEqual([])
  })

  test("still flags a sub-16px form field", async ({ page }) => {
    await page.setContent(`<input type="text" style="font-size:13px" class="af-search-input">`)
    const report = await page.evaluate(probeGeometry, OPTS)

    expect(report.smallFields).toHaveLength(1)
    expect(report.smallFields[0].fontPx).toBe(13)
  })

  test("does not flag a sub-16px field inside a closed <details> either", async ({ page }) => {
    await page.setContent(`<details><summary>s</summary><input type="text" style="font-size:13px"></details>`)
    const report = await page.evaluate(probeGeometry, OPTS)

    expect(report.smallFields).toEqual([])
  })
})
