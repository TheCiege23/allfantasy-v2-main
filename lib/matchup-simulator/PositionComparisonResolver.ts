/**
 * PositionComparisonResolver — position-by-position comparison where supported.
 * Uses sport-scope for supported sports; returns position labels and optional per-position advantage.
 */

import { normalizeToSupportedSport, type SupportedSport } from '@/lib/sport-scope'

type PositionSlot = {
  id: string
  label: string
  order: number
}

type PositionComparisonRow = {
  slotId: string
  slotLabel: string
  teamAScore: number
  teamBScore: number
  advantage: 'A' | 'B' | 'even'
  edgeLabel: string
}

/** Position labels by sport (common fantasy slots). */
const POSITIONS_BY_SPORT: Record<SupportedSport, PositionSlot[]> = {
  NFL: [
    { id: 'QB', label: 'QB', order: 1 },
    { id: 'RB', label: 'RB', order: 2 },
    { id: 'WR', label: 'WR', order: 3 },
    { id: 'TE', label: 'TE', order: 4 },
    { id: 'FLEX', label: 'FLEX', order: 5 },
    { id: 'K', label: 'K', order: 6 },
    { id: 'DST', label: 'DST', order: 7 },
  ],
  NHL: [
    { id: 'C', label: 'C', order: 1 },
    { id: 'LW', label: 'LW', order: 2 },
    { id: 'RW', label: 'RW', order: 3 },
    { id: 'D', label: 'D', order: 4 },
    { id: 'G', label: 'G', order: 5 },
    { id: 'UTIL', label: 'UTIL', order: 6 },
  ],
  NBA: [
    { id: 'PG', label: 'PG', order: 1 },
    { id: 'SG', label: 'SG', order: 2 },
    { id: 'SF', label: 'SF', order: 3 },
    { id: 'PF', label: 'PF', order: 4 },
    { id: 'C', label: 'C', order: 5 },
    { id: 'G', label: 'G', order: 6 },
    { id: 'F', label: 'F', order: 7 },
    { id: 'UTIL', label: 'UTIL', order: 8 },
  ],
  MLB: [
    { id: 'C', label: 'C', order: 1 },
    { id: '1B', label: '1B', order: 2 },
    { id: '2B', label: '2B', order: 3 },
    { id: '3B', label: '3B', order: 4 },
    { id: 'SS', label: 'SS', order: 5 },
    { id: 'OF', label: 'OF', order: 6 },
    { id: 'DH', label: 'DH', order: 7 },
    { id: 'UTIL', label: 'UTIL', order: 8 },
    { id: 'SP', label: 'SP', order: 9 },
    { id: 'RP', label: 'RP', order: 10 },
    { id: 'P', label: 'P', order: 11 },
  ],
  NCAAB: [
    { id: 'PG', label: 'PG', order: 1 },
    { id: 'SG', label: 'SG', order: 2 },
    { id: 'SF', label: 'SF', order: 3 },
    { id: 'PF', label: 'PF', order: 4 },
    { id: 'C', label: 'C', order: 5 },
    { id: 'G', label: 'G', order: 6 },
    { id: 'F', label: 'F', order: 7 },
    { id: 'UTIL', label: 'UTIL', order: 8 },
  ],
  NCAAF: [
    { id: 'QB', label: 'QB', order: 1 },
    { id: 'RB', label: 'RB', order: 2 },
    { id: 'WR', label: 'WR', order: 3 },
    { id: 'TE', label: 'TE', order: 4 },
    { id: 'FLEX', label: 'FLEX', order: 5 },
    { id: 'K', label: 'K', order: 6 },
    { id: 'DST', label: 'DST', order: 7 },
  ],
  SOCCER: [
    { id: 'GKP', label: 'GKP', order: 1 },
    { id: 'DEF', label: 'DEF', order: 2 },
    { id: 'MID', label: 'MID', order: 3 },
    { id: 'FWD', label: 'FWD', order: 4 },
    { id: 'UTIL', label: 'UTIL', order: 5 },
  ],
}

/**
 * Get ordered position slots for a sport (for position comparison block).
 */
export function getPositionSlotsForSport(sport: string): PositionSlot[] {
  const key = normalizeToSupportedSport(sport) as SupportedSport
  const slots = POSITIONS_BY_SPORT[key] ?? POSITIONS_BY_SPORT.NFL
  return [...slots].sort((a, b) => a.order - b.order)
}

export function getPositionSlotWeight(slotId: string): number {
  if (slotId === 'QB' || slotId === 'PG' || slotId === 'SP' || slotId === 'GKP') return 1.25
  if (slotId === 'RB' || slotId === 'WR' || slotId === 'MID' || slotId === 'C') return 1.1
  if (slotId === 'TE' || slotId === 'PF' || slotId === 'DEF' || slotId === 'D') return 0.95
  if (slotId === 'K' || slotId === 'DST' || slotId === 'RP') return 0.8
  return 1
}

/**
 * Build deterministic position comparison rows using team projection means and variance.
 * This powers the "position-by-position comparison" block even when full player-level splits are unavailable.
 */
export function buildPositionComparisonRows(input: {
  sport: string
  teamAMean: number
  teamBMean: number
  teamAStdDev?: number
  teamBStdDev?: number
  maxRows?: number
}): PositionComparisonRow[] {
  const slots = getPositionSlotsForSport(input.sport)
  const limitedSlots = slots.slice(0, Math.max(1, input.maxRows ?? slots.length))
  const totalWeight = limitedSlots.reduce((sum, slot) => sum + getPositionSlotWeight(slot.id), 0) || 1

  const stdA = Math.max(1, input.teamAStdDev ?? 12)
  const stdB = Math.max(1, input.teamBStdDev ?? 12)

  return limitedSlots.map((slot, index) => {
    const weight = getPositionSlotWeight(slot.id)
    const allocation = weight / totalWeight
    const volatilityNudgeA = stdA * allocation * 0.22
    const volatilityNudgeB = stdB * allocation * 0.22
    const orderNudge = (limitedSlots.length - index - 1) * 0.06

    const teamAScoreRaw = input.teamAMean * allocation + volatilityNudgeA + orderNudge
    const teamBScoreRaw = input.teamBMean * allocation + volatilityNudgeB + (index % 2 === 0 ? 0 : 0.08)

    const teamAScore = Math.round(teamAScoreRaw * 10) / 10
    const teamBScore = Math.round(teamBScoreRaw * 10) / 10
    const delta = teamAScore - teamBScore
    const absDelta = Math.abs(delta)
    const advantage: PositionComparisonRow['advantage'] =
      absDelta < 0.2 ? 'even' : delta > 0 ? 'A' : 'B'
    const edgeLabel =
      advantage === 'even'
        ? 'Even'
        : `${advantage === 'A' ? 'Team A' : 'Team B'} +${absDelta.toFixed(1)}`

    return {
      slotId: slot.id,
      slotLabel: slot.label,
      teamAScore,
      teamBScore,
      advantage,
      edgeLabel,
    }
  })
}
