/**
 * Aggregates draft data across leagues for meta analysis (round-by-round position, ADP, etc.).
 * Used by StrategyPatternAnalyzer and for Draft War Room / platform dashboards.
 */
import type { StrategySport } from './types'
import type { DraftPickFact } from './types'

interface DraftMetaSummary {
  sport: StrategySport
  leagueFormat: string
  leagueId: string
  season: number
  numTeams: number
  totalPicks: number
  positionByRound: Record<number, Record<string, number>>
  /** Optional: ADP by position (playerId or position-only). */
  adpByPosition?: Record<string, number[]>
}

/**
 * Build a draft meta summary from a list of picks (e.g. from getDraftPicks + player positions).
 */
export function summarizeDraft(
  picks: DraftPickFact[],
  opts: { sport: StrategySport; leagueFormat: string; leagueId: string; season: number; numTeams: number }
): DraftMetaSummary {
  const positionByRound: Record<number, Record<string, number>> = {}
  for (const p of picks) {
    const round = p.round
    if (!positionByRound[round]) positionByRound[round] = {}
    const pos = p.position ?? 'UNK'
    positionByRound[round][pos] = (positionByRound[round][pos] ?? 0) + 1
  }
  return {
    sport: opts.sport,
    leagueFormat: opts.leagueFormat,
    leagueId: opts.leagueId,
    season: opts.season,
    numTeams: opts.numTeams,
    totalPicks: picks.length,
    positionByRound,
  }
}

