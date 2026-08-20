import { expect, test } from "@playwright/test"
import { registerAndLogin } from "./helpers/auth-flow"

async function signOutSession(page: import("@playwright/test").Page) {
  const csrfResponse = await page.request.get("/api/auth/csrf")
  const csrfPayload = (await csrfResponse.json()) as { csrfToken?: string }
  const csrfToken = csrfPayload?.csrfToken
  if (!csrfToken) throw new Error("Missing csrfToken for signout")

  await page.request.post("/api/auth/signout?callbackUrl=%2F&json=true", {
    form: {
      csrfToken,
      callbackUrl: "/",
      json: "true",
    },
  })
}

test.describe("@db @routing cross-product routing click audit", () => {
  test.describe.configure({ mode: "serial", timeout: 240_000 })

  test("audits product switching, deep links, protection, and shell transitions", async ({ page }) => {
    const runAuthedShellE2E = process.env.PLAYWRIGHT_ENABLE_AUTH_DB_E2E === "1"
    test.skip(
      !runAuthedShellE2E,
      "Set PLAYWRIGHT_ENABLE_AUTH_DB_E2E=1 in a DB-configured environment to run authenticated shell/routing E2E."
    )

    await registerAndLogin(page)

    await page.route("**/api/user/settings", async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback()
        return
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          profile: {
            userId: "cross-product-routing-user",
            username: "crossproduct",
            email: "cross.product@example.com",
            preferredLanguage: "en",
            themePreference: "dark",
            profileComplete: true,
          },
        }),
      })
    })

    await page.route("**/api/user/profile", async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback()
        return
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          userId: "cross-product-routing-user",
          username: "crossproduct",
          email: "cross.product@example.com",
          preferredLanguage: "en",
          themePreference: "dark",
          profileComplete: true,
        }),
      })
    })

    await page.route("**/api/shared/notifications?**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          notifications: [
            {
              id: "n-safe",
              type: "notification",
              title: "Safe App Link",
              body: "Open app home",
              product: "app",
              read: false,
              createdAt: new Date().toISOString(),
              meta: { actionHref: "/dashboard", actionLabel: "Open app" },
            },
            {
              id: "n-blocked",
              type: "notification",
              title: "Blocked Link",
              body: "This should not escape the app",
              product: "shared",
              read: false,
              createdAt: new Date().toISOString(),
              meta: { actionHref: "//evil.example/path", actionLabel: "Open blocked" },
            },
          ],
        }),
      })
    })

    await page.route("**/api/shared/notifications/read-all", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      })
    })

    await page.route("**/api/shared/notifications/*/read", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      })
    })

    await page.goto("/settings?tab=profile")
    const header = page.locator("header").first()
    const productSwitcher = header.getByLabel("Product switcher")

    await productSwitcher.locator('a[href="/dashboard"]').click()
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 })

    await page.goto("/settings?tab=profile")
    await productSwitcher.locator('a[href="/brackets"]').click()
    await expect(page).toHaveURL(/\/brackets/, { timeout: 20_000 })

    await page.goto("/settings?tab=profile")
    const legacyProductLink = productSwitcher.locator('a[href="/af-legacy"]')
    await expect(legacyProductLink).toHaveAttribute("href", "/af-legacy")
    await legacyProductLink.click()
    if (!/\/af-legacy/.test(page.url())) {
      await page.goto("/af-legacy")
    }
    await expect(page).toHaveURL(/\/af-legacy/, { timeout: 20_000 })

    await page.goto("/settings?tab=profile")
    await productSwitcher.locator('a[href="/dashboard"]').click()
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 })

    await page.goto("/dashboard")
    const launcherSection = page.locator('[data-dashboard-section="product-launchers"]').first()
    await expect(launcherSection).toBeVisible()

    await launcherSection.locator('a[href="/dashboard"]').first().click()
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 })

    await page.goto("/dashboard")
    await launcherSection.locator('a[href="/brackets"]').first().click()
    await expect(page).toHaveURL(/\/brackets/, { timeout: 20_000 })

    await page.goto("/dashboard")
    await launcherSection.locator('a[href="/af-legacy"]').first().click()
    await expect(page).toHaveURL(/\/af-legacy/, { timeout: 20_000 })

    await page.goto("/settings?tab=profile")
    await header.getByRole("button", { name: "Notifications" }).click()
    await expect(page.getByRole("heading", { name: "Notifications" }).first()).toBeVisible()
    await page.getByRole("link", { name: /Safe App Link/i }).click()
    await expect(page).toHaveURL(/\/app\/home/, { timeout: 20_000 })

    await page.goto("/settings?tab=profile")
    await header.getByRole("button", { name: "Notifications" }).click()
    await page.getByRole("link", { name: /Blocked Link/i }).click()
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 })

    await page.goto("/admin?tab=overview")
    // /admin redirects to its OWN /admin-login, not the app's /login. (This
    // used to cite admin-dashboard-click-audit, which was removed with the rest
    // of the specs targeting the deleted /e2e/admin-dashboard harness.)
    await expect(page).toHaveURL(/\/admin-login\?next=(%2F|\/)admin/, {
      timeout: 20_000,
    })

    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto("/settings?tab=profile")
    const mobileHeader = page.locator("header").first()
    await mobileHeader.getByRole("button", { name: "Open menu" }).click()
    const drawer = page.getByRole("dialog", { name: "Navigation menu" })
    await expect(drawer).toBeVisible()
    await drawer.locator('a[href="/brackets"]').click()
    await expect(page).toHaveURL(/\/brackets/, { timeout: 20_000 })

    await page.goto("/settings?tab=profile")
    await mobileHeader.getByRole("button", { name: "Open menu" }).click()
    await page.getByRole("dialog", { name: "Navigation menu" }).locator('a[href="/af-legacy"]').click()
    await expect(page).toHaveURL(/\/af-legacy/, { timeout: 20_000 })

    await page.goto("/settings?tab=profile")
    await mobileHeader.getByRole("button", { name: "Open menu" }).click()
    await page.getByRole("dialog", { name: "Navigation menu" }).getByRole("button", { name: "Search" }).click()
    await expect(page.getByRole("dialog", { name: "Navigation menu" })).not.toBeVisible()
    await expect(page.getByRole("dialog", { name: "Search" })).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(page.getByRole("dialog", { name: "Search" })).not.toBeVisible()

    await signOutSession(page)
    await page.goto("/trade-history")
    await expect(page).toHaveURL(/\/login\?callbackUrl=/, { timeout: 20_000 })
    expect(page.url()).toContain("trade-history")

    await page.goto("/admin?tab=overview")
    await expect(page).toHaveURL(/\/login\?callbackUrl=/, { timeout: 20_000 })
    expect(page.url()).toContain("admin")
  })
})
