import "server-only"
import { sendNotificationEmail } from "@/lib/resend-client"

const OWNER_EMAIL = "allfantasysportsapp@gmail.com"

export type NewSignupMethod = "email" | "sleeper" | `oauth:${string}`

export interface NewSignupNotification {
  email: string | null
  method: NewSignupMethod
  userId: string
  username: string | null
  createdAt?: Date
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/**
 * Emails the owner exactly once when a NEW AppUser account is created.
 *
 * Deliberately called ONLY on the create branch of a signup, never on
 * find-existing / update — that is what keeps login and repeat visits silent.
 *
 * Fire-and-forget: every failure path is swallowed. Signup must never be blocked,
 * delayed, or failed by this notification, so callers should NOT await it. It is
 * async only so a caller may `void` it; it resolves rather than rejects.
 *
 * Not wired to NextAuth `events.createUser`: lib/auth.ts uses strategy "jwt" with no
 * adapter, so that event is never emitted. The real create sites are hooked instead.
 */
export async function notifyOwnerOfNewSignup(
  signup: NewSignupNotification
): Promise<void> {
  try {
    const when = (signup.createdAt ?? new Date()).toISOString()
    const rows: Array<[string, string]> = [
      ["Method", signup.method],
      ["Email", signup.email ?? "(none)"],
      ["Username", signup.username ?? "(none)"],
      ["User ID", signup.userId],
      ["Created", when],
    ]
    const bodyHtml = `New AllFantasy account created.<br><br>${rows
      .map(([k, v]) => `${escapeHtml(k)}: ${escapeHtml(v)}`)
      .join("<br>")}`

    await sendNotificationEmail({
      to: OWNER_EMAIL,
      subject: `New signup (${signup.method}): ${signup.username ?? signup.email ?? signup.userId}`,
      bodyHtml,
    })
  } catch (err) {
    // Never propagate — a broken notification must not affect the signup.
    console.warn("[notifyOwnerOfNewSignup] non-blocking failure:", err)
  }
}
