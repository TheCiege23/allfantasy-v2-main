/** Read explicit format settings. A league's name never proves its lineup rules. */
export function isBestBallSettings(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const settings = value as Record<string, unknown>
  const raw = settings.raw_settings as Record<string, unknown> | undefined
  const nested = settings.settings as Record<string, unknown> | undefined
  const flag = settings.best_ball ?? settings.bestBall ?? raw?.best_ball ?? nested?.best_ball
  return flag === 1 || flag === true || flag === '1'
}
