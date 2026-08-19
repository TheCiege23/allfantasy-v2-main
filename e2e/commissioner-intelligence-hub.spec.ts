/**
 * G15.7 — Commissioner Intelligence Hub browser proof (Playwright).
 *
 * Proves the read-only hub renders for a commissioner against a real staging build:
 * self-seed a commissioner league (real finalize path emits events) → drain the relay
 * (audit feed + intelligence snapshots) → open /league/[id]/intelligence → assert all four
 * modules render and the commissioner-only cards are NOT access-restricted. Cleans up.
 *
 * OPT-IN: RUN_INTEL_HUB=1 (needs a Node-20 app on a NON-prod DB + ALLOW_E2E_SEED=1 for the
 * e2e seed/relay routes). PLAYWRIGHT_BASE_URL points at the running staging build.
 *
 *   RUN_INTEL_HUB=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:3101 \
 *     npx playwright test e2e/commissioner-intelligence-hub.spec.ts --project=chromium
 */
import { test, expect, type APIRequestContext } from '@playwright/test'
import { registerAndLogin } from './helpers/auth-flow'

const ENABLED = process.env.RUN_INTEL_HUB === '1'
const E2E = { 'x-allfantasy-e2e': '1' }

type Seeded = { leagueId: string; season: number; seededScoreIds: string[] }
let seeded: Seeded | null = null

async function cleanup(request: APIRequestContext) {
  if (!seeded) return
  await request
    .delete('/api/e2e/seed-g8-league', { headers: E2E, data: { leagueId: seeded.leagueId, season: seeded.season, seededScoreIds: seeded.seededScoreIds } })
    .catch(() => undefined)
  seeded = null
}

test.describe('Commissioner Intelligence Hub @intel-hub', () => {
  test.skip(!ENABLED, 'Set RUN_INTEL_HUB=1 to run the Commissioner Hub browser proof.')

  test.afterAll(async ({ request }) => {
    await cleanup(request)
  })

  test('commissioner sees all four hub modules (no access-restricted leaks)', async ({ page }) => {
    test.setTimeout(5 * 60_000)

    await test.step('1. Sign in (commissioner)', async () => {
      await registerAndLogin(page)
    })

    let leagueId = ''
    await test.step('2. Self-seed a commissioner league (emits events)', async () => {
      const res = await page.request.post('/api/e2e/seed-g8-league', { headers: E2E, data: { team: 'KC' } })
      expect(res.ok(), `seed failed (${res.status()})`).toBeTruthy()
      const body = (await res.json()) as Seeded
      seeded = body
      leagueId = body.leagueId
      expect(leagueId).toBeTruthy()
    })

    await test.step('3. Drain the relay → populate read models', async () => {
      const res = await page.request.post('/api/e2e/run-relay', { headers: E2E })
      expect(res.ok(), `relay run failed (${res.status()})`).toBeTruthy()
      const body = (await res.json()) as { summary: { dispatched: number } }
      expect(body.summary.dispatched).toBeGreaterThan(0)
    })

    await test.step('4. Open the hub + verify modules render', async () => {
      await page.goto(`/league/${leagueId}/intelligence`, { waitUntil: 'domcontentloaded' })
      await expect(page.getByTestId('commissioner-intelligence-hub')).toBeVisible({ timeout: 30_000 })

      // All four modules present.
      for (const id of ['module-activity', 'module-health', 'module-action-items', 'module-audit-feed']) {
        await expect(page.getByTestId(id)).toBeVisible({ timeout: 20_000 })
      }

      // Commissioner-only cards must NOT show the access-restricted state for the owner.
      await expect(page.getByTestId('module-health').getByTestId('state-restricted')).toHaveCount(0)
      await expect(page.getByTestId('module-action-items').getByTestId('state-restricted')).toHaveCount(0)

      // Activity has data (seed emitted events); audit feed shows entries.
      await expect(page.getByTestId('module-activity').getByTestId('activity-content')).toBeVisible({ timeout: 20_000 })
      await expect(page.getByTestId('module-audit-feed').getByTestId('audit-feed-content')).toBeVisible({ timeout: 20_000 })

      // No raw payload / server-only error leakage on the page.
      await expect(page.getByText(/payload|passwordHash|server-only|PrismaClient/i)).toHaveCount(0)
    })
  })
})
