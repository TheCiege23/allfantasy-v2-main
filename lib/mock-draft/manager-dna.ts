import type { ADPEntry } from '@/lib/adp-data'

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

export interface ManagerDNA {
  manager: string
  teamIdx: number
  reachFrequency: number
  reachLabel: 'Conservative' | 'Measured' | 'Aggressive' | 'Wild Card'
  positionalAggression: Record<string, { early: number; mid: number; late: number }>
  rookieAppetite: number
  rookieLabel: 'Veteran-Only' | 'Balanced' | 'Rookie-Heavy' | 'Youth Movement'
  stackTendency: number
  stackLabel: 'Independent' | 'Light Stacker' | 'Stack-Builder' | 'Stack-Dependent'
  panicResponse: 'Hold Steady' | 'Mild Pivot' | 'Reactive' | 'Full Panic'
  panicScore: number
  overallArchetype: string
  tendency: Record<string, number>
  rosterCounts: Record<string, number>
}

interface ManagerDNAInput {
  teamName: string
  ownerName: string
  teamIdx: number
  wins: number
  losses: number
  ties: number
  pointsFor: number
  currentRank: number | null
  performances: Array<{ week: number; points: number; data?: any }>
  rosterPlayerIds: string[]
  isDynasty: boolean
  leagueSize: number
}

function computeManagerDNA(
  input: ManagerDNAInput,
  adpPool: ADPEntry[],
  allInputs: ManagerDNAInput[]
): ManagerDNA {
  const { teamName, ownerName, teamIdx, wins, losses, ties, performances, rosterPlayerIds, isDynasty, leagueSize } = input
  const name = teamName || ownerName || `Manager ${teamIdx + 1}`
  const gamesPlayed = Math.max(1, wins + losses + ties)
  const winRate = wins / gamesPlayed
  const avgPts = performances.length
    ? performances.reduce((s, p) => s + p.points, 0) / performances.length
    : 100
  const leagueAvgPts = allInputs.length
    ? allInputs.reduce((s, inp) => {
        const avg = inp.performances.length ? inp.performances.reduce((a, p) => a + p.points, 0) / inp.performances.length : 100
        return s + avg
      }, 0) / allInputs.length
    : 100

  const ptsRatio = avgPts / Math.max(1, leagueAvgPts)

  const adpMap = new Map<string, ADPEntry>()
  for (const e of adpPool) {
    adpMap.set(e.name.toLowerCase().replace(/[.\-']/g, '').trim(), e)
  }

  const rosterPositions: string[] = []
  const rosterAges: number[] = []
  const rosterTeams: string[] = []
  const rosterAdpDeltas: number[] = []
  let rookieCount = 0

  const matchedPlayers: Array<{ adp: number; position: string; team: string | null; age: number | null }> = []
  for (const pid of rosterPlayerIds) {
    const norm = pid.toLowerCase().replace(/[.\-']/g, '').trim()
    const match = adpMap.get(norm)
    if (match) {
      matchedPlayers.push({ adp: match.adp, position: match.position, team: match.team, age: match.age })
      rosterPositions.push(match.position)
      if (match.team) rosterTeams.push(match.team)
      if (match.age != null) {
        rosterAges.push(match.age)
        if (match.age <= 23) rookieCount++
      }
    }
  }
  const sortedByAdp = [...matchedPlayers].sort((a, b) => a.adp - b.adp)
  for (let i = 0; i < sortedByAdp.length; i++) {
    const draftSlotEstimate = Math.round((i + 1) * (leagueSize / Math.max(1, sortedByAdp.length)) * (leagueSize > 8 ? 1.2 : 1))
    const adpDelta = draftSlotEstimate - sortedByAdp[i].adp
    rosterAdpDeltas.push(adpDelta)
  }

  const reachFrequency = computeReachFrequency(rosterAdpDeltas, winRate, ptsRatio)
  const reachLabel = reachFrequency < 0.25 ? 'Conservative'
    : reachFrequency < 0.5 ? 'Measured'
    : reachFrequency < 0.75 ? 'Aggressive'
    : 'Wild Card'

  const positionalAggression = computePositionalAggression(rosterPositions, winRate, avgPts, isDynasty, ptsRatio)

  const rookieAppetite = computeRookieAppetite(rookieCount, rosterPlayerIds.length, rosterAges, isDynasty, winRate)
  const rookieLabel = rookieAppetite < 0.25 ? 'Veteran-Only'
    : rookieAppetite < 0.5 ? 'Balanced'
    : rookieAppetite < 0.75 ? 'Rookie-Heavy'
    : 'Youth Movement'

  const stackTendency = computeStackTendency(rosterPositions, rosterTeams)
  const stackLabel = stackTendency < 0.2 ? 'Independent'
    : stackTendency < 0.45 ? 'Light Stacker'
    : stackTendency < 0.7 ? 'Stack-Builder'
    : 'Stack-Dependent'

  const { panicScore, panicResponse } = computePanicResponse(performances, winRate, ptsRatio, rosterAdpDeltas)

  const overallArchetype = deriveArchetype(reachLabel, rookieLabel, stackLabel, panicResponse, winRate, isDynasty)

  const tendency = deriveTendency(positionalAggression, reachFrequency, isDynasty, avgPts, winRate)

  const rosterCounts: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0 }
  for (const pos of rosterPositions) {
    if (pos in rosterCounts) rosterCounts[pos]++
  }

  return {
    manager: name,
    teamIdx,
    reachFrequency,
    reachLabel,
    positionalAggression,
    rookieAppetite,
    rookieLabel,
    stackTendency,
    stackLabel,
    panicResponse,
    panicScore,
    overallArchetype,
    tendency,
    rosterCounts,
  }
}

function computeReachFrequency(adpDeltas: number[], winRate: number, ptsRatio: number): number {
  if (adpDeltas.length < 3) {
    return clamp(0.3 + (winRate > 0.55 ? 0.15 : 0) + (ptsRatio > 1.05 ? 0.1 : -0.05), 0, 1)
  }
  const reaches = adpDeltas.filter(d => d > 8).length
  const bigReaches = adpDeltas.filter(d => d > 20).length
  const ratio = (reaches + bigReaches * 0.5) / adpDeltas.length
  const baseReach = clamp(ratio * 2, 0, 0.85)
  const winBoost = winRate < 0.4 ? 0.12 : winRate > 0.65 ? -0.08 : 0
  return clamp(baseReach + winBoost, 0, 1)
}

function computePositionalAggression(
  positions: string[],
  winRate: number,
  avgPts: number,
  isDynasty: boolean,
  ptsRatio: number
): Record<string, { early: number; mid: number; late: number }> {
  const counts: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0 }
  for (const p of positions) {
    if (p in counts) counts[p]++
  }
  const total = Math.max(1, positions.length)

  const result: Record<string, { early: number; mid: number; late: number }> = {}
  for (const pos of ['QB', 'RB', 'WR', 'TE']) {
    const share = counts[pos] / total
    let earlyBias = 0
    let midBias = 0
    let lateBias = 0

    if (pos === 'RB') {
      earlyBias = clamp(share * 2.5 + (winRate > 0.55 ? 0.15 : 0), 0, 1)
      midBias = clamp(share * 1.8, 0, 1)
      lateBias = clamp(share * 0.8, 0, 1)
    } else if (pos === 'WR') {
      earlyBias = clamp(share * 2.0 + (avgPts > 115 ? 0.1 : 0), 0, 1)
      midBias = clamp(share * 2.2, 0, 1)
      lateBias = clamp(share * 1.5, 0, 1)
    } else if (pos === 'QB') {
      earlyBias = clamp(share * 1.5 + (ptsRatio > 1.1 ? 0.2 : 0), 0, 1)
      midBias = clamp(share * 2.0, 0, 1)
      lateBias = clamp(share * 1.2, 0, 1)
    } else {
      earlyBias = clamp(share * 1.2 + (isDynasty ? 0.15 : 0), 0, 1)
      midBias = clamp(share * 1.8, 0, 1)
      lateBias = clamp(share * 1.4, 0, 1)
    }

    result[pos] = {
      early: Math.round(earlyBias * 100),
      mid: Math.round(midBias * 100),
      late: Math.round(lateBias * 100),
    }
  }
  return result
}

function computeRookieAppetite(
  rookieCount: number,
  totalPlayers: number,
  ages: number[],
  isDynasty: boolean,
  winRate: number
): number {
  const total = Math.max(1, totalPlayers)
  const rookieRatio = rookieCount / total
  const avgAge = ages.length ? ages.reduce((a, b) => a + b, 0) / ages.length : 26
  const youthBoost = clamp((27 - avgAge) / 10, -0.15, 0.25)
  const dynastyBoost = isDynasty ? 0.15 : 0
  const rebuildBoost = winRate < 0.4 ? 0.12 : 0
  return clamp(rookieRatio * 2 + youthBoost + dynastyBoost + rebuildBoost, 0, 1)
}

function computeStackTendency(positions: string[], teams: string[]): number {
  if (teams.length < 4) return 0.2
  const teamCounts = new Map<string, { qb: number; wr: number; te: number }>()
  for (let i = 0; i < positions.length && i < teams.length; i++) {
    const t = teams[i]
    if (!t) continue
    if (!teamCounts.has(t)) teamCounts.set(t, { qb: 0, wr: 0, te: 0 })
    const entry = teamCounts.get(t)!
    if (positions[i] === 'QB') entry.qb++
    else if (positions[i] === 'WR') entry.wr++
    else if (positions[i] === 'TE') entry.te++
  }

  let stackPairs = 0
  for (const [, counts] of teamCounts) {
    if (counts.qb >= 1 && (counts.wr >= 1 || counts.te >= 1)) {
      stackPairs += Math.min(counts.qb, counts.wr + counts.te)
    }
  }

  return clamp(stackPairs / Math.max(1, Math.floor(teams.length / 6)), 0, 1)
}

function computePanicResponse(
  performances: Array<{ week: number; points: number }>,
  winRate: number,
  ptsRatio: number,
  adpDeltas: number[]
): { panicScore: number; panicResponse: ManagerDNA['panicResponse'] } {
  if (performances.length < 3) {
    const base = clamp(0.3 + (winRate < 0.4 ? 0.2 : 0), 0, 1)
    return { panicScore: base, panicResponse: base < 0.3 ? 'Hold Steady' : base < 0.55 ? 'Mild Pivot' : 'Reactive' }
  }

  const sorted = [...performances].sort((a, b) => a.week - b.week)
  let bigDrops = 0
  let followUpSwings = 0
  for (let i = 1; i < sorted.length; i++) {
    const dropPct = (sorted[i - 1].points - sorted[i].points) / Math.max(1, sorted[i - 1].points)
    if (dropPct > 0.25) {
      bigDrops++
      if (i + 1 < sorted.length) {
        const recovery = (sorted[i + 1].points - sorted[i].points) / Math.max(1, sorted[i].points)
        if (Math.abs(recovery) > 0.2) followUpSwings++
      }
    }
  }

  const volatility = bigDrops / Math.max(1, sorted.length - 1)
  const reachVar = adpDeltas.length > 3
    ? Math.sqrt(adpDeltas.reduce((s, d) => s + d * d, 0) / adpDeltas.length) / 30
    : 0.1
  const score = clamp(volatility * 1.5 + followUpSwings * 0.15 + reachVar + (winRate < 0.35 ? 0.15 : 0), 0, 1)

  const panicResponse = score < 0.25 ? 'Hold Steady'
    : score < 0.5 ? 'Mild Pivot'
    : score < 0.75 ? 'Reactive'
    : 'Full Panic'

  return { panicScore: score, panicResponse }
}

function deriveArchetype(
  reach: string,
  rookie: string,
  stack: string,
  panic: string,
  winRate: number,
  isDynasty: boolean
): string {
  if (reach === 'Wild Card' && panic === 'Full Panic') return 'The Gambler'
  if (reach === 'Conservative' && panic === 'Hold Steady' && winRate > 0.55) return 'The Calculator'
  if (rookie === 'Youth Movement' && isDynasty) return 'Dynasty Architect'
  if (rookie === 'Veteran-Only' && winRate > 0.6) return 'Win-Now Commander'
  if (stack === 'Stack-Dependent' || stack === 'Stack-Builder') return 'Stack Strategist'
  if (reach === 'Aggressive' && panic === 'Reactive') return 'Boom-or-Bust'
  if (panic === 'Hold Steady' && reach === 'Measured') return 'Steady Operator'
  if (rookie === 'Rookie-Heavy' && reach === 'Aggressive') return 'Youth Raider'
  if (winRate < 0.35) return 'Rebuilder'
  return 'Balanced Drafter'
}

function deriveTendency(
  positionalAgg: Record<string, { early: number; mid: number; late: number }>,
  reachFreq: number,
  isDynasty: boolean,
  avgPts: number,
  winRate: number
): Record<string, number> {
  const t: Record<string, number> = {}
  for (const pos of ['QB', 'RB', 'WR', 'TE']) {
    const agg = positionalAgg[pos]
    if (!agg) { t[pos] = 1; continue }
    const composite = (agg.early * 0.45 + agg.mid * 0.35 + agg.late * 0.2) / 100
    const reachMod = pos === 'RB' ? reachFreq * 0.12 : -reachFreq * 0.05
    t[pos] = clamp(0.7 + composite * 0.6 + reachMod, 0.5, 1.5)
  }
  if (isDynasty) t['TE'] = clamp((t['TE'] || 1) + 0.08, 0.5, 1.5)
  if (avgPts > 120) t['QB'] = clamp((t['QB'] || 1) + 0.1, 0.5, 1.5)
  if (winRate < 0.4) t['RB'] = clamp((t['RB'] || 1) + 0.1, 0.5, 1.5)
  return t
}

export function buildManagerDNAFromLeague(
  teams: Array<{
    teamName: string
    ownerName: string
    wins: number
    losses: number
    ties: number
    pointsFor: number
    currentRank: number | null
    performances: Array<{ week: number; points: number; data?: any }>
    platformUserId?: string
    isOwner?: boolean
  }>,
  rosters: Array<{ platformUserId: string; playerData: any }>,
  adpPool: ADPEntry[],
  isDynasty: boolean,
  leagueSize: number
): ManagerDNA[] {
  const rosterMap = new Map<string, string[]>()
  for (const r of rosters) {
    const pd = Array.isArray(r.playerData) ? r.playerData : ((r.playerData as any)?.players || [])
    const ids: string[] = pd.map((p: any) => typeof p === 'string' ? p : (p?.name || p?.full_name || p?.id || '')).filter(Boolean)
    rosterMap.set(r.platformUserId, ids)
  }

  const inputs: ManagerDNAInput[] = teams.map((t, i) => ({
    teamName: t.teamName,
    ownerName: t.ownerName,
    teamIdx: i,
    wins: t.wins,
    losses: t.losses,
    ties: t.ties,
    pointsFor: t.pointsFor,
    currentRank: t.currentRank,
    performances: t.performances.map(p => ({ week: p.week, points: p.points })),
    rosterPlayerIds: rosterMap.get((t as any).platformUserId || (t as any).externalId || '') || [],
    isDynasty,
    leagueSize,
  }))

  return inputs.map(inp => computeManagerDNA(inp, adpPool, inputs))
}
