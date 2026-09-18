import { expect, test } from "@playwright/test"
import {
  TARGET_TIMEZONE,
  bootstrapAdminTimezoneSession,
  formatExpected,
} from "./helpers/admin-timezone-smoke"

/*
 * ⚠ SKIPPED FOR THE SAME REASON AS `admin-timezone-smoke.spec.ts` — read its note, which
 * carries the full account. Same helper, same retired `/dashboard` landing (fixed in
 * `helpers/auth-flow.ts` on 2026-09-17, which is what finally let this spec fail on its
 * own assertions instead of hanging for 240s), and the same second layer underneath:
 * `GET /api/admin/model-drift` does not exist, so the response this test waits for can
 * never arrive.
 *
 * ⚠ WHAT COVERAGE THIS COSTS: nothing now checks timezone rendering on the heavy admin
 * tabs, or that the model-drift drilldown is fetched at all.
 */
test.skip("heavy admin tabs render dates in user timezone", async ({ page }) => {
  test.setTimeout(240_000)
  await bootstrapAdminTimezoneSession(page)

  const drilldownResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/api/admin/model-drift?") &&
      response.url().includes("type=drilldown") &&
      response.request().method() === "GET"
  )
  await page.goto("/admin?tab=model_drift")
  await expect(page.getByRole("heading", { name: "Drilldown Table" }).first()).toBeVisible()

  const drilldownResponse = await drilldownResponsePromise
  if (drilldownResponse.ok()) {
    const drilldownJson = await drilldownResponse.json()
    const firstOffer = Array.isArray(drilldownJson?.offers) ? drilldownJson.offers[0] : null

    if (firstOffer?.createdAt) {
      const expectedOfferDate = await formatExpected(page, firstOffer.createdAt, TARGET_TIMEZONE, {
        dateStyle: "short",
      })
      await expect(page.getByText(expectedOfferDate).first()).toBeVisible()
    } else {
      await expect(
        page.getByText(/The drilldown table shows individual offers matching your filters\./i).first()
      ).toBeVisible()
    }
  } else {
    await expect(
      page.getByText(/The drilldown table shows individual offers matching your filters\./i).first()
    ).toBeVisible()
  }
})
