/**
 * Decision OS — production dependency wiring for `manager.lineup.set` (Slice 1).
 *
 * The ONLY place the real engines are referenced for the production path. The decision layer never
 * imports these directly (architecture rule) — they are injected here. Tests use fakes instead, so
 * this file is never exercised by unit tests.
 */
import { computeLineupActionsForUser } from '@/lib/lineup-actions/computeLineupActionsForUser'
import { defaultLineupWorldDeps, type LineupWorldDeps } from './world'
import { defaultLineupRuleDeps } from './rules'
import type { LineupDecisionDeps } from './decision'

export function productionLineupWorldDeps(): LineupWorldDeps {
  return defaultLineupWorldDeps
}

export function productionLineupDecisionDeps(): LineupDecisionDeps {
  return {
    recommend: computeLineupActionsForUser, // canonical recommender (Slice 0), reused unchanged
    ruleDeps: defaultLineupRuleDeps, // Rule Framework composes validateRedraftLineup
    newId: () =>
      (globalThis.crypto?.randomUUID?.() as string | undefined) ??
      `dec_${Date.now()}_${Math.random().toString(36).slice(2)}`,
  }
}
