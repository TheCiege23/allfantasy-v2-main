/**
 * Position-cohort priors for IDP regression.
 *
 * ⚠ THE POINT OF THIS FILE IS THAT THE NUMBERS ARE NOT IN IT. A sack rate written as a
 * constant is an invented number wearing a decimal point, and it silently encodes whatever
 * season the author happened to remember. These priors are computed from the same observed
 * game logs the projection is drawn from, so they describe this data.
 *
 * Pure: no prisma, no fetch, no clock.
 */

import { extractIdpComponents, type IdpComponent } from '@/lib/af-projections/idpScoring'
import type { CohortPriors, IdpGameObservation, IdpStatKey, IdpStatLine } from './types'

/** Same inverse mapping the projector uses; kept local to each module's direction of travel. */
const COMPONENT_TO_KEY: Partial<Record<IdpComponent, IdpStatKey>> = {
  soloTackle: 'idp_tkl_solo',
  assistTackle: 'idp_tkl_ast',
  sack: 'idp_sack',
  interception: 'idp_int',
  passDefended: 'idp_pass_def',
  forcedFumble: 'idp_ff',
  fumbleRecovery: 'idp_fum_rec',
  tackleForLoss: 'idp_tkl_loss',
  qbHit: 'idp_qb_hit',
  defensiveTd: 'idp_def_td',
  safety: 'idp_safe',
}

/**
 * Below this many player-games the cohort mean is itself noise, and regressing toward it
 * would launder one small sample through another. The caller gets null and must say the
 * regression did not run rather than quietly skipping it.
 */
export const MIN_COHORT_GAMES = 40

export interface CohortMember {
  position: string | null | undefined
  history: readonly IdpGameObservation[]
}

/**
 * Per-game component means for one position group.
 *
 * Returns null when the cohort is too thin to be worth regressing toward — see
 * `MIN_COHORT_GAMES`. A null here is a real answer, not a failure.
 */
export function deriveCohortPriors(
  position: string,
  members: readonly CohortMember[],
  minCohortGames: number = MIN_COHORT_GAMES,
): CohortPriors | null {
  const wanted = position.trim().toUpperCase()
  const totals = new Map<IdpStatKey, number>()
  let games = 0

  for (const m of members) {
    if (String(m.position ?? '').trim().toUpperCase() !== wanted) continue
    for (const g of m.history) {
      games++
      const { components, combinedTackles } = extractIdpComponents(g.statMap, 'sleeper_weekly')
      const resolved: Partial<Record<IdpComponent, number>> = { ...components }
      if (
        combinedTackles != null &&
        combinedTackles > 0 &&
        resolved.soloTackle == null &&
        resolved.assistTackle == null
      ) {
        resolved.soloTackle = combinedTackles
      }
      for (const [component, amount] of Object.entries(resolved) as Array<[IdpComponent, number]>) {
        const key = COMPONENT_TO_KEY[component]
        if (!key || typeof amount !== 'number' || !Number.isFinite(amount)) continue
        totals.set(key, (totals.get(key) ?? 0) + amount)
      }
    }
  }

  if (games < minCohortGames) return null

  /*
   * The denominator is EVERY game in the cohort, not just the games in which the component
   * appeared. A sack rate computed only over games containing a sack is a per-sack-game rate
   * — it cannot go below one and it would inflate every pass rusher in the pool.
   */
  const perGame: IdpStatLine = {}
  for (const [key, total] of totals) {
    const mean = total / games
    if (mean > 0) perGame[key] = Math.round(mean * 10000) / 10000
  }

  return { position: wanted, perGame, sampleGames: games }
}
