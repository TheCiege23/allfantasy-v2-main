/**
 * Dynasty scoring presets. Wires to existing ScoringTemplate / LeagueScoringOverride.
 * Presets map to formatType used by getScoringTemplate(sport, formatType).
 */
import { DYNASTY_SCORING_PRESETS } from './constants'
import type { DynastyScoringPresetDto } from './types'

const SUMMARY_BY_FORMAT: Record<string, string> = {
  dynasty_standard: 'Standard (0 PPR, 4pt pass TD)',
  dynasty_half_ppr: 'Half PPR, 4pt pass TD',
  dynasty_full_ppr: 'Full PPR, 4pt pass TD',
  dynasty_full_ppr_tep: 'Full PPR + TE Premium +0.5, 4pt pass TD',
  dynasty_superflex_default: 'Full PPR, 4pt pass TD (Superflex default)',
  dynasty_6pt_pass_td: 'Full PPR, 6pt pass TD',
}

/**
 * Get scoring preset DTOs for UI. Format types align with DB or ScoringDefaultsRegistry fallbacks.
 */
export function getDynastyScoringPresetList(): DynastyScoringPresetDto[] {
  return DYNASTY_SCORING_PRESETS.map((p) => ({
    id: p.id,
    label: p.label,
    formatType: p.formatType,
    summary: SUMMARY_BY_FORMAT[p.id] ?? p.label,
  }))
}

