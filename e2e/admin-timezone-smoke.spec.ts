import { expect, test } from "@playwright/test"
import {
  TARGET_TIMEZONE,
  bootstrapAdminTimezoneSession,
  formatExpected,
} from "./helpers/admin-timezone-smoke"

/*
 * ⚠ SKIPPED BECAUSE EVERY SURFACE IT DRIVES IS GONE — AND THE 240s TIMEOUT IT USED TO
 * REPORT WAS HIDING THAT. Until 2026-09-17 this failed with nothing but "Test timeout of
 * 240000ms exceeded", because `registerAndLogin()` landed on `/dashboard` (retired
 * 2026-08-24, 307'd to `/core`) and the helper's `waitForURL` had no timeout, so it hung on
 * a path that can never match. That landing bug is FIXED in `helpers/auth-flow.ts`, and the
 * fix moved this spec past sign-in for the first time in weeks — straight onto a second
 * layer of rot underneath:
 *
 *   GET /api/admin/audit          → route does not exist
 *   GET /api/admin/signups/stats  → route does not exist
 *   heading "Audit log"           → not on app/admin/page.tsx
 *   heading "Recent Signups"      → not on app/admin/page.tsx
 *
 * The admin page was rebuilt and these hooks did not come with it. Rewriting the spec
 * against the current page is real work with its own product questions (which tabs are the
 * "core admin pages" now?), so it is recorded here rather than guessed at.
 *
 * ⚠ WHAT COVERAGE THIS COSTS: nothing now checks that admin surfaces render dates in the
 * signed-in user's timezone. That was a real bug class — it is why this spec exists.
 */
test.skip("core admin pages render dates in user timezone", async ({ page }) => {
  test.setTimeout(240_000)
  await bootstrapAdminTimezoneSession(page)

  await page.goto("/admin?tab=audit")
  await expect(page.getByRole("heading", { name: "Audit log" }).first()).toBeVisible()

  const auditResponse = await page.request.get("/api/admin/audit?limit=100")
  expect(auditResponse.ok()).toBeTruthy()

  const auditJson = await auditResponse.json()
  const firstAudit = Array.isArray(auditJson?.data) ? auditJson.data[0] : null

  if (firstAudit?.createdAt) {
    const expectedAuditTime = await formatExpected(page, firstAudit.createdAt, TARGET_TIMEZONE, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
    await expect(page.getByText(expectedAuditTime).first()).toBeVisible()
  } else {
    await expect(page.getByText(/No audit entries yet/i)).toBeVisible()
  }

  await page.goto("/admin?tab=signups")
  await expect(page.getByRole("heading", { name: "Recent Signups" }).first()).toBeVisible()

  const signupsStatsResponse = await page.request.get("/api/admin/signups/stats")
  expect(signupsStatsResponse.ok()).toBeTruthy()
  const signupsStatsJson = await signupsStatsResponse.json()
  const firstSignup = Array.isArray(signupsStatsJson?.recentSignups)
    ? signupsStatsJson.recentSignups[0]
    : null

  if (firstSignup?.createdAt) {
    const expectedSignupDateTime = await formatExpected(
      page,
      firstSignup.createdAt,
      TARGET_TIMEZONE,
      {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }
    )
    await expect(page.getByText(expectedSignupDateTime).first()).toBeVisible()
  } else {
    await expect(page.getByText(/No signups in the last 48 hours/i)).toBeVisible()
  }
})
