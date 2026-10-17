/** Defaults are useful for a new league, but they are not evidence of imported provider rules. */
export function hasVerifiedBestBallRuleConfiguration(settings: unknown): boolean {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return false
  const stored = (settings as Record<string, unknown>).best_ball_settings
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return false
  const record = stored as Record<string, unknown>
  const nested = record.bestBall
  const rules = nested && typeof nested === 'object' && !Array.isArray(nested)
    ? nested as Record<string, unknown>
    : record
  return ['waiversEnabled', 'tradesEnabled', 'substitutionsEnabled']
    .every((key) => typeof rules[key] === 'boolean')
}
