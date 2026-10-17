import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getLiveADP, type ADPEntry } from '@/lib/adp-data'
import { applyRealtimeAdpAdjustments } from '@/lib/mock-draft/adp-realtime-adjuster'
import { loadSportAwareDraftPlayerPool, toSyntheticAdpEntries } from '@/lib/mock-draft/sport-player-pool'
import { buildManagerDNAFromLeague, type ManagerDNA } from '@/lib/mock-draft/manager-dna'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { resolveSleeperIdsBatch } from '@/lib/sleeper/players-cache'

type ScenarioPreset = {
  id: string
  label: string
  positionTargetDeltas: Record<string, number>
  needMultiplier: number
  tendencyMultiplier: number
  newsMultiplier: number
  rookieMultiplier: number
  adpShiftMap: Record<string, number>
}

const SCENARIO_PRESETS: Record<string, ScenarioPreset> = {
  heavy_rookie_hype: {
    id: 'heavy_rookie_hype',
    label: 'Heavy Rookie Hype',
    positionTargetDeltas: {},
    needMultiplier: 1.0,
    tendencyMultiplier: 1.0,
    newsMultiplier: 1.0,
    rookieMultiplier: 3.5,
    adpShiftMap: {},
  },
  rb_scarcity_spike: {
    id: 'rb_scarcity_spike',
    label: 'RB Scarcity Spike',
    positionTargetDeltas: { RB: 2 },
    needMultiplier: 1.3,
    tendencyMultiplier: 1.0,
    newsMultiplier: 1.0,
    rookieMultiplier: 1.0,
    adpShiftMap: { RB: -8 },
  },
  injury_risk_conservative: {
    id: 'injury_risk_conservative',
    label: 'Injury Risk Conservative',
    positionTargetDeltas: {},
    needMultiplier: 1.0,
    tendencyMultiplier: 0.8,
    newsMultiplier: 3.0,
    rookieMultiplier: 0.7,
    adpShiftMap: {},
  },
  league_overvalues_qbs: {
    id: 'league_overvalues_qbs',
    label: 'League Overvalues QBs',
    positionTargetDeltas: { QB: 2 },
    needMultiplier: 1.0,
    tendencyMultiplier: 1.2,
    newsMultiplier: 1.0,
    rookieMultiplier: 1.0,
    adpShiftMap: { QB: -12 },
  },
}

type VolatilityMeter = {
  chaosLevel: 'low' | 'medium' | 'high'
  chaosScore: number
  confidenceBands: { high: number; mid: number; low: number }
  tierStability: 'stable' | 'fragile'
  tierSpread: number
  topConcentration: number
}

type ScoreBreakdown = {
  adpWeight: number
  teamNeedWeight: number
  managerTendencyWeight: number
  newsImpactWeight: number
  rookieRankBoostWeight: number
  total: number
}

type PickForecast = {
  overall: number
  round: number
  pick: number
  manager: string
  topTargets: Array<{
    player: string
    position: string
    probability: number
    why: string
    scorecard: ScoreBreakdown
  }>
  volatility: VolatilityMeter
}

const POSITION_TARGETS: Record<string, number> = { QB: 2, RB: 5, WR: 5, TE: 2 }

function buildPositionTargets(pool: ADPEntry[], sport: string): Record<string, number> {
  if (sport === 'NFL') return { ...POSITION_TARGETS }

  const positions = Array.from(
    new Set(
      pool
        .map((player) => String(player.position || '').toUpperCase())
        .filter(Boolean)
    )
  )

  if (positions.length === 0) return { ...POSITION_TARGETS }

  return Object.fromEntries(positions.slice(0, 10).map((position) => [position, 2]))
}

function describeTopTargetReason(sport: string, position: string): string {
  if (sport === 'NFL') {
    if (position === 'RB') return 'Historical roster construction and scarcity pressure point toward RB here.'
    if (position === 'WR') return 'Manager tendency and ADP board value suggest WR is likely.'
    if (position === 'QB') return 'QB timing window is open based on league and manager style.'
    return 'TE leverage pick profile appears in this simulation cluster.'
  }

  return `${position} is the strongest fit from the current ${sport} board and manager trend mix.`
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function snakeOrder(teamCount: number, round: number): number[] {
  const arr = Array.from({ length: teamCount }, (_, i) => i)
  return round % 2 === 1 ? arr : arr.reverse()
}

type ScenarioMultipliers = {
  adpMul: number
  needMul: number
  tendencyMul: number
  newsMul: number
  rookieMul: number
}

const DEFAULT_MULS: ScenarioMultipliers = { adpMul: 1, needMul: 1, tendencyMul: 1, newsMul: 1, rookieMul: 1 }

function scorePlayerForManager(
  player: ADPEntry,
  managerProfile: { tendency: Record<string, number>; rosterCounts: Record<string, number>; panicScore?: number; reachFrequency?: number },
  overall: number,
  posTargets: Record<string, number>,
  recentPositionRun?: string,
  newsAdjustment?: number,
  rookieBoost?: number,
  muls: ScenarioMultipliers = DEFAULT_MULS
): { score: number; breakdown: ScoreBreakdown } {
  const pos = player.position
  const needBoost = clamp((posTargets[pos] ?? 2) - (managerProfile.rosterCounts[pos] ?? 0), -2, 4)
  const tendencyBoost = managerProfile.tendency[pos] ?? 1
  const adpDelta = clamp((player.adp - overall) / 20, -2, 2)
  const valueBoost = clamp((player.value ?? 2500) / 2500, 0.6, 2)

  const reachMod = (managerProfile.reachFrequency || 0.3) > 0.5 ? adpDelta * 0.15 : 0
  let panicMod = 0
  if (recentPositionRun && recentPositionRun === pos) {
    panicMod = (managerProfile.panicScore || 0.3) * 0.35
  }

  const adpComponent = adpDelta * 0.18 * muls.adpMul
  const needComponent = needBoost * 0.25 * muls.needMul
  const tendencyComponent = (tendencyBoost * 0.22 + reachMod + panicMod) * muls.tendencyMul
  const newsComponent = (newsAdjustment || 0) * 0.02 * muls.newsMul
  const rookieComponent = (rookieBoost || 0) * 0.03 * muls.rookieMul
  const baseValue = valueBoost * 0.14 * muls.adpMul

  const coreScore = 1 + needComponent + tendencyComponent + adpComponent + baseValue

  const rawSum = Math.abs(adpComponent) + Math.abs(needComponent) + Math.abs(tendencyComponent) + Math.abs(newsComponent) + Math.abs(rookieComponent) + Math.abs(baseValue)
  const norm = rawSum > 0 ? 100 / rawSum : 0

  return {
    score: coreScore + newsComponent + rookieComponent,
    breakdown: {
      adpWeight: Math.round((Math.abs(adpComponent) + Math.abs(baseValue)) * norm),
      teamNeedWeight: Math.round(Math.abs(needComponent) * norm),
      managerTendencyWeight: Math.round(Math.abs(tendencyComponent) * norm),
      newsImpactWeight: Math.round(Math.abs(newsComponent) * norm),
      rookieRankBoostWeight: Math.round(Math.abs(rookieComponent) * norm),
      total: Math.round((coreScore + newsComponent + rookieComponent) * 100) / 100,
    },
  }
}

function pickWeightedIdx(weights: number[]): number {
  const total = weights.reduce((a, b) => a + b, 0)
  let r = Math.random() * total
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]
    if (r <= 0) return i
  }
  return weights.length - 1
}

function pickWeighted(candidates: ADPEntry[], weights: number[]): ADPEntry {
  return candidates[pickWeightedIdx(weights)]
}

function computeVolatility(outcomeMap: Map<string, number>, simulations: number, managerName: string): VolatilityMeter {
  const entries = Array.from(outcomeMap.entries())
    .filter(([k]) => k.endsWith(`|${managerName}`))
    .sort((a, b) => b[1] - a[1])

  if (entries.length === 0) {
    return { chaosLevel: 'high' as const, chaosScore: 100, confidenceBands: { high: 0, mid: 0, low: 0 }, tierStability: 'fragile' as const, tierSpread: 0, topConcentration: 0 }
  }

  const total = entries.reduce((s, [, c]) => s + c, 0) || simulations
  const probs = entries.map(([, c]) => c / total)
  const uniqueOutcomes = entries.length

  const topProb = probs[0] || 0
  const top3Sum = probs.slice(0, 3).reduce((s, p) => s + p, 0)
  const topConcentration = Math.round(topProb * 100)

  let entropy = 0
  for (const p of probs) {
    if (p > 0) entropy -= p * Math.log2(p)
  }
  const maxEntropy = uniqueOutcomes > 1 ? Math.log2(uniqueOutcomes) : 1
  const normalizedEntropy = maxEntropy > 0 ? entropy / maxEntropy : 0

  const chaosScore = Math.round(clamp(normalizedEntropy * 100, 0, 100))
  const chaosLevel: 'low' | 'medium' | 'high' =
    chaosScore <= 35 ? 'low' : chaosScore <= 65 ? 'medium' : 'high'

  const highBand = Math.round(topProb * 100)
  const midBand = Math.round(top3Sum * 100)
  const lowBand = Math.round(clamp(probs.slice(0, Math.min(6, probs.length)).reduce((s, p) => s + p, 0) * 100, 0, 100))

  const positionCounts: Record<string, number> = {}
  for (const [key, count] of entries) {
    const parts = key.split('|')
    const pos = parts[1] || 'UNK'
    positionCounts[pos] = (positionCounts[pos] || 0) + count
  }
  const posProbs = Object.values(positionCounts).map(c => c / total).sort((a, b) => b - a)
  const tierSpread = posProbs.length > 1 ? Math.round((posProbs[0] - posProbs[1]) * 100) : 100

  const tierStability: 'stable' | 'fragile' =
    topConcentration >= 40 && tierSpread >= 20 ? 'stable' : 'fragile'

  return { chaosLevel, chaosScore, confidenceBands: { high: highBand, mid: midBand, low: lowBand }, tierStability, tierSpread, topConcentration }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions as any) as { user?: { id?: string } } | null
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const leagueId = String(body?.leagueId || '')
    const rounds = clamp(Number(body?.rounds || 2), 1, 4)
    const simulations = clamp(Number(body?.simulations || 250), 80, 600)
    const activeScenarios: string[] = Array.isArray(body?.scenarios) ? body.scenarios.filter((s: any) => typeof s === 'string' && SCENARIO_PRESETS[s]) : []
    const assistantMode: boolean = body?.assistantMode === true
    const focusPickOverall: number | null = typeof body?.focusPickOverall === 'number' ? body.focusPickOverall : null

    if (!leagueId) return NextResponse.json({ error: 'leagueId is required' }, { status: 400 })

    const league = await prisma.league.findFirst({
      where: { userId: session.user.id, OR: [{ id: leagueId }, { platformLeagueId: leagueId }] },
      include: {
        teams: {
          include: { performances: { orderBy: { week: 'desc' }, take: 8 } },
          orderBy: { currentRank: 'asc' },
          take: 20,
        },
        rosters: { select: { platformUserId: true, playerData: true }, take: 20 },
      },
    })

    if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })

    const sport = normalizeToSupportedSport((league as any).sport || 'NFL')
    const isNfl = sport === 'NFL'
    const baseEntries = isNfl
      ? await getLiveADP(league.isDynasty ? 'dynasty' : 'redraft', 220)
      : toSyntheticAdpEntries(
          await loadSportAwareDraftPlayerPool({
            leagueId: league.id,
            sport,
            limit: 220,
          })
        )
    const adjusted = isNfl
      ? await applyRealtimeAdpAdjustments(baseEntries, { isDynasty: league.isDynasty })
      : { entries: baseEntries, adjustments: [] as Array<{ name: string; delta: number; reasons: string[] }> }
    const pool = adjusted.entries
      .filter((player) => (isNfl ? ['QB', 'RB', 'WR', 'TE'].includes(player.position) : Boolean(player.position)))
      .slice(0, 180)

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

    const basePositionTargets = buildPositionTargets(pool, sport)
    const baseRosterCounts = Object.fromEntries(
      Object.keys(basePositionTargets).map((position) => [position, 0])
    ) as Record<string, number>

    const managerProfiles = Array.from({ length: teamCount }, (_, i) => {
      const dna = dnaCards[i]
      return {
        manager: teamNames[i],
        tendency: dna?.tendency || Object.fromEntries(Object.keys(baseRosterCounts).map((position) => [position, 1])),
        rosterCounts: { ...baseRosterCounts, ...(dna?.rosterCounts || {}) },
        panicScore: dna?.panicScore || 0.3,
        reachFrequency: dna?.reachFrequency || 0.3,
      }
    })

    const normName = (n: string) => String(n || '').toLowerCase().replace(/[.'-]/g, '').replace(/\s+(jr|sr|ii|iii|iv|v)$/i, '').replace(/\s+/g, ' ').trim()

    const newsAdjMap = new Map<string, number>()
    const rookieBoostMap = new Map<string, number>()
    for (const adj of adjusted.adjustments) {
      const key = normName(adj.name)
      const reasons = (adj.reasons || []).join(' ').toLowerCase()
      if (reasons.includes('injury') || reasons.includes('risk') || reasons.includes('momentum') || reasons.includes('role') || reasons.includes('trade') || reasons.includes('news')) {
        newsAdjMap.set(key, adj.delta)
      }
      if (reasons.includes('rookie')) {
        rookieBoostMap.set(key, Math.abs(adj.delta))
      }
    }

    const calibration = await prisma.leagueDraftCalibration.findUnique({
      where: { leagueId_season: { leagueId, season: league.season || new Date().getFullYear() } },
    }).catch(() => null)

    const scenarioMuls: ScenarioMultipliers = {
      adpMul: calibration?.adpWeight ?? 1,
      needMul: calibration?.needWeight ?? 1,
      tendencyMul: calibration?.tendencyWeight ?? 1,
      newsMul: calibration?.newsWeight ?? 1,
      rookieMul: calibration?.rookieWeight ?? 1,
    }
    const posTargets = { ...basePositionTargets }
    for (const sId of activeScenarios) {
      const preset = SCENARIO_PRESETS[sId]
      if (!preset) continue
      scenarioMuls.needMul *= preset.needMultiplier
      scenarioMuls.tendencyMul *= preset.tendencyMultiplier
      scenarioMuls.newsMul *= preset.newsMultiplier
      scenarioMuls.rookieMul *= preset.rookieMultiplier
      for (const [pos, delta] of Object.entries(preset.positionTargetDeltas)) {
        posTargets[pos] = (posTargets[pos] ?? 2) + delta
      }
    }

    const scenarioAdpPool = activeScenarios.length > 0
      ? pool.map(p => {
          const shift = activeScenarios.reduce((sum, sId) => {
            const preset = SCENARIO_PRESETS[sId]
            return sum + (preset?.adpShiftMap[p.position] || 0)
          }, 0)
          return shift !== 0 ? { ...p, adp: p.adp + shift } : p
        }).sort((a, b) => a.adp - b.adp)
      : pool

    const pickCount = rounds * teamCount
    const pickOutcomes: Map<number, Map<string, number>> = new Map()
    const pickBreakdowns: Map<number, Map<string, { sum: ScoreBreakdown; count: number }>> = new Map()

    for (let s = 0; s < simulations; s++) {
      const available = [...scenarioAdpPool]
      const counts = managerProfiles.map((manager) => ({
        ...manager,
        rosterCounts: { ...baseRosterCounts, ...(manager.rosterCounts || {}) },
      }))
      const recentPicks: string[] = []

      let overall = 1
      for (let round = 1; round <= rounds; round++) {
        const order = snakeOrder(teamCount, round)
        for (let pick = 1; pick <= teamCount; pick++) {
          const managerIdx = order[pick - 1]
          const profile = counts[managerIdx]

          const last3 = recentPicks.slice(-3)
          const posRunCounts: Record<string, number> = {}
          for (const p of last3) posRunCounts[p] = (posRunCounts[p] || 0) + 1
          const recentRun = Object.entries(posRunCounts).find(([, c]) => c >= 2)?.[0]

          const candidateSlice = available.slice(0, 40)
          const scored = candidateSlice.map((p) => {
            const pKey = normName(p.name)
            return scorePlayerForManager(p, profile, overall, posTargets, recentRun, newsAdjMap.get(pKey), rookieBoostMap.get(pKey), scenarioMuls)
          })
          const weights = scored.map(s => Math.max(0.05, s.score))
          const chosenIdx = pickWeightedIdx(weights)
          const chosen = candidateSlice[chosenIdx]
          const chosenBreakdown = scored[chosenIdx].breakdown

          const avIdx = available.findIndex(p => p.name === chosen.name)
          if (avIdx >= 0) available.splice(avIdx, 1)

          if (chosen.position in profile.rosterCounts) {
            const key = chosen.position as keyof typeof profile.rosterCounts
            profile.rosterCounts[key] = (profile.rosterCounts[key] || 0) + 1
          }
          recentPicks.push(chosen.position)

          if (!pickOutcomes.has(overall)) pickOutcomes.set(overall, new Map())
          const map = pickOutcomes.get(overall)!
          const outcomeKey = `${chosen.name}|${chosen.position}|${profile.manager}`
          map.set(outcomeKey, (map.get(outcomeKey) || 0) + 1)

          if (!pickBreakdowns.has(overall)) pickBreakdowns.set(overall, new Map())
          const bdMap = pickBreakdowns.get(overall)!
          const existing = bdMap.get(outcomeKey)
          if (existing) {
            existing.sum.adpWeight += chosenBreakdown.adpWeight
            existing.sum.teamNeedWeight += chosenBreakdown.teamNeedWeight
            existing.sum.managerTendencyWeight += chosenBreakdown.managerTendencyWeight
            existing.sum.newsImpactWeight += chosenBreakdown.newsImpactWeight
            existing.sum.rookieRankBoostWeight += chosenBreakdown.rookieRankBoostWeight
            existing.sum.total += chosenBreakdown.total
            existing.count++
          } else {
            bdMap.set(outcomeKey, { sum: { ...chosenBreakdown }, count: 1 })
          }

          overall++
        }
      }
    }

    const forecasts: PickForecast[] = []
    let overall = 1
    for (let round = 1; round <= rounds; round++) {
      const order = snakeOrder(teamCount, round)
      for (let pick = 1; pick <= teamCount; pick++) {
        const manager = teamNames[order[pick - 1]] || `Manager ${order[pick - 1] + 1}`
        const bdMap = pickBreakdowns.get(overall) || new Map()
        const results = Array.from((pickOutcomes.get(overall) || new Map()).entries())
          .filter(([k]) => k.endsWith(`|${manager}`))
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([key, cnt]) => {
            const [player, position] = key.split('|')
            const probability = Math.round((cnt / simulations) * 100)
            const why = describeTopTargetReason(sport, position)

            const bd = bdMap.get(key)
            const scorecard: ScoreBreakdown = bd && bd.count > 0
              ? {
                  adpWeight: Math.round(bd.sum.adpWeight / bd.count),
                  teamNeedWeight: Math.round(bd.sum.teamNeedWeight / bd.count),
                  managerTendencyWeight: Math.round(bd.sum.managerTendencyWeight / bd.count),
                  newsImpactWeight: Math.round(bd.sum.newsImpactWeight / bd.count),
                  rookieRankBoostWeight: Math.round(bd.sum.rookieRankBoostWeight / bd.count),
                  total: Math.round((bd.sum.total / bd.count) * 100) / 100,
                }
              : { adpWeight: 40, teamNeedWeight: 30, managerTendencyWeight: 25, newsImpactWeight: 3, rookieRankBoostWeight: 2, total: 1 }

            return { player, position, probability, why, scorecard }
          })

        const outcomeMap = pickOutcomes.get(overall) || new Map()
        const volatility = computeVolatility(outcomeMap, simulations, manager)

        forecasts.push({ overall, round, pick, manager, topTargets: results, volatility })
        overall++
      }
    }

    const playerTeamMap = new Map<string, string>()
    for (const p of pool) {
      playerTeamMap.set(p.name, p.team || '')
    }

    /*
     * Keyed `player|position` and position-verified: a name-only bind gave QB Josh Allen a
     * free-agent guard's Sleeper id. Sleeper's dictionary is NFL-only, so another sport's pool
     * would bind onto an NFL namesake (an NBA "G" is not an offensive guard) — NFL only.
     */
    const sleeperIdByKey = new Map<string, string | null>()
    if (isNfl) {
      try {
        const keys = Array.from(new Set(forecasts.flatMap(f => f.topTargets.map(t => `${t.player}|${t.position}`))))
        const ids = await resolveSleeperIdsBatch(keys.map((key) => {
          const [name, position] = key.split('|')
          return { name, position, team: playerTeamMap.get(name) || null }
        }))
        keys.forEach((key, i) => sleeperIdByKey.set(key, ids[i] ?? null))
      } catch {}
    }

    for (const f of forecasts) {
      for (const t of f.topTargets) {
        (t as any).sleeperId = sleeperIdByKey.get(`${t.player}|${t.position}`) ?? null;
        (t as any).team = playerTeamMap.get(t.player) || null
      }
    }

    const userGuidance = forecasts
      .filter(f => f.pick <= 3)
      .slice(0, 8)
      .map(f => ({
        overall: f.overall,
        manager: f.manager,
        likelyDirection: f.topTargets[0]?.position || 'WR',
        topName: f.topTargets[0]?.player || 'TBD',
      }))

    let assistantData: any = null
    if (assistantMode && focusPickOverall) {
      const userPick = forecasts.find(f => f.overall === focusPickOverall)
      const futurePick = forecasts.find(f => f.overall === focusPickOverall + 4)

      const top3 = (userPick?.topTargets || []).slice(0, 3).map((t, i) => ({
        ...t,
        rank: i + 1,
        confidence: t.probability,
      }))

      const fallback = (userPick?.topTargets || []).slice(3, 4).map(t => ({
        player: t.player,
        position: t.position,
        probability: t.probability,
      }))[0] || null

      let waitAdvice: { canWait: boolean; reason: string; availabilityAt4: number } = {
        canWait: false,
        reason: 'No future pick data available to evaluate.',
        availabilityAt4: 0,
      }

      if (top3[0] && futurePick) {
        const topPlayer = top3[0].player
        const futureTargets = futurePick.topTargets || []
        let snipeCount = 0
        for (let offset = 1; offset <= 3; offset++) {
          const interveningMap = pickOutcomes.get(focusPickOverall + offset)
          if (!interveningMap) continue
          for (const [key, count] of interveningMap.entries()) {
            if (key.startsWith(`${topPlayer}|`)) snipeCount += count
          }
        }

        const snipePct = simulations > 0 ? Math.round((snipeCount / simulations) * 100) : 100
        const availPct = 100 - Math.min(100, snipePct)

        if (availPct >= 55) {
          waitAdvice = {
            canWait: true,
            reason: `${topPlayer} has ~${availPct}% chance of still being available at pick +4. Safe to wait if you want to explore trades.`,
            availabilityAt4: availPct,
          }
        } else {
          waitAdvice = {
            canWait: false,
            reason: `${topPlayer} only has ~${availPct}% chance of lasting to pick +4. Take now or risk losing them.`,
            availabilityAt4: availPct,
          }
        }
      }

      const upcomingUserPicks = forecasts
        .filter(f => f.overall > focusPickOverall && f.overall <= focusPickOverall + (teamCount * 2))
      const seenPlayers = new Set<string>()
      const queue: Array<{ player: string; position: string; probability: number; pickOverall: number }> = []
      for (const f of upcomingUserPicks) {
        for (const t of f.topTargets) {
          if (!seenPlayers.has(t.player)) {
            seenPlayers.add(t.player)
            queue.push({ player: t.player, position: t.position, probability: t.probability, pickOverall: f.overall })
          }
        }
      }
      queue.sort((a, b) => b.probability - a.probability)

      assistantData = {
        focusPick: focusPickOverall,
        top3,
        fallback,
        waitAdvice,
        queue: queue.slice(0, 6),
        volatility: userPick?.volatility || null,
      }
    }

    let snapshotId: string | null = null
    if (activeScenarios.length === 0 && !assistantMode) {
      try {
        const snapshot = await prisma.draftPredictionSnapshot.create({
          data: {
            leagueId,
            sportType: String((league as any).sport || sport || 'NFL').toUpperCase(),
            userId: session.user.id,
            season: league.season || new Date().getFullYear(),
            rounds,
            simulations,
            scenarios: [] as any,
            snapshotJson: forecasts as unknown as any,
          },
        })
        snapshotId = snapshot.id
      } catch (e) {
        console.error('[predict-board] snapshot save failed', e)
      }
    }

    return NextResponse.json({
      ok: true,
      simulations,
      rounds,
      league: { id: league.id, name: league.name, size: teamCount },
      forecasts,
      userGuidance,
      adpAdjustments: adjusted.adjustments.slice(0, 20),
      signalSources: 'sourcesUsed' in adjusted ? adjusted.sourcesUsed : { importedPlayerPool: pool.length },
      ...(snapshotId ? { snapshotId } : {}),
      ...(calibration ? { calibration: { adp: calibration.adpWeight, need: calibration.needWeight, tendency: calibration.tendencyWeight, news: calibration.newsWeight, rookie: calibration.rookieWeight, sampleSize: calibration.sampleSize } } : {}),
      ...(activeScenarios.length > 0 ? { scenarioLabels: activeScenarios.map(s => SCENARIO_PRESETS[s]?.label || s) } : {}),
      ...(assistantData ? { assistant: assistantData } : {}),
    })
  } catch (err: any) {
    console.error('[mock-draft/predict-board] error', err)
    return NextResponse.json({ error: err?.message || 'Failed to predict draft board' }, { status: 500 })
  }
}
