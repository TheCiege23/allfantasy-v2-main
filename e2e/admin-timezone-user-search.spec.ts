import { expect, test } from "@playwright/test"
import {
  ADMIN_RENDER_TIMEZONE,
  TARGET_TIMEZONE,
  bootstrapAdminTimezoneSession,
  hourLabelOf,
  hourLabelsAroundNow,
} from "./helpers/admin-timezone-smoke"

/**
 * The same contract as `admin-timezone-smoke.spec.ts`, through the page's OTHER date path.
 *
 * The header stamp that spec checks is formatted inline; every other date on the console goes
 * through `formatDate` in `app/admin/page.tsx`, which hardcodes Eastern separately. Two
 * formatters, two chances to drift apart, so both are pinned — and the user-search row is the
 * one `formatDate` surface a test can make appear on demand, by searching for the account it
 * has just registered.
 *
 * ⚠ THIS FILE WAS `admin-timezone-heavy-tabs.spec.ts` AND ITS SUBJECT NO LONGER EXISTS. It
 * drove "heavy admin tabs" and waited on `GET /api/admin/model-drift`. The console has no tabs
 * at all now, and that endpoint is not in `app/api/admin/`. Renamed to what it actually covers
 * rather than left carrying a name that lies about the page.
 */
test("the admin user search stamps created dates in Eastern, not the viewer's timezone", async ({
  page,
}) => {
  test.setTimeout(240_000)
  await bootstrapAdminTimezoneSession(page)

  /*
   * The account `bootstrapAdminTimezoneSession` just registered is the row to look for — its
   * `createdAt` is seconds old, so the rendered hour is "about now" in whichever zone the page
   * chose. Read the username off the session rather than threading it out of the auth helper,
   * which fourteen other specs share.
   */
  const sessionResponse = await page.request.get("/api/auth/session")
  expect(sessionResponse.ok(), `session read failed (${sessionResponse.status()})`).toBeTruthy()
  const session = (await sessionResponse.json()) as { user?: { username?: string | null } }
  const username = session.user?.username
  expect(username, `no username on the session: ${JSON.stringify(session)}`).toBeTruthy()

  // `q` is the console's only search parameter, and the table stays empty below two characters
  // (the page says so where the rows would be).
  await page.goto(`/admin?q=${encodeURIComponent(String(username))}`, {
    waitUntil: "domcontentloaded",
    timeout: 120_000,
  })

  const row = page.locator("tr", { hasText: `@${username}` }).first()
  await expect(row).toBeVisible({ timeout: 60_000 })

  const rowText = (await row.innerText()).trim()
  const renderedHour = hourLabelOf(rowText)
  expect(
    renderedHour,
    `no created-at time in the user row: ${JSON.stringify(rowText)}`,
  ).not.toBeNull()

  const easternHours = await hourLabelsAroundNow(page, ADMIN_RENDER_TIMEZONE)
  const viewerHours = await hourLabelsAroundNow(page, TARGET_TIMEZONE)

  expect(
    easternHours,
    `the row rendered ${renderedHour}; expected Eastern, one of ${easternHours.join(" / ")}`,
  ).toContain(renderedHour)
  expect(
    viewerHours,
    `the row rendered ${renderedHour}, the viewer's own Los Angeles hour — formatDate is meant to speak Eastern to everyone`,
  ).not.toContain(renderedHour)
})
