/**
 * Keeper rule engine — deterministic validation: max keepers, round-cost, eligibility.
 * No AI; commissioner override can bypass eligibility when needed.
 */

import type { KeeperConfig, KeeperSelection } from './types'

export interface ValidateKeeperInput {
  config: KeeperConfig | null
  existingSelections: KeeperSelection[]
  newSelection: KeeperSelection
  rounds: number
  teamCount: number
  /** When true, skip eligibility and duplicate checks that would block (commissioner override). */
  commissionerOverride?: boolean
}

export interface ValidateKeeperResult {
  valid: boolean
  error?: string
}

/**
 * Validate a single keeper selection against config and existing selections.
 */
export function validateKeeperSelection(input: ValidateKeeperInput): ValidateKeeperResult {
  const { config, existingSelections, newSelection, rounds, commissionerOverride } = input
  const norm = (value: string) => value.trim().toLowerCase()
  const normPos = (value: string) => value.trim().toUpperCase()

  if (!config || config.maxKeepers <= 0) {
    return { valid: false, error: 'Keeper draft is not configured' }
  }

  const forRoster = existingSelections.filter((s) => s.rosterId === newSelection.rosterId)
  const withoutOverride = forRoster.filter((s) => !s.commissionerOverride)

  if (!commissionerOverride && forRoster.length >= config.maxKeepers) {
    return { valid: false, error: `Maximum ${config.maxKeepers} keepers per team` }
  }

  if (newSelection.roundCost < 1 || newSelection.roundCost > rounds) {
    return { valid: false, error: `Round cost must be between 1 and ${rounds}` }
  }

  const sameRound = forRoster.some((s) => s.roundCost === newSelection.roundCost)
  if (sameRound) {
    return { valid: false, error: `You already have a keeper for round ${newSelection.roundCost}` }
  }

  const samePlayer = existingSelections.some(
    (s) =>
      s.rosterId === newSelection.rosterId &&
      norm(s.playerName) === norm(newSelection.playerName)
  )
  if (samePlayer) {
    return { valid: false, error: 'Player already selected as keeper' }
  }

  if (!commissionerOverride) {
    const globallyTaken = existingSelections.some(
      (s) =>
        s.rosterId !== newSelection.rosterId &&
        norm(s.playerName) === norm(newSelection.playerName)
    )
    if (globallyTaken) {
      return { valid: false, error: 'Player is already protected by another roster' }
    }
  }

  if (!commissionerOverride && config.maxKeepersPerPosition) {
    const posCounts: Record<string, number> = {}
    for (const s of withoutOverride) {
      const key = normPos(s.position)
      posCounts[key] = (posCounts[key] ?? 0) + 1
    }
    const pos = normPos(newSelection.position)
    const max = config.maxKeepersPerPosition[pos]
    if (max != null && (posCounts[pos] ?? 0) >= max) {
      return { valid: false, error: `Maximum ${max} keeper(s) at ${pos}` }
    }
  }

  if (!newSelection.playerName?.trim()) {
    return { valid: false, error: 'Player name is required' }
  }

  return { valid: true }
}

/**
 * Validate full keeper selections for a roster (e.g. before locking).
 */
export function validateRosterKeeperSelections(
  config: KeeperConfig | null,
  selections: KeeperSelection[],
  rounds: number
): ValidateKeeperResult {
  if (!config || config.maxKeepers <= 0) {
    return { valid: true }
  }

  const byRoster = new Map<string, KeeperSelection[]>()
  for (const s of selections) {
    const list = byRoster.get(s.rosterId) ?? []
    list.push(s)
    byRoster.set(s.rosterId, list)
  }

  for (const [, list] of byRoster) {
    if (list.length > config.maxKeepers) {
      return { valid: false, error: `A roster has ${list.length} keepers (max ${config.maxKeepers})` }
    }
    const roundCosts = list.map((s) => s.roundCost)
    const unique = new Set(roundCosts)
    if (unique.size !== roundCosts.length) {
      return { valid: false, error: 'Duplicate round cost on same roster' }
    }
    for (const r of roundCosts) {
      if (r < 1 || r > rounds) {
        return { valid: false, error: `Invalid round cost ${r}` }
      }
    }
  }

  return { valid: true }
}
