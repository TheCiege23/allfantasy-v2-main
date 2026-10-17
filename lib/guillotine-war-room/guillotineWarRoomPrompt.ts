/**
 * GUILLOTINE AF WAR ROOM — AI prompt grounding builder. Pure function.
 *
 * Serializes the deterministic guillotine context + engine outputs into a grounded prompt.
 * The AI explains/recommends over THESE facts only; it never invents eliminated teams,
 * scores, the elimination line, FAAB, projections, or the dropped pool, and states when data
 * is unavailable. SURVIVAL-FIRST: prioritize not finishing last (floor + safety margin),
 * conserve FAAB unless at risk. No network/AI calls here.
 */

import type { GuillotineWarRoomContext } from './types'
import type { GuillotineSurvivalRiskResult } from './guillotineSurvivalRiskEngine'
import type { GuillotineRosterRiskResult } from './guillotineRosterRiskEngine'
import type { GuillotineLineupSafetyResult } from './guillotineLineupSafetyEngine'
import type { GuillotineFaabPlanResult } from './guillotineFaabEngine'
import type { GuillotineWaiverResult } from './guillotineWaiverEngine'
import type { GuillotineDroppedPlayerResult } from './guillotineDroppedPlayerEngine'
import type { GuillotineTradeAnalysis } from './guillotineTradeEngine'
import type { GuillotineWeeklyPlanResult } from './guillotineWeeklyPlanEngine'

export interface GuillotineWarRoomPromptInputs {
  context: GuillotineWarRoomContext
  survival?: GuillotineSurvivalRiskResult | null
  rosterRisk?: GuillotineRosterRiskResult | null
  lineupSafety?: GuillotineLineupSafetyResult | null
  faab?: GuillotineFaabPlanResult | null
  waivers?: GuillotineWaiverResult | null
  droppedPlayers?: GuillotineDroppedPlayerResult | null
  tradeAnalysis?: GuillotineTradeAnalysis | null
  weeklyPlan?: GuillotineWeeklyPlanResult | null
  question?: string
}

export const GUILLOTINE_WAR_ROOM_SYSTEM_RULES = [
  'You are the Guillotine AF War Room assistant for a single fantasy league.',
  'GROUNDING: Use ONLY the deterministic facts provided below. Do not invent eliminated teams, scores, the elimination line, FAAB budgets, projections, injury statuses, or the dropped-player pool.',
  'SURVIVAL-FIRST: each scoring period the lowest team(s) are CHOPPED (eliminated). The goal is to NOT finish last. Prioritize a safe weekly FLOOR and a positive projected safety margin over ceiling — EXCEPT when the team is in or near the chop zone, where a higher-ceiling swing can be worth the variance to survive.',
  'FAAB: conserve budget when safe; spend aggressively only when survival is at risk. Eliminated-team drops can be the best waiver value — weigh them.',
  'When the elimination line, scores, FAAB, projections, or dropped pool are marked unavailable/missing, say so plainly instead of guessing.',
  'Trades exist ONLY if the league rules enable them (stated below). If disabled, say so and do not suggest trades.',
  'Never give betting/real-money advice. Never assert medical certainty about injuries — reference only the listed status. You never decide eliminations or chop outcomes.',
  'Be concise. Cite the specific facts you used. End with a one-line confidence note when you made a recommendation.',
  "Only discuss the viewer's own team for personalized advice unless they are the commissioner.",
].join('\n')

function fmtAvailability(context: GuillotineWarRoomContext): string {
  return Object.entries(context.availability)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ')
}

export function buildGuillotineWarRoomPrompt(inputs: GuillotineWarRoomPromptInputs): string {
  const { context } = inputs
  const lines: string[] = []

  lines.push('=== GUILLOTINE LEAGUE CONTEXT ===')
  lines.push(`Sport=${context.sport} Season=${context.season} Week=${context.currentWeek} Active=${context.activeTeamCount} Eliminated=${context.eliminatedTeamCount}`)
  lines.push(`Rules: elimination W${context.guillotine.eliminationStartWeek}-${context.guillotine.eliminationEndWeek ?? 'end'}, ${context.guillotine.teamsPerChop} chopped/period, danger margin ${context.guillotine.dangerMarginPoints}, tiebreaker ${context.guillotine.tiebreaker}, trades ${context.guillotine.tradesEnabled ? 'ON' : 'OFF'}.`)
  lines.push(`DATA AVAILABILITY: ${fmtAvailability(context)}`)
  if (context.missingDataFlags.length) {
    lines.push('MISSING-DATA FLAGS:')
    for (const f of context.missingDataFlags) lines.push(`  - ${f}`)
  }

  // Survival standings (active safest-first, then eliminated).
  lines.push('')
  lines.push('=== SURVIVAL STANDINGS ===')
  for (const s of context.standings.slice(0, 16)) {
    if (s.eliminated) lines.push(`  [OUT] ${s.teamName ?? s.ownerName}${s.choppedInPeriod != null ? ` (chopped P${s.choppedInPeriod})` : ''}`)
    else lines.push(`  ${s.tier === 'chop_zone' ? '[CHOP]' : s.tier === 'danger' ? '[DGR]' : '[SAFE]'} ${s.teamName ?? s.ownerName}${s.isUserTeam ? ' (you)' : ''} — cumul ${s.seasonPointsCumul.toFixed(1)}${s.pointsFromChopZone != null ? `, ${s.pointsFromChopZone >= 0 ? '+' : ''}${s.pointsFromChopZone.toFixed(1)} vs chop` : ''}`)
  }

  if (inputs.survival) {
    lines.push('')
    lines.push('=== DETERMINISTIC SURVIVAL RISK ===')
    lines.push(`riskLevel=${inputs.survival.riskLevel} tier=${inputs.survival.tier} safetyMargin=${inputs.survival.safetyMargin ?? 'n/a'} rank=${inputs.survival.rank ?? 'n/a'}/${inputs.survival.activeTeams}`)
    for (const f of inputs.survival.explanationFacts) lines.push(`  FACT: ${f}`)
  }

  if (inputs.rosterRisk) {
    lines.push('')
    lines.push(`=== DETERMINISTIC ROSTER RISK (floorRisk ${inputs.rosterRisk.floorRiskScore}/100) ===`)
    for (const w of inputs.rosterRisk.weaknesses) lines.push(`  WEAKNESS ${w.position} (${w.severity}): ${w.reason}`)
    for (const inj of inputs.rosterRisk.injuredStarters) lines.push(`  INJURY: ${inj.playerName} (${inj.position}) ${inj.status}`)
  }

  if (inputs.lineupSafety) {
    lines.push('')
    lines.push(`=== DETERMINISTIC LINEUP SAFETY (posture=${inputs.lineupSafety.posture}, confidence=${inputs.lineupSafety.confidence}) ===`)
    for (const s of inputs.lineupSafety.suggestedStarters) lines.push(`  ${s.position}: ${s.playerName ?? 'EMPTY'} — ${s.reason}`)
    if (inputs.lineupSafety.ceilingSwing) lines.push(`  CEILING SWING: ${inputs.lineupSafety.ceilingSwing.playerName} (${inputs.lineupSafety.ceilingSwing.position})`)
  }

  if (inputs.faab) {
    lines.push('')
    lines.push(`=== DETERMINISTIC FAAB PLAN (posture=${inputs.faab.posture}) ===`)
    lines.push(`  remaining=${inputs.faab.faabRemaining ?? 'n/a'} suggestedMaxBid=${inputs.faab.suggestedMaxBid ?? 'n/a'} (${Math.round(inputs.faab.suggestedMaxBidPct * 100)}%)`)
    for (const f of inputs.faab.explanationFacts) lines.push(`  FACT: ${f}`)
  }

  if (inputs.waivers) {
    lines.push('')
    lines.push(`=== DETERMINISTIC WAIVERS (urgency=${inputs.waivers.urgency}) ===`)
    lines.push(`  TARGET POSITIONS: ${inputs.waivers.targetPositions.join(', ') || 'none'}`)
    for (const a of inputs.waivers.recommendedAdds) lines.push(`  ADD ${a.playerName} (${a.position}): ${a.reason}`)
    for (const d of inputs.waivers.dropCandidates) lines.push(`  DROP ${d.playerName} (${d.position}): ${d.reason}`)
  }

  if (inputs.droppedPlayers) {
    lines.push('')
    lines.push(`=== DETERMINISTIC DROPPED-PLAYER POOL (available=${inputs.droppedPlayers.available}) ===`)
    for (const t of inputs.droppedPlayers.targets.slice(0, 8)) lines.push(`  ${t.playerName} (${t.position})${t.atNeed ? ' [need]' : ''}: ${t.note}`)
    for (const f of inputs.droppedPlayers.explanationFacts) lines.push(`  FACT: ${f}`)
  }

  if (inputs.tradeAnalysis) {
    lines.push('')
    lines.push('=== DETERMINISTIC TRADE ANALYSIS ===')
    // 🛑 No verdict or private-scale line (2026-09-30): the verdict is THE grade (warRoomTradeGrade.ts),
    // and the engine no longer computes one. Facts only.
    for (const f of inputs.tradeAnalysis.explanationFacts) lines.push(`  FACT: ${f}`)
    for (const r of inputs.tradeAnalysis.riskFlags) lines.push(`  RISK: ${r}`)
  }

  if (inputs.weeklyPlan) {
    lines.push('')
    lines.push(`=== DETERMINISTIC WEEKLY SURVIVAL PLAN ===`)
    lines.push(`  ${inputs.weeklyPlan.headline}`)
    for (const s of inputs.weeklyPlan.steps) lines.push(`  ${s.order}. ${s.action}: ${s.detail}`)
  }

  if (inputs.question) {
    lines.push('')
    lines.push('=== USER QUESTION ===')
    lines.push(inputs.question)
  }

  return lines.join('\n')
}
