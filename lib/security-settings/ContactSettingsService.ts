import type { UserProfileForSettings } from "@/lib/user-settings/types"
import type { ContactSummary } from "./types"

/**
 * Builds a contact summary from settings profile for display in Security tab.
 */
export function getContactSummary(profile: UserProfileForSettings | null): ContactSummary {
  if (!profile) {
    return {
      email: null,
      emailVerified: false,
      phone: null,
      phoneVerified: false,
    }
  }
  return {
    email: profile.email ?? null,
    emailVerified: !!profile.emailVerifiedAt,
    phone: profile.phone ?? null,
    phoneVerified: !!profile.phoneVerifiedAt,
  }
}

interface UpdateContactEmailResult {
  ok: boolean
  error?: string
  wrongPassword?: boolean
  requiresPassword?: boolean
  duplicateEmail?: boolean
  invalidEmail?: boolean
  verificationEmailSent?: boolean
}

function normalizeEmailInput(email: string): string {
  return email.trim().toLowerCase()
}

/**
 * Updates account email and triggers a verification email to the new address.
 * When account has a password, currentPassword is required by the API.
 */
export async function updateContactEmail(params: {
  email: string
  currentPassword?: string
  returnTo?: string
}): Promise<UpdateContactEmailResult> {
  const email = normalizeEmailInput(params.email)
  if (!email || !email.includes("@")) {
    return { ok: false, invalidEmail: true, error: "INVALID_EMAIL" }
  }

  const res = await fetch("/api/user/contact/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email,
      currentPassword: params.currentPassword ?? "",
      returnTo: params.returnTo ?? "/settings",
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (res.ok) {
    return {
      ok: true,
      verificationEmailSent: data?.verificationEmailSent !== false,
    }
  }

  const error = String(data?.error ?? "UPDATE_FAILED")
  return {
    ok: false,
    error,
    wrongPassword: error === "WRONG_PASSWORD",
    requiresPassword: error === "CURRENT_PASSWORD_REQUIRED",
    duplicateEmail: error === "EMAIL_ALREADY_IN_USE",
    invalidEmail: error === "INVALID_EMAIL",
  }
}
