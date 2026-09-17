import { expect, test } from "@playwright/test"

test.describe("@dashboard unified dashboard click audit", () => {
  test.describe.configure({ timeout: 210_000, mode: "serial" })

  /*
   * ⚠ /commissioner-hub IS A REDIRECT NOW (five-doors restyle, 2026-09-17).
   *
   * This spec used to audit the Decision OS cards on that page — the League Pulse card's
   * framing, and League Focus staying closed until a league was picked. The user moved
   * those analytics to Commissioner OS and made both Commissioner Hub views live in /core,
   * so the page that carried them forwards to /core/commissioner and renders nothing of its
   * own. What is left to audit on this address is that the click still lands on the hub —
   * through sign-in for a visitor, since /core is signed-in only.
   */
  test("/commissioner-hub forwards to the Commissioner Hub in /core", async ({ page }) => {
    await page.goto("/commissioner-hub")
    await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fcore%2Fcommissioner(?:&|$)/, { timeout: 60_000 })
  })
})
