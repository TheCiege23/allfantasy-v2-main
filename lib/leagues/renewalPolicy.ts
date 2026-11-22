import type { LeagueLifecycleState } from '@prisma/client'

export type RenewalKind =
  | 'dynasty_family'
  | 'keeper_carry'
  | 'redraft_reset'
  | 'tournament_feeder'
  | 'specialty_default'

/** Dynasty / C2C / Devy — full roster + managers + history carry (Sleeper-style dynasty continuity). */
const DYNASTY_FAMILY_VARIANTS = new Set([
  'dynasty',
  'devy',
  'merged_devy_c2c',
  'c2c',
  'dynasty_idp',
])

/**
 * Whether the league season is over enough to show commissioner renewal (all sports).
 * Uses status, settings phases, and canonical lifecycle when present.
 * Archived leagues do not show renewal (league is closed / read-only).
 */
export function isSeasonOverForRenewal(args: {
  status?: string | null
  dynastySeasonPhase?: string | null
  seasonPhase?: string | null
  lifecycleState?: LeagueLifecycleState | string | null
}): boolean {
  const lifecycle = String(args.lifecycleState ?? '').toLowerCase()
  if (lifecycle === 'archived') {
    return false
  }

  const status = (args.status ?? '').toLowerCase()
  const phase = String(args.dynastySeasonPhase ?? args.seasonPhase ?? '').toLowerCase()

  if (lifecycle === 'completed' || lifecycle === 'offseason') {
    return true
  }

  if (
    status === 'complete' ||
    status === 'completed' ||
    status === 'post_season' ||
    status === 'offseason'
  ) {
    return true
  }
  if (phase === 'offseason' || phase === 'complete' || phase === 'completed') {
    return true
  }

  return false
}

/** Whether the league is actively in renewal window (managers confirming slots). */
export function isInRenewalWindow(args: {
  lifecycleState?: LeagueLifecycleState | string | null
}): boolean {
  return String(args.lifecycleState ?? '').toLowerCase() === 'renewal_pending'
}

export function resolveLeagueVariantKey(leagueVariant: string | null | undefined, settings?: Record<string, unknown> | null): string {
  const fromSettings = settings && typeof settings.league_type === 'string' ? settings.league_type : ''
  return String(leagueVariant || fromSettings || 'redraft').toLowerCase()
}

export function renewalKindFromSelection(args: {
  leagueVariant: string | null | undefined
  settings?: Record<string, unknown> | null
  /** Selected target type in renew modal (redraft | keeper | dynasty) */
  selectedType: string
  isDynasty: boolean
}): RenewalKind {
  const variant = resolveLeagueVariantKey(args.leagueVariant, args.settings)
  if (variant === 'tournament' || settingsLeagueTypeIsTournament(args.settings)) {
    return 'tournament_feeder'
  }

  const t = normalizeRenewalModalType(args.selectedType)
  /** Commissioner explicitly chose next year format (Sleeper allows switching before the new season). */
  if (t === 'redraft') return 'redraft_reset'
  if (t === 'keeper') return 'keeper_carry'
  if (t === 'dynasty' || DYNASTY_FAMILY_VARIANTS.has(variant) || args.isDynasty) {
    return 'dynasty_family'
  }
  return 'redraft_reset'
}

function settingsLeagueTypeIsTournament(settings?: Record<string, unknown> | null): boolean {
  const lt = settings && typeof settings.league_type === 'string' ? settings.league_type.toLowerCase() : ''
  return lt === 'tournament'
}

/** Map API/modal variants (c2c, devy, …) to the three renewal radio values. */
export function normalizeRenewalModalType(raw: string): 'redraft' | 'keeper' | 'dynasty' {
  const s = raw.toLowerCase()
  if (s === 'redraft') return 'redraft'
  if (s === 'keeper') return 'keeper'
  if (s === 'dynasty' || DYNASTY_FAMILY_VARIANTS.has(s)) return 'dynasty'
  return 'redraft'
}

/**
 * POST /renew: should clear canonical `Roster` player data for a fresh draft year (Sleeper redraft reset).
 */
export function shouldResetRostersForRenewal(kind: RenewalKind): boolean {
  return kind === 'redraft_reset'
}

/**
 * POST /renew already moved this league INTO `season`, and that season has not been played since.
 *
 * `renewal_completed_for_season` alone cannot say so: it is still `season` when that season ends and
 * the next renewal is legitimate. So the marker counts only while nothing has happened after
 * `renewal_completed_at` — no lifecycle transition stamped later (drafting, completing and entering
 * offseason all stamp `lastTransitionAt`), and no status/phase reporting the season over again
 * (renewal resets both to pre-season). A marker without a timestamp predates this guard and cannot
 * be ordered against anything, so it does not block.
 */
export function isAlreadyRenewedIntoSeason(args: {
  season: number
  status?: string | null
  settings?: Record<string, unknown> | null
  lifecycleMetadata?: unknown
}): boolean {
  const settings = args.settings ?? {}
  if (settings.renewal_completed_for_season !== args.season) return false
  const renewedAt = typeof settings.renewal_completed_at === 'string' ? Date.parse(settings.renewal_completed_at) : NaN
  if (!Number.isFinite(renewedAt)) return false

  const meta = args.lifecycleMetadata && typeof args.lifecycleMetadata === 'object' && !Array.isArray(args.lifecycleMetadata)
    ? (args.lifecycleMetadata as Record<string, unknown>)
    : {}
  const movedAt = typeof meta.lastTransitionAt === 'string' ? Date.parse(meta.lastTransitionAt) : NaN
  if (Number.isFinite(movedAt) && movedAt > renewedAt) return false

  // Lifecycle deliberately left out: renewal does not move it, so a stale `offseason` proves nothing.
  return !isSeasonOverForRenewal({
    status: args.status,
    dynastySeasonPhase: settings.dynastySeasonPhase as string | undefined,
    seasonPhase: settings.season_phase as string | undefined,
  })
}
