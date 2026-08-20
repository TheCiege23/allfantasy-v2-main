/**
 * Decision OS — next-game schedule context for DAILY-CADENCE sports
 * (Player Command Center Slice 6).
 *
 * NFL fantasy runs on weeks and byes — `scheduleBye.ts` models that and stays
 * untouched. NBA/MLB/NHL fantasy runs on DATES: what matters is the next
 * game's tip/first-pitch/puck-drop and how dense the coming week is. This
 * module projects exactly that from the SAME persisted schedule caches
 * (FantasyScheduleGame / GameSchedule via `loadScheduleGameRows`) — read-only,
 * no provider calls, honest degradation when rows or timestamps are missing.
 * Byes are deliberately absent: not a concept in daily sports.
 */
import type { RawScheduleGameRow } from './facts'
import { loadScheduleGameRows } from './port'

const NEXT_GAME_STALE_AFTER_MS = 3 * 24 * 60 * 60 * 1000
const DENSITY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

export interface NextGameFreshness {
  fetchedAt: string | null
  expiresAt: string | null
  updatedAt: string | null
  isStale: boolean | null
  staleReason: string | null
}

export interface TeamNextGameContext {
  team: string
  /** Next game at-or-after `now` with a real kickoff timestamp. */
  nextOpponent: string | null
  homeAway: 'home' | 'away' | null
  nextGameAt: string | null
  gameStatus: string | null
  /** Real schedule density: games in the 7 days from `now` (streaming/lineup-lock signal for daily sports). */
  gamesNext7Days: number
  provenance: { sourceModel: 'FantasyScheduleGame' | 'GameSchedule' | 'SportsGame' | null; source: string | null }
  freshness: NextGameFreshness
  warnings: string[]
}

export interface NextGameScheduleResult {
  byTeam: Map<string, TeamNextGameContext>
  requestedTeams: number
  resolvedTeams: number
  warnings: string[]
}

function toIso(value: Date | null | undefined): string | null {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString() : null
}

function normalizeTeam(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().toUpperCase()
  return trimmed || null
}

function freshnessOf(row: RawScheduleGameRow | null, now: Date): NextGameFreshness {
  if (!row) {
    return { fetchedAt: null, expiresAt: null, updatedAt: null, isStale: null, staleReason: 'freshness_unavailable' }
  }
  const fetchedAt = toIso(row.fetchedAt)
  const expiresAt = toIso(row.expiresAt)
  const updatedAt = toIso(row.updatedAt)
  if (row.expiresAt instanceof Date && !Number.isNaN(row.expiresAt.getTime())) {
    const isStale = row.expiresAt.getTime() < now.getTime()
    return { fetchedAt, expiresAt, updatedAt, isStale, staleReason: isStale ? 'expired' : null }
  }
  if (row.updatedAt instanceof Date && !Number.isNaN(row.updatedAt.getTime())) {
    const isStale = now.getTime() - row.updatedAt.getTime() > NEXT_GAME_STALE_AFTER_MS
    return { fetchedAt, expiresAt, updatedAt, isStale, staleReason: isStale ? 'updated_older_than_threshold' : null }
  }
  return { fetchedAt, expiresAt, updatedAt, isStale: null, staleReason: 'freshness_unavailable' }
}

/**
 * Pure: per-team next-game context from already-loaded rows. Deterministic;
 * `now` is injected. Rows without a kickoff timestamp cannot anchor a "next
 * game" and are counted as a warning, never guessed.
 */
export function projectNextGameContext(
  rows: RawScheduleGameRow[],
  input: { teams: string[]; now: Date },
): NextGameScheduleResult {
  const { now } = input
  const requestedTeams = Array.from(
    new Set(input.teams.map(normalizeTeam).filter((t): t is string => Boolean(t))),
  )

  const normalizedRows = rows
    .map((row) => ({ ...row, homeTeam: normalizeTeam(row.homeTeam), awayTeam: normalizeTeam(row.awayTeam) }))
    .filter((row) => row.homeTeam || row.awayTeam)

  const byTeam = new Map<string, TeamNextGameContext>()
  const worldWarnings = new Set<string>()

  for (const team of requestedTeams) {
    const teamRows = normalizedRows.filter((row) => row.homeTeam === team || row.awayTeam === team)
    const warnings = new Set<string>()

    if (teamRows.length === 0) {
      warnings.add('schedule_unavailable')
      worldWarnings.add('schedule_unavailable')
      byTeam.set(team, {
        team,
        nextOpponent: null,
        homeAway: null,
        nextGameAt: null,
        gameStatus: null,
        gamesNext7Days: 0,
        provenance: { sourceModel: null, source: null },
        freshness: freshnessOf(null, now),
        warnings: [...warnings],
      })
      continue
    }

    const timedRows = teamRows.filter(
      (row) => row.kickoffTime instanceof Date && !Number.isNaN(row.kickoffTime.getTime()),
    )
    if (timedRows.length < teamRows.length) {
      warnings.add('some_games_missing_kickoff_time')
    }

    const upcoming = timedRows
      .filter((row) => (row.kickoffTime as Date).getTime() >= now.getTime())
      .sort((a, b) => (a.kickoffTime as Date).getTime() - (b.kickoffTime as Date).getTime())
    const next = upcoming[0] ?? null

    const gamesNext7Days = upcoming.filter(
      (row) => (row.kickoffTime as Date).getTime() - now.getTime() <= DENSITY_WINDOW_MS,
    ).length

    if (!next) {
      warnings.add(timedRows.length === 0 ? 'no_kickoff_timestamps' : 'no_upcoming_games_in_cache')
    }

    const freshness = freshnessOf(next, now)
    if (freshness.isStale === true) warnings.add('schedule_stale')
    for (const w of warnings) worldWarnings.add(w)

    byTeam.set(team, {
      team,
      nextOpponent: next ? (next.homeTeam === team ? next.awayTeam : next.homeTeam) : null,
      homeAway: next ? (next.homeTeam === team ? 'home' : 'away') : null,
      nextGameAt: next ? toIso(next.kickoffTime) : null,
      gameStatus: next?.status ?? null,
      gamesNext7Days,
      provenance: next
        ? { sourceModel: next.sourceModel, source: next.source ?? null }
        : { sourceModel: null, source: null },
      freshness,
      warnings: [...warnings],
    })
  }

  const resolvedTeams = [...byTeam.values()].filter((c) => c.nextGameAt != null).length
  return { byTeam, requestedTeams: requestedTeams.length, resolvedTeams, warnings: [...worldWarnings] }
}

/**
 * Read-only resolver: persisted schedule caches → per-team next-game context.
 * Never throws; a read miss degrades to unresolved contexts with warnings.
 */
export async function resolveNextGameScheduleContext(
  input: { sport: string; season: number; teams: string[]; now?: Date },
  port: { loadRows: (sport: string, season: number, teams?: string[]) => Promise<RawScheduleGameRow[]> } = {
    loadRows: (sport, season, teams) => loadScheduleGameRows(sport, season, teams),
  },
): Promise<NextGameScheduleResult> {
  const now = input.now ?? new Date()
  const teams = Array.from(new Set(input.teams.map(normalizeTeam).filter((t): t is string => Boolean(t))))
  if (teams.length === 0) {
    return { byTeam: new Map(), requestedTeams: 0, resolvedTeams: 0, warnings: ['schedule_teams_unavailable'] }
  }
  try {
    const rows = await port.loadRows(input.sport, input.season, teams)
    return projectNextGameContext(rows, { teams, now })
  } catch {
    return {
      byTeam: new Map(),
      requestedTeams: teams.length,
      resolvedTeams: 0,
      warnings: ['schedule_source_unavailable'],
    }
  }
}
