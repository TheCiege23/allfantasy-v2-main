/**
 * AF Projections — rescore a stored snapshot under a specific league's IDP rules.
 *
 * WHY THIS EXISTS. `AFProjectionSnapshot` has no `scoringPresetId` and its unique key is
 * `playerId|season|week|eventId`, so it physically holds ONE scoring format per player. The
 * writer stores a canonical `balanced` IDP projection. That is correct for a balanced league
 * and materially wrong for anyone else: a linebacker projected at 9.06 tackles is worth ~9
 * points under `balanced` (solo 1.0 / assist 0.5) and roughly double that under a
 * tackle-heavy setup. Sleeper shows top LBs at 18-20 for exactly this reason.
 *
 * Rather than migrate to per-preset rows, the writer persists the component AMOUNTS in
 * `adjustmentFactors.idp.componentAmounts`, and this rescores them at read time under
 * whatever rules the caller's league actually uses. No migration, no second write, and a
 * league's own settings always win.
 *
 * Pure: rules in, points out. Returns null whenever it cannot do better than the stored
 * value, so the caller falls back rather than substituting a worse number.
 */

import { scoreIdpComponents, type IdpComponent } from './idpScoring'
import type { IdpScoringBreakdown } from './types'

/** The subset of `adjustmentFactors` this needs. Everything is optional — it is stored JSON. */
export interface StoredProjectionFactors {
  basis?: unknown
  idpPreset?: unknown
  idp?: { componentAmounts?: Record<string, number> | null } | null
}

export interface RescoreResult {
  points: number
  /** Components that carried a rule in this league. */
  scoredComponents: string[]
  /** Present in the projection but unscored by this league — named, never silently dropped. */
  unscoredComponents: string[]
  /** The preset the stored value was computed under, for provenance. */
  storedPreset: string | null
}

function isIdpComponentKey(key: string): key is IdpComponent {
  return [
    'soloTackle', 'assistTackle', 'sack', 'interception', 'passDefended', 'forcedFumble',
    'fumbleRecovery', 'tackleForLoss', 'qbHit', 'defensiveTd', 'safety', 'blockedKick',
    'sackYards', 'intReturnYards', 'fumbleReturnYards',
  ].includes(key)
}

/**
 * Rescore a stored IDP projection under `leagueIdpRules`.
 *
 * Returns null when:
 *  - the snapshot carries no component amounts (older rows, or a non-IDP basis), or
 *  - the league supplies no IDP rules, or
 *  - nothing in the projection is scoreable by this league.
 *
 * A null is not a failure — it means the stored value stands, which is the honest outcome
 * when there is no better information.
 */
export function rescoreIdpForLeague(
  factors: StoredProjectionFactors | null | undefined,
  leagueIdpRules: Record<string, number> | null | undefined,
): RescoreResult | null {
  if (!factors || !leagueIdpRules) return null

  const amounts = factors.idp?.componentAmounts
  if (!amounts || typeof amounts !== 'object') return null

  const components: Partial<Record<IdpComponent, number>> = {}
  for (const [key, value] of Object.entries(amounts)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    if (!isIdpComponentKey(key)) continue
    components[key] = value
  }
  if (Object.keys(components).length === 0) return null

  // `combinedTackles` is deliberately NOT passed: the stored amounts already resolved the
  // solo/assist split (really or by the measured prior), and re-applying it here would
  // double-count tackles.
  const scored: IdpScoringBreakdown | null = scoreIdpComponents({
    components,
    rules: leagueIdpRules,
  })
  if (!scored) return null

  return {
    points: scored.points,
    scoredComponents: scored.scoredComponents,
    unscoredComponents: scored.unscoredComponents,
    storedPreset: typeof factors.idpPreset === 'string' ? factors.idpPreset : null,
  }
}
