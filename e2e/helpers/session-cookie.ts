import { encode } from 'next-auth/jwt'
import type { Page } from '@playwright/test'
import { resolveAuthSecret } from '@/lib/auth/resolve-auth-secret'

/**
 * Give a Playwright page a real signed-in session.
 *
 * Some specs drive pages that middleware gates on a session — `/app/league/*`
 * among them. Those specs used to navigate anonymously and pass, because the
 * surface was ungated; once it was gated they got a 307 to /login and failed on
 * "element(s) not found", which reads as the page being broken rather than as
 * the visitor being logged out.
 *
 * The token is signed with the SERVER'S secret, read through the same
 * resolveAuthSecret the middleware uses, so this is a genuine session rather
 * than a bypass — there is no test-only branch in the product for it to lean on.
 * An existing spec mints a token with a hardcoded 'playwright-secret', which
 * cannot decode against NEXTAUTH_SECRET and so grants nothing; do not copy it.
 *
 * Playwright's webServer forwards process.env to the server, so the spec process
 * and the app agree on the secret without any extra wiring.
 *
 * ⚠ AMENDED: the sentence above about there being no test-only branch is true of the
 * TOKEN and was never true of the user. The session needs an `AppUser` row to exist or
 * every user-owned write fails P2003, and that row is created through the e2e-gated
 * `PUT /api/e2e/run-relay`, which IS a test-only surface. It is header-gated and lives in
 * a directory the production build excludes, but calling it a bypass-free helper would be
 * wrong now — the token is genuine, the account is seeded.
 */
export async function signInAs(
  page: Page,
  user: { id: string; email?: string; name?: string; username?: string }
): Promise<void> {
  const secret = resolveAuthSecret()
  if (!secret) {
    throw new Error(
      'signInAs needs NEXTAUTH_SECRET (or AUTH_SECRET) set for the test process — ' +
        'without it the token cannot be signed with the key middleware verifies against.'
    )
  }

  /*
   * 🛑 THE ROW FIRST, THEN THE COOKIE. A signed cookie alone produces a session that is real
   * to middleware and to `getServerSession()` and absent from the database, so the first write
   * that foreign-keys to the user fails P2003 — and the symptom appears nowhere near here.
   *
   * Measured in CI run 33967522140: `<AgeConfirmationPrompt>` (rendered globally by
   * SafeGlobalChrome on every non-auth path) reads `/api/auth/confirm-age`, gets
   * `confirmed: false` because there is no UserProfile, and opens a modal. Its own dismiss
   * POST then dies on `user_profiles_userId_fkey` — 16 P2003s in that run — so the modal is
   * permanent, and Playwright retries a click 244 times against a button it reports as
   * "visible, enabled and stable" until the test times out at 180s. Three specs failed exactly
   * that way and read as hanging UI.
   *
   * ⚠ Ensured through the server rather than with prisma here ON PURPOSE: importing
   * `@prisma/client` into the spec process populates `process.env` from `.env`, and this
   * repo's `.env` points at PRODUCTION.
   */
  const ensured = await page.request.put(`${baseUrl()}/api/e2e/run-relay`, {
    headers: { 'x-allfantasy-e2e': '1', 'content-type': 'application/json' },
    data: {
      id: user.id,
      email: user.email ?? `${user.id}@allfantasy.test`,
      name: user.name ?? 'E2E User',
      username: user.username ?? user.id,
    },
  })
  if (!ensured.ok()) {
    /*
     * Loud on purpose. Swallowing this restores the exact bug it was written to fix: the spec
     * would carry on with a session backed by no row and fail 180 seconds later on a click,
     * which is the least legible failure this suite produces.
     */
    throw new Error(
      `signInAs could not create the AppUser row for '${user.id}': ` +
        `PUT /api/e2e/run-relay returned ${ensured.status()} — ${(await ensured.text()).slice(0, 300)}\n` +
        'A 404 means the server was started without e2e seeding enabled ' +
        '(NODE_ENV=production without ALLOW_E2E_SEED=1).'
    )
  }

  const sessionToken = await encode({
    secret,
    token: {
      sub: user.id,
      /*
       * ⚠ `id` AS WELL AS `sub`, AND OMITTING IT MADE THIS HELPER HALF-WORK.
       *
       * Middleware authenticates by reading `token.sub` (see the getToken call in
       * middleware.ts), so a token carrying only `sub` sails through every route gate
       * and looks like a working session. But the NextAuth session callback in
       * lib/auth.ts populates `session.user.id` from **`token.id`**, which is what the
       * real jwt callback sets on sign-in (`token.id = user.id`). Without it,
       * `getServerSession()` returns a session whose `user.id` is undefined.
       *
       * The result is a session that passes middleware and fails every server
       * component that checks for a user id — and those redirect to /login, so the
       * symptom is an unexplained redirect on a page the test just proved it could
       * reach. `app/tokens/layout.tsx` is exactly that: it redirects to
       * `/login?callbackUrl=/tokens` when `session.user.id` is missing, which sent the
       * subscription-entitlement token CTA test to a 15s waitForURL timeout while
       * `/api/auth/session` cheerfully reported the user as signed in.
       */
      id: user.id,
      email: user.email ?? `${user.id}@allfantasy.test`,
      name: user.name ?? 'E2E User',
      // Middleware runs a SECOND gate after the session check: a token without a
      // username is bounced to /choose-username. Omitting this swaps one redirect
      // for another and the page still never renders — the symptom is identical,
      // so the claim is required, not cosmetic.
      username: user.username ?? user.id,
    },
  })

  // The __Secure- prefix is only valid over HTTPS; e2e runs on http://127.0.0.1.
  await page.context().addCookies([
    {
      name: 'next-auth.session-token',
      value: sessionToken,
      url: baseUrl(),
      httpOnly: true,
      sameSite: 'Lax',
    },
  ])
}

function baseUrl(): string {
  return (
    process.env.PLAYWRIGHT_BASE_URL ??
    `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? process.env.PORT ?? 3101}`
  )
}
