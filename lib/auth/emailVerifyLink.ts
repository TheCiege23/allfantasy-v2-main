/**
 * How long an email-confirmation link works. ONE value for every place that mails one: sign-up,
 * "send a new link", an address change, and the confirm-your-email reminder.
 *
 * WHY 7 DAYS, NOT 1 HOUR (owner's call 2026-09-25, "get stuck sign-ups confirmed"):
 * measured that day, 44 of 110 accounts had never confirmed. 39 of them held only expired links
 * and none held a working one. Resend showed the emails DELIVERED. The link died an hour after it
 * was sent, so anyone who opened it the next morning hit "This verification link has expired".
 * Of the ~40 people who did confirm on their own, 8 did it after the first hour, which means they
 * had to ask for another link. Most people never do.
 *
 * A longer life is safe here because the link proves one thing, that you can read this inbox. It
 * does NOT sign anyone in (app/verify/email/route.ts only sets emailVerified), it is single-use, and
 * it is stored hashed. The PASSWORD-RESET link is a different kind of link and keeps its 1 hour.
 */
export const EMAIL_VERIFY_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** Said in the email and on /verify, so the copy can never disagree with the TTL. */
export const EMAIL_VERIFY_LINK_LIFETIME = '7 days'

export function emailVerifyLinkExpiresAt(nowMs: number = Date.now()): Date {
  return new Date(nowMs + EMAIL_VERIFY_LINK_TTL_MS)
}
