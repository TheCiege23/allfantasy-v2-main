/**
 * Fantasy OS Phase 5H-f — factual data domains (pure contracts, gates, correction/effective-dating, ports).
 *
 * Injuries · availability · depth charts · projections · corrections · player-team history · player-position
 * history. Every domain is append-only / effective-dated: corrections create NEW versions and NEVER destructively
 * overwrite prior facts; retrieval resolves the current effective record deterministically and supports as-of.
 * No DB access here (repositories run against the approved non-prod plane, guarded by nonprodSafetyGuard).
 *
 * BOUNDARIES: injury ≠ availability; provider-supplied ≠ derived; projections are evidence, NEVER observed stats,
 * values, or scoring inputs. Unknown stays unknown; nothing is inferred.
 */
import { contentHash } from './canonicalPersistence'

// ── default-off gates (server-only env; no customer override) ────────────────
export type FactualDomain = 'injuries' | 'availability' | 'depth_charts' | 'projections' | 'history' | 'corrections'
export const FACTUAL_DOMAIN_ENV: Record<FactualDomain, string> = {
  injuries: 'FANTASY_OS_CANONICAL_INJURIES_ENABLED',
  availability: 'FANTASY_OS_CANONICAL_AVAILABILITY_ENABLED',
  depth_charts: 'FANTASY_OS_CANONICAL_DEPTH_CHARTS_ENABLED',
  projections: 'FANTASY_OS_CANONICAL_PROJECTIONS_ENABLED',
  history: 'FANTASY_OS_CANONICAL_HISTORY_ENABLED',
  corrections: 'FANTASY_OS_CANONICAL_CORRECTIONS_ENABLED',
}
export function isFactualDomainEnabled(domain: FactualDomain, env: Record<string, string | undefined> = process.env): boolean {
  return env[FACTUAL_DOMAIN_ENV[domain]] === 'true'
}

export type FreshnessStatus = 'fresh' | 'stale' | 'unknown'
export type CoverageStatus = 'covered' | 'partial' | 'unsupported'
export type IdentityResolutionState = 'resolved' | 'ambiguous' | 'unresolved'

// ── effective-dated record shape shared by the correction helpers ────────────
export type EffectiveDatedRecord = {
  id: string
  effectiveAt: string // ISO
  isActive: boolean
  correctionOfId?: string | null
  supersedesId?: string | null
  contentHash: string
  version: number
}

/** Resolve the CURRENT effective record: the active record with the latest effectiveAt. */
export function resolveCurrent<T extends EffectiveDatedRecord>(records: T[]): T | null {
  const active = records.filter((r) => r.isActive).sort((a, b) => (a.effectiveAt < b.effectiveAt ? 1 : -1))
  return active[0] ?? null
}

/** Resolve the record effective AS-OF a timestamp (latest effectiveAt <= asOf), regardless of current is_active. */
export function resolveAsOf<T extends EffectiveDatedRecord>(records: T[], asOfIso: string): T | null {
  const eligible = records.filter((r) => r.effectiveAt <= asOfIso).sort((a, b) => (a.effectiveAt < b.effectiveAt ? 1 : -1))
  return eligible[0] ?? null
}

/**
 * Apply a correction append-only: returns the NEW version (never mutates the prior record's facts) plus which prior
 * id to deactivate. Duplicate corrections (same content hash + effective time) are suppressed (returns null).
 */
export type CorrectionResult<T> = { newVersion: T; deactivateId: string; correction: CanonicalCorrection } | null
export function applyCorrection<T extends EffectiveDatedRecord>(
  prior: T,
  next: Omit<T, 'version' | 'correctionOfId' | 'supersedesId' | 'isActive'>,
  meta: { domain: string; source: string; sourceCorrectionId: string; reasonCode: string; reasonDescription?: string; receivedAt: string; provenance: string },
): CorrectionResult<T> {
  if (next.contentHash === prior.contentHash && next.effectiveAt === prior.effectiveAt) return null // duplicate
  const newVersion = { ...(next as T), version: 1, correctionOfId: prior.id, supersedesId: prior.id, isActive: true }
  const correction: CanonicalCorrection = {
    id: `corr_${meta.domain}_${next.id}`,
    domain: meta.domain,
    canonicalRecordId: next.id,
    correctsRecordId: prior.id,
    supersedesRecordId: prior.id,
    source: meta.source,
    sourceCorrectionId: meta.sourceCorrectionId,
    reasonCode: meta.reasonCode,
    reasonDescription: meta.reasonDescription ?? null,
    previousContentHash: prior.contentHash,
    correctedContentHash: next.contentHash,
    effectiveAt: next.effectiveAt,
    receivedAt: meta.receivedAt,
    provenance: meta.provenance,
    version: 1,
  }
  return { newVersion, deactivateId: prior.id, correction }
}

// ── domain record types (mirror the sports_data.* tables) ────────────────────
export type CanonicalInjury = EffectiveDatedRecord & {
  canonicalPlayerId: string | null; sport: string; source: string; sourcePlayerId: string | null; sourceTeamId: string | null
  injuryType: string | null; bodyArea: string | null; status: string; practiceStatus: string | null; gameDesignation: string | null
  description: string | null; reportedAt: string | null; retrievedAt: string | null; estimatedReturnAt: string | null; resolvedAt: string | null
  freshnessStatus: FreshnessStatus; coverageStatus: CoverageStatus; identityResolutionState: IdentityResolutionState; provenance: string; unsupportedReason: string | null
}
export type AvailabilityDerivation = 'observed' | 'derived'
export type CanonicalAvailability = EffectiveDatedRecord & {
  canonicalPlayerId: string | null; sport: string; source: string; sourcePlayerId: string | null
  availabilityType: string; availabilityStatus: string; rosterStatus: string | null; practiceStatus: string | null; gameDesignation: string | null; leagueEligibilityStatus: string | null
  derivationType: AvailabilityDerivation; derivationVersion: string | null; inputReferences: string[]
  freshnessStatus: FreshnessStatus; coverageStatus: CoverageStatus; provenance: string; unsupportedReason: string | null
}
export type DepthChartOrigin = 'provider_supplied' | 'derived'
export type CanonicalDepthChart = EffectiveDatedRecord & {
  canonicalTeamId: string; canonicalPlayerId: string | null; sport: string; source: string; positionDetail: string
  depthRole: string | null; depthRank: number | null; unit: string | null; isStarter: boolean | null; origin: DepthChartOrigin
  freshnessStatus: FreshnessStatus; coverageStatus: CoverageStatus; identityResolutionState: IdentityResolutionState; provenance: string; unsupportedReason: string | null
}
export type ProjectionOrigin = 'provider_projection' | 'allfantasy_projection'
export type CanonicalProjection = EffectiveDatedRecord & {
  canonicalPlayerId: string | null; sport: string; source: string; projectionType: ProjectionOrigin
  targetSeason: string | null; targetWeekOrPeriod: string | null; targetGameId: string | null; leagueFormat: string | null; scoringFormat: string | null; positionContext: string | null
  projectedFantasyPoints: number | null; confidenceBand: string | null; coverageStatus: CoverageStatus; freshnessStatus: FreshnessStatus; modelVersion: string | null
  identityResolutionState: IdentityResolutionState; provenance: string; unsupportedReason: string | null
}
export type CanonicalCorrection = {
  id: string; domain: string; canonicalRecordId: string; correctsRecordId: string | null; supersedesRecordId: string | null
  source: string; sourceCorrectionId: string; reasonCode: string; reasonDescription: string | null
  previousContentHash: string | null; correctedContentHash: string | null; effectiveAt: string; receivedAt: string; provenance: string; version: number
}
export type CanonicalPlayerTeamHistory = EffectiveDatedRecord & {
  canonicalPlayerId: string; canonicalTeamId: string; sport: string; source: string; relationshipType: string
  startEffectiveAt: string; endEffectiveAt: string | null; freshnessStatus: FreshnessStatus; identityResolutionState: IdentityResolutionState; provenance: string
}
export type CanonicalPlayerPositionHistory = EffectiveDatedRecord & {
  canonicalPlayerId: string; sport: string; source: string; providerPosition: string | null; canonicalDetailedPosition: string
  startEffectiveAt: string; endEffectiveAt: string | null; freshnessStatus: FreshnessStatus; identityResolutionState: IdentityResolutionState; provenance: string
}

// ── normalizers (provider terminology mapped; original preserved in provenance) ──
/** Normalize a raw API-Sports injury (provider-supplied) into the canonical injury contract. Unknown → unknown; never inferred. */
export function normalizeApiSportsInjury(raw: { player?: { id?: number | string; name?: string }; team?: { id?: number | string }; date?: string; status?: string; description?: string }, opts: { retrievedAt: string; freshnessStatus?: FreshnessStatus } ): CanonicalInjury {
  const status = (raw.status ?? '').trim() || 'unknown'
  const effectiveAt = raw.date ?? opts.retrievedAt
  const ch = contentHash(['api_sports', raw.player?.id, status, raw.description, effectiveAt])
  return {
    id: `inj_api_sports_${raw.player?.id ?? 'na'}_${ch}`,
    canonicalPlayerId: null, sport: 'NFL', source: 'api_sports', sourcePlayerId: raw.player?.id != null ? String(raw.player.id) : null, sourceTeamId: raw.team?.id != null ? String(raw.team.id) : null,
    injuryType: null, bodyArea: null, status, practiceStatus: null, gameDesignation: null, description: raw.description ?? (raw.player?.name ? `${raw.player.name} (${status})` : null),
    reportedAt: raw.date ?? null, effectiveAt, retrievedAt: opts.retrievedAt, estimatedReturnAt: null, resolvedAt: null,
    freshnessStatus: opts.freshnessStatus ?? 'fresh', coverageStatus: 'covered', identityResolutionState: 'unresolved', // api-sports player ids are not canonical yet
    provenance: `api_sports:injuries (raw status="${raw.status ?? ''}")`, unsupportedReason: null, contentHash: ch, version: 1, isActive: true, correctionOfId: null, supersedesId: null,
  }
}

// ── runtime ports (consumers use these, never a DB repository) ───────────────
export interface CanonicalInjuryPort { current(args: { canonicalPlayerId?: string; sourcePlayerId?: string; sport: string }): Promise<CanonicalInjury | null>; asOf(args: { sourcePlayerId: string; asOf: string }): Promise<CanonicalInjury | null> }
export interface CanonicalAvailabilityPort { current(args: { canonicalPlayerId: string; sport: string }): Promise<CanonicalAvailability | null> }
export interface CanonicalDepthChartPort { forTeam(args: { canonicalTeamId: string; unit?: string }): Promise<CanonicalDepthChart[]> }
export interface CanonicalProjectionPort { get(args: { canonicalPlayerId: string; targetWeekOrPeriod: string; scoringFormat: string }): Promise<CanonicalProjection | null> }
export interface CanonicalCorrectionPort { lineage(args: { domain: string; canonicalRecordId: string }): Promise<CanonicalCorrection[]> }
export interface CanonicalPlayerTeamHistoryPort { history(args: { canonicalPlayerId: string; asOf?: string }): Promise<CanonicalPlayerTeamHistory[]> }
export interface CanonicalPlayerPositionHistoryPort { history(args: { canonicalPlayerId: string; asOf?: string }): Promise<CanonicalPlayerPositionHistory[]> }
