/**
 * Decision OS — World Resolution for `manager.waiver.claim` (Slice 2).
 *
 * READ-ONLY. Shapes ALREADY-LOADED waiver facts (resolved by the route-seam loader) into a neutral
 * World: resource intelligence (FAAB/priority/limits) + a submission-window fact. No prisma, no
 * writes. Sport-/format-specific logic stays in the wrapped resolvers; the core reads neutral facts.
 *
 * Honesty contract: the precise submission window is enforced as a RULE at claim time; the World only
 * reports the processing type + an approximate window with explicit provenance + uncertainty.
 */

/** Resolved waiver settings shape (subset of getEffectiveLeagueWaiverSettings output) the World needs. */
export interface WaiverSettingsFacts {
  waiverType: string
  normalizedWaiverType: string
  faabBudget: number | null
  claimLimitPerPeriod: number | null
  claimLimitPerWeek: number | null
  maxDropsPerWeek: number | null
  lockType: string | null
}

export interface WaiverResourceIntel {
  faabRemaining: number | null
  faabBudget: number | null
  waiverPriority: number | null
  claimLimitPerPeriod: number | null
  claimLimitPerWeek: number | null
  maxDropsPerWeek: number | null
  /** FAAB headroom 0–1 (remaining/budget) — interpreted resource pressure, not raw settings. */
  faabPressure: 'low' | 'medium' | 'high' | 'unknown'
}

/** Neutral submission fact — the precise window is a RULE, surfaced here only approximately. */
export interface WaiverSubmissionState {
  processingType: string
  /** Coarse "claims acceptable" flag; precise window enforced at claim time. */
  open: boolean
  reason: string | null
  nextProcessAtIso: string | null
  provenance: 'derived_approximate'
  uncertainty: string | null
}

export interface WaiverWorld {
  sport: string
  leagueId: string
  facts: { waiverType: string; settingsKnown: boolean }
  resources: WaiverResourceIntel
  submission: WaiverSubmissionState
}

export interface WaiverWorldInput {
  sport: string
  leagueId: string
  settings: WaiverSettingsFacts
  settingsKnown: boolean
  faabRemaining: number | null
  waiverPriority: number | null
  nextProcessAtIso?: string | null
  /** When the commissioner has locked processing (a known hard fact the loader can pass). */
  processingLocked?: boolean
}

function interpretFaabPressure(remaining: number | null, budget: number | null): WaiverResourceIntel['faabPressure'] {
  if (remaining == null || budget == null || budget <= 0) return 'unknown'
  const ratio = remaining / budget
  return ratio <= 0.2 ? 'high' : ratio <= 0.5 ? 'medium' : 'low'
}

/** Pure, read-only waiver World Resolution. */
export function resolveWaiverWorld(input: WaiverWorldInput): WaiverWorld {
  const open = input.processingLocked !== true
  return {
    sport: input.sport,
    leagueId: input.leagueId,
    facts: { waiverType: input.settings.waiverType, settingsKnown: input.settingsKnown },
    resources: {
      faabRemaining: input.faabRemaining,
      faabBudget: input.settings.faabBudget,
      waiverPriority: input.waiverPriority,
      claimLimitPerPeriod: input.settings.claimLimitPerPeriod,
      claimLimitPerWeek: input.settings.claimLimitPerWeek,
      maxDropsPerWeek: input.settings.maxDropsPerWeek,
      faabPressure: interpretFaabPressure(input.faabRemaining, input.settings.faabBudget),
    },
    submission: {
      processingType: input.settings.normalizedWaiverType,
      open,
      reason: open ? null : 'Waiver processing is locked by the commissioner.',
      nextProcessAtIso: input.nextProcessAtIso ?? null,
      provenance: 'derived_approximate',
      uncertainty: 'Exact submission window/lock is enforced at claim time; this is an approximation.',
    },
  }
}
