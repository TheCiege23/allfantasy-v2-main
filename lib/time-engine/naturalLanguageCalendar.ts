import { addDays } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'

/**
 * User-timezone labels for AI relative phrasing: today / tonight / tomorrow / this week.
 */
export function buildRelativeCalendarHints(args: {
  userTimezone: string
  serverNowUTC: Date
}): {
  todayInUserTz: string
  tomorrowDateInUserTz: string
  tonightWindowLabel: string
  thisWeekLabel: string
  userDayOfWeekName: string
} {
  const tz = args.userTimezone
  const todayInUserTz = formatInTimeZone(args.serverNowUTC, tz, 'yyyy-MM-dd')
  const tomorrowDateInUserTz = formatInTimeZone(addDays(args.serverNowUTC, 1), tz, 'yyyy-MM-dd')
  const dow = formatInTimeZone(args.serverNowUTC, tz, 'EEEE')
  return {
    todayInUserTz,
    tomorrowDateInUserTz,
    tonightWindowLabel: `Tonight (${todayInUserTz}, user local evening through 04:00 next calendar day in ${tz})`,
    thisWeekLabel: `This NFL/fantasy week containing ${todayInUserTz} (${dow})`,
    userDayOfWeekName: dow,
  }
}
