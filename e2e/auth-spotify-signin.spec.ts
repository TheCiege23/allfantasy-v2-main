import { test, expect, type APIRequestContext } from '@playwright/test'
import { registerAndLoginTo } from './helpers/auth-flow'

async function getProvidersWithRetry(
  request: APIRequestContext,
  maxAttempts = 8
): Promise<Record<string, { id?: string }>> {
  let lastBody = ''
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await request.get('/api/auth/providers', { timeout: 20_000 })
    if (response.ok()) {
      return (await response.json()) as Record<string, { id?: string }>
    }

    lastBody = await response.text()
    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt))
    }
  }

  throw new Error(`Unable to load /api/auth/providers after retries: ${lastBody}`)
}

test.describe('@auth Spotify sign-in wiring', () => {
  test('login page routes to Spotify OAuth when configured', async ({ page, request }) => {
    const providers = await getProvidersWithRetry(request)
    const spotifyConfigured = Boolean(providers?.spotify?.id)
    test.skip(!spotifyConfigured, 'Spotify provider is not configured in this environment.')

    await page.goto('/login')
    const spotifyButton = page.getByRole('button', { name: /continue with spotify/i })
    await expect(spotifyButton).toBeVisible()

    const signInResponsePromise = page.waitForResponse(
      (response) => response.url().includes('/api/auth/signin/spotify') && response.status() >= 200,
      { timeout: 30_000 }
    )

    await spotifyButton.click()

    const signInResponse = await signInResponsePromise
    expect(signInResponse.status()).toBeLessThan(400)
  })

  test('mock callback path links Spotify and reflects connected state', async ({ page }) => {
    test.setTimeout(120_000)
    await registerAndLoginTo(page, '/settings?tab=connected')

    /*
     * The fixture route is gated on the `x-allfantasy-e2e` header as well as the
     * environment — it fabricates an OAuth link, so an env check alone would leave it
     * reachable on any non-production deploy. Without the header it answers 404.
     */
    const linkRes = await page.request.post('/api/e2e/auth/spotify/mock-connect', {
      headers: { 'x-allfantasy-e2e': '1' },
    })
    expect(linkRes.ok(), `mock-connect failed (${linkRes.status()}): ${await linkRes.text()}`).toBeTruthy()

    const accountsRes = await page.request.get('/api/user/connected-accounts')
    expect(accountsRes.ok()).toBeTruthy()
    const accountsPayload = (await accountsRes.json()) as {
      providers?: Array<{ id?: string; linked?: boolean }>
    }
    const spotifyProvider = (accountsPayload.providers ?? []).find((provider) => provider.id === 'spotify')
    expect(spotifyProvider?.linked).toBeTruthy()

    await page.goto('/settings?tab=connected')
    await expect(page.getByText(/spotify mock user|spotify connected/i).first()).toBeVisible({
      timeout: 20_000,
    })
  })
})
