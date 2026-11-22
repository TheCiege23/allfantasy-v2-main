import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { getZombieScoringVariants } from '@/lib/sport-defaults/LeagueVariantRegistry'

const DYNASTY_LEAGUE_TYPE_SET = new Set(['dynasty', 'devy', 'c2c'])

const LOCKED_VARIANT_BY_LEAGUE_TYPE: Record<string, string> = {
  devy: 'devy_dynasty',
  c2c: 'merged_devy_c2c',
}

interface ResolveLeagueVariantInput {
  sport: string | null | undefined
  leagueType: string | null | undefined
  requestedVariant?: string | null
}

interface EffectiveLeagueVariantResult {
  variant: string | null
  variantLockedByLeagueType: boolean
}

function normalizeVariantKey(variant: string | null | undefined): string | null {
  const raw = String(variant ?? '').trim()
  if (!raw) return null

  const upper = raw.toUpperCase()
  const lower = raw.toLowerCase()

  if (upper === 'DEVY' || upper === 'DEVY_DYNASTY') return 'devy_dynasty'
  if (upper === 'C2C' || upper === 'MERGED_DEVY_C2C') return 'merged_devy_c2c'
  if (upper === 'IDP' || upper === 'DYNASTY_IDP') return upper
  if (upper === 'STANDARD' || upper === 'PPR' || upper === 'HALF_PPR' || upper === 'SUPERFLEX') {
    return upper
  }
  if (upper === 'TE_PREMIUM' || upper === 'TEP') return 'TE_PREMIUM'

  if (lower === 'no_playoff') return 'NO_PLAYOFF'
  return raw
}

function normalizeLeagueType(leagueType: string | null | undefined): string {
  return String(leagueType ?? '')
    .trim()
    .toLowerCase()
}

export function getLockedVariantForLeagueType(leagueType: string | null | undefined): string | null {
  const normalized = normalizeLeagueType(leagueType)
  return LOCKED_VARIANT_BY_LEAGUE_TYPE[normalized] ?? null
}

export function resolveEffectiveLeagueVariant(
  input: ResolveLeagueVariantInput
): EffectiveLeagueVariantResult {
  const sport = normalizeToSupportedSport(input.sport)
  const leagueType = normalizeLeagueType(input.leagueType)
  const hasLeagueType = leagueType.length > 0
  const lockedVariant = getLockedVariantForLeagueType(leagueType)
  if (lockedVariant) {
    return {
      variant: lockedVariant,
      variantLockedByLeagueType: true,
    }
  }

  /** Scoring preset must never resolve to Devy/C2C variant keys — those collide with dynasty-only API checks. */
  if (leagueType === 'zombie') {
    const nv = normalizeVariantKey(input.requestedVariant)
    if (nv === 'devy_dynasty' || nv === 'merged_devy_c2c') {
      return { variant: 'PPR', variantLockedByLeagueType: false }
    }
  }

  const normalizedVariant = normalizeVariantKey(input.requestedVariant)
  if (!normalizedVariant) {
    return {
      variant: null,
      variantLockedByLeagueType: false,
    }
  }

  if (sport === 'NFL' && hasLeagueType) {
    const variantUpper = normalizedVariant.toUpperCase()
    if (variantUpper === 'IDP' || variantUpper === 'DYNASTY_IDP') {
      return {
        variant: DYNASTY_LEAGUE_TYPE_SET.has(leagueType) ? 'DYNASTY_IDP' : 'IDP',
        variantLockedByLeagueType: false,
      }
    }
  }

  return {
    variant: normalizedVariant,
    variantLockedByLeagueType: false,
  }
}

export function resolveCreationVariantOrDefault(input: ResolveLeagueVariantInput): string {
  const lt = normalizeLeagueType(input.leagueType)
  const resolved = resolveEffectiveLeagueVariant(input)
  let v = resolved.variant ?? 'STANDARD'
  if (lt === 'zombie') {
    const allowed = new Set(getZombieScoringVariants(input.sport ?? 'NFL').map((x) => x.value))
    if (!allowed.has(v) || v === 'STANDARD' || v === 'SUPERFLEX') {
      v = 'PPR'
    }
    return v
  }
  return resolved.variant ?? 'STANDARD'
}

export function getLeagueVariantLabel(variant: string | null | undefined): string {
  const normalized = normalizeVariantKey(variant)
  if (!normalized) return 'Standard'

  const key = normalized.toUpperCase()
  if (key === 'STANDARD') return 'Standard'
  if (key === 'PPR') return 'PPR'
  if (key === 'HALF_PPR') return 'Half PPR'
  if (key === 'SUPERFLEX') return 'Superflex'
  if (key === 'TE_PREMIUM') return 'TEP'
  if (key === 'IDP') return 'IDP'
  if (key === 'DYNASTY_IDP') return 'Dynasty IDP'
  if (normalized === 'devy_dynasty') return 'Devy Dynasty'
  if (normalized === 'merged_devy_c2c') return 'Merged Devy C2C'
  return normalized
}
