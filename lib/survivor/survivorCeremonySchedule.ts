import { fromZonedTime } from 'date-fns-tz'
import { easternCalendarDay } from '@/lib/sports-data/easternGameDay'
import { normalizeSurvivorFoundationSettings } from './survivorSettings'

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** Next published Torch Ceremony time in Eastern time, with at least an hour to vote. */
export function nextTorchCeremonyDeadline(now: Date, rawSettings: unknown): Date {
  const settings = normalizeSurvivorFoundationSettings(rawSettings && typeof rawSettings === 'object' && !Array.isArray(rawSettings) ? rawSettings as Record<string, unknown> : {})
  const targetDay = DAYS.indexOf(settings.tribalCouncilDay)
  const time = /^([01]\d|2[0-3]):([0-5]\d)$/.test(settings.tribalCouncilTime) ? settings.tribalCouncilTime : '20:00'
  const day = easternCalendarDay(now)
  if (!day || targetDay < 0) throw new Error('A valid Eastern Torch Ceremony schedule is required.')
  for (let offset = 0; offset <= 7; offset++) {
    const candidateDay = new Date(day.getTime() + offset * 86400000)
    if (candidateDay.getUTCDay() !== targetDay) continue
    const instant = fromZonedTime(`${candidateDay.toISOString().slice(0, 10)}T${time}:00`, 'America/New_York')
    if (instant.getTime() >= now.getTime() + 3600000) return instant
  }
  throw new Error('The next Torch Ceremony deadline could not be resolved.')
}
