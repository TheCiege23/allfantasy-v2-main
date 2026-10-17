/**
 * GUILLOTINE TRADE ENGINE — pure, deterministic. No AI, no fabrication.
 *
 * Guillotine leagues usually DISABLE trades — in that case this returns a truthful disabled
 * state. When trades ARE enabled, analysis is survival-first: weighs floor value + whether
 * the incoming set shores up a weak (elimination-risk) starting position. A missing value
 * signal is flagged, never fabricated.
 *
 * 🛑 IT RETURNS FACTS, NEVER A VERDICT (2026-09-30) — see redraftTradeEngine.ts. The
 * verdict is THE grade (lib/decision-os/trade/warRoomTradeGrade.ts); the retired
 * accept / reject / neutral / disabled rule for the shadow is
 * lib/decision-os/trade/warRoomLegacyVerdict.ts (the route passes `tradesEnabled`).
 */

import { playerValue } from './guillotineValue'
import { evaluateRosterRisk } from './guillotineRosterRiskEngine'
import type { GuillotinePlayerFact, GuillotineWarRoomContext } from './types'

export interface GuillotineTradeAnalysis {
  /** Incoming − outgoing floor-value delta; null when no value signal. Shadow input only. */
  valueDelta: number | null
  rosterFitDelta: number
  riskFlags: string[]
  explanationFacts: string[]
  missingDataFlags: string[]
}

function valueOf(p: GuillotinePlayerFact): number | null {
  const v = playerValue(p)
  return v.source === 'none' ? null : v.value
}

function findPlayers(context: GuillotineWarRoomContext, ids: string[]): GuillotinePlayerFact[] {
  const all = context.teams.flatMap((t) => t.players)
  return ids.map((id) => all.find((p) => p.playerId === id)).filter((p): p is GuillotinePlayerFact => Boolean(p))
}

export interface AnalyzeGuillotineTradeInput {
  rosterId: string
  outgoingPlayerIds: string[]
  incomingPlayerIds: string[]
}

export function guillotineTradeFacts(context: GuillotineWarRoomContext, input: AnalyzeGuillotineTradeInput): GuillotineTradeAnalysis {
  const missingDataFlags = [...context.missingDataFlags]
  if (!context.guillotine.tradesEnabled) {
    return { valueDelta: null, rosterFitDelta: 0, riskFlags: [], explanationFacts: ['Trades are disabled in this guillotine league.'], missingDataFlags: [...new Set(missingDataFlags)] }
  }

  const facts: string[] = []
  const riskFlags: string[] = []
  const outgoing = findPlayers(context, input.outgoingPlayerIds)
  const incoming = findPlayers(context, input.incomingPlayerIds)
  if (outgoing.length === 0 && incoming.length === 0) {
    return { valueDelta: null, rosterFitDelta: 0, riskFlags: [], explanationFacts: ['No players resolved for this trade.'], missingDataFlags }
  }

  const outVals = outgoing.map(valueOf)
  const inVals = incoming.map(valueOf)
  const haveAny = [...outVals, ...inVals].some((v) => v != null)
  // 🛑 Kept for this engine's shadow telemetry only (2026-09-29): the War Room's value scale is never a
  // line users read — the verdict on this screen is the one grade (warRoomTradeGrade.ts).
  let valueDelta: number | null = null
  if (haveAny) {
    const inSum = inVals.reduce<number>((s, v) => s + (v ?? 0), 0)
    const outSum = outVals.reduce<number>((s, v) => s + (v ?? 0), 0)
    valueDelta = Math.round((inSum - outSum) * 100) / 100
  }

  const weakPositions = new Set(evaluateRosterRisk(context, input.rosterId).weaknesses.map((w) => w.position))
  let rosterFitDelta = 0
  for (const p of incoming) rosterFitDelta += weakPositions.has(p.position) ? 2 : 0.5
  for (const p of outgoing) {
    if (weakPositions.has(p.position)) {
      rosterFitDelta -= 3
      riskFlags.push(`Trading ${p.playerName} worsens an elimination-risk ${p.position} weakness.`)
    } else if (p.isStarterSlot) rosterFitDelta -= 1
  }
  rosterFitDelta = Math.round(rosterFitDelta * 10) / 10

  // Value-signal coverage — a fact, not a verdict (the retired rule is warRoomLegacyVerdict.ts).
  if (!haveAny) missingDataFlags.push('No value signal for the involved players.')

  return { valueDelta, rosterFitDelta, riskFlags: [...new Set(riskFlags)], explanationFacts: facts, missingDataFlags: [...new Set(missingDataFlags)] }
}
