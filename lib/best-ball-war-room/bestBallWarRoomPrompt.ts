/**
 * BEST BALL AF WAR ROOM — AI prompt grounding builder. Pure function.
 *
 * Serializes the deterministic best-ball context + engine outputs into a grounded prompt.
 * The AI explains/recommends over THESE facts only; it never invents projections, ADP,
 * stacks, correlations, exposure, or bye weeks, and states when data is unavailable.
 * CRITICAL: best ball has an AUTOMATIC optimal lineup — the AI must NEVER give manual
 * start/sit advice; if asked, it explains the lineup is auto-selected each scoring period.
 * No network/AI calls here.
 */

import type { BestBallWarRoomContext } from './types'
import type { BestBallConstructionResult } from './bestBallRosterConstructionEngine'
import type { BestBallDepthResult } from './bestBallDepthEngine'
import type { BestBallUpsideResult } from './bestBallUpsideEngine'
import type { BestBallDraftPlanResult } from './bestBallDraftPlanEngine'
import type { BestBallStackResult } from './bestBallStackCorrelationEngine'
import type { BestBallRiskResult } from './bestBallRiskEngine'
import type { BestBallWaiverResult } from './bestBallWaiverEngine'
import type { BestBallTradeAnalysis, BestBallTradeFinderResult } from './bestBallTradeEngine'

export interface BestBallWarRoomPromptInputs {
  context: BestBallWarRoomContext
  construction?: BestBallConstructionResult | null
  depth?: BestBallDepthResult | null
  upside?: BestBallUpsideResult | null
  draftPlan?: BestBallDraftPlanResult | null
  stacks?: BestBallStackResult | null
  risk?: BestBallRiskResult | null
  waivers?: BestBallWaiverResult | null
  tradeAnalysis?: BestBallTradeAnalysis | null
  tradeFinder?: BestBallTradeFinderResult | null
  question?: string
}

export const BEST_BALL_WAR_ROOM_SYSTEM_RULES = [
  'You are the Best Ball AF War Room assistant for a single fantasy league.',
  'GROUNDING: Use ONLY the deterministic facts provided below. Do not invent player projections, ADP, stacks, correlations, exposure, or bye weeks.',
  'CRITICAL — AUTOMATIC LINEUP: Best ball sets the optimal lineup AUTOMATICALLY each scoring period. There is NO manual start/sit. If asked "who should I start / sit / bench this week", explain that best ball auto-selects the highest-scoring valid lineup and pivot to roster construction, depth, ceiling, or stacking instead. NEVER give a start/sit recommendation.',
  'Focus on ROSTER CONSTRUCTION, DEPTH, spike-week CEILING/upside, DRAFT PLAN, and STACK/CORRELATION. Ceiling matters more than floor; depth covers byes/injuries automatically.',
  'Waivers and trades exist ONLY if the league rules enable them (stated below). If disabled, say so plainly and do not suggest add/drop or trades.',
  'When a value, score, stack, bye, or team signal is marked unavailable/missing, say so plainly instead of guessing.',
  'Never give betting/real-money advice. Never assert medical certainty about injuries — reference only the listed status.',
  'Be concise. Cite the specific facts you used. End with a one-line confidence note when you made a recommendation.',
  "Only discuss the viewer's own team for personalized advice unless they are the commissioner.",
].join('\n')

function fmtAvailability(context: BestBallWarRoomContext): string {
  return Object.entries(context.availability)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ')
}

export function buildBestBallWarRoomPrompt(inputs: BestBallWarRoomPromptInputs): string {
  const { context } = inputs
  const lines: string[] = []

  lines.push('=== BEST BALL LEAGUE CONTEXT ===')
  lines.push(`Sport=${context.sport} Season=${context.season} Teams=${context.teamCount} DraftComplete=${context.draftComplete}`)
  if (!context.ruleConfigurationVerified) {
    lines.push('AUTOMATIC LINEUP: Best Ball scoring selects the lineup automatically; do not suggest manual start/sit swaps.')
    lines.push('UNVERIFIED LEAGUE RULES: the stored league has no complete explicit Best Ball waiver, trade and substitution configuration. Generic draft-only defaults are not provider evidence. Do not say any of those actions are disabled or enabled, or recommend an actionable move, until provider rules and eligibility are verified.')
    lines.push('Scoring presets, lineup slots, roster-size targets and construction grades from the generic Best Ball profile are withheld. Use the selected-league roster and scoring tools for verified facts, and disclose any missing data.')
    return lines.join('\n')
  }
  lines.push(`AUTOMATIC LINEUP: the optimal lineup is auto-selected each ${context.scoring.scoringPeriod} period — there is NO manual start/sit.`)
  lines.push(`Scoring: ${context.scoring.scoringPreset} ${context.scoring.matchupFormat}${context.scoring.cumulative ? ' (cumulative)' : ''}, period=${context.scoring.scoringPeriod}`)
  lines.push(
    `Best-ball settings: mode=${context.bestBall.mode} draft=${context.bestBall.draftMode} waivers=${context.bestBall.waiversEnabled ? 'ON' : 'OFF'} trades=${context.bestBall.tradesEnabled ? 'ON' : 'OFF'} subs=${context.bestBall.substitutionsEnabled ? 'ON' : 'OFF'}`,
  )
  lines.push(
    `Auto-lineup slots: ${context.roster.lineupSlots.map((s) => `${s.code}x${s.count}`).join(' ')} (${context.roster.startingSlots} starters); recommended roster ${context.roster.recommendedRosterSize}.`,
  )
  lines.push(`DATA AVAILABILITY: ${fmtAvailability(context)}`)
  if (context.missingDataFlags.length) {
    lines.push('MISSING-DATA FLAGS:')
    for (const f of context.missingDataFlags) lines.push(`  - ${f}`)
  }

  const userTeam = context.teams.find((t) => t.isUserTeam)
  if (userTeam) {
    lines.push('')
    lines.push('=== YOUR ROSTER (draft-only; lineup is automatic) ===')
    for (const p of userTeam.players) {
      const ceil = p.maxPoints != null ? `max ${p.maxPoints}` : p.avgPoints != null ? `avg ${p.avgPoints}` : p.adp != null ? `ADP ${p.adp}` : 'no signal'
      lines.push(`  ${p.playerName} ${p.position}${p.team ? ` (${p.team})` : ''} — ${ceil}${p.byeWeek ? `, bye W${p.byeWeek}` : ''}${p.injuryStatus ? `, ${p.injuryStatus}` : ''}`)
    }
  }

  if (inputs.construction) {
    lines.push('')
    lines.push(`=== DETERMINISTIC ROSTER CONSTRUCTION (grade ${inputs.construction.grade}) ===`)
    lines.push(`size ${inputs.construction.rosterSize}/${inputs.construction.recommendedRosterSize}, ${inputs.construction.startingSlots} auto-start slots`)
    for (const b of inputs.construction.byPosition) lines.push(`  ${b.position}: ${b.count} (need ~${b.startingNeed}, ${b.state})`)
    for (const w of inputs.construction.weaknesses) lines.push(`  WEAKNESS: ${w}`)
  }

  if (inputs.depth) {
    lines.push('')
    lines.push('=== DETERMINISTIC DEPTH ===')
    for (const f of inputs.depth.riskFlags) lines.push(`  ${f}`)
    lines.push(`  FRAGILE: ${inputs.depth.fragilePositions.join(', ') || 'none'}`)
  }

  if (inputs.upside) {
    lines.push('')
    lines.push(`=== DETERMINISTIC UPSIDE (confidence=${inputs.upside.confidence}) ===`)
    for (const u of inputs.upside.topUpside) lines.push(`  ${u.playerName} ${u.position}: ${u.reason}`)
  }

  if (inputs.draftPlan) {
    lines.push('')
    lines.push('=== DETERMINISTIC DRAFT PLAN ===')
    lines.push(`  draftComplete=${inputs.draftPlan.draftComplete} picksRemaining=${inputs.draftPlan.picksRemaining}`)
    for (const t of inputs.draftPlan.targets) lines.push(`  TARGET ${t.position} (${t.priority}): ${t.reason}`)
  }

  if (inputs.stacks) {
    lines.push('')
    lines.push(`=== DETERMINISTIC STACKS / CORRELATION (teamData=${inputs.stacks.teamDataState}) ===`)
    for (const s of inputs.stacks.stacks) lines.push(`  ${s.team}: ${s.players.map((p) => `${p.playerName}(${p.position})`).join(', ')}${s.hasQbStack ? ' [QB stack]' : ''}`)
    for (const c of inputs.stacks.byeClusters) lines.push(`  BYE CLUSTER W${c.week}: ${c.count} players`)
    for (const f of inputs.stacks.explanationFacts) lines.push(`  FACT: ${f}`)
  }

  if (inputs.risk) {
    lines.push('')
    lines.push(`=== DETERMINISTIC RISK (score ${inputs.risk.riskScore}/100) ===`)
    for (const f of inputs.risk.riskFlags) lines.push(`  RISK: ${f}`)
  }

  if (inputs.waivers) {
    lines.push('')
    lines.push(`=== DETERMINISTIC WAIVERS (enabled=${inputs.waivers.enabled}) ===`)
    if (!inputs.waivers.enabled) lines.push('  Waivers disabled in this league.')
    else {
      lines.push(`  TARGET POSITIONS: ${inputs.waivers.targetPositions.join(', ') || 'none'}`)
      for (const d of inputs.waivers.dropCandidates) lines.push(`  DROP-CANDIDATE ${d.playerName} (${d.position}): ${d.reason}`)
    }
  }

  if (inputs.tradeAnalysis) {
    lines.push('')
    lines.push('=== DETERMINISTIC TRADE ANALYSIS ===')
    lines.push(`verdict=${inputs.tradeAnalysis.verdict} valueDelta=${inputs.tradeAnalysis.valueDelta ?? 'n/a'} rosterFitDelta=${inputs.tradeAnalysis.rosterFitDelta}`)
    for (const f of inputs.tradeAnalysis.explanationFacts) lines.push(`  FACT: ${f}`)
    for (const r of inputs.tradeAnalysis.riskFlags) lines.push(`  RISK: ${r}`)
  }

  if (inputs.tradeFinder) {
    lines.push('')
    lines.push(`=== DETERMINISTIC TRADE TARGETS (enabled=${inputs.tradeFinder.enabled}) ===`)
    if (inputs.tradeFinder.needsMoreData) lines.push('  UNAVAILABLE: needs value data.')
    for (const t of inputs.tradeFinder.targets.slice(0, 5)) lines.push(`  ${t.teamName ?? t.rosterId} fit=${t.fitScore}: ${t.reasons.join(' ')}`)
  }

  if (inputs.question) {
    lines.push('')
    lines.push('=== USER QUESTION ===')
    lines.push(inputs.question)
  }

  return lines.join('\n')
}
