/**
 * Layer 2 — maps adapter output (`NormalizedImportResult`) into canonical `SettingsSnapshot`,
 * `conceptRules`, preset fingerprint, derived flags, import metadata, and review/warning payloads.
 */

import type { LeagueSport } from '@prisma/client'
import {
  SETTINGS_SNAPSHOT_VERSION,
  buildPresetKey,
  type SettingsSnapshot,
} from '@/lib/league-contract/types'
import { resolveLeagueFormat } from '@/lib/league/format-engine'
import { normalizeConceptToFormat } from '@/lib/league-creation/canonical/normalizeConcept'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import type {
  CanonicalImportBundle,
  DerivedImportFlags,
  ImportMetadataBundle,
  ImportWarningRecord,
  NormalizedImportResult,
} from '@/lib/league-import/types'

const NORMALIZATION_VERSION = '2'

function inferScoringPresetId(normalized: NormalizedImportResult): string {
  const fmt = String(normalized.scoring?.scoring_format ?? normalized.league.scoring ?? '').toLowerCase()
  if (fmt.includes('idp')) return 'fb_idp'
  if (fmt.includes('full') && fmt.includes('ppr')) return 'fb_ppr'
  if (fmt.includes('half') || fmt.includes('0.5')) return 'fb_half_ppr'
  if (fmt.includes('std') || fmt.includes('non')) return 'fb_std'
  if (fmt.includes('te') && fmt.includes('prem')) return 'fb_te_premium'
  if (fmt.includes('super')) return 'fb_superflex'
  return 'fb_half_ppr'
}

function inferDraftType(normalized: NormalizedImportResult): string {
  const raw = normalized.league as Record<string, unknown>
  const dt = raw.draft_type ?? raw.draftType ?? (raw.settings as Record<string, unknown> | undefined)?.draft_type
  const s = String(dt ?? '').toLowerCase()
  if (s.includes('auction')) return 'auction'
  if (s.includes('linear')) return 'linear'
  return 'snake'
}

function collectConceptSignals(normalized: NormalizedImportResult): string {
  const raw = normalized.league as Record<string, unknown>
  const parts: string[] = []
  parts.push(String(raw.league_type ?? raw.type ?? ''))
  parts.push(String(raw.name ?? normalized.league.name ?? ''))
  if (raw.settings && typeof raw.settings === 'object' && !Array.isArray(raw.settings)) {
    parts.push(JSON.stringify(raw.settings))
  }
  parts.push(String(normalized.league.scoring ?? ''))
  parts.push(String(normalized.scoring?.scoring_format ?? ''))
  for (const r of normalized.rosters) {
    if (r.taxi_ids && r.taxi_ids.length > 0) parts.push('taxi_devy')
    if (r.reserve_ids && r.reserve_ids.length > 0) parts.push('reserve')
  }
  return parts.join(' ').toLowerCase()
}

function heuristicConceptFromSignals(signals: string): string | null {
  if (/\bguillotine\b/.test(signals)) return 'guillotine'
  if (/\bsurvivor\b/.test(signals)) return 'survivor'
  if (/\bzombie\b/.test(signals)) return 'zombie'
  if (/\btournament\b/.test(signals) || /\bbracket\b/.test(signals)) return 'tournament'
  if (/\bbig[\s_]*brother\b/.test(signals) || /\bbigbrother\b/.test(signals)) return 'big_brother'
  if (/\bc2c\b|campus\s*2\s*canton|college\s*to\s*pro/.test(signals)) return 'c2c'
  if (/\bdevy\b|\bdevelopmental\b/.test(signals) || signals.includes('taxi_devy')) return 'devy'
  if (/\bsalary[\s_]*cap\b|salarycap|\bcap\s*league\b/.test(signals)) return 'salary_cap'
  return null
}

function inferLeagueConceptFromNormalized(normalized: NormalizedImportResult): {
  concept: string
  leagueType: string
  reviewRequired: boolean
  reviewReasons: string[]
  warnings: ImportWarningRecord[]
} {
  const warnings: ImportWarningRecord[] = []
  const reviewReasons: string[] = []
  const raw = normalized.league as Record<string, unknown>
  const settingsObj =
    raw.settings && typeof raw.settings === 'object' && !Array.isArray(raw.settings)
      ? (raw.settings as Record<string, unknown>)
      : null
  const explicit =
    (typeof raw.league_type === 'string' && raw.league_type) ||
    (typeof raw.type === 'string' && raw.type) ||
    (settingsObj && typeof settingsObj.league_type === 'string' ? settingsObj.league_type : '')

  const signals = collectConceptSignals(normalized)
  let concept = String(explicit ?? '').trim().toLowerCase()

  if (!concept) {
    if (normalized.league.isDynasty) concept = 'dynasty'
    else if (String(normalized.league.scoring ?? '').toLowerCase().includes('best')) concept = 'best_ball'
    else {
      const h = heuristicConceptFromSignals(signals)
      concept = h ?? 'redraft'
    }
  }

  const sourceConceptTag = concept
  let conceptFormat = normalizeConceptToFormat(concept)
  if (!conceptFormat) {
    warnings.push({
      code: 'concept_unmapped',
      message: `Source reported "${concept}" — mapped to redraft for import; confirm in League Settings.`,
      severity: 'warn',
      metadata: { rawConcept: concept },
    })
    reviewReasons.push('concept_inferred')
    concept = 'redraft'
    conceptFormat = normalizeConceptToFormat('redraft') ?? { formatId: 'redraft' as const, aliasTags: [] }
  }

  /** Risky or specialty concepts: always surface review tasks instead of silent acceptance. */
  const specialtyReview = new Set([
    'guillotine',
    'survivor',
    'big_brother',
    'zombie',
    'tournament',
    'devy',
    'c2c',
    'salary_cap',
  ])
  if (specialtyReview.has(sourceConceptTag) || specialtyReview.has(conceptFormat.formatId)) {
    if (!reviewReasons.includes('specialty_concept_external')) {
      reviewReasons.push('specialty_concept_external')
    }
    warnings.push({
      code: 'specialty_partial',
      message: `Specialty format "${conceptFormat.formatId}" may not be fully modeled by ${normalized.source.source_provider}. Confirm concept rules and automation after import.`,
      severity: 'info',
    })
  }

  if (['keeper'].includes(sourceConceptTag) || conceptFormat.formatId === 'keeper') {
    reviewReasons.push('keeper_settings_confirm')
  }

  const leagueType = conceptFormat.formatId

  return {
    concept: conceptFormat.formatId,
    leagueType,
    reviewRequired: reviewReasons.length > 0,
    reviewReasons,
    warnings,
  }
}

function inferDerivedFlags(
  normalized: NormalizedImportResult,
  inferredConcept: string,
  scoringPresetId: string,
): DerivedImportFlags {
  const raw = normalized.league as Record<string, unknown>
  const rosterPositions = Array.isArray(raw.roster_positions)
    ? (raw.roster_positions as unknown[]).map((p) => String(p).toUpperCase())
    : []
  const idpPositions = ['DE', 'DT', 'LB', 'CB', 'S', 'DL', 'DB', 'IDP_FLEX', 'IDP']
  const hasIdpSlot = rosterPositions.some((p) => idpPositions.some((x) => p.includes(x)))
  const signals = collectConceptSignals(normalized)

  return {
    idp: scoringPresetId === 'fb_idp' || hasIdpSlot,
    salaryCap: inferredConcept === 'salary_cap' || /\bsalary[\s_]*cap\b|salarycap/.test(signals),
    devy: inferredConcept === 'devy' || signals.includes('taxi_devy') || /\bdevy\b/.test(signals),
    c2c: inferredConcept === 'c2c' || /\bc2c\b|campus\s*2\s*canton/.test(signals),
    bestBall: inferredConcept === 'best_ball' || /\bbest[\s_]*ball\b/.test(signals),
    dynasty: normalized.league.isDynasty || inferredConcept === 'dynasty',
    tournament: inferredConcept === 'tournament' || /\btournament\b|\bbracket\b/.test(signals),
  }
}

function buildImportMetadata(normalized: NormalizedImportResult): ImportMetadataBundle {
  return {
    importSource: normalized.source.source_provider,
    externalLeagueId: normalized.source.source_league_id,
    externalSeasonId: normalized.source.source_season_id ?? null,
    importBatchId: normalized.source.import_batch_id ?? null,
    normalizedAt: new Date().toISOString(),
    normalizationVersion: NORMALIZATION_VERSION,
  }
}

function inferCommissionerAndMediaSlices(normalized: NormalizedImportResult): {
  commissionerSettings?: SettingsSnapshot['commissionerSettings']
  mediaSettings?: SettingsSnapshot['mediaSettings']
  visualTheme?: SettingsSnapshot['visualTheme']
} {
  const raw = normalized.league as Record<string, unknown>
  const settingsObj =
    raw.settings && typeof raw.settings === 'object' && !Array.isArray(raw.settings)
      ? (raw.settings as Record<string, unknown>)
      : null
  const tradeReview =
    (settingsObj && typeof settingsObj.trade_review_mode === 'string' && settingsObj.trade_review_mode) ||
    (typeof raw.trade_review_mode === 'string' && raw.trade_review_mode) ||
    undefined
  const veto = settingsObj && typeof settingsObj.veto_votes_required === 'number' ? settingsObj.veto_votes_required : undefined

  const commissionerSettings =
    tradeReview || veto != null
      ? {
          ...(tradeReview ? { tradeReviewMode: tradeReview } : {}),
          ...(veto != null ? { vetoVotesRequired: veto } : {}),
        }
      : undefined

  const logoUrl = normalized.league_branding?.avatar_url ?? (typeof raw.avatar === 'string' ? raw.avatar : null)
  const visualTheme = logoUrl ? { logoUrl } : undefined
  const mediaSettings = logoUrl ? { logoUrl } : undefined

  return { commissionerSettings, mediaSettings, visualTheme }
}

function buildConceptRulesBlock(
  inferredConcept: string,
  normalized: NormalizedImportResult,
  aliasTags: string[],
): NonNullable<SettingsSnapshot['conceptRules']> {
  const nc = normalizeConceptToFormat(inferredConcept)
  const meta = buildImportMetadata(normalized)
  return {
    concept: inferredConcept,
    version: 1,
    extensions: {
      importSource: normalized.source.source_provider,
      sourceLeagueId: normalized.source.source_league_id,
      aliasTags: [...(nc?.aliasTags ?? []), ...aliasTags],
      importMetadata: {
        externalLeagueId: meta.externalLeagueId,
        externalSeasonId: meta.externalSeasonId,
        normalizationVersion: meta.normalizationVersion,
      },
    },
  }
}

export function buildCanonicalImportBundle(normalized: NormalizedImportResult): CanonicalImportBundle {
  const sport = normalizeToSupportedSport(normalized.league.sport) as LeagueSport
  const scoringPresetId = inferScoringPresetId(normalized)
  const draftType = inferDraftType(normalized)
  const teamCount = normalized.league.leagueSize

  const inferred = inferLeagueConceptFromNormalized(normalized)
  const derivedFlags = inferDerivedFlags(normalized, inferred.concept, scoringPresetId)
  const importMetadata = buildImportMetadata(normalized)

  const aliasTagsFromIdp: string[] = []
  if (derivedFlags.idp) aliasTagsFromIdp.push('idp')

  const formatResolution = resolveLeagueFormat({
    sport,
    leagueType: inferred.concept,
    draftType: draftType as 'snake' | 'auction' | 'linear',
    requestedModifiers: [],
  })

  const playoffTeams =
    typeof normalized.league.playoff_team_count === 'number'
      ? normalized.league.playoff_team_count
      : formatResolution.playoffDefaults?.playoff_team_count ?? 6

  const { commissionerSettings: baseCommissionerSettings, mediaSettings, visualTheme } =
    inferCommissionerAndMediaSlices(normalized)

  // Tier 0 (Block B) — bench = roster total minus actual starter count from the
  // imported `roster_positions` array. Previously hardcoded to `rosterSize - 9`,
  // which broke every SUPER_FLEX league where starters = 10.
  //
  // Phase 38: real, code-verified provider-shape bug fix. Sleeper's roster_positions is a
  // flat array (one entry per slot: 'QB','RB','BN','BN',...) — the exact-match filter below
  // was written for that shape. ESPN/Yahoo/MFL adapters instead build AGGREGATED "SLOT:count"
  // strings (e.g. 'BE:6', 'IR:2') — confirmed via direct read of
  // lib/league-import/adapters/{espn,yahoo,mfl}/*.ts. An exact match against 'BN'/'IR'/'TAXI'
  // can never match a "SLOT:count" string, so every ESPN/Yahoo/MFL import silently
  // miscounted bench slots (counting reserve slots as starters). Fixed by parsing the
  // optional ":count" suffix (defaulting to 1 when absent, preserving Sleeper's flat-array
  // behavior exactly) and widening the reserve-label set to the real, code-confirmed labels
  // each provider actually emits: Sleeper (BN/IR/TAXI), ESPN (BE/IR), Yahoo
  // (BN/BE/IR/IL/NA/DL, per YahooLeagueFetchService.ts's own YAHOO_RESERVE_POSITIONS), MFL
  // (TAXI, appended by MflLeagueFetchService.ts).
  const RESERVE_SLOT_LABELS = new Set(['BN', 'BE', 'IR', 'IL', 'NA', 'DL', 'TAXI'])
  const rosterPositionsRaw = Array.isArray((normalized.league as Record<string, unknown>).roster_positions)
    ? ((normalized.league as Record<string, unknown>).roster_positions as unknown[]).map((p) => String(p).toUpperCase())
    : []
  const nonBenchSlotCount = rosterPositionsRaw.reduce((sum, entry) => {
    const [label, countRaw] = entry.split(':')
    if (RESERVE_SLOT_LABELS.has(label)) return sum
    const count = countRaw != null ? Number(countRaw) : 1
    return sum + (Number.isFinite(count) && count > 0 ? count : 1)
  }, 0)
  const computedBenchSlots =
    typeof normalized.league.rosterSize === 'number' && teamCount > 0
      ? Math.max(0, normalized.league.rosterSize - (nonBenchSlotCount || 9))
      : undefined

  // Tier 0 (Block B) — respect imported taxi/reserve slot counts when the source
  // provides them. Previously hardcoded to 4 whenever the derived-devy flag was
  // true, which silently overrode Sleeper's real values (e.g. 6 for L1's audit).
  const importedTaxiSlots =
    typeof normalized.league.taxi_slots === 'number' ? normalized.league.taxi_slots : undefined
  const importedIrSlots =
    typeof normalized.league.reserve_slots === 'number' ? normalized.league.reserve_slots : undefined

  const rosterSettings: SettingsSnapshot['rosterSettings'] = {
    starterSlots: undefined,
    benchSlots: computedBenchSlots,
    irSlots: importedIrSlots,
    taxiSlots: importedTaxiSlots ?? (derivedFlags.devy ? 4 : undefined),
    devyCollegeSlots: derivedFlags.devy ? 2 : undefined,
  }

  // Tier 0 (Block B) — fold imported tradeDeadlineWeek into commissionerSettings so
  // the persistence layer has a single canonical source when writing the League row.
  const importedTradeDeadlineWeek =
    typeof normalized.league.trade_deadline_week === 'number'
      ? normalized.league.trade_deadline_week
      : undefined
  const commissionerSettings =
    importedTradeDeadlineWeek != null
      ? { ...(baseCommissionerSettings ?? {}), tradeDeadlineWeek: importedTradeDeadlineWeek }
      : baseCommissionerSettings

  const scoringRules: Record<string, unknown> = {}
  if (normalized.scoring?.rules?.length) {
    for (const r of normalized.scoring.rules) {
      scoringRules[r.stat_key] = r.points_value
    }
  }

  const settingsSnapshot: SettingsSnapshot = {
    snapshotVersion: SETTINGS_SNAPSHOT_VERSION,
    rosterSettings,
    scoringSettings: {
      format: normalized.scoring?.scoring_format ?? String(normalized.league.scoring ?? 'standard'),
      scoringTemplateId: scoringPresetId,
      rules: scoringRules,
      source: normalized.source.source_provider,
    },
    draftSettings: {
      draftType,
      rounds:
        typeof (normalized.league as Record<string, unknown>).num_rounds === 'number'
          ? Number((normalized.league as Record<string, unknown>).num_rounds)
          : undefined,
      auctionBudgetPerTeam: derivedFlags.salaryCap
        ? typeof (normalized.league as Record<string, unknown>).faab_budget === 'number'
          ? Number((normalized.league as Record<string, unknown>).faab_budget)
          : undefined
        : undefined,
    },
    waiverSettings: {
      waiverType: normalized.league.waiver_type ?? 'rolling',
      faabBudget: normalized.league.faab_budget ?? undefined,
    },
    playoffSettings: {
      playoffTeams,
      playoffStartWeek:
        typeof (normalized.league as Record<string, unknown>).playoff_start_week === 'number'
          ? Number((normalized.league as Record<string, unknown>).playoff_start_week)
          : undefined,
    },
    commissionerSettings,
    mediaSettings,
    visualTheme,
    conceptRules: buildConceptRulesBlock(inferred.concept, normalized, aliasTagsFromIdp),
    metadata: {
      importNormalizationVersion: NORMALIZATION_VERSION,
      createdFromFlow: 'external_import',
      importMetadata: {
        provider: importMetadata.importSource,
        externalLeagueId: importMetadata.externalLeagueId,
        externalSeasonId: importMetadata.externalSeasonId,
        importBatchId: importMetadata.importBatchId,
        normalizedAt: importMetadata.normalizedAt,
      },
    },
  }

  let presetKey: string | null = null
  try {
    presetKey = buildPresetKey({
      concept: inferred.concept,
      sport,
      scoringPresetId,
      draftType,
      teamCount,
    })
  } catch {
    presetKey = null
  }

  const coverageWarnings: ImportWarningRecord[] = []
  for (const key of Object.keys(normalized.coverage) as Array<keyof typeof normalized.coverage>) {
    const bucket = normalized.coverage[key]
    if (bucket.state === 'missing' || bucket.state === 'partial') {
      coverageWarnings.push({
        code: `coverage_${key}`,
        message: `${key}: ${bucket.state}${bucket.note ? ` — ${bucket.note}` : ''}`,
        severity: 'info',
      })
    }
  }

  // Phase 2.4 (§5) — surface non-fatal source-fetch failures (e.g. a Sleeper matchup
  // week that failed after retries) as persisted import warnings, so an incomplete
  // import is never silently presented as complete.
  const fetchWarnings: ImportWarningRecord[] = (normalized.fetchWarnings ?? []).map((message) => ({
    code: 'source_fetch_incomplete',
    message,
    severity: 'warn',
  }))
  const warnings = [...inferred.warnings, ...coverageWarnings, ...fetchWarnings]

  const conceptResolved = normalizeConceptToFormat(inferred.concept)

  return {
    settingsSnapshot,
    inferredConcept: inferred.concept,
    inferredLeagueType: inferred.leagueType,
    scoringPresetId,
    draftType,
    presetKey,
    leagueTypeColumn: inferred.concept,
    derivedFlags,
    importMetadata,
    warnings,
    reviewRequired: inferred.reviewRequired,
    reviewReasons: inferred.reviewReasons,
    meta: {
      provider: normalized.source.source_provider,
      sourceLeagueId: normalized.source.source_league_id,
      confidence: {
        concept: conceptResolved ? 0.85 : 0.5,
        scoring: normalized.scoring ? 0.8 : 0.4,
        rosters: normalized.rosters.length > 0 ? 0.9 : 0.2,
      },
    },
  }
}

export function toCanonicalImportPreviewJson(bundle: CanonicalImportBundle) {
  return {
    inferredConcept: bundle.inferredConcept,
    inferredLeagueType: bundle.inferredLeagueType,
    scoringPresetId: bundle.scoringPresetId,
    draftType: bundle.draftType,
    presetKey: bundle.presetKey,
    derivedFlags: bundle.derivedFlags,
    importMetadata: bundle.importMetadata,
    reviewRequired: bundle.reviewRequired,
    reviewReasons: bundle.reviewReasons,
    warnings: bundle.warnings,
    meta: bundle.meta,
  }
}
