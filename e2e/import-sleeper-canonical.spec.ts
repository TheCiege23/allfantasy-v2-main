import { test, expect } from '@playwright/test'

/**
 * Batch 1 — Canonical Sleeper import via the REAL `/import` route.
 *
 * This certifies the launch import journey end-to-end through the actual routed
 * page + component chain (`app/import/page.tsx` → `ImportPageClient` →
 * `components/unified-import-ui/LeagueImportFlow.tsx`), NOT the `/create-league`
 * UI. (There used to be an e2e/league-creation-sleeper-import.spec.ts driving
 * that flow; it has since been deleted, because the flow it described no longer
 * exists — the create wizard only links out to this route now.)
 *
 * The Sleeper provider's server calls are mocked at the canonical API boundary
 * (`/api/leagues/import/discover|preview|commit`) with controlled fixtures — the
 * route/component chain under test is real. This proves:
 *   - the /import Sleeper tab drives the CANONICAL discover → preview → commit
 *     pipeline (not the legacy `/api/legacy/import` career import), and
 *   - a successful commit surfaces the canonical `League.id` and links the user
 *     to `/league/[League.id]` (never `/af-legacy`).
 */

/**
 * This spec's own waits total up to 70s (15 + 15 + 15 + 25), which does not fit
 * inside Playwright's DEFAULT 30s per-test budget — it only ever passed while the
 * dev server happened to be warm. The final hop to /dashboard is the one that
 * tips it over: that route is large and compiles on demand under `next dev`.
 * Matches the 180s its sibling specs already declare.
 */
test.describe.configure({ timeout: 180_000 })

const CANONICAL_LEAGUE_ID = '11111111-2222-3333-4444-555555555555'
const SLEEPER_LEAGUE_ID = '987654321'

async function gotoWithRetry(page: import('@playwright/test').Page, url: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      return
    } catch (err) {
      if (attempt === 2) throw err
    }
  }
}

test.describe('Canonical Sleeper import — real /import route', () => {
  test('discover → select → preview → commit lands on the canonical /league/[id]', async ({
    page,
  }) => {
    // --- Canonical import API mocks (provider fixtures; route chain is real) ---
    await page.route('**/api/leagues/import/discover', async (route) => {
      // Sleeper account/league discovery via the canonical discover route.
      expect(route.request().method()).toBe('POST')
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          provider: 'sleeper',
          sport: 'nfl',
          season: '2026',
          account: {
            providerUserId: '4200',
            accountIdentifier: 'commish_user',
            displayName: 'Commish User',
          },
          leagues: [
            {
              sourceId: SLEEPER_LEAGUE_ID,
              name: 'Dynasty Warlords',
              sport: 'nfl',
              season: '2026',
              status: 'in_season',
              totalTeams: 12,
              isDynasty: true,
              avatarUrl: null,
            },
          ],
        }),
      })
    })

    await page.route('**/api/leagues/import/preview', async (route) => {
      // Canonical preview by sourceId.
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          league: { name: 'Dynasty Warlords' },
          canonical: null,
        }),
      })
    })

    await page.route('**/api/leagues/import/commit', async (route) => {
      // Canonical commit returns the canonical League.id.
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          league: {
            id: CANONICAL_LEAGUE_ID,
            name: 'Dynasty Warlords',
            sport: 'nfl',
          },
        }),
      })
    })

    // The legacy career import must NOT be hit by the flagship /import journey.
    let legacyImportHit = false
    await page.route('**/api/legacy/import', async (route) => {
      legacyImportHit = true
      await route.fulfill({ status: 500, body: 'legacy path must not be used' })
    })

    // Authenticate via the dev-only bypass (DEV_AUTH_BYPASS_ENABLED) so the real
    // session-gated /import route renders. Never used in production; no real
    // credentials involved.
    const csrf = (await page.request.get('/api/auth/csrf').then((r) => r.json())) as {
      csrfToken?: string
    }
    await page.request.post('/api/auth/callback/dev-bypass?json=true', {
      form: { csrfToken: csrf.csrfToken ?? '', callbackUrl: '/import', json: 'true' },
    })

    // Land on /import with the Sleeper username prefilled via the SAME query
    // contract the landing funnel uses (provider + username) — this also proves
    // the landing → signup-intent → /import handoff arrives ready to discover.
    await gotoWithRetry(page, '/import?provider=sleeper&username=commish_user')

    // Sleeper tab selected + username prefilled into the discovery input.
    //
    // Generous first-paint budget on purpose: this is the FIRST assertion after
    // landing on /import, so under `next dev` it waits on that route's initial
    // compile. The default 5s is a bet that the page is already built, which is
    // true locally and false on a cold CI runner — it failed there at exactly this
    // line while every later step passed.
    await expect(page.getByTestId('import-tab-sleeper')).toBeVisible({ timeout: 90_000 })
    await expect(page.getByTestId('import-discovery-account')).toHaveValue('commish_user', { timeout: 30_000 })

    // 1) Discover leagues from the prefilled Sleeper account identifier.
    await page.getByTestId('import-discovery-find').click()

    // 2) The discovered league appears; select it to preview.
    await expect(page.getByText('Dynasty Warlords')).toBeVisible({ timeout: 15_000 })
    await page.getByTestId(`import-league-select-${SLEEPER_LEAGUE_ID}`).click()

    // 3) Preview loads → commit.
    await expect(page.getByTestId('import-commit')).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('import-commit').click()

    // 4) Completion: the connected league is available as a read-only view…
    const openCanonical = page.locator(`a[href="/league/${CANONICAL_LEAGUE_ID}"]`)
    await expect(openCanonical).toBeVisible({ timeout: 15_000 })

    // …and the PRIMARY completion action sends the user to the FREE dashboard
    // (not /af-legacy, not a "newly created AF league").
    await expect(page.locator('a[href="/af-legacy"]')).toHaveCount(0)
    await page.getByTestId('import-go-dashboard').click()
    // Assert the DESTINATION (client nav commit) — not full dashboard render,
    // which can exceed the timeout on a cold dev compile.
    // `commit` still needs the server to answer with headers, and /dashboard is
    // large enough that a cold `next dev` compile blows past 25s whenever anything
    // else is competing for the machine. Raising the per-test budget alone was not
    // enough — this inner wait was the binding constraint, and it is a dev-server
    // build cost, not a product latency the user would ever see.
    await page.waitForURL('**/dashboard**', { timeout: 120_000, waitUntil: 'commit' })
    expect(new URL(page.url()).pathname).toBe('/dashboard')

    // The flagship import must never have used the legacy career-history pipeline.
    expect(legacyImportHit).toBe(false)
  })
})
