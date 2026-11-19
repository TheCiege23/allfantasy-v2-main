/**
 * BEST BALL UPSIDE ENGINE — pure, deterministic. No AI, no fabrication.
 *
 * Surfaces SPIKE-WEEK ceiling. When real weekly scores exist it ranks players by their
 * max single-week score (true spike weeks) + how often they hit the auto lineup; otherwise
 * it falls back to an ADP-derived ceiling PROXY and flags it as such. Never fabricates a
 * ceiling — `confidence` reflects the weakest signal used.
 */

import { ceilingValue, type ValueSource } from './bestBallValue'
import type { BestBallPlayerFact, BestBallWarRoomContext } from './types'

interface UpsidePlayer {
  playerId: string
  playerName: string
  position: string
  ceiling: number
  source: ValueSource
  startedWeeks: number | null
  reason: string
}

export interface BestBallUpsideResult {
  rosterId: string
  topUpside: UpsidePlayer[]
  /** Players providing little ceiling (bottom of the roster). */
  lowUpside: UpsidePlayer[]
  /** 'high' (real scores) | 'low' (ADP proxy) | 'none'. */
  confidence: 'high' | 'low' | 'none'
  explanationFacts: string[]
  missingDataFlags: string[]
}

export function evaluateUpside(context: BestBallWarRoomContext, rosterId: string): BestBallUpsideResult {
  const team = context.teams.find((t) => t.rosterId === rosterId)
  const missingDataFlags = [...context.missingDataFlags]
  if (!team) {
    return { rosterId, topUpside: [], lowUpside: [], confidence: 'none', explanationFacts: ['Roster not found in this league.'], missingDataFlags }
  }

  const ranked = team.players
    .map((p: BestBallPlayerFact) => {
      const c = ceilingValue(p)
      return { p, ceiling: c.value, source: c.source }
    })
    .filter((r) => r.source !== 'none')
    .sort((a, b) => b.ceiling - a.ceiling)

  const usesRealScores = ranked.some((r) => r.source === 'weekly_max' || r.source === 'weekly_avg')
  const anySignal = ranked.length > 0
  const confidence: BestBallUpsideResult['confidence'] = !anySignal ? 'none' : usesRealScores ? 'high' : 'low'

  const toUpside = (r: { p: BestBallPlayerFact; ceiling: number; source: ValueSource }): UpsidePlayer => ({
    playerId: r.p.playerId,
    playerName: r.p.playerName,
    position: r.p.position,
    ceiling: Math.round(r.ceiling * 100) / 100,
    source: r.source,
    startedWeeks: r.p.startedWeeks,
    reason:
      r.source === 'weekly_max'
        ? `Spike-week ceiling ${r.ceiling.toFixed(1)}${r.p.startedWeeks != null ? `, auto-started ${r.p.startedWeeks}x` : ''}.`
        : r.source === 'weekly_avg'
          ? `Season avg ${r.ceiling.toFixed(1)} (no single-week max yet).`
          : r.source === 'projection'
            ? `Projected ${r.ceiling.toFixed(1)} (pre-season).`
            : `ADP-implied ceiling (proxy, ADP ${r.p.adp?.toFixed(1) ?? 'n/a'}).`,
  })

  const facts: string[] = []
  if (confidence === 'low') facts.push('Upside ranked by ADP proxy — real spike-week ceiling will replace this once games are scored.')
  else if (confidence === 'high') facts.push('Upside ranked by real max weekly scores (true spike weeks).')

  return {
    rosterId,
    topUpside: ranked.slice(0, 6).map(toUpside),
    lowUpside: ranked.slice(-3).reverse().map(toUpside),
    confidence,
    explanationFacts: facts,
    missingDataFlags: [...new Set(missingDataFlags)],
  }
}
