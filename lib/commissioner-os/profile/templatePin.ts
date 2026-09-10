/**
 * The one place that knows where a league's Commissioner OS template pin is stored.
 *
 * Path: `settings.conceptRules.extensions.commissionerTemplate = { id, version }`.
 *
 * ⚠ WRITTEN THIS WAY BECAUSE `conceptRules.extensions` IS ALREADY THE DOCUMENTED EXTENSION POINT —
 * `ConceptRulesSlice.extensions` in `lib/league-contract/types.ts` exists for exactly this, and
 * `readConceptAliasTags` already reads its sibling `aliasTags` from the same object. Adding a
 * top-level `settings.commissionerTemplate` key would put a second convention beside an established
 * one, and `validateConceptRulesShape` already guards this object's shape for the automation
 * pipeline.
 *
 * 🛑 NO SCHEMA MIGRATION IS NEEDED FOR TEMPLATE PINNING AND ONE SHOULD NOT BE ADDED YET.
 * `League.settings` is `Json?` and `settingsSnapshotVersion` already versions it. A dedicated column
 * would be a migration — which is a separate deploy decision belonging to the user, not something to
 * take on a foundation phase's say-so — for a field nothing writes yet.
 *
 * ⚠ AND THE PATH TRAP IS REAL, NOT HYPOTHETICAL. The sibling reader's header records a census that
 * asked `settings->'conceptRules'->'aliasTags'` and got null for all 271 production leagues — a
 * plausible answer, and false, because the writer puts them one level deeper under `extensions`.
 * Wrong path, no error. This reader checks `extensions` first and the flat level as a fallback for
 * the same reason that one does.
 *
 * Pure: settings in, pin out. Never throws on malformed JSON — an unreadable league has no pin,
 * which is the same answer as a league that was never pinned.
 */

export type CommissionerTemplatePin = {
  id: string
  version: string
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

/**
 * The template pin stored on a league, or null.
 *
 * ⚠ A PIN WITH A MISSING OR NON-STRING `version` IS NO PIN AT ALL, NOT A PIN AT "LATEST". Returning
 * `{ id, version: undefined }` would invite a caller to fill the gap from the registry, which is the
 * silent-upgrade failure `resolveTemplate` refuses to allow. Both halves or nothing.
 */
export function readCommissionerTemplatePin(settings: unknown): CommissionerTemplatePin | null {
  const s = asRecord(settings)
  if (!s) return null
  const cr = asRecord(s.conceptRules)
  if (!cr) return null
  const ext = asRecord(cr.extensions)

  const raw = asRecord(ext?.commissionerTemplate ?? cr.commissionerTemplate)
  if (!raw) return null

  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  const version = typeof raw.version === 'string' ? raw.version.trim() : ''
  if (!id || !version) return null

  return { id, version }
}

/**
 * The settings fragment to merge when pinning a league to a template.
 *
 * Returned rather than written: this module stays pure, and the caller that owns the settings write
 * is the one that must decide how to merge it with everything else already in `extensions`.
 */
export function buildCommissionerTemplatePinFragment(pin: CommissionerTemplatePin): {
  conceptRules: { extensions: { commissionerTemplate: CommissionerTemplatePin } }
} {
  return {
    conceptRules: { extensions: { commissionerTemplate: { id: pin.id, version: pin.version } } },
  }
}
