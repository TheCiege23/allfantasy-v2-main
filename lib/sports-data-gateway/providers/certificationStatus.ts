/**
 * Fantasy OS Phase 5H-d — provider certification status (pure; no secrets, no fetch, no DB).
 *
 * The honest, evidence-based certification verdict for every intended provider, from REAL requests performed in the
 * 5H-d proving run (2026-07-13, non-production). A provider is `certified`/`verified` ONLY because a real request
 * succeeded and (for certified) routed end-to-end through a canonical contract — never because a credential or client
 * file exists. This module is the backend contract for operator provider-observability (Part 13) and the source the
 * enforcement test checks so nothing is presented as connected without evidence (Part 14). It NEVER carries secret
 * values — only a structural `credentialPresent` boolean (env-var NAME presence).
 */

export type ProviderCertStatus =
  | 'CERTIFIED' // real request → canonical contract → (persistence or REQ-MIGRATION) → retrieval, proven end-to-end
  | 'VERIFIED' // real request + schema + canonical normalization proven; persistence REQ-MIGRATION
  | 'BLOCKED' // real request attempted and failed (provider/credential/capability) — reason recorded
  | 'REQUIRES_WIRING' // credential present but no clean adapter to probe through; needs a gateway adapter
  | 'CONFIGURED_NOT_VERIFIED' // credential present, no real request performed this phase
  | 'IMPORT_ONLY' // customer-authorized league import, not a sports-data provider

export type ProviderCertRecord = {
  provider: string
  status: ProviderCertStatus
  credentialPresent: boolean // structural (env-var NAME present) — NEVER a secret value
  lastVerifiedAt: string | null // ISO date of the real proving request, or null
  sportsVerified: string[]
  capabilitiesVerified: string[]
  canonicalRoute: string | null // which canonical contract the data was proven through
  persistence: 'certified_snapshot' | 'requires_migration' | 'none'
  blockedReason: string | null
  notes: string
}

/** Verdicts from the 5H-d proving run. Keep in sync with the per-provider SPORTS_DATA_*_CERTIFICATION.md reports. */
export const PROVIDER_CERTIFICATION: ProviderCertRecord[] = [
  {
    provider: 'espn',
    status: 'CERTIFIED',
    credentialPresent: true, // keyless public endpoints (no secret)
    lastVerifiedAt: '2026-07-13',
    sportsVerified: ['NFL'],
    capabilitiesVerified: ['schedules', 'games', 'statistics'],
    canonicalRoute: 'CanonicalGameSchedule + CanonicalPlayerGameStat',
    persistence: 'certified_snapshot',
    blockedReason: null,
    notes: 'Live: 16 canonical games (0 rejected) season 2026 w1; box score returned athlete rows. Stats observational, not a scoring input.',
  },
  {
    provider: 'sleeper',
    status: 'CERTIFIED',
    credentialPresent: true, // keyless public API
    lastVerifiedAt: '2026-07-13',
    sportsVerified: ['NFL'],
    capabilitiesVerified: ['players', 'identity', 'rosters', 'transactions', 'draft_data'],
    canonicalRoute: 'CanonicalPlayer + identity crosswalk',
    persistence: 'certified_snapshot',
    blockedReason: null,
    notes: 'Live: 12,200 players; 6,736 deterministic sleeper↔espn dual-id crosswalk rows. Adapter purity (5H-b) holds.',
  },
  {
    provider: 'fantasycalc',
    status: 'CERTIFIED',
    credentialPresent: true, // keyless public API
    lastVerifiedAt: '2026-07-13',
    sportsVerified: ['NFL'],
    capabilitiesVerified: ['valuation', 'ranking', 'adp'],
    canonicalRoute: 'CanonicalPlayerValue (boundary-separated)',
    persistence: 'requires_migration',
    blockedReason: null,
    notes: 'Live: 463 values → distinct provider_valuation + ranking records (never merged). Value = provider valuation, NOT observed sports truth. Value egress still in lib/fantasycalc(-db).ts (REQ-WIRING); certified PlayerValue table REQ-MIGRATION.',
  },
  {
    provider: 'thesportsdb',
    status: 'VERIFIED',
    credentialPresent: true,
    lastVerifiedAt: '2026-07-13',
    sportsVerified: ['NFL'],
    capabilitiesVerified: ['player_headshots'],
    canonicalRoute: 'CanonicalImageReference (verified_secondary tier)',
    persistence: 'requires_migration',
    blockedReason: null,
    notes: 'Live: real player headshot URL → resolveCanonicalImage validated (rank 2, not placeholder). Full image capability certification needs a PlayerImage/TeamImage table (REQ-MIGRATION) + adoption.',
  },
  {
    provider: 'cfbd',
    status: 'VERIFIED',
    credentialPresent: true,
    lastVerifiedAt: '2026-07-13',
    sportsVerified: ['NCAAF'],
    capabilitiesVerified: ['rosters', 'positions'],
    canonicalRoute: 'canonicalPosition (NCAAF, detail preserved)',
    persistence: 'requires_migration',
    blockedReason: null,
    notes: 'Live: 133 Alabama 2024 roster rows, 16 distinct positions → canonicalPosition (DL→DL IDP, OL→OL, LS→LS), NCAAF sport-isolated. NCAAF↔NFL identity continuity requires a governed transition mapping (not assumed). Certified snapshot persistence REQ-MIGRATION.',
  },
  {
    provider: 'api_sports',
    status: 'VERIFIED',
    credentialPresent: true,
    lastVerifiedAt: '2026-07-13',
    sportsVerified: ['SOCCER'],
    capabilitiesVerified: ['teams'],
    canonicalRoute: null,
    persistence: 'requires_migration',
    blockedReason: null,
    notes: 'Live: 20 soccer teams (EPL 2023) via x-apisports-key. Soccer is OUTSIDE the NFL/NCAAF canonical position/value scope — a soccer canonical contract is REQ-NORMALIZE. Per-sport/product schemas must stay isolated.',
  },
  {
    provider: 'clearsports',
    status: 'BLOCKED',
    credentialPresent: true,
    lastVerifiedAt: null,
    sportsVerified: [],
    capabilitiesVerified: [],
    canonicalRoute: null,
    persistence: 'none',
    blockedReason: 'auth probe api-keys/me returned HTTP 500 (provider-side error). Credential structurally present but the request does not succeed — NOT connected.',
    notes: 'Do NOT present as connected. Re-attempt when the provider endpoint responds; capabilities unproven.',
  },
  {
    provider: 'rolling_insights',
    status: 'REQUIRES_WIRING',
    credentialPresent: true,
    lastVerifiedAt: null,
    sportsVerified: [],
    capabilitiesVerified: [],
    canonicalRoute: null,
    persistence: 'none',
    blockedReason: 'legacy client (lib/upstream-apis.ts) is DB-coupled (requires a real prisma deps object); it cannot be cleanly probed without a dedicated gateway adapter. A clean providers/rolling-insights.ts adapter is needed before a live request can be certified.',
    notes: 'Credentials (multiple ROLLING_INSIGHTS_*) structurally present. Live verification deferred to a dedicated adapter increment — NOT connected until then.',
  },
]

/** Operator-safe summary (Part 13): per-provider status + structural credential flag; NEVER secret values. */
export function summarizeProviderCertification(records: ProviderCertRecord[] = PROVIDER_CERTIFICATION) {
  const by = (s: ProviderCertStatus) => records.filter((r) => r.status === s).map((r) => r.provider)
  return {
    certified: by('CERTIFIED'),
    verified: by('VERIFIED'),
    blocked: by('BLOCKED'),
    requiresWiring: by('REQUIRES_WIRING'),
    configuredNotVerified: by('CONFIGURED_NOT_VERIFIED'),
    total: records.length,
    // a provider may be presented as "connected" ONLY if certified or verified via a real request
    connectable: records.filter((r) => r.status === 'CERTIFIED' || r.status === 'VERIFIED').map((r) => r.provider),
  }
}

/** True only when a provider has real request evidence (certified or verified). Used to gate "connected" claims. */
export function isProviderConnectable(provider: string, records: ProviderCertRecord[] = PROVIDER_CERTIFICATION): boolean {
  const r = records.find((x) => x.provider === provider)
  return !!r && (r.status === 'CERTIFIED' || r.status === 'VERIFIED')
}
