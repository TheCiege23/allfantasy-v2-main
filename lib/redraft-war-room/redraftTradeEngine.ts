/**
 * REDRAFT TRADE ANALYZER / FINDER — pure, deterministic. No AI, no fabrication.
 *
 * analyzeTrade(): compares outgoing vs incoming players using the BEST AVAILABLE
 * value signal (current-week projection → season-to-date actual). It evaluates
 * roster-fit and lineup/bench impact before and after the swap. When no value
 * signal exists for the involved players, the verdict is 'needs_more_data' rather
 * than a fabricated grade.
 *
 * findTradeTargets(): ranks other rosters by complementary needs/surplus (their
 * surplus at your need positions, and vice-versa). Requires a value signal.
 *
 * Redraft-only: season-horizon framing, NO future picks, NO dynasty asset values.
 */

import { evaluateTeamNeeds } from './redraftTeamNeedsEngine'
import { playerValue } from './playerValue'
import type { RedraftPlayerFact, RedraftWarRoomContext } from './types'

export type TradeVerdict = 'accept' | 'reject' | 'neutral' | 'needs_more_data'

export interface TradeAnalysis {
  verdict: TradeVerdict
  /** Outgoing - incoming value delta from the USER's perspective (positive = user gains value). */
  valueDelta: number | null
  rosterFitDelta: number
  lineupImpact: string[]
  benchImpact: string[]
  playoffImpact: string | null
  riskFlags: string[]
  explanationFacts: string[]
  missingDataFlags: string[]
}

export interface TradeTarget {
  rosterId: string
  teamName: string | null
  fitScore: number
  theySupply: string[]
  theyNeed: string[]
  reasons: string[]
}

export interface TradeFinderResult {
  rosterId: string
  targets: TradeTarget[]
  missingDataFlags: string[]
  needsMoreData: boolean
}

function valueOf(p: RedraftPlayerFact): number | null {
  // Projection → season avg → ADP/ROS-ranking proxy. Season-horizon for redraft.
  const v = playerValue(p)
  return v.source === 'none' ? null : v.value
}

function findPlayers(context: RedraftWarRoomContext, ids: string[]): RedraftPlayerFact[] {
  const all = context.teams.flatMap((t) => t.players)
  return ids.map((id) => all.find((p) => p.playerId === id)).filter((p): p is RedraftPlayerFact => Boolean(p))
}

export interface AnalyzeTradeInput {
  /** The roster doing the analysis (the user's team). */
  rosterId: string
  /** Players leaving the user's roster. */
  outgoingPlayerIds: string[]
  /** Players joining the user's roster. */
  incomingPlayerIds: string[]
}

export function analyzeTrade(context: RedraftWarRoomContext, input: AnalyzeTradeInput): TradeAnalysis {
  const missingDataFlags = [...context.missingDataFlags]
  const facts: string[] = []
  const riskFlags: string[] = []
  const lineupImpact: string[] = []
  const benchImpact: string[] = []

  const outgoing = findPlayers(context, input.outgoingPlayerIds)
  const incoming = findPlayers(context, input.incomingPlayerIds)

  if (outgoing.length === 0 && incoming.length === 0) {
    return {
      verdict: 'needs_more_data',
      valueDelta: null,
      rosterFitDelta: 0,
      lineupImpact: [],
      benchImpact: [],
      playoffImpact: null,
      riskFlags: [],
      explanationFacts: ['No players resolved for this trade.'],
      missingDataFlags,
    }
  }

  const outValues = outgoing.map(valueOf)
  const inValues = incoming.map(valueOf)
  const haveAllValues = [...outValues, ...inValues].every((v) => v != null)
  const haveAnyValue = [...outValues, ...inValues].some((v) => v != null)

  // Value delta from the user's perspective: value received - value given.
  // 🛑 Kept for this engine's shadow telemetry only (2026-09-29): the War Room's value scale is never a
  // line users read — the verdict on this screen is the one grade (warRoomTradeGrade.ts).
  let valueDelta: number | null = null
  if (haveAnyValue) {
    const inSum = inValues.reduce<number>((s, v) => s + (v ?? 0), 0)
    const outSum = outValues.reduce<number>((s, v) => s + (v ?? 0), 0)
    valueDelta = Math.round((inSum - outSum) * 100) / 100
  }

  // Roster-fit delta: does the incoming set address a need while outgoing doesn't open one?
  const needsBefore = evaluateTeamNeeds(context, input.rosterId)
  const needPositions = new Set(needsBefore.tradeTargetPositions)
  let rosterFitDelta = 0
  for (const p of incoming) {
    if (needPositions.has(p.position)) {
      rosterFitDelta += 2
      lineupImpact.push(`Incoming ${p.playerName} addresses ${p.position} need.`)
    } else {
      rosterFitDelta += 0.5
    }
  }
  for (const p of outgoing) {
    if (needPositions.has(p.position)) {
      rosterFitDelta -= 3
      riskFlags.push(`Trading ${p.playerName} worsens an existing ${p.position} need.`)
    } else if (p.isStarterSlot) {
      rosterFitDelta -= 1
      lineupImpact.push(`Outgoing ${p.playerName} vacates a starting role.`)
    } else {
      benchImpact.push(`Outgoing ${p.playerName} reduces ${p.position} depth.`)
    }
  }
  rosterFitDelta = Math.round(rosterFitDelta * 10) / 10

  // Injury risk note (status only).
  for (const p of incoming) {
    if (p.injuryStatus && !/^(healthy|active|ok)$/i.test(p.injuryStatus)) {
      riskFlags.push(`Incoming ${p.playerName} listed ${p.injuryStatus}.`)
    }
  }

  // Playoff impact framing.
  let playoffImpact: string | null = null
  const team = context.teams.find((t) => t.rosterId === input.rosterId)
  if (team && context.availability.standings === 'available') {
    if (team.isEliminated) {
      playoffImpact = 'Team is eliminated — prioritize next-season value or league fairness.'
    } else {
      const weeksLeft = Math.max(0, context.playoffStartWeek - Math.max(1, context.currentWeek))
      playoffImpact = `~${weeksLeft} week(s) to playoffs; weigh immediate starting-lineup gain over depth.`
    }
  }

  // Verdict.
  let verdict: TradeVerdict
  if (!haveAnyValue) {
    verdict = 'needs_more_data'
    missingDataFlags.push('No projection/stat signal for the involved players.')
  } else {
    const valueScore = valueDelta ?? 0
    const composite = valueScore + rosterFitDelta * 1.5
    if (!haveAllValues) riskFlags.push('Some players have no projection/stat signal.')
    if (composite >= 3) verdict = 'accept'
    else if (composite <= -3) verdict = 'reject'
    else verdict = 'neutral'
  }

  return {
    verdict,
    valueDelta,
    rosterFitDelta,
    lineupImpact: [...new Set(lineupImpact)],
    benchImpact: [...new Set(benchImpact)],
    playoffImpact,
    riskFlags: [...new Set(riskFlags)],
    explanationFacts: facts,
    missingDataFlags: [...new Set(missingDataFlags)],
  }
}

export function findTradeTargets(context: RedraftWarRoomContext, rosterId: string): TradeFinderResult {
  const missingDataFlags = [...context.missingDataFlags]
  const hasValueSignal = context.availability.tradeValues === 'available'
  if (!hasValueSignal) {
    missingDataFlags.push('Trade finder needs projection or stat data to rank partner fit.')
    return { rosterId, targets: [], missingDataFlags: [...new Set(missingDataFlags)], needsMoreData: true }
  }

  const myNeeds = evaluateTeamNeeds(context, rosterId)
  const myNeedPositions = new Set(myNeeds.tradeTargetPositions)
  // My surplus = positions where I have depth beyond requirement.
  const me = context.teams.find((t) => t.rosterId === rosterId)
  const mySurplus = new Set<string>()
  if (me) {
    const byPos: Record<string, number> = {}
    for (const p of me.players) byPos[p.position] = (byPos[p.position] ?? 0) + 1
    for (const [pos, count] of Object.entries(byPos)) {
      if (count >= (context.roster.requiredByPosition[pos] ?? 0) + 2) mySurplus.add(pos)
    }
  }

  const targets: TradeTarget[] = []
  for (const other of context.teams) {
    if (other.rosterId === rosterId) continue
    const otherNeeds = evaluateTeamNeeds(context, other.rosterId)
    const otherNeedPositions = new Set(otherNeeds.tradeTargetPositions)
    const otherByPos: Record<string, number> = {}
    for (const p of other.players) otherByPos[p.position] = (otherByPos[p.position] ?? 0) + 1
    const otherSurplus = new Set(
      Object.entries(otherByPos)
        .filter(([pos, count]) => count >= (context.roster.requiredByPosition[pos] ?? 0) + 2)
        .map(([pos]) => pos),
    )

    const theySupply = [...otherSurplus].filter((pos) => myNeedPositions.has(pos))
    const theyNeed = [...mySurplusIntersect(mySurplus, otherNeedPositions)]
    let fitScore = theySupply.length * 20 + theyNeed.length * 20
    const reasons: string[] = []
    if (theySupply.length) reasons.push(`They have surplus ${theySupply.join('/')} you need.`)
    if (theyNeed.length) reasons.push(`They need ${theyNeed.join('/')} where you have depth.`)
    if (fitScore <= 0) continue
    fitScore = Math.min(100, fitScore)
    targets.push({
      rosterId: other.rosterId,
      teamName: other.teamName,
      fitScore,
      theySupply,
      theyNeed,
      reasons,
    })
  }

  targets.sort((a, b) => b.fitScore - a.fitScore)
  return { rosterId, targets, missingDataFlags: [...new Set(missingDataFlags)], needsMoreData: false }
}

function mySurplusIntersect(mySurplus: Set<string>, otherNeeds: Set<string>): Set<string> {
  const out = new Set<string>()
  for (const pos of mySurplus) if (otherNeeds.has(pos)) out.add(pos)
  return out
}
