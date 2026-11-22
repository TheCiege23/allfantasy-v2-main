/**
 * Specialty concept hooks — deterministic adjustments only (no AI).
 * Extend per concept without separate scoring engines.
 */
import { parseSettingsSnapshot } from '@/lib/league-contract/types'

type ConceptAdjustmentContext = {
  leagueId: string
  leagueVariant: string | null
  week: number
  season: number
  rosterId: string
  basePoints: number
  settingsJson: unknown
}

/**
 * Apply concept-specific weekly score adjustments (e.g. Guillotine survivor week, Big Brother twists).
 * Defaults to identity.
 */
export function applyConceptWeeklyPoints(ctx: ConceptAdjustmentContext): number {
  const snap = parseSettingsSnapshot(ctx.settingsJson)
  const rules = snap?.conceptRules
  const ext = rules && typeof rules === 'object' ? (rules as { extensions?: Record<string, unknown> }).extensions : undefined

  const variant = (ctx.leagueVariant ?? '').toLowerCase()
  if (variant.includes('big_brother') && ext && typeof ext === 'object') {
    const bbMult = (ext as Record<string, unknown>).weeklyScoreMultiplier
    if (typeof bbMult === 'number' && Number.isFinite(bbMult) && bbMult > 0) {
      return Math.round(ctx.basePoints * bbMult * 100) / 100
    }
  }

  return ctx.basePoints
}
