import { normalizeConceptToFormat } from '@/lib/league-creation/canonical/normalizeConcept'

/**
 * WHAT A COMMISSIONER'S "LEAGUE TYPE" CHOICE HAS TO CHANGE BESIDES THE LABEL.
 *
 * 🛑 THE DEFECT THIS EXISTS TO CLOSE. The League-type control saves `leagueType` and
 * nothing else. The trade valuation does not read `leagueType` — it reads `isDynasty`
 * (`leagueRow?.isDynasty ?? true` in runTradeConsoleAnalysis), and the format layer
 * reads `settings.conceptRules.extensions.aliasTags`. So a commissioner could switch a
 * league to Dynasty, watch every label in the product change, and have the trade engine
 * carry on pricing it as redraft forever. Measured on production 2026-09-20: four
 * leagues already carry `leagueType='redraft'` with `isDynasty=true` — the two fields
 * have drifted apart in the live data, which is what silent divergence looks like.
 *
 * This module is the one place that says what a league type IMPLIES, so the implication
 * cannot be forgotten by the next caller that sets `leagueType`.
 *
 * ⚠ DERIVED STRICTLY FROM THE NEW TYPE, NOT MERGED WITH THE OLD. If a league moves from
 * guillotine to redraft, `guillotineMode` must go false — carrying it forward "to be
 * safe" would leave a redraft league running elimination rules. The one thing that IS
 * preserved is `aliasTags`, because those describe flavor the lifecycle does not encode
 * (an IDP dynasty is still IDP after a switch to keeper) and they are imported, not
 * chosen here.
 */

export type LeagueTypeDerivedState = {
  /** Canonical format id from `normalizeConceptToFormat`. */
  formatId: string
  isDynasty: boolean
  guillotineMode: boolean
  survivorMode: boolean
  bestBallMode: boolean
  /** Alias tags implied by the chosen type (empty for the base lifecycles). */
  aliasTags: string[]
}

/**
 * Formats whose assets are valued on a DYNASTY market board rather than a redraft one.
 *
 * ⚠ KEEPER IS DELIBERATELY ABSENT. A keeper league drafts most of its roster every year;
 * its assets price off the redraft board and then take a keeper-cost adjustment. Folding
 * it in here would swap the whole board for every keeper league — a much larger and
 * wronger change than the one this module is making. Production agrees: the single
 * keeper league carries `isDynasty=false`.
 */
const DYNASTY_LIFECYCLE = new Set(['dynasty', 'devy', 'c2c'])

export function deriveLeagueTypeState(
  leagueType: string | null | undefined,
): LeagueTypeDerivedState | null {
  const normalized = normalizeConceptToFormat(leagueType)
  if (!normalized) return null

  const { formatId, aliasTags } = normalized
  return {
    formatId,
    isDynasty: DYNASTY_LIFECYCLE.has(formatId),
    guillotineMode: formatId === 'guillotine',
    survivorMode: formatId === 'survivor',
    bestBallMode: formatId === 'best_ball',
    aliasTags,
  }
}

/** Provenance stamp: a human chose this, and when. Mirrors `keeperProvenance`. */
export type LeagueTypeProvenance = {
  at: string
  source: 'commissioner'
  version: 1
  leagueType: string
  formatId: string
}

/**
 * Read-modify-write of `settings` for a league-type change.
 *
 * Returns the FULL next settings object — the caller writes it wholesale, matching the
 * keeperProvenance / sportConfig blocks alongside it. Unknown keys anywhere in the tree
 * are carried through untouched; this function adds and never prunes, because `settings`
 * is a shared blob and an importer's key is not ours to drop.
 */
export function mergeSettingsForLeagueType(
  prevSettings: Record<string, unknown> | null | undefined,
  derived: LeagueTypeDerivedState,
  leagueType: string,
  now: Date = new Date(),
): Record<string, unknown> {
  const prev = prevSettings ?? {}

  const prevConcept =
    prev.conceptRules && typeof prev.conceptRules === 'object' && !Array.isArray(prev.conceptRules)
      ? (prev.conceptRules as Record<string, unknown>)
      : {}

  const prevExt =
    prevConcept.extensions &&
    typeof prevConcept.extensions === 'object' &&
    !Array.isArray(prevConcept.extensions)
      ? (prevConcept.extensions as Record<string, unknown>)
      : {}

  const prevTags = Array.isArray(prevExt.aliasTags)
    ? (prevExt.aliasTags as unknown[]).map((t) => String(t))
    : []

  // Union, order-stable: imported flavor first, then anything the new type implies.
  const aliasTags = [...prevTags]
  for (const tag of derived.aliasTags) {
    if (!aliasTags.includes(tag)) aliasTags.push(tag)
  }

  const provenance: LeagueTypeProvenance = {
    at: now.toISOString(),
    source: 'commissioner',
    version: 1,
    leagueType,
    formatId: derived.formatId,
  }

  return {
    ...prev,
    conceptRules: {
      ...prevConcept,
      concept: derived.formatId,
      version: typeof prevConcept.version === 'number' ? prevConcept.version : 1,
      extensions: {
        ...prevExt,
        aliasTags,
        leagueTypeProvenance: provenance,
      },
    },
  }
}

/** The league-row columns a type change implies. Exported for the patch handler and tests. */
export function leagueColumnsForType(derived: LeagueTypeDerivedState): {
  isDynasty: boolean
  guillotineMode: boolean
  survivorMode: boolean
  bestBallMode: boolean
} {
  return {
    isDynasty: derived.isDynasty,
    guillotineMode: derived.guillotineMode,
    survivorMode: derived.survivorMode,
    bestBallMode: derived.bestBallMode,
  }
}
