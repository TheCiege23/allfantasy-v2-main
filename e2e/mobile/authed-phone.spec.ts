import { execFileSync } from "node:child_process"
import { resolve } from "node:path"
import { expect, test } from "@playwright/test"
import rawBaseline from "./undersized-target-baseline.authed.json"
import { compareTargets, type BaselineTarget } from "./targetRatchet"
import { probeGeometry } from "./geometryProbe"
import { diagnoseStylesheets, probeStylesheets, unstyledFailureMessage, type CssRequestFailure } from "./stylesheetGuard"
import { AUTHED_ROUTES } from "./authedRoutes"
import { loginAs } from "../helpers/credentials-login"
import { TC_TRADE_SEED } from "../../scripts/seed-redraft-trade-walkthrough.constants"

/**
 * The AUTHENTICATED phone gate — the lane `phone-smoke.spec.ts` said belonged
 * somewhere else:
 *
 *   "An authenticated phone journey is worth having and belongs in its own lane."
 *
 * It is separate because the reason that spec is public-routes-only still holds:
 * a seeded database and a login are what make the `core` shards slow and flaky,
 * and the per-PR smoke must stay cheap. So this file is tagged `@db`,
 * `test:e2e:mobile` excludes `@db`, and `test:e2e:mobile:auth` runs only it.
 *
 * 🛑 WHY THESE SCREENS HAVE NEVER BEEN MEASURED ON A PHONE. `/core/*` is
 * auth-gated — `app/core/[[...screen]]/page.tsx` redirects to `/login` without a
 * session and to `/import` without a league — so every mobile check the repo had
 * stopped at the marketing routes. Trade Center's phone CSS was written, shipped,
 * and never once rendered at 390px by anything automated. Four of its touch
 * targets turned out to be an equal-specificity coin toss against
 * `.af-core .af-btn { min-height: 36px }`; that was found by reading stylesheets,
 * not by running the app, because nothing could run the app here.
 */

/*
 * ⚠ A SEPARATE BASELINE FROM THE PUBLIC SMOKE, AND NOT FOR TIDINESS.
 * `target-ratchet.test.ts` pins `undersized-target-baseline.json` to cover
 * EXACTLY the routes phone-smoke visits. Adding an authed route to it broke that
 * assertion on the first CI run — correctly. Relaxing the check to a union of two
 * specs would have weakened a guard doing real work to accommodate a new lane.
 */
const BASELINE = rawBaseline as unknown as { routes: Record<string, BaselineTarget[]> }

const MIN_TARGET = 44
const MIN_FIELD_FONT = 16


/**
 * 🛑 THIS SUITE SEEDS LEAGUES AND USERS, SO IT REFUSES TO RUN ANYWHERE BUT A
 * LOCAL DATABASE. In this repo `.env` and `.env.local` are PRODUCTION, and
 * `@prisma/client` populates `process.env` from `.env` on import — so a developer
 * running this locally with no thought would point `seed-redraft-trade-walkthrough`
 * at the live database and create `tc-nfl-league` in it.
 *
 * ⚠ AN ALLOWLIST, NOT A DENYLIST, AND THE DIRECTION MATTERS. This file already
 * records that a `.vercel.app` hostname is not proof you are OFF production —
 * true, and it is why "block the known-bad host" is the wrong shape. Requiring
 * loopback is the conservative inverse: anything unrecognised skips.
 *
 * ⚠ AND IT SKIPS RATHER THAN FAILS. A suite that goes permanently red when it
 * cannot reach a database is a suite people stop reading, and `vitest.setup.db-guard`
 * learned the same thing — skip, so it still appears in the run summary.
 */
function isLoopbackDatabase(): boolean {
  const url = process.env.DATABASE_URL ?? ""
  if (!url) return false
  try {
    const host = new URL(url).hostname
    return host === "127.0.0.1" || host === "localhost" || host === "::1"
  } catch {
    return false
  }
}

const CAN_RUN = isLoopbackDatabase() && Boolean(process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET)

test.describe("@db @mobile authenticated phone contract", () => {
  test.describe.configure({ timeout: 240_000 })
  test.skip(
    !CAN_RUN,
    "Needs a LOOPBACK DATABASE_URL and NEXTAUTH_SECRET. Skipped rather than run: .env/.env.local are production here.",
  )

  /*
   * 🛑 THE CONSTANTS COME FROM A MODULE THAT IMPORTS NOTHING, AND THE SEED ITSELF
   * IS ONLY EVER RUN AS A SUBPROCESS. Both halves matter.
   *
   * `seed-redraft-trade-walkthrough.ts` does `new PrismaClient()` at module scope,
   * and importing `@prisma/client` populates `process.env` from `.env` — production
   * here. Importing it from a spec would do that during test COLLECTION, in every
   * lane, including ones that never touch a database.
   *
   * ⚠ A DYNAMIC `await import()` WAS TRIED FIRST AND FAILED IN CI:
   * `SyntaxError: Cannot use import statement outside a module`. Playwright
   * transpiles a spec's STATIC imports; a runtime dynamic import of a `.ts` file
   * goes to Node's loader, which sees raw TypeScript. The fix is a constants module,
   * not a cleverer import.
   */
  test.beforeAll(() => {
    execFileSync(process.execPath, ["--import", "tsx", resolve(__dirname, "../../scripts/seed-redraft-trade-walkthrough.ts")], {
      stdio: "inherit",
      env: process.env,
    })
  })

  /*
   * ⚠ SIGNED-OUT WARM-UP OF BOTH ROUTES. Only `/commissioner-os` is measurably
   * cold here; the `/core/trades` half is redundant, and was added on a theory CI
   * then disproved. Measured on PR #767 (run 34721325020, mobile-auth):
   *
   *   [global-setup] warmed 33 routes in 127s    incl. /dashboard 200 18957ms
   *   [authed-warmup] /core/trades     200 1012ms   (758ms, second project)
   *   [authed-warmup] /commissioner-os skipped (TypeError) 406ms, then 307 190ms
   *
   * `e2e/global-setup.ts` fetches `/dashboard` with `redirect: 'follow'`, and
   * middleware `redirectDeprecatedDashboardRoutes` sends it to `/core` — so the
   * `app/core/[[...screen]]/page.tsx` catch-all that renders `/core/trades` is
   * ALREADY compiled before this hook runs. It answered 200, not a 307 to `/login`.
   *
   * 🛑 SO THE 240s FIRST-ATTEMPT `/core/trades` TIMEOUT ON PR #754 (run
   * 34717571125, retry passed in ~30s) IS NOT A COLD COMPILE, AND IS UNEXPLAINED.
   * Do not cite this hook as its fix.
   *
   * Kept for `/commissioner-os`, which global-setup does not visit. It never gates
   * the run: a failed warm-up only means the test pays the compile.
   */
  test.beforeAll(async ({}, testInfo) => {
    const WARM_TIMEOUT_MS = 180_000
    test.setTimeout(WARM_TIMEOUT_MS * AUTHED_ROUTES.length + 30_000)
    const baseURL = String(testInfo.project.use.baseURL)
    for (const { route } of AUTHED_ROUTES) {
      const started = Date.now()
      try {
        const res = await fetch(`${baseURL}${route}`, {
          redirect: "manual",
          signal: AbortSignal.timeout(WARM_TIMEOUT_MS),
        })
        await res.text().catch(() => "")
        console.log(`[authed-warmup] ${route} ${res.status} ${Date.now() - started}ms`)
      } catch (err) {
        console.log(`[authed-warmup] ${route} skipped (${(err as Error).name}) ${Date.now() - started}ms`)
      }
    }
  })

  for (const { route, login } of AUTHED_ROUTES) {
    test(`${route} holds the phone contract when signed in`, async ({ page }) => {
      const cssFailures: CssRequestFailure[] = []
      const isStylesheet = (req: { resourceType(): string; url(): string }) =>
        req.resourceType() === "stylesheet" || /\.css(\?|$)/.test(req.url())
      page.on("requestfailed", (req) => {
        if (isStylesheet(req)) cssFailures.push({ url: req.url(), reason: req.failure()?.errorText ?? "request failed" })
      })
      page.on("response", (res) => {
        if (isStylesheet(res.request()) && res.status() >= 400)
          cssFailures.push({ url: res.url(), reason: `status ${res.status()}` })
      })

      const who = login === "commissioner" ? TC_TRADE_SEED.commissionerLogin : TC_TRADE_SEED.managerLogins[0]!
      await loginAs(page, who, TC_TRADE_SEED.password)

      const response = await page.goto(route, { waitUntil: "domcontentloaded" })
      expect(response?.status(), `${route} should not be an error page`).toBeLessThan(400)

      /*
       * 🛑 THE PREMISE GUARD, AND IT IS THE WHOLE REASON THIS LANE CAN BE
       * TRUSTED. `/core/*` redirects to `/login` without a session and to
       * `/import` without a league. Both redirects render a perfectly valid page
       * with no overflow, no small fields and no undersized targets — so every
       * assertion below would PASS while measuring a screen that is not Trade
       * Center. An authenticated gate that silently tests the signed-out page is
       * the most expensive kind of green.
       */
      const landed = new URL(page.url()).pathname
      expect(landed, `${route} redirected to ${landed} — the session or the seeded league is missing`).toBe(route)

      await page.waitForLoadState("load", { timeout: 30_000 }).catch(() => {})

      const stylesheet = await page.evaluate(probeStylesheets)
      console.log(`[stylesheet-guard] ${route} ${JSON.stringify(stylesheet)} cssFailures=${JSON.stringify(cssFailures)}`)

      const verdict = diagnoseStylesheets(stylesheet, cssFailures)
      expect(verdict.styled, unstyledFailureMessage(route, verdict)).toBe(true)

      const report = await page.evaluate(probeGeometry, { minTarget: MIN_TARGET, minFont: MIN_FIELD_FONT })

      /*
       * ⚠ SOFT FROM HERE DOWN, HARD ABOVE — AND THE SPLIT IS THE POINT. The three
       * checks above decide whether this is the right page at all (not an error,
       * not a redirect, actually styled); if one fails, every number below
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
       * ⚠ TARGETS RATCHET AGAINST THE SAME BASELINE FILE, KEYED BY ROUTE, and
       * these routes start EMPTY because nothing has ever measured them. If the
       * first CI run is red, that is the lane working: it is reporting debt that
       * has been invisible since the screen shipped, not a regression anyone
       * introduced. Baseline what it finds, deliberately, one entry at a time.
       */
      const { regressions, stale } = compareTargets(report.smallTargets, BASELINE.routes[route] ?? [])

      expect.soft(
        regressions,
        `${route} has controls under ${MIN_TARGET}x${MIN_TARGET} that are not in ` +
          /*
           * ⚠ NAME THE AUTHED FILE, NOT THE PUBLIC ONE. This message said
           * `undersized-target-baseline.json` while the spec reads
           * `.authed.json` — so it sent the reader to edit the wrong file, where
           * adding the route would then break `target-ratchet.test.ts`'s
           * "covers exactly the smoke routes" pin. A misleading error message
           * that causes a SECOND failure is worse than a vague one.
           */
          `e2e/mobile/undersized-target-baseline.authed.json — NOT the public baseline,\n` +
          `which target-ratchet.test.ts pins to exactly the three smoke routes.\n` +
          `stylesheet state at measurement: ${JSON.stringify(stylesheet)}`,
      ).toEqual([])

      expect.soft(
        stale,
        `${route} has baseline entries that are no longer undersized — delete them`,
      ).toEqual([])
    })
  }
})
