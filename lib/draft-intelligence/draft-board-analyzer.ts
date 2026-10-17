/**
 * Draft Board Analyzer
 *
 * Analyzes draft board state to detect patterns, scarcity,
 * positional runs, stack opportunities, value cliffs, and fades.
 */

import type { DraftAvailablePlayer, DraftedPlayer, DraftRosterPlayer } from './draft-decision-engine'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DraftBoardInput {
  availablePlayers: DraftAvailablePlayer[]
  draftedByOthers: DraftedPlayer[]
  myRoster: DraftRosterPlayer[]
  rosterRequirements: Record<string, number>
  currentPick: number
}

export interface PositionalRun {
  position: string
  count: number
  windowSize: number
}

export interface StackOpportunity {
  qbName: string
  team: string
  targets: { name: string; position: string; value: number }[]
}

export interface ValueCliff {
  position: string
  topPlayer: string
  topValue: number
  nextValue: number
  gapPct: number
}

export interface DraftBoardAnalysis {
  /** Count of players drafted by position */
  positionsDrafted: Record<string, number>
  /** Remaining startable players per position (value > 2000) */
  scarcityByPosition: Record<string, number>
  /** Detected positional runs in recent picks */
  runs: PositionalRun[]
  /** Stack opportunities (QB + pass catchers on same team) */
  stackOpportunities: StackOpportunity[]
  /** Value cliffs (large gap between #1 and #2 at a position) */
  valueCliffs: ValueCliff[]
  /** Value players (ADP significantly below current pick) */
  valuePlayers: { name: string; position: string; adp: number; value: number }[]
  /** Fade candidates (players to avoid) */
  fadeCandidates: { name: string; position: string; reason: string }[]
  /** Total players available */
  totalAvailable: number
  /** Picks made so far */
  picksMade: number
}

// ---------------------------------------------------------------------------
// Scarcity
// ---------------------------------------------------------------------------

export function computePositionalScarcity(
  available: DraftAvailablePlayer[],
  requirements: Record<string, number>,
): Record<string, number> {
  const scarcity: Record<string, number> = {}
  const STARTABLE_THRESHOLD = 2000

  for (const pos of Object.keys(requirements)) {
    const startable = available.filter(
      p => p.position === pos && p.value >= STARTABLE_THRESHOLD,
    )
    scarcity[pos] = startable.length
  }

  return scarcity
}

// ---------------------------------------------------------------------------
// Positional Runs
// ---------------------------------------------------------------------------

export function detectPositionalRuns(
  draftedByOthers: DraftedPlayer[],
  windowSize: number = 5,
): PositionalRun[] {
  if (draftedByOthers.length < windowSize) return []

  const recent = [...draftedByOthers]
    .sort((a, b) => b.pickNumber - a.pickNumber)
    .slice(0, windowSize)

  const counts: Record<string, number> = {}
  for (const pick of recent) {
    counts[pick.position] = (counts[pick.position] || 0) + 1
  }

  return Object.entries(counts)
    .filter(([_, count]) => count >= 3)
    .map(([position, count]) => ({ position, count, windowSize }))
    .sort((a, b) => b.count - a.count)
}

// ---------------------------------------------------------------------------
// Stack Opportunities
// ---------------------------------------------------------------------------

export function findStackOpportunities(
  myRoster: DraftRosterPlayer[],
  available: DraftAvailablePlayer[],
): StackOpportunity[] {
  const myQBs = myRoster.filter(r => r.position === 'QB')
  if (myQBs.length === 0) return []

  const stacks: StackOpportunity[] = []

  // For each QB on roster, find available pass catchers on the same NFL team
  // This is simplified — in production, the player's team would be matched
  // For now, we just identify potential stacks based on available WR/TE players
  for (const qb of myQBs) {
    const passCatchers = available.filter(
      p => ['WR', 'TE'].includes(p.position) && p.value >= 3000,
    ).slice(0, 3)

    if (passCatchers.length > 0) {
      stacks.push({
        qbName: qb.playerName,
        team: 'N/A', // Would be populated from player data
        targets: passCatchers.map(p => ({
          name: p.name,
          position: p.position,
          value: p.value,
        })),
      })
    }
  }

  return stacks.slice(0, 3)
}

// ---------------------------------------------------------------------------
// Value Cliffs
// ---------------------------------------------------------------------------

export function detectValueCliffs(
  available: DraftAvailablePlayer[],
  positions: string[],
): ValueCliff[] {
  const cliffs: ValueCliff[] = []
  const MIN_GAP_PCT = 30

  for (const pos of positions) {
    const posPlayers = available
      .filter(p => p.position === pos)
      .sort((a, b) => b.value - a.value)

    if (posPlayers.length < 2) continue

    const top = posPlayers[0]
    const next = posPlayers[1]
    const gapPct = next.value > 0
      ? Math.round(((top.value - next.value) / next.value) * 100)
      : 100

    if (gapPct >= MIN_GAP_PCT) {
      cliffs.push({
        position: pos,
        topPlayer: top.name,
        topValue: top.value,
        nextValue: next.value,
        gapPct,
      })
    }
  }

  return cliffs.sort((a, b) => b.gapPct - a.gapPct).slice(0, 3)
}

// ---------------------------------------------------------------------------
// Value Players
// ---------------------------------------------------------------------------

export function identifyValuePlayers(
  available: DraftAvailablePlayer[],
  currentPick: number,
  minAdpGap: number = 10,
): { name: string; position: string; adp: number; value: number }[] {
  return available
    .filter(p => currentPick - p.adp >= minAdpGap && p.value >= 2000)
    .sort((a, b) => (currentPick - b.adp) - (currentPick - a.adp))
    .slice(0, 5)
    .map(p => ({ name: p.name, position: p.position, adp: p.adp, value: p.value }))
}

// ---------------------------------------------------------------------------
// Fade Candidates
// ---------------------------------------------------------------------------

export function identifyFades(
  available: DraftAvailablePlayer[],
  currentPick: number,
): { name: string; position: string; reason: string }[] {
  const fades: { name: string; position: string; reason: string }[] = []

  for (const p of available) {
    // ADP reach — going before ADP by 15+
    if (p.adp - currentPick >= 15 && p.value < 5000) {
      fades.push({
        name: p.name,
        position: p.position,
        reason: `Significant reach: ADP ${p.adp}, current pick ${currentPick}`,
      })
      continue
    }

    // Outlook sell signal
    if (p.outlookTrend === 'sell' && p.outlookRiskFlags && p.outlookRiskFlags.length >= 2) {
      fades.push({
        name: p.name,
        position: p.position,
        reason: `Sell-high candidate with multiple risk flags`,
      })
    }

    // Injury concern
    if (p.outlookRiskFlags?.includes('injury_concern') && p.value < 4000) {
      fades.push({
        name: p.name,
        position: p.position,
        reason: `Injury concern — not worth the risk at this ADP`,
      })
    }
  }

  return fades.slice(0, 5)
}

// ---------------------------------------------------------------------------
// Main Entry Point
// ---------------------------------------------------------------------------

export function analyzeDraftBoard(input: DraftBoardInput): DraftBoardAnalysis {
  const positions = Object.keys(input.rosterRequirements)

  // Count positions drafted
  const positionsDrafted: Record<string, number> = {}
  for (const pick of input.draftedByOthers) {
    positionsDrafted[pick.position] = (positionsDrafted[pick.position] || 0) + 1
  }

  const scarcityByPosition = computePositionalScarcity(input.availablePlayers, input.rosterRequirements)
  const runs = detectPositionalRuns(input.draftedByOthers)
  const stackOpportunities = findStackOpportunities(input.myRoster, input.availablePlayers)
  const valueCliffs = detectValueCliffs(input.availablePlayers, positions)
  const valuePlayers = identifyValuePlayers(input.availablePlayers, input.currentPick)
  const fadeCandidates = identifyFades(input.availablePlayers, input.currentPick)

  return {
    positionsDrafted,
    scarcityByPosition,
    runs,
    stackOpportunities,
    valueCliffs,
    valuePlayers,
    fadeCandidates,
    totalAvailable: input.availablePlayers.length,
    picksMade: input.draftedByOthers.length,
  }
}
