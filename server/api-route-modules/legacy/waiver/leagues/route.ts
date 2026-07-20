import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireLegacySleeperIdentity } from '@/lib/legacy/requireLegacySleeperIdentity'

export const GET = withApiUsage({ endpoint: "/api/legacy/waiver/leagues", tool: "LegacyWaiverLeagues" })(async (request: NextRequest) => {
  // Read the caller's claim ONLY to cross-check it — the lookup below uses the
  // server-resolved identity. This route previously selected on the raw query
  // param with no gate at all, so `?sleeper_username=<anyone>` returned that
  // person's full league list.
  const requestedUsername = request.nextUrl.searchParams?.get('sleeper_username')

  // allowGuest: the waiver surface is reachable straight after a guest import,
  // before any account exists.
  const gate = await requireLegacySleeperIdentity(request, {
    allowGuest: true,
    requestedUsername,
  })
  if (!gate.ok) return gate.response
  const sleeperUsername = gate.identity.sleeperUsername

  try {
    const user = await prisma.legacyUser.findUnique({
      where: { sleeperUsername: sleeperUsername.toLowerCase() },
      include: {
        leagues: {
          where: {
            season: { gte: 2024 },
          },
          orderBy: { season: 'desc' },
        },
      },
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const leagues = user.leagues.map(l => ({
      league_id: l.sleeperLeagueId,
      name: l.name,
      season: l.season,
      sport: l.sport || 'nfl',
      scoring: l.scoringType,
      team_count: l.teamCount,
      league_type: l.leagueType,
      is_sf: l.isSF,
      is_tep: l.isTEP,
    }))

    return NextResponse.json({
      ok: true,
      leagues,
      count: leagues.length,
    })
  } catch (error: any) {
    console.error('Get leagues error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
})

