/**
 * The commissioner's "rebuild the rest of the schedule" request, from the browser (2026-11-15).
 *
 * 🛑 THE "EDIT SCHEDULE" BUTTON DID NOTHING AND SAID IT WORKED. It sent `{ regenerate: true }` to the schedule-settings
 * PUT, which has no such key and rewrote the settings unchanged; the button never read the response, so it showed
 * "Schedule updated" every time. It now asks the schedule route to regenerate, which keeps every week that has started,
 * rebuilds the rest, logs it, and asks for confirmation mid-season.
 *
 * Client-safe (fetch only).
 */
import { SCHEDULE_REGEN_CONFIRMATION_CODE } from './scheduleRegeneration'

/** The server's own spelling (lib/schedule-runtime/scheduleRegeneration.ts), never a copy. */
export const MID_SEASON_CONFIRMATION_CODE = SCHEDULE_REGEN_CONFIRMATION_CODE

export type RebuildScheduleOutcome = { ok: true } | { ok: false; message: string | null; cancelled?: boolean }

export async function requestScheduleRebuild(
  leagueId: string,
  confirmMidSeason: (message: string) => boolean,
): Promise<RebuildScheduleOutcome> {
  const send = (confirmMidSeasonChange: boolean) =>
    fetch('/api/redraft/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leagueId, action: 'regenerate', ...(confirmMidSeasonChange ? { confirmMidSeasonChange: true } : {}) }),
    })
  try {
    let res = await send(false)
    let data = (await res.json().catch(() => ({}))) as { error?: string; code?: string }
    if (!res.ok && data.code === MID_SEASON_CONFIRMATION_CODE) {
      if (!confirmMidSeason(data.error ?? 'The season has started. Rebuild the weeks that have not started yet?')) {
        return { ok: false, message: null, cancelled: true }
      }
      res = await send(true)
      data = (await res.json().catch(() => ({}))) as { error?: string; code?: string }
    }
    return res.ok ? { ok: true } : { ok: false, message: data.error ?? null }
  } catch {
    return { ok: false, message: null }
  }
}
