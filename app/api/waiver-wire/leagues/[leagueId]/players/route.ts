import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { getRosterPlayerIds } from "@/lib/waiver-wire/roster-utils"
import { getNormalizedPlayerData } from "@/lib/player-data/getNormalizedPlayerData"
import { serializeUnifiedPlayerForApi } from "@/lib/player-data/serializeUnifiedPlayerForApi"
import { soccerLeagueHintFromLeagueSettings } from "@/lib/player-data/leagueSoccerLeagueHint"
import { resolveIncludePlayerDataDiagnostics, logPrefixForSurface } from "@/lib/player-data/providerFallbackDiagnostics"

/**
 * GET: list players available to add (not on any roster in this league).
 * Query: sport (default from league), limit, q, position, teamId.
 * Returns provider-prioritized unified rows (`UnifiedPlayerWireDto`) plus legacy-compatible id/name/position/team on each row.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { leagueId: string } }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const leagueId = params.leagueId
  const [league, rosterAsMember] = await Promise.all([
    (prisma as any).league.findFirst({
      where: { id: leagueId },
      select: { id: true, sport: true, leagueVariant: true, userId: true, settings: true },
    }),
    (prisma as any).roster.findFirst({ where: { leagueId, platformUserId: userId }, select: { id: true } }),
  ])
  if (!league) return NextResponse.json({ error: "League not found" }, { status: 404 })
  if (league.userId !== userId && !rosterAsMember) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const sport = req.nextUrl.searchParams?.get("sport") ?? (league.sport ?? "NFL")
  const normalizedSport = String(sport || '').toUpperCase()
  const leagueSportUpper = String(league.sport ?? 'NFL').toUpperCase()
  if (normalizedSport !== leagueSportUpper) {
    return NextResponse.json(
      { error: 'Sport mismatch: waiver player pool must match league sport.' },
      { status: 400 }
    )
  }
  const limit = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams?.get("limit") || "100")))
  const q = (req.nextUrl.searchParams?.get("q") ?? "").trim().toLowerCase()
  const position = req.nextUrl.searchParams?.get("position") ?? undefined
  const teamId = req.nextUrl.searchParams?.get("teamId") ?? undefined

  const rosters = await (prisma as any).roster.findMany({
    where: { leagueId },
    select: { playerData: true },
  })
  const rosteredIds = new Set<string>()
  for (const r of rosters) {
    getRosterPlayerIds(r.playerData).forEach((id) => rosteredIds.add(id))
  }

  const soccerHint =
    soccerLeagueHintFromLeagueSettings(league.settings) ??
    undefined

  const diag = resolveIncludePlayerDataDiagnostics(req.nextUrl.searchParams)
  const unified = await getNormalizedPlayerData({
    surface: 'waivers',
    leagueId,
    limit,
    soccerLeague: soccerHint,
    waiverSearch: q || null,
    waiverPosition: position ?? null,
    waiverTeamId: teamId ?? null,
    includeProviderFallbackDiagnostics: diag,
  })

  const players = unified.map(serializeUnifiedPlayerForApi)
  if (diag && process.env.NODE_ENV === 'development') {
    for (const row of unified.slice(0, 5)) {
      const d = row.providerFallbackDiagnostics
      if (d) console.info(logPrefixForSurface('waiver', d))
    }
  }

  return NextResponse.json({ players, rosteredCount: rosteredIds.size })
}
