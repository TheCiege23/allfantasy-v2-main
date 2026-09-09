/**
 * The one place that knows where a league's keeper-configuration provenance is
 * stored, and the only thing that decides whether keeper settings are confirmed.
 *
 * 🛑 WHY THIS EXISTS. `League.keeperCount @default(3)`,
 * `keeperCostSystem @default("round_based")` and `keeperRoundPenalty @default(1)`
 * mean every row carries a keeper policy whether or not anyone chose one. Reading
 * the columns cannot tell "the commissioner picked three" from "nobody picked
 * anything", so the fact that somebody DECIDED has to be recorded separately at
 * the moment of decision. That is what this block is.
 *
 * 🛑 AND `max_keepers` IS NOT THE EVIDENCE, THOUGH IT LOOKS LIKE IT.
 * `lib/league-import/types.ts` records the measurement: Sleeper's `max_keepers`
 * is >= 1 on 225/225 imported leagues — dynasty, redraft, guillotine and
 * survivor alike — so its PRESENCE discriminates nothing. Sleeper's
 * `settings.type` (0 redraft / 1 keeper / 2 dynasty) is the only provider signal
 * that does, and it reaches us as `is_keeper` on the normalized league. A
 * provenance derived from "the payload contained a keeper field" would therefore
 * mark all 225 confirmed and reinstate the exact bug this replaces.
 *
 * Stored at `settings.conceptRules.extensions.keeperProvenance`, alongside
 * `aliasTags` — see `conceptAliasTags.ts` for why that path and not the obvious
 * one. Versioned so a later shape change is detectable rather than silent.
 */

/** Current provenance schema version. Bump when the shape changes. */
export const KEEPER_PROVENANCE_VERSION = 1 as const

export type KeeperProvenanceSource =
  /** The provider's own league-type signal (Sleeper `settings.type`). */
  | 'provider'
  /** A commissioner submitted a keeper field in a settings save. */
  | 'commissioner'
  /** An AllFantasy league was created with an explicit keeper concept. */
  | 'creation'

export type KeeperProvenance = {
  version: number
  source: KeeperProvenanceSource
  /**
   * Whether the established configuration IS a keeper league.
   *
   * ⚠ `false` IS A REAL ANSWER, NOT AN ABSENCE. "The provider told us this is a
   * redraft league" is stronger information than "we never asked", and it must
   * outrank the differs-from-default heuristic — otherwise a Sleeper redraft
   * league that happens to carry `keeperCount: 5` is reclassified against the
   * provider's own statement.
   */
  isKeeper: boolean
  /** ISO timestamp of the decision. Diagnostic only; nothing branches on it. */
  at: string
  /**
   * Whether the provider supplied a keeper COUNT. Recorded for diagnostics and
   * deliberately NOT used as evidence — see the header.
   */
  providerSuppliedMaxKeepers?: boolean
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

/**
 * Read the provenance block out of a league's `settings` JSON.
 *
 * Returns null for absent, malformed, unreadable, or a version this build does
 * not understand. Never throws: a league whose settings are unreadable has no
 * provenance, which is the same answer as a league that has none.
 */
export function readKeeperProvenance(settings: unknown): KeeperProvenance | null {
  const s = asRecord(settings)
  if (!s) return null
  const cr = asRecord(s.conceptRules)
  if (!cr) return null
  const ext = asRecord(cr.extensions)
  const raw = asRecord(ext?.keeperProvenance ?? cr.keeperProvenance)
  if (!raw) return null

  /*
   * ⚠ AN UNKNOWN VERSION IS TREATED AS NO PROVENANCE, NOT AS A BEST GUESS. A
   * future writer that changes the meaning of `isKeeper` would otherwise be
   * read under this build's assumptions and silently misclassify.
   */
  if (raw.version !== KEEPER_PROVENANCE_VERSION) return null
  if (typeof raw.isKeeper !== 'boolean') return null

  const source = raw.source
  if (source !== 'provider' && source !== 'commissioner' && source !== 'creation') return null

  return {
    version: KEEPER_PROVENANCE_VERSION,
    source,
    isKeeper: raw.isKeeper,
    at: typeof raw.at === 'string' ? raw.at : '',
    ...(typeof raw.providerSuppliedMaxKeepers === 'boolean'
      ? { providerSuppliedMaxKeepers: raw.providerSuppliedMaxKeepers }
      : {}),
  }
}

/**
 * The value to pass as `keeperSettingsConfirmed` to `readFormatRules`.
 *
 * Three-valued, and the third is the point:
 *   `true`      somebody established that this IS a keeper league
 *   `false`     somebody established that it is NOT — suppresses classification
 *   `undefined` nobody established anything; fall through to the heuristic
 *
 * ⚠ `undefined` IS NOT `false`. Returning `false` for an absent block would tell
 * the classifier "confirmed not a keeper league" about a league nobody has ever
 * looked at, which would suppress the `configured_value` heuristic that is the
 * only signal an older row has.
 */
export function keeperSettingsConfirmedFrom(settings: unknown): boolean | undefined {
  const p = readKeeperProvenance(settings)
  return p ? p.isKeeper : undefined
}

/** Build a provenance block for writing. Pure; the caller persists it. */
export function buildKeeperProvenance(input: {
  source: KeeperProvenanceSource
  isKeeper: boolean
  providerSuppliedMaxKeepers?: boolean
  now?: Date
}): KeeperProvenance {
  return {
    version: KEEPER_PROVENANCE_VERSION,
    source: input.source,
    isKeeper: input.isKeeper,
    at: (input.now ?? new Date()).toISOString(),
    ...(typeof input.providerSuppliedMaxKeepers === 'boolean'
      ? { providerSuppliedMaxKeepers: input.providerSuppliedMaxKeepers }
      : {}),
  }
}

/** The keeper fields a commissioner save can carry. Submitting any is evidence. */
export const COMMISSIONER_KEEPER_KEYS: readonly string[] = [
  'keeperCount',
  'keeperCostSystem',
  'keeperMaxYears',
  'keeperWaiverAllowed',
  'keeperEligibilityRule',
  'keeperMinRoundsHeld',
  'keeperRoundPenalty',
  'keeperInflationRate',
  'keeperAuctionPctIncrease',
  'keeperSelectionDeadline',
  'keeperPhaseActive',
  'keeperConflictRule',
  'keeperMissedDeadlineRule',
]

/**
 * Provenance implied by a commissioner settings save, or null when the save
 * touched no keeper field.
 *
 * 🛑 SUBMITTING THE FIELD IS THE EVIDENCE, NOT CHANGING ITS VALUE. A
 * commissioner who opens the settings form and saves `keeperCount: 3` unchanged
 * has confirmed it — that is exactly the case the column default cannot express,
 * and it is why this reads the SUBMITTED KEYS rather than comparing values.
 *
 * ⚠ `keeperCount: 0` SUBMITTED MEANS CONFIRMED-NOT-KEEPER. It is a decision, and
 * recording it as `isKeeper: false` is what stops the differs-from-default
 * heuristic later reading that same 0 as evidence of a keeper league.
 */
export function keeperProvenanceFromCommissionerSave(args: {
  submittedKeys: readonly string[]
  body: Record<string, unknown>
  now?: Date
}): KeeperProvenance | null {
  const touched = args.submittedKeys.filter((k) => COMMISSIONER_KEEPER_KEYS.includes(k))
  if (touched.length === 0) return null

  /*
   * If the save names a count, that count decides. If it names only other
   * keeper fields (a cost system, a deadline), configuring them at all is a
   * statement that this league has keepers.
   */
  const rawCount = args.body.keeperCount
  const count = typeof rawCount === 'number' ? rawCount : null
  const isKeeper = count === null ? true : count > 0

  return buildKeeperProvenance({ source: 'commissioner', isKeeper, now: args.now })
}
