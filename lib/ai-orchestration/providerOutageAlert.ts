import 'server-only'

import { sendNotificationEmail } from '@/lib/resend-client'
import { OWNER_EMAIL } from '@/lib/notifications/notifyOwnerOfNewSignup'
import { redactAndCap } from '@/lib/security/redactSecrets'

/*
 * 🛑 AN AI OUTAGE LOOKED LIKE A STUPID ASSISTANT, AND NOBODY WAS TOLD.
 *
 * Measured 2026-09-20 and again 2026-09-22 with a 1-token completion per account:
 *
 *   OpenAI    429 billing_not_active   "Your account is not active"
 *   xAI       403 permission-denied    "used all available credits or reached its monthly spending limit"
 *   DeepSeek  200                      the only provider answering, on a ~$10 balance
 *
 * xAI is the ONLY provider the Chimmy tool loop and the live web search can use, so both had
 * been silently returning null — Chimmy kept answering through DeepSeek, without tools, and
 * nothing anywhere said a provider was down. When the last one fails, every answer degrades to
 * the "AI explanation is temporarily unavailable" fallback, which reads as a bad answer rather
 * than as an outage. The only detector was a human reading the reply.
 *
 * ⚠ A SET KEY IS NOT A FUNDED ACCOUNT. `[ProviderConfig] openai: set` in the boot log, and a
 * 200 from a models / api-key endpoint, are both true of a dead account. Only a failed
 * completion carries the billing error, which is why this listens to call failures.
 *
 * Email is the channel because it is the one that reaches the owner today: the Sentry server
 * config is not loaded in production, and the telemetry tables built for this are not written.
 * Every email is throttled per key, so an outage costs one message per window, not one per chat.
 */

export type ProviderFailureKind = 'billing' | 'auth' | 'other'

/** One email per provider+kind per window — an entitlement failure does not fix itself in minutes. */
const ENTITLEMENT_ALERT_WINDOW_MS = 6 * 60 * 60 * 1000
/** Shorter: every AI answer on the platform is degraded while this is true. */
const ALL_DOWN_ALERT_WINDOW_MS = 60 * 60 * 1000

const BILLING_PATTERN =
  /billing_not_active|account is not active|insufficient_quota|exceeded your current quota|used all available credits|spending limit|insufficient (?:balance|credits?|funds)|payment required/i
const AUTH_PATTERN = /invalid[_ ]api[_ ]key|incorrect api key|invalid authentication|unauthori[sz]ed|no api key/i

/**
 * Is this a failure a human has to fix (billing, credentials), or a transient one (timeout,
 * rate limit, bad response) that retrying or the next provider absorbs?
 *
 * Billing is tested first because xAI reports exhausted credits as a 403 `permission-denied`,
 * which would otherwise read as a credential problem and send the owner to rotate a key that
 * is perfectly valid.
 */
export function classifyProviderFailure(status: number | string | null | undefined, detail: string | null | undefined): ProviderFailureKind {
  const text = String(detail ?? '')
  const code = typeof status === 'number' ? status : Number.parseInt(String(status ?? ''), 10)
  if (code === 402 || BILLING_PATTERN.test(text)) return 'billing'
  if (code === 401 || AUTH_PATTERN.test(text)) return 'auth'
  return 'other'
}

const lastSentAt = new Map<string, number>()

function shouldSend(key: string, windowMs: number, now: number): boolean {
  const prev = lastSentAt.get(key)
  if (prev != null && now - prev < windowMs) return false
  lastSentAt.set(key, now)
  return true
}

type AlertSender = (subject: string, bodyHtml: string) => Promise<unknown>
let testSender: AlertSender | null = null

function sendOwnerAlert(subject: string, lines: string[]): void {
  /*
   * 🛑 NEVER FROM A TEST RUN. Importing `@prisma/client` loads `.env`, which in this repo is
   * PRODUCTION — so a suite that makes every provider fail would otherwise send the owner a
   * real outage email. Tests that want to see the email install a sender explicitly.
   */
  if (!testSender && process.env.VITEST) return
  const send: AlertSender =
    testSender ?? ((s, bodyHtml) => sendNotificationEmail({ to: OWNER_EMAIL, subject: s, bodyHtml }))
  /*
   * Fire-and-forget: an alert must never delay, fail or reshape the answer it is about.
   * The try covers a SYNCHRONOUS throw too, which `.catch` alone does not.
   */
  const warn = (err: unknown) =>
    console.warn('[AIProviderOutage] alert email failed:', redactAndCap(err instanceof Error ? err.message : err, 200))
  try {
    void send(subject, lines.join('. ') + '.').catch(warn)
  } catch (err) {
    warn(err)
  }
}

/**
 * Report one provider call that failed. Only billing and credential failures alert; they are
 * logged every time (cheap, greppable in Railway) and emailed at most once per window.
 */
export function reportProviderFailure(args: {
  provider: string
  status?: number | string | null
  detail?: string | null
  /** Where the call came from, e.g. `chimmy_tool_loop`, `chimmy_live_search`, `chimmy_chat`. */
  surface: string
  now?: number
}): ProviderFailureKind {
  const kind = classifyProviderFailure(args.status, args.detail)
  if (kind === 'other') return kind
  const detail = redactAndCap(args.detail ?? '', 240)
  console.error(
    `[AIProviderOutage] provider=${args.provider} kind=${kind} surface=${args.surface} status=${args.status ?? '?'} detail=${detail}`,
  )
  if (shouldSend(`entitlement:${args.provider}:${kind}`, ENTITLEMENT_ALERT_WINDOW_MS, args.now ?? Date.now())) {
    sendOwnerAlert(`AllFantasy: AI provider ${args.provider} is failing (${kind})`, [
      `The ${args.provider} API rejected a request with a ${kind === 'billing' ? 'billing / credit' : 'credential'} error, so every feature that depends on it is not working`,
      `Surface: ${args.surface}`,
      `Provider response: ${detail || '(none)'}`,
      kind === 'billing'
        ? 'Fix: add credits or raise the spending limit on that provider account. Rotating the key will not help'
        : 'Fix: check the API key configured in production for that provider',
      `You will not get another alert for this for ${ENTITLEMENT_ALERT_WINDOW_MS / 3_600_000} hours`,
    ])
  }
  return kind
}

/**
 * Report that NO provider answered, so the user got the deterministic fallback instead of an
 * AI answer. Always logged; emailed at most once per window.
 */
export function reportAllProvidersDown(args: {
  featureKey: string
  /** `before_execution`: nothing was available to call. `all_calls_failed`: every call errored. */
  stage: 'before_execution' | 'all_calls_failed'
  failures: Array<{ provider: string; detail?: string | null }>
  now?: number
}): void {
  const summary = args.failures
    .map((f) => `${f.provider}: ${redactAndCap(f.detail ?? 'no detail', 160) || 'no detail'}`)
    .join('; ')
  console.error(`[AIProviderOutage] ALL PROVIDERS DOWN feature=${args.featureKey} stage=${args.stage} ${summary}`)
  if (shouldSend('all_down', ALL_DOWN_ALERT_WINDOW_MS, args.now ?? Date.now())) {
    sendOwnerAlert('AllFantasy: ALL AI providers are down — Chimmy is not answering', [
      'Every configured AI provider failed on a user request, so Chimmy replied with the deterministic fallback ("AI explanation is temporarily unavailable") instead of an answer',
      `Feature: ${args.featureKey}. Stage: ${args.stage === 'before_execution' ? 'no provider was available to call' : 'every provider call failed'}`,
      `Providers: ${summary || '(none listed)'}`,
      'Fix: check billing on the OpenAI, xAI and DeepSeek accounts. A key being set does not mean the account can answer',
      `You will not get another alert for this for ${ALL_DOWN_ALERT_WINDOW_MS / 3_600_000} hour`,
    ])
  }
}

/**
 * Test seam: the throttle is module state and would otherwise leak between tests, and the
 * sender is how a test observes an email without one ever being sent.
 */
export function __resetProviderOutageAlertsForTests(sender: AlertSender | null = null): void {
  lastSentAt.clear()
  testSender = sender
}
