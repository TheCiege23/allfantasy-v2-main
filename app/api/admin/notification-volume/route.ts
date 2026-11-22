/**
 * Admin — notification volume
 * GET /api/admin/notification-volume?days=7
 *
 * Pushes, emails and texts actually sent, per day, per category and per person, plus opt-outs.
 * See lib/admin-dashboard/NotificationVolumeService.ts for the sources. Admin-only, read-only.
 */
import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/adminAuth"
import { getNotificationVolume } from "@/lib/admin-dashboard/NotificationVolumeService"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res
  const raw = Number(new URL(request.url).searchParams.get("days") ?? 7)
  try {
    return NextResponse.json(await getNotificationVolume({ days: Number.isFinite(raw) ? raw : 7 }))
  } catch (err) {
    console.error("[admin/notification-volume]", err instanceof Error ? err.message : err)
    return NextResponse.json({ error: "Could not read notification volume" }, { status: 500 })
  }
}
