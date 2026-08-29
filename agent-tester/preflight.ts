/**
 * Preflight safety gate for the agent tester.
 *
 * ⚠ WHY THIS FILE EXISTS, AND WHY IT REFUSES BY DEFAULT.
 *
 * An agent tester differs from the e2e/ suite in one way that matters here: it
 * is *exploratory*. A click-audit spec touches the routes its author listed. An
 * agent touches whatever it finds, as many times as its step budget allows, and
 * submits forms it was never told about. Pointed at production, that is not a
 * test run — it is unattended write traffic from an unpredictable client.
 *
 * The concrete cost on THIS app, read out of app/api/auth/register/route.ts:
 *
 *   1. The e2e bypass is OFF in production. It needs NODE_ENV !== "production"
 *      OR ALLOW_E2E_SEED=1, and the real production deploy sets neither. So
 *      every signup takes the full path below.
 *   2. rateLimit(`signup:${ip}`, 5, 600_000) — five signups per ten minutes per
 *      IP. The agent would spend its run testing the rate limiter.
 *   3. A Resend verification email is sent per signup. To fake addresses. That
 *      is bounce volume charged against your sender reputation.
 *   4. notifyOwnerOfNewSignup fires on every account. Your inbox.
 *   5. trackMetaServerEvent sends a CompleteRegistration conversion to Meta for
 *      each one — fake conversions teaching your ad optimiser to buy the wrong
 *      audience. This is the expensive one and it is not reversible.
 *
 * And the hazard is not hypothetical. lib/email/undeliverableDomains.ts records
 * that Vercel PREVIEW deployments point at the PRODUCTION database, which put
 * 114 e2e rows into a 146-row EarlyAccessSignup table. A URL ending in
 * .vercel.app is therefore NOT evidence that you are off production data.
 *
 * Hence: explicit opt-in, hostname denylist, and a behavioural probe that
 * confirms the e2e bypass is actually live before any write-capable mission
 * runs. Default is refuse.
 */

import { type APIRequestContext, request as playwrightRequest } from "@playwright/test"

/**
 * Hosts that must never be targeted, regardless of what the operator sets.
 * Matched against the URL hostname, with subdomains included.
 */
const PRODUCTION_HOST_DENYLIST = [
  "allfantasy.ai",
  "www.allfantasy.ai",
]

/** Extra hosts an operator can block for their own setup. Comma-separated. */
function operatorDenylist(): string[] {
  return (process.env.AGENT_TESTER_DENY_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
}

export type PreflightResult = {
  baseURL: string
  /** True when the x-allfantasy-e2e bypass is confirmed live on the target. */
  bypassActive: boolean
  /** Whether write-capable missions (signup, league creation) may run. */
  writesAllowed: boolean
  notes: string[]
}

export class PreflightError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PreflightError"
  }
}

function hostIsDenied(hostname: string): string | null {
  const host = hostname.toLowerCase()
  const denied = [...PRODUCTION_HOST_DENYLIST, ...operatorDenylist()]
  for (const bad of denied) {
    if (host === bad || host.endsWith(`.${bad}`)) return bad
  }
  return null
}

/**
 * Resolve and validate the target URL. Throws rather than falling back to a
 * default, because a default here is how a test suite finds production.
 */
export function resolveBaseURL(): string {
  const raw =
    process.env.AGENT_TESTER_BASE_URL ??
    process.env.BASE_URL ??
    ""

  if (!raw.trim()) {
    throw new PreflightError(
      [
        "AGENT_TESTER_BASE_URL is not set, and there is deliberately no default.",
        "",
        "Set it to your Vercel Preview (staging) URL:",
        '  $env:AGENT_TESTER_BASE_URL = "https://allfantasy-v2-<hash>.vercel.app"',
        "",
        "Never point this at production. See the header comment in agent-tester/preflight.ts.",
      ].join("\n")
    )
  }

  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw new PreflightError(`AGENT_TESTER_BASE_URL is not a valid URL: ${raw}`)
  }

  const denied = hostIsDenied(url.hostname)
  if (denied) {
    throw new PreflightError(
      [
        `REFUSING TO RUN: ${url.hostname} matches the production denylist (${denied}).`,
        "",
        "The agent tester creates accounts and submits forms it discovers on its own.",
        "Against production that means real signup emails, owner notifications,",
        "polluted Meta conversion data, and rows in your production database.",
        "",
        "Point AGENT_TESTER_BASE_URL at a staging/preview deployment instead.",
      ].join("\n")
    )
  }

  // Strip any trailing slash so path joins stay predictable.
  return url.toString().replace(/\/$/, "")
}

/**
 * Behavioural probe: does the target honour the e2e bypass?
 *
 * This is the only external signal that distinguishes "safe staging" from "a
 * preview wired to the production database". /api/health reports whether a DB
 * is *connected*, not *which* DB — so it cannot answer this. The register route
 * can, indirectly:
 *
 *   - On the bypass path the entire verification-email block is skipped, so the
 *     response carries emailVerificationPrepared: false and the message
 *     "Account created. Sign in to continue verification setup."
 *   - On the real path with a working Resend config, emailVerificationPrepared
 *     comes back true — which means an email was just sent, i.e. you are NOT on
 *     a bypassed environment.
 *
 * The probe registers exactly one account at a standards-reserved domain, so
 * even in the worst case it cannot enter the marketing list
 * (see lib/email/undeliverableDomains.ts).
 */
async function probeBypass(api: APIRequestContext, baseURL: string): Promise<{
  active: boolean
  detail: string
}> {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`
  const probeEmail = `agent.preflight.${stamp}@example.com`

  let response
  try {
    response = await api.post(`${baseURL}/api/auth/register`, {
      headers: { "x-allfantasy-e2e": "1" },
      data: {
        username: `agentpf${stamp}`.slice(0, 30),
        email: probeEmail,
        password: "Password123!",
        displayName: "Agent Preflight",
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
    return {
      active: false,
      detail: `probe request failed: ${String((error as Error)?.message ?? error)}`,
    }
  }

  const status = response.status()
  const text = await response.text()

  if (status === 429) {
    return {
      active: false,
      detail:
        "target returned 429 on signup — the rate limiter is engaged, which only happens when the e2e bypass is OFF. This looks like a production-mode environment.",
    }
  }

  if (status === 451) {
    return {
      active: false,
      detail:
        "target returned 451 (geo block) — geo detection runs only when the bypass is OFF. This looks like a production-mode environment.",
    }
  }

  if (status === 403 && text.includes("GATE")) {
    return {
      active: false,
      detail:
        "target returned a beta-admission 403 — the invite gate runs only when the bypass is OFF.",
    }
  }

  if (!response.ok()) {
    return {
      active: false,
      detail: `signup probe returned ${status}: ${text.slice(0, 200)}`,
    }
  }

  let parsed: { emailVerificationPrepared?: boolean; message?: string } = {}
  try {
    parsed = JSON.parse(text)
  } catch {
    return { active: false, detail: `unparseable signup response: ${text.slice(0, 200)}` }
  }

  if (parsed.emailVerificationPrepared === true) {
    return {
      active: false,
      detail:
        "signup succeeded but emailVerificationPrepared=true — a real verification email was just SENT. The bypass is off; do not run write missions here.",
    }
  }

  return {
    active: true,
    detail: "e2e bypass confirmed live (no verification email prepared, no rate limit, no geo gate).",
  }
}

/**
 * Run the full gate. Call this from globalSetup so a misconfigured run fails
 * before a single archetype starts, rather than halfway through creating rows.
 */
export async function preflight(): Promise<PreflightResult> {
  const notes: string[] = []
  const baseURL = resolveBaseURL()
  notes.push(`target: ${baseURL}`)

  const api = await playwrightRequest.newContext({ baseURL })

  try {
    // Liveness first — a clearer error than a failed probe if the deploy is down.
    let health
    try {
      health = await api.get(`${baseURL}/api/health`, { timeout: 30_000 })
    } catch (error) {
      throw new PreflightError(
        `Could not reach ${baseURL}/api/health — is the deployment up?\n${String(
          (error as Error)?.message ?? error
        )}`
      )
    }

    if (!health.ok()) {
      throw new PreflightError(
        `${baseURL}/api/health returned ${health.status()}. Refusing to run against an unhealthy target.`
      )
    }

    const healthBody = (await health.json().catch(() => ({}))) as {
      database?: { connected?: boolean }
      analytics?: { env?: string }
    }

    if (healthBody.database?.connected === false) {
      notes.push(
        "⚠ health reports database.connected=false — DB-backed missions will fail; read-only exploration still works."
      )
    }
    if (healthBody.analytics?.env) {
      notes.push(`reported NODE_ENV: ${healthBody.analytics.env}`)
    }

    // Read-only mode skips the write probe entirely and never registers.
    if (process.env.AGENT_TESTER_READ_ONLY === "1") {
      notes.push("read-only mode: no account creation, no form submission.")
      return { baseURL, bypassActive: false, writesAllowed: false, notes }
    }

    const probe = await probeBypass(api, baseURL)
    notes.push(probe.detail)

    if (!probe.active) {
      throw new PreflightError(
        [
          "REFUSING TO RUN WRITE MISSIONS.",
          "",
          `Target: ${baseURL}`,
          `Reason: ${probe.detail}`,
          "",
          "The e2e bypass is not active on this target, which means every signup the",
          "agent performs will send a real verification email, notify the owner, fire a",
          "Meta CompleteRegistration conversion, and count against the 5-per-10-minute",
          "signup rate limit.",
          "",
          "Fix one of these:",
          "  • Point at a staging/preview deploy that sets ALLOW_E2E_SEED=1, or",
          "  • Re-run with AGENT_TESTER_READ_ONLY=1 to explore without writing.",
        ].join("\n")
      )
    }

    return { baseURL, bypassActive: true, writesAllowed: true, notes }
  } finally {
    await api.dispose()
  }
}
