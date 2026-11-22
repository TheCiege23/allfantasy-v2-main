import { nextSunday } from 'date-fns'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import type { SupportedSport } from '@/lib/sport-scope'

const NY = 'America/New_York'

/** Typical NFL Sunday kickoff (America/New_York) for forecast window selection. */
export function defaultNflGameTime(reference: Date = new Date()): Date {
  const sun = nextSunday(reference)
  const ymd = formatInTimeZone(sun, NY, 'yyyy-MM-dd')
  return fromZonedTime(`${ymd}T13:00:00.000`, NY)
}

/** Saturday afternoon ET — common NCAAF window. */
function defaultNcaafGameTime(reference: Date = new Date()): Date {
  const sun = nextSunday(reference)
  const sat = new Date(sun.getTime() - 24 * 60 * 60 * 1000)
  const ymd = formatInTimeZone(sat, NY, 'yyyy-MM-dd')
  return fromZonedTime(`${ymd}T15:30:00.000`, NY)
}

function defaultMlbGameTime(reference: Date = new Date()): Date {
  const sun = nextSunday(reference)
  const ymd = formatInTimeZone(sun, NY, 'yyyy-MM-dd')
  return fromZonedTime(`${ymd}T16:10:00.000`, NY)
}

function defaultSoccerGameTime(reference: Date = new Date()): Date {
  const sun = nextSunday(reference)
  const ymd = formatInTimeZone(sun, NY, 'yyyy-MM-dd')
  return fromZonedTime(`${ymd}T14:00:00.000`, NY)
}

export function defaultGameTimeForSport(sport: SupportedSport, reference: Date = new Date()): Date {
  switch (sport) {
    case 'NFL':
      return defaultNflGameTime(reference)
    case 'NCAAF':
      return defaultNcaafGameTime(reference)
    case 'MLB':
      return defaultMlbGameTime(reference)
    case 'SOCCER':
      return defaultSoccerGameTime(reference)
    default:
      return defaultNflGameTime(reference)
  }
}
