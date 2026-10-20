/**
 * DYNASTY TEAM DIRECTION ENGINE — pure, deterministic. No AI, no fabrication.
 *
 * Classifies a roster's contention window: contend | rebuild | middle | unknown.
 * Signals (only those actually available are used):
 *   - roster value concentration in young (ascending/prime) vs aging/cliff assets
 *   - average starter age
 *   - record / standings (when available)
 * Output is a transparent posture (buy / sell / balanced) with the facts behind it.
 * Returns 'unknown' rather than guessing when no value/age/record signal exists.
 */

import { dynastyValue, ageTrajectory } from './dynastyPlayerValue'
import { summarizePickCapital } from './dynastyPickValueEngine'
import type { ContentionWindow, DynastyPlayerFact, DynastyWarRoomContext } from './types'

export interface DynastyDirectionResult {
  rosterId: string
  window: ContentionWindow
  posture: 'buy_win_now' | 'sell_for_youth' | 'balanced' | 'unknown'
  /** 0-100 contention score; higher = more win-now. */
  contendScore: number | null
  avgStarterAge: number | null
  youngValueShare: number | null
  totalStarterValue: number | null
  /** Sum of structural pick tiers held (null when pick tracking unavailable). */
  pickCapitalValue: number | null
  earlyPickCount: number
  explanationFacts: string[]
  missingDataFlags: string[]
}

function valueOf(p: DynastyPlayerFact): number | null {
  const v = dynastyValue(p)
  return v.source === 'none' ? null : v.value
}

export function evaluateDynastyTeamDirection(
  context: DynastyWarRoomContext,
  rosterId: string,
): DynastyDirectionResult {
  const team = context.teams.find((t) => t.rosterId === rosterId)
  const missingDataFlags = [...context.missingDataFlags]
  if (!team) {
    return {
      rosterId,
      window: 'unknown',
      posture: 'unknown',
      contendScore: null,
      avgStarterAge: null,
      youngValueShare: null,
      totalStarterValue: null,
      pickCapitalValue: null,
      earlyPickCount: 0,
      explanationFacts: ['Roster not found in this league.'],
      missingDataFlags,
    }
  }

  const facts: string[] = []
  const hasValue = context.availability.playerValues === 'available'
  const hasAge = context.availability.playerAges === 'available'
  const hasStandings = context.availability.standings === 'available'
  const hasPicks = context.availability.futurePicks === 'available'

  // Pick capital (real, structural tiers) — a secondary "future stock" signal.
  const pickSummary = hasPicks ? summarizePickCapital(team.picks) : null
  const pickCapitalValue = pickSummary?.totalEstValue ?? null
  const earlyPickCount = pickSummary?.earlyPickCount ?? 0

  const starters = team.players.filter((p) => p.isStarterSlot)

  // Average starter age.
  let avgStarterAge: number | null = null
  if (hasAge) {
    const ages = starters.map((p) => p.age).filter((a): a is number => a != null)
    if (ages.length > 0) avgStarterAge = Math.round((ages.reduce((s, a) => s + a, 0) / ages.length) * 10) / 10
  }

  // Value split: share of total roster value held by ascending/prime players.
  let youngValueShare: number | null = null
  let totalStarterValue: number | null = null
  if (hasValue) {
    let total = 0
    let young = 0
    let starterTotal = 0
    for (const p of team.players) {
      const v = valueOf(p) ?? 0
      total += v
      if (p.isStarterSlot) starterTotal += v
      const traj = hasAge ? ageTrajectory(p.position, p.age, context.sport) : 'unknown'
      if (traj === 'ascending' || traj === 'prime') young += v
    }
    totalStarterValue = Math.round(starterTotal * 10) / 10
    if (total > 0) youngValueShare = Math.round((young / total) * 100) / 100
  }

  // Record signal.
  let winPct: number | null = null
  if (hasStandings) {
    const games = team.wins + team.losses + team.ties
    if (games > 0) winPct = team.wins / games
  }

  // Contention score: RECORD is the dominant win-now signal; starter age is a
  // secondary skew (an old core leans win-now, a very young core leans building).
  // Young-asset value SHARE is reported as a sustainability read but does NOT lower
  // the contention score — a young, valuable team can be contending now. Only
  // computed when at least a value or record signal exists.
  let contendScore: number | null = null
  if (hasValue || winPct != null) {
    let score = 50
    if (winPct != null) {
      score += (winPct - 0.5) * 70 // ±35
      facts.push(`Record ${team.wins}-${team.losses}${team.ties ? `-${team.ties}` : ''} (win% ${winPct.toFixed(2)}).`)
    }
    if (youngValueShare != null) {
      facts.push(`Young-asset value share ${(youngValueShare * 100).toFixed(0)}% (sustainability signal).`)
    }
    if (avgStarterAge != null) {
      // Older starters skew win-now (use it or lose it); very young skews building.
      if (avgStarterAge >= 27) score += 6
      else if (avgStarterAge <= 23) score -= 6
      facts.push(`Average starter age ${avgStarterAge}.`)
    }
    if (pickSummary != null) {
      // Stockpiled early picks are a small lean toward building for the future.
      if (earlyPickCount >= 3) score -= 4
      facts.push(`Pick capital: ${pickSummary.count} future pick(s), ${earlyPickCount} early${pickCapitalValue != null ? `, tier total ${pickCapitalValue}` : ''}.`)
    }
    contendScore = Math.max(0, Math.min(100, Math.round(score)))
  }

  // Window + posture.
  let window: ContentionWindow = 'unknown'
  let posture: DynastyDirectionResult['posture'] = 'unknown'
  if (contendScore != null) {
    if (contendScore >= 60) {
      window = 'contend'
      posture = 'buy_win_now'
    } else if (contendScore <= 42) {
      window = 'rebuild'
      posture = 'sell_for_youth'
    } else {
      window = 'middle'
      posture = 'balanced'
    }
  } else {
    missingDataFlags.push('No value or record signal — contention window cannot be classified.')
  }

  return {
    rosterId,
    window,
    posture,
    contendScore,
    avgStarterAge,
    youngValueShare,
    totalStarterValue,
    pickCapitalValue,
    earlyPickCount,
    explanationFacts: facts,
    missingDataFlags: [...new Set(missingDataFlags)],
  }
}

export function evaluateUserDynastyDirection(context: DynastyWarRoomContext): DynastyDirectionResult | null {
  if (!context.userRosterId) return null
  return evaluateDynastyTeamDirection(context, context.userRosterId)
}
