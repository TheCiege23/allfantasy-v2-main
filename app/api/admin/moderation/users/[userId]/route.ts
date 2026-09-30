import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/adminAuth"
import { resolveAdminAuditActor } from "@/lib/admin-audit"
import { liftAccountRestriction, restrictAccount } from "@/lib/moderation/accountSuspension"

export const dynamic = "force-dynamic"

/** Suspension lengths the queue offers. A number outside this set is refused rather than clamped. */
const SUSPEND_DAYS = new Set([1, 7, 30])

/**
 * Act on a reported USER: { action: "suspend", days: 1 | 7 | 30, reason? } | { action: "ban", reason? }
 * | { action: "lift" }. Admin-only (requireAdmin — the canonical admin authority). Suspend and ban
 * end every open session at once; see lib/moderation/accountSuspension for how they are enforced.
 */
export async function POST(req: Request, { params }: { params: { userId: string } }) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res

  const userId = decodeURIComponent(params.userId)
  const adminUserId = resolveAdminAuditActor(gate.user as { id?: string | null; email?: string | null } | null)
  if (userId && userId === (gate.user as { id?: string | null } | null)?.id) {
    return NextResponse.json({ error: "You cannot suspend your own account." }, { status: 400 })
  }

  const body = (await req.json().catch(() => ({}))) as { action?: unknown; days?: unknown; reason?: unknown }
  const reason = typeof body.reason === "string" ? body.reason.slice(0, 500) : null

  if (body.action === "lift") {
    const removed = await liftAccountRestriction(userId, adminUserId)
    return NextResponse.json({ ok: true, removed })
  }

  if (body.action !== "suspend" && body.action !== "ban") {
    return NextResponse.json({ error: 'action must be "suspend", "ban" or "lift"' }, { status: 400 })
  }
  if (body.action === "suspend" && !(typeof body.days === "number" && SUSPEND_DAYS.has(body.days))) {
    return NextResponse.json({ error: "days must be 1, 7 or 30" }, { status: 400 })
  }

  try {
    const restriction = await restrictAccount({
      userId,
      kind: body.action,
      days: body.action === "suspend" ? (body.days as number) : null,
      reason,
      adminUserId,
    })
    return NextResponse.json({ ok: true, restriction })
  } catch (err) {
    if (err instanceof Error && err.message === "USER_NOT_FOUND") {
      return NextResponse.json({ error: "No such user." }, { status: 404 })
    }
    console.error("[admin/moderation/users] restrict failed:", err)
    return NextResponse.json({ error: "Could not apply that. Nothing was changed." }, { status: 500 })
  }
}
