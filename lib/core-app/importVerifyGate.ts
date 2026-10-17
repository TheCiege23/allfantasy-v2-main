/**
 * Pure helpers for the import screen's verify step (components/core-app/import/ImportVerifyGate.tsx,
 * 2026-10-11). Client-safe, no I/O.
 */

export type InboxShortcut = { label: string; href: string }

/*
 * "Open Gmail" beats "check your email": the person is mid-task on a phone, and every app switch
 * they have to work out for themselves is a place to drop off. Only the four providers that
 * cover the unverified accounts measured that day (27 Gmail, then Yahoo, AOL, Hotmail/Outlook,
 * iCloud/me.com); anything else gets no shortcut rather than a guess.
 *
 * The Gmail link opens a search for our sender across every folder, so a link that landed in
 * Promotions or Spam is on screen too.
 */
const INBOXES: Array<{ domains: string[]; shortcut: InboxShortcut }> = [
  {
    domains: ['gmail.com', 'googlemail.com'],
    shortcut: { label: 'Open Gmail', href: 'https://mail.google.com/mail/u/0/#search/from%3Aallfantasy.ai+in%3Aanywhere' },
  },
  { domains: ['yahoo.com', 'ymail.com', 'aol.com'], shortcut: { label: 'Open Yahoo Mail', href: 'https://mail.yahoo.com/' } },
  {
    domains: ['outlook.com', 'hotmail.com', 'live.com', 'msn.com'],
    shortcut: { label: 'Open Outlook', href: 'https://outlook.live.com/mail/' },
  },
  { domains: ['icloud.com', 'me.com', 'mac.com'], shortcut: { label: 'Open iCloud Mail', href: 'https://www.icloud.com/mail' } },
]

export function inboxShortcutFor(email: string | null | undefined): InboxShortcut | null {
  const domain = String(email ?? '').trim().toLowerCase().split('@')[1]
  if (!domain) return null
  return INBOXES.find((i) => i.domains.includes(domain))?.shortcut ?? null
}

/** What the send route answered, reduced to what the card shows. */
export type SendOutcome =
  | { k: 'sent' }
  | { k: 'already_verified' }
  | { k: 'wait'; message: string }
  | { k: 'failed'; message: string }

/**
 * Reads POST /api/auth/verify-email/send. That route answers `{ ok: true }`, `{ ok: true,
 * alreadyVerified: true }`, 429 RATE_LIMITED, and 502 EMAIL_SEND_FAILED when the mail provider
 * refused — and a 502 is never reported as "sent" (it discards its own token).
 */
export function readSendOutcome(status: number, body: unknown): SendOutcome {
  const b = (body ?? {}) as { ok?: unknown; alreadyVerified?: unknown; message?: unknown }
  const message = typeof b.message === 'string' && b.message.trim() ? b.message.trim() : null
  if (status >= 200 && status < 300 && b.ok === true) {
    return b.alreadyVerified === true ? { k: 'already_verified' } : { k: 'sent' }
  }
  if (status === 429) return { k: 'wait', message: message ?? 'A link was sent a moment ago. Give it a minute, then try again.' }
  return { k: 'failed', message: message ?? 'We couldn’t send the email right now. Please try again.' }
}
