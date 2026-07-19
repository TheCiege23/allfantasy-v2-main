import { NextResponse } from "next/server"

import { isAdminEmailAllowed, requireAdmin } from "@/lib/adminAuth"
import { issueAdminApiToken, listAdminApiTokens } from "@/lib/admin/adminApiTokens"
import { logAdminAudit } from "@/lib/admin-audit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Manage per-admin API tokens.
 *
 * Gated by `requireAdmin()` and deliberately NOT `requireAdminOrBearer()`: if a bearer
 * token could reach this route, a token could mint further tokens (and outlive the
 * revocation of the one that created them). Token issuance stays a human-session action.
 */

function auditActor(user: { id?: string; email?: string }): string {
  return user.id ?? user.email ?? "unknown-admin"
}

export async function GET() {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res

  const tokens = await listAdminApiTokens()
  return NextResponse.json({ tokens })
}

export async function POST(request: Request) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res

  const body = await request.json().catch(() => null)
  const label = typeof body?.label === "string" ? body.label.trim() : ""
  const ownerEmail =
    typeof body?.ownerEmail === "string" ? body.ownerEmail.trim().toLowerCase() : ""

  if (!label) {
    return NextResponse.json({ error: "label is required" }, { status: 400 })
  }
  if (!ownerEmail) {
    return NextResponse.json({ error: "ownerEmail is required" }, { status: 400 })
  }

  // A token must never grant more than a person already has, so the owner has to be an
  // admin at issue time. `resolveAdminApiToken` re-checks this on every use as well —
  // this check is the earlier, friendlier failure, not the security boundary.
  if (!isAdminEmailAllowed(ownerEmail)) {
    return NextResponse.json(
      { error: "ownerEmail is not an admin. Grant admin access first." },
      { status: 400 },
    )
  }

  const { rawToken, token } = await issueAdminApiToken({
    label,
    ownerEmail,
    createdByEmail: gate.user?.email ?? null,
  })

  await logAdminAudit({
    adminUserId: auditActor(gate.user ?? {}),
    action: "admin_api_token_issue",
    targetType: "admin_api_token",
    targetId: token.id,
    // Never the raw token or its hash.
    details: { label: token.label, ownerEmail: token.ownerEmail },
  })

  return NextResponse.json(
    {
      token,
      // The only time this value is ever returned. It cannot be recovered afterwards.
      rawToken,
      warning: "Copy this token now — it will not be shown again.",
    },
    { status: 201 },
  )
}
