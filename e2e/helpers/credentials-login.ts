import { expect, type Page } from "@playwright/test"

/**
 * Sign in through the real credentials flow — CSRF token, POST to the NextAuth
 * callback, then poll `/api/auth/session` until the server agrees a user exists.
 *
 * ⚠ THE POLL IS NOT PADDING. `next dev` compiles the auth routes on first hit, so
 * the POST can succeed while the session is not yet readable. Asserting the POST
 * status alone gives a green sign-in and a signed-out page.
 *
 * ⚠ `redraft-trade-walkthrough.spec.ts` still carries a private copy of this,
 * written before this file existed. It should move here — two implementations of
 * one rule is the bug. It is left alone for now only because it is a `@db` spec
 * that cannot be run locally against anything but production (see the guard in
 * `authed-phone.spec.ts`), so refactoring it blind would be worse than the
 * duplication.
 *
 * ⚠ NOT `e2e/helpers/session-cookie.ts`. That one writes a session row and forges
 * the cookie, which is the right tool when the POINT is not the login. Here the
 * login is part of the journey being certified, so it goes through the door.
 */
export async function loginAs(page: Page, login: string, password: string): Promise<void> {
  const csrf = await page.request.get("/api/auth/csrf")
  const csrfToken = ((await csrf.json()) as { csrfToken?: string }).csrfToken

  const res = await page.request.post("/api/auth/callback/credentials?json=true", {
    form: { csrfToken: csrfToken ?? "", login, password, json: "true" },
  })
  expect(res.status(), `credentials POST for ${login}`).toBeLessThan(400)

  await expect
    .poll(
      async () => {
        const s = await page.request.get("/api/auth/session")
        const j = (await s.json().catch(() => null)) as { user?: { id?: string } } | null
        return Boolean(j?.user?.id)
      },
      { timeout: 45_000, intervals: [500, 1000, 2000, 3000] },
    )
    .toBe(true)
}
