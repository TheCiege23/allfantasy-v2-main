import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { fetchFantasyCalcValues, type FantasyCalcPlayer } from '@/lib/fantasycalc'
import { getAllPlayers, getLeagueInfo, getLeagueRosters, getLeagueUsers } from '@/lib/sleeper-client'
import { requireLegacySleeperIdentity } from '@/lib/legacy/requireLegacySleeperIdentity'

interface PositionData {
  position: string
  rank: number
  war: number
  color: string
  marketValue: number
  playerName?: string
  managerName?: string | null
}

interface PositionWARCurve {
  position: string
  color: string
  data: { rank: number; war: number; playerName: string; managerName: string | null }[]
}

export const POST = withApiUsage({ endpoint: "/api/legacy/rankings/league-format", tool: "LegacyRankingsLeagueFormat" })(async (request: NextRequest) => {
  try {
    const body = await request.json()
    const { league_id } = body

    const gate = await requireLegacySleeperIdentity(request, {
      requestedUsername: String(body?.sleeper_username || '').trim() || null,
      rateLimit: { action: 'league_format', maxRequests: 20, windowMs: 60_000 },
    })
    if (!gate.ok) return gate.response
    const sleeper_username = gate.identity.sleeperUsername

    if (!league_id) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const user = await prisma.legacyUser.findUnique({
      where: { sleeperUsername: sleeper_username.toLowerCase() },
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const [leagueData, rosters, playersData] = await Promise.all([
      getLeagueInfo(league_id),
      getLeagueRosters(league_id),
      getAllPlayers(),
    ])

    if (!leagueData || !Array.isArray(rosters) || rosters.length === 0) {
      return NextResponse.json({ error: 'Failed to fetch league data' }, { status: 500 })
    }

    const settings = leagueData.scoring_settings || {}
    const isPPR = (settings.rec || 0) >= 1
    const isHalfPPR = (settings.rec || 0) === 0.5
    const hasTEP = (settings.bonus_rec_te || 0) > 0

    const rosterPositions = leagueData.roster_positions || []
    const isSF = rosterPositions.filter((p: string) => p === 'QB' || p === 'SUPER_FLEX').length >= 2

    const qbSlots = rosterPositions.filter((p: string) => p === 'QB').length
    const rbSlots = rosterPositions.filter((p: string) => p === 'RB').length
    const wrSlots = rosterPositions.filter((p: string) => p === 'WR').length
    const teSlots = rosterPositions.filter((p: string) => p === 'TE').length
    const flexSlots = rosterPositions.filter((p: string) => p === 'FLEX').length
    const sfSlots = rosterPositions.filter((p: string) => p === 'SUPER_FLEX').length

    const positionColors: Record<string, string> = {
      QB: '#00CED1',
      RB: '#FF6B6B',
      WR: '#AA96DA',
      TE: '#F38181',
    }

    const numQbs = isSF ? 2 : 1
    const pprVal = isPPR ? 1 : isHalfPPR ? 0.5 : 0
    let fcPlayers: FantasyCalcPlayer[] = []
    try {
      fcPlayers = await fetchFantasyCalcValues({
        isDynasty: true,
        numQbs,
        numTeams: rosters.length || 12,
        ppr: pprVal,
      })
    } catch (err) {
      console.error('Failed to fetch FantasyCalc values:', err)
    }

    const fcBySleeperIdMap = new Map<string, FantasyCalcPlayer>()
    const fcByNameMap = new Map<string, FantasyCalcPlayer>()
    for (const p of fcPlayers) {
      if (p.player.sleeperId) fcBySleeperIdMap.set(p.player.sleeperId, p)
      fcByNameMap.set(p.player.name.toLowerCase(), p)
    }

    const usersData = await getLeagueUsers(league_id)
    const userMap = new Map(usersData.map((u: any) => [u.user_id, u]))

    const rosteredPlayerIds = new Set<string>()
    const playerToManager = new Map<string, string>()
    for (const roster of rosters) {
      const ownerInfo: any = userMap.get(roster.owner_id)
      const managerName = ownerInfo?.display_name || `Team ${roster.roster_id}`
      const playerIds = roster.players || []
      for (const pid of playerIds) {
        if (typeof pid === 'string' && !pid.match(/^\d{4}_/)) {
          rosteredPlayerIds.add(pid)
          playerToManager.set(pid, managerName)
        }
      }
    }

    const fcByPosition: Record<string, Array<{ name: string; value: number; positionRank: number; sleeperId: string; isRostered: boolean; managerName: string | null }>> = {
      QB: [], RB: [], WR: [], TE: [],
    }

    for (const fc of fcPlayers) {
      const pos = fc.player.position
      if (!['QB', 'RB', 'WR', 'TE'].includes(pos)) continue
      const sid = fc.player.sleeperId || ''
      const isRostered = !!(sid && rosteredPlayerIds.has(sid))
      fcByPosition[pos].push({
        name: fc.player.name,
        value: fc.value,
        positionRank: fc.positionRank,
        sleeperId: sid,
        isRostered,
        managerName: isRostered ? (playerToManager.get(sid) || null) : null,
      })
    }

    for (const pos of Object.keys(fcByPosition)) {
      fcByPosition[pos].sort((a, b) => b.value - a.value)
    }

    for (const pid of rosteredPlayerIds) {
      const sleeperPlayer = playersData[pid]
      if (!sleeperPlayer) continue
      const pos = sleeperPlayer.position
      if (!['QB', 'RB', 'WR', 'TE'].includes(pos)) continue

      const alreadyInFC = fcByPosition[pos].some(p => p.sleeperId === pid)
      if (alreadyInFC) continue

      const firstName = String(sleeperPlayer.first_name || '').trim()
      const lastName = String(sleeperPlayer.last_name || '').trim()
      const name = `${firstName} ${lastName}`.trim()

      const mgr = playerToManager.get(pid) || null
      const nameMatch = fcByNameMap.get(name.toLowerCase())
      if (nameMatch && !fcByPosition[pos].some(p => p.name.toLowerCase() === name.toLowerCase())) {
        fcByPosition[pos].push({
          name,
          value: nameMatch.value,
          positionRank: nameMatch.positionRank,
          sleeperId: pid,
          isRostered: true,
          managerName: mgr,
        })
      } else if (!nameMatch) {
        fcByPosition[pos].push({
          name,
          value: 0,
          positionRank: 999,
          sleeperId: pid,
          isRostered: true,
          managerName: mgr,
        })
      }

      fcByPosition[pos].sort((a, b) => b.value - a.value)
    }

    const totalTeams = rosters.length || 12
    const getStartersNeeded = (pos: string): number => {
      switch (pos) {
        case 'QB': return qbSlots + (isSF ? sfSlots : 0)
        case 'RB': return rbSlots + Math.floor(flexSlots * 0.5)
        case 'WR': return wrSlots + Math.ceil(flexSlots * 0.4)
        case 'TE': return teSlots + Math.floor(flexSlots * 0.1)
        default: return 1
      }
    }

    const warCurves: PositionWARCurve[] = []
    const scatterData: PositionData[] = []

    for (const pos of ['QB', 'RB', 'WR', 'TE']) {
      const group = fcByPosition[pos]
      if (group.length === 0) continue

      const startersNeeded = getStartersNeeded(pos)
      const replacementIdx = Math.min(startersNeeded * totalTeams - 1, group.length - 1)
      const replacementValue = replacementIdx >= 0 ? group[Math.max(0, replacementIdx)].value : 0
      const divisor = Math.max(replacementValue, 200)

      const curveData: { rank: number; war: number; playerName: string; managerName: string | null }[] = []
      for (let i = 0; i < group.length; i++) {
        const player = group[i]
        const war = (player.value - replacementValue) / divisor

        const warRounded = Math.round(war * 100) / 100
        curveData.push({ rank: i + 1, war: warRounded, playerName: player.name, managerName: player.managerName })

        scatterData.push({
          position: pos,
          rank: i + 1,
          war: warRounded,
          color: positionColors[pos],
          marketValue: Math.round(player.value),
          playerName: player.name,
          managerName: player.managerName,
        })
      }

      warCurves.push({
        position: pos,
        color: positionColors[pos],
        data: curveData,
      })
    }

    const formatDescription = [
      `${rosters.length} Team`,
      isPPR ? 'PPR' : isHalfPPR ? 'Half PPR' : 'Standard',
      isSF ? 'Superflex' : '1QB',
      hasTEP ? 'TEP' : null,
    ].filter(Boolean).join(' • ')

    const posValueTotals: Record<string, number> = {}
    for (const pos of ['QB', 'RB', 'WR', 'TE']) {
      posValueTotals[pos] = fcByPosition[pos].filter(p => p.isRostered).reduce((sum, p) => sum + p.value, 0)
    }
    const totalValue = Object.values(posValueTotals).reduce((a, b) => a + b, 0)

    const insights: string[] = []
    if (totalValue > 0) {
      const qbPct = posValueTotals['QB'] / totalValue * 100
      const rbPct = posValueTotals['RB'] / totalValue * 100
      const wrPct = posValueTotals['WR'] / totalValue * 100
      const tePct = posValueTotals['TE'] / totalValue * 100

      if (isSF) {
        insights.push(`QB value significantly elevated due to Superflex format (${qbPct.toFixed(0)}% of total league value)`)
      } else {
        insights.push(`QB value moderate in 1QB format (${qbPct.toFixed(0)}% of total league value)`)
      }

      if (isPPR) {
        insights.push(`WR value boosted in PPR at ${wrPct.toFixed(0)}% of league value — prioritize target share`)
      } else {
        insights.push(`RB value elevated in ${isHalfPPR ? 'half PPR' : 'standard'} at ${rbPct.toFixed(0)}% of league value`)
      }

      if (hasTEP) {
        insights.push(`Elite TEs carry premium value with TE premium scoring (${tePct.toFixed(0)}% of total)`)
      } else {
        insights.push(`TE value standard at ${tePct.toFixed(0)}% — focus on elite options only`)
      }

      insights.push(`${rbSlots + Math.floor(flexSlots / 2)} RB starters create ${rbPct > 30 ? 'high' : 'moderate'} scarcity at the position`)
      insights.push(`${wrSlots + Math.ceil(flexSlots / 2)} WR starters provide ${wrPct > 30 ? 'strong' : 'moderate'} depth opportunities`)
    } else {
      insights.push(isSF ? 'QB value significantly elevated due to Superflex format' : 'QB value lower in 1QB format')
      insights.push(isPPR ? 'WR value boosted in PPR - prioritize target share' : 'RB value elevated in non-PPR')
      insights.push(hasTEP ? 'Elite TEs carry premium value with TE premium scoring' : 'TE value standard - focus on elite options only')
    }

    return NextResponse.json({
      warCurves,
      scatterData,
      leagueSettings: {
        name: leagueData.name,
        totalTeams: rosters.length,
        format: formatDescription,
        isPPR,
        isHalfPPR,
        hasTEP,
        isSF,
        qbSlots,
        rbSlots,
        wrSlots,
        teSlots,
        flexSlots,
        sfSlots,
      },
      insights,
      presets: ['WAR View', 'Trade Value', 'ADP Comparison'],
    })
  } catch (error) {
    console.error('League format error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
