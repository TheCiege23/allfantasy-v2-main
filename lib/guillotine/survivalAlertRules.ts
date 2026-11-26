/**
 * Live danger alerts (owner's "fun" list, 2026-11-25; the idea is Yahoo's): tell a manager when their chance of
 * surviving the week falls low, while there is still a week to do something about it, and once more if they
 * climb back out.
 *
 * WHY ODDS AND NOT THE STANDINGS. The warning that already existed (./chopAlerts.ts) reads the standings "if
 * the week ended now", which only means something near the end of the week: on a Sunday morning half the
 * league has not played and "last place" is whoever kicks off latest. So it runs only in the last day. This
 * one reads each team's chance of NOT being chopped (./survivalOutlook.ts), which already counts the games each
 * team still has to play, and so it can speak earlier. It stops when the last day starts and the standings
 * warning takes over, so no team hears both about the same hour.
 *
 * AT MOST TWO A WEEK FOR ANY TEAM, and each kind at most once:
 *   - `at_risk`    the chance to survive is at or below 35%;
 *   - `recovered`  a team that was told it was at risk is back at or above 65%.
 * The gap between the two numbers is deliberate: a team hovering around one line would otherwise flip in and
 * out all afternoon. A team that recovers and falls again is not told a second time.
 *
 * Pure. The sender is ./survivalAlerts.ts.
 */

export const AT_RISK_AT_OR_BELOW_PCT = 35
export const RECOVERED_AT_OR_ABOVE_PCT = 65

export type SurvivalAlertLevel = 'at_risk' | 'recovered'

/** Which alerts are due now, given each team's chance (0-100) and what it has already been sent this week. */
export function survivalAlertsDue(
  odds: ReadonlyMap<string, number>,
  sent: ReadonlyMap<string, ReadonlyArray<SurvivalAlertLevel>>,
): Array<{ rosterId: string; level: SurvivalAlertLevel; safePct: number }> {
  const due: Array<{ rosterId: string; level: SurvivalAlertLevel; safePct: number }> = []
  for (const [rosterId, safePct] of odds) {
    const had = sent.get(rosterId) ?? []
    if (!had.includes('at_risk')) {
      if (safePct <= AT_RISK_AT_OR_BELOW_PCT) due.push({ rosterId, level: 'at_risk', safePct })
      continue
    }
    if (!had.includes('recovered') && safePct >= RECOVERED_AT_OR_ABOVE_PCT) due.push({ rosterId, level: 'recovered', safePct })
  }
  return due.sort((a, b) => a.safePct - b.safePct || a.rosterId.localeCompare(b.rosterId))
}

/** The words. `startersLeft`: how many of the team's starters still have a game to play this week. */
export function survivalAlertCopy(args: {
  leagueName: string
  week: number
  level: SurvivalAlertLevel
  safePct: number
  startersLeft: number | null
  /** A best ball league sets its own lineup, so there is no lineup to change. */
  bestBall?: boolean
}): { title: string; body: string; severity: 'low' | 'medium' } {
  const left =
    args.startersLeft == null
      ? ''
      : args.startersLeft === 0
        ? ' None of your starters has a game left.'
        : ` ${args.startersLeft} of your starters ${args.startersLeft === 1 ? 'still has' : 'still have'} a game to play.`
  if (args.level === 'recovered') {
    return {
      title: `Back out of danger in ${args.leagueName}`,
      body: `Your chance of surviving week ${args.week} is back up to ${args.safePct}%.${left}`,
      severity: 'low',
    }
  }
  const act = args.bestBall || args.startersLeft === 0 ? '' : ' Check your lineup while there is time.'
  return {
    title: `You are in danger in ${args.leagueName}`,
    body: `Your chance of surviving week ${args.week} is down to ${args.safePct}%.${left}${act}`,
    severity: 'medium',
  }
}
