/**
 * worldCupAiUsageLimits.ts
 *
 * Unified daily cap & tier resolution for all World Cup generative AI features.
 *
 * This is the single source of truth for:
 *   - Mapping what the call site already knows (isAdmin + hasPro) → CapTier
 *   - WC-specific friendly error / upgrade messages per feature + tier
 *   - Thin wrappers over dailyCaps.ts with WC context baked in
 *
 * Design rules:
 *   - Deterministic AI (bracket grade, leaderboard insights, path to win,
 *     win probability math) is ALWAYS free — do NOT route through this helper.
 *   - Only LLM/generative calls use cap tracking.
 *   - Fail-open: if DB is unavailable, the call is allowed (inherits from dailyCaps.ts).
 *   - Never throw — every exported function is safe to call without try/catch.
 *
 * Tier mapping (avoids an extra DB round-trip):
 *   isAdmin → 'admin'  (75 Chimmy / 20 explain / 20 brain / 200 matchup per day)
 *   hasPro  → 'pro'    (30 Chimmy / 5 explain / 5 brain / 25 matchup per day)
 *   neither → 'free'   (3 Chimmy / 1 explain / 0 brain / 3 matchup per day)
 *
 * Callers already have isAdmin and hasPro from prior gate checks, so no
 * additional DB query is needed.
 */
import 'server-only'

import {
  checkDailyCap,
  incrementDailyCap,
  type DailyCapResult,
  type CapTier,
} from '@/lib/ai/dailyCaps'
import { isAdminEmailAllowed } from '@/lib/adminAuth'
import { userHasBracketBrainAi } from '@/lib/bracket-brain/bracketBrainAccess'

// ── Types ─────────────────────────────────────────────────────────────────────

/** All WC AI features that have per-user daily caps. */
type WcAiCapFeature =
  | 'chimmy'
  | 'explain_bracket'
  | 'commissioner_brain'
  | 'wc_matchup_narrative'

// ── Tier resolution ───────────────────────────────────────────────────────────

/**
 * Derive a 3-tier AI cap from what call sites already know.
 * Avoids an extra DB round-trip since callers already have both booleans.
 */
export function resolveWcCapTier(opts: {
  /** True if the user is a platform admin (from getWorldCupAdminState or isAdminEmailAllowed). */
  isAdmin: boolean
  /** True if userHasBracketBrainAi returned true (Pro / Commissioner / All-Access / Supreme). */
  hasPro: boolean
}): CapTier {
  if (opts.isAdmin) return 'admin'
  if (opts.hasPro) return 'pro'
  return 'free'
}

/**
 * Convenience: resolve the WC cap tier from a user ID + email directly.
 * Useful in routes that don't already have both booleans.
 * Adds ~1 DB query (same as userHasBracketBrainAi).
 */
export async function resolveWcCapTierForUser(
  userId: string,
  email: string | null | undefined
): Promise<CapTier> {
  const isAdmin = Boolean(email && isAdminEmailAllowed(email))
  if (isAdmin) return 'admin'
  const hasPro = await userHasBracketBrainAi(userId, email ?? null)
  return hasPro ? 'pro' : 'free'
}

// ── Upgrade messages ──────────────────────────────────────────────────────────

/** WC-specific copy shown to the user when a cap is hit. */
const WC_UPGRADE_MESSAGES: Record<WcAiCapFeature, Record<CapTier, string>> = {
  chimmy: {
    free:  "You've used today's 3 Chimmy questions. Upgrade to AF Pro for 30 per day.",
    pro:   "You've used today's 30 Chimmy questions. They reset at midnight UTC.",
    admin: "You've used today's Chimmy questions. They reset at midnight UTC.",
  },
  explain_bracket: {
    free:  "Bracket explanations require AF Pro. Upgrade to get daily AI bracket breakdowns.",
    pro:   "You've used today's bracket explanation. It resets at midnight UTC.",
    admin: "You've reached today's bracket explanation limit. Resets at midnight UTC.",
  },
  commissioner_brain: {
    free:  "Commissioner Brain requires AF Commissioner or higher.",
    pro:   "You've used today's Commissioner Brain calls. They reset at midnight UTC.",
    admin: "You've used today's Commissioner Brain calls. Resets at midnight UTC.",
  },
  wc_matchup_narrative: {
    free:  "AI Matchup Intelligence requires AF Pro.",
    pro:   "You've used today's 25 AI matchup analyses. They reset at midnight UTC.",
    admin: "You've reached today's matchup AI limit. Resets at midnight UTC.",
  },
}

/** Upgrade path URL — deep-links to pricing with WC source context. */
const WC_UPGRADE_PATHS: Record<WcAiCapFeature, Record<CapTier, string>> = {
  chimmy:               { free: '/pricing?from=wc-chimmy',     pro: '/pricing', admin: '/pricing' },
  explain_bracket:      { free: '/pricing?from=wc-explain',    pro: '/pricing', admin: '/pricing' },
  commissioner_brain:   { free: '/pricing?from=wc-brain',      pro: '/pricing', admin: '/pricing' },
  wc_matchup_narrative: { free: '/pricing?from=wc-matchup-ai', pro: '/pricing', admin: '/pricing' },
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Check whether the user may make one more generative AI call for a WC feature.
 * Returns a DailyCapResult with WC-specific message and upgradePath.
 * Never throws — fails open on DB error (same as dailyCaps.ts).
 */
export async function checkWcAiCap(
  feature: WcAiCapFeature,
  userId: string,
  tier: CapTier
): Promise<DailyCapResult> {
  const result = await checkDailyCap(feature, userId, tier)

  if (!result.allowed) {
    return {
      ...result,
      message: WC_UPGRADE_MESSAGES[feature][tier],
      upgradePath: WC_UPGRADE_PATHS[feature][tier],
    }
  }

  return result
}

/**
 * Increment the daily counter for a WC AI feature after a successful generative call.
 * Call this ONLY when the LLM was actually invoked (generative: true).
 * Never throws.
 */
export async function incrementWcAiCap(
  feature: WcAiCapFeature,
  userId: string,
  tier: CapTier
): Promise<void> {
  return incrementDailyCap(feature, userId, tier)
}

/**
 * Returns the friendly upgrade message for a given feature + tier.
 * Useful for building client-facing error bodies without calling checkWcAiCap.
 */
export function getWcUpgradeMessage(
  feature: WcAiCapFeature,
  tier: CapTier
): string {
  return WC_UPGRADE_MESSAGES[feature][tier]
}
