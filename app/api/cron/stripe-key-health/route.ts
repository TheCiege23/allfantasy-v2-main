import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/app/api/cron/_auth"
import { checkStripeKeyHealth, type StripeKeyHealth } from "@/lib/billing/stripeKeyHealth"
import { sendNotificationEmail } from "@/lib/resend-client"
import { OWNER_EMAIL } from "@/lib/notifications/notifyOwnerOfNewSignup"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * Daily: are the Stripe keys that take payments still accepted? (lib/billing/stripeKeyHealth.ts)
 *
 * 🛑 THE CRON RUNS ON THE WORKER, BUT THE KEY THAT TAKES PAYMENTS IS THE WEB SERVICE'S. The
 * slow tier calls `${APP_URL}` — `allfantasy-v2-worker` — and checkout runs on
 * `allfantasy-v2-main`. Each holds its own STRIPE_SECRET_KEY, set by hand, so a check of the
 * worker's own key would go green while the web's had expired, which is the exact outage this
 * exists for. So the worker checks itself AND asks the web service to check ITS key, through
 * this same route with `?scope=self`.
 *
 * Outcomes: 200 when every key is fine. 503 otherwise, so the Actions run goes red. The owner is
 * emailed only for a DEFINITIVE problem (missing/expired/invalid key, test key in production,
 * charges disabled, or the web refusing the check) — never for a Stripe or network blip.
 * Daily cadence means one email a day while it stays broken, which is the point.
 */

const DEFAULT_WEB_ORIGIN = "https://www.allfantasy.ai"
const WEB_SERVICE_NAME = "allfantasy-v2-main"
const PEER_TIMEOUT_MS = 20_000

type ServiceResult = { service: string; health: StripeKeyHealth }

function thisService(): string {
  return process.env.RAILWAY_SERVICE_NAME?.trim() || "this service"
}

async function checkWebService(): Promise<ServiceResult | null> {
  // Running on the web service itself (or a single-service setup): its own check already covers it.
  if (process.env.RAILWAY_SERVICE_NAME?.trim() === WEB_SERVICE_NAME) return null

  const origin = (process.env.STRIPE_KEY_HEALTH_WEB_ORIGIN?.trim() || DEFAULT_WEB_ORIGIN).replace(/\/+$/, "")
  const secret = process.env.CRON_SECRET?.trim()
  const service = WEB_SERVICE_NAME
  const mode = "unrecognised" as const
  if (!secret) {
    return { service, health: { state: "inconclusive", mode, reason: "CRON_SECRET is not set here, so the web service could not be asked." } }
  }

  let res: Response
  try {
    res = await fetch(`${origin}/api/cron/stripe-key-health?scope=self`, {
      headers: { authorization: `Bearer ${secret}` },
      cache: "no-store",
      signal: AbortSignal.timeout(PEER_TIMEOUT_MS),
    })
  } catch {
    return { service, health: { state: "inconclusive", mode, reason: "The web service did not answer in time." } }
  }

  if (res.status === 401) {
    return {
      service,
      health: {
        state: "problem",
        mode,
        reason: "The web service refused the check (401): CRON_SECRET differs between the worker and the web service, so the web's Stripe key is NOT being monitored.",
      },
    }
  }
  if (!res.ok) {
    return { service, health: { state: "inconclusive", mode, reason: `The web service answered HTTP ${res.status}.` } }
  }
  const body = (await res.json().catch(() => null)) as { health?: StripeKeyHealth } | null
  if (!body?.health?.state) {
    return { service, health: { state: "inconclusive", mode, reason: "The web service's answer could not be read." } }
  }
  return { service, health: body.health }
}

function buildEmail(results: ServiceResult[]): { subject: string; bodyHtml: string } {
  const problems = results.filter((r) => r.health.state === "problem")
  const lines = problems.map((r) => `${r.service}: ${"reason" in r.health ? r.health.reason : ""}`)
  return {
    subject: "⚠ Stripe key problem: AllFantasy checkout may be down",
    bodyHtml: [
      "The daily Stripe key check found a problem.",
      ...lines,
      "To fix: Stripe Dashboard, Developers, API keys (live mode). Use a working secret key with NO expiry, and set it as STRIPE_SECRET_KEY on Railway for allfantasy-v2-main, allfantasy-v2-worker and allfantasy-cron. Saving a variable redeploys the service.",
      "This email repeats daily until the check passes.",
    ].join("<br><br>"),
  }
}

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req, "CRON_SECRET")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const self: ServiceResult = { service: thisService(), health: await checkStripeKeyHealth() }

  // The web service's half of the check: report only, never email (the worker's run does that).
  if (req.nextUrl.searchParams.get("scope") === "self") {
    return NextResponse.json(self, { status: 200 })
  }

  const web = await checkWebService()
  const results = web ? [self, web] : [self]
  const hasProblem = results.some((r) => r.health.state === "problem")
  const allOk = results.every((r) => r.health.state === "ok")

  let emailed: { ok: boolean; error?: string } | null = null
  if (hasProblem) {
    const { subject, bodyHtml } = buildEmail(results)
    emailed = await sendNotificationEmail({ to: OWNER_EMAIL, subject, bodyHtml }).catch((err: unknown) => ({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }))
    console.error("[stripe-key-health] problem found", results.map((r) => ({ service: r.service, state: r.health.state, mode: r.health.mode })))
  }

  return NextResponse.json(
    { ok: allOk, results, ...(emailed ? { emailed: emailed.ok, emailError: emailed.error ?? null } : {}) },
    { status: allOk ? 200 : 503 },
  )
}
