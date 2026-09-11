import { expect, test } from "@playwright/test"
import rawBaseline from "./undersized-target-baseline.json"

/**
 * The per-PR phone gate: invariants that must hold on every public route, on a
 * real emulated device, in both engines.
 *
 * WHAT THIS ADDS OVER THE VIEWPORT-RESIZING SPECS WE ALREADY HAVE.
 * `landing-page-click-audit` sweeps 320/360/390/430 with `setViewportSize`, and
 * it is the better test of the landing page specifically. But a resized desktop
 * browser is not a phone: it keeps the desktop user agent, `pointer: fine`, a
 * device pixel ratio of 1, and no touch support. This file runs under the
 * `Mobile Chrome` (Pixel 5) and `Mobile Safari` (iPhone 12) PROJECTS, so the
 * page sees a touch device and takes whatever code paths it takes for one.
 *
 * 🛑 IT OWNS `e2e/mobile/` AND THE DESKTOP PROJECTS IGNORE IT. See the projects
 * block in `playwright.config.ts`: an unscoped mobile project multiplies all 154
 * specs by two devices. The scoping is what makes enabling these projects cheap
 * enough to keep.
 *
 * ⚠ PUBLIC ROUTES ONLY, AND DELIBERATELY. The point of this lane is that it runs
 * on every PR, which means it must not need a seeded database, a login, or the
 * fixture tenant — all three are what make the `core` shards slow and flaky. An
 * authenticated phone journey is worth having and belongs in its own lane.
 */

/** Routes reachable signed-out. Keep this list short; this lane gates every PR. */
const PUBLIC_ROUTES = ["/", "/login", "/pricing"] as const

const MIN_TARGET = 44
const MIN_FIELD_FONT = 16

type BaselineEntry = { cls: string; label: string; seen?: string }
const BASELINE = rawBaseline as unknown as {
  routes: Record<string, BaselineEntry[]>
}

test.describe("@mobile phone smoke", () => {
  /*
   * A cold `next dev` route compile is measured at up to 32.5s in this repo's
   * own config note, and this lane visits several routes in one test.
   */
  test.describe.configure({ timeout: 180_000 })

  for (const route of PUBLIC_ROUTES) {
    test(`${route} holds the phone contract`, async ({ page }) => {
      const response = await page.goto(route, { waitUntil: "domcontentloaded" })

      /*
       * A route that 404s or 500s would otherwise "pass" every assertion below,
       * because an error page has no overflow and no undersized controls. The
       * emptiest page is the one most likely to satisfy a layout check.
       */
      expect(response?.status(), `${route} should not be an error page`).toBeLessThan(400)

      const report = await page.evaluate(
        ({ minTarget, minFont }) => {
          const visible = (el: Element): boolean => {
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

          return {
            /* +2px: sub-pixel layout rounding is not a sideways-scrolling page. */
            overflow: document.documentElement.scrollWidth > window.innerWidth + 2,
            scrollWidth: document.documentElement.scrollWidth,
            innerWidth: window.innerWidth,
            smallFields,
            smallTargets,
          }
        },
        { minTarget: MIN_TARGET, minFont: MIN_FIELD_FONT },
      )

      expect(
        report.overflow,
        `${route} scrolls sideways: scrollWidth ${report.scrollWidth} vs viewport ${report.innerWidth}`,
      ).toBeFalsy()

      expect(
        report.smallFields,
        `${route} has form fields under ${MIN_FIELD_FONT}px, which makes iOS Safari zoom in on focus and never back out`,
      ).toEqual([])

      /*
       * 🛑 TARGETS ARE A RATCHET, NOT A GREEN GATE, AND THE OTHER TWO ARE NOT.
       *
       * Overflow and field font-size were clean on every public route the day
       * this lane was switched on, so they are asserted outright and must stay
       * that way. Target size was NOT: seven controls across `/` and `/pricing`
       * were already under 44px, including the landing page's primary
       * "Get started free" CTA (36px tall) and the pricing Monthly/Yearly
       * toggle (27px). Requiring green would have blocked every PR in the repo
       * on debt none of them introduced, and the gate would have been switched
       * off inside a day — see `scripts/ts-error-baseline.json` and the vitest
       * ratchet for the same decision made twice before.
       *
       * So: a NEW undersized control fails; a known one does not. The baseline
       * can only shrink.
       */
      const known = new Set(
        (BASELINE.routes[route] ?? []).map((e) => `${e.cls}|${e.label}`),
      )
      const regressions = report.smallTargets.filter(
        (t) => !known.has(`${t.cls}|${t.label}`),
      )

      expect(
        regressions,
        `${route} gained controls under ${MIN_TARGET}x${MIN_TARGET} that are not in ` +
          `e2e/mobile/undersized-target-baseline.json. Make them ${MIN_TARGET}px, ` +
          `or add them to the baseline only if they are deliberate pre-existing debt.`,
      ).toEqual([])

      /*
       * ⚠ AND THE BASELINE MUST NOT OUTLIVE ITS ENTRIES. Without this, fixing a
       * control leaves a stale line that would silently re-permit the same
       * defect later — a ratchet that only ever loosens. Same failure the TS
       * ratchet avoids by regenerating its baseline.
       */
      const stillSmall = new Set(report.smallTargets.map((t) => `${t.cls}|${t.label}`))
      const staleBaseline = [...known].filter((k) => !stillSmall.has(k))
      expect(
        staleBaseline,
        `${route} has baseline entries that are no longer undersized — delete them ` +
          `from e2e/mobile/undersized-target-baseline.json`,
      ).toEqual([])
    })
  }
})
