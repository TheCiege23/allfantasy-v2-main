/**
 * Shared normalization for legacy POST `/api/league/create` (Quick Create, manual wizard)
 * and defensive defaults for canonical POST `/api/leagues` payloads.
 *
 * Keeps scoring tokens out of `leagueVariant` and aligns dynasty flags with `leagueType`.
 */

import { normalizeToSupportedSport } from '@/lib/sport-scope'

/** Tokens that must never be persisted as `leagueVariant` (scoring modes / aliases). */
const SCORING_LIKE_VARIANT_NORMALIZED = new Set([
  'ppr',
  'half_ppr',
  'full_ppr',
  'standard',
  'half',
  'full',
  'std',
  'non_ppr',
  'nonppr',
  'superflex',
  'idp',
  'points',
  'default',
  'classic',
])

function normalizeToken(raw: string): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/-/g, '_')
}

function isScoringLikeToken(token: string): boolean {
  const n = normalizeToken(token)
  if (!n) return false
  if (SCORING_LIKE_VARIANT_NORMALIZED.has(n)) return true
  if (n.endsWith('_ppr') || n.includes('ppr')) return true
  return false
}

/**
 * Removes bogus `leagueVariant` values that duplicate `scoring` or look like scoring presets.
 */
export function sanitizeLeagueVariantAgainstScoring(
  scoring: string | undefined | null,
  leagueVariant: string | undefined | null,
): string | undefined {
  if (leagueVariant == null) return undefined
  const v = String(leagueVariant).trim()
  if (!v) return undefined
  const s = scoring != null ? String(scoring).trim() : ''
  if (s && normalizeToken(v) === normalizeToken(s)) return undefined
  if (isScoringLikeToken(v)) return undefined
  return v
}

const NON_DYNASTY_EXPLICIT_TYPES = new Set([
  'keeper',
  'best_ball',
  'guillotine',
  'survivor',
  'tournament',
  'zombie',
  'salary_cap',
  'big_brother',
])

/**
 * When Quick Create says redraft + `isDynasty`, upgrade to `dynasty`.
 * Explicit non-dynasty concepts (keeper, …) win over `isDynasty`.
 */
export function normalizeQuickLeagueType(leagueType: string | undefined, isDynasty: boolean): string {
  const raw = normalizeToken(leagueType ?? '')
  if (!raw) return isDynasty ? 'dynasty' : 'redraft'
  if (NON_DYNASTY_EXPLICIT_TYPES.has(raw)) return raw
  if (raw === 'redraft' && isDynasty) return 'dynasty'
  return raw
}

function reconcileLegacyIsDynasty(leagueTypeNormalized: string, isDynastyInput: boolean): boolean {
  const lt = normalizeToken(leagueTypeNormalized)
  if (lt === 'dynasty' || lt === 'devy' || lt === 'c2c') return true
  if (NON_DYNASTY_EXPLICIT_TYPES.has(lt)) return false
  return isDynastyInput
}

export function clampLegacyLeagueSize(n: unknown): number {
  const x = typeof n === 'number' ? n : Number(n)
  if (!Number.isFinite(x)) return 12
  return Math.min(32, Math.max(4, Math.round(x)))
}

const DEFAULT_TIMEZONE = 'America/New_York'

type LegacyManualCreateNormalized = {
  name: string
  sport: string
  leagueType: string
  draftType: string
  leagueSize: number
  scoring: string
  isDynasty: boolean
  isSuperflex: boolean
  leagueVariant?: string
  platform: string
  settings: Record<string, unknown>
  scoringPresetId?: string
}

/**
 * Normalize Quick Create / legacy manual JSON before POST `/api/league/create`.
 */
export function normalizeLegacyManualCreateBody(input: {
  name: string
  sport: string
  leagueType?: string
  draftType?: string
  leagueSize?: number
  teamCount?: number
  scoring?: string
  isDynasty?: boolean
  isSuperflex?: boolean
  leagueVariant?: string | null
  platform?: string
  settings?: Record<string, unknown>
  scoringPresetId?: string
}): LegacyManualCreateNormalized {
  const name = String(input.name ?? '').trim()
  const sport = normalizeToSupportedSport(input.sport)
  const leagueType = normalizeQuickLeagueType(input.leagueType, input.isDynasty === true)
  const isDynasty = reconcileLegacyIsDynasty(leagueType, input.isDynasty === true)
  const draftType = normalizeToken(input.draftType ?? 'snake') || 'snake'
  const leagueSize = clampLegacyLeagueSize(input.leagueSize ?? input.teamCount ?? 12)
  const scoring = String(input.scoring ?? 'HALF_PPR').trim()
  const variant = sanitizeLeagueVariantAgainstScoring(scoring, input.leagueVariant)

  const settings: Record<string, unknown> = {
    ...(input.settings && typeof input.settings === 'object' && !Array.isArray(input.settings)
      ? input.settings
      : {}),
  }
  const tzKey =
    typeof settings.league_timezone === 'string' && settings.league_timezone.trim().length > 0
      ? 'league_timezone'
      : typeof settings.leagueTimezone === 'string' && String(settings.leagueTimezone).trim().length > 0
        ? 'leagueTimezone'
        : null
  if (!tzKey) {
    settings.league_timezone = DEFAULT_TIMEZONE
  }

  const out: LegacyManualCreateNormalized = {
    name,
    sport,
    leagueType,
    draftType,
    leagueSize,
    scoring,
    isDynasty,
    isSuperflex: input.isSuperflex === true,
    platform: input.platform ?? 'manual',
    settings,
  }
  if (variant) out.leagueVariant = variant
  if (input.scoringPresetId?.trim()) out.scoringPresetId = input.scoringPresetId.trim()
  return out
}

/**
 * Ensures canonical `/api/leagues` bodies always have a timezone string.
 */
export function finalizeCanonicalCreatePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const tz = payload.timezone
  if (typeof tz !== 'string' || !tz.trim()) {
    return { ...payload, timezone: DEFAULT_TIMEZONE }
  }
  return payload
}
