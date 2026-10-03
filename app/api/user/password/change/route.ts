import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import bcrypt from "bcryptjs"
import { isStrongPassword } from "@/lib/tokens"

export const dynamic = "force-dynamic"

/**
 * POST /api/user/password/change
 * Change password when user is logged in. Requires currentPassword and newPassword.
 */
export async function POST(req: Request) {
  const session = (await getServerSession(authOptions as any)) as {
    user?: { id?: string }
  } | null

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  /*
   * ⚠ NO .trim(). Sign-in (lib/auth.ts), signup and password reset all keep a password exactly as
   * typed; this route alone trimmed, so a new password with an edge space was stored without it and
   * then failed at login typed the way it was chosen. One rule everywhere: bytes as typed.
   */
  const currentPassword = String(body?.currentPassword ?? "")
  const newPassword = String(body?.newPassword ?? "")

  if (!currentPassword || !newPassword) {
    return NextResponse.json(
      { error: "MISSING_FIELDS", message: "Current password and new password are required." },
      { status: 400 }
    )
  }

  if (!isStrongPassword(newPassword)) {
    return NextResponse.json(
      { error: "WEAK_PASSWORD", message: "New password must be at least 8 characters and include letters and numbers." },
      { status: 400 }
    )
  }

  const user = await (prisma as any).appUser.findUnique({
    where: { id: session.user.id },
    select: { passwordHash: true },
  })

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (!user.passwordHash) {
    return NextResponse.json(
      { error: "NO_PASSWORD", message: "This account uses a sign-in method without a password. Use forgot password to set one." },
      { status: 400 }
    )
  }

  const valid = await bcrypt.compare(currentPassword, user.passwordHash)
  if (!valid) {
    return NextResponse.json(
      { error: "WRONG_PASSWORD", message: "Current password is incorrect." },
      { status: 400 }
    )
  }

  const passwordHash = await bcrypt.hash(newPassword, 12)
  await (prisma as any).appUser.update({
    where: { id: session.user.id },
    data: { passwordHash },
  })

  return NextResponse.json({ ok: true })
}
