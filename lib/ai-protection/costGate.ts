/**
 * One gate for every route that spends money per call (an LLM, text-to-speech, Grok).
 *
 * 🛑 WHY THIS EXISTS: on 2026-09-24 an audit found ~25 routes that called a paid model with
 * nothing but sign-in in front of them — some not even that — while their siblings
 * (/api/trade-evaluator, /api/chimmy) were plan-gated. The worst: /api/mock-draft/ai-pick
 * called Grok on EVERY pick of a mock draft, ~180 calls per draft.
 *
 * Every route answers the same four questions, in this order:
 *   1. Who is asking?      Signed in, or — only for a feature that is free — anonymous by IP.
 *   2. Too fast?           A per-minute burst limit (in-process; resets on deploy, fine for bursts).
 *   3. Paid feature?       From PAYWALL launch (lib/monetization/paywallLaunch.ts) a feature
 *                          marked `paidFromLaunch` needs its plan. BEFORE launch it stays open —
 *                          the paywall starts Oct 15, not the day a cap shipped.
 *   4. Used enough today?  A DURABLE per-day cap (ApiRateLimitRecord via consumeDailyLimit), so
 *                          a deploy or a second instance cannot reset what money was spent.
 *
 * The limits are in AI_COST_GATES below and nowhere else. They are deliberately conservative
 * starting points; tune them here.
 *
 * Fail-open on the daily counter only: if the DB is unreachable the call is allowed and
 * logged. A counter outage must not take every AI feature down with it. The plan check
 * fails CLOSED after launch (no plan resolved = no access), matching the rest of the app.
 */
import 'server-only'

import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'

import { consumeRateLimit, getClientIp } from '@/lib/rate-limit'
import { consumeDailyLimit } from '@/lib/rate-limit-daily'
import { buildAiLimit429 } from '@/lib/ai-protection/withAiProtection'
import { FeatureGateService, type FeatureGateDecision } from '@/lib/subscription/FeatureGateService'
import type { SubscriptionFeatureId } from '@/lib/subscription/types'
import { isPaywallLive } from '@/lib/monetization/paywallLaunch'

export type AiCostGateConfig = {
  /** Shown to people in limit messages. */
  label: string
  /** The plan feature that unlocks full use. Omit for features that stay free. */
  featureId?: SubscriptionFeatureId
  /** From paywall launch, refuse (403) a signed-in caller without `featureId`. */
  paidFromLaunch: boolean
  /** Requests per minute per caller. */
  perMinute: number
  /** Calls per UTC day for a signed-in caller without the plan. null = no daily cap. */
  dailyFree: number | null
  /** Calls per UTC day for a plan holder. */
  dailyPaid: number | null
  /**
   * Signed-out callers allowed (keyed by IP) up to this many a day — ONLY while the feature
   * is free. Once a `paidFromLaunch` feature is live, a signed-out caller must sign in:
   * otherwise an anonymous visitor would get more than a free account.
   */
  dailyAnonymous?: number
}

export const AI_COST_GATES = {
  // ── Pro: player tools ────────────────────────────────────────────────────────
  chimmy_voice: { label: 'Chimmy voice', featureId: 'ai_chat', paidFromLaunch: true, perMinute: 10, dailyFree: 20, dailyPaid: 200 },
  legacy_chat: { label: 'Chimmy chat', featureId: 'ai_chat', paidFromLaunch: true, perMinute: 10, dailyFree: 20, dailyPaid: 100, dailyAnonymous: 5 },
  start_sit_ai: { label: 'start/sit analysis', featureId: 'pro_start_sit', paidFromLaunch: true, perMinute: 10, dailyFree: 20, dailyPaid: 200 },
  trade_ai: { label: 'AI trade analysis', featureId: 'trade_analyzer', paidFromLaunch: true, perMinute: 10, dailyFree: 15, dailyPaid: 200 },
  // /api/trade-finder never required sign-in; a small anonymous allowance keeps any logged-out
  // use working until launch, after which it needs an account and the plan like its siblings.
  trade_finder: { label: 'Trade Finder', featureId: 'trade_analyzer', paidFromLaunch: true, perMinute: 5, dailyFree: 10, dailyPaid: 100, dailyAnonymous: 3 },
  draft_ai: { label: 'draft help', featureId: 'pro_draft_ai', paidFromLaunch: true, perMinute: 10, dailyFree: 20, dailyPaid: 300 },
  /**
   * The Trade Center's written "why". SOFT: callers use evaluateAiCostGate and fall back to the
   * deterministic verdict instead of refusing — free users keep the grade, Pro gets the AI
   * (owner's decision 2026-09-24).
   */
  trade_center_ai: { label: 'trade write-ups', featureId: 'trade_analyzer', paidFromLaunch: true, perMinute: 20, dailyFree: 30, dailyPaid: 300, dailyAnonymous: 10 },

  // ── Commissioner ─────────────────────────────────────────────────────────────
  weekly_recap_ai: { label: 'AI weekly recaps', featureId: 'commissioner_ai_recap', paidFromLaunch: true, perMinute: 5, dailyFree: 5, dailyPaid: 50 },
  // Matches the sibling /api/{idp,devy}/ai, which require commissioner_ai_tools.
  league_format_ai: { label: 'devy & IDP analysis', featureId: 'commissioner_ai_tools', paidFromLaunch: true, perMinute: 10, dailyFree: 20, dailyPaid: 200 },

  // ── Free forever, capped ─────────────────────────────────────────────────────
  // A logged-out acquisition tool: stays public, capped per IP.
  instant_trade: { label: 'instant trade checks', paidFromLaunch: false, perMinute: 10, dailyFree: 20, dailyPaid: 20, dailyAnonymous: 5 },
  // Shared career cards bring people in — never paywalled, only capped.
  share_copy: { label: 'share captions', paidFromLaunch: false, perMinute: 5, dailyFree: 20, dailyPaid: 20 },
  /*
   * Mock drafts are free (the draft room is free). Only the model calls inside them are capped.
   * ai-pick's per-pick actions get a burst limit and no daily cap — a daily count there would
   * cut a 180-pick mock off mid-draft; its Grok cost is bounded by the per-player news cache in
   * that route instead. The one per-pick action that calls OpenAI, the suggestion shown on YOUR
   * pick, has its own daily cap.
   */
  mock_ai_pick: { label: 'mock draft picks', paidFromLaunch: false, perMinute: 240, dailyFree: null, dailyPaid: null },
  mock_ai_suggestion: { label: 'mock draft suggestions', featureId: 'pro_draft_ai', paidFromLaunch: false, perMinute: 30, dailyFree: 150, dailyPaid: 1000 },
  mock_simulate: { label: 'mock draft simulations', paidFromLaunch: false, perMinute: 5, dailyFree: 20, dailyPaid: 20 },
  mock_trade_ai: { label: 'mock draft trade analysis', paidFromLaunch: false, perMinute: 10, dailyFree: 40, dailyPaid: 40 },
  mock_needs_ai: { label: 'mock draft needs analysis', paidFromLaunch: false, perMinute: 10, dailyFree: 60, dailyPaid: 60 },
  mock_weekly_ai: { label: 'mock draft weekly updates', paidFromLaunch: false, perMinute: 5, dailyFree: 10, dailyPaid: 10 },
} as const satisfies Record<string, AiCostGateConfig>

export type AiCostGateKey = keyof typeof AI_COST_GATES

export type AiCostGateOutcome =
  | { ok: true; hasPlan: boolean; anonymous: boolean }
  | {
      ok: false
      reason: 'sign_in' | 'rate' | 'plan' | 'daily'
      response: NextResponse
    }

function hashSubject(subject: string): string {
  return createHash('sha256').update(subject).digest('hex').slice(0, 24)
}

function signInResponse(label: string): NextResponse {
  return NextResponse.json(
    { error: 'Sign in required', code: 'sign_in_required', message: `Sign in to use ${label}.` },
    { status: 401 },
  )
}

/** Same shape as lib/subscription/entitlement-middleware.ts, so existing upgrade UI handles it. */
function lockedResponse(decision: FeatureGateDecision): NextResponse {
  return NextResponse.json(
    {
      error: 'Premium feature',
      code: 'feature_not_entitled',
      message: decision.message,
      requiredPlan: decision.requiredPlan,
      upgradePath: decision.upgradePath,
    },
    { status: 403 },
  )
}

async function resolvePlan(
  userId: string,
  featureId: SubscriptionFeatureId,
  email: string | null | undefined,
): Promise<FeatureGateDecision | null> {
  try {
    return await new FeatureGateService().evaluateUserFeatureAccess(userId, featureId, email)
  } catch (error) {
    console.error('[ai-cost-gate] plan check failed; treating as no plan', error)
    return null
  }
}

/**
 * Decide whether this call may spend money. Use this when the route has a free fallback (the
 * Trade Center's deterministic verdict); use `aiCostGate` when refusing is the right answer.
 */
export async function evaluateAiCostGate(
  req: Request,
  key: AiCostGateKey,
  userId: string | null | undefined,
  opts: { email?: string | null; now?: Date } = {},
): Promise<AiCostGateOutcome> {
  const cfg: AiCostGateConfig = AI_COST_GATES[key]
  const now = opts.now ?? new Date()
  const live = isPaywallLive(now)
  const ip = getClientIp(req)
  const signedIn = typeof userId === 'string' && userId.trim().length > 0

  // 1. Who is asking.
  const anonymousAllowed =
    cfg.dailyAnonymous != null && cfg.dailyAnonymous > 0 && !(cfg.paidFromLaunch && live)
  if (!signedIn && !anonymousAllowed) {
    return { ok: false, reason: 'sign_in', response: signInResponse(cfg.label) }
  }
  const subject = signedIn ? `user:${userId}` : `ip:${ip}`

  // 2. Burst limit.
  const burst = consumeRateLimit({
    scope: 'ai_cost',
    action: key,
    sleeperUsername: subject,
    ip,
    maxRequests: cfg.perMinute,
    windowMs: 60_000,
    includeIpInKey: false,
  })
  if (!burst.success) {
    return {
      ok: false,
      reason: 'rate',
      response: buildAiLimit429({
        message: `Too many requests for ${cfg.label}. Please wait a moment and try again.`,
        retryAfterSec: burst.retryAfterSec,
        remaining: burst.remaining,
        resetTimeMs: burst.resetTimeMs,
      }),
    }
  }

  // 3. Plan.
  let hasPlan = false
  let decision: FeatureGateDecision | null = null
  if (signedIn && cfg.featureId) {
    decision = await resolvePlan(userId as string, cfg.featureId, opts.email)
    hasPlan = decision?.allowed === true
  }
  if (cfg.paidFromLaunch && live && !hasPlan) {
    if (!decision) {
      return {
        ok: false,
        reason: 'plan',
        response: NextResponse.json(
          { error: 'Premium feature', code: 'feature_not_entitled', message: `${cfg.label} is part of a paid plan.`, upgradePath: '/pricing' },
          { status: 403 },
        ),
      }
    }
    return { ok: false, reason: 'plan', response: lockedResponse(decision) }
  }

  // 4. Daily cap.
  const dailyLimit = !signedIn ? cfg.dailyAnonymous ?? null : hasPlan ? cfg.dailyPaid : cfg.dailyFree
  if (dailyLimit != null) {
    try {
      const daily = await consumeDailyLimit({
        provider: 'ai_cost_gate',
        endpoint: `${key}:${hashSubject(subject)}`,
        callsLimit: dailyLimit,
      })
      if (!daily.success) {
        const upgrade = !hasPlan && cfg.featureId ? ' Upgrade for a higher daily limit.' : ''
        const body = {
          error: 'Daily limit reached',
          code: 'daily_limit_reached',
          message: `You've reached today's limit for ${cfg.label}. It resets at midnight UTC.${upgrade}`,
          limit: dailyLimit,
          retryAfterSec: daily.retryAfterSec,
          upgradePath: !hasPlan && cfg.featureId ? '/pricing' : null,
          useDeterministicFallback: true,
        }
        return {
          ok: false,
          reason: 'daily',
          response: NextResponse.json(body, {
            status: 429,
            headers: { 'Retry-After': String(Math.max(1, daily.retryAfterSec)) },
          }),
        }
      }
    } catch (error) {
      console.error(`[ai-cost-gate] daily counter unavailable for ${key}; allowing the call`, error)
    }
  }

  return { ok: true, hasPlan, anonymous: !signedIn }
}

/** Returns a response to send back when the call must not proceed, or null to go ahead. */
export async function aiCostGate(
  req: Request,
  key: AiCostGateKey,
  userId: string | null | undefined,
  opts: { email?: string | null; now?: Date } = {},
): Promise<NextResponse | null> {
  const outcome = await evaluateAiCostGate(req, key, userId, opts)
  return outcome.ok ? null : outcome.response
}
