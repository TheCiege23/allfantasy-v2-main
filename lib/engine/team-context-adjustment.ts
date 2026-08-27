/**
 * lib/engine/team-context-adjustment.ts
 * Team context adjustment engine — modifies trade value based on:
 * - Team needs (positional gaps)
 * - Points scored vs points allowed
 * - Win/Loss record
 * - Championship window (contender vs rebuild)
 * - Bench strength
 *
 * Returns a multiplier (0.80–1.20) applied to the raw value.
 * Performance target: <5ms per team.
 */

import { starterNeedsFromSlots } from '@/lib/core-app/slotEligibility'

import type { TradePlayerAsset, SportKey } from './trade-types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TeamContextInput {
  sport: SportKey
  /** Team's current roster */
  roster: TradePlayerAsset[]
  /** Win-loss record */
  wins: number
  losses: number
  ties?: number
  /** Points scored and allowed this season */
  pointsFor: number
  pointsAgainst: number
  /** League standing / rank */
  rank?: number
  totalTeams?: number
  /** Is this team a contender or rebuilder? */
  direction?: 'CONTEND' | 'REBUILD' | 'MIDDLE' | 'FRAGILE_CONTEND'
  /** Roster slot requirements */
  rosterSlots?: Record<string, number> // e.g. { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 2 }
  /** Current season week (for window calculations) */
  currentWeek?: number
  totalWeeks?: number
}

export interface TeamContextResult {
  /** Multiplier to apply to player value (0.80–1.20) */
  multiplier: number
  /** Direction: contend, rebuild, middle */
  window: 'contender' | 'rebuilder' | 'middle'
  /** Positional needs — positions where the team is weakest */
  needs: string[]
  /** Bench depth score (0–100) */
  benchStrength: number
  /** Points differential */
  pointsDiff: number
  /** Win percentage */
  winPct: number
  /** Breakdown of adjustment factors */
  breakdown: {
    needsAdj: number // -0.10 to +0.10
    recordAdj: number // -0.05 to +0.05
    pointsDiffAdj: number // -0.05 to +0.05
    windowAdj: number // -0.05 to +0.10
    benchAdj: number // -0.03 to +0.03
  }
}

// ---------------------------------------------------------------------------
// Position requirements by sport (minimum starters)
// ---------------------------------------------------------------------------

/**
 * ⚠ THESE ARE A LAST RESORT, AND THE NFL ENTRY CANNOT SEE A DEFENCE.
 *
 * Every entry here is a standard-redraft shape. In an IDP league that makes the entire defence
 * invisible — a team with two linebacker slots and no linebacker reads as having no needs — and
 * in superflex it misses the position that defines the format. `resolveRequiredStarters` prefers
 * the league's own slots wherever the caller supplies them, and these only apply when it cannot.
 */
const DEFAULT_STARTER_NEEDS: Record<string, Record<string, number>> = {
  NFL: { QB: 1, RB: 2, WR: 3, TE: 1 },
  NBA: { PG: 1, SG: 1, SF: 1, PF: 1, C: 1 },
  MLB: { SP: 3, RP: 2, C: 1, '1B': 1, '2B': 1, SS: 1, '3B': 1, OF: 3 },
  NHL: { C: 2, LW: 2, RW: 2, D: 4, G: 1 },
  NCAAF: { QB: 1, RB: 2, WR: 3, TE: 1 },
  NCAAB: { PG: 1, SG: 1, SF: 1, PF: 1, C: 1 },
  SOCCER: { FW: 2, MF: 3, DF: 4, GK: 1 },
}

// ---------------------------------------------------------------------------
// Core computation
// ---------------------------------------------------------------------------

/**
 * Compute team context adjustment for a trade.
 * Returns a multiplier (0.80–1.20) plus detailed breakdown.
 */
export function computeTeamContext(input: TeamContextInput): TeamContextResult {
  const { sport, roster, wins, losses, ties = 0, pointsFor, pointsAgainst } = input
  const totalGames = wins + losses + ties
  const winPct = totalGames > 0 ? wins / totalGames : 0.50
  const pointsDiff = pointsFor - pointsAgainst

  // 1. Determine championship window
  const window = input.direction
    ? (input.direction === 'CONTEND' || input.direction === 'FRAGILE_CONTEND' ? 'contender' : input.direction === 'REBUILD' ? 'rebuilder' : 'middle')
    : inferWindow(winPct, input.rank, input.totalTeams)

  // 2. Positional needs analysis
  const needs = computePositionalNeeds(roster, sport, input.rosterSlots)

  // 3. Bench strength
  const benchStrength = computeBenchStrength(roster, sport, input.rosterSlots)

  // 4. Compute adjustment factors

  // Needs adjustment: teams with many gaps value all acquisitions slightly more
  const needsAdj = needs.length >= 3 ? 0.05 : needs.length >= 2 ? 0.02 : needs.length >= 1 ? 0.01 : -0.02

  // Record adjustment: winning teams have more leverage, losing teams more desperate
  const recordAdj = winPct >= 0.70 ? -0.03 : winPct >= 0.55 ? -0.01 : winPct <= 0.30 ? 0.04 : winPct <= 0.40 ? 0.02 : 0

  // Points differential: high-scoring teams are stronger
  const avgPd = totalGames > 0 ? pointsDiff / totalGames : 0
  const pointsDiffAdj = avgPd > 20 ? -0.03 : avgPd > 10 ? -0.01 : avgPd < -20 ? 0.04 : avgPd < -10 ? 0.02 : 0

  // Window adjustment: contenders value win-now pieces more, rebuilders value youth
  const windowAdj = window === 'contender' ? 0.05 : window === 'rebuilder' ? -0.03 : 0

  // Bench adjustment: thin benches need depth more
  const benchAdj = benchStrength < 30 ? 0.03 : benchStrength > 70 ? -0.02 : 0

  const totalAdj = needsAdj + recordAdj + pointsDiffAdj + windowAdj + benchAdj
  const multiplier = Math.round((1.0 + clamp(totalAdj, -0.20, 0.20)) * 1000) / 1000

  return {
    multiplier,
    window,
    needs,
    benchStrength,
    pointsDiff: Math.round(pointsDiff),
    winPct: Math.round(winPct * 1000) / 1000,
    breakdown: {
      needsAdj: Math.round(needsAdj * 1000) / 1000,
      recordAdj: Math.round(recordAdj * 1000) / 1000,
      pointsDiffAdj: Math.round(pointsDiffAdj * 1000) / 1000,
      windowAdj: Math.round(windowAdj * 1000) / 1000,
      benchAdj: Math.round(benchAdj * 1000) / 1000,
    },
  }
}

/**
 * Apply team context to a player's value for a specific position.
 * If the player fills a team need, value is boosted. If redundant, slightly reduced.
 */
export function applyTeamContextToPlayer(
  baseValue: number,
  playerPosition: string,
  teamCtx: TeamContextResult,
): number {
  let adjusted = baseValue * teamCtx.multiplier

  // Bonus if player fills a positional need
  if (teamCtx.needs.includes(playerPosition)) {
    adjusted *= 1.08 // 8% boost for filling a need
  }

  return Math.round(adjusted)
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function inferWindow(
  winPct: number,
  rank?: number,
  totalTeams?: number,
): 'contender' | 'rebuilder' | 'middle' {
  if (rank != null && totalTeams != null) {
    const pctRank = rank / totalTeams
    if (pctRank <= 0.25) return 'contender'
    if (pctRank >= 0.75) return 'rebuilder'
  }
  if (winPct >= 0.65) return 'contender'
  if (winPct <= 0.35) return 'rebuilder'
  return 'middle'
}

/**
 * What this league actually requires, preferring its own slots over the assumed table.
 *
 * ⚠ THREE THINGS WENT WRONG HERE AND EACH ONE LOOKED LIKE IT WAS WORKING.
 *
 * 1. `rosterSlots ?? DEFAULT` let an EMPTY OBJECT through. `af-legacy/page.tsx:2127` passes
 *    `roster?.slots || {}`, and `{}` is not nullish — so a league whose slots we do not hold
 *    stated zero requirements, every team came back with no needs, and `needsAdj` handed each
 *    of them the -0.02 reserved for a genuinely complete roster. An empty statement of
 *    requirements is an absence of information, not a finding, so it falls through here.
 *
 * 2. The counts arrive KEYED BY SLOT, NOT BY POSITION, and the slots include ones no player's
 *    position ever equals. Iterating them raw makes `FLEX`, `SUPER_FLEX`, `BN` and `IR` into
 *    phantom needs that no roster can ever satisfy — so passing real slots would have been
 *    worse than the assumed table it replaced.
 *
 * 3. Flex must be counted, never distributed. A flex is a requirement without an address;
 *    splitting it across positions invents a per-position number the league never stated.
 *
 * `starterNeedsFromSlots` already resolves all three — it is the predicate the game-day surfaces
 * use — so this expands the counts back into a slot list and defers to it rather than keeping a
 * fourth opinion about what a roster requires.
 */
function resolveRequiredStarters(
  sport: SportKey,
  rosterSlots?: Record<string, number>,
): { required: Record<string, number>; flex: number; basis: 'league' | 'assumed' } {
  const expanded: string[] = []
  for (const [slot, count] of Object.entries(rosterSlots ?? {})) {
    if (!Number.isFinite(count) || count <= 0) continue
    for (let i = 0; i < Math.min(count, 64); i++) expanded.push(slot)
  }

  const stated = starterNeedsFromSlots(expanded)
  if (Object.keys(stated.needs).length > 0 || stated.flex > 0) {
    return { required: stated.needs, flex: stated.flex, basis: 'league' }
  }

  return { required: DEFAULT_STARTER_NEEDS[sport] ?? {}, flex: 0, basis: 'assumed' }
}

/**
 * The group a player's position satisfies, in the same space the slots are stated in.
 *
 * Routed through the slot classifier rather than a second lookup table so a position can never
 * mean one thing to the requirement and another to the count. Returns null for anything the
 * classifier does not recognise, which is counted as nothing rather than as its own position —
 * an unrecognised string inventing a roster group is how a phantom need appears.
 */
function positionGroup(pos: string | null | undefined): string | null {
  const raw = String(pos ?? '').trim().toUpperCase()
  if (!raw) return null
  const keys = Object.keys(starterNeedsFromSlots([raw]).needs)
  return keys.length === 1 ? keys[0] : null
}

function computePositionalNeeds(
  roster: TradePlayerAsset[],
  sport: SportKey,
  rosterSlots?: Record<string, number>,
): string[] {
  const needs: string[] = []
  const { required } = resolveRequiredStarters(sport, rosterSlots)

  /*
   * ⚠ COUNT THE ROSTER IN THE SAME SPACE THE REQUIREMENT IS STATED IN. `starterNeedsFromSlots`
   * collapses `DE`/`DT` onto `DL` and `CB`/`S` onto `DB`, because that is the group the slot
   * accepts. A roster counted by raw position has zero players at `DL` no matter how many ends
   * it holds, so every defensive requirement would read as a hole on every team.
   */
  const posCounts: Record<string, number> = {}
  for (const p of roster) {
    const group = positionGroup(p.pos)
    if (!group) continue
    posCounts[group] = (posCounts[group] ?? 0) + 1
  }

  // Find positions where team is short
  for (const [pos, needed] of Object.entries(required)) {
    const have = posCounts[pos] ?? 0
    // Need at least 1.5x starters for adequate depth
    if (have < needed * 1.5) {
      needs.push(pos)
    }
  }

  return needs
}

/**
 * ⚠ THIS READ THE ASSUMED TABLE EVEN WHEN THE LEAGUE HAD STATED ITS OWN SLOTS.
 *
 * Bench strength is roster minus starters, so it is only as right as the starter count. Against
 * the NFL default that count is seven for every league — so an IDP league starting nine on
 * offence and four on defence had six real starters reclassified as bench, and a normal roster
 * scored as unusually deep. Flex slots count toward starters here for the same reason: a flex is
 * a player who has to start, even though no single position owns him.
 */
function computeBenchStrength(
  roster: TradePlayerAsset[],
  sport: SportKey,
  rosterSlots?: Record<string, number>,
): number {
  const { required, flex } = resolveRequiredStarters(sport, rosterSlots)
  const totalRequired = Object.values(required).reduce((a, b) => a + b, 0) + flex
  const totalRoster = roster.length
  const benchSize = Math.max(0, totalRoster - totalRequired)

  // Bench strength is ratio of bench to starters, normalized to 0–100
  const ratio = totalRequired > 0 ? benchSize / totalRequired : 0
  return Math.round(clamp(ratio * 60, 0, 100)) // 1:1 bench:starter = 60
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

export { DEFAULT_STARTER_NEEDS }
