/**
 * Decision OS — Phase 2 / F2.2: Canonical World SCHEDULE / BYE enrichment (read-only derived VIEW).
 *
 * Builds ADDITIVELY on the F2.1 metadata-enriched view. The frozen Canonical World still carries ids only;
 * this module never mutates it and never writes. It reads ONLY already-persisted schedule caches and folds
 * deterministic team schedule context onto enriched players:
 *   - team bye week (when deterministically derivable)
 *   - current game week context (opponent, home/away, kickoff, status)
 *   - provenance + freshness
 *   - honest completeness / uncertainty
 *
 * HONEST DEGRADATION:
 *   - No live API calls, no cache warming, no writes.
 *   - Missing metadata team → no schedule context guessed.
 *   - Missing or partial schedule rows → null facts + warnings, never fabricated.
 *   - Bye week is derived ONLY when the season schedule yields exactly one in-window gap for the team; if
 *     multiple gaps exist, the result is ambiguous and stays null.
 */
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'
import type { RawScheduleGameRow } from './facts'
import type {
  EnrichedCanonicalWorld,
  EnrichedPlayer,
  EnrichedRosterFacts,
} from './enrichedWorld'
import { resolveEnrichedCanonicalWorld } from './enrichedWorld'
import { loadScheduleGameRows } from './port'

const SCHEDULE_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000

export type ScheduleHomeAway = 'home' | 'away'

export interface ScheduleContextProvenance {
  /**
   * `SportsGame` joined the union in slice 9: a sync process had been writing
   * that table while no schedule consumer read it, so multi-sport and NCAAF
   * timing degraded to `schedule_unavailable` despite the rows existing. The
   * reader was widened; this provenance type was not, so every row sourced from
   * SportsGame failed to typecheck on assignment.
   */
  sourceModel: 'FantasyScheduleGame' | 'GameSchedule' | 'SportsGame' | null
  source: string | null
}

export interface ScheduleContextFreshness {
  fetchedAt: string | null
  expiresAt: string | null
  updatedAt: string | null
  isStale: boolean | null
  staleReason: string | null
}

export interface TeamScheduleContext {
  team: string | null
  currentWeek: number | null
  gameWeek: number | null
  byeWeek: number | null
  opponent: string | null
  homeAway: ScheduleHomeAway | null
  gameStatus: string | null
  kickoffTime: string | null
  hasGame: boolean
  isByeWeek: boolean
  provenance: ScheduleContextProvenance
  freshness: ScheduleContextFreshness
  completeness: number
  warnings: string[]
  uncertainty: string[]
}

export interface ScheduleEnrichedPlayer extends EnrichedPlayer {
  scheduleContext: TeamScheduleContext
}

export interface ScheduleEnrichedRosterFacts extends Omit<EnrichedRosterFacts, 'players'> {
  players: ScheduleEnrichedPlayer[]
  scheduleCompleteness: number
  scheduleWarnings: string[]
}

export interface ScheduleEnrichmentSummary {
  requestedTeams: number
  resolvedTeams: number
  requestedPlayers: number
  playersWithResolvedSchedule: number
  currentWeek: number | null
  completeness: number
  warnings: string[]
  coverageGaps: string[]
}

export interface ScheduleEnrichedCanonicalWorld extends Omit<EnrichedCanonicalWorld, 'rosters'> {
  rosters: ScheduleEnrichedRosterFacts[]
  schedule: ScheduleEnrichmentSummary
}

export interface ScheduleContextResult {
  byTeam: Map<string, TeamScheduleContext>
  requestedTeams: number
  resolvedTeams: number
  completeness: number
  warnings: string[]
  coverageGaps: string[]
}

export interface ScheduleContextPort {
  loadRows: (sport: string, season: number, teams?: string[]) => Promise<RawScheduleGameRow[]>
}

export interface ScheduleEnrichedWorldDeps {
  resolveEnrichedWorld: (leagueId: string) => Promise<EnrichedCanonicalWorld | null>
  resolveSchedule: (input: {
    sport: string
    season: number
    currentWeek: number | null
    teams: string[]
  }) => Promise<ScheduleContextResult>
}

export const defaultScheduleContextPort: ScheduleContextPort = {
  loadRows: (sport, season, teams) => loadScheduleGameRows(sport, season, teams),
}

export const defaultScheduleEnrichedWorldDeps: ScheduleEnrichedWorldDeps = {
  resolveEnrichedWorld: (leagueId) => resolveEnrichedCanonicalWorld(leagueId),
  resolveSchedule: ({ sport, season, currentWeek, teams }) =>
    resolveScheduleContext({ sport, season, currentWeek, teams }),
}

function pct(resolved: number, total: number): number {
  if (total <= 0) return 0
  return Math.round((resolved / total) * 100)
}

function toIso(value: Date | null | undefined): string | null {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString() : null
}

function normalizeTeamKey(team: string | null | undefined): string | null {
  if (typeof team !== 'string') return null
  const trimmed = team.trim()
  if (!trimmed) return null
  return normalizeTeamAbbrev(trimmed) ?? trimmed.toUpperCase()
}

function gameKey(row: Pick<RawScheduleGameRow, 'week' | 'homeTeam' | 'awayTeam'>): string {
  return `${row.week}|${normalizeTeamKey(row.homeTeam) ?? ''}|${normalizeTeamKey(row.awayTeam) ?? ''}`
}

function rowTimestampMs(row: RawScheduleGameRow): number {
  const stamp = row.fetchedAt ?? row.updatedAt ?? row.kickoffTime
  return stamp instanceof Date && !Number.isNaN(stamp.getTime()) ? stamp.getTime() : 0
}

function staleFreshness(row: RawScheduleGameRow | null | undefined, now: Date): ScheduleContextFreshness {
  if (!row) {
    return {
      fetchedAt: null,
      expiresAt: null,
      updatedAt: null,
      isStale: null,
      staleReason: 'freshness_unavailable',
    }
  }

  const fetchedAt = toIso(row.fetchedAt)
  const expiresAt = toIso(row.expiresAt)
  const updatedAt = toIso(row.updatedAt)

  if (row.expiresAt instanceof Date && !Number.isNaN(row.expiresAt.getTime())) {
    const isStale = row.expiresAt.getTime() < now.getTime()
    return {
      fetchedAt,
      expiresAt,
      updatedAt,
      isStale,
      staleReason: isStale ? 'expired' : null,
    }
  }

  if (row.updatedAt instanceof Date && !Number.isNaN(row.updatedAt.getTime())) {
    const isStale = now.getTime() - row.updatedAt.getTime() > SCHEDULE_STALE_AFTER_MS
    return {
      fetchedAt,
      expiresAt,
      updatedAt,
      isStale,
      staleReason: isStale ? 'updated_older_than_threshold' : null,
    }
  }

  return {
    fetchedAt,
    expiresAt,
    updatedAt,
    isStale: null,
    staleReason: 'freshness_unavailable',
  }
}

function emptyTeamScheduleContext(team: string | null, currentWeek: number | null): TeamScheduleContext {
  return {
    team,
    currentWeek,
    gameWeek: null,
    byeWeek: null,
    opponent: null,
    homeAway: null,
    gameStatus: null,
    kickoffTime: null,
    hasGame: false,
    isByeWeek: false,
    provenance: { sourceModel: null, source: null },
    freshness: {
      fetchedAt: null,
      expiresAt: null,
      updatedAt: null,
      isStale: null,
      staleReason: 'freshness_unavailable',
    },
    completeness: 0,
    warnings: [],
    uncertainty: [],
  }
}

/**
 * Pure: derive per-team schedule context for the requested season/current week from already-loaded rows.
 * Deterministic, no IO, no mutation.
 */
export function projectScheduleContext(
  rows: RawScheduleGameRow[],
  input: {
    currentWeek: number | null
    teams: string[]
    now?: Date
  },
): ScheduleContextResult {
  const now = input.now ?? new Date()
  const requestedTeams = Array.from(
    new Set(input.teams.map((team) => normalizeTeamKey(team)).filter((team): team is string => Boolean(team))),
  )

  const deduped = new Map<string, RawScheduleGameRow>()
  for (const row of rows) {
    if (row.week <= 0) continue
    const key = gameKey(row)
    if (!deduped.has(key)) deduped.set(key, row)
  }
  const normalizedRows = [...deduped.values()]
    .map((row) => ({
      ...row,
      homeTeam: normalizeTeamKey(row.homeTeam),
      awayTeam: normalizeTeamKey(row.awayTeam),
    }))
    .sort((a, b) => a.week - b.week)

  const seasonWeeks = Array.from(new Set(normalizedRows.map((row) => row.week).filter((week) => week > 0))).sort(
    (a, b) => a - b,
  )
  const hasCurrentWeekSchedule =
    input.currentWeek != null && seasonWeeks.includes(input.currentWeek)

  const byTeam = new Map<string, TeamScheduleContext>()
  const worldWarnings = new Set<string>()
  const coverageGaps = new Set<string>()

  for (const team of requestedTeams) {
    const teamRows = normalizedRows.filter((row) => row.homeTeam === team || row.awayTeam === team)
    const currentRow =
      input.currentWeek != null
        ? teamRows.find((row) => row.week === input.currentWeek) ?? null
        : null
    const freshestRow =
      currentRow ??
      [...teamRows].sort((a, b) => rowTimestampMs(b) - rowTimestampMs(a))[0] ??
      null
    const warnings = new Set<string>()
    const uncertainty = new Set<string>()
    const context = emptyTeamScheduleContext(team, input.currentWeek)

    if (teamRows.length === 0) {
      warnings.add('schedule_unavailable')
      uncertainty.add('team_schedule_missing')
      coverageGaps.add('schedule_cache_missing_for_requested_team')
      byTeam.set(team, {
        ...context,
        warnings: [...warnings],
        uncertainty: [...uncertainty],
      })
      continue
    }

    const teamWeeks = Array.from(new Set(teamRows.map((row) => row.week))).sort((a, b) => a - b)
    const minWeek = teamWeeks[0] ?? null
    const maxWeek = teamWeeks[teamWeeks.length - 1] ?? null
    const candidateByeWeeks =
      minWeek != null && maxWeek != null
        ? seasonWeeks.filter((week) => week >= minWeek && week <= maxWeek && !teamWeeks.includes(week))
        : []

    let byeWeek: number | null = null
    if (candidateByeWeeks.length === 1) {
      byeWeek = candidateByeWeeks[0] ?? null
    } else if (candidateByeWeeks.length > 1) {
      warnings.add('bye_week_ambiguous')
      uncertainty.add('multiple_schedule_gaps_detected')
      coverageGaps.add('bye_week_ambiguous')
    } else if (seasonWeeks.length > teamWeeks.length) {
      warnings.add('bye_week_unresolved')
      uncertainty.add('no_unique_bye_gap_detected')
      coverageGaps.add('bye_week_unresolved')
    }

    const isByeWeek =
      input.currentWeek != null &&
      hasCurrentWeekSchedule &&
      !currentRow &&
      teamRows.length > 0

    if (currentRow) {
      context.hasGame = true
      context.gameWeek = currentRow.week
      context.opponent =
        currentRow.homeTeam === team ? currentRow.awayTeam ?? null : currentRow.homeTeam ?? null
      context.homeAway = currentRow.homeTeam === team ? 'home' : 'away'
      context.gameStatus = currentRow.status ?? null
      context.kickoffTime = toIso(currentRow.kickoffTime)
      context.provenance = {
        sourceModel: currentRow.sourceModel,
        source: currentRow.source ?? null,
      }
      context.freshness = staleFreshness(currentRow, now)
      if (!currentRow.status) {
        warnings.add('game_status_unavailable')
        uncertainty.add('current_week_status_missing')
      }
    } else if (input.currentWeek != null) {
      if (isByeWeek) {
        warnings.add('current_week_bye_inferred')
        context.provenance = {
          sourceModel: freshestRow?.sourceModel ?? null,
          source: freshestRow?.source ?? null,
        }
        context.freshness = staleFreshness(freshestRow, now)
      } else if (hasCurrentWeekSchedule) {
        warnings.add('current_week_schedule_unavailable')
        uncertainty.add('no_current_week_team_row')
        coverageGaps.add('current_week_team_schedule_missing')
      } else {
        warnings.add('current_week_out_of_schedule_range')
        uncertainty.add('season_schedule_not_loaded_for_current_week')
        coverageGaps.add('current_week_not_present_in_schedule_cache')
      }
    }

    context.byeWeek = byeWeek
    context.isByeWeek = isByeWeek
    if (context.freshness.isStale === true) {
      warnings.add('schedule_stale')
      uncertainty.add(String(context.freshness.staleReason ?? 'schedule_stale'))
      coverageGaps.add('stale_schedule_rows')
    }
    if (context.freshness.staleReason === 'freshness_unavailable') {
      warnings.add('schedule_freshness_unavailable')
      uncertainty.add('schedule_freshness_unknown')
      coverageGaps.add('schedule_freshness_unavailable')
    }

    const completenessChecks = [
      Boolean(team),
      teamRows.length > 0,
      input.currentWeek == null ? true : context.hasGame || context.isByeWeek,
      context.byeWeek != null,
    ]
    context.completeness = pct(
      completenessChecks.filter(Boolean).length,
      completenessChecks.length,
    )
    context.warnings = [...warnings]
    context.uncertainty = [...uncertainty]

    for (const warning of warnings) worldWarnings.add(warning)
    byTeam.set(team, context)
  }

  const resolvedTeams = [...byTeam.values()].filter(
    (context) => context.hasGame || context.isByeWeek || context.byeWeek != null,
  ).length

  return {
    byTeam,
    requestedTeams: requestedTeams.length,
    resolvedTeams,
    completeness: pct(resolvedTeams, requestedTeams.length),
    warnings: [...worldWarnings],
    coverageGaps: [...coverageGaps],
  }
}

/**
 * Read-only resolver for per-team schedule context. Reads only persisted schedule caches and degrades
 * honestly on misses or partial rows.
 */
export async function resolveScheduleContext(
  input: {
    sport: string
    season: number
    currentWeek: number | null
    teams: string[]
  },
  port: ScheduleContextPort = defaultScheduleContextPort,
): Promise<ScheduleContextResult> {
  const teams = Array.from(
    new Set(input.teams.map((team) => normalizeTeamKey(team)).filter((team): team is string => Boolean(team))),
  )
  if (teams.length === 0) {
    return {
      byTeam: new Map(),
      requestedTeams: 0,
      resolvedTeams: 0,
      completeness: 0,
      warnings: ['schedule_teams_unavailable'],
      coverageGaps: ['schedule_teams_unavailable'],
    }
  }

  try {
    const rows = await port.loadRows(input.sport, input.season)
    return projectScheduleContext(rows, {
      teams,
      currentWeek: input.currentWeek,
    })
  } catch {
    return {
      byTeam: new Map(
        teams.map((team) => [
          team,
          {
            ...emptyTeamScheduleContext(team, input.currentWeek),
            warnings: ['schedule_source_unavailable'],
            uncertainty: ['schedule_source_unavailable'],
          },
        ]),
      ),
      requestedTeams: teams.length,
      resolvedTeams: 0,
      completeness: 0,
      warnings: ['schedule_source_unavailable'],
      coverageGaps: ['schedule_source_unavailable'],
    }
  }
}

/**
 * Pure: fold per-team schedule context onto the F2.1 metadata-enriched world. Never mutates the base
 * enriched view; returns a new additive schedule/bye view.
 */
export function projectScheduleEnrichedWorld(
  world: EnrichedCanonicalWorld,
  schedule: ScheduleContextResult,
): ScheduleEnrichedCanonicalWorld {
  let requestedPlayers = 0
  let playersWithResolvedSchedule = 0

  const rosters: ScheduleEnrichedRosterFacts[] = world.rosters.map((roster) => {
    const scheduleWarnings = new Set<string>()
    const players: ScheduleEnrichedPlayer[] = roster.players.map((player) => {
      requestedPlayers += 1
      const teamKey = normalizeTeamKey(player.team)
      const scheduleContext =
        (teamKey ? schedule.byTeam.get(teamKey) : null) ??
        {
          ...emptyTeamScheduleContext(teamKey, world.league.currentWeek),
          warnings: teamKey ? ['schedule_unavailable'] : ['team_unavailable'],
          uncertainty: teamKey ? ['team_schedule_missing'] : ['player_team_missing'],
        }

      if (scheduleContext.hasGame || scheduleContext.isByeWeek || scheduleContext.byeWeek != null) {
        playersWithResolvedSchedule += 1
      }
      for (const warning of scheduleContext.warnings) scheduleWarnings.add(warning)
      return {
        ...player,
        scheduleContext: {
          ...scheduleContext,
          warnings: [...scheduleContext.warnings],
          uncertainty: [...scheduleContext.uncertainty],
        },
      }
    })

    const resolvedPlayers = players.filter(
      (player) =>
        player.scheduleContext.hasGame ||
        player.scheduleContext.isByeWeek ||
        player.scheduleContext.byeWeek != null,
    ).length

    return {
      ...roster,
      players,
      scheduleCompleteness: pct(resolvedPlayers, players.length),
      scheduleWarnings: [...scheduleWarnings],
    }
  })

  return {
    ...world,
    rosters,
    schedule: {
      requestedTeams: schedule.requestedTeams,
      resolvedTeams: schedule.resolvedTeams,
      requestedPlayers,
      playersWithResolvedSchedule,
      currentWeek: world.league.currentWeek,
      completeness: pct(playersWithResolvedSchedule, requestedPlayers),
      warnings: [...schedule.warnings],
      coverageGaps: [...schedule.coverageGaps],
    },
  }
}

/**
 * Read-only resolver: F2.1 metadata-enriched world → per-team schedule context → additive schedule/bye
 * view. Never throws; a schedule read miss degrades to unresolved schedule contexts.
 */
export async function resolveScheduleEnrichedCanonicalWorld(
  leagueId: string,
  deps: ScheduleEnrichedWorldDeps = defaultScheduleEnrichedWorldDeps,
): Promise<ScheduleEnrichedCanonicalWorld | null> {
  const world = await deps.resolveEnrichedWorld(leagueId)
  if (!world) return null
  const teams = Array.from(
    new Set(
      world.rosters
        .flatMap((roster) => roster.players.map((player) => normalizeTeamKey(player.team)))
        .filter((team): team is string => Boolean(team)),
    ),
  )
  let schedule: ScheduleContextResult
  try {
    schedule = await deps.resolveSchedule({
      sport: world.league.sport,
      season: world.league.season,
      currentWeek: world.league.currentWeek,
      teams,
    })
  } catch {
    schedule = {
      byTeam: new Map(
        teams.map((team) => [
          team,
          {
            ...emptyTeamScheduleContext(team, world.league.currentWeek),
            warnings: ['schedule_source_unavailable'],
            uncertainty: ['schedule_source_unavailable'],
          },
        ]),
      ),
      requestedTeams: teams.length,
      resolvedTeams: 0,
      completeness: 0,
      warnings: ['schedule_source_unavailable'],
      coverageGaps: ['schedule_source_unavailable'],
    }
  }
  return projectScheduleEnrichedWorld(world, schedule)
}
