import { prisma } from "@/lib/prisma"
import { toPrismaNullableJsonInput } from "@/lib/prisma-json"

export type AdminAuditEntry = {
  id: string
  adminUserId: string
  action: string
  targetType: string | null
  targetId: string | null
  details: unknown
  createdAt: Date
}

export type LogAdminActionInput = {
  adminUserId: string
  action: string
  targetType?: string
  targetId?: string
  details?: Record<string, unknown>
}

/**
 * Sentinel actor for callers who authenticated with a shared secret rather than a
 * user session. `requireAdminOrBearer()` accepts `Authorization: Bearer
 * $ADMIN_PASSWORD` (and `x-admin-secret`/`x-cron-secret`) and returns a user object
 * with only `{ role: "admin" }` — no id, no email. There is genuinely no per-caller
 * identity to record, so record that fact explicitly instead of inventing one or
 * silently dropping the audit row.
 */
export const ADMIN_AUDIT_SHARED_SECRET_ACTOR = "shared-secret"

/**
 * Resolve a stable actor id from a `requireAdmin()` / `requireAdminOrBearer()` gate
 * user, so every call site records the actor the same way.
 */
export function resolveAdminAuditActor(
  user: { id?: string | null; email?: string | null } | null | undefined,
): string {
  return user?.id?.trim() || user?.email?.trim() || ADMIN_AUDIT_SHARED_SECRET_ACTOR
}

/**
 * Append an admin action to the audit log. Safe to call from API routes after requireAdmin().
 */
export async function logAdminAudit(input: LogAdminActionInput): Promise<void> {
  try {
    await prisma.adminAuditLog.create({
      data: {
        adminUserId: input.adminUserId,
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        details: toPrismaNullableJsonInput(input.details),
      },
    })
  } catch (e) {
    console.error("[admin-audit] logAdminAudit failed:", e)
  }
}

/**
 * Fetch recent audit entries for the admin UI. Requires admin check at API layer.
 */
export async function getAdminAuditLogs(options?: {
  limit?: number
  since?: Date
  /** e.g. `support_` to list support notes + risk + disputes */
  actionPrefix?: string
  /** Exact action match (takes precedence over prefix when both set) */
  actions?: string[]
}): Promise<AdminAuditEntry[]> {
  const limit = Math.min(options?.limit ?? 100, 500)
  const where: import("@prisma/client").Prisma.AdminAuditLogWhereInput = {}
  if (options?.since) {
    where.createdAt = { gte: options.since }
  }
  if (options?.actions?.length) {
    where.action = { in: options.actions }
  } else if (options?.actionPrefix?.trim()) {
    where.action = { startsWith: options.actionPrefix.trim() }
  }

  const rows = await prisma.adminAuditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
  })

  return rows.map((r) => ({
    id: r.id,
    adminUserId: r.adminUserId,
    action: r.action,
    targetType: r.targetType,
    targetId: r.targetId,
    details: r.details as unknown,
    createdAt: r.createdAt,
  }))
}
