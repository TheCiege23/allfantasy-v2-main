/**
 * REDRAFT WAIVER / ADD-DROP ENGINE — pure, deterministic. No AI, no fabrication.
 *
 * Produces add/drop recommendations from the available free-agent pool in context.
 * Phase 1 reality: the native free-agent pool route is a placeholder, so
 * `context.freeAgents` is empty and `availability.waiverPool === 'missing'`. In that
 * case this engine returns NO invented add targets — it returns the deterministic
 * DROP-side analysis (weakest rosterable assets, lineup needs the user should target)
 * plus a clear `needsProviderIntegration` flag.
 *
 * When a real pool is wired (Phase 2), the same scoring path ranks adds by value
 * signal and lineup fit. Redraft-only: immediate lineup help + playoff push, never
 * dynasty asset accrual.
 */

import { evaluateTeamNeeds } from './redraftTeamNeedsEngine'
import { playerValue, type ValueSource } from './playerValue'
import {
  computeConfidence,
  faabBandForTier,
  faabBidFromBand,
  isScarcePosition,
  priorityGuidanceForTier,
  recommendationScore,
  tierFromScore,
  valueScoreFor,
  type ConfidenceLevel,
  type FaabBand,
  type PriorityGuidance,
  type WaiverTier,
} from './redraftWaiverScoring'
import type { RedraftPlayerFact, RedraftWarRoomContext } from './types'

interface WaiverAdd {
  playerId: string
  playerName: string
  position: string
  value: number | null
  valueSource: ValueSource
  /** ADP (lower = more valued) when the add was ranked off ADP/ranking. */
  adp: number | null
  reason: string
  faabBidSuggestion: number | null
  prioritySuggestion: number | null
  /** Step 3D deterministic waiver intelligence. */
  recommendationScore: number
  confidence: number
  confidenceLevel: ConfidenceLevel
  tier: WaiverTier
  explanation: string[]
  /** FAAB band (e.g. "10–15%") in FAAB leagues, else null. */
  faabBand: FaabBand | null
  /** Priority guidance in rolling/reverse-priority leagues, else null. */
  priorityGuidance: PriorityGuidance | null
}

interface WaiverDrop {
  playerId: string
  playerName: string
  position: string
  value: number | null
  reason: string
}

export interface WaiverResult {
  rosterId: string
  recommendedAdds: WaiverAdd[]
  recommendedDrops: WaiverDrop[]
  addDropPairs: Array<{ add: string; drop: string; rationale: string }>
  targetPositions: string[]
  riskFlags: string[]
  missingDataFlags: string[]
  needsProviderIntegration: boolean
}

function valueOf(p: RedraftPlayerFact): { value: number | null; source: ValueSource } {
  const v = playerValue(p)
  return { value: v.source === 'none' ? null : v.value, source: v.source }
}

export function buildWaiverRecommendations(
  context: RedraftWarRoomContext,
  rosterId: string,
): WaiverResult {
  const team = context.teams.find((t) => t.rosterId === rosterId)
  const missingDataFlags = [...context.missingDataFlags]
  const riskFlags: string[] = []
  if (!team) {
    return {
      rosterId,
      recommendedAdds: [],
      recommendedDrops: [],
      addDropPairs: [],
      targetPositions: [],
      riskFlags: [],
      missingDataFlags: ['Roster not found in this season.'],
      needsProviderIntegration: context.availability.waiverPool !== 'available',
    }
  }

  const needs = evaluateTeamNeeds(context, rosterId)
  const targetPositions = needs.tradeTargetPositions

  // DROP side: rank the user's own weakest bench assets (works without a free-agent pool).
  const dropCandidates = team.players
    .filter((p) => !p.isStarterSlot || team.players.length > context.roster.totalStarterSlots)
    .map((p) => ({ p, ...valueOf(p) }))
    .sort((a, b) => (a.value ?? -1) - (b.value ?? -1))

  const recommendedDrops: WaiverDrop[] = dropCandidates.slice(0, 3).map(({ p, value }) => ({
    playerId: p.playerId,
    playerName: p.playerName,
    position: p.position,
    value: value == null ? null : Math.round(value * 100) / 100,
    reason:
      value == null
        ? `Lowest-confidence asset (no projection/stat signal)${p.injuryStatus ? `, listed ${p.injuryStatus}` : ''}.`
        : `Among the weakest rosterable values (${value.toFixed(1)})${p.injuryStatus ? `, listed ${p.injuryStatus}` : ''}.`,
  }))

  // ADD side requires a real free-agent pool.
  const needsProviderIntegration = context.availability.waiverPool !== 'available'
  let recommendedAdds: WaiverAdd[] = []
  if (needsProviderIntegration) {
    missingDataFlags.push(
      'Waiver add targets unavailable: free-agent pool needs provider integration. Drop-side analysis and target positions are still grounded in your roster.',
    )
  } else {
    const faabBudget = context.waivers.type === 'faab' ? (team.faabBalance ?? context.waivers.faabBudget) : null
    const isPriorityLeague = context.waivers.type === 'rolling' || context.waivers.type === 'reverse'
    const targetSet = new Set(targetPositions)
    // Limited data when projections are not available for this league (e.g. NCAAF or pre-season).
    const limitedData = context.availability.projections !== 'available'

    // Roster-construction signals (deterministic, from the team's own facts).
    const isHealthy = (s: string | null) => !s || /^(healthy|active|ok)$/i.test(s)
    const needSeverityByPos = new Map(needs.needs.map((n) => [n.position, n.severity]))
    const injuredPositions = new Set(team.players.filter((p) => p.isStarterSlot && !isHealthy(p.injuryStatus)).map((p) => p.position))
    // Bye stacks: a position where 2+ starters share a bye week.
    const byeCountByPosBye = new Map<string, number>()
    for (const p of team.players) {
      if (p.isStarterSlot && p.byeWeek != null) {
        const key = `${p.position}|${p.byeWeek}`
        byeCountByPosBye.set(key, (byeCountByPosBye.get(key) ?? 0) + 1)
      }
    }
    const byeStackPositions = new Set([...byeCountByPosBye].filter(([, n]) => n >= 2).map(([k]) => k.split('|')[0]))
    // Weakest rostered value per position (for "projects above your current X" explanations).
    const baselineByPos = new Map<string, number>()
    for (const p of team.players) {
      const { value } = valueOf(p)
      if (value == null) continue
      const cur = baselineByPos.get(p.position)
      if (cur == null || value < cur) baselineByPos.set(p.position, value)
    }
    const requiredByPosition = context.roster.requiredByPosition ?? {}
    const countByPos = new Map<string, number>()
    for (const p of team.players) countByPos.set(p.position, (countByPos.get(p.position) ?? 0) + 1)

    recommendedAdds = context.freeAgents
      .map((p) => ({ p, ...valueOf(p), atNeed: targetSet.has(p.position) }))
      // Surface need-position free agents first, then by value (ADP-derived for FAs).
      .sort((a, b) => {
        if (a.atNeed !== b.atNeed) return a.atNeed ? -1 : 1
        return (b.value ?? -1) - (a.value ?? -1)
      })
      .slice(0, 5)
      .map(({ p, value, source }) => {
        const needSeverity = needSeverityByPos.get(p.position) ?? null
        const required = requiredByPosition[p.position] ?? 0
        const depthWeakness = !needSeverity && required > 0 && (countByPos.get(p.position) ?? 0) <= required
        const injuryReplacement = injuredPositions.has(p.position)
        const byeCoverage = byeStackPositions.has(p.position)
        const scarce = isScarcePosition(p.position)

        const vScore = valueScoreFor({ value, source, position: p.position, adp: p.adp ?? null })
        const score = recommendationScore({ valueScore: vScore, position: p.position, needSeverity, depthWeakness, injuryReplacement, byeCoverage })
        const conf = computeConfidence({ source, projectionConfidenceLevel: p.projectionConfidenceLevel, limitedData, injured: !isHealthy(p.injuryStatus) })
        const tier = tierFromScore(score, conf.level)

        const faabBand = faabBudget != null ? faabBandForTier(tier, { criticalNeed: needSeverity === 'critical', scarce }) : null
        const faabBidSuggestion = faabBand ? faabBidFromBand(faabBand, faabBudget) : null
        const priorityGuidance = isPriorityLeague ? priorityGuidanceForTier(tier, needSeverity === 'critical') : null
        const prioritySuggestion = isPriorityLeague ? team.waiverPriority : null

        // Explanation bullets — deterministic, grounded in roster + the existing value signal.
        const explanation: string[] = []
        if (needSeverity === 'critical') explanation.push(`${p.position} starter hole on your roster.`)
        else if (needSeverity) explanation.push(`${p.position} depth need (${needSeverity}).`)
        else if (depthWeakness) explanation.push(`No real ${p.position} bench depth behind your starter(s).`)
        if (source === 'projection' && value != null) explanation.push(`Projected ${value.toFixed(1)} pts this week.`)
        else if (source === 'ros_projection' && value != null) explanation.push(`Rest-of-season value ${value.toFixed(1)}.`)
        else if (source === 'season_avg' && value != null) explanation.push(`Season average ${value.toFixed(1)} pts.`)
        else if (source === 'adp' && p.adp != null) explanation.push(`ADP ${p.adp.toFixed(1)} (ranking proxy).`)
        else explanation.push('No projection or ADP signal yet — value unconfirmed.')
        const baseline = baselineByPos.get(p.position)
        if (value != null && baseline != null && value > baseline) {
          explanation.push(`Projects above your weakest rostered ${p.position} (${baseline.toFixed(1)}).`)
        }
        if (injuryReplacement) explanation.push(`Injury replacement — a ${p.position} starter is listed non-healthy.`)
        if (byeCoverage) explanation.push(`Covers a bye-week stack at ${p.position}.`)
        if (scarce) explanation.push(`Scarce position (${p.position}).`)
        if (limitedData) explanation.push('Limited data for this league — confidence reduced.')

        return {
          playerId: p.playerId,
          playerName: p.playerName,
          position: p.position,
          value: value == null ? null : Math.round(value * 100) / 100,
          valueSource: source,
          adp: p.adp ?? null,
          reason: `${tier}: ${explanation[0] ?? `Best available ${p.position}`}`,
          faabBidSuggestion,
          prioritySuggestion,
          recommendationScore: score,
          confidence: conf.score,
          confidenceLevel: conf.level,
          tier,
          explanation,
          faabBand,
          priorityGuidance,
        }
      })
  }

  // Add/drop pairs only when we have both sides.
  const addDropPairs = recommendedAdds.slice(0, recommendedDrops.length).map((add, i) => ({
    add: add.playerName,
    drop: recommendedDrops[i].playerName,
    rationale: `Upgrade ${add.position}: add ${add.playerName} for ${recommendedDrops[i].playerName}.`,
  }))

  if (team.faabBalance != null && team.faabBalance <= 5 && context.waivers.type === 'faab') {
    riskFlags.push('FAAB nearly exhausted — bids will be constrained.')
  }
  if (needs.needs.some((n) => n.severity === 'critical')) {
    riskFlags.push('Critical starting-slot hole — prioritize a starter add over depth.')
  }

  return {
    rosterId,
    recommendedAdds,
    recommendedDrops,
    addDropPairs,
    targetPositions,
    riskFlags,
    missingDataFlags: [...new Set(missingDataFlags)],
    needsProviderIntegration,
  }
}
