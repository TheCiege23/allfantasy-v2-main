/**
 * Fantasy OS Phase 5H-c — governed canonical VALUE service (pure; no DB, no provider access, no fetch).
 *
 * ONE contract for player valuation facts, with STRICT boundary separation: observed statistics, derived fantasy
 * points, provider projections, AllFantasy projections, provider valuations, AllFantasy valuations, rankings and
 * ADP are DISTINCT `valueType`s and never share an ambiguous field. FantasyCalc is a PROVIDER VALUATION source —
 * not observed sports truth. The position dimension is governed by the canonical position service (detailed
 * position preserved; broad valuation buckets are derived non-destructively, for value comparison only).
 *
 * It does NOT fetch and does NOT persist. A certified `PlayerValue` store is REQ-MIGRATION (documented, not built).
 */
import {
  normalizeProviderPosition,
  deriveFantasyEligibility,
  isSupportedPositionSport,
  type CanonicalSport,
  type LeaguePositionRules,
} from './canonicalPosition'

/** The distinct value boundaries. These NEVER collapse into one another. */
export type CanonicalValueType =
  | 'observed_statistic'
  | 'derived_fantasy_points'
  | 'provider_projection'
  | 'allfantasy_projection'
  | 'provider_valuation'
  | 'allfantasy_valuation'
  | 'ranking'
  | 'adp'

export type CanonicalLeagueFormat = 'redraft' | 'dynasty'
export type CanonicalScoringFormat = 'standard' | 'half_ppr' | 'ppr' | 'unknown'
/** Identity resolution state mirrors the statistics/identity plane: deterministic only. */
export type ValueIdentityResolutionState = 'resolved' | 'ambiguous' | 'unresolved'
export type ValueFreshnessStatus = 'fresh' | 'stale' | 'unknown'
export type ValueCoverageStatus = 'covered' | 'not_found' | 'unsupported'

/** Optional league-shape context that changes value meaning (kept explicit, never inferred silently). */
export type ValueLeagueContext = {
  leagueFormat: CanonicalLeagueFormat
  scoringFormat: CanonicalScoringFormat
  superflex?: boolean
  idp?: boolean
}

/** The governed canonical player-value record — the ONLY shape value consumers receive. */
export type CanonicalPlayerValue = {
  canonicalPlayerId: string | null
  sport: CanonicalSport
  source: string
  sourcePlayerId: string | null
  valueType: CanonicalValueType
  leagueFormat: CanonicalLeagueFormat
  scoringFormat: CanonicalScoringFormat
  superflex: boolean
  idp: boolean
  /** Detailed canonical position (DE stays DE) — NEVER a collapsed valuation bucket. */
  positionContext: string
  value: number | null
  rank: number | null
  tier: number | null
  generatedAt: string | null
  effectiveAt: string | null
  freshnessStatus: ValueFreshnessStatus
  sourceVersion: string | null
  identityResolutionState: ValueIdentityResolutionState
  provenance: string
  coverageStatus: ValueCoverageStatus
  unsupportedReason: string | null
}

/**
 * Derive a broad valuation grouping for value comparison ONLY (e.g. IDP families DL/LB/DB, kicker K). This is
 * NON-DESTRUCTIVE: it never mutates `positionContext` (which keeps the detailed DE/DT/EDGE/OLB/ILB/CB/S). Kickers
 * stay separate from offensive skill values. Unknown positions get no bucket (never a plausible one silently).
 */
export function deriveValuationGrouping(canonicalPrimaryPosition: string, sport: CanonicalSport, rules?: LeaguePositionRules): string | null {
  const pos = String(canonicalPrimaryPosition ?? '').toUpperCase()
  if (!pos || pos === 'UNKNOWN') return null
  if (pos === 'K' || pos === 'PK') return 'K' // kicker never merges with offensive skill values
  // Broad IDP families for value comparison, derived from league rules when supplied (governed, non-destructive).
  if (rules) {
    for (const bucket of ['DL', 'LB', 'DB'] as const) {
      const members = (rules.buckets?.[bucket] ?? []).map((m) => m.toUpperCase())
      if (members.includes(pos)) return bucket
    }
  } else {
    // Reference IDP families (used only for cross-player value comparison; detail retained in positionContext).
    if (['DE', 'DT', 'NT', 'EDGE', 'DL'].includes(pos)) return 'DL'
    if (['OLB', 'ILB', 'MLB', 'LB'].includes(pos)) return 'LB'
    if (['CB', 'S', 'FS', 'SS', 'DB'].includes(pos)) return 'DB'
  }
  return pos // offensive skill positions group as themselves
}

/** Minimal provider-neutral shape a FantasyCalc row is transformed into before it reaches this pure normalizer. */
export type FantasyCalcValueInput = {
  sourcePlayerId?: string | null // FantasyCalc numeric id (as string) or sleeperId
  canonicalPlayerId?: string | null
  providerPosition?: string | null
  dynastyValue?: number | null // FantasyCalc `value`
  redraftValue?: number | null
  overallRank?: number | null
  positionRank?: number | null
  tier?: number | null
  adp?: number | null
}

/**
 * Normalize a FantasyCalc row into DISTINCT canonical value records — one per boundary — so provider valuation,
 * ranking and ADP never merge. Returns the records that are actually present. The position dimension is governed
 * by the canonical position service (detail preserved). FantasyCalc is always `provider_valuation`, never observed.
 */
export function normalizeFantasyCalcValue(
  input: FantasyCalcValueInput,
  ctx: ValueLeagueContext,
  opts: {
    sport?: CanonicalSport
    identityResolutionState?: ValueIdentityResolutionState
    generatedAt?: string | null
    freshnessStatus?: ValueFreshnessStatus
    sourceVersion?: string | null
    provenance?: string
    leagueRules?: LeaguePositionRules
  } = {},
): CanonicalPlayerValue[] {
  const sport: CanonicalSport = opts.sport ?? 'NFL'
  const identityResolutionState = opts.identityResolutionState ?? (input.canonicalPlayerId ? 'resolved' : 'unresolved')
  const provenance = opts.provenance ?? 'fantasycalc'
  const positionContext = isSupportedPositionSport(sport)
    ? normalizeProviderPosition(input.providerPosition, sport).canonicalPrimaryPosition
    : 'UNKNOWN'

  const base = {
    canonicalPlayerId: input.canonicalPlayerId ?? null,
    sport,
    source: 'fantasycalc',
    sourcePlayerId: input.sourcePlayerId ?? null,
    leagueFormat: ctx.leagueFormat,
    scoringFormat: ctx.scoringFormat,
    superflex: Boolean(ctx.superflex),
    idp: Boolean(ctx.idp),
    positionContext,
    generatedAt: opts.generatedAt ?? null,
    effectiveAt: opts.generatedAt ?? null,
    freshnessStatus: opts.freshnessStatus ?? 'unknown',
    sourceVersion: opts.sourceVersion ?? null,
    identityResolutionState,
    provenance,
  } as const

  const out: CanonicalPlayerValue[] = []
  // Provider VALUATION — pick the value that matches the league format (never blend dynasty+redraft into one field).
  const valuation = ctx.leagueFormat === 'dynasty' ? input.dynastyValue : input.redraftValue
  if (valuation != null) {
    out.push({ ...base, valueType: 'provider_valuation', value: valuation, rank: null, tier: input.tier ?? null, coverageStatus: 'covered', unsupportedReason: null })
  }
  // RANKING — distinct from value.
  if (input.overallRank != null) {
    out.push({ ...base, valueType: 'ranking', value: null, rank: input.overallRank, tier: input.tier ?? null, coverageStatus: 'covered', unsupportedReason: null })
  }
  // ADP — distinct from value and ranking (the numeric lives in `value` on an `adp`-typed record; valueType disambiguates).
  if (input.adp != null) {
    out.push({ ...base, valueType: 'adp', value: input.adp, rank: null, tier: null, coverageStatus: 'covered', unsupportedReason: null })
  }

  if (out.length === 0) {
    out.push({ ...base, valueType: 'provider_valuation', value: null, rank: null, tier: null, coverageStatus: 'not_found', unsupportedReason: 'no_value_fields_present' })
  }
  return out
}

/** Guard: a value record must not carry data for a different boundary (used by tests + callers to assert purity). */
export function assertValueBoundary(v: CanonicalPlayerValue): true {
  if (v.valueType === 'ranking' && v.value != null) throw new Error('ranking record must not carry a value in the value field')
  if (v.valueType === 'provider_valuation' && v.rank != null && v.value == null) throw new Error('valuation record with a rank must carry a value')
  return true
}

/** Convenience: the governed eligibility for a value record's detailed position under a league's rules. */
export function valueEligibilityForLeague(v: CanonicalPlayerValue, rules: LeaguePositionRules): string[] {
  return deriveFantasyEligibility(v.positionContext, rules)
}
