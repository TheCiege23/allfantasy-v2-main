import { expect, test } from "@playwright/test"
import rawBaseline from "./undersized-target-baseline.json"
import { compareTargets, type BaselineTarget } from "./targetRatchet"
import { probeGeometry } from "./geometryProbe"
import {
  diagnoseStylesheets,
  unstyledFailureMessage,
  probeStylesheets,
  type CssRequestFailure,
} from "./stylesheetGuard"

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

const BASELINE = rawBaseline as unknown as {
  routes: Record<string, BaselineTarget[]>
}

test.describe("@mobile phone smoke", () => {
  /*
   * A cold `next dev` route compile is measured at up to 32.5s in this repo's
   * own config note, and this lane visits several routes in one test.
   */
  test.describe.configure({ timeout: 180_000 })

  for (const route of PUBLIC_ROUTES) {
    test(`${route} holds the phone contract`, async ({ page }) => {
      /*
       * ⚠ REGISTERED BEFORE `goto`, OR THEY MISS THE ONLY EVENTS THAT MATTER.
       * The stylesheet requests this is watching for are issued while the
       * document is still parsing; a listener attached after the navigation
       * resolves has already missed them and would report a clean run for the
       * exact failure it exists to catch.
       */
      const cssFailures: CssRequestFailure[] = []
      const isStylesheet = (req: { resourceType(): string; url(): string }) =>
        req.resourceType() === "stylesheet" || /\.css(\?|$)/.test(req.url())

      page.on("requestfailed", (req) => {
        if (!isStylesheet(req)) return
        cssFailures.push({ url: req.url(), reason: req.failure()?.errorText ?? "request failed" })
      })
      page.on("response", (res) => {
        if (!isStylesheet(res.request())) return
        if (res.status() >= 400) cssFailures.push({ url: res.url(), reason: `status ${res.status()}` })
      })

      const response = await page.goto(route, { waitUntil: "domcontentloaded" })

      /*
       * A route that 404s or 500s would otherwise "pass" every assertion below,
       * because an error page has no overflow and no undersized controls. The
       * emptiest page is the one most likely to satisfy a layout check.
       */
      expect(response?.status(), `${route} should not be an error page`).toBeLessThan(400)

      /*
       * ⚠ `domContentLoaded` above is deliberate (a cold route compile is slow),
       * but a `<link>`'s `.sheet` is legitimately null while it is still being
       * fetched — so reading the per-sheet signal at DCL would red a PR for a
       * stylesheet that was merely in flight. Wait for `load`, and SWALLOW the
       * timeout: failing to reach load is itself suspicious, and the probe
       * below describes it better than a bare Playwright timeout would.
       */
      await page.waitForLoadState("load", { timeout: 30_000 }).catch(() => {})

      /*
       * Probed in its own `page.evaluate` so the SAME function can be driven by
       * `stylesheet-probe.spec.ts` against `page.setContent` — no dev server, no
       * database. That testability is the entire repair: version one kept this
       * inline, so nothing could exercise it, and it shipped unable to tell one
       * dead sheet from a healthy page.
       *
       * ⚠ AND AN EARLIER COMMENT HERE CLAIMED BOTH PROBES HAD TO SHARE ONE
       * EVALUATE "or they describe different paints". That was wrong and is
       * withdrawn: a stylesheet that has parsed does not stop being in effect,
       * so the failure is at LOAD time, not between two evaluates. Probing
       * first, before a single rectangle is read, is what actually matters.
       */
      const stylesheet = await page.evaluate(probeStylesheets)

      const report = await page.evaluate(probeGeometry, {
        minTarget: MIN_TARGET,
        minFont: MIN_FIELD_FONT,
      })

      /*
       * 🛑 THIS ASSERTION STAYS FIRST. Everything below it measures pixels, and
       * pixels from an unstyled page are worse than no measurement: plausible,
       * specific, and wrong. `response.status() < 400` above cannot catch that —
       * a dev-server restart still returns 200 for the DOCUMENT; it is the
       * subresources that die.
       *
       * ⚠ AND A CORRECTION, KEPT BECAUSE THE WRONG VERSION WAS CONFIDENT AND
       * EXPENSIVE. This comment used to claim the lane's 20px-wide nav links
       * WERE an unstyled render. They were not. The probe below reported
       * `afRules: 248, deadLinks: [], cssFailures: []` on the failing run — the
       * page was fully styled every time. The 20px links are the CLOSED mobile
       * `<details>` menu, which `visible()` could not detect; see
       * `geometryProbe.ts`. An entire stylesheet investigation, and a confident
       * correction sent to a peer whose CSS diagnosis I called wrong, rested on
       * reading one impossible number and never asking whether the DOM held a
       * SECOND copy of those labels. It did.
       *
       * So this guard remains, because a restart resetting subresources is a
       * real thing that would produce exactly the reading nobody could then
       * disprove — but it is not why this lane was red, and it must not be
       * described as if it were.
       */
      /*
       * 🛑 REPORTED ON EVERY RUN, PASS OR FAIL, AND THAT IS NOT NOISE — IT IS
       * THE REPAIR FOR HOW THIS GUARD FAILED THE FIRST TIME. Its first CI run
       * met the exact failure it was built for, stayed silent, and left NO
       * record of its own inputs: afRules, deadLinks and the rest were
       * unrecoverable from the log, so "why did it abstain" could not be
       * answered from the evidence. A guard that is quiet when it passes cannot
       * be debugged when it is wrong to pass.
       */
      console.log(
        `[stylesheet-guard] ${route} ${JSON.stringify(stylesheet)} cssFailures=${JSON.stringify(cssFailures)}`,
      )

      const stylesheetVerdict = diagnoseStylesheets(stylesheet, cssFailures)
      expect(stylesheetVerdict.styled, unstyledFailureMessage(route, stylesheetVerdict)).toBe(true)

      /*
       * ⚠ SOFT FROM HERE DOWN, HARD ABOVE — AND THE SPLIT IS THE POINT. The two
       * checks above decide whether this is the right page at all (not an error
       * page, actually styled); if one fails, every number below
       * describes the wrong screen, so the test must stop. The four below are
       * independent measurements of the right screen. As hard asserts, the first
       * red one hid the rest: /commissioner-os reported only its 481px overflow,
       * and its four 36px controls surfaced one whole CI round-trip later.
       */
      expect.soft(
        report.overflow,
        `${route} scrolls sideways: scrollWidth ${report.scrollWidth} vs viewport ${report.innerWidth}
` +
          `widest offenders (right edge past the viewport): ${JSON.stringify(report.overflowing)}`,
      ).toBeFalsy()

      expect.soft(
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
      /*
       * ⚠ THE COMPARISON LIVES IN `targetRatchet.ts`, AND THAT IS THE POINT.
       * Inline here, its regression branch could only be forced red by arranging
       * a browser, a dev server, a database and an unbaselined control all at
       * once — which failed three times for environmental reasons and never once
       * told us whether the branch worked. As a pure function it is proven both
       * ways in milliseconds by `__tests__/mobile/target-ratchet.test.ts`.
       *
       * 🛑 DO NOT REINLINE IT. The unit test would keep passing while guarding
       * nothing — this import is the only thing tying the proven code to the
       * gate that runs.
       */
      const { regressions, stale } = compareTargets(
        report.smallTargets,
        BASELINE.routes[route] ?? [],
      )

      expect.soft(
        regressions,
        `${route} gained controls under ${MIN_TARGET}x${MIN_TARGET} that are not in ` +
          `e2e/mobile/undersized-target-baseline.json. Make them ${MIN_TARGET}px, ` +
          `or add them to the baseline only if they are deliberate pre-existing debt.\n` +
          /*
           * ⚠ CARRIED INTO THIS MESSAGE ON PURPOSE. The stylesheet guard above
           * has already passed by the time anyone reads this, and its verdict
           * is the first thing that decides whether these numbers are real. A
           * control reported NARROWER THAN ITS OWN FONT-SIZE is text collapsed
           * to one character per line, not a small button — that is what an
           * unstyled render looks like, and it is the reading that cost a day.
           */
          `stylesheet state at measurement: ${JSON.stringify(stylesheet)}`,
      ).toEqual([])

      /*
       * ⚠ AND THE BASELINE MUST NOT OUTLIVE ITS ENTRIES. Without this, fixing a
       * control leaves a stale line that would silently re-permit the same
       * defect later — a ratchet that only ever loosens. Same failure the TS
       * ratchet avoids by regenerating its baseline.
       */
      expect.soft(
        stale,
        `${route} has baseline entries that are no longer undersized — delete them ` +
          `from e2e/mobile/undersized-target-baseline.json`,
      ).toEqual([])
    })
  }
})
