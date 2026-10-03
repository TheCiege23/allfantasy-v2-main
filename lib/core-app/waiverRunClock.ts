/**
 * When a league's waivers next run, from its stored weekly schedule — pure, so the countdown
 * components (league screen, cross-league board) and their tests share one rule.
 *
 * ⚠ THE STORED TIME IS UTC, AND THE VIEWER'S TIMEZONE IS THE ONLY HONEST ONE TO SHOW IT IN.
 * `League.timezone` cannot localise it (every production league carries the schema default — see
 * `waivers.ts`), but the reader's own browser zone is a fact about the reader, not a guess about
 * the league: "Wed 5:00 AM" in your own time is the same instant as "Wed 09:00 UTC".
 */

export type WaiverSchedule = { dayOfWeek: number; timeUtc: string }

/** "09:00" / "9:00" / "09:00:00" → [9, 0]; null for anything else. */
function parseHm(timeUtc: string): [number, number] | null {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(timeUtc.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  return h >= 0 && h <= 23 && min >= 0 && min <= 59 ? [h, min] : null
}

/** The next run strictly after `nowMs`, as epoch ms. Null for an unreadable schedule. */
export function nextWaiverRunMs(schedule: WaiverSchedule, nowMs: number): number | null {
  const hm = parseHm(schedule.timeUtc)
  if (!hm || !Number.isInteger(schedule.dayOfWeek) || schedule.dayOfWeek < 0 || schedule.dayOfWeek > 6) return null
  const now = new Date(nowMs)
  const candidate = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hm[0], hm[1])
  const dayDelta = (schedule.dayOfWeek - now.getUTCDay() + 7) % 7
  let at = candidate + dayDelta * 86_400_000
  if (at <= nowMs) at += 7 * 86_400_000
  return at
}

/** "in 14h 05m", "in 3d 2h", "in 12m" — coarse on purpose; the exact time sits beside it. */
export function countdownText(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60_000))
  if (mins < 60) return `in ${mins}m`
  const h = Math.floor(mins / 60)
  if (h < 24) return `in ${h}h ${String(mins % 60).padStart(2, '0')}m`
  return `in ${Math.floor(h / 24)}d ${h % 24}h`
}
