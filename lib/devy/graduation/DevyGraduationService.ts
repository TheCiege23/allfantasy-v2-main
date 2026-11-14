/**
 * Devy graduation / promotion service. PROMPT 2/6.
 * Deterministic: when a college player is drafted to the pros (or marked graduated), they are "promoted".
 * Max yearly promotions can be enforced by config.
 */

import { prisma } from '@/lib/prisma'
import { getDevyConfig } from '../DevyLeagueConfig'

export interface PromotionCheckResult {
  canPromote: boolean
  reason?: string
  promotionsUsed?: number
  maxPromotions?: number | null
}

/**
 * Check if a league can promote one more devy player this year (when maxYearlyDevyPromotions is set).
 * Returns canPromote and optional counts. Does not query DevyPlayer; caller provides current count if needed.
 */
export async function checkPromotionLimit(args: {
  leagueId: string
  seasonYear: number
  promotionsThisYear?: number
}): Promise<PromotionCheckResult> {
  const config = await getDevyConfig(args.leagueId)
  if (!config) return { canPromote: false, reason: 'Not a devy league' }

  const max = config.maxYearlyDevyPromotions
  if (max == null) return { canPromote: true }

  const used = args.promotionsThisYear ?? 0
  if (used >= max) {
    return {
      canPromote: false,
      reason: `Max yearly devy promotions (${max}) reached.`,
      promotionsUsed: used,
      maxPromotions: max,
    }
  }
  return {
    canPromote: true,
    promotionsUsed: used,
    maxPromotions: max,
  }
}

/**
 * Mark a devy player as graduated (NFL: graduatedToNFL; NBA: would need graduatedToNBA if we add NcaabDevyPlayer).
 * This is a thin wrapper; actual DevyPlayer update lives in admin/devy-graduate or equivalent.
 */
export async function markDevyPlayerGraduated(args: {
  playerId: string
  sport: string
  graduatedToPro: boolean
}): Promise<{ ok: boolean; error?: string; updated?: number }> {
  const { playerId, sport, graduatedToPro } = args
  const s = String(sport).toUpperCase()
  if (s === 'NFL') {
    await prisma.devyPlayer.updateMany({
      where: { id: playerId },
      data: { graduatedToNFL: graduatedToPro },
    })
    return { ok: true }
  }
  if (s === 'NBA') {
    const nbaResult = await prisma.devyPlayer.updateMany({
      where: { id: playerId },
      data: { devyEligible: false },
    })
    return { ok: true, updated: nbaResult.count }
  }
  return { ok: false, error: 'Sport does not have devy graduation' }
}
