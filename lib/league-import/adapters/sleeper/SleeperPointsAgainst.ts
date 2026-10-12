import type { SleeperRosterRaw } from './types'

/** Preserve missing totals; decimal fields are hundredths, as documented by Sleeper. */
export function sleeperPointsAgainst(settings: SleeperRosterRaw['settings']): number | undefined {
  const whole = settings?.fpts_against
  const decimal = settings?.fpts_against_decimal ?? 0
  return typeof whole === 'number' && Number.isFinite(whole) && Number.isFinite(decimal)
    ? whole + decimal / 100
    : undefined
}
