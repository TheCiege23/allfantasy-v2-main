/**
 * The refusals for scripts/prove-purchase-path.ts, kept pure so they are tested
 * (__tests__/prove-purchase-path-guards.test.ts). The script spends nothing and must never be able
 * to: it runs against a Stripe SANDBOX and the TEST database, and every one of these checks is a way
 * it could silently reach production instead.
 */

/**
 * The production Neon endpoint. `.env` and `.env.local` BOTH point here — .env.local pairs a
 * test-mode Stripe key with the production database — so the database is taken from `.env.test`
 * alone and this host is refused outright.
 */
export const PRODUCTION_DB_HOST_MARKERS = ['ep-curly-block'] as const

/**
 * Anything that would send something real during a proof run: the Meta Conversions API Purchase
 * event fired on checkout (NOT reversible — it trains the ad optimiser), email, SMS, chat
 * webhooks and analytics. Set EMPTY before any import, because `@prisma/client` loads the
 * production `.env` on import and dotenv fills in only what is not already set.
 */
export const OUTBOUND_ENV_KEYS = [
  'META_CONVERSIONS_API_TOKEN',
  'META_PIXEL_ID',
  'NEXT_PUBLIC_META_PIXEL_ID',
  'META_TEST_EVENT_CODE',
  'RESEND_API_KEY',
  'SENDGRID_API_KEY',
  'POSTMARK_API_TOKEN',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_API_KEY',
  'TWILIO_API_SECRET',
  'SLACK_WEBHOOK_URL',
  'DISCORD_WEBHOOK_URL',
  'DISCORD_BOT_TOKEN',
  'POSTHOG_API_KEY',
  'NEXT_PUBLIC_POSTHOG_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'XAI_API_KEY',
] as const

export function dbHost(url: string | null | undefined): string | null {
  if (!url) return null
  const withoutScheme = url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
  const at = withoutScheme.lastIndexOf('@')
  const rest = at >= 0 ? withoutScheme.slice(at + 1) : withoutScheme
  const host = rest.split(/[/?:]/)[0]?.trim()
  return host || null
}

export function refuseUnlessSafe(input: {
  stripeSecretKey: string | null | undefined
  databaseUrl: string | null | undefined
}): string | null {
  const key = input.stripeSecretKey?.trim() ?? ''
  if (!key) return 'No Stripe key found. Pass --stripe-env pointing at a file with a sandbox (sk_test_) STRIPE_SECRET_KEY.'
  if (!key.startsWith('sk_test_')) {
    return 'REFUSING: the Stripe key is not a test-mode key (sk_test_). This script never runs against live Stripe.'
  }
  const host = dbHost(input.databaseUrl)
  if (!host) return 'No DATABASE_URL found. Pass --db-env pointing at .env.test.'
  if (PRODUCTION_DB_HOST_MARKERS.some((marker) => host.includes(marker))) {
    return `REFUSING: DATABASE_URL points at the production database (${host}). Use .env.test.`
  }
  return null
}

/** Parses a dotenv file's KEY=value lines — only the keys asked for, nothing else is read out. */
export function pickEnv(text: string, keys: readonly string[]): Record<string, string> {
  const wanted = new Set(keys)
  const out: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (!m || !wanted.has(m[1]!)) continue
    out[m[1]!] = m[2]!.trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1')
  }
  return out
}
