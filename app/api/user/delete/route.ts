import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

/**
 * POST /api/user/delete  (Release Readiness Phase 1 — blocker B1)
 *
 * Real account erasure (replaces the prior `{ stub: true }` no-op that sat behind
 * a live "delete account" button — a GDPR/CCPA right-to-erasure exposure).
 *
 * Approach: migration-free PII erasure in a transaction —
 *   - revoke authentication: delete OAuth links (AuthAccount) + verification/reset
 *     tokens, and null the password hash;
 *   - scrub personal data on AppUser (email, username, displayName, avatarUrl,
 *     emailVerified) to unrecoverable anonymized values.
 * This erases personal data while preserving referential integrity (leagues,
 * rosters, and analytics keep an anonymized user row). A full hard-delete /
 * cascade requires a schema+FK audit and is a separate, gated follow-up.
 *
 * Session note: auth uses JWT sessions, so an already-issued token cannot be
 * server-revoked without a denylist (a follow-up). The client signs out on
 * success; login is blocked immediately (password nulled, OAuth links removed,
 * identifiers anonymized).
 *
 * Requires an explicit `{ confirm: true }` body in addition to the UI's typed
 * "DELETE" confirmation — defense in depth against an accidental POST.
 */
export async function POST(req: Request) {
  const session = (await getServerSession(authOptions as any)) as {
    user?: { id?: string }
  } | null

  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let confirm = false
  try {
    const body = (await req.json()) as { confirm?: unknown } | null
    confirm = body?.confirm === true
  } catch {
    confirm = false
  }
  if (!confirm) {
    return NextResponse.json(
      { error: "Deletion requires explicit confirmation.", code: "confirmation_required" },
      { status: 400 }
    )
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.authAccount.deleteMany({ where: { userId } })
      await tx.emailVerifyToken.deleteMany({ where: { userId } }).catch(() => undefined)
      await tx.passwordResetToken.deleteMany({ where: { userId } }).catch(() => undefined)
      await tx.appUser.update({
        where: { id: userId },
        data: {
          email: `deleted+${userId}@deleted.invalid`,
          username: `deleted_${userId}`,
          passwordHash: null,
          displayName: null,
          avatarUrl: null,
          emailVerified: null,
        },
      })
    })
  } catch (error) {
    console.error("[user/delete] erasure failed:", error)
    return NextResponse.json({ error: "Account deletion failed" }, { status: 500 })
  }

  console.warn("[user/delete] account erased", { userId })
  return NextResponse.json({ ok: true, deleted: true })
}
