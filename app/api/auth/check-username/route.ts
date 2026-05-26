import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { containsProfanity } from "@/lib/profanity"
import { validateUsername } from "@/lib/auth/username-validation"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const raw = searchParams?.get("username") || ""

  const validation = validateUsername(raw)
  if (!validation.ok) {
    // Distinguish empty vs format error for callers that check `ok`
    return NextResponse.json({
      ok: validation.reason === "Username is required" ? false : true,
      available: false,
      reason: validation.reason === "Username is required" ? "empty" : "format",
    })
  }

  const { normalized } = validation

  if (containsProfanity(normalized)) {
    return NextResponse.json({ ok: true, available: false, reason: "profanity" })
  }

  try {
    const existing = await prisma.appUser.findFirst({
      where: { username: { equals: normalized, mode: "insensitive" } },
      select: { id: true },
    })

    return NextResponse.json({
      ok: true,
      available: !existing,
      reason: existing ? "taken" : "ok",
      status: existing ? "taken" : "ok",
      verified: true,
    })
  } catch (e) {
    console.error("[check-username] DB error:", e)
    return NextResponse.json(
      {
        ok: true,
        available: true,
        reason: "unchecked",
        status: "unchecked",
        verified: false,
      },
      { status: 200 }
    )
  }
}
