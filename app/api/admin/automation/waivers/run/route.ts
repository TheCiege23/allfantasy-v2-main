import { NextResponse } from "next/server"
import { z } from "zod"
import { getServerSession } from "next-auth"

import { requireAdminOrBearer } from "@/lib/adminAuth"
import { logAdminAudit, resolveAdminAuditActor } from "@/lib/admin-audit"
import { authOptions } from "@/lib/auth"
import { isCommissioner } from "@/lib/commissioner/permissions"
import { processLeagueWaiversJob } from "@/lib/automation/jobs/waivers/processLeagueWaiversJob"
import { toErrorMessage } from "@/lib/automation/errors"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const bodySchema = z.object({
  leagueId: z.string().min(1),
  dryRun: z.boolean().optional().default(false),
})

/**
 * POST /api/admin/automation/waivers/run
 * Manual/automation trigger for a single league.
 * - Admin or bearer: can run any league.
 * - Authenticated commissioner: can run their own league.
 * Does not replace `POST /api/waiver-wire/leagues/[leagueId]/process` (member/commissioner UX).
 */
export async function POST(request: Request) {
  const json = await request.json().catch(() => ({}))
  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", issues: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const { leagueId, dryRun } = parsed.data

  // Try admin/bearer first
  const adminGate = await requireAdminOrBearer(request)
  let actorUserId: string | null = adminGate.ok ? (adminGate.user?.id ?? null) : null
  let trigger: "admin" | "manual" = "admin"

  if (!adminGate.ok) {
    // Fall back to commissioner-owns-league check
    const session = (await getServerSession(authOptions as never)) as {
      user?: { id?: string }
    } | null
    const sessionUserId = session?.user?.id
    if (!sessionUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const membership = await isCommissioner(leagueId, sessionUserId)
    if (!membership) {
      return NextResponse.json(
        { error: "Forbidden: admin access or commissioner role required" },
        { status: 403 }
      )
    }

    actorUserId = sessionUserId
    trigger = "manual"
  }

  try {
    const result = await processLeagueWaiversJob({
      leagueId,
      trigger,
      dryRun,
      actorUserId,
      scheduledFor: new Date(),
    })

    // Waiver processing awards players and moves FAAB — real roster mutations that
    // members will see. `trigger` distinguishes the two authorised callers (site
    // admin vs the league's own commissioner); actorUserId falls back to the
    // shared-secret sentinel because a bearer-token admin has no per-caller identity.
    await logAdminAudit({
      adminUserId: resolveAdminAuditActor({ id: actorUserId }),
      action: dryRun ? "admin_waivers_run_dry" : "admin_waivers_run",
      targetType: "league",
      targetId: leagueId,
      details: { trigger, dryRun, succeeded: result.ok },
    })

    return NextResponse.json({
      ok: result.ok,
      result,
    })
  } catch (error: unknown) {
    console.error("[api/admin/automation/waivers/run]", error)
    const msg =
      process.env.NODE_ENV === "production"
        ? "Failed to run waiver job"
        : toErrorMessage(error)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
