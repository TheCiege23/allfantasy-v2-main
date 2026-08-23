import { expect, test, type Page } from '@playwright/test'
import { clickHydrated, waitForHydrated } from './helpers/hydration'

/**
 * Open-redirect guard for the auth surfaces.
 *
 * ⚠ THIS IS A SECURITY REGRESSION TEST, NOT A UX ONE. `/login` and `/signup`
 * took `?callbackUrl=` straight from the query string into
 * `router.replace(callbackUrl)`. Confirmed in a browser before the fix:
 * `/login?callbackUrl=https://example.com/pwned` signed the user in and then
 * navigated them off the origin.
 *
 * The ordering is what makes it dangerous. The victim sees a genuine
 * allfantasy.ai address, types real credentials into the real form, succeeds,
 * and only THEN lands on the attacker's page — with every reason to trust
 * whatever it asks for next. It is a credential-phishing primitive wearing our
 * own domain.
 *
 * ⚠ THE BACKSLASH CASES ARE THE POINT, AND THEY DEFEATED THE CODEBASE'S EXISTING
 * GUARD. `startsWith("//")` looks sufficient and is not: browsers normalise
 * backslashes to forward slashes, so `/\host` resolves as `//host`. That variant
 * still redirected off-site after the first fix and needed the guard itself
 * hardened. Anything that "obviously" only tests the string a human reads will
 * regress this.
 *
 * The credentials callback is mocked so the assertions run without a database —
 * the redirect happens client-side after next-auth returns, which is exactly the
 * step being tested.
 */

/**
 * ⚠ EVERY HOSTILE CASE ASSERTS THE SUBSTITUTION, NOT JUST THE ABSENCE OF HARM,
 * AND THE FIRST VERSION OF THIS FILE WAS WRONG BECAUSE IT DID THE OPPOSITE.
 *
 * Checking only "the browser is still on our origin" passes whenever the sign-in
 * does not complete at all — which is exactly what happened before the hydration
 * wait below was added. Six tests reported green while proving nothing, and
 * would have kept reporting green with the fix reverted.
 *
 * So each case also asserts the guard REPLACED the value: rejection falls back
 * to /dashboard, /dashboard is protected, and an unauthenticated browser is
 * bounced to `/login?callbackUrl=%2Fdashboard`. Seeing `/dashboard` in that
 * parameter proves the redirect machinery ran and chose the safe destination.
 * If sign-in silently no-ops, the parameter still holds the attacker's value and
 * the test fails, as it should.
 */
function callbackParamOf(url: string): string | null {
  return new URL(url).searchParams.get('callbackUrl')
}

function originOf(url: string): string {
  return new URL(url).origin
}

/** Built at runtime so no editor, formatter or shell mangles the escaping. */
const BS = String.fromCharCode(92)
const TAB = String.fromCharCode(9)

const HOSTILE: Array<[string, string]> = [
  ['https://example.com/pwned', 'absolute url'],
  ['//example.com/pwned', 'protocol-relative'],
  [`/${BS}example.com/pwned`, 'backslash'],
  [`/${BS}${BS}example.com/pwned`, 'double backslash'],
  [`${BS}${BS}example.com/pwned`, 'leading backslashes'],
  [`/${TAB}//example.com/pwned`, 'tab-smuggled'],
]

/** Fills the credentials form and submits it, waiting for hydration first. */
async function submitLogin(page: Page) {
  const email = page.locator('input[type="email"], input[name="login"]').first()
  const password = page.locator('input[type="password"]').first()
  const submit = page.locator('button[type="submit"]').first()

  await expect(email).toBeVisible({ timeout: 30_000 })
  // The auth pages render behind a client-only boundary, so the form exists in
  // the DOM well before React wires it. Typing and clicking into that gap is a
  // no-op, and the test then fails on a timeout pointing at the wrong line.
  await waitForHydrated(email)
  await email.fill('probe@example.com')
  await password.fill('Probe-Password-123')
  await clickHydrated(submit)
}

test.describe('@security auth open redirect', () => {
  test.describe.configure({ timeout: 240_000 })

  test.beforeEach(async ({ page, baseURL }) => {
    await page.route('**/api/auth/callback/credentials**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        /*
         * ⚠ `url` MUST BE ABSOLUTE. next-auth's browser client runs
         * `new URL(data.url)` on this response, which THROWS on a relative path
         * — so a mock returning '/dashboard' makes signIn reject, AuthV4 lands
         * in its catch, and no redirect is attempted at all. The tests then fail
         * for a reason that has nothing to do with the guard they exist to
         * check. (They caught it precisely because they assert the substitution
         * rather than merely the absence of harm.)
         */
        body: JSON.stringify({
          url: `${baseURL}/dashboard`,
          status: 200,
          ok: true,
          error: null,
        }),
      }),
    )
    // Belt and braces: if the guard ever fails, the request is answered locally
    // rather than actually leaving the machine.
    await page.route('**example.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: 'external' }),
    )
  })

  for (const [callbackUrl, label] of HOSTILE) {
    test(`login rejects a ${label} callbackUrl`, async ({ page, baseURL }) => {
      await page.goto(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`, {
        waitUntil: 'domcontentloaded',
      })
      await submitLogin(page)

      // The guard substitutes /dashboard, which bounces back to /login.
      await expect
        .poll(() => callbackParamOf(page.url()), {
          timeout: 60_000,
          message: `a ${label} callbackUrl should be replaced with the safe default`,
        })
        .toBe('/dashboard')

      expect(
        originOf(page.url()),
        `a ${label} callbackUrl must not leave the origin`,
      ).toBe(originOf(baseURL as string))
    })
  }

  test('a legitimate relative callbackUrl is still honoured', async ({ page }) => {
    /*
     * The guard has to stay useful, not just safe. /pricing sends signed-out
     * buyers to signup carrying the plan they picked; if this stopped working
     * the fix would have quietly broken the checkout funnel instead of the
     * attack. This is also the control proving the sign-in path above completes.
     */
    await page.goto('/login?callbackUrl=%2Fpricing%3Fplan%3Daf_pro_monthly', {
      waitUntil: 'domcontentloaded',
    })
    await submitLogin(page)

    /*
     * Polled rather than waitForURL: router.replace is a client-side navigation
     * and does not fire the `load` event waitForURL waits on by default, so the
     * assertion would time out on a redirect that had already happened.
     */
    await expect
      .poll(() => page.url(), { timeout: 60_000, message: 'should return to the chosen plan' })
      .toContain('/pricing')
    expect(page.url()).toContain('plan=af_pro_monthly')
  })
})
