/**
 * Draft scheduling — pure rules. No IO, client-safe.
 *
 * The commissioner offers a few start times; the league says which ones it can make in a league-chat
 * poll (several answers allowed); the commissioner locks one, which becomes the draft date.
 *
 * ⚠ A TIME IS STORED ONCE, IN UTC, AND SHOWN IN EACH READER'S OWN ZONE. The chat poll's option text is
 * written in the league's zone as a fallback for surfaces that only print text, and each option also
 * carries `startsAt` so the poll renders it in the viewer's own time. The draft-time notification is
 * formatted per member from their profile's time zone — it used to say "ET" to everyone.
 */

export const MIN_SLOTS = 2
export const MAX_SLOTS = 8
/** Slots closer than this are one slot offered twice. */
const MIN_SLOT_GAP_MS = 60 * 60 * 1000
/** A slot must be at least this far ahead, or the league cannot answer in time. */
const MIN_LEAD_MS = 2 * 60 * 60 * 1000

export type SlotError = 'too_few' | 'too_many' | 'invalid_time' | 'in_the_past' | 'too_close'

/** Validated, sorted slot times (ISO), or why not. */
export function parseSlots(raw: unknown, now: Date): { ok: true; slots: string[] } | { ok: false; error: SlotError } {
  if (!Array.isArray(raw)) return { ok: false, error: 'too_few' }
  const times: number[] = []
  for (const r of raw) {
    const t = typeof r === 'string' ? Date.parse(r) : NaN
    if (!Number.isFinite(t)) return { ok: false, error: 'invalid_time' }
    times.push(t)
  }
  const unique = [...new Set(times)].sort((a, b) => a - b)
  if (unique.length < MIN_SLOTS) return { ok: false, error: 'too_few' }
  if (unique.length > MAX_SLOTS) return { ok: false, error: 'too_many' }
  if (unique[0]! < now.getTime() + MIN_LEAD_MS) return { ok: false, error: 'in_the_past' }
  for (let i = 1; i < unique.length; i++) if (unique[i]! - unique[i - 1]! < MIN_SLOT_GAP_MS) return { ok: false, error: 'too_close' }
  return { ok: true, slots: unique.map((t) => new Date(t).toISOString()) }
}

/** A valid IANA zone, or the fallback. Never throws. */
export function safeTimeZone(tz: string | null | undefined, fallback = 'America/New_York'): string {
  if (!tz) return fallback
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return tz
  } catch {
    return fallback
  }
}

/** "Sat, Aug 29, 8:00 PM EDT" in the given zone. */
export function formatSlot(iso: string, timeZone: string, locale = 'en-US'): string {
  const tz = safeTimeZone(timeZone)
  return new Date(iso).toLocaleString(locale, { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
}

export type SlotTally = { id: string; startsAt: string; count: number }

/**
 * The best slot: the most managers who can make it; a tie goes to the earlier time. Null when nobody
 * has answered — "best" of zero answers is not a recommendation.
 */
export function bestSlot(slots: readonly SlotTally[]): SlotTally | null {
  const answered = slots.filter((s) => s.count > 0)
  if (answered.length === 0) return null
  return [...answered].sort((a, b) => b.count - a.count || Date.parse(a.startsAt) - Date.parse(b.startsAt))[0]!
}

type ReminderWindow = '24h' | '1h'

/**
 * Which pre-draft reminder is due: the day-before one from 25h out down to 2h, the hour-before one in
 * the last 90 minutes. The caller dedupes on (draft time, window), so a wide window costs nothing and an
 * hourly job that misses a run still sends it.
 */
export function draftReminderDue(draftAt: Date, now: Date): ReminderWindow | null {
  const ms = draftAt.getTime() - now.getTime()
  if (ms <= 0) return null
  if (ms <= 90 * 60 * 1000) return '1h'
  if (ms >= 2 * 60 * 60 * 1000 && ms <= 25 * 60 * 60 * 1000) return '24h'
  return null
}

/** Members grouped by the zone their notification is written in. */
export function groupByTimeZone(users: ReadonlyArray<{ userId: string; timeZone: string | null }>, fallback: string): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const u of users) {
    const tz = safeTimeZone(u.timeZone, fallback)
    out.set(tz, [...(out.get(tz) ?? []), u.userId])
  }
  return out
}
