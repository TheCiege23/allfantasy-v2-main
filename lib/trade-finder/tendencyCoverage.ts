/**
 * What a matchmaking ranking was actually able to use.
 *
 * Four of the five partner-scoring dimensions -- bias alignment, trade frequency,
 * overpay willingness, and part of need overlap -- come from `TradePreAnalysisCache`.
 * When that cache is cold the engine still returns a confident-looking ordered list,
 * ranked on roster overlap alone. Those two outputs are indistinguishable to a caller
 * unless the difference is stated, which is the same failure as a "C" trade grade
 * that means "no data" rather than "average".
 *
 * This is a pure function so the distinction is testable without standing up a league.
 */
export type TendencyState = 'ready' | 'warming' | 'unavailable'

export type TendencyCoverage = {
  state: TendencyState
  detail: string
  managersWithTendencies: number
  managersEvaluated: number
}

export function resolveTendencyCoverage(args: {
  managersWithTendencies: number
  managersEvaluated: number
  /** True when a background pre-analysis run was started for this request. */
  warmStarted: boolean
  /** True when the lookup itself threw rather than simply finding nothing. */
  lookupFailed?: boolean
}): TendencyCoverage {
  const { managersWithTendencies, managersEvaluated, warmStarted, lookupFailed } = args
  const base = { managersWithTendencies, managersEvaluated }

  if (lookupFailed) {
    return {
      ...base,
      state: 'unavailable',
      detail: 'Ranked on roster fit only — manager tendency data could not be loaded.',
    }
  }

  if (managersWithTendencies > 0) {
    return {
      ...base,
      state: 'ready',
      detail: 'Ranked on roster fit and manager tendencies.',
    }
  }

  if (warmStarted) {
    return {
      ...base,
      state: 'warming',
      detail:
        'Ranked on roster fit only — manager tendencies are still being computed. Re-run in a minute for the full read.',
    }
  }

  return {
    ...base,
    state: 'unavailable',
    detail: 'Ranked on roster fit only — manager tendencies have not been computed for this league.',
  }
}
