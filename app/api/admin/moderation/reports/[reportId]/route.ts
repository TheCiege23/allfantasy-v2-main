import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/adminAuth"
import { reviewReport, type ReviewAction } from "@/lib/moderation/AdminReportReview"

export const dynamic = "force-dynamic"

/**
 * Act on a reported chat message: { action: "remove" | "dismiss" }.
 * Admin-only (requireAdmin — the canonical admin authority). See
 * lib/moderation/AdminReportReview for what each action does.
 */
export async function POST(req: Request, props: { params: Promise<{ reportId: string }> }) {
  const params = await props.params
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res

  const body = (await req.json().catch(() => ({}))) as { action?: unknown }
  const action = body.action
  if (action !== "remove" && action !== "dismiss") {
    return NextResponse.json({ error: 'action must be "remove" or "dismiss"' }, { status: 400 })
  }

  const adminId = (gate.user as { id?: string | null } | null | undefined)?.id
  const result = await reviewReport(decodeURIComponent(params.reportId), action as ReviewAction, `admin:${adminId ?? "moderation"}`)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json(result)
}
