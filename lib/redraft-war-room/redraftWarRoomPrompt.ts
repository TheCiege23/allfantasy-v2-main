/**
 * REDRAFT AF WAR ROOM — AI prompt grounding builder. Pure function.
 *
 * Serializes the deterministic context + engine outputs into a grounded prompt.
 * The AI is told explicitly: explain and recommend over THESE facts only; never
 * invent stats, projections, injury statuses, odds, or news; state when data is
 * unavailable. This file performs NO network/AI calls.
 */

import type { RedraftWarRoomContext } from './types'
import type { TeamNeedsResult } from './redraftTeamNeedsEngine'
import type { LineupResult } from './redraftLineupEngine'
import type { WaiverResult } from './redraftWaiverEngine'
import type { TradeAnalysis, TradeFinderResult } from './redraftTradeEngine'

export interface RedraftWarRoomPromptInputs {
  context: RedraftWarRoomContext
  needs?: TeamNeedsResult | null
  lineup?: LineupResult | null
  waivers?: WaiverResult | null
  tradeAnalysis?: TradeAnalysis | null
  tradeFinder?: TradeFinderResult | null
  /** The user's free-text question for the `ask` route. */
  question?: string
}

export const REDRAFT_WAR_ROOM_SYSTEM_RULES = [
  'You are the Redraft AF War Room assistant for a single fantasy league.',
  'GROUNDING: Use ONLY the deterministic facts provided below. Do not invent player stats, projections, injury statuses, betting odds, or news.',
  'When a value, projection, injury, or pool is marked unavailable/missing, say so plainly instead of guessing.',
  'This is a REDRAFT league: reason on a season horizon (this week → rest of season → playoff push). Do NOT use dynasty values, future draft picks, taxi/devy/keeper logic, or multi-year asset accrual.',
  'Never give betting/real-money advice. Never assert medical certainty about injuries — reference only the listed status.',
  'Be concise. Cite the specific facts you used. End with a one-line confidence note when you made a recommendation.',
  'Only discuss the viewer\'s own team for personalized advice unless they are the commissioner.',
].join('\n')

function fmtAvailability(context: RedraftWarRoomContext): string {
  const a = context.availability
  return Object.entries(a)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ')
}

export function buildRedraftWarRoomPrompt(inputs: RedraftWarRoomPromptInputs): string {
  const { context } = inputs
  const lines: string[] = []

  lines.push('=== REDRAFT LEAGUE CONTEXT ===')
  lines.push(
    `Sport=${context.sport} Season=${context.season} Week=${context.currentWeek}/${context.totalWeeks} PlayoffStart=W${context.playoffStartWeek} Status=${context.seasonStatus}`,
  )
  lines.push(
    `Scoring: preset=${context.scoring.scoringPreset} ppr=${context.scoring.pointsPerReception ?? 'unknown'} superflex=${context.scoring.superflex} tePremium=${context.scoring.tePremium} idp=${context.scoring.idp}`,
  )
  lines.push(
    `Roster: ${context.roster.totalStarterSlots} starters, ${context.roster.benchSlots} bench, ${context.roster.irSlots} IR. Required by pos: ${Object.entries(
      context.roster.requiredByPosition,
    )
      .map(([p, n]) => `${p}:${n}`)
      .join(' ')}`,
  )
  lines.push(`Waivers: type=${context.waivers.type} faabBudget=${context.waivers.faabBudget ?? 'n/a'}`)
  lines.push(`DATA AVAILABILITY: ${fmtAvailability(context)}`)
  if (context.nflDataCoverage) {
    const c = context.nflDataCoverage
    lines.push(
      `NFL DATA FOUNDATION: players=${c.counts.players ?? 0} teams=${c.counts.teams ?? 0} schedule=${c.hasSchedule} depthCharts=${c.hasDepthCharts} seasonStats=${c.hasSeasonStats} weeklyProjections=${c.hasWeeklyProjections} rosProjections=${c.hasRosProjections} tradeValues=${c.hasTradeValues}`,
    )
    if (c.missingFields.length) lines.push(`NFL FOUNDATION MISSING: ${c.missingFields.join(', ')}`)
    if (c.staleFields.length) lines.push(`NFL FOUNDATION STALE: ${c.staleFields.join(', ')}`)
  }
  if (context.missingDataFlags.length) {
    lines.push('MISSING-DATA FLAGS:')
    for (const f of context.missingDataFlags) lines.push(`  - ${f}`)
  }
  lines.push(
    `Freshness: generated=${context.freshness.generatedAt} statsAsOf=${context.freshness.statsAsOf ?? 'n/a'} projAsOf=${context.freshness.projectionsAsOf ?? 'n/a'}`,
  )

  if (context.freeAgents.length > 0) {
    lines.push('')
    lines.push(`=== TOP FREE AGENTS (projection-ranked/ADP-backed, ${context.freeAgents.length} available) ===`)
    for (const fa of context.freeAgents.slice(0, 12)) {
      const projection =
        fa.weekProjection != null
          ? `proj ${fa.weekProjection}${fa.restOfSeasonProjection != null ? ` ROS ${fa.restOfSeasonProjection}` : ''}`
          : fa.adp != null
            ? `ADP ${fa.adp}`
            : 'no projection'
      lines.push(
        `  ${fa.playerName} ${fa.position} - ${projection}; source=${fa.projectionSource ?? 'unknown'} confidence=${fa.projectionConfidenceLevel ?? 'n/a'}`,
      )
    }
  }

  const userTeam = context.teams.find((t) => t.isUserTeam)
  if (userTeam) {
    lines.push('')
    lines.push('=== YOUR TEAM ===')
    lines.push(
      `${userTeam.teamName ?? userTeam.ownerName} — ${userTeam.wins}-${userTeam.losses}${userTeam.ties ? `-${userTeam.ties}` : ''}, PF ${userTeam.pointsFor.toFixed(1)}, seed ${userTeam.playoffSeed ?? 'n/a'}${userTeam.isEliminated ? ' (ELIMINATED)' : ''}`,
    )
    lines.push('Roster:')
    for (const p of userTeam.players) {
      let val =
        p.weekProjection != null
          ? `proj ${p.weekProjection}${p.restOfSeasonProjection != null ? ` ROS ${p.restOfSeasonProjection}` : ''}${p.floorProjection != null && p.ceilingProjection != null ? ` range ${p.floorProjection}-${p.ceilingProjection}` : ''}`
          : p.seasonAvgActual != null
            ? `avg ${p.seasonAvgActual}`
            : p.adp != null
              ? `ADP ${p.adp}`
              : 'no value signal'
      val = `${val}; source=${p.projectionSource ?? 'unknown'} confidence=${p.projectionConfidenceLevel ?? 'n/a'}`
      lines.push(
        `  [${p.isStarterSlot ? 'ST' : 'BN'}] ${p.playerName} ${p.position}${p.team ? ` (${p.team})` : ''} — ${val}${p.injuryStatus ? `, ${p.injuryStatus}` : ''}${p.byeWeek ? `, bye W${p.byeWeek}` : ''}`,
      )
    }
  }

  if (context.upcomingMatchup) {
    const m = context.upcomingMatchup
    lines.push('')
    lines.push(`=== UPCOMING MATCHUP (W${m.week}, ${m.status}) ===`)
    lines.push(`opponentRosterId=${m.opponentRosterId ?? 'n/a'} homeProj=${m.homeProjected ?? 'n/a'} awayProj=${m.awayProjected ?? 'n/a'}`)
  }

  if (inputs.needs) {
    lines.push('')
    lines.push('=== DETERMINISTIC TEAM NEEDS ===')
    lines.push(`urgency=${inputs.needs.urgencyScore}/100`)
    for (const n of inputs.needs.needs) lines.push(`  NEED ${n.position} (${n.severity}): ${n.reason}`)
    for (const s of inputs.needs.strengths) lines.push(`  STRENGTH: ${s}`)
    for (const w of inputs.needs.weaknesses) lines.push(`  WEAKNESS: ${w}`)
    for (const f of inputs.needs.explanationFacts) lines.push(`  FACT: ${f}`)
  }

  if (inputs.lineup) {
    lines.push('')
    lines.push(`=== DETERMINISTIC LINEUP (confidence=${inputs.lineup.confidence}) ===`)
    for (const s of inputs.lineup.suggestedStarters) {
      lines.push(`  ${s.slotName}: ${s.playerName ?? 'EMPTY'} — ${s.reason}`)
    }
    for (const q of inputs.lineup.startSitQuestions) {
      lines.push(`  START/SIT: ${q.starter.playerName} (${q.starter.value}) vs ${q.bench.playerName} (${q.bench.value}) — ${q.note}`)
    }
  }

  if (inputs.waivers) {
    lines.push('')
    lines.push('=== DETERMINISTIC WAIVERS ===')
    if (inputs.waivers.needsProviderIntegration) lines.push('  ADD TARGETS UNAVAILABLE: free-agent pool not integrated.')
    for (const a of inputs.waivers.recommendedAdds) lines.push(`  ADD ${a.playerName} (${a.position}): ${a.reason}`)
    for (const d of inputs.waivers.recommendedDrops) lines.push(`  DROP ${d.playerName} (${d.position}): ${d.reason}`)
    lines.push(`  TARGET POSITIONS: ${inputs.waivers.targetPositions.join(', ') || 'none'}`)
  }

  if (inputs.tradeAnalysis) {
    lines.push('')
    lines.push('=== DETERMINISTIC TRADE ANALYSIS ===')
    // 🛑 No verdict or private-scale line (2026-09-30): the verdict is THE grade (warRoomTradeGrade.ts),
    // and the engine no longer computes one. Facts only.
    for (const f of inputs.tradeAnalysis.explanationFacts) lines.push(`  FACT: ${f}`)
    for (const r of inputs.tradeAnalysis.riskFlags) lines.push(`  RISK: ${r}`)
    if (inputs.tradeAnalysis.playoffImpact) lines.push(`  PLAYOFF: ${inputs.tradeAnalysis.playoffImpact}`)
  }

  if (inputs.tradeFinder) {
    lines.push('')
    lines.push('=== DETERMINISTIC TRADE TARGETS ===')
    if (inputs.tradeFinder.needsMoreData) lines.push('  UNAVAILABLE: needs projection/stat data.')
    for (const t of inputs.tradeFinder.targets.slice(0, 5))
      lines.push(`  ${t.teamName ?? t.rosterId} fit=${t.fitScore}: ${t.reasons.join(' ')}`)
  }

  if (inputs.question) {
    lines.push('')
    lines.push('=== USER QUESTION ===')
    lines.push(inputs.question)
  }

  return lines.join('\n')
}
