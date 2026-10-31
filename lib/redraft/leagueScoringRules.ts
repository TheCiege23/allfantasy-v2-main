/**
 * A league's scoring rules — the categories it scores and the per-category point values — resolved
 * from `League.settings` exactly once, for every scorer that has to agree.
 *
 * Moved out of `buildLeagueStatScorer` (scoringEngine.ts) unchanged, 2026-10-19. The NFL redraft
 * live-scoring runtime (`recalculate_week` / `apply_correction` / stat ingest) used to resolve its own
 * point values from the scoring template + `LeagueScoringOverride` rows + `sportConfig.categoryPoints`,
 * and never read `settings.nfl_scoring_config` — the store the commissioner's NFL scoring panel saves.
 * A recalculation could therefore rescore a week on rules the panel does not show. Both paths now read
 * this one resolution.
 *
 * Kept free of `@/lib/prisma` and `@/lib/scoring-runtime` imports on purpose: the scoring runtime
 * imports it, and `scoringEngine.ts` imports the scoring runtime.
 */
import {
  expandSportConfigToggles,
  getScoringCategories,
  resolveSportConfigKey,
  tryGetSportConfig,
} from '@/lib/sportConfig'
import type { ScoringCategory } from '@/lib/sportConfig/types'
import { bridgeUiRulesToEngineCategoryPoints } from '@/lib/nfl-scoring/scoringKeyBridge'
import { importedNcaafScoring } from './importedNcaafScoring'
import { storeSavedByPerson, bridgeSportUiScoringStore } from '@/lib/redraft/uiScoringStoreBridge'

export function applyScoringPresetToRecPoints(
  categories: ScoringCategory[],
  preset: string,
  overrides: Record<string, number>,
): ScoringCategory[] {
  if (overrides.rec != null) return categories
  if (preset === 'CUSTOM') return categories
  const recPts =
    preset === 'PPR' ? 1 : preset === 'HALF_PPR' ? 0.5 : preset === 'STANDARD' ? 0 : null
  if (recPts === null) return categories
  return categories.map((c) => (c.key === 'rec' ? { ...c, defaultPoints: recPts } : c))
}

type SportConfigBlob = Record<string, unknown>

function readSportConfig(league: { settings: unknown }): SportConfigBlob {
  const s = league.settings as Record<string, unknown> | null | undefined
  const raw = s?.sportConfig
  return raw && typeof raw === 'object' && raw !== null ? (raw as SportConfigBlob) : {}
}

/**
 * Legacy fallback (R1): derive engine overrides from `settings.nfl_scoring_config`
 * (the UI store) when the canonical `sportConfig.categoryPoints` is absent — so
 * leagues last saved before the UI→engine bridge still score their commissioner
 * settings. Only fires when categoryPoints is empty.
 */
function bridgeLegacyNflScoringConfig(league: { settings: unknown }): Record<string, number> {
  const s = league.settings as Record<string, unknown> | null | undefined
  const legacy = s?.nfl_scoring_config as Record<string, unknown> | undefined
  const rules = legacy?.rules as Record<string, number> | undefined
  if (!rules || typeof rules !== 'object') return {}
  return bridgeUiRulesToEngineCategoryPoints(rules)
}

function togglesFromSportConfig(sc: SportConfigBlob): string[] {
  const t: string[] = []
  if (sc.enableIDP === true) t.push('IDP')
  if (sc.enableSuperflex === true) t.push('SUPERFLEX')
  if (sc.enableTEPremium === true) t.push('TE_PREMIUM')
  return t
}

export type LeagueScoringRules = {
  /** Categories scored, with the preset's reception value already folded into `rec`. */
  categories: ScoringCategory[]
  /** Per-category point overrides; a category absent here scores its `defaultPoints`. */
  overrides: Record<string, number>
}

/**
 * The scoring `buildLeagueStatScorer` applies. Null when the sport has no config.
 * `settings: null` resolves the sport's defaults (no league).
 */
export function resolveLeagueScoringRules(league: { sport: string; settings: unknown }): LeagueScoringRules | null {
  const sport = resolveSportConfigKey(String(league.sport))
  const cfg = tryGetSportConfig(sport)
  if (!cfg) return null

  const sc = readSportConfig(league)
  const toggles = togglesFromSportConfig(sc)
  const expanded = expandSportConfigToggles(toggles)
  let categories = getScoringCategories(cfg.sport, expanded)
  const preset = String(sc.scoringPreset ?? 'PPR')
  // R1 precedence: the canonical engine store wins. For legacy leagues that only
  // have the UI store (`nfl_scoring_config`, written before the bridge existed),
  // derive engine overrides from it so their commissioner scoring is honored too.
  let overrides =
    typeof sc.categoryPoints === 'object' && sc.categoryPoints !== null
      ? (sc.categoryPoints as Record<string, number>)
      : {}
  if (Object.keys(overrides).length === 0) {
    const settings = league.settings as Record<string, unknown> | null
    const savedPanel = storeSavedByPerson(settings?.ncaaf_scoring_config)
    const imported = savedPanel ? null : importedNcaafScoring(cfg.sport, settings, cfg.scoringCategories)
    // Explicit commissioner edits retain precedence. Untouched seeded panel defaults cannot
    // override the actual source weights or reintroduce penalties the source never awards.
    if (imported) {
      categories = imported.categories
      overrides = imported.overrides
    } else {
      overrides = bridgeSportUiScoringStore(cfg.sport, league.settings) ?? bridgeLegacyNflScoringConfig(league)
    }
  }
  categories = applyScoringPresetToRecPoints(categories, preset, overrides)

  if (cfg.sport === 'NCAAF' && overrides.te_premium !== undefined && !categories.some(c => c.key === 'te_premium')) {
    categories = [...categories, cfg.scoringCategories.find(c => c.key === 'te_premium')!]
  }
  return { categories, overrides }
}
