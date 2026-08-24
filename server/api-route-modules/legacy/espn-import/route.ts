import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { fetchEspnLeague, findTeamByName } from '@/lib/espn-client'
import { getSessionAndProfile } from '@/lib/auth-guard'
import { consumeRateLimit, getClientIp, buildRateLimit429 } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

export const POST = withApiUsage({ endpoint: "/api/legacy/espn-import", tool: "LegacyEspnImport" })(async (req: NextRequest) => {
  try {
    /*
     * ⚠ GUESTS ARE ALLOWED HERE ON PURPOSE. This endpoint is a stateless READ
     * of a public ESPN league (it writes nothing), yet it required a verified
     * user while the af-legacy trial funnel offered its tab to guests — every
     * guest submit died as a raw 401 "UNAUTHENTICATED" (verified live with a
     * public league). Guests get the same anti-abuse shape the Sleeper
     * guest-import route uses: tight per-league+IP cooldown plus a looser
     * per-IP cap. Signed-in users skip the tight limit.
     */
    const { userId } = await getSessionAndProfile()
    if (!userId) {
      const ip = getClientIp(req)
      const perIpLimit = consumeRateLimit({
        scope: 'legacy',
        action: 'guest_espn_import_ip',
        sleeperUsername: null,
        ip,
        maxRequests: 10,
        windowMs: 10 * 60_000,
        includeIpInKey: true,
      })
      if (!perIpLimit.success) {
        return NextResponse.json(
          buildRateLimit429({ message: 'Too many imports from this connection. Please try again shortly.', rl: perIpLimit }),
          { status: 429 },
        )
      }
    }

    const body = await req.json()
    const leagueIdRaw = String(body.league_id || '').trim()
    const teamName = String(body.team_name || '').trim()
    const seasonRaw = body.season ? Number(body.season) : undefined

    const leagueId = leagueIdRaw.replace(/\D/g, '')
    if (!leagueId) {
      return NextResponse.json({ error: 'Missing or invalid ESPN league ID' }, { status: 400 })
    }
    if (!teamName) {
      return NextResponse.json({ error: 'Missing team name' }, { status: 400 })
    }

    const league = await fetchEspnLeague(leagueId, seasonRaw)

    const userTeam = findTeamByName(league.teams, teamName)
    if (!userTeam) {
      return NextResponse.json({
        error: `Team "${teamName}" not found in this league.`,
        availableTeams: league.teams.map(t => t.name),
      }, { status: 404 })
    }

    const otherTeams = league.teams
      .filter(t => t.id !== userTeam.id)
      .map(t => ({
        teamId: t.id,
        name: t.name,
        abbrev: t.abbrev,
        record: `${t.record.wins}-${t.record.losses}${t.record.ties > 0 ? `-${t.record.ties}` : ''}`,
        pointsFor: Math.round(t.record.pointsFor * 100) / 100,
        roster: t.roster.map(r => ({
          name: r.name,
          position: r.position,
          nflTeam: r.nflTeam,
          slot: r.slot,
        })),
      }))

    return NextResponse.json({
      success: true,
      league: {
        leagueId: league.leagueId,
        name: league.leagueName,
        season: league.seasonId,
        numTeams: league.numTeams,
        scoringType: league.scoringType,
        platform: 'espn',
      },
      userTeam: {
        teamId: userTeam.id,
        name: userTeam.name,
        abbrev: userTeam.abbrev,
        record: `${userTeam.record.wins}-${userTeam.record.losses}${userTeam.record.ties > 0 ? `-${userTeam.record.ties}` : ''}`,
        pointsFor: Math.round(userTeam.record.pointsFor * 100) / 100,
        roster: userTeam.roster.map(r => ({
          name: r.name,
          position: r.position,
          nflTeam: r.nflTeam,
          slot: r.slot,
        })),
      },
      otherTeams,
    })
  } catch (e: any) {
    console.error('[ESPN Import] Error:', e)
    return NextResponse.json(
      { error: e.message || 'Failed to fetch ESPN league data' },
      { status: e.message?.includes('not found') || e.message?.includes('private') ? 400 : 500 }
    )
  }
})
