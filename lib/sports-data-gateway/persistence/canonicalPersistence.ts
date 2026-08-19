/**
 * Fantasy OS Phase 5H-e — canonical persistent domains (pure contracts, gates, deterministic mappers, calculators,
 * shadow-compare, and runtime port interfaces). No DB access and no provider fetch live here — the actual repository
 * writes/reads are executed against the approved non-production Neon project (guarded by `nonprodSafetyGuard`).
 *
 * All five domains are ADDITIVE, default-off, versioned, provider-neutral, tenant-safe, and non-destructive.
 */
import type { CanonicalImageReference } from '../canonical/canonicalImage'
import type { CanonicalPlayerValue } from '../canonical/canonicalValue'

// ─────────────────────────────────────────────────────────────────────────────
// Default-off feature gates (server-only env; no customer override). Gate-off preserves existing behavior.
// ─────────────────────────────────────────────────────────────────────────────
export type CanonicalDomain = 'images' | 'values' | 'decision_evidence' | 'b2b_activity_events' | 'league_health_snapshots'

export const CANONICAL_DOMAIN_ENV: Record<CanonicalDomain, string> = {
  images: 'FANTASY_OS_CANONICAL_IMAGES_ENABLED',
  values: 'FANTASY_OS_CANONICAL_VALUES_ENABLED',
  decision_evidence: 'FANTASY_OS_DECISION_EVIDENCE_ENABLED',
  b2b_activity_events: 'FANTASY_OS_B2B_ACTIVITY_EVENTS_ENABLED',
  league_health_snapshots: 'FANTASY_OS_LEAGUE_HEALTH_SNAPSHOTS_ENABLED',
}

/** True only when the domain gate is explicitly "true". `env` defaults to process.env (injectable for tests). */
export function isCanonicalDomainEnabled(domain: CanonicalDomain, env: Record<string, string | undefined> = process.env): boolean {
  return env[CANONICAL_DOMAIN_ENV[domain]] === 'true'
}

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic content hash (stable, dependency-free — same input → same hash, for idempotency keys).
// ─────────────────────────────────────────────────────────────────────────────
export function contentHash(parts: Array<string | number | boolean | null | undefined>): string {
  const s = parts.map((p) => (p == null ? '' : String(p))).join('')
  let h = 2166136261 >>> 0 // FNV-1a
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return 'h' + h.toString(36)
}

// ─────────────────────────────────────────────────────────────────────────────
// Row types (mirror the sports_data.* tables) + deterministic mappers from the governed contracts.
// ─────────────────────────────────────────────────────────────────────────────
export type CanonicalImageRow = {
  id: string
  canonicalEntityId: string
  entityType: string
  sport: string
  imageType: string
  source: string
  sourceEntityId: string | null
  url: string | null
  validationStatus: string
  freshnessStatus: string
  fallbackRank: number
  provenance: string
  isPlaceholder: boolean
  contentHash: string
  isActive: boolean
  version: number
}

/** Map a governed CanonicalImageReference → an additive, idempotency-keyed persistence row. */
export function buildCanonicalImageRow(ref: CanonicalImageReference): CanonicalImageRow {
  const ch = contentHash([ref.canonicalEntityId, ref.entityType, ref.sport, ref.imageType, ref.source, ref.url, ref.fallbackRank])
  return {
    id: `img_${ref.entityType}_${ref.canonicalEntityId}_${ref.source}_${ch}`,
    canonicalEntityId: ref.canonicalEntityId,
    entityType: ref.entityType,
    sport: ref.sport,
    imageType: ref.imageType,
    source: ref.source,
    sourceEntityId: ref.sourceEntityId,
    url: ref.url,
    validationStatus: ref.validationStatus,
    freshnessStatus: ref.freshnessStatus,
    fallbackRank: ref.fallbackRank,
    provenance: ref.provenance,
    isPlaceholder: ref.isPlaceholder,
    contentHash: ch,
    isActive: !ref.isPlaceholder, // a placeholder is recorded but never the active image
    version: 1,
  }
}

export type CanonicalValueRow = {
  id: string
  canonicalPlayerId: string | null
  sport: string
  source: string
  sourcePlayerId: string | null
  valueType: string
  leagueFormat: string
  scoringFormat: string
  positionDetail: string
  superflex: boolean
  idp: boolean
  value: number | null
  rank: number | null
  tier: number | null
  freshnessStatus: string
  identityResolutionState: string
  coverageStatus: string
  provenance: string
  contentHash: string
  isActive: boolean
  version: number
}

/** Map a governed CanonicalPlayerValue → an additive persistence row (boundaries stay distinct; never merged). */
export function buildCanonicalValueRow(v: CanonicalPlayerValue): CanonicalValueRow {
  const ch = contentHash([v.source, v.sourcePlayerId, v.valueType, v.leagueFormat, v.scoringFormat, v.superflex, v.idp, v.value, v.rank])
  return {
    id: `val_${v.source}_${v.sourcePlayerId ?? 'na'}_${v.valueType}_${ch}`,
    canonicalPlayerId: v.canonicalPlayerId,
    sport: v.sport,
    source: v.source,
    sourcePlayerId: v.sourcePlayerId,
    valueType: v.valueType,
    leagueFormat: v.leagueFormat,
    scoringFormat: v.scoringFormat,
    positionDetail: v.positionContext,
    superflex: v.superflex,
    idp: v.idp,
    value: v.value,
    rank: v.rank,
    tier: v.tier,
    freshnessStatus: v.freshnessStatus,
    identityResolutionState: v.identityResolutionState,
    coverageStatus: v.coverageStatus,
    provenance: v.provenance,
    contentHash: ch,
    isActive: true,
    version: 1,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// League Health Snapshot — deterministic calculator. Observed measurements, deterministic derived metrics, and
// risk flags are kept in SEPARATE fields. Recommendations are NEVER placed inside observed metrics. Missing inputs
// stay explicit (coverage), never invented (no chat/sentiment/churn signals fabricated).
// ─────────────────────────────────────────────────────────────────────────────
export type LeagueHealthFacts = {
  tenantId: string
  leagueId: string
  sport: string
  season: string | null
  weekOrPeriod: string | null
  totalManagers: number
  activeManagers: number // observed
  lineupsSet: number // observed
  lineupSlotsExpected: number // observed
  waiverParticipants: number // observed
  tradesCompleted: number // observed
  draftComplete: boolean // observed
  hasScheduleIntegrity: boolean // observed
  hasScoringIntegrity: boolean // observed
  missingInputs?: string[] // explicit coverage gaps
}

export type LeagueHealthSnapshot = {
  tenantId: string
  leagueId: string
  sport: string
  season: string | null
  weekOrPeriod: string | null
  healthVersion: number
  observed: { activeManagerCount: number; inactiveManagerCount: number; tradesCompleted: number; draftComplete: boolean }
  derived: { lineupCompletionRate: number; waiverParticipationRate: number; tradeActivityRate: number }
  riskFlags: string[]
  positiveSignals: string[]
  coverageStatus: 'covered' | 'partial'
  provenance: string
}

function rate(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 1000) / 1000 : 0
}

/** Deterministic, evidence-only. No invented signals; risk flags and recommendations are NOT observed metrics. */
export function computeLeagueHealthSnapshot(f: LeagueHealthFacts, provenance = 'league-health-calculator'): LeagueHealthSnapshot {
  const inactive = Math.max(0, f.totalManagers - f.activeManagers)
  const lineupCompletionRate = rate(f.lineupsSet, f.lineupSlotsExpected)
  const waiverParticipationRate = rate(f.waiverParticipants, f.totalManagers)
  const tradeActivityRate = rate(f.tradesCompleted, f.totalManagers)
  const riskFlags: string[] = []
  if (inactive > 0) riskFlags.push('inactive_managers')
  if (lineupCompletionRate < 0.75) riskFlags.push('low_lineup_completion')
  if (!f.draftComplete) riskFlags.push('draft_incomplete')
  if (!f.hasScheduleIntegrity) riskFlags.push('schedule_integrity')
  if (!f.hasScoringIntegrity) riskFlags.push('scoring_integrity')
  const positiveSignals: string[] = []
  if (f.draftComplete) positiveSignals.push('draft_complete')
  if (lineupCompletionRate >= 0.9) positiveSignals.push('high_lineup_completion')
  if (tradeActivityRate > 0) positiveSignals.push('trade_activity')
  return {
    tenantId: f.tenantId,
    leagueId: f.leagueId,
    sport: f.sport,
    season: f.season,
    weekOrPeriod: f.weekOrPeriod,
    healthVersion: 1,
    observed: { activeManagerCount: f.activeManagers, inactiveManagerCount: inactive, tradesCompleted: f.tradesCompleted, draftComplete: f.draftComplete },
    derived: { lineupCompletionRate, waiverParticipationRate, tradeActivityRate },
    riskFlags,
    positiveSignals,
    coverageStatus: (f.missingInputs?.length ?? 0) > 0 ? 'partial' : 'covered',
    provenance,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Shadow comparison (pure) — compare legacy vs canonical output to plan later consumer migration. No provider
// payloads captured; only structural difference categories.
// ─────────────────────────────────────────────────────────────────────────────
export type ShadowDiff = { match: boolean; category: 'match' | 'value_diff' | 'source_diff' | 'presence_diff' | 'freshness_diff'; detail: string }

export function shadowCompareImage(legacyUrl: string | null | undefined, canonical: CanonicalImageReference): ShadowDiff {
  const legacy = legacyUrl ?? null
  if (legacy === canonical.url) return { match: true, category: 'match', detail: 'identical url' }
  if ((legacy == null) !== (canonical.url == null)) return { match: false, category: 'presence_diff', detail: `legacy=${legacy ? 'present' : 'null'} canonical=${canonical.url ? 'present' : 'null'}` }
  return { match: false, category: 'source_diff', detail: `different url (canonical source=${canonical.source} rank=${canonical.fallbackRank})` }
}

export function shadowCompareValue(legacyValue: number | null | undefined, canonical: CanonicalPlayerValue): ShadowDiff {
  const legacy = legacyValue ?? null
  if (legacy === canonical.value) return { match: true, category: 'match', detail: 'identical value' }
  if ((legacy == null) !== (canonical.value == null)) return { match: false, category: 'presence_diff', detail: `legacy=${legacy ?? 'null'} canonical=${canonical.value ?? 'null'}` }
  return { match: false, category: 'value_diff', detail: `legacy=${legacy} canonical=${canonical.value} (type=${canonical.valueType}, format=${canonical.leagueFormat}/${canonical.scoringFormat})` }
}

// ─────────────────────────────────────────────────────────────────────────────
// Runtime port interfaces — Decision OS / connected OS consume THESE, never a DB repository directly.
// ─────────────────────────────────────────────────────────────────────────────
export interface CanonicalImagePort {
  getActiveImage(args: { canonicalEntityId: string; entityType: string; sport: string; imageType: string }): Promise<CanonicalImageRow | null>
}
export interface CanonicalPlayerValuePort {
  getValues(args: { canonicalPlayerId: string; valueType?: string; leagueFormat?: string; scoringFormat?: string }): Promise<CanonicalValueRow[]>
}
export interface DecisionEvidencePort {
  record(evidence: unknown): Promise<{ id: string }>
  listForLeague(args: { tenantId: string; leagueId: string; decisionDomain?: string }): Promise<unknown[]>
}
export interface B2BActivityEventPort {
  record(event: { tenantId: string; idempotencyKey: string; eventName: string }): Promise<{ id: string; deduped: boolean }>
}
export interface LeagueHealthSnapshotPort {
  latest(args: { tenantId: string; leagueId: string }): Promise<LeagueHealthSnapshot | null>
}
