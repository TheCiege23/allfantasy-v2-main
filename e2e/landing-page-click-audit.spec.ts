import { expect, test } from "@playwright/test"

test.describe("@growth landing page click audit", () => {
  test.describe.configure({ timeout: 240_000 })

  test("full click audit: CTAs and desktop layout", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 })
    await page.goto("/", { waitUntil: "domcontentloaded" })

    await expect(page.getByTestId("landing-logo-link")).toBeVisible()
    await expect(page.getByTestId("landing-hero-headline")).toBeVisible()
    await expect(page.getByTestId("landing-open-app-button")).toBeVisible()
    await expect(page.getByTestId("landing-sign-up-button")).toBeVisible()

    await expect(page.getByTestId("landing-open-app-button")).toHaveAttribute("href", "/dashboard")
    await expect(page.getByTestId("landing-sign-up-button")).toHaveAttribute("href", /\/signup/)

    // Desktop layout sanity
    await expect(page.getByTestId("landing-mobile-sticky-cta")).not.toBeVisible()
    const desktopHasOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth + 2
    })
    expect(desktopHasOverflow).toBeFalsy()
  })

  test("mobile layout click audit: sticky CTA + responsive rendering", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto("/", { waitUntil: "domcontentloaded" })

    await expect(page.getByTestId("landing-hero-headline")).toBeVisible()
    await expect(page.getByTestId("landing-hero-cta-group")).toBeVisible()
    await expect(page.getByTestId("landing-mobile-sticky-cta")).toBeVisible()
    await expect(page.getByTestId("landing-mobile-open-app-button")).toBeVisible()
    await expect(page.getByTestId("landing-mobile-create-account-button")).toBeVisible()

    const mobileHasOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth + 2
    })
    expect(mobileHasOverflow).toBeFalsy()

    await expect(page.getByTestId("landing-mobile-open-app-button")).toHaveAttribute("href", "/dashboard")
  })
})
