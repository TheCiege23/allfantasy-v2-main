/**
 * Decision OS Core — SportAdapter contract (Phase 1).
 *
 * Generalizes the existing `lib/redraft/sportAdapters/*` interface (today's only
 * real per-sport adapter in the codebase) plus the config lookups scattered
 * across `lib/sportConfig`, `lib/sport-defaults`, and `lib/multi-sport`.
 *
 * This is additive: every field here is derivable from data that already exists
 * per sport. No existing sport config needs to be rewritten to satisfy this
 * contract — see docs/DECISION_OS_CORE_UNIFICATION_PLAN.md §13.2 / §15.
 */

import type { CompetitionStructure, ScheduleUnit } from '../primitives/types'

export interface SportAdapter {
  /** e.g. "NFL" — matches lib/sport-scope.ts's SupportedSport values. */
  sport: string

  scheduleUnit: ScheduleUnit
  competitionStructure: CompetitionStructure

  /** Open set — replaces the hardcoded kicker/dst/idp/college roster category enum. */
  rosterSlotCategories: string[]

  /** This sport's valid scoring stat keys, replacing per-sport hardcoded enums. */
  scoringStatVocabulary: string[]

  supportsIDP: boolean

  /**
   * Whether this sport currently has a provider-backed data-coverage verification
   * signal (e.g. depth chart / injury foundation coverage) that a decision can
   * honestly check. Only NFL has this today — see
   * `lib/decision-os/commissioner-health/world.ts`'s `nflDataCoverageKnown`,
   * itself sourced from an NFL-only snapshot field
   * (`lib/commissioner-hub/commissionerHubHealth.ts`'s `nflDataCoverage`).
   * This flag is the single declared place that fact lives, so decision logic
   * can ask the adapter instead of comparing `sport === 'NFL'` inline.
   */
  tracksProviderDataCoverage: boolean

  /** == existing SportAdapter.parseRawStats in lib/redraft/sportAdapters/types.ts */
  parseRawStats(raw: Record<string, number>): Record<string, number>

  /** == existing SportAdapter.getLineupLockTime in lib/redraft/sportAdapters/types.ts */
  getLineupLockTime(gameTimeIso: string): Date
}

/** Thrown by registry resolution when a sport has no registered adapter. */
export class UnknownSportAdapterError extends Error {
  constructor(public readonly sport: string) {
    super(`No SportAdapter registered for sport: ${sport}`)
    this.name = 'UnknownSportAdapterError'
  }
}
