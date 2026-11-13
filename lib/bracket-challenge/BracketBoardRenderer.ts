/**
 * BracketBoardRenderer — pure helpers for bracket board: round labels, region order, cell keys.
 */

export const DEFAULT_REGION_ORDER = ['West', 'East', 'South', 'Midwest'] as const

/**
 * Round display label (e.g. "Round of 64", "Championship").
 */
export function getRoundLabel(round: number): string {
  const labels: Record<number, string> = {
    0: 'First Four',
    1: 'Round of 64',
    2: 'Round of 32',
    3: 'Sweet 16',
    4: 'Elite 8',
    5: 'Final Four',
    6: 'Championship',
  }
  return labels[round] ?? `Round ${round}`
}

/**
 * Short round label for compact UI.
 */
export function getRoundShortLabel(round: number): string {
  const labels: Record<number, string> = {
    0: 'FF',
    1: 'R64',
    2: 'R32',
    3: 'S16',
    4: 'E8',
    5: 'F4',
    6: 'CH',
  }
  return labels[round] ?? `R${round}`
}

/**
 * Round label that adapts to shorter playoff trees.
 */
export function getAdaptiveRoundLabel(round: number, maxRound: number): string {
  if (maxRound <= 3) {
    if (round === 1) return 'Quarterfinals'
    if (round === 2) return 'Semifinals'
    if (round === 3) return 'Championship'
  }
  if (maxRound === 4) {
    if (round === 1) return 'Round 1'
    if (round === 2) return 'Quarterfinals'
    if (round === 3) return 'Semifinals'
    if (round === 4) return 'Championship'
  }
  return getRoundLabel(round)
}

export function getAdaptiveRoundShortLabel(round: number, maxRound: number): string {
  if (maxRound <= 3) {
    if (round === 1) return 'QF'
    if (round === 2) return 'SF'
    if (round === 3) return 'CH'
  }
  if (maxRound === 4) {
    if (round === 1) return 'R1'
    if (round === 2) return 'QF'
    if (round === 3) return 'SF'
    if (round === 4) return 'CH'
  }
  return getRoundShortLabel(round)
}

export type BracketBoardNodeLike = {
  round: number
  region?: string | null
}

export function getBracketRoundList(nodes: BracketBoardNodeLike[]): number[] {
  return Array.from(new Set(nodes.map((n) => n.round).filter((r) => Number.isFinite(r) && r >= 1))).sort((a, b) => a - b)
}

export function isClassicRegionalBoard(nodes: BracketBoardNodeLike[]): boolean {
  if (!nodes.length) return false
  const rounds = getBracketRoundList(nodes)
  const regionNames = new Set(nodes.map((n) => n.region).filter(Boolean))
  const hasClassicRegions =
    DEFAULT_REGION_ORDER.every((region) => regionNames.has(region)) && regionNames.size >= DEFAULT_REGION_ORDER.length
  return hasClassicRegions && rounds.includes(5) && rounds.includes(6)
}

