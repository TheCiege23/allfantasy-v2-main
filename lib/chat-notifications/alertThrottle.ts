/**
 * Whether ONE recipient should be alerted about ONE new chat message. PURE.
 *
 * The rules (owner's ask, 2026-09-25): tell people they got a message, but a burst of ten messages
 * is one buzz, not ten.
 *
 *   1. Already read past this message            -> no alert ("already_read")
 *   2. Reading the conversation right now         -> no alert ("viewing")
 *        An open conversation re-fetches every 4-8s, and every fetch stamps `lastReadAt`
 *        (getPlatformThreadMessages). A stamp inside ACTIVE_VIEWER_WINDOW_MS means the screen is
 *        in front of them; a phone buzzing about the message they are looking at is noise.
 *   3. Alerted about this conversation within ALERT_WINDOW_MS and not read since -> no alert
 *      ("throttled"). Once they HAVE read since that alert, the next message is news again.
 *   4. Otherwise alert. Email rides along at most once per EMAIL_WINDOW_MS per conversation.
 *
 * ⚠ RULE 3 RESETS ON READ ON PURPOSE. "At most one per 10 minutes, full stop" would swallow the
 * reply to a question the recipient asked two minutes ago and then walked away from. The owner's
 * phrasing was "at most one alert per 10 minutes WHILE THERE ARE UNREAD MESSAGES".
 *
 * League chat has no per-member read stamp, so it runs with `trackReads: false`: rules 1-2 are
 * skipped and rule 3 is a plain window.
 */

export const DM_ALERT_WINDOW_MS = 10 * 60 * 1000
export const DM_EMAIL_WINDOW_MS = 60 * 60 * 1000
export const ACTIVE_VIEWER_WINDOW_MS = 30 * 1000

/*
 * 🛑 SENDING A MESSAGE STAMPS YOUR OWN `lastReadAt` (createPlatformThreadMessage), and so does the
 * reload the composer fires right after the POST. Rule 2 read that stamp as "reading right now",
 * so the most common conversation there is — you text, lock the phone, they answer twenty
 * seconds later — produced NO push and no bell row: the reply landed inside your own send's
 * 30s window.
 *
 * A screen that is really open after a send polls at the active cadence (4s, useChatPolling)
 * and every poll re-stamps, pushing the stamp past OWN_SEND_STAMP_TOLERANCE_MS. A locked phone
 * stops polling (hidden tabs never tick), so its stamp stays pinned to the send. So when the
 * stamp sits within the tolerance of the recipient's own last message, "viewing" only holds
 * for SENT_THEN_LEFT_WINDOW_MS — two poll intervals — instead of 30s.
 */
export const OWN_SEND_STAMP_TOLERANCE_MS = 3 * 1000
export const SENT_THEN_LEFT_WINDOW_MS = 8 * 1000

export type ChatAlertState = {
  lastAlertAt: string | null
  lastEmailAt: string | null
}

export type ChatAlertDecision =
  | { alert: false; reason: 'already_read' | 'viewing' | 'throttled' }
  | { alert: true; email: boolean }

export type ChatAlertDecisionInput = {
  now: Date
  messageAt: Date
  lastReadAt: Date | null | undefined
  /** When the RECIPIENT last sent a message in this conversation — see SENT_THEN_LEFT_WINDOW_MS. */
  lastOwnMessageAt?: Date | null
  state: ChatAlertState | null
  trackReads?: boolean
  alertWindowMs?: number
  emailWindowMs?: number
  activeWindowMs?: number
}

function at(value: string | null | undefined): number | null {
  if (!value) return null
  const t = new Date(value).getTime()
  return Number.isFinite(t) ? t : null
}

export function decideChatAlert(input: ChatAlertDecisionInput): ChatAlertDecision {
  const now = input.now.getTime()
  const trackReads = input.trackReads !== false
  const alertWindow = input.alertWindowMs ?? DM_ALERT_WINDOW_MS
  const emailWindow = input.emailWindowMs ?? DM_EMAIL_WINDOW_MS
  const activeWindow = input.activeWindowMs ?? ACTIVE_VIEWER_WINDOW_MS
  const readAt = trackReads && input.lastReadAt ? new Date(input.lastReadAt).getTime() : null

  if (readAt != null && Number.isFinite(readAt)) {
    if (readAt >= input.messageAt.getTime()) return { alert: false, reason: 'already_read' }
    const ownAt = input.lastOwnMessageAt ? new Date(input.lastOwnMessageAt).getTime() : NaN
    const stampIsOwnSend =
      Number.isFinite(ownAt) && readAt >= ownAt && readAt - ownAt <= OWN_SEND_STAMP_TOLERANCE_MS
    const viewingWindow = stampIsOwnSend ? Math.min(activeWindow, SENT_THEN_LEFT_WINDOW_MS) : activeWindow
    if (now - readAt < viewingWindow) return { alert: false, reason: 'viewing' }
  }

  const lastAlert = at(input.state?.lastAlertAt)
  if (lastAlert != null && now - lastAlert < alertWindow) {
    const readSinceAlert = readAt != null && readAt > lastAlert
    if (!readSinceAlert) return { alert: false, reason: 'throttled' }
  }

  const lastEmail = at(input.state?.lastEmailAt)
  const email = lastEmail == null || now - lastEmail >= emailWindow
  return { alert: true, email }
}

/** The state to store after an alert goes out. */
export function nextChatAlertState(
  prev: ChatAlertState | null,
  now: Date,
  emailed: boolean,
): ChatAlertState {
  return {
    lastAlertAt: now.toISOString(),
    lastEmailAt: emailed ? now.toISOString() : (prev?.lastEmailAt ?? null),
  }
}

/** Reads a stored state defensively — the row is JSON and may predate this shape. */
export function readChatAlertState(data: unknown): ChatAlertState | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const d = data as Record<string, unknown>
  const lastAlertAt = typeof d.lastAlertAt === 'string' ? d.lastAlertAt : null
  const lastEmailAt = typeof d.lastEmailAt === 'string' ? d.lastEmailAt : null
  if (!lastAlertAt && !lastEmailAt) return null
  return { lastAlertAt, lastEmailAt }
}
