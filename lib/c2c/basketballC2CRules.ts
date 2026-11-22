/**
 * Basketball Campus to Canton plays one way: a set college lineup and one combined standings table (2026-11-15).
 *
 * 🛑 TWO SETTINGS COULD STOP A BASKETBALL LEAGUE SCORING. NBA campus scoring refuses to run unless college best ball
 * is off and standings are unified (lib/redraft/scoringEngine.ts, `loadBasketballCampusPoints`), but the commissioner
 * settings offered "Best ball (college)" and "Separate" / "Hybrid" standings to every C2C league. A basketball
 * commissioner who picked either stopped their own league's scores, with nothing on screen saying why.
 *
 * So the settings route refuses those values for a basketball league, and the screen only lets them be turned
 * back off — a league already stuck can still be fixed. Football is unaffected.
 *
 * Pure.
 */
export const BASKETBALL_C2C_RULE =
  'Basketball Campus to Canton scores with a set college lineup and one combined standings table, so college best ball and separate or hybrid standings are not available.'

/** The settings in a C2C settings change that would stop a basketball league scoring. */
export function basketballC2CConflicts(change: { bestBallCollege?: unknown; standingsModel?: unknown }): Array<'bestBallCollege' | 'standingsModel'> {
  const out: Array<'bestBallCollege' | 'standingsModel'> = []
  if (change.bestBallCollege === true) out.push('bestBallCollege')
  if (change.standingsModel !== undefined && change.standingsModel !== 'unified') out.push('standingsModel')
  return out
}

/** Whether a basketball league's saved settings are already the kind that stop its scoring. */
export function basketballC2CScoringBlocked(config: { bestBallCollege?: boolean | null; standingsModel?: string | null }): boolean {
  return config.bestBallCollege === true || (config.standingsModel ?? 'unified') !== 'unified'
}
