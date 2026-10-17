/**
 * BEST BALL TRADE ENGINE — pure, deterministic. No AI, no fabrication.
 *
 * Most best-ball leagues DISABLE trades — in that case analyze/find return a truthful
 * disabled state. When trades ARE enabled, analysis weighs CEILING/value + roster-fit
 * (does the incoming set address a thin/fragile position?). No manual lineup, no future
 * picks. A missing value signal is flagged, never fabricated.
 *
 * 🛑 IT RETURNS FACTS, NEVER A VERDICT (2026-09-30) — see redraftTradeEngine.ts. The
 * verdict is THE grade (lib/decision-os/trade/warRoomTradeGrade.ts); the retired
 * accept / reject / neutral / disabled rule for the shadow is
 * lib/decision-os/trade/warRoomLegacyVerdict.ts (the route passes `tradesEnabled`).
 */

import { ceilingValue } from './bestBallValue'
import { evaluateDepth } from './bestBallDepthEngine'
import type { BestBallPlayerFact, BestBallWarRoomContext } from './types'

export interface BestBallTradeAnalysis {
  /** Incoming − outgoing ceiling-value delta; null when no value signal. Shadow input only. */
  valueDelta: number | null
  rosterFitDelta: number
  riskFlags: string[]
  explanationFacts: string[]
  missingDataFlags: string[]
}

export interface BestBallTradeTarget {
  rosterId: string
  teamName: string | null
  fitScore: number
  theySupply: string[]
  theyNeed: string[]
  reasons: string[]
}

export interface BestBallTradeFinderResult {
  rosterId: string
  enabled: boolean
  targets: BestBallTradeTarget[]
  missingDataFlags: string[]
  needsMoreData: boolean
}

function ceilOf(p: BestBallPlayerFact): number | null {
  const c = ceilingValue(p)
  return c.source === 'none' ? null : c.value
}

function findPlayers(context: BestBallWarRoomContext, ids: string[]): BestBallPlayerFact[] {
  const all = context.teams.flatMap((t) => t.players)
  return ids.map((id) => all.find((p) => p.playerId === id)).filter((p): p is BestBallPlayerFact => Boolean(p))
}

export interface AnalyzeBestBallTradeInput {
  rosterId: string
  outgoingPlayerIds: string[]
  incomingPlayerIds: string[]
}

export function bestBallTradeFacts(context: BestBallWarRoomContext, input: AnalyzeBestBallTradeInput): BestBallTradeAnalysis {
  const missingDataFlags = [...context.missingDataFlags]
  if (!context.bestBall.tradesEnabled) {
    return {
      valueDelta: null,
      rosterFitDelta: 0,
      riskFlags: [],
      explanationFacts: ['Trades are disabled in this best-ball league (draft-only).'],
      missingDataFlags: [...new Set(missingDataFlags)],
    }
  }

  const facts: string[] = []
  const riskFlags: string[] = []
  const outgoing = findPlayers(context, input.outgoingPlayerIds)
  const incoming = findPlayers(context, input.incomingPlayerIds)
  if (outgoing.length === 0 && incoming.length === 0) {
    return { valueDelta: null, rosterFitDelta: 0, riskFlags: [], explanationFacts: ['No players resolved for this trade.'], missingDataFlags }
  }

  const outVals = outgoing.map(ceilOf)
  const inVals = incoming.map(ceilOf)
  const haveAny = [...outVals, ...inVals].some((v) => v != null)
  // 🛑 Kept for this engine's shadow telemetry only (2026-09-29): the War Room's value scale is never a
  // line users read — the verdict on this screen is the one grade (warRoomTradeGrade.ts).
  let valueDelta: number | null = null
  if (haveAny) {
    const inSum = inVals.reduce<number>((s, v) => s + (v ?? 0), 0)
    const outSum = outVals.reduce<number>((s, v) => s + (v ?? 0), 0)
    valueDelta = Math.round((inSum - outSum) * 100) / 100
  }

  const fragile = new Set(evaluateDepth(context, input.rosterId).fragilePositions)
  let rosterFitDelta = 0
  for (const p of incoming) rosterFitDelta += fragile.has(p.position) ? 2 : 0.5
  for (const p of outgoing) {
    if (fragile.has(p.position)) {
      rosterFitDelta -= 3
      riskFlags.push(`Trading ${p.playerName} thins an already-fragile ${p.position}.`)
    }
  }
  rosterFitDelta = Math.round(rosterFitDelta * 10) / 10

  // Value-signal coverage — a fact, not a verdict (the retired rule is warRoomLegacyVerdict.ts).
  if (!haveAny) missingDataFlags.push('No value signal for the involved players.')

  return { valueDelta, rosterFitDelta, riskFlags: [...new Set(riskFlags)], explanationFacts: facts, missingDataFlags: [...new Set(missingDataFlags)] }
}

export function findBestBallTradeTargets(context: BestBallWarRoomContext, rosterId: string): BestBallTradeFinderResult {
  const missingDataFlags = [...context.missingDataFlags]
  if (!context.bestBall.tradesEnabled) {
    return { rosterId, enabled: false, targets: [], missingDataFlags: [...new Set([...missingDataFlags, 'Trades are disabled in this best-ball league (draft-only).'])], needsMoreData: false }
  }
  if (!context.featureAvailability.tradeFind) {
    return { rosterId, enabled: true, targets: [], missingDataFlags: [...new Set([...missingDataFlags, 'Trade finder needs ADP/value data to rank partner fit.'])], needsMoreData: true }
  }

  const myFragile = new Set(evaluateDepth(context, rosterId).fragilePositions)
  const me = context.teams.find((t) => t.rosterId === rosterId)
  const mySurplus = new Set<string>()
  if (me) {
    const byPos: Record<string, number> = {}
    for (const p of me.players) byPos[p.position] = (byPos[p.position] ?? 0) + 1
    for (const [pos, n] of Object.entries(byPos)) if (n >= (context.roster.requiredByPosition[pos] ?? 0) + 3) mySurplus.add(pos)
  }

  const targets: BestBallTradeTarget[] = []
  for (const other of context.teams) {
    if (other.rosterId === rosterId) continue
    const otherFragile = new Set(evaluateDepth(context, other.rosterId).fragilePositions)
    const otherByPos: Record<string, number> = {}
    for (const p of other.players) otherByPos[p.position] = (otherByPos[p.position] ?? 0) + 1
    const otherSurplus = new Set(Object.entries(otherByPos).filter(([pos, n]) => n >= (context.roster.requiredByPosition[pos] ?? 0) + 3).map(([pos]) => pos))

    const theySupply = [...otherSurplus].filter((pos) => myFragile.has(pos))
    const theyNeed = [...mySurplus].filter((pos) => otherFragile.has(pos))
    let fitScore = theySupply.length * 22 + theyNeed.length * 22
    const reasons: string[] = []
    if (theySupply.length) reasons.push(`They have surplus ${theySupply.join('/')} where you are fragile.`)
    if (theyNeed.length) reasons.push(`They are fragile at ${theyNeed.join('/')} where you have surplus.`)
    if (fitScore <= 0) continue
    fitScore = Math.min(100, fitScore)
    targets.push({ rosterId: other.rosterId, teamName: other.teamName, fitScore, theySupply, theyNeed, reasons })
  }
  targets.sort((a, b) => b.fitScore - a.fitScore)
  return { rosterId, enabled: true, targets, missingDataFlags: [...new Set(missingDataFlags)], needsMoreData: false }
}
