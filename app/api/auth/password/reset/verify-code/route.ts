import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { sha256Hex } from "@/lib/tokens"
import { consumeResetCodeAttempt } from "@/lib/auth/passwordResetAttempts"
import { normalizePhoneE164 } from "@/lib/phone/e164"

export const runtime = "nodejs"

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const email = String(body?.email || "").trim().toLowerCase()
  const phone = normalizePhoneE164(String(body?.phone || ""))
  const code = String(body?.code || "").trim()

  if (!code || (!email && !phone)) {
    return NextResponse.json({ error: "MISSING_FIELDS" }, { status: 400 })
  }

  const tokenHash = sha256Hex(code)

  let userId: string | null = null
  if (phone) {
    const profile = await (prisma as any).userProfile.findUnique({
      where: { phone },
      select: { userId: true },
    }).catch(() => null)
    userId = profile?.userId ?? null
  } else if (email) {
    const user = await (prisma as any).appUser.findUnique({
      where: { email },
      select: { id: true },
    }).catch(() => null)
    userId = user?.id ?? null
  }

  if (!userId) {
    return NextResponse.json({ error: "INVALID_OR_USED_TOKEN" }, { status: 400 })
  }

  // A yes/no answer about a guessed code is as good as the reset itself to an
  // attacker, so this spends from the same per-user budget as confirm.
  if (!(await consumeResetCodeAttempt(userId))) {
    return NextResponse.json({ error: "TOO_MANY_ATTEMPTS" }, { status: 429 })
  }

  const row = await (prisma as any).passwordResetToken.findFirst({
    where: { userId, tokenHash },
  }).catch(() => null)

  if (!row) {
    return NextResponse.json({ error: "INVALID_OR_USED_TOKEN" }, { status: 400 })
  }

  if (row.expiresAt && new Date(row.expiresAt).getTime() < Date.now()) {
    return NextResponse.json({ error: "EXPIRED_TOKEN" }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}
