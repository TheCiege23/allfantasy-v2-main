import { logAdminAudit } from "@/lib/admin-audit"

type PasswordResetAuditOutcome =
  | "rate_limited"
  | "invalid_sms_phone"
  | "sms_profile_not_found"
  | "sms_provider_missing"
  | "sms_sent"
  | "sms_send_failed"
  | "empty_email"
  | "email_user_not_found"
  | "email_token_created"
  | "email_provider_missing"
  | "email_send_failed"
  | "email_sent"

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
    targetId: input.userId ?? input.email ?? input.phone ?? undefined,
    details: {
      type: input.type,
      userId: input.userId ?? null,
      email: maskEmail(input.email),
      emailLower: input.email?.toLowerCase?.() ?? null,
      phone: input.phone ? `***${input.phone.slice(-4)}` : null,
      ip: input.ip ?? null,
      ...(input.detail ?? {}),
    },
  })
}
