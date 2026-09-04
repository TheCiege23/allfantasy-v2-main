/**
 * The one place that knows where a league's concept alias tags are stored.
 *
 * 🛑 THE PATH IS `conceptRules.extensions.aliasTags`, AND THE OBVIOUS PATH IS WRONG. A census on
 * 2026-09-03 asked `settings->'conceptRules'->'aliasTags'` and got null for all 271 production
 * leagues. That is a real-looking answer — "no league carries an alias tag" — and it is false:
 * 183 of 271 carry `['idp']`, one level deeper under `extensions`. Wrong path, plausible value, no
 * error, which is the failure shape this repo keeps paying for.
 *
 * `buildConceptRulesBlock` in `lib/league-import/canonicalImportNormalizer.ts` is the writer and is
 * the authority on the shape. This reader exists so that no caller has to rediscover it, and so a
 * future move has one site to update rather than several that silently disagree.
 *
 * ⚠ WHAT THESE TAGS MEAN IS NOT UNIFORM, AND CALLERS MUST NOT ASSUME. The list mixes format
 * flavours (`pirate_vampire`, `royal`, `king_of_the_hill` — where the alias IS the real format,
 * flattened onto a base shell by `normalizeConcept.ts`) with scoring modifiers (`idp`, which can
 * sit on any format). `readFormatRules` in `lib/trade-intel/leagueFormatRules.ts` holds the
 * classification and is the only thing that should decide which kind a tag is.
 *
 * Pure: settings in, tags out. Never throws on malformed JSON — a league whose settings are
 * unreadable has no alias tags, which is the same answer as a league that has none.
 */

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

/**
 * Alias tags for a league, read from its `settings` JSON.
 *
 * Returns `[]` for absent, malformed, or empty — deliberately not null. An empty list and "no tags"
 * are the same fact here, and `readFormatRules` treats them identically, so distinguishing them
 * would offer callers a difference that carries no meaning.
 */
export function readConceptAliasTags(settings: unknown): string[] {
  const s = asRecord(settings)
  if (!s) return []
  const cr = asRecord(s.conceptRules)
  if (!cr) return []
  const ext = asRecord(cr.extensions)

  /*
   * `extensions` first because that is where the writer puts them. The top level is checked as a
   * fallback rather than as an alternative: nothing writes it today, but reading it costs one
   * property access and means a future writer that flattens the shape does not silently produce
   * leagues with no tags.
   */
  const raw = (ext?.aliasTags ?? cr.aliasTags) as unknown
  if (!Array.isArray(raw)) return []

  const out: string[] = []
  for (const t of raw) {
    if (typeof t !== 'string') continue
    const trimmed = t.trim().toLowerCase()
    if (trimmed) out.push(trimmed)
  }
  return out
}
