import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import bcrypt from "bcryptjs"
import { sha256Hex, isStrongPassword } from "@/lib/tokens"
import { clearResetCodeAttempts, consumeResetCodeAttempt } from "@/lib/auth/passwordResetAttempts"
import { revokeAllSessionsForUser } from "@/lib/auth/sessionRevocation"
import { normalizePhoneE164 } from "@/lib/phone/e164"

export const runtime = "nodejs"

const TOO_MANY_ATTEMPTS = () =>
  NextResponse.json({ error: "TOO_MANY_ATTEMPTS" }, { status: 429 })

/**
 * A reset is the recovery path for a compromised account, so every session
 * that existed before it ends — otherwise whoever held the account keeps it.
 */
async function afterSuccessfulReset(userId: string): Promise<void> {
  // Best-effort: the password is already changed, so neither failure may undo that.
  try {
    await clearResetCodeAttempts(userId)
  } catch {}
  try {
    await revokeAllSessionsForUser(userId)
  } catch {}
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const token = String(body?.token || "")
  const email = String(body?.email || "").trim().toLowerCase()
  const phone = normalizePhoneE164(String(body?.phone || ""))
  const code = String(body?.code || "").trim()
  const newPassword = String(body?.newPassword || "")

  if (!newPassword) {
    return NextResponse.json({ error: "MISSING_FIELDS" }, { status: 400 })
  }
  if (!isStrongPassword(newPassword)) {
    return NextResponse.json({ error: "WEAK_PASSWORD" }, { status: 400 })
  }

  let userId: string

  if (phone && code) {
    const profile = await (prisma as any).userProfile.findUnique({
      where: { phone },
      select: { userId: true },
    }).catch(() => null)
    if (!profile) {
      return NextResponse.json({ error: "INVALID_OR_USED_TOKEN" }, { status: 400 })
    }
    if (!(await consumeResetCodeAttempt(profile.userId))) return TOO_MANY_ATTEMPTS()
    const tokenHash = sha256Hex(code)
    const row = await (prisma as any).passwordResetToken.findFirst({
      where: { userId: profile.userId, tokenHash },
    }).catch(() => null)
    if (!row) {
      return NextResponse.json({ error: "INVALID_OR_USED_TOKEN" }, { status: 400 })
    }
    if (row.expiresAt && new Date(row.expiresAt).getTime() < Date.now()) {
      await (prisma as any).passwordResetToken.deleteMany({
        where: { userId: profile.userId, tokenHash },
      }).catch(() => {})
      return NextResponse.json({ error: "EXPIRED_TOKEN" }, { status: 400 })
    }
    userId = row.userId
    const passwordHash = await bcrypt.hash(newPassword, 12)
    try {
      await (prisma as any).$transaction(async (tx: any) => {
        await tx.appUser.update({
          where: { id: userId },
          data: { passwordHash },
        })
        await tx.passwordResetToken.deleteMany({
          where: { userId },
        })
      })
    } catch (txErr) {
      console.error("[password/reset/confirm] SMS transaction failed:", txErr)
      return NextResponse.json({ error: "RESET_FAILED" }, { status: 500 })
    }
    await afterSuccessfulReset(userId)
    return NextResponse.json({ ok: true })
  }

  if (email && code) {
    const user = await (prisma as any).appUser.findUnique({
      where: { email },
      select: { id: true },
    }).catch(() => null)
    if (!user) {
      return NextResponse.json({ error: "INVALID_OR_USED_TOKEN" }, { status: 400 })
    }
    // This branch also accepts the 6-digit SMS code (the lookup is by user, not
    // channel), so it spends from the same per-user guess budget.
    if (!(await consumeResetCodeAttempt(user.id))) return TOO_MANY_ATTEMPTS()
    const tokenHash = sha256Hex(code)
    const row = await (prisma as any).passwordResetToken.findFirst({
      where: { userId: user.id, tokenHash },
    }).catch(() => null)
    if (!row) {
      return NextResponse.json({ error: "INVALID_OR_USED_TOKEN" }, { status: 400 })
    }
    if (row.expiresAt && new Date(row.expiresAt).getTime() < Date.now()) {
      await (prisma as any).passwordResetToken.deleteMany({
        where: { userId: user.id, tokenHash },
      }).catch(() => {})
      return NextResponse.json({ error: "EXPIRED_TOKEN" }, { status: 400 })
    }
    userId = row.userId
    const passwordHash = await bcrypt.hash(newPassword, 12)
    try {
      await (prisma as any).$transaction(async (tx: any) => {
        await tx.appUser.update({
          where: { id: userId },
          data: { passwordHash },
        })
        await tx.passwordResetToken.deleteMany({
          where: { userId },
        })
      })
    } catch (txErr) {
      console.error("[password/reset/confirm] Email-code transaction failed:", txErr)
      return NextResponse.json({ error: "RESET_FAILED" }, { status: 500 })
    }
    await afterSuccessfulReset(userId)
    return NextResponse.json({ ok: true })
  }

  if (!token) {
    return NextResponse.json({ error: "MISSING_FIELDS" }, { status: 400 })
  }

  const tokenHash = sha256Hex(token)

  const row = await (prisma as any).passwordResetToken.findUnique({
    where: { tokenHash },
  }).catch(() => null)

  if (!row) {
    return NextResponse.json({ error: "INVALID_OR_USED_TOKEN" }, { status: 400 })
  }

  if (row.expiresAt && new Date(row.expiresAt).getTime() < Date.now()) {
    await (prisma as any).passwordResetToken.delete({ where: { tokenHash } }).catch(() => {})
    return NextResponse.json({ error: "EXPIRED_TOKEN" }, { status: 400 })
  }

  const passwordHash = await bcrypt.hash(newPassword, 12)

  try {
    await (prisma as any).$transaction(async (tx: any) => {
      await tx.appUser.update({
        where: { id: row.userId },
        data: { passwordHash },
      })

      await tx.passwordResetToken.delete({
        where: { tokenHash },
      })
    })
  } catch (txErr) {
    console.error("[password/reset/confirm] Transaction failed:", txErr)
    return NextResponse.json({ error: "RESET_FAILED" }, { status: 500 })
  }

  await afterSuccessfulReset(row.userId)
  return NextResponse.json({ ok: true })
}
