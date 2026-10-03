/**
 * Client-side service for changing password when logged in.
 * Calls POST /api/user/password/change.
 */

export interface PasswordChangeResult {
  ok: boolean
  error?: "WRONG_PASSWORD" | "WEAK_PASSWORD" | "NO_PASSWORD" | "MISSING_FIELDS" | string
  message?: string
}

export async function changePassword(
  currentPassword: string,
  newPassword: string
): Promise<PasswordChangeResult> {
  const res = await fetch("/api/user/password/change", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      // As typed — sign-in compares the exact bytes (see the change route).
      currentPassword,
      newPassword,
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    return {
      ok: false,
      error: data.error ?? "CHANGE_FAILED",
      message: data.message ?? "Failed to change password",
    }
  }
  return { ok: true }
}
