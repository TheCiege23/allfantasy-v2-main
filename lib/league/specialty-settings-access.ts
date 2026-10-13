/**
 * Who may edit a league's SPECIALTY format rules, and why.
 *
 * Two doors, both commish-or-co-commish only:
 *   1. AF Commish / AF Supreme — the acting user's plan, OR the head commish's plan (the person who
 *      pays for the league covers their co-commishes).
 *   2. A one-time AF Token unlock for THIS league and THIS season, written to
 *      `League.settings.specialty_settings_unlock` by POST /api/leagues/[leagueId]/specialty-settings.
 *
 * 🛑 The paywall is enforced on the WRITE ROUTES via `specialtySettingsEditRefusal`, not by the tab.
 * A locked tab only explains it; the routes refuse it.
 *
 * ⚠ Keyed to the ONE launch constant (lib/monetization/paywallLaunch.ts) like every other launch
 * gate: before it, every commish edits free and nothing is charged; it switches on by itself.
 *
 * Gated formats are the AllFantasy-original concepts. Redraft, keeper, dynasty, best ball and IDP are
 * mainstream formats every host offers free, so their settings stay free — change
 * `GATED_SPECIALTY_FORMATS` (and the routes that call the refusal) to move that line.
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getLeagueRole, isCommissionerRole, type LeagueRole } from '@/lib/league/permissions'
import { EntitlementResolver } from '@/lib/subscription/EntitlementResolver'
import type { SubscriptionFeatureId } from '@/lib/subscription/types'
import { getFeatureTokenCostFromMatrix } from '@/lib/monetization/feature-monetization-matrix'
import { getPaywallStartsAt, isPaywallLive } from '@/lib/monetization/paywallLaunch'
import type { SpecialtyLeagueId } from '@/lib/specialty-league/types'

export const SPECIALTY_SETTINGS_FEATURE_ID: SubscriptionFeatureId = 'commissioner_specialty_settings'
export const SPECIALTY_SETTINGS_TOKEN_RULE = 'commissioner_specialty_settings_league_unlock' as const
export const SPECIALTY_UNLOCK_SETTINGS_KEY = 'specialty_settings_unlock'

export const GATED_SPECIALTY_FORMATS = [
  'guillotine',
  'survivor',
  'zombie',
  'big_brother',
  'salary_cap',
  'devy',
  'c2c',
  'tournament',
] as const
export type GatedSpecialtyFormat = (typeof GATED_SPECIALTY_FORMATS)[number]

/**
 * Body keys on the shared settings patch (`executeLeagueSettingsPatch`) that write specialty rules.
 * A patch carrying any of them — through ANY section, or the unsectioned `/api/league/settings` —
 * needs specialty access. Devy's config blob is the only one today; the other formats write through
 * their own routes, each of which calls `specialtySettingsEditRefusal` itself.
 */
export const SPECIALTY_GATED_PATCH_KEYS: ReadonlySet<string> = new Set<string>(['devyLeagueConfig'])

/** `League.settings` keys the specialty engines read, so a raw `settingsMerge` into them is gated too. */
export const SPECIALTY_GATED_SETTINGS_MERGE_KEYS: ReadonlySet<string> = new Set<string>([
  'devy_league_config',
  'guillotineEndgame',
])

export type SpecialtyUnlockRecord = {
  season: number
  unlockedByUserId: string
  unlockedAt: string
  tokenLedgerId: string | null
}

export type SpecialtySettingsAccess = {
  role: LeagueRole
  isCommish: boolean
  /** Acting user's or head commish's AF Commish / Supreme covers it. */
  coveredBySubscription: boolean
  /** A token unlock exists for this league's current season. */
  unlock: SpecialtyUnlockRecord | null
  canEdit: boolean
  season: number
  tokenCost: number | null
  /** False before the paywall launch: everything is open and the tab says when that ends. */
  paywallLive: boolean
  paywallStartsAt: string
}

/** Registry id each gated format is detected through. Salary Cap is not registered — see below. */
const REGISTRY_ID: Partial<Record<GatedSpecialtyFormat, SpecialtyLeagueId>> = {
  guillotine: 'guillotine',
  survivor: 'survivor',
  zombie: 'zombie',
  big_brother: 'big_brother',
  devy: 'devy',
  c2c: 'merged_devy_c2c',
  tournament: 'tournament',
}

/**
 * Which gated formats this league runs, using each format's own registry `detect` — the same test
 * its home screen and engines use, so the settings tab never disagrees with the league about what
 * it is. A detector that throws counts as "not this format" rather than failing the whole list.
 */
export async function detectGatedSpecialtyFormats(leagueId: string): Promise<GatedSpecialtyFormat[]> {
  // Lazy: the registry imports every format engine, and this module sits on the settings-save path.
  const { getSpecialtySpec } = await import('@/lib/specialty-league/registry')
  const checks = GATED_SPECIALTY_FORMATS.map(async (format): Promise<GatedSpecialtyFormat | null> => {
    try {
      if (format === 'salary_cap') {
        const row = await prisma.salaryCapLeagueConfig.findUnique({ where: { leagueId }, select: { id: true } })
        return row ? format : null
      }
      const id = REGISTRY_ID[format]
      const spec = id ? getSpecialtySpec(id) : null
      return spec && (await spec.detect(leagueId)) ? format : null
    } catch {
      return null
    }
  })
  return (await Promise.all(checks)).filter((f): f is GatedSpecialtyFormat => f != null)
}

export function specialtyUnlockIdempotencyKey(leagueId: string, season: number): string {
  return `specialty_settings_unlock:${leagueId}:${season}`
}

export function readSpecialtyUnlock(settings: unknown, season: number): SpecialtyUnlockRecord | null {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null
  const raw = (settings as Record<string, unknown>)[SPECIALTY_UNLOCK_SETTINGS_KEY]
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  // An unlock is for ONE season. A renewed league starts locked again.
  if (Number(r.season) !== season) return null
  if (typeof r.unlockedByUserId !== 'string' || typeof r.unlockedAt !== 'string') return null
  return {
    season,
    unlockedByUserId: r.unlockedByUserId,
    unlockedAt: r.unlockedAt,
    tokenLedgerId: typeof r.tokenLedgerId === 'string' ? r.tokenLedgerId : null,
  }
}

async function hasSpecialtyPlan(userId: string, email?: string | null): Promise<boolean> {
  const res = await new EntitlementResolver()
    .resolveForUser(userId, SPECIALTY_SETTINGS_FEATURE_ID, email)
    .catch(() => ({ hasAccess: false }))
  return Boolean(res.hasAccess)
}

export async function resolveSpecialtySettingsAccess(
  leagueId: string,
  userId: string,
  email?: string | null,
  now: Date = new Date(),
): Promise<SpecialtySettingsAccess | null> {
  const league = await prisma.league.findFirst({
    where: { id: leagueId },
    select: { userId: true, season: true, settings: true },
  })
  if (!league) return null

  const season = Number(league.season)
  const tokenCost = getFeatureTokenCostFromMatrix(SPECIALTY_SETTINGS_FEATURE_ID)
  const role = await getLeagueRole(leagueId, userId)
  const isCommish = isCommissionerRole(role)
  const unlock = readSpecialtyUnlock(league.settings, season)
  const paywallLive = isPaywallLive(now)
  const paywallStartsAt = getPaywallStartsAt().toISOString()
  const base = { role, isCommish, unlock, season, tokenCost, paywallLive, paywallStartsAt }

  if (!isCommish) return { ...base, coveredBySubscription: false, canEdit: false }

  let coveredBySubscription = await hasSpecialtyPlan(userId, email)
  if (!coveredBySubscription && league.userId && league.userId !== userId) {
    coveredBySubscription = await hasSpecialtyPlan(league.userId)
  }

  return { ...base, coveredBySubscription, canEdit: !paywallLive || coveredBySubscription || unlock != null }
}

/**
 * `null` when the user may write specialty settings on this league; otherwise the response to return.
 * 403 for a non-commish, 402 (with the upgrade path and token price) for a commish without access.
 */
export async function specialtySettingsEditRefusal(
  leagueId: string,
  userId: string,
  email?: string | null,
  now: Date = new Date(),
): Promise<NextResponse | null> {
  const access = await resolveSpecialtySettingsAccess(leagueId, userId, email, now)
  if (!access) return NextResponse.json({ error: 'League not found' }, { status: 404 })
  if (!access.isCommish) {
    return NextResponse.json({ error: 'Only the commish or a co-commish can change these settings.' }, { status: 403 })
  }
  if (access.canEdit) return null
  return NextResponse.json(
    {
      error: 'Specialty league settings need AF Commish, or unlock this league for the season with AF Tokens.',
      code: 'specialty_settings_locked',
      featureId: SPECIALTY_SETTINGS_FEATURE_ID,
      upgradePath: `/commissioner-upgrade?feature=${SPECIALTY_SETTINGS_FEATURE_ID}`,
      tokenCost: access.tokenCost,
    },
    { status: 402 },
  )
}

/**
 * 🛑 Guillotine rules live in `GuillotineLeagueConfig` — that is what the elimination engine reads.
 * The `League.guillotine*` columns (tiebreaker, eliminations per period, protected week 1…) are
 * written at creation and read by nothing, so an editor for them would save and change nothing.
 * The endgame is the exception: `resolveGuillotineEndgame` reads `settings.guillotineEndgame` FIRST
 * and the column last, so an endgame edit must write both (see the specialty-settings handler).
 */
export const GUILLOTINE_ENDGAMES = ['last_team_standing', 'final_four', 'final_three', 'final_two'] as const
export const GUILLOTINE_ENDGAME_THRESHOLD: Record<(typeof GUILLOTINE_ENDGAMES)[number], number> = {
  last_team_standing: 1,
  final_two: 2,
  final_three: 3,
  final_four: 4,
}
export const GUILLOTINE_TIEBREAK_STEPS = ['bench_points', 'season_points', 'previous_period', 'draft_slot', 'commissioner', 'random'] as const
export const GUILLOTINE_CORRECTION_WINDOWS = ['immediate', 'after_stat_corrections'] as const
export const GUILLOTINE_RELEASE_TIMINGS = ['immediate', 'next_waiver_run'] as const

export type GuillotineSettingsPatch = {
  endgame?: (typeof GUILLOTINE_ENDGAMES)[number]
  eliminationStartWeek?: number
  eliminationEndWeek?: number | null
  teamsPerChop?: number
  correctionWindow?: (typeof GUILLOTINE_CORRECTION_WINDOWS)[number]
  statCorrectionHours?: number
  tiebreakerOrder?: Array<(typeof GUILLOTINE_TIEBREAK_STEPS)[number]>
  rosterReleaseTiming?: (typeof GUILLOTINE_RELEASE_TIMINGS)[number]
  commissionerOverride?: boolean
}

/** Parses a Guillotine settings patch. Unknown keys are ignored; a bad value is an error string. */
export function parseGuillotineSettingsPatch(
  raw: Record<string, unknown>,
): { ok: true; patch: GuillotineSettingsPatch } | { ok: false; error: string } {
  const patch: GuillotineSettingsPatch = {}
  const int = (k: string, min: number, max: number): number | string | undefined => {
    if (raw[k] === undefined) return undefined
    const n = Number(raw[k])
    return Number.isInteger(n) && n >= min && n <= max ? n : `${k} must be a whole number from ${min} to ${max}`
  }
  const pick = <T extends string>(k: string, allowed: readonly T[]): T | string | undefined => {
    if (raw[k] === undefined) return undefined
    return typeof raw[k] === 'string' && (allowed as readonly string[]).includes(raw[k] as string)
      ? (raw[k] as T)
      : `${k} must be one of: ${allowed.join(', ')}`
  }
  const isErr = (v: unknown): v is string => typeof v === 'string' && v.includes(' must ')

  const endgame = pick('endgame', GUILLOTINE_ENDGAMES)
  if (isErr(endgame)) return { ok: false, error: endgame }
  if (endgame !== undefined) patch.endgame = endgame as GuillotineSettingsPatch['endgame']

  const start = int('eliminationStartWeek', 1, 18)
  if (isErr(start)) return { ok: false, error: start }
  if (start !== undefined) patch.eliminationStartWeek = start as number

  if (raw.eliminationEndWeek === null) patch.eliminationEndWeek = null
  else {
    const end = int('eliminationEndWeek', 1, 18)
    if (isErr(end)) return { ok: false, error: end }
    if (end !== undefined) patch.eliminationEndWeek = end as number
  }
  if (
    patch.eliminationStartWeek != null &&
    patch.eliminationEndWeek != null &&
    patch.eliminationEndWeek < patch.eliminationStartWeek
  ) {
    return { ok: false, error: 'eliminationEndWeek cannot be before eliminationStartWeek' }
  }

  const chop = int('teamsPerChop', 1, 4)
  if (isErr(chop)) return { ok: false, error: chop }
  if (chop !== undefined) patch.teamsPerChop = chop as number

  const window = pick('correctionWindow', GUILLOTINE_CORRECTION_WINDOWS)
  if (isErr(window)) return { ok: false, error: window }
  if (window !== undefined) patch.correctionWindow = window as GuillotineSettingsPatch['correctionWindow']

  const hours = int('statCorrectionHours', 0, 96)
  if (isErr(hours)) return { ok: false, error: hours }
  if (hours !== undefined) patch.statCorrectionHours = hours as number

  const release = pick('rosterReleaseTiming', GUILLOTINE_RELEASE_TIMINGS)
  if (isErr(release)) return { ok: false, error: release }
  if (release !== undefined) patch.rosterReleaseTiming = release as GuillotineSettingsPatch['rosterReleaseTiming']

  if (raw.commissionerOverride !== undefined) {
    if (typeof raw.commissionerOverride !== 'boolean') return { ok: false, error: 'commissionerOverride must be true or false' }
    patch.commissionerOverride = raw.commissionerOverride
  }

  if (raw.tiebreakerOrder !== undefined) {
    const list = raw.tiebreakerOrder
    if (
      !Array.isArray(list) ||
      list.length === 0 ||
      list.length > GUILLOTINE_TIEBREAK_STEPS.length ||
      new Set(list).size !== list.length ||
      !list.every((s) => typeof s === 'string' && (GUILLOTINE_TIEBREAK_STEPS as readonly string[]).includes(s))
    ) {
      return { ok: false, error: `tiebreakerOrder must be a list of distinct steps from: ${GUILLOTINE_TIEBREAK_STEPS.join(', ')}` }
    }
    patch.tiebreakerOrder = list as GuillotineSettingsPatch['tiebreakerOrder']
  }

  return { ok: true, patch }
}
