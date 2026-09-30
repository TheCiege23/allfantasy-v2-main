/**
 * KEEPER AF WAR ROOM — AI prompt grounding builder. Pure function.
 *
 * Serializes the deterministic keeper context + engine outputs into a grounded prompt.
 * The AI explains/recommends over THESE facts only; it never invents keeper costs,
 * rounds, values, stats, injuries, or news, and states when data is unavailable.
 * Keeper horizon: single season, but keep/cut weighs DRAFT-CAPITAL cost (round/auction).
 * No future picks, no dynasty pick capital. No network/AI calls here.
 */

import type { KeeperWarRoomContext } from './types'
import type { KeeperRecommendationResult } from './keeperRecommendationEngine'
import type { KeeperCutListResult } from './keeperCutListEngine'
import type { KeeperNeedsResult } from './keeperRosterNeedsEngine'
import type { KeeperDraftPlanResult } from './keeperDraftPlanEngine'
import type { KeeperWaiverResult } from './keeperWaiverEngine'
import type { KeeperLineupResult } from './keeperLineupEngine'
import type { KeeperTradeAnalysis } from './keeperTradeEngine'
import type { KeeperTradeFinderResult } from './keeperTradeFinderEngine'

export interface KeeperWarRoomPromptInputs {
  context: KeeperWarRoomContext
  recommendations?: KeeperRecommendationResult | null
  cutList?: KeeperCutListResult | null
  needs?: KeeperNeedsResult | null
  draftPlan?: KeeperDraftPlanResult | null
  waivers?: KeeperWaiverResult | null
  lineup?: KeeperLineupResult | null
  tradeAnalysis?: KeeperTradeAnalysis | null
  tradeFinder?: KeeperTradeFinderResult | null
  question?: string
}

export const KEEPER_WAR_ROOM_SYSTEM_RULES = [
  'You are the Keeper AF War Room assistant for a single fantasy league.',
  'GROUNDING: Use ONLY the deterministic facts provided below. Do not invent keeper costs, draft rounds, player values, ADP, projections, injury statuses, or news.',
  'When a keeper cost, value, eligibility, projection, or pool is marked unavailable/missing, say so plainly instead of guessing.',
  'This is a KEEPER league: a single-season format where keeping a player COSTS draft capital (a draft round, or an auction price). The core idea is VALUE SURPLUS — keep players whose ADP value far exceeds their keeper cost (e.g., a Round 2 ADP player who only costs a Round 8 keeper slot).',
  'Respect the keeper LIMIT (max keepers) and any per-position caps. Recommend the best keep set within the limit, and who to cut.',
  'Do NOT use dynasty future-pick / rookie-pick capital — keeper leagues do not carry future picks. Do NOT ignore keeper cost the way pure redraft would.',
  'Never give betting/real-money advice. Never assert medical certainty about injuries — reference only the listed status.',
  'Be concise. Cite the specific facts you used. End with a one-line confidence note when you made a recommendation.',
  "Only discuss the viewer's own team for personalized advice unless they are the commissioner.",
].join('\n')

function fmtAvailability(context: KeeperWarRoomContext): string {
  return Object.entries(context.availability)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ')
}

export function buildKeeperWarRoomPrompt(inputs: KeeperWarRoomPromptInputs): string {
  const { context } = inputs
  const lines: string[] = []

  lines.push('=== KEEPER LEAGUE CONTEXT ===')
  lines.push(`Sport=${context.sport} Season=${context.season} Teams=${context.teamCount} Week=${context.currentWeek}/${context.totalWeeks} Status=${context.seasonStatus} Active=${context.seasonActive}`)
  lines.push(`Scoring: preset=${context.scoring.scoringPreset} ppr=${context.scoring.pointsPerReception ?? 'unknown'} superflex=${context.scoring.superflex} tePremium=${context.scoring.tePremium}`)
  lines.push(
    `Keeper rules: maxKeepers=${context.keeper.maxKeepers} maxYears=${context.keeper.maxYears} costSystem=${context.keeper.costSystem} roundPenalty=${context.keeper.roundPenalty} auctionPctIncrease=${context.keeper.auctionPctIncrease} waiverKeepers=${context.keeper.waiverAllowed} deadline=${context.keeper.selectionDeadline ?? 'n/a'} draftRounds=${context.keeper.draftRounds}`,
  )
  lines.push(
    `Roster: ${context.roster.totalStarterSlots} starters, ${context.roster.benchSlots} bench, ${context.roster.irSlots} IR. Required by pos: ${Object.entries(context.roster.requiredByPosition).map(([p, n]) => `${p}:${n}`).join(' ')}`,
  )
  lines.push(`DATA AVAILABILITY: ${fmtAvailability(context)}`)
  if (context.missingDataFlags.length) {
    lines.push('MISSING-DATA FLAGS:')
    for (const f of context.missingDataFlags) lines.push(`  - ${f}`)
  }

  const userTeam = context.teams.find((t) => t.isUserTeam)
  if (userTeam) {
    lines.push('')
    lines.push('=== YOUR TEAM ===')
    lines.push(`${userTeam.teamName ?? userTeam.ownerName} — ${userTeam.wins}-${userTeam.losses}${userTeam.ties ? `-${userTeam.ties}` : ''}, seed ${userTeam.playoffSeed ?? 'n/a'}`)
    lines.push('Roster (cost = keeper cost; ADP-rd = value):')
    for (const p of userTeam.players) {
      const cost = p.keeperCostLabel ?? 'no cost'
      const surplus = p.surplusRounds != null ? `, surplus ${p.surplusRounds >= 0 ? '+' : ''}${p.surplusRounds}rd` : ''
      const elig = p.isEligible === false ? ', INELIGIBLE' : ''
      lines.push(`  ${p.isKept ? '[K] ' : ''}${p.playerName} ${p.position}${p.team ? ` (${p.team})` : ''} — cost ${cost}, ADP-rd ${p.adpRound ?? 'n/a'}${surplus}${elig}${p.injuryStatus ? `, ${p.injuryStatus}` : ''}`)
    }
  }

  if (inputs.recommendations) {
    lines.push('')
    lines.push(`=== DETERMINISTIC KEEPER RECOMMENDATIONS (max ${inputs.recommendations.maxKeepers}) ===`)
    if (inputs.recommendations.needsMoreData) lines.push('  LIMITED: keeper cost and/or value data unavailable.')
    for (const r of inputs.recommendations.recommended) lines.push(`  KEEP ${r.playerName} ${r.position} — ${r.reason}`)
    for (const r of inputs.recommendations.bubble) lines.push(`  BUBBLE ${r.playerName} ${r.position} — ${r.reason}`)
    for (const r of inputs.recommendations.avoid) lines.push(`  AVOID ${r.playerName} ${r.position} — ${r.reason}`)
  }

  if (inputs.cutList) {
    lines.push('')
    lines.push('=== DETERMINISTIC CUT LIST ===')
    for (const c of inputs.cutList.cutList) lines.push(`  CUT ${c.playerName} ${c.position} — ${c.reason}`)
    for (const r of inputs.cutList.riskFlags) lines.push(`  RISK: ${r}`)
  }

  if (inputs.needs) {
    lines.push('')
    lines.push('=== DETERMINISTIC ROSTER NEEDS AFTER KEEPERS ===')
    for (const n of inputs.needs.needs) lines.push(`  NEED ${n.position} (${n.severity}): ${n.reason}`)
    for (const s of inputs.needs.strengths) lines.push(`  COVERED: ${s}`)
    lines.push(`  DRAFT TARGETS: ${inputs.needs.draftTargetPositions.join(', ') || 'none'}`)
  }

  if (inputs.draftPlan) {
    lines.push('')
    lines.push('=== DETERMINISTIC DRAFT PLAN AFTER KEEPERS ===')
    lines.push(`  costSystem=${inputs.draftPlan.costSystem} consumedRounds=[${inputs.draftPlan.consumedRounds.join(',')}] remaining=${inputs.draftPlan.remainingRounds.length}/${inputs.draftPlan.totalRounds}`)
    for (const rp of inputs.draftPlan.roundPlan) lines.push(`  R${rp.round}: ${rp.focus} — ${rp.note}`)
  }

  if (inputs.waivers) {
    lines.push('')
    lines.push('=== DETERMINISTIC WAIVERS ===')
    if (inputs.waivers.needsProviderIntegration) lines.push('  ADD TARGETS UNAVAILABLE (season inactive or no pool).')
    for (const a of inputs.waivers.recommendedAdds) lines.push(`  ADD ${a.playerName} (${a.position}): ${a.reason}`)
    for (const d of inputs.waivers.recommendedDrops) lines.push(`  DROP ${d.playerName} (${d.position}): ${d.reason}`)
  }

  if (inputs.lineup) {
    lines.push('')
    lines.push(`=== DETERMINISTIC LINEUP (active=${inputs.lineup.active}, confidence=${inputs.lineup.confidence}) ===`)
    for (const s of inputs.lineup.suggestedStarters) lines.push(`  ${s.position}: ${s.playerName ?? 'EMPTY'} — ${s.reason}`)
  }

  if (inputs.tradeAnalysis) {
    lines.push('')
    lines.push('=== DETERMINISTIC TRADE ANALYSIS ===')
    // 🛑 No verdict or private-scale line (2026-09-30): the verdict is THE grade (warRoomTradeGrade.ts),
    // and the engine no longer computes one. Facts only.
    for (const f of inputs.tradeAnalysis.explanationFacts) lines.push(`  FACT: ${f}`)
    for (const k of inputs.tradeAnalysis.keeperImpact) lines.push(`  KEEPER: ${k}`)
    for (const r of inputs.tradeAnalysis.riskFlags) lines.push(`  RISK: ${r}`)
  }

  if (inputs.tradeFinder) {
    lines.push('')
    lines.push('=== DETERMINISTIC TRADE TARGETS ===')
    if (inputs.tradeFinder.needsMoreData) lines.push('  UNAVAILABLE: needs ADP/value data.')
    for (const t of inputs.tradeFinder.targets.slice(0, 5)) lines.push(`  ${t.teamName ?? t.rosterId} fit=${t.fitScore}: ${t.reasons.join(' ')}`)
  }

  if (inputs.question) {
    lines.push('')
    lines.push('=== USER QUESTION ===')
    lines.push(inputs.question)
  }

  return lines.join('\n')
}
