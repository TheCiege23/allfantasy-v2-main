import { expect, test } from "@playwright/test"

/**
 * Landing click audit, retargeted (again) at the landing `/` actually renders.
 *
 * `/` renders LandingV4 now (see app/page.tsx). This spec has already been
 * re-pointed once — from the scrollytelling landing to LandingNocturne — and
 * both times the failure read as a broken homepage rather than a replaced one:
 * every `nocturne-*` testid resolved to nothing. The ids it drives are now
 * `landing-nav-sign-in`, `landing-nav-primary` and `landing-hero-primary` on
 * LandingV4 itself, so the next redesign has a contract to carry forward
 * instead of a spec to discover.
 *
 * Kept: the parts that describe any landing page — that it renders, that its
 * internal links resolve, that the tool pages it advertises are reachable, and
 * that neither breakpoint scrolls sideways. Those were the assertions actually
 * earning their keep.
 *
 * Dropped: the theme-toggle and language-toggle sequences, and the mobile
 * sticky-CTA block. LandingV4 ships no theme control and no sticky mobile CTA;
 * its language switch is a pair of plain `/?lang=` links, which the link
 * sweep below already covers. Asserting more than that would be asserting a
 * different page than the one users get.
 */

test.describe("@growth landing page click audit", () => {
  test.describe.configure({ timeout: 240_000 })

  test("full click audit: links, tool pages, desktop layout", async ({ page, request }) => {
    await page.setViewportSize({ width: 1366, height: 900 })
    await page.goto("/", { waitUntil: "domcontentloaded" })

    await expect(page.getByTestId("landing-nav-sign-in")).toBeVisible()
    await expect(page.getByTestId("landing-nav-primary")).toBeVisible()
    await expect(page.getByTestId("landing-hero-primary")).toBeVisible()
    // The headline ships server-rendered — a "Loading…" shell here would mean
    // crawlers and link previews see nothing.
    await expect(page.locator("h1").first()).toBeVisible()

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
