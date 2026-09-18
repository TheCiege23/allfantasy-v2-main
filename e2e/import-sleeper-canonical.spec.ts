import { test, expect } from '@playwright/test'
import { signInAs } from './helpers/session-cookie'

/**
 * Batch 1 — Canonical Sleeper import via the REAL `/import` route.
 *
 * This certifies the launch import journey end-to-end through the actual routed
 * page + component chain (`app/import/page.tsx` → `components/core-app/screens/
 * ImportV4.tsx` → `components/core-app/import/ImportDone.tsx`), NOT the
 * `/create-league` UI. (There used to be an e2e/league-creation-sleeper-import.spec.ts
 * driving that flow; it has since been deleted, because the flow it described no
 * longer exists — the create wizard only links out to this route now.)
 *
 * ⚠ THAT CHAIN IS NOT THE ONE THIS HEADER NAMED UNTIL 2026-09-17. It said
 * `ImportPageClient` → `components/unified-import-ui/LeagueImportFlow.tsx`, which now
 * backs `/legacy-import` only. The route moved and the header did not, which is worth
 * knowing because the same move is what took this spec's test ids with it.
 *
 * The Sleeper provider's server calls are mocked at the canonical API boundary
 * (`/api/leagues/import/discover|preview|commit`) with controlled fixtures — the
 * route/component chain under test is real. This proves:
 *   - the /import Sleeper tab drives the CANONICAL discover → preview → commit
 *     pipeline (not the legacy `/api/legacy/import` career import), and
 *   - a successful commit surfaces the canonical `League.id` and hands the user a
 *     completion link carrying it (never `/af-legacy`).
 */

/**
 * This spec's own waits do not fit inside Playwright's DEFAULT 30s per-test budget —
 * it only ever passed while the dev server happened to be warm. The final hop is the
 * one that tips it over: `/core` is large and compiles on demand under `next dev`.
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
  test('discover → select → preview → commit lands on the canonical league id', async ({
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

    /*
     * ⚠ THE OLD SIGN-IN HERE WAS A NO-OP IN CI, AND SILENTLY SO.
     *
     * It posted to `/api/auth/callback/dev-bypass`, a provider lib/auth.ts only
     * registers when DEV_AUTH_BYPASS_ENABLED === 'true'. That variable is set in no
     * workflow file, so in CI the provider does not exist, the POST does nothing, and
     * `/import` — which redirects to /login without a session — never rendered. The
     * spec then spent its full 90s budget on the first assertion and reported a
     * missing test id, which reads as a deleted import screen rather than as a
     * visitor who was never signed in.
     *
     * signInAs mints a token with the SERVER's own secret (CI sets NEXTAUTH_SECRET),
     * so it is a real session rather than a product bypass, and it is what the rest
     * of this suite already uses.
     */
    await signInAs(page, { id: 'e2e-import-user', username: 'commish_user' })

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

    /*
     * ⚠ THE GAP RECORDED HERE IS CLOSED, AND THIS IS HOW IT WAS CLOSED. The note used to
     * read: `/import` renders ImportV4, which carried three of this spec's ids, while
     * import-league-select-*, import-commit and import-go-dashboard lived in
     * `LeagueImportFlow` — the component that used to own `/import` and now only backs
     * `/legacy-import`. It ended by saying which route should own the journey was a
     * product decision, not something to settle inside a test file.
     *
     * Settled 2026-09-17, by the user: ImportV4 gets the contract. `import-league-select-<id>`
     * and `import-commit` are now on ImportV4's own row button and commit button, with a
     * comment there saying why they are load-bearing.
     *
     * `import-go-dashboard` deliberately did NOT come back — see step 5 below.
     */
    // 2) The discovered league appears; select it to preview.
    await expect(page.getByText('Dynasty Warlords')).toBeVisible({ timeout: 15_000 })
    await page.getByTestId(`import-league-select-${SLEEPER_LEAGUE_ID}`).click()

    // 3) Preview loads → commit.
    await expect(page.getByTestId('import-commit')).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('import-commit').click()

    /*
     * 4) COMPLETION — AND THE DESTINATION IS `/core?league=<id>`, NOT `/league/<id>`.
     * This step used to look for `a[href="/league/<canonical>"]` and then click
     * `import-go-dashboard` and wait for `/dashboard`. Both destinations are gone:
     *
     *   - `/dashboard` was retired on 2026-08-24; middleware 307s it to `/core`, so that
     *     wait was on a URL that can no longer be the final one.
     *   - `ImportDone` now leads with a single "Open your league", and ImportV4 builds its
     *     href as `/core?league=${leagueId}` (see its `leagueHref` prop) — `/core` is the
     *     one signed-in home, scoped to the league you just connected. There is no separate
     *     go-to-dashboard action left to give a testid to.
     *
     * What matters is unchanged and is still asserted: the CANONICAL league id — the one
     * the commit route returned — is what the completion action carries.
     */
    const openCanonical = page.locator(`a[href="/core?league=${CANONICAL_LEAGUE_ID}"]`)
    await expect(openCanonical).toBeVisible({ timeout: 15_000 })

    // …and nothing offers the legacy career-history path as the way on.
    await expect(page.locator('a[href="/af-legacy"]')).toHaveCount(0)

    // 5) Follow it. Assert the DESTINATION (client nav commit) rather than a full render,
    // which can exceed the budget on a cold `next dev` compile — a dev-server build cost,
    // never a latency a user would see.
    await openCanonical.click()
    await page.waitForURL(`**/core?league=${CANONICAL_LEAGUE_ID}**`, {
      timeout: 120_000,
      waitUntil: 'commit',
    })
    const landed = new URL(page.url())
    expect(landed.pathname).toBe('/core')
    expect(landed.searchParams.get('league')).toBe(CANONICAL_LEAGUE_ID)

    // The flagship import must never have used the legacy career-history pipeline.
    expect(legacyImportHit).toBe(false)
  })
})
