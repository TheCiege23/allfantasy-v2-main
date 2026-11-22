import { normalizeToSupportedSport } from '@/lib/sport-scope'

/** Fractions of the post-fee pot (must sum ≤ 1 when ultimate survivor is off; ultimate uses survivorBonus slice). */
type ZombiePayoutTierRates = {
  weeklyPayoutRate: number
  seasonPayoutRate: number
  survivorBonusRate: number
  commissionerFeeRate: number
}

const TIER_DEFAULTS: Record<string, ZombiePayoutTierRates> = {
  Alpha: {
    weeklyPayoutRate: 0.28,
    seasonPayoutRate: 0.52,
    survivorBonusRate: 0.12,
    commissionerFeeRate: 0.08,
  },
  Beta: {
    weeklyPayoutRate: 0.3,
    seasonPayoutRate: 0.55,
    survivorBonusRate: 0.1,
    commissionerFeeRate: 0.05,
  },
  Gamma: {
    weeklyPayoutRate: 0.32,
    seasonPayoutRate: 0.53,
    survivorBonusRate: 0.1,
    commissionerFeeRate: 0.05,
  },
}

/**
 * Defaults for paid Zombie leagues by universe tier label (Alpha / Beta / Gamma).
 * Single-league / unknown tier uses Gamma-shaped defaults.
 */
export function getDefaultPayoutRatesForTierLabel(tierLabel: string | null | undefined): ZombiePayoutTierRates {
  const key = String(tierLabel ?? '')
    .trim()
    .replace(/^tier\s*/i, '')
  const cap = key.charAt(0).toUpperCase() + key.slice(1).toLowerCase()
  if (cap === 'Alpha' || cap === 'Beta' || cap === 'Gamma') {
    return { ...TIER_DEFAULTS[cap] }
  }
  return { ...TIER_DEFAULTS.Gamma }
}

/** Optional sport hint for copy only — rates stay tier-based. */
export function describePayoutTierContext(sport: string | undefined): string {
  const s = normalizeToSupportedSport(sport ?? 'NFL')
  return `Tier defaults apply across all Zombie sports (${s} shown as primary). Adjust if your house rules differ.`
}
