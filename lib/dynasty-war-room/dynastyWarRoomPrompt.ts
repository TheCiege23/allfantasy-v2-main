/**
 * DYNASTY AF WAR ROOM — AI prompt grounding builder. Pure function.
 *
 * Serializes the deterministic dynasty context + engine outputs into a grounded
 * prompt. The AI explains and recommends over THESE facts only; it never invents
 * values, ages, picks, injuries, or news, and states when data is unavailable.
 * Dynasty horizon: long-term asset value + age trajectory + contention window —
 * NOT weekly projections or redraft short-season logic. No network/AI calls here.
 */

import type { DynastyWarRoomContext } from './types'
import type { DynastyNeedsResult } from './dynastyRosterNeedsEngine'
import type { DynastyDirectionResult } from './dynastyTeamDirectionEngine'
import type { BuySellHoldResult } from './dynastyBuySellHoldEngine'
import type { DynastyLineupResult } from './dynastyLineupEngine'
import type { DynastyWaiverResult } from './dynastyWaiverEngine'
import type { DynastyTradeAnalysis, DynastyTradeFinderResult } from './dynastyTradeEngine'

export interface DynastyWarRoomPromptInputs {
  context: DynastyWarRoomContext
  direction?: DynastyDirectionResult | null
  needs?: DynastyNeedsResult | null
  buySellHold?: BuySellHoldResult | null
  lineup?: DynastyLineupResult | null
  waivers?: DynastyWaiverResult | null
  tradeAnalysis?: DynastyTradeAnalysis | null
  tradeFinder?: DynastyTradeFinderResult | null
  question?: string
}

export const DYNASTY_WAR_ROOM_SYSTEM_RULES = [
  'You are the Dynasty AF War Room assistant for a single fantasy league.',
  'GROUNDING: Use ONLY the deterministic facts provided below. Do not invent player values, ages, draft picks, injury statuses, betting odds, or news.',
  'When a value, age, pick, injury, or pool is marked unavailable/missing, say so plainly instead of guessing.',
  'This is a DYNASTY league: reason on a MULTI-YEAR horizon. Weigh long-term asset value, AGE/trajectory, and the team\'s contention window (contend vs rebuild vs middle). Do NOT use redraft short-season logic for asset-value decisions.',
  'Future draft pick capital, when provided, is priced by a deterministic STRUCTURAL TIER (round + how many seasons out) — NOT a real market value. Never invent picks the team does not hold, and never assign a fabricated market value. When pick tracking is unavailable or empty, say so plainly.',
  'Never give betting/real-money advice. Never assert medical certainty about injuries — reference only the listed status.',
  'Be concise. Cite the specific facts you used. End with a one-line confidence note when you made a recommendation.',
  "Only discuss the viewer's own team for personalized advice unless they are the commissioner.",
].join('\n')

function fmtAvailability(context: DynastyWarRoomContext): string {
  return Object.entries(context.availability)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ')
}

export function buildDynastyWarRoomPrompt(inputs: DynastyWarRoomPromptInputs): string {
  const { context } = inputs
  const lines: string[] = []

  lines.push('=== DYNASTY LEAGUE CONTEXT ===')
  lines.push(`Sport=${context.sport} Season=${context.season}`)
  lines.push(
    `Scoring: preset=${context.scoring.scoringPreset} superflex=${context.scoring.superflex} tePremium=${context.scoring.tePremium}`,
  )
  lines.push(
    `Roster: ${context.roster.totalStarterSlots} starters, ${context.roster.benchSlots} bench, ${context.roster.taxiSlots} taxi, ${context.roster.irSlots} IR. Required by pos: ${Object.entries(
      context.roster.requiredByPosition,
    )
      .map(([p, n]) => `${p}:${n}`)
      .join(' ')}`,
  )
  lines.push(`DATA AVAILABILITY: ${fmtAvailability(context)}`)
  if (context.missingDataFlags.length) {
    lines.push('MISSING-DATA FLAGS:')
    for (const f of context.missingDataFlags) lines.push(`  - ${f}`)
  }
  lines.push(
    `Freshness: generated=${context.freshness.generatedAt} valuesAsOf=${context.freshness.valuesAsOf ?? 'n/a'} injuriesAsOf=${context.freshness.injuriesAsOf ?? 'n/a'}`,
  )

  if (context.freeAgents.length > 0) {
    lines.push('')
    lines.push(`=== TOP FREE AGENTS (dynasty-ADP-ranked, ${context.freeAgents.length} available) ===`)
    for (const fa of context.freeAgents.slice(0, 12)) {
      lines.push(`  ${fa.playerName} ${fa.position}${fa.adp != null ? ` (ADP ${fa.adp})` : ''}${fa.age != null ? `, age ${fa.age}` : ''}`)
    }
  }

  const userTeam = context.teams.find((t) => t.isUserTeam)
  if (userTeam) {
    lines.push('')
    lines.push('=== YOUR TEAM ===')
    lines.push(
      `${userTeam.teamName ?? userTeam.ownerName} — ${userTeam.wins}-${userTeam.losses}${userTeam.ties ? `-${userTeam.ties}` : ''}, PF ${userTeam.pointsFor.toFixed(1)}, seed ${userTeam.playoffSeed ?? 'n/a'}`,
    )
    if (userTeam.picks.length > 0) {
      lines.push(
        `Pick capital (structural tiers, not market values): ${userTeam.picks
          .map((pk) => `${pk.season} R${pk.round}${pk.traded ? '*' : ''}${pk.estValue != null ? ` (tier ${pk.estValue})` : ''}`)
          .join(', ')} ${userTeam.picks.some((pk) => pk.traded) ? '(* = acquired/traded)' : ''}`,
      )
    } else if (context.availability.futurePicks === 'available_empty') {
      lines.push('Pick capital: tracking enabled, but no picks recorded for this team yet.')
    } else if (context.availability.futurePicks === 'missing') {
      lines.push('Pick capital: future pick tracking is not enabled for this league.')
    } else {
      lines.push('Pick capital: none held.')
    }
    lines.push('Roster:')
    for (const p of userTeam.players) {
      const val = p.dynastyValue != null ? `val ${p.dynastyValue}` : p.adp != null ? `ADP ${p.adp}` : 'no value signal'
      lines.push(
        `  [${p.slotType.toUpperCase().slice(0, 2)}] ${p.playerName} ${p.position}${p.team ? ` (${p.team})` : ''} — ${val}${p.age != null ? `, age ${p.age}` : ''}${p.injuryStatus ? `, ${p.injuryStatus}` : ''}`,
      )
    }
  }

  if (context.rookieDraftWindows.length > 0) {
    lines.push('')
    lines.push('=== ROOKIE DRAFT WINDOWS ===')
    for (const w of context.rookieDraftWindows) {
      lines.push(`  ${w.season}: status=${w.status}, order=${w.draftOrderMethod}${w.scheduledDraftDate ? `, scheduled ${w.scheduledDraftDate.slice(0, 10)}` : ''}`)
    }
  }

  if (inputs.direction) {
    lines.push('')
    lines.push('=== DETERMINISTIC TEAM DIRECTION ===')
    lines.push(
      `window=${inputs.direction.window} posture=${inputs.direction.posture} contendScore=${inputs.direction.contendScore ?? 'n/a'} avgStarterAge=${inputs.direction.avgStarterAge ?? 'n/a'} youngValueShare=${inputs.direction.youngValueShare ?? 'n/a'} pickCapitalTier=${inputs.direction.pickCapitalValue ?? 'n/a'} earlyPicks=${inputs.direction.earlyPickCount}`,
    )
    for (const f of inputs.direction.explanationFacts) lines.push(`  FACT: ${f}`)
  }

  if (inputs.needs) {
    lines.push('')
    lines.push('=== DETERMINISTIC ROSTER NEEDS ===')
    lines.push(`urgency=${inputs.needs.urgencyScore}/100`)
    for (const n of inputs.needs.needs) lines.push(`  NEED ${n.position} (${n.severity}): ${n.reason}`)
    for (const s of inputs.needs.strengths) lines.push(`  STRENGTH: ${s}`)
    for (const w of inputs.needs.weaknesses) lines.push(`  WEAKNESS: ${w}`)
  }

  if (inputs.buySellHold) {
    lines.push('')
    lines.push(`=== DETERMINISTIC BUY/SELL/HOLD (window=${inputs.buySellHold.window}) ===`)
    if (inputs.buySellHold.pickCapitalNote) lines.push(`  PICK CAPITAL: ${inputs.buySellHold.pickCapitalNote}`)
    for (const e of inputs.buySellHold.entries.slice(0, 14)) {
      lines.push(`  ${e.call.toUpperCase()} ${e.playerName} ${e.position}${e.age != null ? ` (${e.age}, ${e.trajectory})` : ''}: ${e.reason}`)
    }
  }

  if (inputs.lineup) {
    lines.push('')
    lines.push(`=== DETERMINISTIC LINEUP (confidence=${inputs.lineup.confidence}) ===`)
    for (const s of inputs.lineup.suggestedStarters) lines.push(`  ${s.position}: ${s.playerName ?? 'EMPTY'} — ${s.reason}`)
  }

  if (inputs.waivers) {
    lines.push('')
    lines.push('=== DETERMINISTIC WAIVERS ===')
    if (inputs.waivers.needsProviderIntegration) lines.push('  ADD TARGETS UNAVAILABLE: free-agent pool not available.')
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
    for (const a of inputs.tradeAnalysis.ageImpact) lines.push(`  AGE: ${a}`)
    for (const pk of inputs.tradeAnalysis.pickImpact) lines.push(`  PICK: ${pk}`)
    for (const r of inputs.tradeAnalysis.riskFlags) lines.push(`  RISK: ${r}`)
    if (inputs.tradeAnalysis.directionImpact) lines.push(`  DIRECTION: ${inputs.tradeAnalysis.directionImpact}`)
  }

  if (inputs.tradeFinder) {
    lines.push('')
    lines.push('=== DETERMINISTIC TRADE TARGETS ===')
    if (inputs.tradeFinder.needsMoreData) lines.push('  UNAVAILABLE: needs value/age data.')
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
