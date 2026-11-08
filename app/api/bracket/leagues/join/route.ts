import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireVerifiedUser } from "@/lib/auth-guard"
import { validateInviteCode, normalizeJoinCode } from "@/lib/league-invite"
import { cfpInviteChallengeId, isPrivateCfpPool, verifyCfpInvite } from "@/lib/playoffs/cfpInvite"

export const runtime = "nodejs"

export async function POST(req: Request) {
  const auth = await requireVerifiedUser()
  if (!auth.ok) return auth.response

  const body = await req.json().catch(() => ({}))
  const rawCode = body?.joinCode ?? body?.code
  if (!rawCode) return NextResponse.json({ error: "Missing joinCode" }, { status: 400 })

  if (typeof rawCode === "string" && rawCode.trim().toUpperCase().startsWith("CFP1")) {
    const id = cfpInviteChallengeId(rawCode)
    const challenge = id && verifyCfpInvite(id, rawCode)
      ? await prisma.playoffBracketChallenge.findUnique({ where: { id }, select: { id: true, sport: true, config: true } })
      : null
    if (!challenge || !isPrivateCfpPool(challenge.sport, challenge.config)) {
      return NextResponse.json({ error: "Invalid code" }, { status: 404 })
    }
    return NextResponse.json({ ok: true, leagueId: challenge.id, cfpInvite: true })
  }

  const joinCode = normalizeJoinCode(rawCode)
  const validation = await validateInviteCode(joinCode, { userId: auth.userId })

  if (!validation.valid) {
    if (validation.error === "INVALID_CODE")
      return NextResponse.json({ error: "Invalid code" }, { status: 404 })
    if (validation.error === "EXPIRED")
      return NextResponse.json({ error: "Invite expired" }, { status: 410 })
    if (validation.error === "LEAGUE_FULL")
      return NextResponse.json({ error: "League is full" }, { status: 409 })
    if (validation.error === "ALREADY_MEMBER")
      return NextResponse.json({ error: "Already a member" }, { status: 409 })
    return NextResponse.json({ error: validation.error }, { status: 400 })
  }

  const leagueId = validation.preview.leagueId

  await (prisma as any).bracketLeagueMember.upsert({
    where: {
      leagueId_userId: {
        leagueId,
        userId: auth.userId,
      },
    },
    update: {},
    create: {
      leagueId,
      userId: auth.userId,
      role: "MEMBER",
    },
  })

  return NextResponse.json({ ok: true, leagueId })
}
