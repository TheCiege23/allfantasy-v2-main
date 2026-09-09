/**
 * The authoritative imported scoring representation — IMP-03 / IMP-05.
 *
 * 🛑 TWO REPRESENTATIONS OF ONE RULE SET IS THE BUG, NOT THE MITIGATION. The first pass of
 * this batch added a typed `rulesDetail` list ALONGSIDE the legacy flat
 * `Record<stat_key, points>` map and left both writable. This repo has already paid for that
 * shape once — a SQL copy of `normalizePlayerName` disagreeing with the JS original on 7.2%
 * of rows — and the lesson recorded there is that deleting one implementation is the fix,
 * never making the second one better.
 *
 * So: `rulesDetail` is the contract. The flat map still exists because ~existing readers
 * consume it, but it is now a PROJECTION generated from `rulesDetail` by `projectLegacyMap`
 * below, and nothing else may build or mutate it. When the last reader is migrated, the
 * projection is deleted and nothing else has to change.
 *
 * ⚠ THE PROJECTION IS LOSSY BY CONSTRUCTION, AND THAT IS THE POINT OF NAMING IT. A flat
 * `key -> number` cannot express a range, a threshold, a unit, a rounding mode, or which
 * positions a rule applies to. `describeProjectionLoss` reports exactly what a given rule set
 * loses on the way through, so a caller can decide rather than discover.
 */

import type { LeagueSport } from '@prisma/client'

/** Bumped when the SHAPE of a rule changes, so a stored snapshot can be re-read safely. */
export const SCORING_RULE_CONTRACT_VERSION = 1 as const

/**
 * How a league converts events into standings.
 *
 * ⚠ `category` AND `roto` ARE NOT POINTS SCORING WEARING A HAT. A category league ranks teams
 * per statistical category; a roto league sums those ranks. Flattening either into
 * `points_value` produces a number that is arithmetically fine and semantically meaningless.
 * Full execution for both belongs to the provider/sport batch — but the MODE must survive
 * import now, or the batch that implements them will be working from data that has already
 * been mislabelled as ordinary points scoring.
 */
export type ScoringMode = 'points' | 'category' | 'roto' | 'unknown'

/** Where a mapping came from, so a later improvement can replay existing imports. */
export type RuleProvenance =
  /** Read directly from the provider's own rules endpoint. */
  | 'source'
  /** Derived from a provider field that implies it. */
  | 'derived'
  /** Filled from a template because the source said nothing. */
  | 'default'

export type RuleResolution =
  /** Mapped to a canonical stat we can score. */
  | 'resolved'
  /** Carried verbatim; we do not yet know what canonical stat this is. */
  | 'unresolved'

export interface ImportedScoringRule {
  /** Provider's own stat identifier, un-translated. The join key back to the source. */
  nativeStatId: string
  /**
   * Our canonical stat name — ONLY when verified.
   *
   * 🛑 NULL IS A REAL ANSWER AND MUST NOT BE GUESSED. An unresolved rule that gets a
   * plausible-looking canonical name becomes an exact-looking valuation built on a guess,
   * which is worse than a visible gap: nothing downstream can tell it was invented.
   */
  canonicalStat: string | null
  pointsValue: number
  /** Empty means the rule applies to every position. */
  positions: string[]
  sport: LeagueSport | string
  mode: ScoringMode
  provenance: RuleProvenance
  resolution: RuleResolution
  /** Why it is unresolved — free text for an operator, never parsed. */
  unresolvedReason?: string | null

  /*
   * Fields the providers express and this pipeline does not yet READ. They are declared so
   * the contract does not have to change shape when support lands, and they are NULLABLE so
   * their absence is honest rather than a zero that scores as real.
   *
   * ⚠ DO NOT POPULATE THESE BY INFERENCE. A `null` here means "not supported yet"; a wrong
   * number here silently reprices a league.
   */
  /** e.g. yardage bands — `{ min: 0, max: 9 }`. */
  range?: { min: number | null; max: number | null } | null
  /** Minimum event count before the rule pays. */
  threshold?: number | null
  /** e.g. `yards`, `receptions`, `attempts`. */
  unit?: string | null
  /** e.g. `nearest`, `down`, `none`. */
  rounding?: string | null
  /** Per-unit multiplier where the source expresses one separately from the points value. */
  multiplier?: number | null
}

export interface ImportedScoringContract {
  version: typeof SCORING_RULE_CONTRACT_VERSION
  sport: LeagueSport | string
  /** The league's overall mode, rolled up from its rules. */
  mode: ScoringMode
  /** Format string as the source described it — never invented. */
  sourceFormat: string | null
  /** Descriptive only. A preset is a LABEL for a rule set, never the source of truth. */
  presetId: string | null
  /** True when `presetId` was guessed rather than read. */
  presetInferred: boolean
  rules: ImportedScoringRule[]
}

/** Key a rule takes in the legacy flat map. Position-qualified rules cannot share one. */
export function legacyMapKeyFor(rule: Pick<ImportedScoringRule, 'nativeStatId' | 'positions'>): string[] {
  if (rule.positions.length === 0) return [rule.nativeStatId]
  return rule.positions.map((p) => `${rule.nativeStatId}@${p}`)
}

/**
 * Generate the legacy flat map from the authoritative contract.
 *
 * 🛑 THIS IS THE ONLY FUNCTION PERMITTED TO BUILD THAT MAP. If you find yourself writing
 * `scoringRules[k] = v` anywhere else, the rule you are adding belongs in `rules` instead.
 *
 * ⚠ A DUPLICATE QUALIFIED KEY IS REPORTED, NEVER SILENTLY OVERWRITTEN. Last-write-wins on
 * `rec` is the exact defect that priced every RB and WR at the TE rate; a collision that
 * survives into the projection is returned so the caller can warn rather than absorb it.
 */
export function projectLegacyMap(contract: ImportedScoringContract): {
  map: Record<string, number>
  collisions: string[]
} {
  const map: Record<string, number> = {}
  const collisions: string[] = []
  for (const rule of contract.rules) {
    for (const key of legacyMapKeyFor(rule)) {
      if (Object.prototype.hasOwnProperty.call(map, key) && map[key] !== rule.pointsValue) {
        collisions.push(key)
      }
      map[key] = rule.pointsValue
    }
  }
  return { map, collisions }
}

/**
 * What the flat map cannot carry for this particular rule set.
 *
 * Returned rather than logged so the caller can surface it as an import warning — the loss is
 * a property of the LEAGUE, not of the code, and only the league's owner can judge it.
 */
export function describeProjectionLoss(contract: ImportedScoringContract): string[] {
  const loss: string[] = []
  if (contract.mode === 'category' || contract.mode === 'roto') {
    loss.push(
      `League scores by ${contract.mode}; the compatibility map expresses points only and cannot represent it.`,
    )
  }
  if (contract.rules.some((r) => r.range != null)) loss.push('Range-banded rules are flattened to a single value.')
  if (contract.rules.some((r) => r.threshold != null)) loss.push('Rule thresholds are not represented.')
  if (contract.rules.some((r) => r.rounding != null)) loss.push('Rounding modes are not represented.')
  if (contract.rules.some((r) => r.multiplier != null)) loss.push('Separate multipliers are folded into the points value.')
  const unresolved = contract.rules.filter((r) => r.resolution === 'unresolved')
  if (unresolved.length > 0) {
    loss.push(
      `${unresolved.length} rule(s) could not be mapped to a canonical stat and are carried verbatim.`,
    )
  }
  return loss
}
