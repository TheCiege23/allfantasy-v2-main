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



function getManagerPickOveralls(teamCount: number, managerIdx: number, rounds: number, draftOrder: MockDraftOrder): number[] {
  return mockTeamPickOveralls(teamCount, managerIdx, rounds, draftOrder)
}

function draftPickValue(overall: number, teamCount: number): number {
  const round = Math.ceil(overall / teamCount)
  const pickInRound = ((overall - 1) % teamCount) + 1
  const baseValues: Record<number, number> = { 1: 100, 2: 65, 3: 40, 4: 20 }
  const base = baseValues[round] || 10
  const slotBonus = clamp((teamCount - pickInRound) / teamCount * 15, 0, 15)
  return Math.round(base + slotBonus)
}

function acceptanceProbability(
  offerValue: number,
  askValue: number,
  managerDna: ManagerDNA | null,
  direction: 'up' | 'down'
): number {
  if (askValue <= 0) return 0.9
  const ratio = offerValue / askValue
  let baseProb = 1 / (1 + Math.exp(-5 * (ratio - 1)))

  if (managerDna) {
    if ((managerDna.reachFrequency || 0.3) > 0.5) {
      baseProb *= direction === 'up' ? 0.85 : 1.1
    }
    if ((managerDna.rookieAppetite || 0.5) > 0.6) {
      baseProb *= direction === 'up' ? 1.05 : 0.95
    }
  }

  return clamp(Math.round(baseProb * 100), 5, 95)
}

type TradeOffer = {
  rank: number
  direction: 'up' | 'down'
  partnerManager: string
  partnerManagerIdx: number
  userGives: Array<{ pickOverall: number; round: number; pick: number; value: number }>
  userGets: Array<{ pickOverall: number; round: number; pick: number; value: number }>
  netEV: number
  grossEV: number
  acceptanceOdds: number
  riskAdjustedEV: number
  minimumAsk: { pickOverall: number; round: number; value: number }
  walkAwayThreshold: number
  topPlayerGain: string | null
  verdict: string
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

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions as any) as { user?: { id?: string } } | null
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const leagueId = String(body?.leagueId || '')
    const rounds = clamp(Number(body?.rounds || 3), 1, 4)
    const simulations = clamp(Number(body?.simulations || 200), 80, 400)
    const focusPick = Number(body?.focusPick || 0)

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

    const userPicks = mockTeamPickOveralls(teamCount, userIdx, rounds, draftOrder)
    const targetPicks = focusPick > 0 ? userPicks.filter(p => p === focusPick) : userPicks.slice(0, 3)

    if (targetPicks.length === 0) {
      return NextResponse.json({ error: 'No valid user picks found' }, { status: 400 })
    }

    const playerAtSlot = new Map<number, Map<string, number>>()
    for (let s = 0; s < simulations; s++) {
      const available = [...pool]
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

          if (!playerAtSlot.has(overall)) playerAtSlot.set(overall, new Map())
          const slotMap = playerAtSlot.get(overall)!
          slotMap.set(chosen.name, (slotMap.get(chosen.name) || 0) + 1)

          overall++
        }
      }
    }

    function expectedPlayerValue(pickOverall: number): number {
      const slotMap = playerAtSlot.get(pickOverall)
      if (!slotMap) return 0
      let totalValue = 0
      let totalCount = 0
      for (const [playerName, count] of slotMap.entries()) {
        const p = pool.find(pp => pp.name === playerName)
        totalValue += (p?.value ?? 2500) * count
        totalCount += count
      }
      return totalCount > 0 ? Math.round(totalValue / totalCount) : 0
    }

    function topPlayerAtSlot(pickOverall: number): string | null {
      const slotMap = playerAtSlot.get(pickOverall)
      if (!slotMap) return null
      let best = ''
      let bestCount = 0
      for (const [name, count] of slotMap.entries()) {
        if (count > bestCount) { best = name; bestCount = count }
      }
      return best || null
    }

    const allOffers: TradeOffer[] = []

    for (const userPick of targetPicks) {
      const userPickValue = draftPickValue(userPick, teamCount)
      const userPickEV = expectedPlayerValue(userPick)
      const userPickRound = Math.ceil(userPick / teamCount)
      const userPickInRound = ((userPick - 1) % teamCount) + 1

      for (let mIdx = 0; mIdx < teamCount; mIdx++) {
        if (mIdx === userIdx) continue
        const partnerPicks = getManagerPickOveralls(teamCount, mIdx, rounds, draftOrder)
        const partnerDna = dnaCards[mIdx] || null

        for (const partnerPick of partnerPicks) {
          if (partnerPick === userPick) continue

          const partnerPickValue = draftPickValue(partnerPick, teamCount)
          const partnerPickEV = expectedPlayerValue(partnerPick)
          const partnerRound = Math.ceil(partnerPick / teamCount)
          const partnerPickInRound = ((partnerPick - 1) % teamCount) + 1

          const direction: 'up' | 'down' = partnerPick < userPick ? 'up' : 'down'

          const pickDiff = Math.abs(userPick - partnerPick)
          if (pickDiff > teamCount * 2) continue
          if (pickDiff < 2) continue

          const grossEV = partnerPickEV - userPickEV
          const netEV = grossEV

          const offerVal = direction === 'up' ? userPickValue : partnerPickValue
          const askVal = direction === 'up' ? partnerPickValue : userPickValue
          const odds = acceptanceProbability(offerVal, askVal, partnerDna, direction)

          const riskAdjustedEV = Math.round(netEV * (odds / 100))

          const minimumAskOverall = direction === 'up'
            ? partnerPicks.find(p => p > userPick && draftPickValue(p, teamCount) >= userPickValue * 0.6) || partnerPick
            : userPick
          const minimumAskRound = Math.ceil(minimumAskOverall / teamCount)
          const minimumAskValue = draftPickValue(minimumAskOverall, teamCount)

          const walkAwayThreshold = direction === 'up'
            ? Math.round(userPickValue * 1.4)
            : Math.round(userPickValue * 0.5)

          const topGain = direction === 'up' ? topPlayerAtSlot(partnerPick) : null

          let verdict = ''
          if (direction === 'up') {
            if (riskAdjustedEV > 200) verdict = 'Strong trade up — high-value target likely available.'
            else if (riskAdjustedEV > 0) verdict = 'Marginal trade up — value exists but cost is significant.'
            else verdict = 'Overpay risk — you\'re likely giving up more value than you gain.'
          } else {
            if (riskAdjustedEV > 100) verdict = 'Profitable trade down — accumulate value with minimal player loss.'
            else if (riskAdjustedEV > 0) verdict = 'Slight value gain — reasonable move if you don\'t have a strong target.'
            else verdict = 'Value destruction — better to hold your current pick.'
          }

          allOffers.push({
            rank: 0,
            direction,
            partnerManager: teamNames[mIdx],
            partnerManagerIdx: mIdx,
            userGives: [{
              pickOverall: direction === 'up' ? userPick : userPick,
              round: userPickRound,
              pick: userPickInRound,
              value: userPickValue,
            }],
            userGets: [{
              pickOverall: partnerPick,
              round: partnerRound,
              pick: partnerPickInRound,
              value: partnerPickValue,
            }],
            netEV,
            grossEV,
            acceptanceOdds: odds,
            riskAdjustedEV,
            minimumAsk: { pickOverall: minimumAskOverall, round: minimumAskRound, value: minimumAskValue },
            walkAwayThreshold,
            topPlayerGain: topGain,
            verdict,
          })
        }
      }
    }

    allOffers.sort((a, b) => b.riskAdjustedEV - a.riskAdjustedEV)

    const tradeUpOffers = allOffers.filter(o => o.direction === 'up').slice(0, 3)
    const tradeDownOffers = allOffers.filter(o => o.direction === 'down').slice(0, 3)

    const bestOffers = [...tradeUpOffers, ...tradeDownOffers]
    bestOffers.forEach((o, i) => { o.rank = i + 1 })

    return NextResponse.json({
      ok: true,
      simulations,
      rounds,
      league: { id: league.id, name: league.name, size: teamCount, draftType: draftOrder.draftType, thirdRoundReversal: draftOrder.thirdRoundReversal },
      userManager: teamNames[userIdx],
      userDraftSlot: userIdx + 1,
      userPicks: targetPicks.map(p => ({
        overall: p,
        round: Math.ceil(p / teamCount),
        pick: ((p - 1) % teamCount) + 1,
        pickValue: draftPickValue(p, teamCount),
        expectedPlayerValue: expectedPlayerValue(p),
      })),
      tradeUpOffers,
      tradeDownOffers,
      bestOffers,
    })
  } catch (err: any) {
    console.error('[mock-draft/trade-optimizer] error', err)
    return NextResponse.json({ error: err?.message || 'Failed to generate trade optimizer' }, { status: 500 })
  }
}
