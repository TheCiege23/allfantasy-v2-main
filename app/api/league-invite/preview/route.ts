import { NextRequest, NextResponse } from "next/server"
import { getLeaguePreviewByCode } from "@/lib/league-invite"
import { prisma } from "@/lib/prisma"
import { cfpInviteChallengeId, isPrivateCfpPool, verifyCfpInvite } from "@/lib/playoffs/cfpInvite"

export const runtime = "nodejs"

/**
 * GET /api/league-invite/preview?code=XXX
 * Public: returns league preview for an invite code (for join page).
 * Optional: ?userId= for already-member check (e.g. from session on client).
 */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams?.get("code")
  const userId = req.nextUrl.searchParams?.get("userId") ?? undefined

  if (code?.trim().toUpperCase().startsWith("CFP1")) {
    const id = cfpInviteChallengeId(code)
    const challenge = id && verifyCfpInvite(id, code)
      ? await prisma.playoffBracketChallenge.findUnique({
          where: { id }, select: { id: true, name: true, sport: true, seasonYear: true, config: true, entries: { select: { userId: true } } },
        })
      : null
    if (!challenge || !isPrivateCfpPool(challenge.sport, challenge.config)) {
      return NextResponse.json({ ok: false, error: "INVALID_CODE" }, { status: 404 })
    }
    const config = challenge.config as { maxParticipants?: number } | null
    const memberCount = new Set(challenge.entries.map(entry => entry.userId)).size
    const maxManagers = config?.maxParticipants ?? 50
    return NextResponse.json({ ok: true, preview: {
      leagueId: challenge.id, name: challenge.name, tournamentName: "College Football Playoff",
      tournamentSeason: String(challenge.seasonYear), memberCount, maxManagers,
      isFull: memberCount >= maxManagers, expired: false, joinCode: code,
    } })
  }

  const result = await getLeaguePreviewByCode(code, { userId: userId || null })

  if (result.ok) {
    return NextResponse.json({ ok: true, preview: result.preview })
  }

  const status =
    result.error === "INVALID_CODE"
      ? 404
      : result.error === "EXPIRED"
        ? 410
        : result.error === "LEAGUE_FULL"
          ? 409
          : 400
  return NextResponse.json(
    {
      ok: false,
      error: result.error,
      preview: result.preview ?? undefined,
    },
    { status }
  )
}

