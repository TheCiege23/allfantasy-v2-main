import { expect, test } from "@playwright/test"
import { probeStylesheets } from "./stylesheetGuard"

/**
 * The control for the PROBE, as opposed to the decision it feeds.
 *
 * 🛑 THIS FILE EXISTS BECAUSE ITS ABSENCE SHIPPED A BROKEN GUARD, TWICE OVER.
 * Version one of the stylesheet guard carried fifteen unit tests, three proven
 * mutations and a commit message describing all of it — then went GREEN in CI on
 * the exact failure it was written for. Every one of those tests exercised
 * `diagnoseStylesheets`, a pure function over a probe. Nothing exercised the
 * probe, and the probe was wrong.
 *
 * 🛑 AND WHAT IT WAS WRONG ABOUT WAS NOT GUESSABLE. The first fix assumed a
 * failed `<link rel="stylesheet">` has a null `.sheet`. Measured in Chromium, it
 * does not: it has a real `CSSStyleSheet` whose `cssRules` THROWS — identical in
 * shape to a legitimately opaque cross-origin sheet. So the obvious test could
 * never fire, and counting throwers as "unreadable" tripped the guard's own
 * abstain condition and silenced the DOM signal too.
 *
 * ⚠ THE GENERAL FORM, WORTH MORE THAN THIS FILE: a unit test of a helper is not
 * evidence about the gate. `targetRatchet.ts` carries that warning and this lane
 * still walked into it, because there the helper WAS the decision, while here
 * the measurement was the other half and looked too trivial to test.
 *
 * ⚠ NO DEV SERVER AND NO DATABASE. Routes are fulfilled in-process. A real
 * ORIGIN is used rather than `setContent`, because `setContent` runs on
 * `about:blank` where every http href is cross-origin — which would have made
 * this control agree with the broken code.
 */

const ORIGIN = "http://af-probe.test"
/** A second origin, to prove the cross-origin abstain is still intact. */
const OTHER = "http://af-other.test"

const PAGES: Record<string, string> = {
  "/healthy": `<link rel="stylesheet" href="/good.css"><div class="af-core"><a class="af-btn" href="#">x</a></div>`,
  "/partial": `<link rel="stylesheet" href="/dead.css"><link rel="stylesheet" href="/good.css">
               <div class="af-core"><a class="af-btn" href="#">x</a></div>`,
  "/empty": `<link rel="stylesheet" href="/empty.css"><style>.af-btn { min-height: 44px }</style><i class="af-x"></i>`,
  "/no-af": `<link rel="stylesheet" href="/plain.css"><div class="btn leaf-row"><a href="#">x</a></div>`,
  "/cross": `<link rel="stylesheet" href="${OTHER}/opaque.css"><div class="af-core"><a class="af-btn" href="#">x</a></div>`,
}

test.describe("@mobile stylesheet probe", () => {
  test.beforeEach(async ({ page }) => {
    await page.route(`${OTHER}/**`, (route) =>
      /* Cross-origin CSS with no CORS header: loads, but its rules are opaque. */
      route.fulfill({ contentType: "text/css", body: ".af-btn { min-height: 44px }" }),
    )
    await page.route(`${ORIGIN}/**`, (route) => {
      const path = new URL(route.request().url()).pathname
      if (path === "/dead.css") return route.abort("failed")
      if (path === "/good.css")
        return route.fulfill({
          contentType: "text/css",
          body: ".af-btn { min-height: 44px } @media (max-width: 720px) { .af-lp-cta { min-height: 44px } }",
        })
      if (path === "/empty.css") return route.fulfill({ contentType: "text/css", body: "" })
      if (path === "/plain.css") return route.fulfill({ contentType: "text/css", body: ".btn { color: red }" })
      return route.fulfill({ contentType: "text/html", body: PAGES[path] ?? "<i>missing fixture</i>" })
    })
  })

  test("reports a healthy page as fully styled", async ({ page }) => {
    await page.goto(`${ORIGIN}/healthy`)
    const probe = await page.evaluate(probeStylesheets)

    expect(probe.deadLinks).toEqual([])
    expect(probe.declaredLinks).toBe(1)
    expect(probe.emptySheets).toBe(0)
    expect(probe.unreadableSheets).toBe(0)
    /* Two `.af-` selectors, one nested inside a media query. */
    expect(probe.afRules).toBe(2)
    expect(probe.afElements).toBe(2)
  })

  /* ─── THE CASE BOTH EARLIER VERSIONS COULD NOT SEE ─── */

  test("reports ONE dead sheet while other `af-` rules are still in effect", async ({ page }) => {
    /*
     * The 2026-09-12 CI failure reproduced without CI: a surviving stylesheet
     * supplies plenty of `af-` rules, and one `<link>` never becomes usable.
     * Version one had no field that differed between this and a healthy page.
     */
    await page.goto(`${ORIGIN}/partial`)
    const probe = await page.evaluate(probeStylesheets)

    expect(probe.declaredLinks).toBe(2)
    expect(probe.deadLinks).toEqual(["/dead.css"])
    /* ⚠ The point: `af-` rules ARE present, so the DOM signal cannot see this. */
    expect(probe.afRules).toBeGreaterThan(0)
    /* ⚠ And it must NOT be filed as opaque — that is what silenced the guard. */
    expect(probe.unreadableSheets).toBe(0)
  })

  test("still treats a genuinely CROSS-ORIGIN sheet as opaque, not dead", async ({ page }) => {
    /*
     * The abstain path must survive the fix. If a cross-origin sheet started
     * counting as dead, every page embedding a third-party stylesheet would red
     * the lane — and a gate that cannot pass gets switched off as fast as one
     * that cannot fail.
     */
    await page.goto(`${ORIGIN}/cross`)
    const probe = await page.evaluate(probeStylesheets)

    expect(probe.deadLinks).toEqual([])
    expect(probe.unreadableSheets).toBe(1)
  })

  test("reports a served-but-empty stylesheet", async ({ page }) => {
    await page.goto(`${ORIGIN}/empty`)
    const probe = await page.evaluate(probeStylesheets)

    expect(probe.emptySheets).toBe(1)
    expect(probe.deadLinks).toEqual([])
    expect(probe.afRules).toBe(1)
  })

  test("counts zero `af-` elements and rules on a page that uses none", async ({ page }) => {
    await page.goto(`${ORIGIN}/no-af`)
    const probe = await page.evaluate(probeStylesheets)

    expect(probe.afElements).toBe(0)
    /* ⚠ `.leaf-row` contains the substring `af-`; matching on `.af-` must not count it. */
    expect(probe.afRules).toBe(0)
    expect(probe.deadLinks).toEqual([])
  })
})
