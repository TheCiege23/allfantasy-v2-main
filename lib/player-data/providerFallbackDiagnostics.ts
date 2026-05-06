/**
 * Dev / QA helpers for provider fallback visibility — no secrets, no raw provider blobs.
 */

import type { PlayerDataSurface, UnifiedPlayerProductView } from '@/lib/player-data/unifiedPlayerProductView'
import type { DataDomain } from '@/lib/providers/providerFallbackPolicy'
import { getPrimaryProviderForDomain } from '@/lib/providers/providerFallbackPolicy'

export type ProviderFallbackDiagnostics = {
  surface: PlayerDataSurface
  sport: string
  primaryByDomain: Partial<Record<DataDomain, string>>
  missingDomains: DataDomain[]
  playerId: string
  /** Coarse source labels already on the unified row */
  fallbackSources?: {
    profile?: string | null
    stats?: string | null
    projections?: string | null
    nflRookie?: string | null
  }
  lowConfidenceFields?: string[]
  duplicateIdentityWarning?: boolean
}

const DIAG_DOMAINS: DataDomain[] = [
  'player_profile',
  'player_images',
  'player_stats',
  'injuries',
  'adp',
  'ai_adp',
  'rookie_experience',
]

function jsonPrettyEmpty(stats: Record<string, unknown>): boolean {
  const keys = Object.keys(stats).filter((k) => k !== 'projectionSource')
  return keys.length <= 2
}

export function buildPlayerFallbackDiagnostics(
  view: UnifiedPlayerProductView,
  surface: PlayerDataSurface,
): ProviderFallbackDiagnostics {
  const sport = view.unified.sport
  const primaryByDomain: Partial<Record<DataDomain, string>> = {}
  for (const d of DIAG_DOMAINS) {
    primaryByDomain[d] = getPrimaryProviderForDomain(d, String(sport))
  }

  const missingDomains: DataDomain[] = []
  if (!view.unified.headshotUrl) missingDomains.push('player_images')
  if (jsonPrettyEmpty(view.unified.normalizedStats)) missingDomains.push('player_stats')
  if (!view.unified.injuryStatus && !view.injuryStatus) missingDomains.push('injuries')
  if (view.adp == null && view.unified.adp == null) missingDomains.push('adp')
  if (view.aiAdp == null) missingDomains.push('ai_adp')
  if (view.unified.experience == null || view.unified.experience.status === 'unknown') {
    missingDomains.push('rookie_experience')
  }

  const lowConfidenceFields: string[] = []
  if (view.unified.lowConfidence) lowConfidenceFields.push('unified_low_confidence')

  return {
    surface,
    sport: String(sport),
    primaryByDomain,
    missingDomains,
    playerId: view.unified.playerId,
    fallbackSources: {
      profile: view.unified.profileSource,
      stats: view.unified.statsSource,
      projections: view.unified.projectionsSource,
      nflRookie: view.unified.nflRookie?.source ?? null,
    },
    lowConfidenceFields: lowConfidenceFields.length ? lowConfidenceFields : undefined,
    duplicateIdentityWarning: view.unified.lowConfidence === true,
  }
}

/** Query `?debugPlayerData=1` or dev mode enables diagnostics attachment on API responses. */
export function resolveIncludePlayerDataDiagnostics(
  searchParams: URLSearchParams,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const q = searchParams.get('debugPlayerData')
  if (q === '1' || q === 'true') return true
  return env.NODE_ENV === 'development'
}

/** Compact line for server logs (no PII beyond player id). */
export function logPrefixForSurface(surface: string, diag: ProviderFallbackDiagnostics): string {
  return `[${surface} normalized player data] id=${diag.playerId} sport=${diag.sport} missing=${diag.missingDomains.join(',') || 'none'}`
}

const SECRET_KEYS = /(?:secret|token|password|api[_-]?key|authorization)/i

/** Safe subset for logs — drops oversized payloads and obvious secret-bearing keys. */
export function redactDiagnosticsForLog(diag: ProviderFallbackDiagnostics): Record<string, unknown> {
  const json = JSON.stringify(diag)
  const parsed = JSON.parse(json) as Record<string, unknown>
  for (const key of Object.keys(parsed)) {
    if (SECRET_KEYS.test(key)) delete parsed[key]
  }
  return parsed
}

export type LogNormalizedDiagnosticsOptions = {
  /** Max rows (default 5) */
  limit?: number
  /** Defaults true in development only */
  enabled?: boolean
}

/** Structured console logging for QA — bounded rows, no blobs. */
export function logNormalizedPlayerDataDiagnostics(
  surface: string,
  diagnostics: ProviderFallbackDiagnostics[] | undefined | null,
  options?: LogNormalizedDiagnosticsOptions,
): void {
  const enabled =
    options?.enabled ??
    (typeof process !== 'undefined' && process.env.NODE_ENV === 'development')
  if (!enabled || !diagnostics?.length) return
  const limit = Math.min(options?.limit ?? 5, diagnostics.length)
  for (let i = 0; i < limit; i += 1) {
    const d = diagnostics[i]!
    console.info(logPrefixForSurface(surface, d), redactDiagnosticsForLog(d))
  }
}
