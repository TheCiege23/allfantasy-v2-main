import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getSessionAndProfile } from "@/lib/auth-guard"

export const runtime = "nodejs"

export async function GET(req: Request, props: { params: Promise<{ tournamentId: string }> }) {
  const params = await props.params
  const { userId, emailVerified, profile } = await getSessionAndProfile()
  if (!userId) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 })
  }

  if (!profile?.ageConfirmedAt) {
    return NextResponse.json({ error: "AGE_REQUIRED" }, { status: 403 })
  }

  if (!emailVerified && !profile?.phoneVerifiedAt) {
    return NextResponse.json({ error: "VERIFICATION_REQUIRED" }, { status: 403 })
  }

  const leagues = await (prisma as any).bracketLeague.findMany({
    where: {
      tournamentId: params.tournamentId,
      members: { some: { userId } },
    },
    select: {
      id: true,
      name: true,
      joinCode: true,
      ownerId: true,
      _count: { select: { entries: true, members: true } },
    },
    orderBy: { createdAt: "desc" },
  })

  return NextResponse.json({ ok: true, leagues })
}
