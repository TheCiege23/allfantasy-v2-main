import type { SGCalendarEntry } from './operations'
import type { SGPeriod } from './types'

export type SGCalendarPreset = {
  firstStart: string
  daysPerPeriod: number
  extendedPeriods?: number[]
  selectionHoursBeforeStart: number
  ceremonyHoursAfterEnd: number
}

/** Draft a calendar from local commissioner times. Existing dates and finished periods are preserved. */
export function buildSGCalendarPreset(
  periods: SGPeriod[], existing: Record<number, SGCalendarEntry>, currentPeriod: number,
  preset: SGCalendarPreset,
): Record<number, SGCalendarEntry> {
  const start = new Date(preset.firstStart)
  if (!Number.isFinite(start.getTime()) || !Number.isInteger(preset.daysPerPeriod) ||
      preset.daysPerPeriod < 1 || preset.daysPerPeriod > 28 ||
      !Number.isFinite(preset.selectionHoursBeforeStart) || preset.selectionHoursBeforeStart < 0 ||
      !Number.isFinite(preset.ceremonyHoursAfterEnd) || preset.ceremonyHoursAfterEnd < 0) {
    throw new Error('Choose a valid first start, period length, and deadlines.')
  }
  const extended = new Set(preset.extendedPeriods ?? [])
  if ([...extended].some(period => !periods.some(row => row.period === period))) {
    throw new Error('An extended period is outside the season schedule.')
  }
  const result: Record<number, SGCalendarEntry> = { ...existing }
  let cursor = new Date(start)
  for (const row of periods) {
    const length = preset.daysPerPeriod * (extended.has(row.period) ? 2 : 1)
    const end = new Date(cursor)
    end.setDate(end.getDate() + length)
    if (row.period >= currentPeriod && !existing[row.period]?.ceremonyAt) {
      const selection = new Date(cursor.getTime() - preset.selectionHoursBeforeStart * 3_600_000)
      const ceremony = new Date(end.getTime() + preset.ceremonyHoursAfterEnd * 3_600_000)
      result[row.period] = {
        ...existing[row.period],
        scoringStartsAt: row.mode === 'off' ? null : cursor.toISOString(),
        scoringEndsAt: row.mode === 'off' ? null : end.toISOString(),
        ceremonyAt: ceremony.toISOString(),
        selectionDeadlineAt: row.mode === 'match_play' || row.mode === 'tribe_champion'
          ? selection.toISOString() : null,
        auctionClosesAt: row.mode === 'gauntlet' ? new Date(end.getTime() +
          Math.max(1, preset.ceremonyHoursAfterEnd / 2) * 3_600_000).toISOString() : null,
      }
    }
    cursor = end
  }
  return result
}
