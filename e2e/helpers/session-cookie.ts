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

  const sessionToken = await encode({
    secret,
    token: {
      sub: user.id,
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
