/**
 * Retired league concepts — creation policy.
 *
 * A retired concept can no longer be CREATED, but every existing league or
 * tournament of that concept must keep working: reads, renders, historical
 * URLs, admin tooling and imports are all unaffected. This module is
 * deliberately creation-only; do not use it to gate read paths.
 *
 * Tournament Mode was retired from the active roadmap on 2026-07-23. Its source,
 * routes and database tables are intentionally preserved — route exclusion and
 * build removal are a separate, later phase gated on a soak period.
 *
 * The guard is applied to the FORMAT ID (post-normalisation), not to the raw
 * request string. `normalizeConceptToFormat` already trims and lower-cases input
 * and resolves aliases, so guarding downstream of it means casing, surrounding
 * whitespace and alias spellings cannot bypass the policy.
 */

import type { LeagueFormatId } from '@/lib/league/format-engine'

/** Stable, machine-readable reason codes. Clients may switch on these. */
export const RETIRED_CONCEPT_REASON_CODES = {
  tournament: 'TOURNAMENT_CREATION_DISABLED',
} as const

export type RetiredConceptReasonCode =
  (typeof RETIRED_CONCEPT_REASON_CODES)[keyof typeof RETIRED_CONCEPT_REASON_CODES]

/** Format ids that may no longer be created. */
const RETIRED_FORMAT_IDS = new Set<string>(['tournament'])

/** User-safe copy. Says what happened and what still works — no dead ends. */
const RETIRED_CONCEPT_MESSAGES: Record<string, string> = {
  tournament:
    'Tournament Mode is no longer available for new leagues. Existing tournaments remain accessible and are unaffected.',
}

/**
 * Thrown by creation services when a retired concept is requested. Route
 * handlers catch this and translate it into a 400 with the stable `code`.
 */
export class RetiredConceptError extends Error {
  readonly code: RetiredConceptReasonCode
  readonly status = 400

  constructor(code: RetiredConceptReasonCode, message: string) {
    super(message)
    this.name = 'RetiredConceptError'
    this.code = code
  }
}

export interface RetiredConceptRejection {
  /** Stable code for programmatic handling. */
  code: RetiredConceptReasonCode
  /** User-safe explanation. */
  message: string
  /** The retired format id that was requested. */
  formatId: string
}

/**
 * Returns a rejection when `formatId` names a retired concept, else null.
 * Pass the NORMALISED format id (output of `normalizeConceptToFormat`).
 */
export function checkRetiredConcept(
  formatId: LeagueFormatId | string | null | undefined,
): RetiredConceptRejection | null {
  const id = String(formatId ?? '').trim().toLowerCase()
  if (!id || !RETIRED_FORMAT_IDS.has(id)) return null
  return {
    code: RETIRED_CONCEPT_REASON_CODES[id as keyof typeof RETIRED_CONCEPT_REASON_CODES],
    message: RETIRED_CONCEPT_MESSAGES[id] ?? 'This league type is no longer available for new leagues.',
    formatId: id,
  }
}

/** True when the concept may no longer be created. */
export function isRetiredConcept(formatId: LeagueFormatId | string | null | undefined): boolean {
  return checkRetiredConcept(formatId) !== null
}

/**
 * Raw-string convenience for entry points that never normalise (e.g. the
 * standalone Tournament creation endpoint). Accepts the same alias spellings
 * `normalizeConceptToFormat` does for these concepts.
 */
export function isRetiredRawConcept(rawConcept: string | null | undefined): boolean {
  return isRetiredConcept(String(rawConcept ?? '').trim().toLowerCase())
}
