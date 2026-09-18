import type { WaiverRosterPlayer } from '@/lib/decision-os/waiver/candidateScoring'

export interface SlotNeed {
  slot: string
  position: string
  currentPlayer: string | null
  currentValue: number
  leagueMedianValue: number
  gap: number
  gapPpg: number
}

export interface ByeWeekCluster {
  week: number
  playersOut: string[]
  positionsAffected: string[]
  severity: 'critical' | 'moderate' | 'minor'
}

export interface PositionalDepth {
  position: string
  count: number
  leagueMedianCount: number
  totalValue: number
  leagueMedianValue: number
  depthRating: number
}

export interface DropRiskOfRegret {
  playerId: string
  playerName: string
  position: string
  value: number
  riskOfRegret: number
  riskLabel: string
  reason: string
}

export interface TeamNeedsMap {
  weakestSlots: SlotNeed[]
  biggestNeed: SlotNeed | null
  byeWeekClusters: ByeWeekCluster[]
  positionalDepth: PositionalDepth[]
  dropCandidates: DropRiskOfRegret[]
  /**
   * Every position this league actually starts, expanded from its own slots.
   *
   * 🛑 THIS IS THE WAIVER ENGINE'S ONLY EVIDENCE THAT A DEFENSIVE POSITION IS WORTH
   * RECOMMENDING, and it is OPTIONAL on purpose. Absent means "nobody computed the needs", not
   * "this league starts nothing" — the engine then falls back to recommending no defenders at all,
   * which is the honest degrade and is exactly what every caller did before this field existed.
   */
  startablePositions?: string[]
}

export type UserGoal = 'win-now' | 'balanced' | 'rebuild'

/**
 * 🛑 THIS WAS A HARDCODED 2025 SLATE, USED IN THE 2026 SEASON. Every bye-week cluster it produced
 * was last year's: the advice warned about weeks that were not byes and stayed silent on the ones
 * that were. A table keyed to a year is wrong every year but one, and nothing tells you which year
 * you are in — so the slate is now passed in, read from the schedule by
 * `lib/core-app/byeWeekMap.ts` (which asks the repo's one bye rule, `byeStatus`).
 *
 * ⚠ ABSENT MEANS UNKNOWN, NOT "NO BYE". A club missing from the map produces no cluster for its
 * players, which is the honest degrade: a missing bye warning, never a wrong one.
 */
export type ByeWeekByClub = Record<string, number>

const VALUE_TO_PPG_FACTOR = 0.0012

/**
 * Individual defensive positions, in every spelling that reaches this code.
 *
 * ⚠ TWO VOCABULARIES ARRIVE AND ONLY ONE IS FOLDED. `SportPlayerPoolResolver` normalises the WIRE
 * through `normalizeNflIdpPosition` (EDGE->DE, OLB/ILB/MLB->LB, SS/FS->S, NT->DT), but the ROSTER
 * side is read straight off `SportsPlayer.position` and keeps whatever the provider wrote — so a
 * manager can be starting an `OLB` against an `LB` slot. Holding both spellings is deliberate: a
 * superset is harmless in a membership test, while a missing spelling silently drops a real starter.
 */
export const IDP_POSITIONS: ReadonlySet<string> = new Set([
  'DL', 'DE', 'DT', 'NT', 'EDGE',
  'LB', 'ILB', 'OLB', 'MLB',
  'DB', 'CB', 'S', 'SS', 'FS',
  'IDP',
])

/**
 * Whole-unit positions: a kicker and a team defence.
 *
 * These are never waiver-scored, even in a league that starts them — a measured limitation rather
 * than an oversight. See `scorablePosition` in the waiver engine for why.
 */
export const TEAM_UNIT_POSITIONS: ReadonlySet<string> = new Set(['K', 'DEF', 'DST', 'D/ST'])

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/**
 * The positions a starting slot accepts.
 *
 * 🛑 THIS IS THE ONE PLACE THAT KNOWS WHAT A LEAGUE STARTS, and it is exported so the waiver
 * engine can ask instead of carrying a second copy. Two implementations of one rule is the bug.
 *
 * ⚠ AN UNKNOWN SLOT RETURNS [], AND EVERY CALLER MUST READ THAT AS "no evidence" rather than "no
 * positions". An unrecognised slot must never widen what gets recommended.
 */
export function mapSlotToPositions(slot: string): string[] {
  const s = slot.toUpperCase()
  if (s === 'QB') return ['QB']
  if (s === 'RB') return ['RB']
  if (s === 'WR') return ['WR']
  if (s === 'TE') return ['TE']
  if (s === 'K') return ['K']
  /*
   * A team defence is written `DEF`, `DST` or `D/ST` depending on the platform. A slot spelled one
   * way never matched a roster spelled another, which read as an empty slot — and so as a need
   * worth the whole league median.
   */
  if (s === 'DEF' || s === 'DST' || s === 'D/ST') return ['DEF', 'DST', 'D/ST']
  if (s === 'FLEX' || s === 'RB/WR/TE') return ['RB', 'WR', 'TE']
  if (s === 'SUPER_FLEX' || s === 'SF' || s === 'QB/RB/WR/TE') return ['QB', 'RB', 'WR', 'TE']
  if (s === 'REC_FLEX' || s === 'WR/TE') return ['WR', 'TE']
  /*
   * 🛑 THE DISCRETE DEFENSIVE SLOTS WERE ABSENT, so an IDP league's `LB`, `DL` and `DB` slots
   * each mapped to [] and dropped out of the slot maths entirely: no weakest slot, no need, no gap.
   * The only defensive slot this knew was `IDP_FLEX`, and it answered ['LB','DL','DB'] — which a
   * real Sleeper roster never matches, because that roster holds a `CB` or a `DE`.
   */
  if (s === 'LB') return ['LB', 'ILB', 'OLB', 'MLB']
  if (s === 'ILB' || s === 'MLB') return ['ILB', 'MLB', 'LB']
  if (s === 'OLB') return ['OLB', 'LB']
  if (s === 'DL') return ['DL', 'DE', 'DT', 'NT', 'EDGE']
  if (s === 'DE' || s === 'EDGE') return ['DE', 'EDGE', 'DL']
  if (s === 'DT' || s === 'NT') return ['DT', 'NT', 'DL']
  if (s === 'DB') return ['DB', 'CB', 'S', 'SS', 'FS']
  if (s === 'CB') return ['CB', 'DB']
  if (s === 'S' || s === 'SS' || s === 'FS') return ['S', 'SS', 'FS', 'DB']
  if (s === 'IDP_FLEX' || s === 'IDP') return [...IDP_POSITIONS]
  return []
}

export function computeTeamNeeds(
  rosterPlayers: WaiverRosterPlayer[],
  rosterPositions: string[],
  allLeagueRosters: { players: WaiverRosterPlayer[] }[],
  currentWeek: number,
  /** This season's byes, by club. Omit it and no bye cluster is produced — see `ByeWeekByClub`. */
  byeWeekByClub: ByeWeekByClub = {},
): TeamNeedsMap {
  const starterSlots = rosterPositions.filter(s => s !== 'BN' && s !== 'IR' && s !== 'TAXI')
  const starters = rosterPlayers.filter(p => p.slot === 'starter')
  const bench = rosterPlayers.filter(p => p.slot === 'bench')

  const weakestSlots = computeWeakestSlots(starters, starterSlots, allLeagueRosters)
  const biggestNeed = weakestSlots.length > 0 ? weakestSlots[0] : null
  const byeWeekClusters = computeByeWeekClusters(starters, currentWeek, byeWeekByClub)
  /*
   * ⚠ `flatMap` HANDS ITS CALLBACK (value, index, array). Passing `mapSlotToPositions` bare would
   * still work today because it reads one parameter, but it is one signature change away from
   * silently taking an index as a slot name.
   */
  const startablePositions = [...new Set(starterSlots.flatMap((slot) => mapSlotToPositions(slot)))]
  const positionalDepth = computePositionalDepth(rosterPlayers, allLeagueRosters, startablePositions)
  const dropCandidates = computeDropCandidates(rosterPlayers)

  return {
    weakestSlots,
    biggestNeed,
    byeWeekClusters,
    positionalDepth,
    dropCandidates,
    startablePositions,
  }
}

function computeWeakestSlots(
  starters: WaiverRosterPlayer[],
  starterSlots: string[],
  allLeagueRosters: { players: WaiverRosterPlayer[] }[],
): SlotNeed[] {
  const slotNeeds: SlotNeed[] = []

  const leagueStarterValues: Record<string, number[]> = {}
  for (const roster of allLeagueRosters) {
    const rStarters = roster.players.filter(p => p.slot === 'starter')
    for (const p of rStarters) {
      if (!leagueStarterValues[p.position]) leagueStarterValues[p.position] = []
      leagueStarterValues[p.position].push(p.value)
    }
  }

  const medianByPos: Record<string, number> = {}
  for (const [pos, vals] of Object.entries(leagueStarterValues)) {
    const sorted = [...vals].sort((a, b) => a - b)
    medianByPos[pos] = sorted[Math.floor(sorted.length / 2)] || 0
  }

  const assignedStarters = new Set<string>()

  for (const slot of starterSlots) {
    const eligiblePositions = mapSlotToPositions(slot)
    if (eligiblePositions.length === 0) continue

    const assignedStarter = starters.find(
      p => eligiblePositions.includes(p.position) && !assignedStarters.has(p.id)
    )

    if (assignedStarter) {
      assignedStarters.add(assignedStarter.id)
    }

    const currentValue = assignedStarter?.value ?? 0
    const pos = assignedStarter?.position ?? eligiblePositions[0]
    const medianValue = medianByPos[pos] ?? 3000

    const gap = medianValue - currentValue
    const gapPpg = Math.round(gap * VALUE_TO_PPG_FACTOR * 10) / 10

    if (gap > 500) {
      slotNeeds.push({
        slot,
        position: pos,
        currentPlayer: assignedStarter?.name ?? null,
        currentValue,
        leagueMedianValue: medianValue,
        gap,
        gapPpg,
      })
    }
  }

  slotNeeds.sort((a, b) => b.gap - a.gap)
  return slotNeeds
}

function computeByeWeekClusters(
  starters: WaiverRosterPlayer[],
  currentWeek: number,
  byeWeekByClub: ByeWeekByClub,
): ByeWeekCluster[] {
  const byeMap: Record<number, WaiverRosterPlayer[]> = {}

  for (const p of starters) {
    if (!p.team) continue
    const byeWeek = byeWeekByClub[p.team.toUpperCase()]
    if (!byeWeek || byeWeek <= currentWeek) continue

    if (!byeMap[byeWeek]) byeMap[byeWeek] = []
    byeMap[byeWeek].push(p)
  }

  const clusters: ByeWeekCluster[] = []

  for (const [weekStr, players] of Object.entries(byeMap)) {
    const week = Number(weekStr)
    if (players.length < 2) continue

    const positionsAffected = [...new Set(players.map(p => p.position))]
    const severity: ByeWeekCluster['severity'] =
      players.length >= 4 ? 'critical' :
      players.length >= 3 ? 'moderate' :
      'minor'

    clusters.push({
      week,
      playersOut: players.map(p => p.name),
      positionsAffected,
      severity,
    })
  }

  clusters.sort((a, b) => {
    const severityOrder = { critical: 0, moderate: 1, minor: 2 }
    return severityOrder[a.severity] - severityOrder[b.severity] || a.week - b.week
  })

  return clusters
}

const DEPTH_BASE_POSITIONS = ['QB', 'RB', 'WR', 'TE']

function computePositionalDepth(
  rosterPlayers: WaiverRosterPlayer[],
  allLeagueRosters: { players: WaiverRosterPlayer[] }[],
  startablePositions: string[] = [],
): PositionalDepth[] {
  /*
   * 🛑 THIS WAS FOUR HARDCODED POSITIONS, so an IDP league got no depth reading for the half
   * of its lineup that is defensive — the `wa_depth_gap` driver could never fire for a linebacker.
   *
   * ⚠ IT ADDS ONLY POSITIONS SOMEBODY IN THE LEAGUE ACTUALLY ROSTERS, and it adds them under the
   * spelling the rosters use. Enumerating every spelling a slot accepts would emit zero-count rows
   * for aliases nobody writes (an `ILB` row in a league whose provider says `LB`), and a zero count
   * reads as a depth hole rather than as an absent label. K and team defences stay out: they are
   * not priced on the scale these ratings are built from.
   */
  const startable = new Set(startablePositions.map((p) => p.toUpperCase()))
  const rostered = new Set<string>()
  for (const roster of allLeagueRosters) {
    for (const p of roster.players) rostered.add(p.position)
  }
  const extra = [...rostered].filter(
    (p) =>
      !DEPTH_BASE_POSITIONS.includes(p) &&
      startable.has(p.toUpperCase()) &&
      !TEAM_UNIT_POSITIONS.has(p.toUpperCase()),
  )
  const positions = [...DEPTH_BASE_POSITIONS, ...extra]
  const result: PositionalDepth[] = []

  for (const pos of positions) {
    const myPlayers = rosterPlayers.filter(p => p.position === pos && p.slot !== 'ir')
    const myCount = myPlayers.length
    const myTotalValue = myPlayers.reduce((s, p) => s + p.value, 0)

    const leagueCounts: number[] = []
    const leagueValues: number[] = []
    for (const roster of allLeagueRosters) {
      const posPlayers = roster.players.filter(p => p.position === pos && p.slot !== 'ir')
      leagueCounts.push(posPlayers.length)
      leagueValues.push(posPlayers.reduce((s, p) => s + p.value, 0))
    }

    const sortedCounts = [...leagueCounts].sort((a, b) => a - b)
    const sortedValues = [...leagueValues].sort((a, b) => a - b)
    const medianCount = sortedCounts[Math.floor(sortedCounts.length / 2)] || 0
    const medianValue = sortedValues[Math.floor(sortedValues.length / 2)] || 0

    let depthRating = 50
    if (medianValue > 0) {
      depthRating = clamp(Math.round((myTotalValue / medianValue) * 50), 0, 100)
    }
    if (myCount < medianCount) depthRating = Math.max(0, depthRating - 15)
    if (myCount > medianCount + 1) depthRating = Math.min(100, depthRating + 10)

    result.push({
      position: pos,
      count: myCount,
      leagueMedianCount: medianCount,
      totalValue: myTotalValue,
      leagueMedianValue: medianValue,
      depthRating,
    })
  }

  result.sort((a, b) => a.depthRating - b.depthRating)
  return result
}

function computeDropCandidates(rosterPlayers: WaiverRosterPlayer[]): DropRiskOfRegret[] {
  const benchPlayers = rosterPlayers
    .filter(p => p.slot === 'bench' && !['K', 'DEF'].includes(p.position))
    .sort((a, b) => a.value - b.value)

  return benchPlayers.slice(0, 5).map(p => {
    let riskOfRegret = 0
    let riskLabel = 'Low'
    let reason = 'Low-value bench player'

    if (p.value >= 5000) {
      riskOfRegret = 85
      riskLabel = 'High'
      reason = 'Significant trade value — consider trading instead'
    } else if (p.value >= 3000) {
      riskOfRegret = 60
      riskLabel = 'Moderate'
      reason = 'Decent value — could be useful depth or trade chip'
    } else if (p.value >= 1500) {
      riskOfRegret = 35
      riskLabel = 'Low-Moderate'
      reason = 'Marginal value but replacement-level'
    } else {
      riskOfRegret = 10
      riskLabel = 'Low'
      reason = 'Replacement-level — safe to drop'
    }

    const age = p.age ?? 26
    if (age <= 23 && p.value >= 1000) {
      riskOfRegret = Math.min(95, riskOfRegret + 20)
      riskLabel = riskOfRegret >= 60 ? 'High' : 'Moderate'
      reason += '. Young upside player.'
    }

    return {
      playerId: p.id,
      playerName: p.name,
      position: p.position,
      value: p.value,
      riskOfRegret: clamp(riskOfRegret, 0, 100),
      riskLabel,
      reason,
    }
  })
}

export function deriveGoalFromContext(
  pointsFor: number,
  leagueAvg: number,
  isDynasty: boolean,
): UserGoal {
  if (!isDynasty) return 'win-now'
  if (pointsFor > leagueAvg * 1.1) return 'win-now'
  if (pointsFor < leagueAvg * 0.9) return 'rebuild'
  return 'balanced'
}
