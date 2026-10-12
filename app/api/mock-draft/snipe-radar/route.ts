import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getLiveADP, type ADPEntry } from '@/lib/adp-data'
import { applyRealtimeAdpAdjustments } from '@/lib/mock-draft/adp-realtime-adjuster'
import { buildManagerDNAFromLeague, type ManagerDNA } from '@/lib/mock-draft/manager-dna'
import { resolveSleeperIdsBatch } from '@/lib/sleeper/players-cache'

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function snakeOrder(teamCount: number, round: number): number[] {
  const arr = Array.from({ length: teamCount }, (_, i) => i)
  return round % 2 === 1 ? arr : arr.reverse()
}

function getUserPickOveralls(teamCount: number, userIdx: number, rounds: number): number[] {
  const picks: number[] = []
  for (let r = 1; r <= rounds; r++) {
    const order = snakeOrder(teamCount, r)
    const slot = order.indexOf(userIdx)
    if (slot >= 0) picks.push((r - 1) * teamCount + slot + 1)
  }
  return picks
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

type SnipeAlert = {
  player: string
  position: string
  adp: number
  value: number
  snipeProbability: number
  snipedByManagers: Array<{ manager: string; probability: number }>
  expectedValueLost: number
  urgencyLevel: 'critical' | 'warning' | 'watch'
}

type SnipeRadarEntry = {
  userPickOverall: number
  round: number
  pick: number
  picksBefore: number
  alerts: SnipeAlert[]
  topAvailableIfNoSnipe: Array<{ player: string; position: string; probability: number }>
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions as any) as { user?: { id?: string } } | null
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const leagueId = String(body?.leagueId || '')
    const rounds = clamp(Number(body?.rounds || 3), 1, 4)
    const simulations = clamp(Number(body?.simulations || 300), 100, 500)

    if (!leagueId) return NextResponse.json({ error: 'leagueId is required' }, { status: 400 })

    const league = await prisma.league.findFirst({
      where: { userId: session.user.id, OR: [{ id: leagueId }, { platformLeagueId: leagueId }] },
      include: {
        teams: {
          include: { performances: { orderBy: { week: 'desc' }, take: 12 } },
          orderBy: { currentRank: 'asc' },
          take: 20,
        },
        rosters: { select: { platformUserId: true, playerData: true }, take: 20 },
      },
    })

    if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })

    const adp = await getLiveADP(league.isDynasty ? 'dynasty' : 'redraft', 220)
    const adjusted = await applyRealtimeAdpAdjustments(adp, { isDynasty: league.isDynasty })
    const pool = adjusted.entries.filter(p => ['QB', 'RB', 'WR', 'TE'].includes(p.position)).slice(0, 180)

    const teamCount = Math.max(league.leagueSize || 0, league.teams.length || 0, 12)

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

    const userPickOveralls = getUserPickOveralls(teamCount, userIdx, rounds)

    const playerValueMap = new Map<string, number>()
    for (const p of pool) {
      playerValueMap.set(p.name, p.value ?? 2500)
    }

    const snipeTracker: Map<number, Map<string, { takenBy: Map<string, number>; takenCount: number }>> = new Map()
    for (const upo of userPickOveralls) {
      snipeTracker.set(upo, new Map())
    }

    const userAvailableTracker: Map<number, Map<string, number>> = new Map()
    for (const upo of userPickOveralls) {
      userAvailableTracker.set(upo, new Map())
    }

    for (let s = 0; s < simulations; s++) {
      const available = [...pool]
      const counts = managerProfiles.map(m => ({
        ...m,
        rosterCounts: { QB: 0, RB: 0, WR: 0, TE: 0 },
      }))
      const recentPicks: string[] = []
      const takenBeforeUser: Map<number, Set<string>> = new Map()

      let overall = 1
      for (let round = 1; round <= rounds; round++) {
        const order = snakeOrder(teamCount, round)
        for (let pick = 1; pick <= teamCount; pick++) {
          const managerIdx = order[pick - 1]
          const profile = counts[managerIdx]
          const isUserPick = managerIdx === userIdx

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

          if (!isUserPick) {
            for (const upo of userPickOveralls) {
              if (overall < upo) {
                if (!takenBeforeUser.has(upo)) takenBeforeUser.set(upo, new Set())
                takenBeforeUser.get(upo)!.add(chosen.name)

                const tracker = snipeTracker.get(upo)!
                if (!tracker.has(chosen.name)) {
                  tracker.set(chosen.name, { takenBy: new Map(), takenCount: 0 })
                }
                const entry = tracker.get(chosen.name)!
                entry.takenCount++
                entry.takenBy.set(profile.manager, (entry.takenBy.get(profile.manager) || 0) + 1)
              }
            }
          }

          if (isUserPick) {
            const topAvail = available.slice(0, 8)
            const uaTracker = userAvailableTracker.get(overall)!
            for (const p of topAvail) {
              uaTracker.set(`${p.name}|${p.position}`, (uaTracker.get(`${p.name}|${p.position}`) || 0) + 1)
            }
          }

          overall++
        }
      }
    }

    const snipeRadar: SnipeRadarEntry[] = userPickOveralls.map(upo => {
      const round = Math.ceil(upo / teamCount)
      const pick = ((upo - 1) % teamCount) + 1
      const prevUserPick = userPickOveralls.filter(p => p < upo).pop() || 0
      const picksBefore = upo - prevUserPick - 1

      const tracker = snipeTracker.get(upo)!
      const relevantPlayers = pool.filter(p => {
        const adpWindow = p.adp <= upo + 10 && p.adp >= Math.max(1, upo - teamCount * 1.5)
        return adpWindow
      })

      const alerts: SnipeAlert[] = relevantPlayers
        .map(player => {
          const entry = tracker.get(player.name)
          if (!entry || entry.takenCount === 0) return null

          const snipeProbability = Math.round((entry.takenCount / simulations) * 100)
          if (snipeProbability < 10) return null

          const snipedByManagers = Array.from(entry.takenBy.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([manager, cnt]) => ({
              manager,
              probability: Math.round((cnt / simulations) * 100),
            }))

          const playerVal = player.value ?? 2500
          const nextBestVal = pool
            .filter(p => p.position === player.position && p.name !== player.name && p.adp > player.adp)
            .slice(0, 1)[0]?.value ?? (playerVal * 0.7)
          const valueDrop = playerVal - nextBestVal
          const expectedValueLost = Math.round(valueDrop * (snipeProbability / 100))

          const urgencyLevel: 'critical' | 'warning' | 'watch' =
            snipeProbability >= 65 ? 'critical' :
            snipeProbability >= 35 ? 'warning' : 'watch'

          return {
            player: player.name,
            position: player.position,
            adp: player.adp,
            value: playerVal,
            snipeProbability,
            snipedByManagers,
            expectedValueLost,
            urgencyLevel,
          }
        })
        .filter((a): a is SnipeAlert => a !== null)
        .sort((a, b) => b.snipeProbability - a.snipeProbability)
        .slice(0, 6)

      const uaTracker = userAvailableTracker.get(upo)
      const topAvailableIfNoSnipe = uaTracker
        ? Array.from(uaTracker.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 4)
            .map(([key, cnt]) => {
              const [player, position] = key.split('|')
              return { player, position, probability: Math.round((cnt / simulations) * 100) }
            })
        : []

      return {
        userPickOverall: upo,
        round,
        pick,
        picksBefore: Math.max(0, picksBefore),
        alerts,
        topAvailableIfNoSnipe,
      }
    })

    const playerTeamMap = new Map<string, string>()
    for (const p of pool) {
      playerTeamMap.set(p.name, p.team || '')
    }

    // Keyed `player|position` and position-verified: a name-only bind gave QB Josh Allen a
    // free-agent guard's Sleeper id, and `MiniPlayerImg` rendered the guard's face.
    const sleeperIdByKey = new Map<string, string | null>()
    try {
      const keys = Array.from(new Set(snipeRadar.flatMap(e => e.alerts.map(a => `${a.player}|${a.position}`))))
      const ids = await resolveSleeperIdsBatch(keys.map((key) => {
        const [name, position] = key.split('|')
        return { name, position, team: playerTeamMap.get(name) || null }
      }))
      keys.forEach((key, i) => sleeperIdByKey.set(key, ids[i] ?? null))
    } catch {}

    for (const entry of snipeRadar) {
      for (const alert of entry.alerts) {
        (alert as any).sleeperId = sleeperIdByKey.get(`${alert.player}|${alert.position}`) ?? null;
        (alert as any).team = playerTeamMap.get(alert.player) || null
      }
    }

    return NextResponse.json({
      ok: true,
      simulations,
      rounds,
      league: { id: league.id, name: league.name, size: teamCount },
      userManager: teamNames[userIdx],
      userDraftSlot: userIdx + 1,
      snipeRadar,
    })
  } catch (err: any) {
    console.error('[mock-draft/snipe-radar] error', err)
    return NextResponse.json({ error: err?.message || 'Failed to generate snipe radar' }, { status: 500 })
  }
}
