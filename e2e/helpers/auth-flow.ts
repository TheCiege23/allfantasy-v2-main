import { type Page } from "@playwright/test"

type TestCredentials = {
  email: string
  username: string
  password: string
}

function makeTestCredentials(): TestCredentials {
  const now = Date.now()
  return {
    email: `e2e.${now}@example.com`,
    username: `e2e${now}`,
    password: "Password123!",
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function computeBackoffMs(attempt: number): number {
  const base = Math.min(1000 * 2 ** (attempt - 1), 20_000)
  const jitter = Math.floor(Math.random() * 300)
  return base + jitter
}

function parseRetryAfterMs(value: string | undefined): number | null {
  if (!value) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.floor(seconds * 1000)
  }
  const targetMs = Date.parse(value)
  if (Number.isNaN(targetMs)) return null
  const delta = targetMs - Date.now()
  return delta > 0 ? delta : null
}

async function waitForSessionReady(page: Page): Promise<void> {
  const maxAttempts = 15
  let lastError = ""

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await page.request.get("/api/auth/session", { timeout: 10_000 })
      if (response.ok()) {
        const body = (await response.json().catch(() => null)) as {
          user?: { id?: string | null } | null
        } | null
        if (body?.user?.id) return
      }
    } catch (error) {
      lastError = String((error as Error)?.message ?? error)
    }

    await delay(Math.min(250 * attempt, 1500))
  }

  if (lastError) {
    throw new Error(`Session did not become ready after sign-in: ${lastError}`)
  }
  throw new Error("Session did not become ready after sign-in")
}

async function registerWithRetry(
  page: Page,
  credentials: TestCredentials
): Promise<void> {
  // Wait for auth routes to be fully mounted before attempting registration
  // This gives the dev server extra time to compile and mount the [...nextauth] catch-all route
  const maxWarmupAttempts = 5
  for (let attempt = 1; attempt <= maxWarmupAttempts; attempt++) {
    try {
      const warmupResponse = await page.request.get("/api/auth/csrf", { timeout: 10_000 })
      if (warmupResponse.ok()) {
        break // Routes are ready
      }
    } catch {
      // Ignore warmup failures, keep retrying
    }
    if (attempt < maxWarmupAttempts) {
      await delay(2000)
    }
  }

  const maxAttempts = 12
  let lastStatus = 0
  let lastBody = ""
  let lastError = ""

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let response
    try {
      response = await page.request.post("/api/auth/register", {
        headers: {
          "x-allfantasy-e2e": "1",
        },
        data: {
          username: credentials.username,
          email: credentials.email,
          password: credentials.password,
          displayName: credentials.username,
          ageConfirmed: true,
          verificationMethod: "EMAIL",
          timezone: "America/New_York",
          preferredLanguage: "en",
          avatarPreset: "crest",
          disclaimerAgreed: true,
          termsAgreed: true,
        },
        timeout: 45_000,
      })
    } catch (error) {
      lastError = String((error as Error)?.message ?? error)
      if (attempt < maxAttempts) {
        await delay(computeBackoffMs(attempt))
        continue
      }
      break
    }

    lastStatus = response.status()
    lastBody = await response.text()

    if (response.ok()) {
      return
    }

    let errorCode: string | undefined
    try {
      const parsed = JSON.parse(lastBody) as { code?: string }
      errorCode = parsed?.code
    } catch {}

    const isDbUnavailable =
      lastStatus === 503 &&
      (errorCode === "DB_UNAVAILABLE" ||
        lastBody.includes('"code":"DB_UNAVAILABLE"') ||
        lastBody.toLowerCase().includes("database temporarily unavailable"))

    const normalizedBody = lastBody.toLowerCase()
    const isAuthRouteWarmupIssue =
      (lastStatus === 400 && normalizedBody.includes("not supported by nextauth")) ||
      normalizedBody.includes("cannot post /api/auth/register") ||
      (lastStatus === 404 && normalizedBody.includes("this page could not be found"))

    if ((!isDbUnavailable && !isAuthRouteWarmupIssue) || attempt === maxAttempts) {
      break
    }

    const retryAfterMs = parseRetryAfterMs(response.headers()["retry-after"])
    const retryDelayMs = retryAfterMs != null
      ? Math.min(retryAfterMs, 20_000)
      : computeBackoffMs(attempt)
    await delay(retryDelayMs)
  }

  if (lastError) {
    throw new Error(`Registration failed after retries: ${lastError}`)
  }

  throw new Error(`Registration failed with status ${lastStatus}: ${lastBody}`)
}

async function loginWithRetry(page: Page, credentials: TestCredentials): Promise<void> {
  return loginWithRetryTo(page, credentials, "/dashboard")
}

async function loginWithRetryTo(
  page: Page,
  credentials: TestCredentials,
  landingPath: string | null
): Promise<void> {
  const maxAttempts = 8
  let lastError = ""

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const csrfResponse = await page.request.get("/api/auth/csrf", { timeout: 15_000 })
      const csrfText = await csrfResponse.text()
      if (!csrfResponse.ok()) {
        lastError = `csrf status=${csrfResponse.status()} body=${csrfText}`
        if (attempt < maxAttempts) {
          await delay(computeBackoffMs(attempt))
          continue
        }
        break
      }

      let csrfPayload: { csrfToken?: string } = {}
      try {
        csrfPayload = JSON.parse(csrfText) as { csrfToken?: string }
      } catch {
        lastError = `Invalid csrf response body: ${csrfText.slice(0, 120)}`
        if (attempt < maxAttempts) {
          await delay(computeBackoffMs(attempt))
          continue
        }
        break
      }
      const csrfToken = csrfPayload?.csrfToken

      if (!csrfToken) {
        lastError = `Missing csrfToken (status ${csrfResponse.status()})`
        if (attempt < maxAttempts) {
          await delay(computeBackoffMs(attempt))
          continue
        }
        break
      }

      const signInResponse = await page.request.post("/api/auth/callback/credentials?json=true", {
        form: {
          csrfToken,
          login: credentials.username,
          password: credentials.password,
          callbackUrl: landingPath ?? "/dashboard",
          json: "true",
        },
        timeout: 15_000,
      })

      const signInText = await signInResponse.text()
      const maybeErrorUrl =
        signInText.includes("CredentialsSignin") ||
        signInText.includes("error=CredentialsSignin") ||
        signInText.includes("/login?")

      if (!signInResponse.ok() || maybeErrorUrl) {
        lastError = `signIn status=${signInResponse.status()} body=${signInText}`
        if (attempt < maxAttempts) {
          await delay(computeBackoffMs(attempt))
          continue
        }
        break
      }

      await waitForSessionReady(page)
    } catch (error) {
      lastError = String((error as Error)?.message ?? error)
      if (attempt < maxAttempts) {
        await delay(computeBackoffMs(attempt))
        continue
      }
      break
    }

    try {
      if (!landingPath) {
        return
      }

      await page.goto(landingPath, { waitUntil: "domcontentloaded" })
      /*
       * ⚠ A LANDING PATH THAT REDIRECTS USED TO HANG FOR THE WHOLE TEST BUDGET, AND THE
       * TIMEOUT WAS THE ONLY THING IT EVER REPORTED. `waitForURL` takes no timeout of its
       * own here, so once `/dashboard` was retired (2026-08-24; middleware 307s it to
       * `/core`) this predicate could never match: both admin-timezone specs burned their
       * full 240s and failed with "Test timeout of 240000ms exceeded" and nothing else —
       * a symptom that reads like a slow runner rather than a dead path.
       *
       * So bound the wait, and accept a redirect: the destination is fine as long as it is
       * not the sign-in page, which means the session did not take and the retry loop above
       * still has work to do.
       */
      const landingPathname = new URL(landingPath, page.url()).pathname
      await page
        .waitForURL((url) => url.pathname === landingPathname, { timeout: 30_000 })
        .catch(() => {
          const settled = new URL(page.url()).pathname
          if (settled === "/login" || settled.startsWith("/login/")) {
            throw new Error(`Landing ${landingPath} bounced to ${settled}`)
          }
        })

            // Wait for main content to be visible before returning
            // This ensures the page is not just loaded but also rendered
            try {
              await page.waitForSelector("main", { timeout: 15_000 })
            } catch {
              // main might not exist on all pages, that's OK
            }
      return
    } catch (error) {
      lastError = String((error as Error)?.message ?? error)
      if (attempt < maxAttempts) {
        await delay(computeBackoffMs(attempt))
      }
    }
  }

  throw new Error(`Login failed after retries. ${lastError || `Final URL: ${page.url()}`}`)
}

export async function registerAndLogin(page: Page): Promise<void> {
  // `/core` is the signed-in home. `/dashboard` was retired on 2026-08-24 and middleware
  // 307s it to `/core`, so landing there waited for a URL that can no longer appear.
  return registerAndLoginTo(page, "/core")
}

export async function registerAndLoginTo(
  page: Page,
  landingPath: string | null
): Promise<void> {
  const credentials = makeTestCredentials()

  await registerWithRetry(page, credentials)
  await loginWithRetryTo(page, credentials, landingPath)
}
