import { parseSettingsSnapshot } from '@/lib/league-contract/types'

/**
 * Concept-aware roster/lineup flags from `League.settings.conceptRules` + extensions.
 * Single resolver — specialty concepts add keys under `extensions` without separate engines.
 */
type ConceptRosterLineupRules = {
  allowLineupEdits: boolean
  allowIrMoves: boolean
  allowTaxiPromotion: boolean
  allowDevySlots: boolean
  /** When true, survivor / tournament phases may freeze starters */
  freezeStarters: boolean
  raw: Record<string, unknown>
}

const DEFAULT_RULES: ConceptRosterLineupRules = {
  allowLineupEdits: true,
  allowIrMoves: true,
  allowTaxiPromotion: true,
  allowDevySlots: true,
  freezeStarters: false,
  raw: {},
}

export function resolveConceptRosterLineupRules(settings: unknown): ConceptRosterLineupRules {
  const snap = parseSettingsSnapshot(settings)
  const cr = snap?.conceptRules
  if (!cr || typeof cr !== 'object') {
    return { ...DEFAULT_RULES }
  }
  const ext =
    'extensions' in cr && cr.extensions && typeof cr.extensions === 'object' && !Array.isArray(cr.extensions)
      ? (cr.extensions as Record<string, unknown>)
      : {}

  const lineup = ext.lineup && typeof ext.lineup === 'object' && !Array.isArray(ext.lineup)
    ? (ext.lineup as Record<string, unknown>)
    : {}

  return {
    allowLineupEdits: readBool(lineup.allowEdits, DEFAULT_RULES.allowLineupEdits),
    allowIrMoves: readBool(lineup.allowIrMoves, DEFAULT_RULES.allowIrMoves),
    allowTaxiPromotion: readBool(lineup.allowTaxiPromotion, DEFAULT_RULES.allowTaxiPromotion),
    allowDevySlots: readBool(lineup.allowDevySlots, DEFAULT_RULES.allowDevySlots),
    freezeStarters: readBool(lineup.freezeStarters, DEFAULT_RULES.freezeStarters),
    raw: ext,
  }
}

function readBool(v: unknown, d: boolean): boolean {
  if (typeof v === 'boolean') return v
  return d
}
