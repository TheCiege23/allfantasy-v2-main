/**
 * Chop alerts (2026-10-29): the words of the two Guilly alerts a manager gets on their phone, by email
 * and in the bell. Pure, so the tests read exactly what is sent; ./chopAlerts.ts sends them.
 *
 *  - The chop-zone warning, about a day before the week's last game, to each team the chop would take
 *    (or nearly take) if the week ended now — while there is still time to act — and again, once, to a
 *    team that slips into the zone later in that day.
 *  - The chop itself, once, to every team that was alive this week: the chopped team is told it is
 *    out, the rest are told who went and when those players reach waivers.
 */

type ChopAlert = { title: string; body: string; severity: 'medium' | 'high' }

const points = (n: number) => {
  const r = Math.round(n * 10) / 10
  return `${r} ${r === 1 ? 'point' : 'points'}`
}

function names(list: readonly string[]): string {
  if (list.length <= 1) return list[0] ?? 'A team'
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`
}

/** When the chopped teams' players can be claimed, in the league's own release setting. */
function releaseWhen(rosterReleaseTiming: string | null | undefined): string {
  return rosterReleaseTiming === 'immediate' ? 'are free agents now' : 'hit waivers at the next waiver run'
}

/**
 * "week 4", or "weeks 3–4" when the chop week closes an MLB two-week period (./eliminationPeriods.ts):
 * the period's score is both weeks added, so naming one week would be wrong. Absent or 1: one week.
 */
function span(week: number, periodWeeks?: number): string {
  const n = Math.max(1, periodWeeks ?? 1)
  return n > 1 ? `weeks ${week - n + 1}–${week}` : `week ${week}`
}

/**
 * The warning. `margin` is the team's points above the chop line (0 or less when it is in the chop
 * zone itself), so a danger-zone team is told how little stands between it and the chop.
 */
export function chopZoneWarning(args: {
  leagueName: string
  week: number
  status: 'chopped' | 'danger'
  margin: number | null
  /** A later warning: the team was safer at the first one and has slipped since (./chopAlerts.ts). */
  late?: boolean
  /** A best ball league (./guillotineBestBall.ts): there is no lineup to check, so the advice differs. */
  bestBall?: boolean
  /** Weeks per elimination period; `week` is the period's last week. Absent = 1. */
  periodWeeks?: number
}): ChopAlert {
  const when = span(args.week, args.periodWeeks)
  const advice = args.bestBall
    ? 'Your best lineup is picked for you, so the last games are what can save you.'
    : 'Check your lineup before the last games.'
  if (args.status === 'chopped') {
    return {
      title: args.late ? `🪓 You've dropped into the chop zone — ${args.leagueName}` : `🪓 You're in the chop zone — ${args.leagueName}`,
      body: `${args.late ? 'Other scores have passed yours. ' : ''}If ${when} ended now, your team would be chopped. ${advice}`,
      severity: 'high',
    }
  }
  const gap = args.margin != null && args.margin > 0 ? ` Only ${points(args.margin)} above the chop line.` : ''
  return {
    title: args.late ? `⚠️ You've slipped into the danger zone — ${args.leagueName}` : `⚠️ You're in the danger zone — ${args.leagueName}`,
    body: `Your team is ${args.late ? 'now ' : ''}close to the chop in ${when}.${gap} ${advice}`,
    severity: 'medium',
  }
}

/** The chop. `choppedNames` are the teams chopped this week; `youWereChopped` picks the version. */
export function chopResultAlert(args: {
  leagueName: string
  week: number
  choppedNames: readonly string[]
  youWereChopped: boolean
  rosterReleaseTiming: string | null | undefined
  /** Weeks per elimination period; `week` is the period's last week. Absent = 1. */
  periodWeeks?: number
}): ChopAlert {
  const when = span(args.week, args.periodWeeks)
  if (args.youWereChopped) {
    return {
      title: `🪓 You've been chopped — ${args.leagueName}`,
      body: `Your team had the lowest score ${(args.periodWeeks ?? 1) > 1 ? `over ${when}` : `in ${when}`} and is out. You can still follow the league to the end.`,
      severity: 'high',
    }
  }
  const one = args.choppedNames.length === 1
  return {
    title: `You survived ${when} — ${args.leagueName}`,
    body: `${names(args.choppedNames)} ${one ? 'was' : 'were'} chopped. Their players ${releaseWhen(args.rosterReleaseTiming)}.`,
    severity: 'medium',
  }
}
