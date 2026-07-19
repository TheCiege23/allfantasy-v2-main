import { expect, test, type Page } from "@playwright/test"

/**
 * V3 landing click audit — `/` renders `components/landing/v3/LandingV3.tsx`.
 *
 * REWRITTEN for V3. The previous version asserted a theme toggle and an EN/ES
 * language toggle; neither survived the Nocturne redesign, let alone V3, so the
 * spec had been failing on removed features rather than guarding live ones.
 *
 * What this guards now:
 *  - every nav / hero / OS / pricing / footer destination resolves (no 404s) —
 *    this is the standing check on the "15 new destination pages" promise
 *  - the import wizard's honest gating: Fantrax / MFL / Fleaflicker must stay
 *    non-selectable, because shipping them as clickable would put a false claim
 *    on the homepage (see the honesty model in V3ImportWizard.tsx)
 *  - the guest import failure path returns the visitor to the input instead of
 *    stranding them on the progress step
 *
 * Link-resolution strategy: destinations are collected from the rendered DOM and
 * checked over HTTP rather than by clicking through and navigating back ~50
 * times, which would be slow and flaky for no extra signal. Client-side
 * navigation IS exercised, once per surface, where the routing itself is the
 * thing under test. Note the nav dropdown links only exist in the DOM while
 * their menu is open — the old spec's single `a[href]` sweep never saw them, so
 * the 16 nav destinations went unaudited until now.
 *
 * `@growth` keeps this in the sharded core lane (`test:e2e:core` runs everything
 * not tagged @db/@activation/@retention).
 */

/** Section sizes as of the V3 build — minimums, so adding links is fine but losing a section fails. */
const EXPECT = {
  navGroups: 4,
  navLinks: 16,
  osCards: 9,
  pricingCards: 5,
  footerLinks: 19,
  platformCards: 7,
} as const

/** Providers that must never be selectable — `provider-ui-config.ts` says they don't work yet. */
const COMING_SOON = ["fantrax", "mfl", "fleaflicker"] as const

/**
 * Dev-server noise that is not a landing-page defect: HMR/websocket chatter, the
 * Next dev overlay's own logging, and favicon/asset 404s that don't affect the page.
 */
const IGNORED_CONSOLE = [
  /favicon/i,
  /\[HMR\]/i,
  /webpack-hmr/i,
  /React DevTools/i,
  /Download the React DevTools/i,
  /hydrat/i, // dev-only hydration warnings from third-party embeds; not a link defect
]

function watchConsole(page: Page): string[] {
  const errors: string[] = []
  page.on("console", (msg) => {
    if (msg.type() !== "error") return
    const text = msg.text()
    if (IGNORED_CONSOLE.some((re) => re.test(text))) return
    errors.push(text)
  })
  page.on("pageerror", (err) => errors.push(`pageerror: ${String(err)}`))
  return errors
}

/** Wait for the client-only landing bundle to mount (`app/page.tsx` uses ssr:false). */
async function gotoLanding(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("landing-nav")).toBeVisible({ timeout: 60_000 })
  await expect(page.getByTestId("landing-hero-headline")).toBeVisible()
}

/**
 * Same-origin, non-API hrefs from a set of elements, de-duplicated.
 *
 * The API filter matches `/api/…` and exactly `/api` — NOT a bare `startsWith('/api')`,
 * which also swallows the real marketing page `/api-status` and would drop it from the
 * audit without failing anything.
 */
async function hrefsOf(page: Page, testId: string): Promise<string[]> {
  return page.getByTestId(testId).evaluateAll((nodes) => {
    const origin = window.location.origin
    const out = new Set<string>()
    for (const node of nodes) {
      const raw = node.getAttribute("href")
      if (!raw || raw.startsWith("mailto:") || raw.startsWith("tel:") || raw.startsWith("#")) continue
      const url = new URL(raw, origin)
      if (url.origin !== origin) continue
      if (url.pathname === "/api" || url.pathname.startsWith("/api/")) continue
      out.add(`${url.pathname}${url.search}`)
    }
    return Array.from(out)
  })
}

/**
 * Check every destination, bounded-concurrently.
 *
 * Sequential checking cannot work here: each distinct route is a cold compile on the
 * dev server the harness boots, so ~25 links serially blows any sane test timeout and
 * surfaces as "Request context disposed" mid-sweep rather than as a link failure.
 * Six at a time keeps the server busy without swamping it.
 */
async function assertAllResolve(
  request: import("@playwright/test").APIRequestContext,
  hrefs: string[],
  label: string,
) {
  const CONCURRENCY = 4
  const queue = [...hrefs]
  const broken: string[] = []

  async function worker() {
    for (let href = queue.shift(); href !== undefined; href = queue.shift()) {
      try {
        const res = await request.get(href, { timeout: 120_000 })
        if (res.status() >= 400) broken.push(`${href} → ${res.status()}`)
      } catch (err) {
        broken.push(`${href} → threw ${String(err).slice(0, 80)}`)
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker))
  // Collect every failure before asserting: a per-link expect() would abort on the
  // first 404 and hide how much of the surface is actually broken.
  expect(broken.sort(), `${label}: unreachable destinations`).toEqual([])
}

test.describe("@growth V3 landing page click audit", () => {
  /*
   * Serial, and deliberately so.
   *
   * These tests fan out across ~25 marketing routes, each a cold compile on first hit.
   * Run in parallel they saturate the one dev server they share, and the client-side
   * navigation assertion below then stalls waiting for an RSC payload queued behind
   * everyone else's builds — a flake with nothing to say about the landing page.
   * (CI already runs `workers: 1`; this makes local runs behave the same way.)
   *
   * The timeout is generous for the same reason; warm re-runs finish far inside it.
   */
  test.describe.configure({ mode: "serial", timeout: 600_000 })

  test("nav click audit: every dropdown destination renders and resolves", async ({ page, request }) => {
    const consoleErrors = watchConsole(page)
    await page.setViewportSize({ width: 1366, height: 900 })
    await gotoLanding(page)

    await expect(page.getByTestId("landing-logo-link")).toBeVisible()
    await expect(page.getByTestId("landing-open-app-button")).toBeVisible()
    await expect(page.getByTestId("landing-sign-up-button")).toBeVisible()

    const groups = page.getByTestId("landing-nav-group")
    await expect(groups).toHaveCount(EXPECT.navGroups)

    // Open each dropdown in turn and harvest its links — they are unmounted when closed.
    const navHrefs = new Set<string>()
    for (let i = 0; i < EXPECT.navGroups; i += 1) {
      const group = groups.nth(i)
      await group.click()
      await expect(page.getByTestId("landing-nav-menu")).toBeVisible()
      for (const href of await hrefsOf(page, "landing-nav-menu-link")) navHrefs.add(href)
      await page.keyboard.press("Escape")
      await expect(page.getByTestId("landing-nav-menu")).toHaveCount(0)
    }

    expect(navHrefs.size, "nav dropdown destinations").toBeGreaterThanOrEqual(EXPECT.navLinks)

    // Only one dropdown may be open at a time.
    await groups.nth(0).click()
    await expect(page.getByTestId("landing-nav-menu")).toHaveCount(1)
    await groups.nth(1).click()
    await expect(page.getByTestId("landing-nav-menu")).toHaveCount(1)
    await page.keyboard.press("Escape")
    await expect(page.getByTestId("landing-nav-menu")).toHaveCount(0)

    // Assert console cleanliness while STILL ON THE LANDING PAGE. This spec audits `/`;
    // once we navigate away we start collecting other pages' noise, and /pricing (which
    // predates this landing page on main) logs `token-balance: Unauthorized` for
    // anonymous visitors — a real but out-of-scope condition that would otherwise fail
    // this test for something it does not own.
    expect(consoleErrors, "console errors on the landing page").toEqual([])

    /*
     * Exercise real client-side navigation once — the HTTP sweep proves the routes
     * exist, not that the links are wired to them.
     *
     * ORDER MATTERS: this runs BEFORE the sweep. A client transition needs an RSC
     * payload from the dev server, and the sweep deliberately saturates that server
     * with concurrent cold compiles — running it after queued the transition behind
     * ~25 builds and stalled past a 60s wait. Warm the one route, click while the
     * server is idle, then do the bulk work.
     */
    await request.get("/pricing", { timeout: 120_000 })
    await page.getByTestId("landing-nav-pricing").click()
    await expect(page).toHaveURL(/\/pricing/, { timeout: 60_000 })

    await assertAllResolve(request, Array.from(navHrefs), "nav")
  })

  test("surface click audit: hero, OS grid, pricing, and footer destinations resolve", async ({ page, request }) => {
    const consoleErrors = watchConsole(page)
    await page.setViewportSize({ width: 1366, height: 900 })
    await gotoLanding(page)

    await expect(page.getByTestId("landing-hero-cta-group")).toBeVisible()
    await expect(page.getByTestId("landing-hero-primary-cta")).toBeVisible()
    await expect(page.getByTestId("landing-os-card")).toHaveCount(EXPECT.osCards)
    await expect(page.getByTestId("landing-pricing-card")).toHaveCount(EXPECT.pricingCards)
    await expect(page.getByTestId("landing-footer")).toBeVisible()

    const hrefs = new Set<string>()
    for (const id of [
      "landing-hero-demo-cta",
      "landing-os-card",
      "landing-pricing-cta",
      "landing-pricing-compare",
      "landing-final-cta-secondary",
      "landing-footer-link",
    ]) {
      for (const href of await hrefsOf(page, id)) hrefs.add(href)
    }

    const footerHrefs = await hrefsOf(page, "landing-footer-link")
    expect(footerHrefs.length, "footer destinations").toBeGreaterThanOrEqual(EXPECT.footerLinks)
    await assertAllResolve(request, Array.from(hrefs), "landing surfaces")

    // Every paid plan CTA must carry its plan through the signup intent, or the
    // visitor silently lands on a generic signup and the plan choice is lost.
    const pricingHrefs = await hrefsOf(page, "landing-pricing-cta")
    const planCarrying = pricingHrefs.filter((h) => /next=.*upgrade/.test(h))
    expect(planCarrying.length, `pricing CTAs preserving plan intent (got ${pricingHrefs.join(", ")})`)
      .toBeGreaterThanOrEqual(3)

    // The hero's primary CTA is an in-page jump to the wizard, not a route.
    await page.getByTestId("landing-hero-primary-cta").click()
    await expect(page.getByTestId("v3-import-wizard")).toBeInViewport({ timeout: 15_000 })

    expect(consoleErrors, "console errors during surface audit").toEqual([])
  })

  test("import wizard click audit: platform gating and step progression", async ({ page }) => {
    const consoleErrors = watchConsole(page)
    await page.setViewportSize({ width: 1366, height: 900 })
    await gotoLanding(page)

    const cards = page.getByTestId("v3-platform-card")
    await expect(cards).toHaveCount(EXPECT.platformCards)
    await expect(page.getByTestId("v3-import-wizard")).toHaveAttribute("data-step", "0")

    // Unusable providers must stay disabled — see the honesty model in V3ImportWizard.tsx.
    for (const id of COMING_SOON) {
      const card = page.locator(`[data-testid="v3-platform-card"][data-platform="${id}"]`)
      await expect(card, `${id} must not be selectable`).toBeDisabled()
      await expect(card).toContainText(/coming soon/i)
    }

    // Sleeper is the only real no-account import: choose → instructions → input.
    await page.locator('[data-testid="v3-platform-card"][data-platform="sleeper"]').click()
    await expect(page.getByTestId("v3-import-wizard")).toHaveAttribute("data-step", "1")
    await page.getByTestId("v3-wizard-next").click()
    await expect(page.getByTestId("v3-import-wizard")).toHaveAttribute("data-step", "2")
    await expect(page.getByTestId("v3-import-input")).toBeVisible()
    // Submit stays disabled until there is something to submit.
    await expect(page.getByTestId("v3-import-submit")).toBeDisabled()

    // Back must unwind, not dead-end.
    await page.getByRole("button", { name: /back/i }).first().click()
    await expect(page.getByTestId("v3-import-wizard")).toHaveAttribute("data-step", "1")
    await page.getByTestId("v3-wizard-back").click()
    await expect(page.getByTestId("v3-import-wizard")).toHaveAttribute("data-step", "0")

    // ESPN/Yahoo work but need an account — they must offer signup, never a fake import.
    await page.locator('[data-testid="v3-platform-card"][data-platform="espn"]').click()
    await expect(page.getByTestId("v3-wizard-signup-cta")).toBeVisible()
    await expect(page.getByTestId("v3-import-input")).toHaveCount(0)
    await expect(page.getByTestId("v3-wizard-help-link")).toHaveAttribute("href", "/import-guides")

    // Native leagues route to creation rather than import.
    await page.getByTestId("v3-wizard-back").click()
    await page.locator('[data-testid="v3-platform-card"][data-platform="native"]').click()
    await expect(page.getByTestId("v3-wizard-create-league")).toHaveAttribute("href", "/create-league")

    expect(consoleErrors, "console errors during wizard audit").toEqual([])
  })

  /**
   * The import endpoint is stubbed rather than driven against live Sleeper.
   *
   * What is under test here is the WIZARD'S HANDLING of a rejected import, not
   * Sleeper's uptime. Hitting the real endpoint made this flaky for two reasons that
   * have nothing to do with the landing page: the 404 verdict depends on a live
   * upstream lookup whose latency is a third party's to decide (it blew a 60s wait on
   * one run and passed on the next), and the route rate-limits to 3/username+IP per
   * 10min and 15/IP per hour, which a shared CI egress IP plus two retries can exhaust
   * into a false red.
   *
   * The stub replays the exact payload `server/api-route-modules/legacy/guest-import`
   * returns for an unknown handle, so a regression that swallows the server's error or
   * strands the visitor on the progress step still fails this test.
   */
  test("guest import failure path: rejected handle surfaces the error and returns to the input", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 })

    await page.route("**/api/legacy/guest-import", async (route) => {
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ error: "Sleeper user not found" }),
      })
    })

    await gotoLanding(page)

    await page.locator('[data-testid="v3-platform-card"][data-platform="sleeper"]').click()
    await page.getByTestId("v3-wizard-next").click()

    await page.getByTestId("v3-import-input").fill("af-e2e-no-such-user")
    await page.getByTestId("v3-import-submit").click()

    const alert = page.getByTestId("v3-import-error")
    await expect(alert).toBeVisible({ timeout: 30_000 })
    await expect(alert).toHaveText(/Sleeper user not found/i)

    // The real guarantee: the visitor is back on the input, able to retry — not
    // stranded on the progress step with nothing to do.
    await expect(page.getByTestId("v3-import-wizard")).toHaveAttribute("data-step", "2")
    await expect(page.getByTestId("v3-import-input")).toBeEditable()
    await expect(page.getByTestId("v3-import-submit")).toBeEnabled()
    await expect(page).toHaveURL(/\/$|\/#import$/)
  })

  /**
   * Companion to the stubbed test above: proves the REAL endpoint is reachable and
   * rejects an unknown handle, without depending on how fast it does so. Kept as a
   * plain request so upstream latency can't strand a browser assertion, and tolerant
   * of a 429 so a rate-limited CI IP reports as itself instead of as a regression.
   */
  test("guest import endpoint contract: unknown handle is rejected", async ({ request }) => {
    const res = await request.post("/api/legacy/guest-import", {
      data: { sleeper_username: `af-e2e-no-such-user-${Date.now().toString(36)}` },
      timeout: 120_000,
    })
    expect([404, 429], `unexpected status ${res.status()}`).toContain(res.status())
    if (res.status() === 404) {
      expect(JSON.stringify(await res.json())).toMatch(/not found/i)
    }
  })

  test("mobile click audit: drawer destinations resolve and nothing overflows", async ({ page, request }) => {
    const consoleErrors = watchConsole(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await gotoLanding(page)

    await expect(page.getByTestId("landing-hero-cta-group")).toBeVisible()

    const burger = page.getByTestId("landing-nav-burger")
    await expect(burger).toBeVisible()
    await expect(page.getByTestId("landing-nav-mobile")).toHaveCount(0)
    await burger.click()

    const drawer = page.getByTestId("landing-nav-mobile")
    await expect(drawer).toBeVisible()
    const drawerHrefs = await drawer.locator("a[href]").evaluateAll((links) => {
      const origin = window.location.origin
      const out = new Set<string>()
      for (const node of links) {
        const raw = node.getAttribute("href")
        if (!raw || raw.startsWith("#")) continue
        const url = new URL(raw, origin)
        if (url.origin !== origin) continue
        if (url.pathname === "/api" || url.pathname.startsWith("/api/")) continue
        out.add(`${url.pathname}${url.search}`)
      }
      return Array.from(out)
    })
    expect(drawerHrefs.length, "mobile drawer destinations").toBeGreaterThanOrEqual(EXPECT.navLinks)
    await assertAllResolve(request, drawerHrefs, "mobile drawer")

    await burger.click()
    await expect(drawer).toHaveCount(0)

    const overflows = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2)
    expect(overflows, "mobile viewport must not scroll horizontally").toBeFalsy()

    expect(consoleErrors, "console errors during mobile audit").toEqual([])
  })
})
