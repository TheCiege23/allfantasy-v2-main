/**
 * KEEPER TRADE FACTS — pure, deterministic. No AI, no fabrication.
 *
 * Compares outgoing vs incoming on SEASON value (projection → avg → ADP) AND keeper
 * implications: a player who is also a strong future keeper (positive surplus) carries
 * extra value; acquiring an expensive/negative-surplus player is flagged. A missing value
 * signal is flagged, never fabricated.
 * Keeper-only: NO future picks, NO dynasty pick capital.
 *
 * 🛑 IT RETURNS FACTS, NEVER A VERDICT (2026-09-30) — see redraftTradeEngine.ts. The
 * verdict is THE grade (lib/decision-os/trade/warRoomTradeGrade.ts); the retired
 * accept / reject / neutral rule that reads `valueDelta` / `rosterFitDelta` /
 * `keeperSurplusDelta` for the shadow is lib/decision-os/trade/warRoomLegacyVerdict.ts.
 */

import { playerSeasonValue } from './keeperValueEngine'
import { evaluateKeeperRosterNeeds } from './keeperRosterNeedsEngine'
import type { KeeperPlayerFact, KeeperWarRoomContext } from './types'

export interface KeeperTradeAnalysis {
  /** Incoming − outgoing season-value delta from the USER's perspective. Shadow input only. */
  valueDelta: number | null
  rosterFitDelta: number
  /**
   * Keeper-surplus term: + for acquiring a strong keeper, − for surrendering one (capped per player).
   * Shadow input only — it was the keeper engine's extra term in the retired composite.
   */
  keeperSurplusDelta: number
  /** Notes about keeper-surplus implications of the involved players. */
  keeperImpact: string[]
  riskFlags: string[]
  explanationFacts: string[]
  missingDataFlags: string[]
}

function seasonValueOf(p: KeeperPlayerFact): number | null {
  const v = playerSeasonValue(p)
  return v.source === 'none' ? null : v.value
}

function findPlayers(context: KeeperWarRoomContext, ids: string[]): KeeperPlayerFact[] {
  const all = [...context.teams.flatMap((t) => t.players), ...context.freeAgents]
  return ids.map((id) => all.find((p) => p.playerId === id)).filter((p): p is KeeperPlayerFact => Boolean(p))
}

export interface AnalyzeKeeperTradeInput {
  rosterId: string
  outgoingPlayerIds: string[]
  incomingPlayerIds: string[]
}

export function keeperTradeFacts(context: KeeperWarRoomContext, input: AnalyzeKeeperTradeInput): KeeperTradeAnalysis {
  const missingDataFlags = [...context.missingDataFlags]
  const facts: string[] = []
  const riskFlags: string[] = []
  const keeperImpact: string[] = []

  const outgoing = findPlayers(context, input.outgoingPlayerIds)
  const incoming = findPlayers(context, input.incomingPlayerIds)

  if (outgoing.length === 0 && incoming.length === 0) {
    return {
      valueDelta: null,
      rosterFitDelta: 0,
      keeperSurplusDelta: 0,
      keeperImpact: [],
      riskFlags: [],
      explanationFacts: ['No players resolved for this trade.'],
      missingDataFlags,
    }
  }

  const outValues = outgoing.map(seasonValueOf)
  const inValues = incoming.map(seasonValueOf)
  const haveAllValues = [...outValues, ...inValues].every((v) => v != null)
  const haveAnyValue = [...outValues, ...inValues].some((v) => v != null)

  // 🛑 Kept for this engine's shadow telemetry only (2026-09-29): the War Room's value scale is never a
  // line users read — the verdict on this screen is the one grade (warRoomTradeGrade.ts).
  let valueDelta: number | null = null
  if (haveAnyValue) {
    const inSum = inValues.reduce<number>((s, v) => s + (v ?? 0), 0)
    const outSum = outValues.reduce<number>((s, v) => s + (v ?? 0), 0)
    valueDelta = Math.round((inSum - outSum) * 100) / 100
  }

  // Keeper-surplus implications (only meaningful with keeper-cost data).
  let keeperBonus = 0
  for (const p of incoming) {
    if (p.surplusRounds != null && p.surplusRounds >= 2) {
      keeperBonus += Math.min(3, p.surplusRounds * 0.5)
      keeperImpact.push(`Incoming ${p.playerName} is also a strong keeper (+${p.surplusRounds} rounds surplus).`)
    } else if (p.surplusRounds != null && p.surplusRounds < 0) {
      riskFlags.push(`Incoming ${p.playerName} is a negative-value keeper (${p.surplusRounds} rounds) — useful this season only.`)
    }
  }
  for (const p of outgoing) {
    if (p.surplusRounds != null && p.surplusRounds >= 3) {
      keeperBonus -= Math.min(3, p.surplusRounds * 0.5)
      riskFlags.push(`Trading ${p.playerName} surrenders a strong keeper (+${p.surplusRounds} rounds surplus).`)
    }
  }
  if (context.availability.keeperCosts === 'missing') {
    missingDataFlags.push('Keeper-cost data unavailable — trade weighed on season value only, not keeper surplus.')
  }

  // Roster-fit vs needs after keepers.
  const needs = evaluateKeeperRosterNeeds(context, input.rosterId)
  const needPositions = new Set(needs.draftTargetPositions)
  let rosterFitDelta = 0
  for (const p of incoming) rosterFitDelta += needPositions.has(p.position) ? 2 : 0.5
  for (const p of outgoing) {
    if (needPositions.has(p.position)) {
      rosterFitDelta -= 3
      riskFlags.push(`Trading ${p.playerName} worsens a ${p.position} need.`)
    } else if (p.isStarterSlot) rosterFitDelta -= 1
  }
  rosterFitDelta = Math.round(rosterFitDelta * 10) / 10

  for (const p of incoming) {
    if (p.injuryStatus && !/^(healthy|active|ok)$/i.test(p.injuryStatus)) riskFlags.push(`Incoming ${p.playerName} listed ${p.injuryStatus}.`)
  }

  // Value-signal coverage — facts, not a verdict (the retired rule is warRoomLegacyVerdict.ts).
  if (!haveAnyValue) missingDataFlags.push('No value signal for the involved players.')
  else if (!haveAllValues) riskFlags.push('Some players have no value signal.')

  return {
    valueDelta,
    rosterFitDelta,
    keeperSurplusDelta: keeperBonus,
    keeperImpact: [...new Set(keeperImpact)],
    riskFlags: [...new Set(riskFlags)],
    explanationFacts: facts,
    missingDataFlags: [...new Set(missingDataFlags)],
  }
}
