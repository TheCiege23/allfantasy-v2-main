import { expect, test } from "@playwright/test"

/**
 * Landing click audit, retargeted at the Nocturne landing.
 *
 * `/` renders LandingNocturne now; the scrollytelling landing this spec was
 * written against is still on disk for rollback but is no longer mounted. Every
 * `landing-*` testid it asserted therefore resolved to nothing, and the whole
 * spec failed as "element(s) not found" — which reads as a broken homepage
 * rather than as a homepage that was replaced.
 *
 * Kept: the parts that describe any landing page — that it renders, that its
 * internal links resolve, that the tool pages it advertises are reachable, and
 * that neither breakpoint scrolls sideways. Those were the assertions actually
 * earning their keep.
 *
 * Dropped: the theme-toggle and language-toggle sequences, and the mobile
 * sticky-CTA block. Nocturne ships no theme or language control in its header
 * (`data-mode`/`data-lang` still live on <html>, but nothing on this page flips
 * them) and has no sticky mobile CTA. Asserting them here would be asserting a
 * different page than the one users get.
 */

test.describe("@growth landing page click audit", () => {
  test.describe.configure({ timeout: 240_000 })

  test("full click audit: links, tool pages, desktop layout", async ({ page, request }) => {
    await page.setViewportSize({ width: 1366, height: 900 })
    await page.goto("/", { waitUntil: "domcontentloaded" })

    await expect(page.getByTestId("nocturne-nav-sign-in")).toBeVisible()
    await expect(page.getByTestId("nocturne-nav-sign-up")).toBeVisible()
    await expect(page.getByTestId("nocturne-hero-primary")).toBeVisible()
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
    await expect(page.getByTestId("nocturne-hero-primary")).toBeVisible()

    // A landing page that scrolls sideways on a phone is the single most common
    // way this surface breaks, and the reason this check outlived the redesign.
    const mobileHasOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth + 2
    })
    expect(mobileHasOverflow).toBeFalsy()

    await page.getByTestId("nocturne-hero-primary").click()
    await expect(page).not.toHaveURL(/\/$/, { timeout: 20_000 })
  })
})
