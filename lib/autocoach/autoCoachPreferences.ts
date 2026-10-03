import { z } from 'zod'

/**
 * User-controlled knobs for AI Auto Start/Sit Protection (stored on `UserProfile.autoCoachPreferences`).
 * Preferences influence decision-making: confidence threshold, aggressiveness, position exclusions.
 * Additive only — never overrides official OUT / inactive signals in the engine.
 */
export const AutoCoachUserPreferencesSchema = z.object({
  /** Learn lineup tendencies over time (future: ranking tie-breaks). */
  learnTendencies: z.boolean().optional(),

  /** Replacement style when projections are close: conservative | balanced | upside */
  aggressiveness: z.enum(['conservative', 'balanced', 'upside']).default('balanced'),

  /** Conservative default: never auto-remove Questionable/GTD without explicit future support. */
  questionableAutomation: z.enum(['never', 'risk_official_only']).default('never'),

  /** Notify in-app before swap executes */
  notifyAutoSwapInApp: z.boolean().default(true),

  /** Notify via email before swap executes */
  notifyAutoSwapEmail: z.boolean().default(false),

  /** Confidence threshold (0-100) before swap is allowed. Default: 65 */
  confidenceThreshold: z.number().min(0).max(100).default(65),

  /** Position-specific settings (e.g., { 'QB': { disabled: true } }) */
  positionOverrides: z.record(z.object({
    disabled: z.boolean().optional(),
    minProjectionDelta: z.number().optional(),
  }).optional()).default({}),

  /** Player exclusion list by external ID — never auto-swap these out */
  excludedPlayerIds: z.array(z.string()).default([]),

  /** Minimum expected points delta to allow swap (overrides aggressiveness when set) */
  minProjectionDelta: z.number().default(0).optional(),

  /** Last updated timestamp */
  updatedAt: z.string().datetime().optional(),
})

export type AutoCoachUserPreferences = z.infer<typeof AutoCoachUserPreferencesSchema>

/**
 * Parse & validate user preferences from JSON
 */
export function parseAutoCoachUserPreferences(raw: unknown): AutoCoachUserPreferences {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return AutoCoachUserPreferencesSchema.parse({})
  }
  try {
    return AutoCoachUserPreferencesSchema.parse(raw)
  } catch {
    // Fallback: return defaults on validation error
    return AutoCoachUserPreferencesSchema.parse({})
  }
}

/**
 * Determine confidence threshold based on preferences
 */
export function getConfidenceThreshold(prefs: AutoCoachUserPreferences): number {
  return prefs.confidenceThreshold ?? 65
}

/**
 * Determine min projection delta based on aggressiveness level
 */
export function getMinProjectionDelta(prefs: AutoCoachUserPreferences): number {
  if (prefs.minProjectionDelta !== undefined && prefs.minProjectionDelta > 0) {
    return prefs.minProjectionDelta
  }
  // Map aggressiveness to delta threshold
  const map: Record<string, number> = {
    conservative: 4.0,  // need 4+ point edge
    balanced: 2.0,      // need 2+ point edge
    upside: 0.5,        // need 0.5+ point edge
  }
  return map[prefs.aggressiveness ?? 'balanced'] ?? 2.0
}

/**
 * Check if player is excluded from swaps
 */
export function isPlayerExcluded(playerId: string, prefs: AutoCoachUserPreferences): boolean {
  return (prefs.excludedPlayerIds ?? []).includes(playerId)
}

/**
 * Check if position has swap disabled
 */
export function isPositionDisabled(position: string, prefs: AutoCoachUserPreferences): boolean {
  const override = (prefs.positionOverrides ?? {})[position.toUpperCase()]
  return override?.disabled === true
}

/**
 * Get position-specific min delta override
 */
export function getPositionMinDelta(
  position: string,
  prefs: AutoCoachUserPreferences
): number | null {
  const override = (prefs.positionOverrides ?? {})[position.toUpperCase()]
  return override?.minProjectionDelta ?? null
}

/**
 * Why AutoCoach must leave this player where he is, or null when it may move him.
 *
 * 🛑 THE ONLY PREFERENCES THE ENGINE HONOURS ARE THE ONES THAT CAN ONLY MAKE IT DO LESS, AT THE
 * USER'S REQUEST. AutoCoach replaces a starter who is definitively OUT/IR/inactive — a guaranteed
 * zero — so any healthy bench player is a strict improvement. A knob that BLOCKS such a swap on a
 * projection margin (aggressiveness, `confidenceThreshold`, `minProjectionDelta`) would leave that
 * zero in the lineup while calling itself "conservative": the engine's confidence is 60–80 off the
 * projected delta, and the default 65 would refuse any swap under a ~1.25 pt edge. Those fields stay
 * in the schema and stay unread, and Settings does not show them. (Owner's call, 2026-10-02.)
 *
 *  - `excluded`: the user manages this player themselves. Never moved — not out, and not in either.
 *  - `position_off`: the user turned AutoCoach off for this position ("don't touch my QB").
 */
export function autoCoachSkipReason(
  player: { id: string; position?: string | null },
  prefs: AutoCoachUserPreferences,
): 'excluded' | 'position_off' | null {
  if (isPlayerExcluded(String(player.id), prefs)) return 'excluded'
  const pos = String(player.position ?? '').trim()
  if (pos && isPositionDisabled(pos, prefs)) return 'position_off'
  return null
}

/**
 * Serialize preferences to JSON for database storage
 */
export function serializeAutoCoachPreferences(prefs: AutoCoachUserPreferences): Record<string, unknown> {
  return {
    learnTendencies: prefs.learnTendencies,
    aggressiveness: prefs.aggressiveness,
    questionableAutomation: prefs.questionableAutomation,
    notifyAutoSwapInApp: prefs.notifyAutoSwapInApp,
    notifyAutoSwapEmail: prefs.notifyAutoSwapEmail,
    confidenceThreshold: prefs.confidenceThreshold,
    positionOverrides: prefs.positionOverrides,
    excludedPlayerIds: prefs.excludedPlayerIds,
    minProjectionDelta: prefs.minProjectionDelta,
    updatedAt: new Date().toISOString(),
  }
}
