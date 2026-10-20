/**
 * Scheduled league announcements (docs/AF_COMMISSIONER_SETTINGS_SPEC.md §2.1, Free): a commissioner
 * writes the announcement now and AF posts it to league chat at the time they pick, exactly as if they
 * had pressed Send then (same chat post, same member notification).
 *
 * Stored in `League.settings.scheduled_announcements`. The sweep that posts them rides
 * `/api/cron/alert-sweep`, which runs every 15 minutes, so a post lands within 15 minutes after its
 * time — the composer says so rather than promising the minute.
 *
 * ⚠ A POST IS CLAIMED ('sending') BEFORE IT IS SENT AND NEVER RETRIED FROM THAT STATE. The worker
 * runs two replicas, and an announcement sent twice is worse than one marked failed: a stale claim
 * becomes 'failed' and the commissioner sees it, rather than the league getting it again.
 *
 * Pure.
 */

export const SCHEDULED_ANNOUNCEMENTS_KEY = 'scheduled_announcements'
export const MAX_PENDING_PER_LEAGUE = 10
export const ANNOUNCEMENT_MAX_LENGTH = 500
/** Earliest a post may be scheduled: one sweep out, so "schedule" is never just a slow "send now". */
export const MIN_LEAD_MS = 15 * 60 * 1000
export const MAX_LEAD_MS = 90 * 24 * 60 * 60 * 1000
/** A claim this old was interrupted mid-send; it is marked failed, never re-sent. */
export const STALE_CLAIM_MS = 30 * 60 * 1000
/** Finished posts kept for the commissioner to see. */
export const HISTORY_KEEP = 20

export type ScheduledAnnouncementStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'cancelled'

export type ScheduledAnnouncement = {
  id: string
  message: string
  /** ISO time the commissioner picked. */
  sendAt: string
  byUserId: string
  createdAt: string
  status: ScheduledAnnouncementStatus
  claimedAt?: string
  finishedAt?: string
  /** Why it did not post, in words a commissioner can read. */
  reason?: string
}

const STATUSES: readonly ScheduledAnnouncementStatus[] = ['pending', 'sending', 'sent', 'failed', 'cancelled']

function isAnnouncement(x: unknown): x is ScheduledAnnouncement {
  const a = x as Partial<ScheduledAnnouncement> | null
  return Boolean(
    a && typeof a.id === 'string' && typeof a.message === 'string' && typeof a.sendAt === 'string' &&
      typeof a.byUserId === 'string' && typeof a.createdAt === 'string' &&
      STATUSES.includes(a.status as ScheduledAnnouncementStatus) && Number.isFinite(Date.parse(a.sendAt)),
  )
}

/** Every stored announcement, earliest first. An unreadable entry is dropped. */
export function readScheduledAnnouncements(settings: unknown): ScheduledAnnouncement[] {
  const raw = settings && typeof settings === 'object' ? (settings as Record<string, unknown>)[SCHEDULED_ANNOUNCEMENTS_KEY] : null
  if (!Array.isArray(raw)) return []
  return raw.filter(isAnnouncement).sort((a, b) => Date.parse(a.sendAt) - Date.parse(b.sendAt) || a.id.localeCompare(b.id))
}

/** A copy of `settings` holding `list` (history trimmed to the newest HISTORY_KEEP; key removed when empty). */
export function withScheduledAnnouncements(settings: unknown, list: readonly ScheduledAnnouncement[]): Record<string, unknown> {
  const base = settings && typeof settings === 'object' && !Array.isArray(settings) ? { ...(settings as Record<string, unknown>) } : {}
  const open = list.filter((a) => a.status === 'pending' || a.status === 'sending')
  const done = list
    .filter((a) => a.status !== 'pending' && a.status !== 'sending')
    .sort((a, b) => Date.parse(b.finishedAt ?? b.sendAt) - Date.parse(a.finishedAt ?? a.sendAt))
    .slice(0, HISTORY_KEEP)
  const kept = [...open, ...done]
  if (kept.length) base[SCHEDULED_ANNOUNCEMENTS_KEY] = kept
  else delete base[SCHEDULED_ANNOUNCEMENTS_KEY]
  return base
}

export type ScheduleInputError = 'bad_message' | 'bad_time' | 'too_soon' | 'too_far' | 'too_many'

export const SCHEDULE_ERROR_TEXT: Record<ScheduleInputError, string> = {
  bad_message: `Write the announcement (up to ${ANNOUNCEMENT_MAX_LENGTH} characters).`,
  bad_time: 'Pick a date and time for the post.',
  too_soon: 'Pick a time at least 15 minutes from now — or just send it now.',
  too_far: 'Announcements can be scheduled up to 90 days ahead.',
  too_many: `A league can have up to ${MAX_PENDING_PER_LEAGUE} scheduled announcements waiting. Cancel one first.`,
}

/** Validate a request to schedule. Strict: nothing is trimmed into a different message or time. */
export function parseScheduleInput(
  body: unknown,
  existing: readonly ScheduledAnnouncement[],
  now: Date,
): { ok: true; value: { message: string; sendAt: string } } | { ok: false; error: ScheduleInputError } {
  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  const message = typeof b.message === 'string' ? b.message.trim() : ''
  if (!message || message.length > ANNOUNCEMENT_MAX_LENGTH) return { ok: false, error: 'bad_message' }
  const at = typeof b.sendAt === 'string' ? Date.parse(b.sendAt) : NaN
  if (!Number.isFinite(at)) return { ok: false, error: 'bad_time' }
  if (at < now.getTime() + MIN_LEAD_MS) return { ok: false, error: 'too_soon' }
  if (at > now.getTime() + MAX_LEAD_MS) return { ok: false, error: 'too_far' }
  if (existing.filter((a) => a.status === 'pending').length >= MAX_PENDING_PER_LEAGUE) return { ok: false, error: 'too_many' }
  return { ok: true, value: { message, sendAt: new Date(at).toISOString() } }
}

/** Pending posts whose time has come, earliest first. */
export function dueAnnouncements(list: readonly ScheduledAnnouncement[], now: Date): ScheduledAnnouncement[] {
  return list.filter((a) => a.status === 'pending' && Date.parse(a.sendAt) <= now.getTime())
}

/** Claims interrupted mid-send, to be marked failed (never re-sent). */
export function staleClaims(list: readonly ScheduledAnnouncement[], now: Date): ScheduledAnnouncement[] {
  return list.filter((a) => a.status === 'sending' && now.getTime() - Date.parse(a.claimedAt ?? a.sendAt) > STALE_CLAIM_MS)
}

/** `list` with one entry replaced by `patch` (unknown id = unchanged). */
export function updateAnnouncement(
  list: readonly ScheduledAnnouncement[],
  id: string,
  patch: Partial<Omit<ScheduledAnnouncement, 'id'>>,
): ScheduledAnnouncement[] {
  return list.map((a) => (a.id === id ? { ...a, ...patch } : a))
}
