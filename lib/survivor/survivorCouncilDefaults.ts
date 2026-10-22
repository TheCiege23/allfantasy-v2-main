import { getSportSchedule } from './sportScheduleEngine'
import type { SurvivorTieRule, SurvivorVoteChangePolicy } from './survivorSettings'

/**
 * Council rules a new Survivor league starts with (owner's call, 2026-10-20): the Torch Ceremony
 * day and Eastern time the sport's schedule recommends (after the week's final scores), a one-day
 * private vote window, revote-then-rocks ties, ballots changeable until close, and missing ballots
 * auto-cast. The commissioner can change any of them before the draft.
 */
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export type SurvivorCouncilDefaults = {
  tribalCouncilDay: string
  tribalCouncilTime: string
  voteOpenOffset: number
  voteCloseOffset: number
  tieRule: SurvivorTieRule
  voteChangePolicy: SurvivorVoteChangePolicy
  nonVoterAutoCast: boolean
}

/** The schedule engine stores UTC hours; the settings screen speaks Eastern (UTC−4 in season). */
function easternTime(hourUtc: number): string {
  const hour = ((Math.round(hourUtc) - 4) % 24 + 24) % 24
  return `${String(hour).padStart(2, '0')}:00`
}

export function survivorCouncilDefaultsForSport(sport: string | null | undefined): SurvivorCouncilDefaults {
  const schedule = getSportSchedule(String(sport ?? 'NFL'))
  return {
    tribalCouncilDay: DAYS[((schedule.tribalCouncilDay % 7) + 7) % 7] ?? 'Tuesday',
    tribalCouncilTime: easternTime(schedule.tribalCouncilHourUtc),
    voteOpenOffset: 0,
    voteCloseOffset: 24,
    tieRule: 'revote_then_rocks',
    voteChangePolicy: 'allow_until_close',
    nonVoterAutoCast: true,
  }
}
