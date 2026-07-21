import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { fetchFantasyCalcValues, type FantasyCalcSettings } from '@/lib/fantasycalc'
import { computeAdaptiveRankings, type RankingView } from '@/lib/rankings-engine/adaptive-rankings'
import { requireLegacySleeperIdentity } from '@/lib/legacy/requireLegacySleeperIdentity'
import { computeLeagueDemandIndex } from '@/lib/rankings-engine/league-demand-index'
import type { LeagueRosterConfig } from '@/lib/vorp-engine'
import { getLeagueInfo, getLeagueRosters } from '@/lib/sleeper-client'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const VALID_VIEWS: RankingView[] = ['global', 'league', 'team', 'win_now', 'rebuild', 'consolidate']

export const POST = withApiUsage({ endpoint: "/api/legacy/rankings/adaptive", tool: "LegacyRankingsAdaptive" })(async (req: NextRequest) => {
  // Rate limit now runs inside the identity gate below, keyed on the authenticated actor
  // rather than the IP alone — see requireLegacySleeperIdentity.
  try {
    const body = await req.json()
    const leagueId = String(body?.league_id || '').trim()
    const view = (String(body?.view || 'global') as RankingView)
    const limit = Math.min(Math.max(Number(body?.limit) || 200, 10), 500)
    const positionFilter = String(body?.position || '').toUpperCase() || null

    const gate = await requireLegacySleeperIdentity(req, {
      requestedUsername: String(body?.sleeper_username || '').trim() || null,
      rateLimit: { action: 'adaptive_rankings', maxRequests: 10, windowMs: 60_000 },
    })
    if (!gate.ok) return gate.response
    const username = gate.identity.sleeperUsername

    if (!leagueId) {
      return NextResponse.json({ error: 'Missing league_id' }, { status: 400 })
    }

    if (!VALID_VIEWS.includes(view)) {
      return NextResponse.json({ error: 'Invalid view. Use: global, league, team, win_now, rebuild, or consolidate' }, { status: 400 })
    }

    const user = await prisma.legacyUser.findUnique({
      where: { sleeperUsername: username.toLowerCase() },
    })
    if (!user) {
      return NextResponse.json({ error: 'User not found. Import your Sleeper account first.' }, { status: 404 })
    }

    const [league, rosters] = await Promise.all([
      getLeagueInfo(leagueId),
      getLeagueRosters(leagueId),
    ])

    if (!league || !Array.isArray(rosters) || rosters.length === 0) {
      return NextResponse.json({ error: 'Failed to fetch league data from Sleeper' }, { status: 502 })
    }

    const rosterPositions: string[] = league.roster_positions || []
    const isSF = rosterPositions.filter((p: string) => p === 'SUPER_FLEX').length > 0
    const numTeams = rosters.length || league.total_rosters || 12

    const config: LeagueRosterConfig = {
      numTeams,
      startingQB: rosterPositions.filter((p: string) => p === 'QB').length || 1,
      startingRB: rosterPositions.filter((p: string) => p === 'RB').length || 2,
      startingWR: rosterPositions.filter((p: string) => p === 'WR').length || 2,
      startingTE: rosterPositions.filter((p: string) => p === 'TE').length || 1,
      startingFlex: rosterPositions.filter((p: string) => ['FLEX', 'SUPER_FLEX', 'REC_FLEX'].includes(p)).length || 2,
      superflex: isSF,
    }

    const ppr = league.scoring_settings?.rec === 1 ? 1 : league.scoring_settings?.rec === 0.5 ? 0.5 : 0
    const fcSettings: FantasyCalcSettings = {
      isDynasty: (league.settings?.type === 2),
      numQbs: isSF ? 2 : 1,
      numTeams,
      ppr: ppr as 0 | 0.5 | 1,
    }

    const userRoster = rosters.find((r: any) =>
      r.owner_id === user.sleeperUserId
    )
    const userPlayerIds: string[] = userRoster?.players?.filter(Boolean) || []

    const [fcPlayers, ldi] = await Promise.all([
      fetchFantasyCalcValues(fcSettings),
      computeLeagueDemandIndex(leagueId),
    ])

    const rankings = computeAdaptiveRankings(
      fcPlayers,
      userPlayerIds,
      config,
      ldi,
      view,
      limit,
    )

    let filteredPlayers = rankings.players
    if (positionFilter && ['QB', 'RB', 'WR', 'TE'].includes(positionFilter)) {
      filteredPlayers = filteredPlayers.filter(p => p.position === positionFilter)
    }

    return NextResponse.json({
      success: true,
      view,
      players: filteredPlayers,
      leagueDemandIndex: {
        tradesAnalyzed: ldi.tradesAnalyzed,
        positionDemand: ldi.positionDemand,
        pickDemand: ldi.pickDemand,
        hotPlayers: ldi.hotPlayers.slice(0, 10),
      },
      meta: {
        totalPlayers: rankings.totalPlayers,
        userRosterSize: rankings.userRosterSize,
        leagueName: league.name,
        leagueType: fcSettings.isDynasty ? 'Dynasty' : 'Redraft',
        scoring: ppr === 1 ? 'PPR' : ppr === 0.5 ? 'Half PPR' : 'Standard',
        isSF,
        numTeams,
      },
      leagueConfig: config,
    })

  } catch (error: any) {
    console.error('Adaptive rankings error:', error)
    return NextResponse.json({ error: error.message || 'Failed to compute rankings' }, { status: 500 })
  }
})

export const GET = withApiUsage({ endpoint: "/api/legacy/rankings/adaptive", tool: "LegacyRankingsAdaptive" })(async () => {
  return NextResponse.json({
    message: 'AllFantasy Adaptive Rankings API — Multi-dimensional player rankings',
    usage: {
      method: 'POST',
      body: {
        league_id: 'Sleeper league ID',
        sleeper_username: 'Your Sleeper username',
        view: 'global | league | team (default: global)',
        position: '(optional) QB | RB | WR | TE',
        limit: '(optional) 10-500, default 200',
      },
    },
    dimensions: ['Market Score (MS)', 'Impact Score (IS)', 'Scarcity Score (SS)', 'Demand Score (DS)'],
    views: {
      global: 'Market consensus (45% MS + 35% IS + 20% SS)',
      league: 'League-aware (35% MS + 30% IS + 15% SS + 20% DS)',
      team: 'Your roster fit (15% MS + 35% IS + 35% SS + 15% DS)',
      win_now: 'Win now intent (20% MS + 55% IS + 20% SS + 5% DS)',
      rebuild: 'Rebuild intent (55% MS + 15% IS + 10% SS + 20% DS)',
      consolidate: 'Consolidate intent (55% (MS+DS)/2 + 30% IS + 15% SS)',
    },
  })
})
