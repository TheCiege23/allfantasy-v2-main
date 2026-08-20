import { expect, test } from "@playwright/test"
import { clickHydrated } from "./helpers/hydration"

test.describe("@growth seo + aso click audit", () => {
  test.describe.configure({ timeout: 240_000 })

  test("SEO landing links and share controls resolve correctly", async ({ page }) => {
    await page.goto("/tools/trade-analyzer", { waitUntil: "domcontentloaded" })

    await expect(page.getByTestId("tool-landing-back-to-hub")).toBeVisible()
    await expect(page.getByTestId("tool-landing-all-tools-link")).toBeVisible()
    await expect(page.getByTestId("tool-landing-install-link")).toBeVisible()

    const xShareHref = await page.getByTestId("tool-landing-share-trade-analyzer-x").getAttribute("href")
    const fbShareHref = await page.getByTestId("tool-landing-share-trade-analyzer-facebook").getAttribute("href")
    const liShareHref = await page.getByTestId("tool-landing-share-trade-analyzer-linkedin").getAttribute("href")

    expect(xShareHref ?? "").toContain("twitter.com/intent/tweet")
    expect(fbShareHref ?? "").toContain("facebook.com/sharer/sharer.php")
    expect(liShareHref ?? "").toContain("linkedin.com/sharing/share-offsite/")
    expect(xShareHref ?? "").toContain(encodeURIComponent("https://allfantasy.ai/tools/trade-analyzer"))

    await clickHydrated(page.getByTestId("tool-landing-install-link"))
    await expect(page).toHaveURL(/\/install$/, { timeout: 20_000 })
    await expect(page.getByTestId("install-open-tools-hub")).toBeVisible()

    await clickHydrated(page.getByTestId("install-open-tools-hub"))
    await expect(page).toHaveURL(/\/tools-hub$/, { timeout: 20_000 })

    await page.goto("/tools/trade-analyzer", { waitUntil: "domcontentloaded" })
    await clickHydrated(page.getByTestId("tool-landing-sport-link-fantasy-football"))
    await expect(page).toHaveURL(/\/sports\/fantasy-football$/, { timeout: 20_000 })

    await expect(page.getByTestId("sport-landing-install-link")).toBeVisible()
    await clickHydrated(page.getByTestId("sport-landing-feature-link-trade-analyzer"))
    await expect(page).toHaveURL(/\/trade-analyzer$/, { timeout: 20_000 })

    await page.goto("/sports/fantasy-football", { waitUntil: "domcontentloaded" })
    await clickHydrated(page.getByTestId("sport-landing-bracket-link"))
    // The link is href="/brackets" (plural) in SportLandingClient.tsx; the
    // anchored /bracket$ pattern could never match it.
    await expect(page).toHaveURL(/\/brackets$/, { timeout: 20_000 })
  })

  test("metadata and structured data load for indexable SEO/ASO pages", async ({ request }) => {
    const toolResponse = await request.get("/tools/trade-analyzer")
    expect(toolResponse.ok()).toBeTruthy()
    const toolHtml = await toolResponse.text()
    expect(toolHtml).toContain("Fantasy Trade Analyzer")
    expect(toolHtml).toContain("property=\"og:title\"")
    expect(toolHtml).toContain("name=\"twitter:card\"")
    expect(toolHtml).toMatch(/<link[^>]+rel="canonical"[^>]+tools\/trade-analyzer/i)
    expect(toolHtml).toContain("application/ld+json")
    expect(toolHtml).toContain("SoftwareApplication")

    const sportResponse = await request.get("/sports/fantasy-football")
    expect(sportResponse.ok()).toBeTruthy()
    const sportHtml = await sportResponse.text()
    expect(sportHtml).toContain("Fantasy Football Tools")
    expect(sportHtml).toContain("property=\"og:title\"")
    expect(sportHtml).toContain("name=\"twitter:card\"")
    expect(sportHtml).toMatch(/<link[^>]+rel="canonical"[^>]+sports\/fantasy-football/i)

    const installResponse = await request.get("/install")
    expect(installResponse.ok()).toBeTruthy()
    const installHtml = await installResponse.text()
    expect(installHtml).toContain("Install AllFantasy App")
    expect(installHtml).toContain("manifest.webmanifest")
    expect(installHtml).toContain("application/ld+json")
  })

  test("core SEO routes are reachable", async ({ request }) => {
    const routes = [
      "/tools-hub",
      "/tools/trade-analyzer",
      "/tools/mock-draft-simulator",
      "/tools/waiver-wire-advisor",
      "/tools/bracket-challenge",
      "/sports/fantasy-football",
      "/sports/fantasy-basketball",
      "/leagues",
      "/trade-analyzer",
      "/trade-evaluator",
      "/waiver-wire",
      "/bracket",
      "/chimmy",
      "/install",
    ]

    for (const route of routes) {
      const response = await request.get(route)
      expect(response.status(), `Expected ${route} to be reachable`).toBeLessThan(400)
    }
  })
})
