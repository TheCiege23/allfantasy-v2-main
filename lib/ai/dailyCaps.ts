/**
 * Per-user, per-feature daily AI usage caps.
 *
 * Reuses the existing ApiRateLimitRecord table (daily window, no migration needed).
 * Fail-open: if DB is unavailable, the call is allowed so users aren't blocked.
 */
import 'server-only'

import { createHash } from 'node:crypto'

import { prisma } from '@/lib/prisma'
import { getAiDailyCaps } from '@/lib/ai/aiConfig'

// ── Cap limits ────────────────────────────────────────────────────────────────

export type CapFeature = 'chimmy' | 'explain_bracket' | 'commissioner_brain' | 'wc_matchup_narrative'
export type CapTier = 'free' | 'pro' | 'admin'

// Computed at module load from env vars — server restart picks up changes.
// Env vars: AI_CAP_{FREE|PRO|ADMIN}_{CHIMMY|EXPLAIN|COMMISSIONER_BRAIN|WC_MATCHUP}_DAILY
const _caps = getAiDailyCaps()
export const DAILY_CAP_LIMITS: Record<CapFeature, Record<CapTier, number>> = {
  chimmy:               { free: _caps.free.chimmy,               pro: _caps.pro.chimmy,               admin: _caps.admin.chimmy               },
  explain_bracket:      { free: _caps.free.explain_bracket,      pro: _caps.pro.explain_bracket,      admin: _caps.admin.explain_bracket      },
  commissioner_brain:   { free: _caps.free.commissioner_brain,   pro: _caps.pro.commissioner_brain,   admin: _caps.admin.commissioner_brain   },
  wc_matchup_narrative: { free: _caps.free.wc_matchup_narrative, pro: _caps.pro.wc_matchup_narrative, admin: _caps.admin.wc_matchup_narrative },
}

export interface DailyCapResult {
  allowed: boolean
  used: number
  limit: number
  resetsAt: Date
  /** Friendly message to surface when cap is exceeded */
  message: string
  /** Signals the UI to show an upgrade CTA when the cap is hit */
  upgradePath: string
}

// ── Internal helpers ──────────────────────────────────────────────────────────

const CAP_PROVIDER = 'ai_daily'

function hashUserId(userId: string): string {
  return createHash('sha256').update(userId).digest('hex').slice(0, 20)
}

function buildEndpoint(feature: CapFeature, userId: string): string {
  return `${feature}:${hashUserId(userId)}`
}

function startOfUtcDay(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

function endOfUtcDay(d = new Date()): Date {
  return new Date(startOfUtcDay(d).getTime() + 24 * 60 * 60 * 1000)
}

function capExceededMessage(feature: CapFeature): string {
  if (feature === 'explain_bracket') {
    return "You've reached today's bracket explanation limit. Try again tomorrow or upgrade for more Chimmy help."
  }
  if (feature === 'commissioner_brain') {
    return "You've reached today's Commissioner Brain limit. Try again tomorrow or upgrade for more Chimmy help."
  }
  if (feature === 'wc_matchup_narrative') {
    return "You've reached today's matchup Chimmy limit. Try again tomorrow or upgrade for more Chimmy help."
  }
  return "You've reached today's Chimmy limit. Try again tomorrow or upgrade for more Chimmy help."
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Check whether a user may make one more AI call for the given feature.
 * Never throws — returns allowed:true on DB error.
 */
export async function checkDailyCap(
  feature: CapFeature,
  userId: string,
  tier: CapTier
): Promise<DailyCapResult> {
  const limit = DAILY_CAP_LIMITS[feature][tier]
  const now = new Date()
  const windowStart = startOfUtcDay(now)
  const windowEnd = endOfUtcDay(now)

  // A limit of 0 means the feature is not available for this tier.
  if (limit === 0) {
    return {
      allowed: false,
      used: 0,
      limit: 0,
      resetsAt: windowEnd,
      message: capExceededMessage(feature),
      upgradePath: '/pricing',
    }
  }

  try {
    const record = await prisma.apiRateLimitRecord.findFirst({
      where: {
        provider: CAP_PROVIDER,
        endpoint: buildEndpoint(feature, userId),
        windowStart,
        windowEnd,
      },
      select: { callsMade: true },
    })

    const used = record?.callsMade ?? 0
    return {
      allowed: used < limit,
      used,
      limit,
      resetsAt: windowEnd,
      message: capExceededMessage(feature),
      upgradePath: '/pricing',
    }
  } catch {
    // Fail open so a DB hiccup never blocks users.
    return { allowed: true, used: 0, limit, resetsAt: windowEnd, message: '', upgradePath: '/pricing' }
  }
}

/**
 * Increment the daily cap counter for a user after a successful AI call.
 * Never throws.
 */
export async function incrementDailyCap(
  feature: CapFeature,
  userId: string,
  tier: CapTier
): Promise<void> {
  const limit = DAILY_CAP_LIMITS[feature][tier]
  const now = new Date()
  const windowStart = startOfUtcDay(now)
  const windowEnd = endOfUtcDay(now)
  const endpoint = buildEndpoint(feature, userId)

  try {
    await prisma.apiRateLimitRecord.upsert({
      where: {
        uniq_api_rate_limits_window: {
          provider: CAP_PROVIDER,
          endpoint,
          windowStart,
          windowEnd,
        },
      },
      update: { callsMade: { increment: 1 }, callsLimit: limit },
      create: {
        provider: CAP_PROVIDER,
        endpoint,
        callsMade: 1,
        callsLimit: limit,
        windowStart,
        windowEnd,
      },
    })
  } catch {
    // Never fail the user path because quota logging had an issue.
  }
}
