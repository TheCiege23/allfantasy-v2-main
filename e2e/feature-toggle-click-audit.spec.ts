import { expect, test } from "@playwright/test"

/**
 * Feature-config behaviour that survives.
 *
 * Two tests were removed from this file because the surface they audit no longer
 * exists in the tree:
 *
 *   "feature toggle panel updates backend config payloads" drove the admin
 *   feature-toggle panel through the /e2e/feature-toggles harness. That harness
 *   was one of five removed in #411 for importing production components that had
 *   already been deleted — the panel itself is gone, and its `admin-feature-*`
 *   testids appear nowhere in app/ or components/. It cannot be repointed.
 *
 *   "admin config API is permission-gated" asserted /api/admin/config answers 401
 *   to an anonymous caller. That route was deleted by 25db02263 and now answers
 *   404; nothing in the codebase calls it. A 404 exposes nothing, so there is no
 *   hole here — but asserting 401 against an absent endpoint tests nothing either,
 *   and rewriting it to expect 404 would just pin the absence.
 *
 * ⚠ The deletion of the admin feature-toggle panel was not verified as intentional.
 * If it is meant to come back, the panel and /api/admin/config both need
 * rebuilding, and this file should regain a real permission-gate test at that
 * point — an admin config endpoint that answers anonymous callers is exactly the
 * kind of thing worth a test.
 *
 * What remains is genuine and passes: the feature config actually reaching a
 * customer-facing surface and changing what it renders.
 */

test.describe.configure({ timeout: 180_000 })

test.describe("@admin feature toggle click audit", () => {
  test("legacy mode behavior updates immediately from config", async ({ page }) => {
    await page.route("**/api/config/features", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          features: { feature_legacy_mode: false },
          sports: ["NFL", "NHL", "NBA", "MLB", "NCAAF", "NCAAB", "SOCCER"],
        }),
      })
    })

    await page.goto("/af-legacy", { waitUntil: "domcontentloaded" })
    await expect(page.getByText("Legacy mode is temporarily disabled")).toBeVisible({ timeout: 20_000 })
  })
})
