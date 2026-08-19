/**
 * Fantasy OS Phase 5H-c — governed canonical IMAGE service (pure; no DB, no provider access, no fetch).
 *
 * ONE deterministic precedence + validation policy for entity imagery. Callers (or provider adapters) resolve
 * candidate image URLs from their sources and hand them here; this module validates each candidate, applies a
 * fixed source precedence, and returns a single governed `CanonicalImageReference` (or an honest placeholder).
 *
 * It does NOT fetch. Provider-specific fields never enter or leave — only the governed contract does. A weaker
 * valid source can never override a stronger valid source; empty/invalid/known-broken URLs are rejected;
 * player/team/league entities never share a record; sports are isolated (no football fallback for another sport).
 */

export type CanonicalImageEntityType = 'player' | 'team' | 'league'
export type CanonicalImageType = 'headshot' | 'logo'
/** Image imagery spans more sports than the football-only position service; each stays isolated. */
export type CanonicalImageSport = 'NFL' | 'NCAAF' | 'NBA' | 'NCAAB' | 'MLB' | 'NHL' | 'SOCCER'

/** Precedence tiers — lower rank = stronger source. A valid stronger source is never overwritten by a weaker one. */
export type CanonicalImageSourceTier =
  | 'verified_official' // 1 — official/highest-authority provider image
  | 'verified_secondary' // 2 — verified secondary sports provider
  | 'approved_fallback' // 3 — approved existing asset / managed fallback
  | 'placeholder' // 4 — sport-appropriate placeholder (honest "no real image")

export const IMAGE_SOURCE_TIER_RANK: Record<CanonicalImageSourceTier, number> = {
  verified_official: 1,
  verified_secondary: 2,
  approved_fallback: 3,
  placeholder: 4,
}

export type ImageValidationStatus = 'valid' | 'rejected_empty' | 'rejected_invalid_url' | 'rejected_known_broken' | 'rejected_non_image' | 'placeholder'
export type ImageFreshnessStatus = 'fresh' | 'stale' | 'unknown'

/** A candidate image a caller/adapter resolved from one source. `url` may be missing/empty — it will be rejected. */
export type ImageCandidate = {
  tier: CanonicalImageSourceTier
  source: string // caller-supplied source label (an official provider, a secondary provider, a managed asset, etc.)
  sourceEntityId?: string | null
  url?: string | null
  imageType: CanonicalImageType
  sport: CanonicalImageSport
  width?: number | null
  height?: number | null
  retrievedAt?: string | null
  effectiveAt?: string | null
  freshnessStatus?: ImageFreshnessStatus
}

/** The governed canonical image reference — the ONLY shape consumers receive. */
export type CanonicalImageReference = {
  entityType: CanonicalImageEntityType
  canonicalEntityId: string
  sport: CanonicalImageSport
  imageType: CanonicalImageType
  source: string
  sourceEntityId: string | null
  url: string | null // null when only a placeholder applies (honest "no real image")
  retrievedAt: string | null
  effectiveAt: string | null
  validationStatus: ImageValidationStatus
  freshnessStatus: ImageFreshnessStatus
  fallbackRank: number // the tier rank actually chosen (1..4)
  width: number | null
  height: number | null
  provenance: string
  isPlaceholder: boolean
  unsupportedReason: string | null
}

/**
 * Validate a candidate image URL. Rejects empty, non-http(s), syntactically invalid, data: URIs (synthesized
 * placeholders), and any URL in the caller-supplied known-broken set. Pure — no network probing.
 */
export function isValidImageUrl(url: string | null | undefined, knownBroken?: ReadonlySet<string>): boolean {
  if (url == null) return false
  const trimmed = String(url).trim()
  if (trimmed.length === 0) return false
  if (/^data:/i.test(trimmed)) return false
  if (knownBroken && knownBroken.has(trimmed)) return false
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return false
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:'
}

function classifyRejection(url: string | null | undefined, knownBroken?: ReadonlySet<string>): ImageValidationStatus {
  if (url == null || String(url).trim().length === 0) return 'rejected_empty'
  const trimmed = String(url).trim()
  if (knownBroken && knownBroken.has(trimmed)) return 'rejected_known_broken'
  if (/^data:/i.test(trimmed)) return 'rejected_non_image'
  return 'rejected_invalid_url'
}

export type ResolveCanonicalImageArgs = {
  entityType: CanonicalImageEntityType
  canonicalEntityId: string
  sport: CanonicalImageSport
  imageType: CanonicalImageType
  candidates: ImageCandidate[]
  knownBroken?: ReadonlySet<string>
  provenance?: string
}

/**
 * Resolve the governed canonical image for an entity from its candidates.
 *
 * Precedence: the VALID candidate with the strongest tier (lowest rank) wins; ties broken by input order. A
 * failed higher-ranked source falls through to a validated lower-ranked one. Candidates whose `entityType`/`sport`
 * do not match the requested entity/sport are ignored (entity + sport isolation — no cross-entity or cross-sport
 * fallback). If no candidate is valid, returns an honest placeholder reference with `url: null`.
 */
export function resolveCanonicalImage(args: ResolveCanonicalImageArgs): CanonicalImageReference {
  const { entityType, canonicalEntityId, sport, imageType, candidates, knownBroken } = args
  const provenance = args.provenance ?? 'canonical-image-service'

  // Sport + entity + type isolation: only candidates for THIS entity/sport/imageType are eligible.
  const eligible = candidates.filter((c) => c.sport === sport && c.imageType === imageType)

  // Consider candidates strongest-tier first; within a tier, preserve caller order (stable).
  const ordered = eligible
    .map((c, i) => ({ c, i, rank: IMAGE_SOURCE_TIER_RANK[c.tier] }))
    .sort((a, b) => (a.rank - b.rank) || (a.i - b.i))

  for (const { c, rank } of ordered) {
    if (c.tier === 'placeholder') continue // placeholders handled as the honest fallback below
    if (isValidImageUrl(c.url, knownBroken)) {
      return {
        entityType,
        canonicalEntityId,
        sport,
        imageType,
        source: c.source,
        sourceEntityId: c.sourceEntityId ?? null,
        url: String(c.url).trim(),
        retrievedAt: c.retrievedAt ?? null,
        effectiveAt: c.effectiveAt ?? null,
        validationStatus: 'valid',
        freshnessStatus: c.freshnessStatus ?? 'unknown',
        fallbackRank: rank,
        width: c.width ?? null,
        height: c.height ?? null,
        provenance,
        isPlaceholder: false,
        unsupportedReason: null,
      }
    }
  }

  // No valid non-placeholder source — represent missing imagery honestly.
  const placeholder = ordered.find((o) => o.c.tier === 'placeholder')?.c
  const rejectedExample = ordered.find((o) => o.c.tier !== 'placeholder')?.c
  return {
    entityType,
    canonicalEntityId,
    sport,
    imageType,
    source: placeholder?.source ?? 'placeholder',
    sourceEntityId: placeholder?.sourceEntityId ?? null,
    url: null,
    retrievedAt: placeholder?.retrievedAt ?? null,
    effectiveAt: placeholder?.effectiveAt ?? null,
    validationStatus: rejectedExample ? classifyRejection(rejectedExample.url, knownBroken) : 'placeholder',
    freshnessStatus: 'unknown',
    fallbackRank: IMAGE_SOURCE_TIER_RANK.placeholder,
    width: null,
    height: null,
    provenance,
    isPlaceholder: true,
    unsupportedReason: eligible.length === 0 ? 'no_candidate_for_entity_sport' : 'no_valid_image_source',
  }
}
