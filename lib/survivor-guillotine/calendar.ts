import { buildSGSchedule } from './config'
import type { SGConfig, SGOrderChoice } from './types'
import type { SGCalendarEntry } from './operations'

/** Convert published Eastern wall times without depending on the server timezone or fixed EST offsets. */
export function sgEasternTime(day: string, time: string): string {
  const target = Date.parse(`${day}T${time}:00Z`)
  if (!Number.isFinite(target)) throw new Error('Invalid Eastern calendar time.')
  let instant = target
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/New_York', year: 'numeric',
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(instant))
    instant += target - Date.parse(`${parts.replace(' ', 'T')}Z`)
  }
  return new Date(instant).toISOString()
}

export function validateSGOrderChoice(choice: SGOrderChoice | undefined, cutoff?: string | null) {
  if (choice === undefined) return
  if (!choice || typeof choice.tribeId !== 'string' || !choice.tribeId.trim() || !Number.isFinite(Date.parse(choice.deadlineAt)) ||
      !Array.isArray(choice.counts) || choice.counts.length !== 3 || choice.counts.some(n => !Number.isInteger(n) || n < 1 || n > 32) ||
      !Array.isArray(choice.deadlines) || choice.deadlines.length !== 3 ||
      choice.deadlines.some((time, i) => !Number.isFinite(Date.parse(time)) || Date.parse(time) < Date.parse(i ? choice.deadlines[i - 1] : choice.deadlineAt) || (cutoff && Date.parse(time) > Date.parse(cutoff))) ||
      (choice.selected !== undefined && !['bookends', 'middle'].includes(choice.selected))) throw new Error('Invalid bookends/middle selection schedule.')
}

export function sgOrderStages(choice: SGOrderChoice, tribes: string[], selected: 'bookends' | 'middle') {
  if (tribes.length !== 2 || !tribes.includes(choice.tribeId)) throw new Error('Bookends/middle selection requires two current tribes.')
  const other = tribes.find(id => id !== choice.tribeId)!
  const first = selected === 'bookends' ? choice.tribeId : other
  const middle = selected === 'middle' ? choice.tribeId : other
  return choice.counts.map((count, i) => ({ tribeId: i === 1 ? middle : first, count, deadlineAt: choice.deadlines[i] }))
}

/** Preview only. Real schedule rows supply the dates; saving remains an explicit commissioner action. */
export function buildSGNflCalendar(config: SGConfig, games: { week: number; startTime: Date }[]): Record<number, SGCalendarEntry> {
  if (config.sport !== 'NFL') throw new Error('Use the actual weekly NBA calendar and explicit combined-week overrides.')
  const calendar: Record<number, SGCalendarEntry> = {}
  for (const period of buildSGSchedule(config).periods) {
    const starts = games.filter(game => game.week === period.period).map(game => game.startTime.getTime()).filter(Number.isFinite).sort((a, b) => a - b)
    if (!starts.length) throw new Error(`Verified NFL schedule missing for period ${period.period}; enter its dates manually.`)
    const first = new Date(starts[0]), last = starts.at(-1)!
    const localDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(first)
    const monday = new Date(`${localDay}T00:00:00Z`)
    monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7)
    const day = (offset: number) => new Date(monday.getTime() + offset * 86_400_000).toISOString().slice(0, 10)
    const end = last + 8 * 3600_000
    const row: SGCalendarEntry = { scoringStartsAt: sgEasternTime(day(0), '00:00'), scoringEndsAt: new Date(end).toISOString(),
      ceremonyAt: new Date(end + 12 * 3600_000).toISOString(),
      ...(['match_play', 'tribe_champion'].includes(period.mode) ? { selectionDeadlineAt: first.toISOString() } : {}) }
    const deadlines: [string, string, string] = [sgEasternTime(day(2), '23:59'), sgEasternTime(day(3), '15:00'), first.toISOString()]
    const standardThursday = Date.parse(deadlines[1]) < first.getTime()
    if (config.tribeCount === 2 && standardThursday) {
      if (period.period === 5 && period.mode === 'match_play' && period.teamsEntering === 18) row.selectionStages = [2, 4, 3].map((count, i) => ({ count, tribeId: i === 1 ? 'tribe-1' : 'tribe-0', deadlineAt: deadlines[i] }))
      if ([6, 10].includes(period.period) && period.mode === 'tribe_champion') row.selectionStages = [
        { tribeId: 'tribe-0', count: 1, deadlineAt: deadlines[0] }, { tribeId: 'tribe-1', count: 1, deadlineAt: deadlines[2] }]
      if (period.period === 9 && period.mode === 'match_play' && period.teamsEntering === 14) row.orderChoice = {
        tribeId: 'tribe-0', deadlineAt: sgEasternTime(day(2), '15:00'), counts: [2, 3, 2], deadlines }
    }
    if (period.mode === 'gauntlet' && config.gauntletIdolMode !== 'retired_player' && config.gauntletIdolAuction) {
      // A private idol must be awarded before it can be played this scoring period.
      row.auctionClosesAt = new Date(first.getTime() - 3600_000).toISOString()
    }
    calendar[period.period] = row
  }
  return calendar
}
