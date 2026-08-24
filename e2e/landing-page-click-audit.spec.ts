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

  /*
   * ⚠ THIS TEST EXISTS BECAUSE THE BUG IT GUARDS WAS INVISIBLE FOR MONTHS.
   *
   * The Spanish landing rendered Spanish copy under a Spanish <title> and
   * declared the ENGLISH url as its canonical, because Next 14.2 strips the
   * search string out of `alternates` — so `canonicalPath: '/?lang=es'` became
   * `https://www.allfantasy.ai`. Nothing failed. The page looked perfect in a
   * browser; only the <head> was wrong, and no test read the <head>.
   *
   * Every assertion below therefore reads rendered markup rather than trusting
   * the metadata inputs, and the canonical/hreflang pair is checked on BOTH
   * documents — a one-sided hreflang is not a valid pair.
   */
  test("language routing: /es canonical, reciprocal hreflang, legacy redirect", async ({
    page,
    request,
  }) => {
    const canonicalOf = () =>
      page.locator('link[rel="canonical"]').first().getAttribute("href")
    const altOf = (lang: string) =>
      page.locator(`link[rel="alternate"][hreflang="${lang}"]`).first().getAttribute("href")

    await page.goto("/", { waitUntil: "domcontentloaded" })
    const enCanonical = await canonicalOf()
    const enAltEn = await altOf("en")
    const enAltEs = await altOf("es")

    await page.goto("/es", { waitUntil: "domcontentloaded" })
    const esCanonical = await canonicalOf()
    const esAltEn = await altOf("en")
    const esAltEs = await altOf("es")

    // The whole defect in one assertion: the two documents must not claim the
    // same canonical.
    expect(
      esCanonical,
      "/es must not declare the English page as its canonical",
    ).not.toBe(enCanonical)
    expect(esCanonical, "/es canonical should be the /es url").toMatch(/\/es$/)

    // hreflang must agree across both documents, and each must point at the
    // other language rather than at itself.
    expect(enAltEs, "en page's es alternate should point at /es").toMatch(/\/es$/)
    expect(esAltEs, "hreflang=es must match on both documents").toBe(enAltEs)
    expect(esAltEn, "hreflang=en must match on both documents").toBe(enAltEn)
    expect(esAltEn, "en alternate should not be the /es url").not.toMatch(/\/es$/)

    // Each document self-references: its own canonical is its own alternate.
    expect(enCanonical, "en canonical should equal its own hreflang=en").toBe(enAltEn)
    expect(esCanonical, "es canonical should equal its own hreflang=es").toBe(esAltEs)

    // The Spanish document must actually be Spanish — a correct canonical on an
    // English body would be the same bug wearing a different hat.
    await expect(page.locator("html body")).toContainText(/ligas/i)

    /*
     * The legacy address consolidates rather than serving a duplicate, and it
     * carries its query across: `invite` drives LandingInviteCapture and the
     * utm_* set carries acquisition attribution, so dropping them would lose a
     * league invite and re-file paid traffic as direct.
     */
    const legacy = await request.get("/?lang=es&invite=E2E&utm_source=spec", {
      maxRedirects: 0,
    })
    expect(legacy.status(), "legacy ?lang=es should permanently redirect").toBe(308)
    const location = legacy.headers()["location"] ?? ""
    expect(location, "should consolidate onto /es").toContain("/es")
    expect(location, "invite must survive the redirect").toContain("invite=E2E")
    expect(location, "utm must survive the redirect").toContain("utm_source=spec")
    expect(location, "lang itself is now carried by the path").not.toContain("lang=")

    // English is this route, so it renders rather than redirecting.
    const english = await request.get("/?lang=en", { maxRedirects: 0 })
    expect(english.status(), "?lang=en should render, not redirect").toBe(200)
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
