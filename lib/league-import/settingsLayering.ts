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
     * WRONG WIPES REAL USER CUSTOMISATION ON THE FIRST REFRESH AFTER DEPLOY.
     *
     * Today `visualTheme` sits as a bare top-level key with no record of who put it there —
     * the importer, or a manager who changed it. With no layers, resolution would fall
     * straight through to the provider value and overwrite the manager's choice, once,
     * irreversibly. So the value is adopted into a layer BEFORE anything resolves:
     *
     *   equals what the provider now reports  → it was provider-derived  → source layer
     *   differs from the provider             → somebody changed it      → override layer
     *
     * ⚠ THE TIE-BREAK LEANS TOWARDS THE OVERRIDE ON PURPOSE. Misfiling a provider value as
     * an override freezes branding until the user clears it — visible, reversible, annoying.
     * Misfiling a user's choice as a provider value destroys it. Those are not symmetric,
     * and the asymmetry decides the default.
     */
    const alreadyLayered =
      Object.prototype.hasOwnProperty.call(overrides, key) ||
      Object.prototype.hasOwnProperty.call(sourceValues, key)

    if (!alreadyLayered && Object.prototype.hasOwnProperty.call(existingSettings, key)) {
      const existingValue = existingSettings[key] ?? null
      const providerValue = Object.prototype.hasOwnProperty.call(freshSourceValues, key)
        ? (freshSourceValues[key] ?? null)
        : undefined
      const matchesProvider =
        providerValue !== undefined && JSON.stringify(existingValue) === JSON.stringify(providerValue)
      if (matchesProvider) {
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
 * ⚠ KEY ORDER MUST NOT MOVE THE HASH. `JSON.stringify` preserves insertion order, and these
 * objects are rebuilt from provider payloads whose key order is not guaranteed — so an
 * unsorted hash would report a rules change on a refresh that changed nothing, which is
 * exactly the constant-recompute failure it exists to prevent.
 */
export function canonicalSettingsHash(input: unknown): string {
  const json = stableStringify(input)
  /* FNV-1a, 32-bit. Not cryptographic — this detects change, it does not resist an adversary. */
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
export function effectiveRulesVersion(input: EffectiveRulesInput): string {
  return canonicalSettingsHash({
    scoringSettings: input.scoringSettings ?? null,
    rosterSettings: input.rosterSettings ?? null,
    waiverSettings: input.waiverSettings ?? null,
    playoffSettings: input.playoffSettings ?? null,
    draftSettings: input.draftSettings ?? null,
    conceptRules: input.conceptRules ?? null,
  })
}
