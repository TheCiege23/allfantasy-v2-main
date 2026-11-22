import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { type CanonicalImportBundle, type NormalizedImportResult } from '@/lib/league-import/types'

type ImportValidationResult =
  | { ok: true }
  | { ok: false; code: string; message: string }

export function validateNormalizedImport(normalized: NormalizedImportResult): ImportValidationResult {
  if (!normalized.source?.source_league_id?.trim()) {
    return { ok: false, code: 'missing_source_id', message: 'Import is missing source league id.' }
  }
  if (!normalized.league?.name?.trim()) {
    return { ok: false, code: 'missing_league_name', message: 'Import is missing league name.' }
  }
  try {
    normalizeToSupportedSport(normalized.league.sport)
  } catch {
    return { ok: false, code: 'unsupported_sport', message: 'Sport could not be normalized to a supported value.' }
  }
  if (!Number.isFinite(normalized.league.leagueSize) || normalized.league.leagueSize < 2) {
    return { ok: false, code: 'invalid_team_count', message: 'League must have at least 2 teams.' }
  }
  return { ok: true }
}

export function validateCanonicalBundle(bundle: CanonicalImportBundle): ImportValidationResult {
  if (!bundle.settingsSnapshot?.conceptRules?.concept) {
    return { ok: false, code: 'missing_concept_rules', message: 'Canonical bundle missing concept rules.' }
  }
  if (!bundle.scoringPresetId) {
    return { ok: false, code: 'missing_scoring_preset', message: 'Scoring preset id missing after normalization.' }
  }
  if (!bundle.importMetadata?.externalLeagueId?.trim()) {
    return { ok: false, code: 'missing_import_metadata', message: 'Import metadata missing external league id.' }
  }
  return { ok: true }
}
