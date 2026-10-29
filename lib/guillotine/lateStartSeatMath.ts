/**
 * Late-start guillotine seat math — pure, client-safe.
 *
 * Owner's rule: "Every week that passes, a manager spot is removed until full, so even in week 10 a
 * guillotine league can be started and run until the end." One chop per week, `teamsPerChop` teams
 * per chop, the last chop in `eliminationEndWeek`. A draft held during week D can only chop from
 * week D+1 (and never before the configured `eliminationStartWeek`), so:
 *
 *   firstChop = max(eliminationStartWeek, draftWeek + 1)
 *   chopWeeks = eliminationEndWeek - firstChop + 1
 *   maxTeams  = chopWeeks × teamsPerChop + 1
 *
 * The seat count a league can actually use is min(configured leagueSize, maxTeams). Below
 * {@link GUILLOTINE_MIN_TEAMS} the league cannot start.
 */

export const GUILLOTINE_MIN_TEAMS = 4

export type GuillotineChopWindow = {
  /** The fantasy week the draft falls in; 0 = before week 1. */
  draftWeek: number
  firstChopWeek: number
  chopWeeks: number
  maxTeams: number
}

/**
 * ⚠ A FINAL-STAGE ENDING NEEDS ROOM. "Final two/three/four" stops chopping at that many teams and
 * then scores `finalPeriods` (3) more weeks, all inside the end week — so the chops must be done
 * `finalPeriods` weeks earlier, and `finalists` teams are left rather than one. Counting only chop
 * weeks sized such a league with three weeks too many teams, and its final ran out of season.
 */
export function guillotineChopWindow(input: {
  eliminationStartWeek: number
  eliminationEndWeek: number
  teamsPerChop: number
  draftWeek: number
  /** The endgame (endgameRules.ts): teams left when chops stop, and the final weeks after. Default: last team standing. */
  endgame?: { threshold: number; cumulativePeriods: number }
}): GuillotineChopWindow {
  const start = Math.max(1, Math.floor(input.eliminationStartWeek || 1))
  const end = Math.floor(input.eliminationEndWeek)
  const perChop = Math.max(1, Math.floor(input.teamsPerChop || 1))
  const draftWeek = Math.max(0, Math.floor(input.draftWeek || 0))
  const finalists = Math.max(1, Math.floor(input.endgame?.threshold ?? 1))
  const finalPeriods = Math.max(0, Math.floor(input.endgame?.cumulativePeriods ?? 0))
  const firstChopWeek = Math.max(start, draftWeek + 1)
  const chopWeeks = Math.max(0, end - finalPeriods - firstChopWeek + 1)
  return { draftWeek, firstChopWeek, chopWeeks, maxTeams: chopWeeks * perChop + finalists }
}

export type GuillotineSeatDecision = {
  /** min(configured, maxTeams) — the seats the schedule supports. */
  supportedSeats: number
  /** Seats the league should hold: the supported count, but never below the claimed count. */
  seats: number
  /** Claimed seats exceed what can be eliminated by the end week; the commissioner is warned. */
  claimedExceedsSupported: boolean
  /** The supported count is under the floor of 4 and the league cannot start. */
  belowFloor: boolean
}

export function decideGuillotineSeats(input: {
  configuredSize: number
  claimed: number
  maxTeams: number
}): GuillotineSeatDecision {
  const supportedSeats = Math.max(0, Math.min(input.configuredSize, input.maxTeams))
  const seats = Math.max(supportedSeats, input.claimed)
  return {
    supportedSeats,
    seats,
    claimedExceedsSupported: input.claimed > supportedSeats,
    belowFloor: seats < GUILLOTINE_MIN_TEAMS,
  }
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/** Minutes east of UTC for `zone` at `at` (e.g. -240 for EDT). */
function zoneOffsetMinutes(zone: string, at: Date): number {
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' })
      .formatToParts(at).find((p) => p.type === 'timeZoneName')?.value ?? ''
    const m = name.match(/^GMT(?:([+-])(\d{1,2})(?::(\d{2}))?)?$/)
    if (!m) return 0
    if (!m[1]) return 0
    const minutes = Number(m[2]) * 60 + Number(m[3] ?? 0)
    return m[1] === '-' ? -minutes : minutes
  } catch {
    return 0
  }
}

/**
 * One week later, same weekday and same wall-clock time in the league's zone — so 8pm ET stays
 * 8pm ET across the November daylight-saving change rather than drifting to 7pm.
 */
export function rollDraftDateOneWeek(at: Date, zone = 'America/New_York'): Date {
  const naive = new Date(at.getTime() + WEEK_MS)
  const shift = zoneOffsetMinutes(zone, at) - zoneOffsetMinutes(zone, naive)
  return new Date(naive.getTime() + shift * 60_000)
}

/** "Mon Oct 26, 8pm ET" — the draft time as the commissioner set it, in Eastern time. */
export function formatDraftTimeEt(at: Date | string): string {
  const d = typeof at === 'string' ? new Date(at) : at
  if (Number.isNaN(d.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  }).formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  const minute = get('minute')
  const time = `${get('hour')}${minute && minute !== '00' ? `:${minute}` : ''}${get('dayPeriod').toLowerCase()}`
  return `${get('weekday')} ${get('month')} ${get('day')}, ${time} ET`
}

/** What the league page and the invite page show. Serialisable; built on the server. */
export type GuillotineSeatSummary = {
  claimed: number
  seats: number
  draftAt: string | null
  /** If the draft is not full at `draftAt`: where it moves and how many seats it drops to. */
  ifNotFull: { draftAt: string; seats: number } | null
  belowFloor: boolean
  claimedExceedsSupported: boolean
}

export function formatGuillotineSeatLine(s: GuillotineSeatSummary): string {
  if (s.belowFloor) {
    return `${s.claimed} of ${s.seats} spots filled. Too late in the season to start: a Guilly league needs at least ${GUILLOTINE_MIN_TEAMS} teams that can still be chopped.`
  }
  const head = `${s.claimed} of ${s.seats} spots filled.`
  if (!s.draftAt) return head
  const draft = ` Draft ${formatDraftTimeEt(s.draftAt)}.`
  if (s.claimed >= s.seats || !s.ifNotFull) return head + draft
  const drop = s.ifNotFull.seats < s.seats ? ` and drops to ${s.ifNotFull.seats} spots` : ''
  return `${head}${draft} If not full, it moves a week${drop}.`
}
