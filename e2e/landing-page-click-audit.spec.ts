import { expect, test } from "@playwright/test"

/**
 * Landing click audit, retargeted at LandingV4.
 *
 * ⚠ THIS SPEC HAS NOW BEEN OUTRUN BY A LANDING CUT-OVER TWICE, and the second
 * time it failed exactly as its own previous note described. It asserted
 * `nocturne-*` testids; `/` renders `LandingV4` (app/page.tsx), which shipped
 * with NO testids at all — so every `getByTestId` here resolved to nothing and
 * the suite reported the homepage as broken when what was broken was the spec.
 *
 * The fix on both sides: LandingV4 now carries stable `landing-*` testids that
 * are named for the ROLE of each affordance (nav CTA, hero primary, pricing
 * CTA) rather than for the design that happens to render it. A third redesign
 * that keeps a hero CTA keeps `landing-hero-primary`, and this spec survives it.
 *
 * What this guards, and why it is the tool for auditing `/` without production:
 * it crawls every `<a href>` the page actually rendered and asserts each
 * internal one answers < 400. That is the "does everything lead somewhere"
 * check, run against a local dev server, with no deploy involved.
 */

test.describe("@growth landing page click audit", () => {
  test.describe.configure({ timeout: 240_000 })

  test("full click audit: links, tool pages, desktop layout", async ({ page, request }) => {
    await page.setViewportSize({ width: 1366, height: 900 })
    await page.goto("/", { waitUntil: "domcontentloaded" })

    await expect(page.getByTestId("landing-nav-sign-in")).toBeVisible()
    await expect(page.getByTestId("landing-nav-cta")).toBeVisible()
    await expect(page.getByTestId("landing-hero-primary")).toBeVisible()
    // The headline ships server-rendered — a "Loading…" shell here would mean
    // crawlers and link previews see nothing.
    await expect(page.locator("h1").first()).toBeVisible()

    /*
     * The three nav jumps must land on a section that EXISTS. `#faq` is the one
     * that regressed before: the section carried `id="faq"` while nothing linked
     * to it, so the link and the target have to be asserted together — a nav
     * item pointing at a missing id scrolls nowhere and reports no error.
     */
    for (const anchor of ["how", "pricing", "faq"]) {
      await expect(
        page.getByTestId(`landing-nav-${anchor}`),
        `nav should offer a #${anchor} jump`,
      ).toBeVisible()
      await expect(
        page.locator(`#${anchor}`),
        `#${anchor} must exist for the nav link to land on`,
      ).toHaveCount(1)
    }

    /*
     * The homepage linked to none of the /sports/* or /tools/* pages the sitemap
     * publishes, which orphaned the entire SEO tree from the strongest page on
     * the site. Assert the discovery band is present and populated — a silently
     * empty map lookup would render zero links and still pass a "section exists"
     * check.
     */
    await expect(page.getByTestId("landing-discover")).toBeVisible()
    const discoverLinks = page.getByTestId("landing-discover-link")
    expect(
      await discoverLinks.count(),
      "landing should link into the /sports and /tools pages the sitemap publishes",
    ).toBeGreaterThanOrEqual(20)

    // Verify all internal links on the landing surface resolve.
    const hrefs = await page.locator("a[href]").evaluateAll((links) => {
      const origin = window.location.origin
      const unique = new Set<string>()

      for (const node of links) {
        const raw = node.getAttribute("href")
        if (!raw || raw.startsWith("mailto:") || raw.startsWith("tel:")) continue
        const url = new URL(raw, origin)
        if (url.origin !== origin) continue
        if (url.pathname.startsWith("/api")) continue
        unique.add(`${url.pathname}${url.search}`)
      }

      return Array.from(unique)
    })

    expect(hrefs.length, "landing page should link somewhere").toBeGreaterThan(0)

    for (const href of hrefs) {
      const res = await request.get(href)
      // A gated route answering 307 to /login is reachable; a 404 or 500 is not.
      expect(res.status(), `Expected landing link ${href} to be reachable`).toBeLessThan(400)
    }

    // Verify core tool pages load.
    const toolRoutes = [
      "/trade-analyzer",
      "/waiver-wire",
      "/draft-helper",
      "/player-comparison",
      "/matchup-simulator",
      "/fantasy-coach",
      "/war-room",
      "/brackets",
      "/bracket",
    ]
    for (const route of toolRoutes) {
      const res = await request.get(route)
      expect(res.status(), `Expected tool page ${route} to be reachable`).toBeLessThan(400)
    }

    const desktopHasOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth + 2
    })
    expect(desktopHasOverflow).toBeFalsy()
  })

  test("mobile layout click audit: responsive rendering and hero CTA", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto("/", { waitUntil: "domcontentloaded" })

    await expect(page.locator("h1").first()).toBeVisible()
    await expect(page.getByTestId("landing-hero-primary")).toBeVisible()

    // A landing page that scrolls sideways on a phone is the single most common
    // way this surface breaks, and the reason this check outlived the redesign.
    const mobileHasOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth + 2
    })
    expect(mobileHasOverflow).toBeFalsy()

    await page.getByTestId("landing-hero-primary").click()
    await expect(page).not.toHaveURL(/\/$/, { timeout: 20_000 })
  })
})
