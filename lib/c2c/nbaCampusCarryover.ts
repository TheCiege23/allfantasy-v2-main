import { normalizeGameStatus } from '@/lib/sports/gameStatus'
import type { ScheduleGame } from '@/lib/sports-data/riScheduleCache'
import { nbaCampusScheduleCoversWindow } from './nbaCampusScheduleCoverage'

/** Only capture current rosters when no college game in the week could have started. */
export function canCaptureNbaCampusCarryover(input: { now: Date; window: { start: Date; end: Date } | null; schedule: readonly ScheduleGame[] | null; meta: unknown }): boolean {
  if (!input.window || !input.schedule || !nbaCampusScheduleCoversWindow(input.meta, input.window) || input.now.getTime() >= input.window.end.getTime()) return false
  const syncedAt = Date.parse(String((input.meta as Record<string, unknown>).syncedAt ?? ''))
  if (!Number.isFinite(syncedAt) || syncedAt > input.now.getTime() || input.now.getTime() - syncedAt > 48 * 60 * 60 * 1000) return false
  for (const game of input.schedule) {
    const status = normalizeGameStatus(game.status)
    if (status === 'cancelled') continue
    if (status !== 'scheduled' || !game.startTime) return false
    const starts = Date.parse(game.startTime)
    if (!Number.isFinite(starts) || starts <= input.now.getTime()) return false
  }
  return true
}
