/**
 * T2 Team Context Engine V1 — deterministic team profile. No AI.
 *
 * Stance:
 *   winPct ≥ 0.58  AND (no seed OR seed ≤ leagueSize/2)  → contender
 *   winPct ≤ 0.40                                         → rebuilder
 *   otherwise                                             → middle
 *
 * Positional depth: count active players per position against STARTER_NEEDS. A position with fewer
 * than its need is "weak"; with ≥ need+2 startable bodies is "strong". `depthIssues` is true when any
 * core position is below its starter need.
 */

import { starterNeedsFromSlots } from '@/lib/core-app/slotEligibility'
import type { TeamProfile, TeamStance } from './types'

/**
 * Fallback only, for callers that cannot supply the league's own slots.
 *
 * ⚠ IT IS A STANDARD-REDRAFT SHAPE AND IT IS WRONG WHEREVER THE LEAGUE IS NOT ONE. A superflex
 * team holding a single quarterback is never flagged weak at the position that decides that
 * format, and an IDP league's defensive requirements do not appear at all. `lib/engine/
 * team-context-adjustment.ts` carries a second copy of this idea that says WR 3 where this says
 * WR 2 — the two have never agreed. Pass `rosterSlots` and neither is consulted.
 */
export const STARTER_NEEDS: Record<string, number> = { QB: 1, RB: 2, WR: 2, TE: 1 }
const CORE_POSITIONS = ['QB', 'RB', 'WR', 'TE'] as const

export interface TeamProfileInput {
  rosterId: string
  wins: number
  losses: number
  ties?: number
  pointsFor: number
  playoffSeed?: number | null
  leagueSize?: number
  /** Active roster player positions (one entry per player). */
  positions: string[]
  /**
   * The league's own `roster_positions`. Supply it and the requirement is read rather than
   * assumed; omit it and the standard-redraft fallback applies, exactly as before.
   */
  rosterSlots?: readonly string[] | null
}

export function buildTeamProfile(input: TeamProfileInput): TeamProfile {
  const games = input.wins + input.losses + (input.ties ?? 0)
  const winPct = games > 0 ? (input.wins + 0.5 * (input.ties ?? 0)) / games : 0.5

  const leagueSize = input.leagueSize ?? 12
  const seedTopHalf = input.playoffSeed == null || input.playoffSeed <= Math.ceil(leagueSize / 2)

  let stance: TeamStance = 'middle'
  if (winPct >= 0.58 && seedTopHalf) stance = 'contender'
  else if (winPct <= 0.4) stance = 'rebuilder'

  const counts: Record<string, number> = {}
  for (const raw of input.positions) {
    const pos = String(raw || '').toUpperCase()
    const key = pos === 'DEF' ? 'DST' : pos
    counts[key] = (counts[key] ?? 0) + 1
  }

  /*
   * What this league actually forces a team to start. Flex slots are deliberately not
   * distributed across positions — a flex is a requirement without an address, and splitting it
   * would invent a per-position number the roster never asked for.
   */
  const derived = input.rosterSlots?.length ? starterNeedsFromSlots(input.rosterSlots) : null
  const needsByPosition = derived?.needs ?? STARTER_NEEDS
  /*
   * A superflex or 2QB league needs a second startable quarterback even though only one slot
   * says QB, because the flex will be filled with one by every team that can. This is the one
   * place a flex is attributed, and only for the position whose scarcity it actually creates.
   */
  const effectiveNeeds: Record<string, number> = { ...needsByPosition }
  if (derived?.superflex) effectiveNeeds.QB = Math.max(2, effectiveNeeds.QB ?? 0)

  const scored = derived
    ? [...new Set([...CORE_POSITIONS, ...Object.keys(effectiveNeeds)])]
    : [...CORE_POSITIONS]

  const weakPositions: string[] = []
  const strongPositions: string[] = []
  let depthIssues = false
  for (const pos of scored) {
    const need = effectiveNeeds[pos] ?? 0
    if (need <= 0) continue
    const have = counts[pos] ?? 0
    if (have < need) {
      weakPositions.push(pos)
      depthIssues = true
    } else if (have >= need + 2) {
      strongPositions.push(pos)
    }
  }

  return {
    rosterId: input.rosterId,
    stance,
    winPct: Math.round(winPct * 1000) / 1000,
    pointsFor: input.pointsFor,
    weakPositions,
    strongPositions,
    depthIssues,
  }
}
