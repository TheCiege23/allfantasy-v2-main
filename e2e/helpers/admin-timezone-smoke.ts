import { expect, type Page } from "@playwright/test"
import { registerAndLogin } from "./auth-flow"

/** The timezone these specs put on the signed-in user's profile. */
export const TARGET_TIMEZONE = "America/Los_Angeles"

/**
 * The timezone the admin console renders in, deliberately, for EVERY viewer.
 *
 * `app/admin/page.tsx` hardcodes `America/New_York` in its `formatDate` helper and again in
 * the header's "refreshed" stamp, and it does not use `hooks/useUserTimezone` — the hook 53
 * other components read the viewer's profile through. That is the product decision (an
 * operator console speaks one canonical timezone), confirmed by the user on 2026-09-17, and
 * it is what these specs pin: the admin page must keep rendering Eastern even when the
 * signed-in user's profile says otherwise.
 *
 * ⚠ These specs previously asserted the OPPOSITE — that admin surfaces follow the user's
 * timezone — against `/admin?tab=audit` and `/admin?tab=signups`. The page has no tabs at
 * all now (`?tab=` appears zero times in it), the three APIs they called were removed, and
 * the user-timezone rendering they checked was never reinstated after the 2026-06 rebuild.
 * They could not have passed; they hung at sign-in instead, and that hid all of it.
 */
export const ADMIN_RENDER_TIMEZONE = "America/New_York"

export async function bootstrapAdminTimezoneSession(page: Page) {
  await registerAndLogin(page)
  await setUserTimezone(page, TARGET_TIMEZONE)
  await loginAsAdmin(page)
}

export async function setUserTimezone(page: Page, timezone: string) {
  const patchResponse = await page.request.patch("/api/user/profile", {
    data: {
      timezone,
      preferredLanguage: "en",
    },
  })
  expect(patchResponse.ok()).toBeTruthy()

  const profileResponse = await page.request.get("/api/user/profile")
  expect(profileResponse.ok()).toBeTruthy()
  const profileBody = await profileResponse.json()
  expect(profileBody?.timezone).toBe(timezone)
}

export async function loginAsAdmin(page: Page) {
  const password = process.env.ADMIN_PASSWORD ?? "admin123"
  const response = await page.request.post("/api/auth/login", {
    data: {
      password,
      next: "/admin?tab=audit",
    },
  })
  const body = await response.json().catch(() => ({}))
  expect(response.ok(), `admin login failed: ${JSON.stringify(body)}`).toBeTruthy()
}

export async function formatExpected(
  page: Page,
  iso: string,
  timezone: string,
  options: Intl.DateTimeFormatOptions
) {
  return page.evaluate(
    ({ input, tz, fmtOptions }) =>
      new Intl.DateTimeFormat("en-US", { ...fmtOptions, timeZone: tz }).format(new Date(input)),
    { input: iso, tz: timezone, fmtOptions: options }
  )
}

/**
 * The hour labels a zone could legitimately be showing for "about now" — e.g. ["9 PM"] most
 * of the time, and ["9 PM", "10 PM"] when the run straddles the top of the hour.
 *
 * The HOUR is the discriminator these specs turn on: `ADMIN_RENDER_TIMEZONE` and
 * `TARGET_TIMEZONE` are three hours apart, so their candidate sets can never overlap, while
 * minutes and seconds tick underneath a test and would only make it flaky. Computed inside
 * the page so it uses the same Intl data the page itself formatted with.
 */
export async function hourLabelsAroundNow(page: Page, timezone: string): Promise<string[]> {
  return page.evaluate((tz) => {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      hour12: true,
    })
    const now = Date.now()
    const labels = [now - 90_000, now, now + 90_000].map((ms) => fmt.format(new Date(ms)))
    return Array.from(new Set(labels))
  }, timezone)
}

/** The `h AM`/`h PM` part of a rendered stamp like "Sep 17, 9:42 PM" or "9:42:07 PM". */
export function hourLabelOf(rendered: string): string | null {
  const match = rendered.match(/(\d{1,2}):\d{2}(?::\d{2})?\s?(AM|PM)/i)
  if (!match) return null
  return `${Number(match[1])} ${match[2].toUpperCase()}`
}
