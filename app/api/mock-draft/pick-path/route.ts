import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getLiveADP, type ADPEntry } from '@/lib/adp-data'
import { applyRealtimeAdpAdjustments } from '@/lib/mock-draft/adp-realtime-adjuster'
import { buildManagerDNAFromLeague, type ManagerDNA } from '@/lib/mock-draft/manager-dna'
import { resolveLeagueMockTeamCount, MAX_LEAGUE_MOCK_TEAMS, mockRoundOrder, mockTeamPickOveralls, type MockDraftOrder } from '@/lib/mock-draft/mockTeamCount'
import { resolveLeagueMockDraftOrder } from '@/lib/mock-draft/leagueMockDraftOrder'

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}



const POSITION_TARGETS: Record<string, number> = { QB: 2, RB: 5, WR: 5, TE: 2 }

function scorePlayer(
  player: ADPEntry,
  profile: { tendency: Record<string, number>; rosterCounts: Record<string, number>; panicScore?: number; reachFrequency?: number },
  overall: number,
  recentPositionRun?: string
): number {
  const pos = player.position
  const needBoost = clamp((POSITION_TARGETS[pos] ?? 2) - (profile.rosterCounts[pos] ?? 0), -2, 4)
  const tendencyBoost = profile.tendency[pos] ?? 1
  const adpDelta = clamp((player.adp - overall) / 20, -2, 2)
  const valueBoost = clamp((player.value ?? 2500) / 2500, 0.6, 2)

  const reachMod = (profile.reachFrequency || 0.3) > 0.5 ? adpDelta * 0.15 : 0
  let panicMod = 0
  if (recentPositionRun && recentPositionRun === pos) {
    panicMod = (profile.panicScore || 0.3) * 0.35
  }

  return 1 + needBoost * 0.25 + tendencyBoost * 0.22 + adpDelta * 0.18 + valueBoost * 0.14 + reachMod + panicMod
}

function pickWeighted(candidates: ADPEntry[], weights: number[]): ADPEntry {
  const total = weights.reduce((a, b) => a + b, 0)
  let r = Math.random() * total
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i]
    if (r <= 0) return candidates[i]
  }
  return candidates[candidates.length - 1]
}

type ScenarioResult = {
  player: string
  position: string
  probability: number
  why: string
}

type PickPathEntry = {
  overall: number
  round: number
  pick: number
  baseline: ScenarioResult[]
  playerGone: { removedPlayer: string; fallbacks: ScenarioResult[] } | null
  rbRun: { pivot: ScenarioResult[]; narrative: string }
  qbRun: { recommendation: ScenarioResult[]; narrative: string }
}

function runScenarioSims(
  pool: ADPEntry[],
  managerProfiles: Array<{ manager: string; tendency: Record<string, number>; rosterCounts: Record<string, number>; panicScore?: number; reachFrequency?: number }>,
  teamCount: number,
  rounds: number,
  draftOrder: MockDraftOrder,
  userPickOveralls: Set<number>,
  simulations: number,
  scenarioMod?: {
    removePlayer?: string
    rbRunBefore?: number
    qbRunBefore?: number
  }
): Map<number, Map<string, number>> {
  const pickOutcomes: Map<number, Map<string, number>> = new Map()

  for (let s = 0; s < simulations; s++) {
    let available = [...pool]

    if (scenarioMod?.removePlayer) {
      const norm = scenarioMod.removePlayer.toLowerCase()
      available = available.filter(p => p.name.toLowerCase() !== norm)
    }

    const counts = managerProfiles.map(m => ({
      ...m,
      rosterCounts: { QB: 0, RB: 0, WR: 0, TE: 0 },
    }))
    const recentPicks: string[] = []

    let overall = 1
    for (let round = 1; round <= rounds; round++) {
      const order = mockRoundOrder(teamCount, round, draftOrder)
      for (let pick = 1; pick <= teamCount; pick++) {
        const managerIdx = order[pick - 1]
        const profile = counts[managerIdx]

        if (scenarioMod?.rbRunBefore && overall < scenarioMod.rbRunBefore && overall >= scenarioMod.rbRunBefore - 3) {
          const rbs = available.filter(p => p.position === 'RB').slice(0, 5)
          if (rbs.length > 0) {
            const chosen = rbs[Math.floor(Math.random() * Math.min(3, rbs.length))]
            const avIdx = available.findIndex(p => p.name === chosen.name)
            if (avIdx >= 0) available.splice(avIdx, 1)
            if (chosen.position in profile.rosterCounts) {
              profile.rosterCounts[chosen.position as keyof typeof profile.rosterCounts]++
            }
            recentPicks.push(chosen.position)
            overall++
            continue
          }
        }

        if (scenarioMod?.qbRunBefore && overall < scenarioMod.qbRunBefore && overall >= scenarioMod.qbRunBefore - 3) {
          const qbs = available.filter(p => p.position === 'QB').slice(0, 5)
          if (qbs.length > 0) {
            const chosen = qbs[Math.floor(Math.random() * Math.min(3, qbs.length))]
            const avIdx = available.findIndex(p => p.name === chosen.name)
            if (avIdx >= 0) available.splice(avIdx, 1)
            if (chosen.position in profile.rosterCounts) {
              profile.rosterCounts[chosen.position as keyof typeof profile.rosterCounts]++
            }
            recentPicks.push(chosen.position)
            overall++
            continue
          }
        }

        const last3 = recentPicks.slice(-3)
        const posRunCounts: Record<string, number> = {}
        for (const p of last3) posRunCounts[p] = (posRunCounts[p] || 0) + 1
        const recentRun = Object.entries(posRunCounts).find(([, c]) => c >= 2)?.[0]

        const candidateSlice = available.slice(0, 40)
        const weights = candidateSlice.map(p => Math.max(0.05, scorePlayer(p, profile, overall, recentRun)))
        const chosen = pickWeighted(candidateSlice, weights)

        const avIdx = available.findIndex(p => p.name === chosen.name)
        if (avIdx >= 0) available.splice(avIdx, 1)

        if (chosen.position in profile.rosterCounts) {
          profile.rosterCounts[chosen.position as keyof typeof profile.rosterCounts]++
        }
        recentPicks.push(chosen.position)

        if (userPickOveralls.has(overall)) {
          if (!pickOutcomes.has(overall)) pickOutcomes.set(overall, new Map())
          const map = pickOutcomes.get(overall)!
          const key = `${chosen.name}|${chosen.position}`
          map.set(key, (map.get(key) || 0) + 1)
        }

        overall++
      }
    }
  }

  return pickOutcomes
}

function extractTop(outcomes: Map<string, number> | undefined, sims: number, count = 3): ScenarioResult[] {
  if (!outcomes) return []
  return Array.from(outcomes.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([key, cnt]) => {
      const [player, position] = key.split('|')
      const probability = Math.round((cnt / sims) * 100)
      const why = position === 'RB'
        ? 'Scarcity pressure and roster need point here.'
        : position === 'WR'
          ? 'ADP value and board depth favor this pick.'
          : position === 'QB'
            ? 'QB window timing aligns with draft flow.'
            : 'Positional leverage opportunity at TE.'
      return { player, position, probability, why }
    })
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions as any) as { user?: { id?: string } } | null
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const leagueId = String(body?.leagueId || '')
    const rounds = clamp(Number(body?.rounds || 3), 1, 4)
    const simulations = clamp(Number(body?.simulations || 200), 80, 400)
    const targetPlayer = String(body?.targetPlayer || '').trim()

    if (!leagueId) return NextResponse.json({ error: 'leagueId is required' }, { status: 400 })

    const league = await prisma.league.findFirst({
      where: { id: leagueId, userId: session.user.id },
      include: {
        teams: {
          include: { performances: { orderBy: { week: 'desc' }, take: 12 } },
          orderBy: { currentRank: 'asc' },
          take: MAX_LEAGUE_MOCK_TEAMS,
        },
        rosters: { select: { platformUserId: true, playerData: true }, take: MAX_LEAGUE_MOCK_TEAMS },
      },
    })

    if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })

    const adp = await getLiveADP(league.isDynasty ? 'dynasty' : 'redraft', 220)
    const adjusted = await applyRealtimeAdpAdjustments(adp, { isDynasty: league.isDynasty })
    const pool = adjusted.entries.filter(p => ['QB', 'RB', 'WR', 'TE'].includes(p.position)).slice(0, 180)

    // The league's real size: a 4- or 20-team league is not a 12-team draft.
    const teamCount = resolveLeagueMockTeamCount(league.leagueSize, league.teams.length)
    // The league's own pick order: linear, snake, or snake with third-round reversal.
    const draftOrder = await resolveLeagueMockDraftOrder(league.id)

    const dnaCards: ManagerDNA[] = league.teams.length
      ? buildManagerDNAFromLeague(
          league.teams.map(t => ({
            teamName: t.teamName,
            ownerName: t.ownerName,
            wins: t.wins,
            losses: t.losses,
            ties: t.ties,
            pointsFor: t.pointsFor,
            currentRank: t.currentRank,
            performances: t.performances.map(p => ({ week: p.week, points: p.points })),
            platformUserId: (t as any).platformUserId || t.externalId,
          })),
          league.rosters || [],
          pool,
          league.isDynasty,
          teamCount
        )
      : []

    const teamNames = Array.from({ length: teamCount }, (_, i) =>
      dnaCards[i]?.manager || `Manager ${i + 1}`
    )

    let userIdx = 0
    if (league.teams.length > 0) {
      const ownerIdx = league.teams.findIndex((t: any) =>
        t.platformUserId === (league as any).platformUserId ||
        t.ownerName?.toLowerCase().includes('you') ||
        t.isOwner === true
      )
      if (ownerIdx >= 0) userIdx = ownerIdx
    }
    const requestedIdx = Number(body?.draftSlot)
    if (!isNaN(requestedIdx) && requestedIdx >= 0 && requestedIdx < teamCount) userIdx = requestedIdx

    const managerProfiles = Array.from({ length: teamCount }, (_, i) => {
      const dna = dnaCards[i]
      return {
        manager: teamNames[i],
        tendency: dna?.tendency || { QB: 1, RB: 1, WR: 1, TE: 1 },
        rosterCounts: { QB: 0, RB: 0, WR: 0, TE: 0 },
        panicScore: dna?.panicScore || 0.3,
        reachFrequency: dna?.reachFrequency || 0.3,
      }
    })

    const userPickOveralls = mockTeamPickOveralls(teamCount, userIdx, rounds, draftOrder)
    const userPickSet = new Set(userPickOveralls)

    const playerToRemove = targetPlayer || pool[0]?.name || ''

    const [baselineOutcomes, playerGoneOutcomes, rbRunOutcomes, qbRunOutcomes] = await Promise.all([
      Promise.resolve(runScenarioSims(pool, managerProfiles, teamCount, rounds, draftOrder, userPickSet, simulations)),
      Promise.resolve(runScenarioSims(pool, managerProfiles, teamCount, rounds, draftOrder, userPickSet, simulations, {
        removePlayer: playerToRemove,
      })),
      Promise.resolve(runScenarioSims(pool, managerProfiles, teamCount, rounds, draftOrder, userPickSet, simulations, {
        rbRunBefore: userPickOveralls[0],
      })),
      Promise.resolve(runScenarioSims(pool, managerProfiles, teamCount, rounds, draftOrder, userPickSet, simulations, {
        qbRunBefore: userPickOveralls[0],
      })),
    ])

    const pickPaths: PickPathEntry[] = userPickOveralls.map(overall => {
      const round = Math.ceil(overall / teamCount)
      const pick = ((overall - 1) % teamCount) + 1

      return {
        overall,
        round,
        pick,
        baseline: extractTop(baselineOutcomes.get(overall), simulations),
        playerGone: {
          removedPlayer: playerToRemove,
          fallbacks: extractTop(playerGoneOutcomes.get(overall), simulations),
        },
        rbRun: {
          pivot: extractTop(rbRunOutcomes.get(overall), simulations),
          narrative: 'If 2+ RBs go off the board before your pick, pivot to best available WR/TE value.',
        },
        qbRun: {
          recommendation: extractTop(qbRunOutcomes.get(overall), simulations),
          narrative: 'If a QB run starts, consider sniping the next-tier QB or holding for positional value.',
        },
      }
    })

    return NextResponse.json({
      ok: true,
      simulations,
      rounds,
      league: { id: league.id, name: league.name, size: teamCount, draftType: draftOrder.draftType, thirdRoundReversal: draftOrder.thirdRoundReversal },
      userManager: teamNames[userIdx],
      userDraftSlot: userIdx + 1,
      targetPlayer: playerToRemove,
      pickPaths,
    })
  } catch (err: any) {
    console.error('[mock-draft/pick-path] error', err)
    return NextResponse.json({ error: err?.message || 'Failed to generate pick paths' }, { status: 500 })
  }
}
