/**
 * Resolves the active fantasy week for scoring and related jobs.
 * Never silently defaults to week 1 — callers must handle `ok: false`.
 */
import { prisma } from '@/lib/prisma'
import { logLeagueEngineEvent } from '@/lib/league-engine-performance/observability'

export type ActiveWeekSource =
  | 'explicit'
  | 'redraft_season_current_week'
  | 'league_settings'
  | 'nfl_dominant_active_redraft_week'

export type ActiveWeekResolved = {
  ok: true
  leagueId: string
  week: number
  season: number
  source: ActiveWeekSource
  /** True when e.g. resolving from drafting season — scoring may be unexpected. */
  warning?: boolean
}

export type ActiveWeekUnresolved = {
  ok: false
  leagueId: string
  reason: string
}

export type ResolveActiveWeekInput = {
  leagueId: string
  /** When set to a valid integer 1–40, wins over persisted state. */
  explicitWeekOrRound?: number | null
  /** When set with explicit week, overrides inferred season year. */
  explicitSeason?: number | null
  /** Route or job id, e.g. `api/cron/weekly-engine` or `runScoringWorker`. */
  jobName: string
}

export function parseWeekFromLeagueSettings(settings: unknown): number | null {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null
  const o = settings as Record<string, unknown>
  const keys = ['currentWeek', 'current_week', 'week', 'leg', 'round', 'activeWeek'] as const
  for (const key of keys) {
    const raw = o[key]
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      const w = Math.floor(raw)
      if (w >= 1 && w <= 40) return w
    }
    if (typeof raw === 'string') {
      const n = parseInt(raw, 10)
      if (Number.isFinite(n) && n >= 1 && n <= 40) return n
    }
  }
  return null
}

function coerceSeasonYear(leagueSeason: number | null | undefined, redraftSeasonYear: number | null | undefined): number {
  const y = leagueSeason ?? redraftSeasonYear
  if (typeof y === 'number' && Number.isFinite(y) && y >= 2000 && y <= 2100) return Math.floor(y)
  return new Date().getUTCFullYear()
}

/**
 * Most common `currentWeek` among active NFL redraft seasons (same heuristic as import-scores).
 * Used only as an NFL fallback when league-specific signals are missing.
 */
export async function resolveDominantNflActiveRedraftWeek(): Promise<number | null> {
  const seasons = await prisma.redraftSeason.findMany({
    where: { status: { in: ['active', 'playoffs'] }, sport: 'NFL' },
    select: { currentWeek: true },
  })
  if (seasons.length === 0) return null
  const freq: Record<number, number> = {}
  for (const s of seasons) {
    if (s.currentWeek >= 1 && s.currentWeek <= 22) {
      freq[s.currentWeek] = (freq[s.currentWeek] ?? 0) + 1
    }
  }
  const dominant = Object.entries(freq).sort((a, b) => b[1] - a[1])[0]
  return dominant ? Number(dominant[0]) : null
}

export function logActiveWeekResolved(
  jobName: string,
  row: ActiveWeekResolved,
): void {
  logLeagueEngineEvent({
    subsystem: 'scoring',
    action: 'active_week_resolved',
    leagueId: row.leagueId,
    ok: true,
    extra: {
      jobName,
      resolvedWeek: row.week,
      season: row.season,
      source: row.source,
      warning: Boolean(row.warning),
    },
  })
}

export function logActiveWeekUnresolved(
  jobName: string,
  row: ActiveWeekUnresolved,
  seasonHint: number | null,
): void {
  logLeagueEngineEvent({
    subsystem: 'scoring',
    action: 'active_week_unresolved',
    leagueId: row.leagueId,
    ok: false,
    error: row.reason,
    extra: {
      jobName,
      resolvedWeek: null,
      season: seasonHint,
      source: 'none',
      warning: true,
    },
  })
}

/**
 * Pure resolution used by tests and `resolveActiveWeekForLeague` after DB reads.
 * Order: explicit week → redraft `currentWeek` (1–40) → league settings → NFL dominant week (optional).
 */
export function resolveActiveWeekFromInputs(args: {
  leagueId: string
  leagueSport: string
  leagueSeasonOfRecord: number
  settings: unknown
  redraftSeason: { status: string; currentWeek: number; season: number } | null
  explicitWeekOrRound?: number | null
  explicitSeason?: number | null
  nflDominantWeek: number | null
}): ActiveWeekResolved | ActiveWeekUnresolved {
  const { leagueId, leagueSport, leagueSeasonOfRecord, settings, redraftSeason, nflDominantWeek } = args
  const seasonBase = coerceSeasonYear(leagueSeasonOfRecord, redraftSeason?.season)

  if (args.explicitWeekOrRound != null) {
    const w = Math.floor(Number(args.explicitWeekOrRound))
    if (Number.isFinite(w) && w >= 1 && w <= 40) {
      const season =
        args.explicitSeason != null && Number.isFinite(Number(args.explicitSeason))
          ? Math.floor(Number(args.explicitSeason))
          : seasonBase
      return {
        ok: true,
        leagueId,
        week: w,
        season,
        source: 'explicit',
      }
    }
  }

  if (redraftSeason && redraftSeason.currentWeek >= 1 && redraftSeason.currentWeek <= 40) {
    const st = redraftSeason.status
    if (st === 'active' || st === 'playoffs' || st === 'drafting') {
      return {
        ok: true,
        leagueId,
        week: redraftSeason.currentWeek,
        season: redraftSeason.season,
        source: 'redraft_season_current_week',
        warning: st === 'drafting',
      }
    }
  }

  const fromSettings = parseWeekFromLeagueSettings(settings)
  if (fromSettings != null) {
    return {
      ok: true,
      leagueId,
      week: fromSettings,
      season: seasonBase,
      source: 'league_settings',
    }
  }

  if (leagueSport === 'NFL' && nflDominantWeek != null && nflDominantWeek >= 1 && nflDominantWeek <= 22) {
    return {
      ok: true,
      leagueId,
      week: nflDominantWeek,
      season: seasonBase,
      source: 'nfl_dominant_active_redraft_week',
      warning: true,
    }
  }

  return { ok: false, leagueId, reason: 'active_week_unresolved' }
}

export async function resolveActiveWeekForLeague(
  input: ResolveActiveWeekInput,
): Promise<ActiveWeekResolved | ActiveWeekUnresolved> {
  const league = await prisma.league.findUnique({
    where: { id: input.leagueId },
    select: { id: true, sport: true, season: true, settings: true },
  })
  if (!league) {
    const fail: ActiveWeekUnresolved = { ok: false, leagueId: input.leagueId, reason: 'league_not_found' }
    logActiveWeekUnresolved(input.jobName, fail, null)
    return fail
  }

  const redraftSeason =
    (await prisma.redraftSeason.findFirst({
      where: {
        leagueId: input.leagueId,
        status: { in: ['active', 'playoffs', 'drafting'] },
      },
      orderBy: { updatedAt: 'desc' },
      select: { status: true, currentWeek: true, season: true },
    })) ??
    (await prisma.redraftSeason.findFirst({
      where: { leagueId: input.leagueId },
      orderBy: { season: 'desc' },
      select: { status: true, currentWeek: true, season: true },
    }))

  const nflDominant =
    league.sport === 'NFL' ? await resolveDominantNflActiveRedraftWeek().catch(() => null) : null

  const resolved = resolveActiveWeekFromInputs({
    leagueId: input.leagueId,
    leagueSport: String(league.sport ?? 'NFL'),
    leagueSeasonOfRecord: league.season,
    settings: league.settings,
    redraftSeason,
    explicitWeekOrRound: input.explicitWeekOrRound,
    explicitSeason: input.explicitSeason,
    nflDominantWeek: nflDominant,
  })

  if (!resolved.ok) {
    logActiveWeekUnresolved(input.jobName, resolved, league.season)
    return resolved
  }
  logActiveWeekResolved(input.jobName, resolved)
  return resolved
}
