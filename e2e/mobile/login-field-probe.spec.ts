import { readFileSync } from "node:fs"
import { join } from "node:path"
import { expect, test, type Page } from "@playwright/test"
import { probeGeometry } from "./geometryProbe"
import { waitForRouteReady } from "./routeReady"

/**
 * Controls for the /login field-size check (2026-09-14).
 *
 * Two defects, both proven here with the REAL stylesheets and the REAL probe:
 *
 *   1. `.af-au-field input` was 14px on a phone, so iOS Safari zoomed in on every sign-in
 *      and signup field and never zoomed back out. af-auth.css now ends with a 720px floor.
 *   2. phone-smoke usually measured /login's LOADING SHELL, because the form mounts after
 *      hydration and `load` can fire first. No inputs, so no small inputs, so green.
 *
 * ⚠ NO DEV SERVER AND NO DATABASE — `page.setContent` is the whole fixture, the same way
 * target-probe.spec.ts controls the probe's `visible()` predicate.
 */

const META = '<meta name="viewport" content="width=device-width,initial-scale=1,minimum-scale=1">'
const OPTS = { minTarget: 44, minFont: 16 }

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8")
const CORE_CSS = read("components/core-app/af-core.css")
const AUTH_CSS = read("components/core-app/af-auth.css")

/*
 * 🛑 THE FLOOR NOW LIVES IN TWO STYLESHEETS, AND STRIPPING ONE IS NOT A CONTROL.
 *
 * This fixture loads af-core.css AND af-auth.css, and `FORM` sits inside
 * `<main class="af-core">`. When af-core.css gained a shell-wide iOS zoom floor
 * (2026-09-19), `.af-core :is(input,…)` at (0,5,1) started beating
 * `.af-au-field input` at (0,1,1) — so a control that strips only af-auth.css
 * still measured 16px and went red asserting 14.
 *
 * That red was correct and it is the whole point of keeping these controls: a
 * repair for one failure mode had silently removed another guard's ability to
 * fail. The fix is to strip the floor from EVERY stylesheet that now provides
 * one, not to weaken the assertion to accept 16.
 *
 * ⚠ IF A THIRD FILE EVER GROWS A FLOOR, THIS BREAKS THE SAME WAY AND MUST BE
 * REPAIRED THE SAME WAY. `stripFloor` cuts at the LAST marker, so af-core.css's
 * own older `.af-search-input` floor is left in place — it targets a class this
 * fixture does not render, so it cannot mask the auth fields either way.
 */
const FLOOR_MARKER = "/* ── iOS zoom floor"
const stripFloor = (css: string) => {
  const at = css.lastIndexOf(FLOOR_MARKER)
  return at > 0 ? css.slice(0, at) : css
}
const authFloorAt = AUTH_CSS.lastIndexOf(FLOOR_MARKER)
const coreFloorAt = CORE_CSS.lastIndexOf(FLOOR_MARKER)
/** af-auth.css with the phone floor removed: the stylesheet as it was before the fix. */
const AUTH_CSS_UNFIXED = stripFloor(AUTH_CSS)
/** af-core.css with the shell-wide phone floor removed, for the same reason. */
const CORE_CSS_UNFIXED = stripFloor(CORE_CSS)

const FORM = `
  <main class="af-core"><div class="af-au"><div class="af-au-card">
    <form class="af-au-form">
      <label class="af-au-field">
        <span class="af-label">Email, username or phone</span>
        <input name="login" type="text" placeholder="you@email.com">
      </label>
      <div class="af-au-field">
        <span class="af-label">Password</span>
        <div class="af-au-pw">
          <input name="password" type="password">
          <button type="button" class="af-au-pw-toggle">Show</button>
        </div>
      </div>
    </form>
  </div></div></main>`

const BOOT_SHELL = `
  <main class="af-core af-au-boot"><div class="af-au-boot-inner">
    <div class="af-au-boot-wordmark">AllFantasy</div>
    <div class="af-au-boot-note" role="status">Loading…</div>
  </div></main>`

const page = (coreCss: string, authCss: string, body: string) =>
  `${META}<style>${coreCss}</style><style>${authCss}</style>${body}`

/** The shell now, the form after `delayMs` — ClientOnlyAuthPage's render order. */
const bootThenForm = (coreCss: string, authCss: string, delayMs: number) =>
  page(coreCss, authCss, BOOT_SHELL) +
  `<script>setTimeout(function () { document.body.innerHTML = ${JSON.stringify(FORM)} }, ${delayMs})</script>`

const fieldSizes = (p: Page) =>
  p.$$eval(".af-au-field input", (els) => els.map((el) => parseFloat(getComputedStyle(el).fontSize)))

test.describe("@mobile login field probe", () => {
  test("the fix is really in the stylesheet this probe reads", () => {
    expect(authFloorAt, "af-auth.css should end with the iOS zoom floor").toBeGreaterThan(0)
    expect(AUTH_CSS_UNFIXED.length).toBeLessThan(AUTH_CSS.length)
    // Same assertion for the shell-wide floor: if either marker stops matching,
    // `stripFloor` silently returns the FIXED stylesheet and every CONTROL below
    // starts passing for the wrong reason.
    expect(coreFloorAt, "af-core.css should end with the shell-wide iOS zoom floor").toBeGreaterThan(0)
    expect(CORE_CSS_UNFIXED.length).toBeLessThan(CORE_CSS.length)
  })

  test("🛑 sign-in fields are 16px on a phone, and both were actually measured", async ({ page: p }) => {
    await p.setContent(page(CORE_CSS, AUTH_CSS, FORM))
    const sizes = await fieldSizes(p)
    console.log(`[login-field-probe] phone ${p.viewportSize()?.width}px fixed: ${JSON.stringify(sizes)}`)

    // Two fields present: an empty measurement is exactly the false pass this file exists for.
    expect(sizes).toEqual([16, 16])
    expect((await p.evaluate(probeGeometry, OPTS)).smallFields).toEqual([])
  })

  test("desktop keeps the handoff's 14px", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const p = await ctx.newPage()
    await p.setContent(page(CORE_CSS, AUTH_CSS, FORM))
    const sizes = await fieldSizes(p)
    console.log(`[login-field-probe] desktop 1280px fixed: ${JSON.stringify(sizes)}`)
    expect(sizes).toEqual([14, 14])
    await ctx.close()
  })

  test("CONTROL: without the floor the same probe reports both fields at 14px", async ({ page: p }) => {
    await p.setContent(page(CORE_CSS_UNFIXED, AUTH_CSS_UNFIXED, FORM))
    const sizes = await fieldSizes(p)
    console.log(`[login-field-probe] phone ${p.viewportSize()?.width}px unfixed: ${JSON.stringify(sizes)}`)

    expect(sizes).toEqual([14, 14])
    const report = await p.evaluate(probeGeometry, OPTS)
    expect(report.smallFields.map((f) => f.fontPx)).toEqual([14, 14])
  })

  test("🛑 CONTROL: probing at `load` measures the loading shell and passes the old stylesheet", async ({ page: p }) => {
    await p.setContent(bootThenForm(CORE_CSS_UNFIXED, AUTH_CSS_UNFIXED, 1500))

    const inputsAtLoad = await p.evaluate(() => document.querySelectorAll("input").length)
    const early = await p.evaluate(probeGeometry, OPTS)
    // The false pass: nothing to measure, so nothing too small.
    expect(inputsAtLoad).toBe(0)
    expect(early.smallFields).toEqual([])

    // What phone-smoke now does before probing — and it catches the 14px fields.
    await waitForRouteReady(p, "/login")
    const ready = await p.evaluate(probeGeometry, OPTS)
    expect(ready.smallFields.map((f) => f.fontPx)).toEqual([14, 14])
  })

  test("waiting for the form, the fixed stylesheet passes for real", async ({ page: p }) => {
    await p.setContent(bootThenForm(CORE_CSS, AUTH_CSS, 1500))
    await waitForRouteReady(p, "/login")
    expect(await fieldSizes(p)).toEqual([16, 16])
    expect((await p.evaluate(probeGeometry, OPTS)).smallFields).toEqual([])
  })
})
