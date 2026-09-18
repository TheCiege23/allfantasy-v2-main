import { expect, test } from "@playwright/test"
import {
  ADMIN_RENDER_TIMEZONE,
  TARGET_TIMEZONE,
  bootstrapAdminTimezoneSession,
  hourLabelOf,
  hourLabelsAroundNow,
} from "./helpers/admin-timezone-smoke"

/**
 * The admin console renders ONE canonical timezone — Eastern — for every viewer, and this
 * proves it stays that way.
 *
 * The signed-in user's profile is set to `America/Los_Angeles` first, so a page that started
 * following the viewer (by picking up `hooks/useUserTimezone`, as 53 other components do)
 * would fail here rather than change behaviour unnoticed. Three hours separate the two zones,
 * so the rendered HOUR is the discriminator.
 *
 * ⚠ WHAT THIS REPLACED. Until 2026-09-17 this spec asserted the opposite — that admin pages
 * follow the user's timezone — by driving `/admin?tab=audit` and `/admin?tab=signups` and
 * calling `/api/admin/audit` and `/api/admin/signups/stats`. The page has had no tabs since
 * its rebuild, both endpoints were removed, and the user-timezone rendering was never
 * reinstated. It reported none of that: `registerAndLogin()` landed on the retired
 * `/dashboard` and the helper's unbounded `waitForURL` hung until the 240s budget expired,
 * so the only symptom for months was a timeout. See PR #1024 for that repair.
 */
test("the admin console stamps its refresh time in Eastern, not the viewer's timezone", async ({
  page,
}) => {
  test.setTimeout(240_000)
  await bootstrapAdminTimezoneSession(page)

  // A cold `next dev` compile of this page can outrun the default navigation budget; that is
  // a build cost, not a product latency.
  await page.goto("/admin", { waitUntil: "domcontentloaded", timeout: 120_000 })

  /*
   * The header's "refreshed <time>" stamp is rendered server-side from `data.generatedAt` on
   * every load (app/admin/page.tsx), which makes it the one date on this page that is always
   * present — no search, no seeded rows, nothing to arrange.
   */
  const stamp = page.locator(".af-cc-stamp")
  await expect(stamp).toBeVisible({ timeout: 60_000 })
  const stampText = (await stamp.innerText()).trim()

  const renderedHour = hourLabelOf(stampText)
  expect(renderedHour, `no time found in the refresh stamp: ${JSON.stringify(stampText)}`).not.toBeNull()

  const easternHours = await hourLabelsAroundNow(page, ADMIN_RENDER_TIMEZONE)
  const viewerHours = await hourLabelsAroundNow(page, TARGET_TIMEZONE)

  expect(
    easternHours,
    `admin stamped ${renderedHour} (${stampText}); expected Eastern, one of ${easternHours.join(" / ")}`,
  ).toContain(renderedHour)

  /*
   * The half that would catch a silent switch to the viewer's timezone. Without it, a page
   * that rendered Los Angeles would still satisfy the assertion above on any run where the
   * two happened to agree — they never do at three hours apart, but asserting it explicitly
   * is what makes this test about the CONTRACT rather than about today's clock.
   */
  expect(
    viewerHours,
    `admin stamped ${renderedHour}, the viewer's own Los Angeles hour — the console is meant to speak Eastern to everyone`,
  ).not.toContain(renderedHour)
})
