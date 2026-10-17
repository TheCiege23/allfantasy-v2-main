import { logAdminAudit } from "@/lib/admin-audit"
import { maskPhonesInText } from "@/lib/sms/maskPhone"

type PasswordResetAuditOutcome =
  | "rate_limited"
  | "invalid_sms_phone"
  | "sms_profile_not_found"
  | "sms_phone_unverified"
  | "sms_lookup_failed"
  | "sms_token_write_failed"
  | "sms_provider_missing"
  | "sms_sent"
  | "sms_send_failed"
  | "empty_email"
  | "email_user_not_found"
  | "email_lookup_failed"
  | "email_token_created"
  | "email_token_write_failed"
  | "email_provider_missing"
  | "email_send_failed"
  | "email_sent"
  | "unexpected_error"

function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null
  const [local, domain] = email.split("@")
  if (!local || !domain) return email
  const prefix = local.slice(0, 2)
  return `${prefix}${"*".repeat(Math.max(0, local.length - 2))}@${domain}`
}

export async function logPasswordResetAudit(input: {
  outcome: PasswordResetAuditOutcome
  type: "email" | "sms"
  userId?: string | null
  email?: string | null
  phone?: string | null
  ip?: string | null
  detail?: Record<string, unknown>
}): Promise<void> {
  await logAdminAudit({
    adminUserId: "system:password-reset",
    action: `password_reset_request_${input.outcome}`,
    targetType: input.type,
    /*
     * ⚠ NEVER THE RAW NUMBER. With no account matched (invalid_sms_phone, sms_profile_not_found)
     * this keyed the row on the full phone of someone who may not even be a user. Masked like
     * `details.phone` below, which is enough to match a support ticket by its last four.
     */
    targetId: input.userId ?? input.email ?? (input.phone ? `phone:***${input.phone.slice(-4)}` : undefined),
    details: {
      type: input.type,
      userId: input.userId ?? null,
      email: maskEmail(input.email),
      emailLower: input.email?.toLowerCase?.() ?? null,
      phone: input.phone ? `***${input.phone.slice(-4)}` : null,
      ip: input.ip ?? null,
      // Provider and database error text can quote the number; scrub it before it is stored.
      ...Object.fromEntries(
        Object.entries(input.detail ?? {}).map(([k, v]) => [k, typeof v === "string" ? maskPhonesInText(v) : v]),
      ),
    },
  })
}
