/**
 * Fantasy OS Phase 5H-b — governed canonical position service (pure; no DB, no provider access).
 *
 * ONE source of truth for player position normalization. It preserves the DETAILED provider/canonical position
 * and derives broad fantasy eligibility SEPARATELY and only when the league's own rules define the broad bucket.
 * Detailed positions are never destroyed; unsupported provider positions are classified `UNKNOWN`, never guessed.
 * League legality is NOT altered here — eligibility is derived from the league rules the caller supplies.
 */
export type CanonicalSport = 'NFL' | 'NCAAF'

/**
 * The ONLY sports this governed position service understands. Position abbreviations are sport-specific
 * (an NFL `DE` and a soccer/basketball code are not the same domain), so normalization is confined to the
 * football sports the canonical map was built for. Any other sport is isolated — its positions are NEVER
 * interpreted through the football map (no cross-sport fallback), preventing a soccer/NBA/MLB/NHL code from
 * silently resolving to a plausible NFL position. Callers for other sports keep their own sport-scoped logic.
 */
export const SUPPORTED_POSITION_SPORTS = ['NFL', 'NCAAF'] as const

/** True only for the football sports this service governs. Use to gate cross-sport misuse before normalizing. */
export function isSupportedPositionSport(sport: string | null | undefined): sport is CanonicalSport {
  return sport != null && (SUPPORTED_POSITION_SPORTS as readonly string[]).includes(String(sport).toUpperCase())
}

/** Detailed canonical position kept verbatim (e.g. DE/DT/NT/EDGE, CB/S/FS/SS, OLB/ILB/MLB). */
export type CanonicalPositionRecord = {
  providerPosition: string
  canonicalPrimaryPosition: string
  sport: CanonicalSport
  isIDP: boolean
  isUnknown: boolean
  source: string
  effectiveDate: string | null
}

/** IDP detailed positions (defense/special-teams individual). */
const IDP_POSITIONS = new Set(['DE', 'DT', 'NT', 'EDGE', 'DL', 'CB', 'S', 'FS', 'SS', 'DB', 'OLB', 'ILB', 'MLB', 'LB'])

/** Provider position aliases → detailed canonical. Preserves detail; NEVER collapses to a broad bucket here. */
const PROVIDER_TO_CANONICAL: Record<string, string> = {
  QB: 'QB', RB: 'RB', HB: 'RB', FB: 'FB', WR: 'WR', TE: 'TE', K: 'K', PK: 'K', P: 'P', LS: 'LS',
  DEF: 'DEF', DST: 'DEF', 'D/ST': 'DEF',
  DE: 'DE', DT: 'DT', NT: 'NT', EDGE: 'EDGE', DL: 'DL',
  CB: 'CB', S: 'S', FS: 'FS', SS: 'SS', DB: 'DB',
  OLB: 'OLB', ILB: 'ILB', MLB: 'MLB', LB: 'LB',
  OL: 'OL', OT: 'OT', OG: 'OG', C: 'C', G: 'G', T: 'T',
}

/** Normalize one provider position to a detailed canonical record. Unknown providers → `UNKNOWN` (never inferred). */
export function normalizeProviderPosition(providerPosition: string | null | undefined, sport: CanonicalSport, opts: { source?: string; effectiveDate?: string | null } = {}): CanonicalPositionRecord {
  const raw = String(providerPosition ?? '').trim().toUpperCase()
  // Sport isolation: only the football sports are interpreted through the canonical map. Any other sport is
  // deterministically UNKNOWN — never a plausible football position (no cross-sport fallback).
  const canonical = isSupportedPositionSport(sport) ? (PROVIDER_TO_CANONICAL[raw] ?? 'UNKNOWN') : 'UNKNOWN'
  const isUnknown = canonical === 'UNKNOWN'
  return {
    providerPosition: String(providerPosition ?? ''),
    canonicalPrimaryPosition: canonical,
    sport,
    isIDP: !isUnknown && IDP_POSITIONS.has(canonical),
    isUnknown,
    source: opts.source ?? 'provider',
    effectiveDate: opts.effectiveDate ?? null,
  }
}

/**
 * League position rules — the ONLY governance for broad eligibility. `buckets` maps a broad fantasy slot the
 * league defines to the detailed positions it accepts (e.g. `{ DL: ['DE','DT','NT','EDGE','DL'], DB: [...],
 * LB: [...], FLEX: ['RB','WR','TE'] }`). If a league does not define a bucket, its members are NOT eligible for it.
 */
export type LeaguePositionRules = { buckets: Record<string, string[]> }

/** A reference NFL bucket set — provided as a DEFAULT only; real leagues supply their own governed rules. */
export const REFERENCE_NFL_BUCKETS: LeaguePositionRules = {
  buckets: {
    DL: ['DE', 'DT', 'NT', 'EDGE', 'DL'],
    LB: ['OLB', 'ILB', 'MLB', 'LB'],
    DB: ['CB', 'S', 'FS', 'SS', 'DB'],
    IDP_FLEX: ['DE', 'DT', 'NT', 'EDGE', 'DL', 'OLB', 'ILB', 'MLB', 'LB', 'CB', 'S', 'FS', 'SS', 'DB'],
    FLEX: ['RB', 'WR', 'TE'],
    SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
  },
}

/**
 * Derive the fantasy-eligible slots for a detailed canonical position, governed by the league's rules. Returns
 * the detailed position itself PLUS any broad bucket the league defines that includes it. Never collapses a
 * detailed position into a broad bucket the league did not define; `UNKNOWN` is eligible for nothing.
 */
export function deriveFantasyEligibility(canonicalPrimaryPosition: string, rules: LeaguePositionRules): string[] {
  const pos = String(canonicalPrimaryPosition ?? '').toUpperCase()
  if (!pos || pos === 'UNKNOWN') return []
  const eligible = new Set<string>([pos]) // the detailed position is always itself-eligible
  for (const [bucket, members] of Object.entries(rules.buckets ?? {})) {
    if (members.map((m) => m.toUpperCase()).includes(pos)) eligible.add(bucket)
  }
  return [...eligible]
}

/** Convenience: full canonical position + governed eligibility for a provider position. */
export function resolveCanonicalPosition(
  providerPosition: string | null | undefined,
  sport: CanonicalSport,
  rules: LeaguePositionRules,
  opts: { source?: string; effectiveDate?: string | null } = {},
): CanonicalPositionRecord & { eligibleFantasyPositions: string[] } {
  const record = normalizeProviderPosition(providerPosition, sport, opts)
  return { ...record, eligibleFantasyPositions: deriveFantasyEligibility(record.canonicalPrimaryPosition, rules) }
}
