import { VALUE_VERSION, type Estimate, type LeagueValueContext, type LeagueValueV2, type MarketValueSnapshotV2, type ScoringRule, type StartingSlot, type UtilityTerms, type ValueDecisionV2 } from './types'

export function validEstimate(e: Estimate | null | undefined): e is Estimate {
  return !!e && Number.isFinite(e.value) && !!e.evidence.source.trim() &&
    Number.isFinite(Date.parse(e.evidence.asOf)) &&
    (e.evidence.sampleSize === null || (Number.isInteger(e.evidence.sampleSize) && e.evidence.sampleSize >= 0)) &&
    (e.low === null || (Number.isFinite(e.low) && e.low <= e.value)) &&
    (e.high === null || (Number.isFinite(e.high) && e.high >= e.value))
}

/** Missing applicable components invalidate the total; irrelevant positions cannot earn a bonus. */
export function scoreComponents(position: string, components: Readonly<Record<string, number | null>>, rules: readonly ScoringRule[]): number | null {
  let total = 0
  for (const rule of rules) {
    if (rule.positions && !rule.positions.includes(position)) continue
    if (!Number.isFinite(rule.points)) return null
    if (rule.points === 0) continue
    const count = components[rule.stat]
    if (count == null || !Number.isFinite(count)) return null
    total += count * rule.points
  }
  return Number.isFinite(total) ? total : null
}

/** Fractional flex demand is explicit; it is not a claim about observed draft allocation. */
export function positionalDemand(position: string, slots: readonly StartingSlot[], teams: number): number | null {
  if (!Number.isInteger(teams) || teams <= 0) return null
  let demand = 0
  for (const slot of slots) {
    if (!Number.isInteger(slot.count) || slot.count < 0 || !slot.eligiblePositions.length) return null
    const eligible = [...new Set(slot.eligiblePositions)]
    if (eligible.includes(position)) demand += teams * slot.count / eligible.length
  }
  return demand
}

export function transformLeagueValue(input: {
  market: MarketValueSnapshotV2
  position: string
  components: Readonly<Record<string, number | null>>
  league: LeagueValueContext
}): LeagueValueV2 {
  const { market, league, position, components } = input
  const gaps = [...market.gaps]
  const projected = league.scoring && scoreComponents(position, components, league.scoring)
  const reference = league.referenceScoring && scoreComponents(position, components, league.referenceScoring)
  const scoringFit = projected != null && reference != null && projected >= 0 && reference > 0 ? projected / reference : null
  const demand = league.slots && positionalDemand(position, league.slots, league.teamCount)
  const referenceDemand = league.referenceSlots && league.referenceTeamCount != null
    ? positionalDemand(position, league.referenceSlots, league.referenceTeamCount) : null
  const demandFit = demand != null && referenceDemand != null && referenceDemand > 0 ? demand / referenceDemand : null
  if (market.cohort !== league.cohort) gaps.push('market_cohort_mismatch')
  if (!validEstimate(market.marketValue) || (market.marketValue?.value ?? -1) < 0) gaps.push('market_unpriced')
  if (scoringFit === null) gaps.push('scoring_components_or_reference_missing')
  if (demandFit === null) gaps.push('roster_topology_or_reference_missing')
  const factor = scoringFit !== null && demandFit !== null ? scoringFit * demandFit : null
  const leagueValue = factor !== null && Number.isFinite(factor) && validEstimate(market.marketValue) && market.marketValue.value >= 0 && market.cohort === league.cohort
    ? { value: market.marketValue.value * factor,
        low: market.marketValue.low === null ? null : market.marketValue.low * factor,
        high: market.marketValue.high === null ? null : market.marketValue.high * factor,
        evidence: { ...market.marketValue.evidence, source: `value-v2/league-transform:${market.marketValue.evidence.source}` } }
    : null
  const finiteValue = validEstimate(leagueValue) ? leagueValue : null
  if (leagueValue && !finiteValue) gaps.push('league_value_out_of_range')
  return { market, leagueId: league.leagueId, leagueValue: finiteValue, scoringFit, demandFit, gaps: [...new Set(gaps)] }
}

/** Conservative interval arithmetic; unknown bounds stay unknown. */
export function sumEstimates(terms: readonly { estimate: Estimate | null; sign: 1 | -1 }[], source: string, asOf: string): Estimate | null {
  if (!terms.length || terms.some(t => !validEstimate(t.estimate))) return null
  let value = 0, low: number | null = 0, high: number | null = 0
  for (const { estimate, sign } of terms) {
    const e = estimate!
    value += sign * e.value
    const l = sign === 1 ? e.low : e.high
    const h = sign === 1 ? e.high : e.low
    low = low === null || l === null ? null : low + sign * l
    high = high === null || h === null ? null : high + sign * h
  }
  const result = { value, low, high, evidence: { source, asOf, sampleSize: null } }
  return validEstimate(result) ? result : null
}

export function resolveUserUtility(league: LeagueValueV2, userId: string, terms: UtilityTerms): ValueDecisionV2 {
  const gaps = [...league.gaps]
  const utility = (h: 1 | 3 | 5) => {
    const result = sumEstimates([
      { estimate: league.leagueValue, sign: 1 },
      { estimate: terms.lineup, sign: 1 },
      { estimate: terms.playoffOrSurvival, sign: 1 },
      { estimate: terms.horizon[h], sign: 1 },
      { estimate: terms.rosterOption, sign: 1 },
      { estimate: terms.riskCost, sign: -1 },
    ], 'value-v2/user-utility', league.market.capturedAt)
    if (!result) gaps.push(`utility_${h}y_inputs_missing`)
    return result
  }
  return { version: VALUE_VERSION, assetId: league.market.assetId, leagueId: league.leagueId, userId,
    marketValue: league.market.marketValue, leagueValue: league.leagueValue,
    userUtility: { 1: utility(1), 3: utility(3), 5: utility(5) }, terms, gaps }
}
