/** A league-relative noise floor: changing scoring units must not change odds. */
export function historicalScoringSpread(values: readonly number[]): number {
  if (!values.length) return 1e-6
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length
  const variance = values.length > 1 ? values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1) : 0
  return Math.max(1e-6, Math.abs(mean) * .1, Math.sqrt(variance))
}
