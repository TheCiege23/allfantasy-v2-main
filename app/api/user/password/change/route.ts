import { NextResponse, type NextRequest } from "next/server"
import { getServerSession } from "next-auth"
import { getToken } from "next-auth/jwt"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import bcrypt from "bcryptjs"
import { isStrongPassword } from "@/lib/tokens"
import { clearPasswordGuesses, spendPasswordGuess } from "@/lib/auth/passwordGuessBudget"
import { revokeAllSessionsForUser } from "@/lib/auth/sessionRevocation"
import { resolveAuthSecret } from "@/lib/auth/resolve-auth-secret"

export const dynamic = "force-dynamic"

/**
 * POST /api/user/password/change
 * Change password when user is logged in. Requires currentPassword and newPassword.
 */
export async function POST(req: NextRequest) {
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

  // Spent BEFORE the compare, from the same per-account budget as sign-in, so a stolen session
  // cannot grind the current password here without limit (lib/auth/passwordGuessBudget).
  if (!(await spendPasswordGuess(session.user.id))) {
    return NextResponse.json(
      { error: "TOO_MANY_ATTEMPTS", message: "Too many incorrect passwords. Try again in 15 minutes." },
      { status: 429 }
    )
  }

  const valid = await bcrypt.compare(currentPassword, user.passwordHash)
  if (!valid) {
    return NextResponse.json(
      { error: "WRONG_PASSWORD", message: "Current password is incorrect." },
      { status: 400 }
    )
  }

  await clearPasswordGuesses(session.user.id)

  const passwordHash = await bcrypt.hash(newPassword, 12)
  await (prisma as any).appUser.update({
    where: { id: session.user.id },
    data: { passwordHash },
  })

  /*
   * 🛑 A NEW PASSWORD SIGNS EVERY OTHER DEVICE OUT. Changing it is what someone does when they think
   * the account is compromised, and sessions are 30-day JWTs: without this, a stolen session kept
   * working after the change. Spares only THIS device's session (its `sid`), and only when the
   * token is provably the signed-in user's own. A token from before sids existed cannot be spared,
   * so that device is signed out too — the safe direction.
   *
   * Best-effort: the password already changed. `otherSessionsSignedOut: false` means the
   * revocation was not recorded (Redis down or unset), so other devices may still be signed in.
   */
  const secret = resolveAuthSecret()
  const jwt = secret ? await getToken({ req, secret }).catch(() => null) : null
  const currentSid = jwt && jwt.id === session.user.id && typeof jwt.sid === "string" ? jwt.sid : null
  const otherSessionsSignedOut = await revokeAllSessionsForUser(session.user.id, undefined, {
    exceptSid: currentSid,
  }).catch(() => false)

  return NextResponse.json({ ok: true, otherSessionsSignedOut })
}
