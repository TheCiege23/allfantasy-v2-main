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

const FLOOR_MARKER = "/* ── iOS zoom floor"
const floorAt = AUTH_CSS.lastIndexOf(FLOOR_MARKER)
/** af-auth.css with the phone floor removed: the stylesheet as it was before the fix. */
const AUTH_CSS_UNFIXED = floorAt > 0 ? AUTH_CSS.slice(0, floorAt) : AUTH_CSS

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

const page = (authCss: string, body: string) =>
  `${META}<style>${CORE_CSS}</style><style>${authCss}</style>${body}`

/** The shell now, the form after `delayMs` — ClientOnlyAuthPage's render order. */
const bootThenForm = (authCss: string, delayMs: number) =>
  page(authCss, BOOT_SHELL) +
  `<script>setTimeout(function () { document.body.innerHTML = ${JSON.stringify(FORM)} }, ${delayMs})</script>`

const fieldSizes = (p: Page) =>
  p.$$eval(".af-au-field input", (els) => els.map((el) => parseFloat(getComputedStyle(el).fontSize)))

test.describe("@mobile login field probe", () => {
  test("the fix is really in the stylesheet this probe reads", () => {
    expect(floorAt, "af-auth.css should end with the iOS zoom floor").toBeGreaterThan(0)
    expect(AUTH_CSS_UNFIXED.length).toBeLessThan(AUTH_CSS.length)
  })

  test("🛑 sign-in fields are 16px on a phone, and both were actually measured", async ({ page: p }) => {
    await p.setContent(page(AUTH_CSS, FORM))
    const sizes = await fieldSizes(p)
    console.log(`[login-field-probe] phone ${p.viewportSize()?.width}px fixed: ${JSON.stringify(sizes)}`)

    // Two fields present: an empty measurement is exactly the false pass this file exists for.
    expect(sizes).toEqual([16, 16])
    expect((await p.evaluate(probeGeometry, OPTS)).smallFields).toEqual([])
  })

  test("desktop keeps the handoff's 14px", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const p = await ctx.newPage()
    await p.setContent(page(AUTH_CSS, FORM))
    const sizes = await fieldSizes(p)
    console.log(`[login-field-probe] desktop 1280px fixed: ${JSON.stringify(sizes)}`)
    expect(sizes).toEqual([14, 14])
    await ctx.close()
  })

  test("CONTROL: without the floor the same probe reports both fields at 14px", async ({ page: p }) => {
    await p.setContent(page(AUTH_CSS_UNFIXED, FORM))
    const sizes = await fieldSizes(p)
    console.log(`[login-field-probe] phone ${p.viewportSize()?.width}px unfixed: ${JSON.stringify(sizes)}`)

    expect(sizes).toEqual([14, 14])
    const report = await p.evaluate(probeGeometry, OPTS)
    expect(report.smallFields.map((f) => f.fontPx)).toEqual([14, 14])
  })

  test("🛑 CONTROL: probing at `load` measures the loading shell and passes the old stylesheet", async ({ page: p }) => {
    await p.setContent(bootThenForm(AUTH_CSS_UNFIXED, 1500))

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
    await p.setContent(bootThenForm(AUTH_CSS, 1500))
    await waitForRouteReady(p, "/login")
    expect(await fieldSizes(p)).toEqual([16, 16])
    expect((await p.evaluate(probeGeometry, OPTS)).smallFields).toEqual([])
  })
})
