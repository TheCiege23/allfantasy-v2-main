import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/adminAuth"
import { revokeAdminApiToken } from "@/lib/admin/adminApiTokens"
import { logAdminAudit } from "@/lib/admin-audit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Revoke a per-admin API token.
 *
 * Same reasoning as the issue route: gated by `requireAdmin()`, never bearer auth, so a
 * token cannot revoke its siblings. The row is kept with a `revokedAt` timestamp rather
 * than deleted, so the audit trail survives revocation.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: { tokenId: string } },
) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res

  const tokenId = params?.tokenId?.trim()
  if (!tokenId) {
    return NextResponse.json({ error: "tokenId is required" }, { status: 400 })
  }

  const token = await revokeAdminApiToken(tokenId, gate.user?.email ?? null)
  if (!token) {
    return NextResponse.json({ error: "Token not found" }, { status: 404 })
  }

  await logAdminAudit({
    adminUserId: gate.user?.id ?? gate.user?.email ?? "unknown-admin",
    action: "admin_api_token_revoke",
    targetType: "admin_api_token",
    targetId: token.id,
    details: { label: token.label, ownerEmail: token.ownerEmail },
  })

  return NextResponse.json({ token })
}
