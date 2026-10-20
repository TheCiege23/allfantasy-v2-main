/**
 * Lineup lock policy (approximation until live schedules are wired per player).
 *
 * Industry patterns:
 * - **NFL / NCAAF**: Weekly lineups; platforms typically lock each player at kickoff (Sleeper default)
 *   or the full lineup at the first game.
 * - **NBA / MLB / NHL**: Daily — lock at start of the scoring slate (first tip / first pitch).
 * - **Soccer**: Matchday — lock at kickoff.
 *
 * Implementation uses **Eastern Time** cutoffs without full schedule data.
 */
import { toZonedTime } from 'date-fns-tz'

const ET = 'America/New_York'

export type LineupLockResult = {
  locked: boolean
  reason?: string
  policy: 'view_only_past' | 'future_week' | 'football_weekly' | 'daily_slate' | 'daily_per_player' | 'soccer_matchday'
}

function wallET(d: Date): Date {
  return toZonedTime(d, ET)
}

/**
 * NFL/NCAAF current week:
 * - Wed–Sat: unlocked (typical lineup prep for Sunday).
 * - Sun before 1:00 PM ET: unlocked.
 * - Sun after 1:00 PM ET, Mon, Tue: locked (games / post-game window).
 * - Thu night: locked after ~8:15 PM ET (TNF).
 */
function footballWeeklyLock(now: Date): LineupLockResult {
  const et = wallET(now)
  const day = et.getDay()
  const hour = et.getHours()
  const minute = et.getMinutes()

  if (day >= 3 && day <= 6) {
    return { locked: false, policy: 'football_weekly' }
  }

  if (day === 4 && (hour > 20 || (hour === 20 && minute >= 15))) {
    return {
      locked: true,
      reason: 'Thursday night lineup is locked after kickoff (approx. 8:15 PM ET).',
      policy: 'football_weekly',
    }
  }

  if (day === 0 && hour < 13) {
    return { locked: false, policy: 'football_weekly' }
  }

  if (day === 0 && (hour > 13 || (hour === 13 && minute >= 0))) {
    return {
      locked: true,
      reason: 'Weekly lineup is locked after Sunday 1:00 PM ET kickoff window.',
      policy: 'football_weekly',
    }
  }

  if (day === 1 || day === 2) {
    return {
      locked: true,
      reason: 'Lineups stay locked Mon–Tue during the active NFL/NCAAF week.',
      policy: 'football_weekly',
    }
  }

  return { locked: false, policy: 'football_weekly' }
}

function dailySportLock(now: Date): LineupLockResult {
  const et = wallET(now)
  if (et.getHours() >= 18) {
    return {
      locked: true,
      reason: 'Daily lineups lock after 6:00 PM ET (first games of the night).',
      policy: 'daily_slate',
    }
  }
  return { locked: false, policy: 'daily_slate' }
}

function soccerLock(now: Date): LineupLockResult {
  const et = wallET(now)
  const day = et.getDay()
  if ((day === 6 || day === 0) && et.getHours() >= 11) {
    return {
      locked: true,
      reason: 'Matchday lineups lock after 11:00 AM ET (approximate kickoff window).',
      policy: 'soccer_matchday',
    }
  }
  return { locked: false, policy: 'soccer_matchday' }
}

export function evaluateLineupLock(args: {
  sport: string
  now: Date
  leagueWeek: number
  editingWeek: number
  /**
   * The league keeps lineups per day (`isDailyLineupScoringEnabled`). Then there is no whole-lineup
   * window: each player locks at his own game start for the rest of that day, from the schedule
   * (`hydrateRedraftLineupLocks` in `daily` mode). The 6 PM ET guess below froze players in late
   * West Coast games before they played, and left afternoon games open after they started.
   */
  dailyLineups?: boolean
}): LineupLockResult {
  const { sport, now, leagueWeek, editingWeek } = args
  const u = sport.toUpperCase()

  if (editingWeek < leagueWeek) {
    return {
      locked: true,
      reason: 'Past weeks are view-only.',
      policy: 'view_only_past',
    }
  }

  if (editingWeek > leagueWeek) {
    return { locked: false, policy: 'future_week' }
  }

  if (u === 'NFL' || u === 'NCAAF') {
    return footballWeeklyLock(now)
  }
  if (u === 'NBA' || u === 'NCAAB' || u === 'MLB' || u === 'NHL') {
    if (args.dailyLineups) return { locked: false, policy: 'daily_per_player' }
    return dailySportLock(now)
  }
  if (u === 'SOCCER') {
    return soccerLock(now)
  }

  return footballWeeklyLock(now)
}

export function describeLockPolicySummary(sport: string): string {
  const u = sport.toUpperCase()
  if (u === 'NFL' || u === 'NCAAF') {
    return 'Weekly: locks Sun 1:00 PM ET onward and Mon–Tue; Thu night after ~8:15 PM ET; open Wed–Sat for prep.'
  }
  if (u === 'NBA' || u === 'NCAAB' || u === 'MLB' || u === 'NHL') {
    return 'Daily: locks after 6:00 PM ET until the next calendar day.'
  }
  if (u === 'SOCCER') {
    return 'Weekend matchdays: locks from 11:00 AM ET (approximate).'
  }
  return 'Lineups lock around game time for the active scoring period.'
}
