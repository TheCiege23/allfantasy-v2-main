/**
 * Aggregated exports for provider enrichment capability docs and audits (no runtime HTTP).
 */

export * from '@/lib/providers/providerFallbackPolicy'
export * from '@/lib/providers/providerMerge'
export * from '@/lib/providers/providerDomainCapabilities'

export {
  CLEARSPORTS_API_PUBLIC_BASE,
  CLEARSPORTS_NFL_CAPABILITIES,
  CLEARSPORTS_NFL_ENDPOINTS,
  CLEARSPORTS_NFL_QUERY_PARAMS,
  hasClearSportsExperienceSignal,
} from '@/lib/providers/clearSportsFieldMaps'
export { buildClearSportsNflUrl } from '@/lib/providers/clearSportsUrls'
export { THE_SPORTS_DB_CAPABILITIES, isTheSportsDbRookieExperienceSupported } from '@/lib/providers/theSportsDbCapabilities'
export {
  buildTheSportsDbV1Url,
  buildTheSportsDbV2Path,
  buildTheSportsDbV2Url,
  getTheSportsDbImagePreviewUrl,
  THE_SPORTS_DB_V1_FILES,
  THE_SPORTS_DB_V1_JSON_BASE,
  THE_SPORTS_DB_V2_JSON_BASE,
} from '@/lib/providers/theSportsDbUrls'
export {
  extractTheSportsDbExperienceSignals,
  extractTheSportsDbPlayerIdentity,
  extractTheSportsDbPlayerImages,
  extractTheSportsDbProfileEnrichment,
  extractTheSportsDbTeamImages,
  hasTheSportsDbExperienceSignal,
} from '@/lib/providers/theSportsDbFieldMaps'
