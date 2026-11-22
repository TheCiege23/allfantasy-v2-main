import "server-only"
import Stripe from "stripe"

/**
 * Does THIS service's Stripe secret key still work? One read-only call (GET /v1/account).
 *
 * 🛑 WHY THIS EXISTS: ON 2026-11-16 THE LIVE KEY HAD EXPIRED AND CHECKOUT HAD BEEN DOWN FOR
 * ROUGHLY A MONTH WITH NOTHING SAYING SO. Every buy button failed, yet webhooks still verified
 * (signature checking needs no API call), and the admin Provider Health row read "configured"
 * because it only asks whether STRIPE_SECRET_KEY is SET — a check that cannot fail on an expired
 * key. The only signal that matters is Stripe accepting the key, so that is what this asks.
 *
 * Three outcomes, and the split is what keeps the daily alert worth reading:
 *   ok           Stripe accepted the key and the account can take payments.
 *   problem      Definitive — the key is missing, expired, revoked or invalid; a test key is
 *                running in production; or Stripe has disabled charges. The owner is emailed.
 *   inconclusive Stripe could not be reached or answered 5xx/429. Says nothing about the key,
 *                so the run goes red but nobody is emailed about a blip.
 *
 * Never returns, logs or throws the key. `mode` is derived from its prefix alone.
 */

export type StripeKeyMode = "live" | "test" | "restricted-live" | "restricted-test" | "unrecognised" | "unset"

export type StripeKeyHealth =
  | { state: "ok"; mode: StripeKeyMode; accountId: string | null; note?: string }
  | { state: "problem"; mode: StripeKeyMode; reason: string }
  | { state: "inconclusive"; mode: StripeKeyMode; reason: string }

type AccountReader = { accounts: { retrieve: () => Promise<Partial<Stripe.Account>> } }

export function stripeKeyMode(key: string | undefined): StripeKeyMode {
  const k = key?.trim() ?? ""
  if (!k) return "unset"
  if (k.startsWith("sk_live_")) return "live"
  if (k.startsWith("sk_test_")) return "test"
  if (k.startsWith("rk_live_")) return "restricted-live"
  if (k.startsWith("rk_test_")) return "restricted-test"
  return "unrecognised"
}

export async function checkStripeKeyHealth(opts?: {
  env?: NodeJS.ProcessEnv
  makeClient?: (key: string) => AccountReader
}): Promise<StripeKeyHealth> {
  const env = opts?.env ?? process.env
  const key = env.STRIPE_SECRET_KEY?.trim() ?? ""
  const mode = stripeKeyMode(key)

  if (!key) return { state: "problem", mode, reason: "STRIPE_SECRET_KEY is not set, so checkout cannot start." }
  if (env.NODE_ENV === "production" && (mode === "test" || mode === "restricted-test")) {
    return {
      state: "problem",
      mode,
      reason: "A TEST-mode Stripe key is set in production, so no real payment can be taken.",
    }
  }

  const client =
    opts?.makeClient?.(key) ??
    (new Stripe(key, { apiVersion: "2026-02-25.clover", maxNetworkRetries: 1, timeout: 15_000 }) as unknown as AccountReader)

  try {
    const account = await client.accounts.retrieve()
    if (account.charges_enabled === false) {
      const why = account.requirements?.disabled_reason
      return {
        state: "problem",
        mode,
        reason: `The key works, but Stripe has disabled charges on the account${why ? ` (${why})` : ""}.`,
      }
    }
    return { state: "ok", mode, accountId: typeof account.id === "string" ? account.id : null }
  } catch (error) {
    return classifyStripeError(error, mode)
  }
}

function classifyStripeError(error: unknown, mode: StripeKeyMode): StripeKeyHealth {
  const e = (error ?? {}) as { type?: unknown; code?: unknown; statusCode?: unknown }
  const type = typeof e.type === "string" ? e.type : ""
  const code = typeof e.code === "string" ? e.code : ""
  const status = typeof e.statusCode === "number" ? e.statusCode : null

  if (type === "StripeAuthenticationError" || status === 401) {
    const what =
      code === "api_key_expired"
        ? "has EXPIRED"
        : "was rejected by Stripe (invalid or revoked)"
    return { state: "problem", mode, reason: `The Stripe secret key ${what}, so checkout is failing.` }
  }
  /*
   * A restricted key without "read account" permission still AUTHENTICATED — Stripe only
   * checks permissions after it has accepted the key. That is a working key, not an outage.
   */
  if (type === "StripePermissionError" || status === 403) {
    return { state: "ok", mode, accountId: null, note: "Restricted key: accepted, but cannot read the account." }
  }
  return {
    state: "inconclusive",
    mode,
    reason: `Could not reach Stripe (${type || "error"}${status ? ` ${status}` : ""}); says nothing about the key.`,
  }
}
