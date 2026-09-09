/**
 * Provider state, user overrides, and the effective-settings version — IMP-02.
 *
 * ── WHY LAYERING, RATHER THAN "DO NOT REFRESH THAT KEY" ──────────────────────────────
 *
 * The first pass of this batch protected a user's customisation by simply NOT republishing
 * `visualTheme` and `mediaSettings`. That works exactly once. It cannot answer what happens
 * when the provider's own branding changes and the user never touched it (the app keeps
 * stale branding forever), and it cannot answer what happens when the user clears their
 * choice (there is nothing to fall back to, because the provider's value was never stored).
 *
 * 🛑 THE REAL PROBLEM IS THAT ONE FIELD WAS HOLDING TWO DIFFERENT FACTS. "What the provider
 * says" and "what the user chose" are independent, and squashing them into one slot means
 * every write has to pick a winner and destroy the loser. Storing them separately and
 * RESOLVING at read time makes all four behaviours fall out for free:
 *
 *     user/commissioner override  >  current provider source  >  catalog/default
 *
 *   - provider value changes, no override  → the provider layer updates, resolution follows
 *   - provider refreshes, override present  → the override still wins, untouched
 *   - override cleared                      → the provider layer is revealed, already current
 *   - source stops reporting the field      → the override survives; it was never derived
 */

/** Where a resolved value came from. Carried so a UI can say "from your league" honestly. */
import { createHash } from 'node:crypto'

export type SettingsLayer = 'override' | 'source' | 'default'

export interface LayeredValue<T> {
  value: T | null
  layer: SettingsLayer
}

/**
 * Keys whose value belongs to the USER, not to the host league.
 *
 * ⚠ THIS IS A LIST OF THINGS THE SOURCE HAS NO OPINION ABOUT, not a list of things that are
 * awkward to refresh. A key belongs here only when the host platform cannot represent it, or
 * when AllFantasy deliberately lets a manager correct it. Adding a SOURCE-owned key here —
 * scoring, roster shape, playoff structure — would silently freeze a real league setting,
 * which is the IMP-02 defect wearing different clothes.
 */
export const USER_OWNED_SETTINGS_KEYS = ['visualTheme', 'mediaSettings'] as const

/** Where a user's explicit choices live inside `League.settings`. */
export const OVERRIDES_KEY = 'userOverrides' as const

/** Where the provider's own current values live inside `League.settings`. */
export const SOURCE_KEY = 'sourceValues' as const

/**
 * Where explicit provenance for user-owned keys is recorded.
 *
 * A writer that KNOWS it produced a value (the importer writing provider branding) records the
 * key here, and first-adoption can then file it into the source layer with evidence rather than
 * by inference. Absent means unknown, and unknown is treated as the user's.
 */
export const PROVENANCE_KEY = 'settingsProvenance' as const

/** Provenance value meaning "this key's current value came from the provider import". */
export const PROVIDER_PROVENANCE = 'source' as const

/**
 * Does the league record explicitly say the provider owns this key's current value?
 *
 * ⚠ ONLY AN EXPLICIT RECORD COUNTS. Inferring ownership from equality with the provider's
 * current value is the unsound step this exists to replace — a user may have chosen exactly
 * that value, and no comparison can tell the two apart.
 */
export function hasProviderProvenance(settings: Record<string, unknown>, key: string): boolean {
  const raw = settings[PROVENANCE_KEY]
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
  return (raw as Record<string, unknown>)[key] === PROVIDER_PROVENANCE
}

export function readOverrides(settings: Record<string, unknown>): Record<string, unknown> {
  const raw = settings[OVERRIDES_KEY]
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {}
}

export function readSourceValues(settings: Record<string, unknown>): Record<string, unknown> {
  const raw = settings[SOURCE_KEY]
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {}
}

/**
 * Resolve one key through the precedence chain.
 *
 * ⚠ `null` IS A DELIBERATE OVERRIDE AND MUST NOT FALL THROUGH. A user who clears a value has
 * expressed a preference; treating that as "unset" and revealing the provider's value would
 * make the choice un-makeable. Only an ABSENT key falls through — hence `hasOwnProperty`
 * rather than a truthiness test.
 */
export function resolveLayered<T = unknown>(
  key: string,
  overrides: Record<string, unknown>,
  sourceValues: Record<string, unknown>,
  fallback: T | null = null,
): LayeredValue<T> {
  if (Object.prototype.hasOwnProperty.call(overrides, key)) {
    return { value: (overrides[key] as T) ?? null, layer: 'override' }
  }
  if (Object.prototype.hasOwnProperty.call(sourceValues, key)) {
    return { value: (sourceValues[key] as T) ?? null, layer: 'source' }
  }
  return { value: fallback, layer: 'default' }
}

/**
 * Apply the layering for the user-owned keys and write both the resolved value and the layers.
 *
 * The resolved value is written to the key's ORIGINAL top-level name so every existing reader
 * keeps working untouched; the layers live beside it. That is what makes this migration-free
 * and adoptable one consumer at a time.
 */
export function applyUserOwnedLayering(
  merged: Record<string, unknown>,
  existingSettings: Record<string, unknown>,
  freshSourceValues: Record<string, unknown>,
): Record<string, unknown> {
  const overrides = readOverrides(existingSettings)
  const sourceValues = { ...readSourceValues(existingSettings) }

  for (const key of USER_OWNED_SETTINGS_KEYS) {
    /*
     * 🛑 FIRST-ADOPTION: EVERY LEAGUE THAT ALREADY EXISTS IS UNLAYERED, AND GETTING THIS
     * WRONG DESTROYS REAL USER CUSTOMISATION ON THE FIRST REFRESH AFTER DEPLOY.
     *
     * `visualTheme` sits today as a bare top-level key with no record of who put it there —
     * the importer, or a manager who changed it. With no layers, resolution falls straight
     * through to the provider value and overwrites the manager's choice, once, irreversibly.
     *
     * 🛑 AND EQUALITY WITH THE PROVIDER IS NOT PROOF OF PROVIDER OWNERSHIP. An earlier version
     * filed a value into the source layer when it matched what the provider currently reports.
     * That inference is unsound in the one direction that costs data: a manager may have
     * deliberately CHOSEN the value the provider happens to serve — picked the same accent,
     * kept the league logo on purpose — and equality cannot distinguish that from a value the
     * importer wrote. Treating it as provider-owned silently converts a deliberate choice into
     * something the next provider change overwrites.
     *
     * So the rule is loss-minimizing rather than clever:
     *
     *   explicit provenance proving provider ownership  → source layer
     *   no provenance                                    → preserve as a user override
     *
     * Freezing a provider value is recoverable — the user clears the override and the current
     * provider value is revealed, which is tested. Destroying a user choice is not recoverable
     * at all. Those costs are not symmetric, so the ambiguous case takes the recoverable side.
     */
    const alreadyLayered =
      Object.prototype.hasOwnProperty.call(overrides, key) ||
      Object.prototype.hasOwnProperty.call(sourceValues, key)

    if (!alreadyLayered && Object.prototype.hasOwnProperty.call(existingSettings, key)) {
      const existingValue = existingSettings[key] ?? null
      if (hasProviderProvenance(existingSettings, key)) {
        sourceValues[key] = existingValue
      } else if (existingValue !== null) {
        overrides[key] = existingValue
      }
    }

    /* The provider layer always tracks the source — that is the point of storing it apart. */
    if (Object.prototype.hasOwnProperty.call(freshSourceValues, key)) {
      sourceValues[key] = freshSourceValues[key] ?? null
    }
    const resolved = resolveLayered(key, overrides, sourceValues, null)
    if (resolved.value === null && resolved.layer === 'default') {
      delete merged[key]
    } else {
      merged[key] = resolved.value
    }
  }

  merged[OVERRIDES_KEY] = overrides
  merged[SOURCE_KEY] = sourceValues

  /*
   * Record provenance for every key the PROVIDER currently owns, so a future adoption has
   * evidence instead of an inference. Once a key is layered this is belt-and-braces, but it
   * also means a league whose layers are ever rebuilt from scratch does not fall back to
   * guessing — the same reason the layers exist at all.
   */
  const provenance: Record<string, unknown> = {
    ...(typeof merged[PROVENANCE_KEY] === 'object' && merged[PROVENANCE_KEY] !== null && !Array.isArray(merged[PROVENANCE_KEY])
      ? (merged[PROVENANCE_KEY] as Record<string, unknown>)
      : {}),
  }
  for (const key of USER_OWNED_SETTINGS_KEYS) {
    const isOverridden = Object.prototype.hasOwnProperty.call(overrides, key)
    if (!isOverridden && Object.prototype.hasOwnProperty.call(sourceValues, key)) {
      provenance[key] = PROVIDER_PROVENANCE
    } else if (isOverridden) {
      /* The user owns it now; a stale provider claim must not outlive that. */
      delete provenance[key]
    }
  }
  merged[PROVENANCE_KEY] = provenance

  return merged
}

/**
 * A deterministic content hash of the EFFECTIVE rules — the invalidation signal.
 *
 * 🛑 `republishedAt` WAS NOT USABLE AND THIS REPLACES IT. A timestamp changes on every
 * refresh, so a consumer keying off it either recomputes constantly (on a 30-minute tick,
 * across every league) or ignores it — and every consumer ignored it. A CONTENT hash changes
 * only when the rules actually change, which is the property a cache key needs.
 *
 * 🛑 AND IT IS SHA-256, NOT FNV-1a. The first implementation used 32-bit FNV-1a, which is a
 * fine bucket function and an unfit cache key. At 32 bits a collision is findable by brute
 * force in seconds — and a collision here does not present as a bug. It presents as "the
 * rules did not change", so stale projections keep serving with nothing red anywhere. This
 * key decides whether derived artifacts are recomputed; being wrong is silent, and SHA-256
 * costs microseconds on a path that already touches Postgres.
 *
 * ⚠ KEY ORDER MUST NOT MOVE THE HASH. `JSON.stringify` preserves insertion order, and these
 * objects are rebuilt from provider payloads whose key order is not guaranteed — so an
 * unsorted hash would report a rules change on a refresh that changed nothing, which is
 * exactly the constant-recompute failure it exists to prevent.
 */
export function canonicalSettingsHash(input: unknown): string {
  return createHash('sha256').update(stableStringify(input), 'utf8').digest('hex')
}

/**
 * The removed 32-bit FNV-1a, retained ONLY so the regression suite can demonstrate a real
 * collision against it.
 *
 * ⚠ NOT FOR PRODUCTION USE — nothing outside that test may call it. It exists so the claim
 * "32 bits is unfit for this key" is a measured fact in this repository rather than an
 * appeal to general knowledge about hash functions.
 */
export function __fnv1aForCollisionTestOnly(json: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null'
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`
  const keys = Object.keys(v as Record<string, unknown>).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`).join(',')}}`
}

/** The slices whose change must invalidate a derived artifact. */
export interface EffectiveRulesInput {
  scoringSettings?: unknown
  rosterSettings?: unknown
  waiverSettings?: unknown
  playoffSettings?: unknown
  draftSettings?: unknown
  conceptRules?: unknown
}

/**
 * Hash only the SOURCE-DERIVED slices.
 *
 * ⚠ USER-OWNED KEYS ARE DELIBERATELY EXCLUDED. A manager picking a new banner must not
 * invalidate every cached projection in the league — the artifacts depend on the rules, not
 * on the theme, and including them would make the hash a change-detector for the wrong thing.
 */
function effectiveRulesPayload(input: EffectiveRulesInput): Record<string, unknown> {
  return {
    scoringSettings: input.scoringSettings ?? null,
    rosterSettings: input.rosterSettings ?? null,
    waiverSettings: input.waiverSettings ?? null,
    playoffSettings: input.playoffSettings ?? null,
    draftSettings: input.draftSettings ?? null,
    conceptRules: input.conceptRules ?? null,
  }
}

export function effectiveRulesVersion(input: EffectiveRulesInput): string {
  return canonicalSettingsHash(effectiveRulesPayload(input))
}

/**
 * The exact serialization the hash is taken over.
 *
 * Exposed so a test can prove that import publication and Decision OS canonicalise the SAME
 * contract — comparing hashes alone would pass even if both sides were consistently wrong.
 */
export function canonicalRulesSerialization(input: EffectiveRulesInput): string {
  return stableStringify(effectiveRulesPayload(input))
}
