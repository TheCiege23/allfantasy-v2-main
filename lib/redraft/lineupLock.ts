/**
 * Redraft lineup-lock engine (NFL, and the daily sports whose slate is in `SportsGame` — NHL and
 * NBA — through their Eastern-day week window).
 *
 * Closes gap G1: players must lock when their real game kicks off so a manager
 * can't swap a player after their game has started. The lock is DERIVED from the
 * game schedule at request time (not a flag a cron must remember to set), so it
 * is always correct and impossible to "forget".
 *
 * Pure `computeLineupLock` (no DB) is the contract-tested core. `hydrateRedraft
 * LineupLocks` joins the schedule (`SportsGame`, UTC kickoffs, NFL abbreviations)
 * and stamps `isLocked` onto roster players; `lineupValidation` already rejects
 * moving a locked player, so hydrating before validation enforces the lock.
 *
 * Commissioner lock modes (`League.settings.sportConfig.lineupLockType`):
 *   - per_player_kickoff (default) — each player locks at THEIR game's kickoff.
 *   - first_game_of_week          — whole lineup locks at the week's first kickoff.
 *   - manual                      — locked only when the commissioner locks the week.
 *   - daily (OPT-IN, NBA/NHL/MLB) — each player locks at his own game start on the CURRENT US
 *                                   Eastern day and is movable again the next day. Honoured only
 *                                   with `sportConfig.dailyLineupsEnabled === true`; see
 *                                   `readLineupLockSettings` and docs/DAILY_LINEUPS_DESIGN.md.
 * Emergency commissioner unlocks (postponements/data errors) always win.
 */
import type { PrismaClient } from '@prisma/client'
import { easternCalendarDay } from '@/lib/sports-data/easternGameDay'
import { resolveDailySportSeasonStart } from '@/lib/season-week/dailySportSeasonStarts'
// Client-safe: takes the client as an argument and imports Prisma for types only.
import { ensureDailySportSeasonStart } from '@/lib/season-week/deriveDailySportSeasonStart'
import { weekWindowFromSeasonStart } from '@/lib/scoring-runtime/dailySportStatNormalization'
import { DATE_WINDOWED_SPORTS, RI_SCHEDULE_SLATE_SPORTS, readWeekGames } from './weekGames'
import { cfbdScheduleTeamKeys } from '@/lib/sports-data/collegeTeamNames'
// The pure cache reader, NOT riSeasonSchedule.ts: that module imports the server-only RI client, and
// this file is in client bundles (teamDefenseIdentity -> the league Team tab).
import { readRiScheduleWindow } from '@/lib/sports-data/riScheduleCache'

/**
 * Week-windowed sports whose players this lock does NOT lock yet, each with its reason.
 *
 * SOCCER: its week is a GAMEWEEK that skips international breaks (`resolveDailySportWeekWindow`,
 * which the finalizer and the stat sync read), while the windows below are seven days from the
 * opener — after the first break the lock would read a different set of games than the week is
 * sealed on. And the RI-schedule team names for European clubs have not been checked against
 * rostered players' teams. A lock on the wrong games is worse than none, so soccer stays unlocked
 * until both are done — which is what the soccer PR shipped and tested. (It became reachable only
 * because the NCAAB lock taught this module to read the RI schedule while that PR was open.)
 */
const LOCK_NOT_WIRED_SPORTS: readonly string[] = ['SOCCER']

/** `RedraftSeason.sport` stores the config key `NCAAFB`; every other layer says `NCAAF`. */
function isNcaafLockSport(sport: string): boolean {
  const s = String(sport).toUpperCase()
  return s === 'NCAAF' || s === 'NCAAFB'
}

/**
 * The keys a player's team is looked up under in `WeekKickoffs.byTeam`, best first. One key for
 * every sport but NCAAF, which tries the exact school (`x:`) before the loose form (`l:`) — see the
 * NCAAF branch of `buildWeekKickoffMap` for why the loose form is not always present.
 */
export function lockTeamLookupKeys(sport: string, team: string | null | undefined): string[] {
  if (!isNcaafLockSport(sport)) return [normalizeLockTeam(sport, team)]
  const { exact, loose } = cfbdScheduleTeamKeys(team)
  return [exact ? `x:${exact}` : '', loose ? `l:${loose}` : ''].filter(Boolean)
}

export type LineupLockMode = 'per_player_kickoff' | 'first_game_of_week' | 'manual' | 'daily'

/**
 * Sports whose leagues may opt into the `daily` lock. A daily sport plays most days, so a per-day lock
 * is meaningful; NFL/NCAAF play weekly and are never put on it. NCAAB and SOCCER are left out until
 * someone has checked them (SOCCER is not even locked yet — see LOCK_NOT_WIRED_SPORTS).
 */
export const DAILY_LINEUP_LOCK_SPORTS: readonly string[] = ['NBA', 'NHL', 'MLB']

/**
 * The stored setting, without the opt-in check. ⚠ 'daily' deliberately still resolves to
 * `per_player_kickoff` HERE: league settings and the sport configs (`lib/sportConfig/configs/*.ts`)
 * can carry `lineupLockType: 'daily'` already, and every one of those leagues has been locking per
 * player at the week's first game. Only `readLineupLockSettings`, given the sport AND the league's
 * explicit `dailyLineupsEnabled` flag, turns it into the real daily mode.
 */
export function resolveLineupLockMode(raw: unknown): Exclude<LineupLockMode, 'daily'> {
  const v = String(raw ?? '').trim().toLowerCase()
  if (v === 'first_game_of_week' || v === 'first_game' || v === 'weekly' || v === 'weekly_first_game') {
    return 'first_game_of_week'
  }
  if (v === 'manual' || v === 'commissioner' || v === 'commissioner_manual') return 'manual'
  return 'per_player_kickoff'
}

export type LockComputeInput = {
  mode: LineupLockMode
  now: Date
  /** This player's game kickoff (UTC). null = bye / no game / unresolved team. */
  playerKickoffUtc?: Date | null
  /** Earliest kickoff of the fantasy week (UTC) — used by first_game_of_week. */
  firstKickoffUtc?: Date | null
  /**
   * daily mode only: this player's earliest game start on the US Eastern day of `now` (UTC).
   * null = his team does not play today (or the team is unresolved) — not locked.
   */
  playerKickoffTodayUtc?: Date | null
  /** Commissioner has manually locked this week (manual mode). */
  manualLocked?: boolean
  /** Commissioner emergency-unlocked this player/roster for the week. */
  emergencyUnlocked?: boolean
}

/**
 * Pure lock decision. Emergency unlock always wins. A null player kickoff (bye /
 * no game / unresolved) is treated as NOT locked (fail-open) so a legitimate
 * lineup edit is never blocked by missing schedule data.
 */
export function computeLineupLock(input: LockComputeInput): boolean {
  if (input.emergencyUnlocked) return false
  switch (input.mode) {
    case 'manual':
      return Boolean(input.manualLocked)
    case 'first_game_of_week': {
      const k = input.firstKickoffUtc
      return k != null && input.now.getTime() >= k.getTime()
    }
    case 'daily': {
      // Only TODAY's game decides. A game he played yesterday does not hold him; a game tomorrow
      // has not started. The day boundary is midnight US Eastern (see `easternDayKey`).
      const k = input.playerKickoffTodayUtc
      if (k == null) return false
      return input.now.getTime() >= k.getTime()
    }
    case 'per_player_kickoff':
    default: {
      const k = input.playerKickoffUtc
      if (k == null) return false
      return input.now.getTime() >= k.getTime()
    }
  }
}

/** NFL abbreviation variants → canonical, so player.team matches SportsGame team. */
const NFL_TEAM_ALIASES: Record<string, string> = {
  JAC: 'JAX',
  WSH: 'WAS',
  WFT: 'WAS',
  LA: 'LAR',
  STL: 'LAR',
  SD: 'LAC',
  OAK: 'LV',
  LVR: 'LV',
  ARZ: 'ARI',
  KCC: 'KC',
  TBB: 'TB',
  NOR: 'NO',
  GBP: 'GB',
  SFO: 'SF',
  NEP: 'NE',
}

export function normalizeNflTeam(team: string | null | undefined): string {
  const u = String(team ?? '').trim().toUpperCase()
  return NFL_TEAM_ALIASES[u] ?? u
}

/**
 * The key a player's team and a game's team are matched on. NFL keeps its abbreviation aliases;
 * any other sport compares the name itself — the NFL table would turn an NHL "LA" into "LAR".
 * A team that matches no game fails open (not locked), exactly as a bye does.
 */
export function normalizeLockTeam(sport: string, team: string | null | undefined): string {
  if (String(sport).toUpperCase() === 'NFL') return normalizeNflTeam(team)
  // Full names from two feeds (Rolling Insights rosters, TheSportsDB games): drop accents and
  // punctuation so "Montréal Canadiens" / "St. Louis Blues" match "Montreal Canadiens" / "St Louis Blues".
  return String(team ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 ]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase()
}

export type WeekKickoffs = {
  /** Normalized team abbreviation → earliest kickoff (UTC) that week. */
  byTeam: Map<string, Date>
  /** Earliest kickoff across all games that week (UTC), or null. */
  firstKickoff: Date | null
  /**
   * Daily sports only: normalized team → US Eastern day ('YYYY-MM-DD') → earliest start that day.
   * Read by the opt-in `daily` mode; every other mode ignores it. Absent for NFL/NCAAF.
   */
  byTeamDay?: Map<string, Map<string, Date>>
  warnings: string[]
}

/** The US Eastern calendar day of an instant as 'YYYY-MM-DD' — the same rule `game_date` is written by. */
export function easternDayKey(instant: Date): string | null {
  const day = easternCalendarDay(instant)
  return day ? day.toISOString().slice(0, 10) : null
}

function setEarliestForDay(byTeamDay: Map<string, Map<string, Date>>, team: string, day: string, kickoff: Date): void {
  const days = byTeamDay.get(team) ?? new Map<string, Date>()
  const existing = days.get(day)
  if (!existing || kickoff.getTime() < existing.getTime()) days.set(day, kickoff)
  byTeamDay.set(team, days)
}

/**
 * Build the per-team kickoff map for one NFL week from `SportsGame`. Prefers rows
 * whose `week` is populated (the espn_live source carries it; api_sports does
 * not), dedups duplicate provider rows to the earliest kickoff per team.
 */
export async function buildWeekKickoffMap(
  prisma: PrismaClient,
  args: { sport: string; season: number; week: number },
): Promise<WeekKickoffs> {
  const warnings: string[] = []
  const byTeam = new Map<string, Date>()
  let firstKickoff: Date | null = null
  const sport = String(args.sport).toUpperCase()

  /*
   * 🛑 NHL PLAYERS NEVER LOCKED. This returned "NFL only" for every other sport, and a daily
   * sport's matchup scores the WHOLE WEEK's games for whoever sits in a starter slot at scoring
   * time — so a manager could start a player after his games were played, or bench one after a
   * bad night. A daily sport now locks from the same games the week is closed on (`readWeekGames`,
   * the Eastern-day window): each player at his team's FIRST game of the week under the default
   * mode, or the whole lineup at the week's first game. Once his first game starts, the week he
   * is scored for is fixed.
   *
   * The branch keys on the lists, not on a sport name, so NBA locked the moment it joined
   * `DATE_WINDOWED_SPORTS`. Its roster teams are Rolling Insights full names ("Oklahoma City
   * Thunder", fixtures/live.NBA.json) and its games are TheSportsDB's `strHomeTeam`/`strAwayTeam`.
   * ⚠ No NBA TheSportsDB fixture is committed, so the two spellings have not been compared: a team
   * the feeds name differently ("LA Clippers" / "Los Angeles Clippers") fails open, as a bye does.
   *
   * ⚠ NCAAB IS NOT HERE — it has its own branch below. Its `SportsGame` schedule is incomplete (see
   * RI_SCHEDULE_SLATE_SPORTS), and a lock read from a partial slate would leave some teams unlocked
   * with no warning.
   */
  /*
   * 🛑 NCAAF PLAYERS NEVER LOCKED — a college lineup stayed editable all week, after kickoff.
   *
   * NCAAF carries a real week, so kickoffs come from that week's games, like NFL. Two things differ:
   *
   *   - THE SOURCE IS CFBD's schedule rows (`source: 'cfbd'`), not the ranked live-score feeds
   *     `readWeekGames` reads. Measured on the test DB (2026 week 4): CFBD 285 games, TheSportsDB 123
   *     — a lock read from the partial feed would leave most teams unlocked with no warning. And
   *     CFBD's school spellings are the ones the pool's own crosswalk is built on; ESPN's carry
   *     mascots ("Vanderbilt Commodores") that match nothing.
   *   - THE TEAM NAMES DIFFER IN KIND. A drafted player's team is Rolling Insights' formal name
   *     ("University of Mississippi"); CFBD says "Ole Miss". Both sides go through the crosswalk the
   *     draft-pool logos already use (`cfbdScheduleTeamKeys`), which keeps "Miami University" (Ohio)
   *     apart from "University of Miami". A team it cannot place fails open, as a bye does.
   *
   * ⚠ THE LOOSE KEY IS DROPPED WHEREVER TWO SCHOOLS SHARE IT, AND THAT IS JUDGED OVER THE WHOLE
   * SEASON, NOT THIS WEEK. "Illinois" and D-III "Illinois College" are both "illinois" loosely.
   * Judged per week, the week Illinois is on a bye would leave the loose key to Illinois College
   * alone — and every Illinois player would lock at the wrong school's kickoff. Exact names are
   * always kept; an Illinois player ("University of Illinois" -> "Illinois") matches exactly.
   *
   * ⚠ A KICKOFF TIME CFBD HAS NOT ANNOUNCED IS STORED AS MIDNIGHT EASTERN ON GAME DAY. Measured on the
   * test DB's schedule (fetched 2026-09-03): about 40 games a week in weeks 4-9 still carried it. Those
   * players lock at the start of game day — early, never late — until the schedule refresh brings the
   * real time. Failing a TBD game open instead would let a lineup change after the real kickoff.
   */
  if (isNcaafLockSport(sport)) {
    const [games, seasonTeams] = await Promise.all([
      prisma.sportsGame.findMany({
        where: { sport: 'NCAAF', source: 'cfbd', season: args.season, week: args.week, seasonType: 'regular', startTime: { not: null } },
        select: { homeTeam: true, awayTeam: true, startTime: true },
      }) as Promise<Array<{ homeTeam: string; awayTeam: string; startTime: Date | null }>>,
      prisma.sportsGame.findMany({
        where: { sport: 'NCAAF', source: 'cfbd', season: args.season },
        select: { homeTeam: true, awayTeam: true },
        distinct: ['homeTeam', 'awayTeam'],
      }) as Promise<Array<{ homeTeam: string; awayTeam: string }>>,
    ])
    const schoolsByLoose = new Map<string, Set<string>>()
    for (const g of seasonTeams) {
      for (const team of [g.homeTeam, g.awayTeam]) {
        const { exact, loose } = cfbdScheduleTeamKeys(team)
        if (!loose) continue
        schoolsByLoose.set(loose, (schoolsByLoose.get(loose) ?? new Set()).add(exact))
      }
    }
    const setEarliest = (key: string, kickoff: Date) => {
      const existing = byTeam.get(key)
      if (!existing || kickoff.getTime() < existing.getTime()) byTeam.set(key, kickoff)
    }
    for (const g of games) {
      if (!g.startTime) continue
      const kickoff = g.startTime
      if (!firstKickoff || kickoff.getTime() < firstKickoff.getTime()) firstKickoff = kickoff
      for (const team of [g.homeTeam, g.awayTeam]) {
        const { exact, loose } = cfbdScheduleTeamKeys(team)
        if (exact) setEarliest(`x:${exact}`, kickoff)
        if (loose && (schoolsByLoose.get(loose)?.size ?? 0) <= 1) setEarliest(`l:${loose}`, kickoff)
      }
    }
    if (games.length === 0) {
      warnings.push(`No NCAAF (CFBD) games found for season ${args.season} week ${args.week}; lineup locks fall open (no player locked).`)
    }
    return { byTeam, firstKickoff, warnings }
  }

  /*
   * 🛑 NCAAB PLAYERS NEVER LOCKED. Its only complete slate is the Rolling Insights season schedule
   * (see RI_SCHEDULE_SLATE_SPORTS — `SportsGame` holds 243 of a week's 310 games), and that schedule
   * was parsed without its teams, so there was nothing to match a player against.
   *
   * It now keeps `home_team` / `away_team`, and those are Rolling Insights' formal names — the SAME
   * vendor, and the same spelling, as the NCAAB player pool. Measured (2025-26 fixture against the
   * test DB pool): 366 of 369 pool teams match on `normalizeLockTeam`, 18,155 of 18,209 players, no
   * two schools sharing a key. The three misses (Hartford, St. Francis Brooklyn, Savannah State) play
   * no Division I schedule, so failing open is correct for them.
   *
   * The lock reads the SAME slate the finalizer seals the week on (`readRiScheduleWindow`, the
   * Eastern-day window), so a lock and a seal cannot disagree about which games exist.
   *
   * ⚠ Rows synced before the teams were kept carry none: those games cannot lock anyone, and that is
   * said in a warning rather than read as "no game". The next schedule sync writes them.
   * ⚠ A game with no start time locks at the start of its Eastern day — early, never late.
   */
  if (DATE_WINDOWED_SPORTS.includes(sport) && RI_SCHEDULE_SLATE_SPORTS.includes(sport) && !LOCK_NOT_WIRED_SPORTS.includes(sport)) {
    // Prime a schedule-derived opener for a season past the curated table (dynasty year 2+).
    await ensureDailySportSeasonStart(sport, args.season, { db: prisma })
    const seasonStart = resolveDailySportSeasonStart(sport, args.season)
    const window = seasonStart ? weekWindowFromSeasonStart(seasonStart, args.week) : null
    if (!window) {
      warnings.push(`${sport} season ${args.season} has no recorded opener; lineup locks fall open (no player locked).`)
      return { byTeam, firstKickoff, warnings }
    }
    const games = await readRiScheduleWindow(prisma as never, {
      sport,
      season: args.season,
      window: { start: new Date(window.start), end: new Date(window.end) },
    })
    if (games == null) {
      warnings.push(`${sport} ${args.season} schedule is not synced yet; lineup locks fall open (no player locked).`)
      return { byTeam, firstKickoff, warnings }
    }
    let teamless = 0
    const byTeamDay = new Map<string, Map<string, Date>>()
    for (const g of games) {
      // The finalizer's regular slate: labelled regular, or unlabelled. A replaced game's replacement is its own row.
      if (g.seasonType != null && g.seasonType !== 'regular') continue
      if (g.replacedBy || String(g.status ?? '').toLowerCase() === 'replaced') continue
      // A postponed MLB original does not start a scoring game; the makeup locks on its own date.
      if (sport === 'MLB' && String(g.status ?? '').toLowerCase() === 'postponed') continue
      if (!g.homeTeam && !g.awayTeam) {
        teamless += 1
        continue
      }
      const kickoff = g.startTime ? new Date(g.startTime) : new Date(`${g.day}T04:00:00.000Z`)
      if (Number.isNaN(kickoff.getTime())) continue
      if (!firstKickoff || kickoff.getTime() < firstKickoff.getTime()) firstKickoff = kickoff
      for (const team of [g.homeTeam, g.awayTeam]) {
        const key = normalizeLockTeam(sport, team)
        if (!key) continue
        const existing = byTeam.get(key)
        if (!existing || kickoff.getTime() < existing.getTime()) byTeam.set(key, kickoff)
        // `g.day` IS the Eastern day (the schedule is keyed on it), so a no-time game's placeholder
        // instant — which falls on the PREVIOUS Eastern day in winter — never decides the day.
        if (g.day) setEarliestForDay(byTeamDay, key, g.day, kickoff)
      }
    }
    if (teamless > 0) {
      warnings.push(`${teamless} ${sport} game(s) this week were synced before team names were kept; their players are not locked until the next schedule sync.`)
    }
    if (games.length === 0) {
      warnings.push(`No ${sport} games in the schedule for season ${args.season} week ${args.week}; lineup locks fall open (no player locked).`)
    }
    return { byTeam, firstKickoff, byTeamDay, warnings }
  }

  if (
    sport !== 'NFL' &&
    DATE_WINDOWED_SPORTS.includes(sport) &&
    !RI_SCHEDULE_SLATE_SPORTS.includes(sport) &&
    !LOCK_NOT_WIRED_SPORTS.includes(sport)
  ) {
    // Prime a schedule-derived opener for a season past the curated table (dynasty year 2+).
    await ensureDailySportSeasonStart(sport, args.season, { db: prisma })
    const seasonStart = resolveDailySportSeasonStart(sport, args.season)
    const window = seasonStart ? weekWindowFromSeasonStart(seasonStart, args.week) : null
    if (!window) {
      warnings.push(`${sport} season ${args.season} has no recorded opener; lineup locks fall open (no player locked).`)
      return { byTeam, firstKickoff, warnings }
    }
    const games = await readWeekGames(prisma, {
      sport,
      season: args.season,
      week: args.week,
      seasonType: 'regular',
      dateWindow: { start: new Date(window.start), end: new Date(window.end) },
    })
    const byTeamDay = new Map<string, Map<string, Date>>()
    for (const g of games) {
      if (!g.startTime) continue
      const kickoff = g.startTime
      if (!firstKickoff || kickoff.getTime() < firstKickoff.getTime()) firstKickoff = kickoff
      // A 10pm Eastern tip is that Eastern day's game even though its UTC date is the next day.
      const day = easternDayKey(kickoff)
      for (const team of [g.homeTeam, g.awayTeam]) {
        const key = normalizeLockTeam(sport, team)
        if (!key) continue
        const existing = byTeam.get(key)
        if (!existing || kickoff.getTime() < existing.getTime()) byTeam.set(key, kickoff)
        if (day) setEarliestForDay(byTeamDay, key, day, kickoff)
      }
    }
    if (games.length === 0) {
      warnings.push(`No ${sport} games found for season ${args.season} week ${args.week}; lineup locks fall open (no player locked).`)
    }
    return { byTeam, firstKickoff, byTeamDay, warnings }
  }

  if (sport !== 'NFL') {
    // Named from the lists, so this cannot go stale again when the next sport joins.
    const lockable = ['NFL', 'NCAAF', ...DATE_WINDOWED_SPORTS.filter((s) => !LOCK_NOT_WIRED_SPORTS.includes(s))]
    warnings.push(`Lineup lock schedule lookup is wired for ${lockable.join(', ')} only; ${args.sport} players are not locked.`)
    return { byTeam, firstKickoff, warnings }
  }

  const games = (await prisma.sportsGame.findMany({
    where: { sport: 'NFL', season: args.season, week: args.week, startTime: { not: null } },
    select: { homeTeam: true, awayTeam: true, startTime: true },
  })) as Array<{ homeTeam: string; awayTeam: string; startTime: Date | null }>

  for (const g of games) {
    if (!g.startTime) continue
    const kickoff = g.startTime
    if (!firstKickoff || kickoff.getTime() < firstKickoff.getTime()) firstKickoff = kickoff
    for (const team of [g.homeTeam, g.awayTeam]) {
      const key = normalizeNflTeam(team)
      if (!key) continue
      const existing = byTeam.get(key)
      if (!existing || kickoff.getTime() < existing.getTime()) byTeam.set(key, kickoff)
    }
  }

  if (games.length === 0) {
    warnings.push(`No NFL games found for season ${args.season} week ${args.week}; lineup locks fall open (no player locked).`)
  }
  return { byTeam, firstKickoff, warnings }
}

type LockOverride = { week?: number; rosterId?: string; playerId?: string }

/**
 * Read lock mode + manual-lock weeks + emergency overrides from league settings.
 *
 * The `daily` mode needs THREE things, and anything less keeps the mode every existing league has:
 *   1. `sportConfig.lineupLockType === 'daily'`,
 *   2. `sportConfig.dailyLineupsEnabled === true` — the explicit per-league opt-in, default off, and
 *   3. `sport` passed and in `DAILY_LINEUP_LOCK_SPORTS` (never NFL/NCAAF).
 * Callers that pass no sport (the commissioner route, survivor scoring) therefore see exactly what they
 * saw before. When 'daily' is requested but not in effect, `warnings` says so instead of falling back
 * silently.
 */
export function readLineupLockSettings(
  leagueSettings: unknown,
  sport?: string | null,
): {
  mode: LineupLockMode
  manualLockedWeeks: Set<number>
  overrides: LockOverride[]
  warnings: string[]
} {
  const settings = (leagueSettings ?? {}) as Record<string, unknown>
  const sc = (settings.sportConfig ?? {}) as Record<string, unknown>
  const warnings: string[] = []
  let mode: LineupLockMode = resolveLineupLockMode(sc.lineupLockType)
  const requestedDaily = String(sc.lineupLockType ?? '').trim().toLowerCase() === 'daily'
  if (requestedDaily && sport != null) {
    const sportKey = String(sport).trim().toUpperCase()
    if (!DAILY_LINEUP_LOCK_SPORTS.includes(sportKey)) {
      warnings.push(`lineupLockType 'daily' is not supported for ${sportKey}; locking per_player_kickoff.`)
    } else if (sc.dailyLineupsEnabled !== true) {
      warnings.push(
        "lineupLockType 'daily' is set but dailyLineupsEnabled is not; locking per_player_kickoff " +
          "(each player at his team's first game of the week). See docs/DAILY_LINEUPS_DESIGN.md.",
      )
    } else {
      mode = 'daily'
      warnings.push(
        'Daily lineup lock is active: players lock at their own game start each day and unlock the next day, ' +
          "and each day's starters score that day's points (lib/redraft/dailyScoring.ts). " +
          'See docs/DAILY_LINEUPS_DESIGN.md.',
      )
    }
  }
  const manualLockedWeeks = new Set<number>(
    Array.isArray(sc.lineupLockManualWeeks)
      ? (sc.lineupLockManualWeeks as unknown[]).map((w) => Number(w)).filter((w) => Number.isFinite(w))
      : [],
  )
  const overrides: LockOverride[] = Array.isArray(sc.lineupLockOverrides)
    ? (sc.lineupLockOverrides as LockOverride[])
    : []
  return { mode, manualLockedWeeks, overrides, warnings }
}

export type LockablePlayer = {
  playerId: string
  team?: string | null
  isLocked?: boolean | null
}

type LockContext = {
  sport: string
  mode: LineupLockMode
  manualLocked: boolean
  overrides: LockOverride[]
  kickoffs: WeekKickoffs
  /** Roster id → the club he is on now (null = none); see `currentTeamByPlayerId` on the hydrators. */
  currentTeamByPlayerId?: ReadonlyMap<string, string | null>
}

async function loadLockContext(
  prisma: PrismaClient,
  args: {
    sport: string
    season: number
    week: number
    leagueSettings: unknown
    currentTeamByPlayerId?: ReadonlyMap<string, string | null>
  },
): Promise<LockContext> {
  const settings = readLineupLockSettings(args.leagueSettings, args.sport)
  const { mode, manualLockedWeeks, overrides } = settings
  // manual mode needs no schedule; kickoff-based modes do.
  const schedule: WeekKickoffs =
    mode === 'manual'
      ? { byTeam: new Map<string, Date>(), firstKickoff: null as Date | null, warnings: [] as string[] }
      : await buildWeekKickoffMap(prisma, { sport: args.sport, season: args.season, week: args.week })
  const kickoffs: WeekKickoffs = settings.warnings.length
    ? { ...schedule, warnings: [...settings.warnings, ...schedule.warnings] }
    : schedule
  return {
    sport: args.sport,
    mode,
    manualLocked: manualLockedWeeks.has(args.week),
    overrides,
    kickoffs,
    currentTeamByPlayerId: args.currentTeamByPlayerId,
  }
}

function stampLineupLock<T extends LockablePlayer>(
  player: T,
  ctx: LockContext,
  scope: { week: number; rosterId: string; now: Date },
): T {
  const emergencyUnlocked = ctx.overrides.some(
    (o) =>
      (o.week == null || Number(o.week) === scope.week) &&
      (o.rosterId == null || o.rosterId === scope.rosterId) &&
      (o.playerId == null || o.playerId === player.playerId),
  )
  // The club he plays for NOW, not the `team` snapshot stored when he was added — a traded player
  // otherwise locks at his old club's kickoff. No entry = keep the stored team (see the resolver).
  const lockTeam = ctx.currentTeamByPlayerId?.has(player.playerId)
    ? ctx.currentTeamByPlayerId.get(player.playerId)
    : player.team
  const playerKickoffUtc =
    lockTeamLookupKeys(ctx.sport, lockTeam)
      .map((key) => ctx.kickoffs.byTeam.get(key))
      .find((kickoff): kickoff is Date => kickoff != null) ?? null
  // daily mode: his earliest start on TODAY's Eastern day, looked up under the same team keys.
  const today = ctx.mode === 'daily' ? easternDayKey(scope.now) : null
  const playerKickoffTodayUtc =
    today == null
      ? null
      : (lockTeamLookupKeys(ctx.sport, lockTeam)
          .map((key) => ctx.kickoffs.byTeamDay?.get(key)?.get(today))
          .find((kickoff): kickoff is Date => kickoff != null) ?? null)
  const isLocked = computeLineupLock({
    mode: ctx.mode,
    now: scope.now,
    playerKickoffUtc,
    playerKickoffTodayUtc,
    firstKickoffUtc: ctx.kickoffs.firstKickoff,
    manualLocked: ctx.manualLocked,
    emergencyUnlocked,
  })
  return { ...player, isLocked }
}

/**
 * Stamp derived `isLocked` onto each roster player for the given week. Reuses the
 * pure `computeLineupLock` so what we test is what enforces. Returns the players
 * with `isLocked` set (other fields untouched) plus any schedule data warnings.
 */
export async function hydrateRedraftLineupLocks<T extends LockablePlayer>(
  prisma: PrismaClient,
  args: {
    sport: string
    season: number
    week: number
    rosterId: string
    leagueSettings: unknown
    players: T[]
    now?: Date
    /**
     * Roster id → current team, from `resolveCurrentLockTeams` (lineupLockCurrentTeam.ts, server-only).
     * Used for the kickoff lookup only; the returned players keep their own `team`.
     */
    currentTeamByPlayerId?: ReadonlyMap<string, string | null>
  },
): Promise<{ players: T[]; warnings: string[] }> {
  const now = args.now ?? new Date()
  const ctx = await loadLockContext(prisma, args)
  const players = args.players.map((p) => stampLineupLock(p, ctx, { week: args.week, rosterId: args.rosterId, now }))
  return { players, warnings: ctx.kickoffs.warnings }
}

/**
 * The same derivation for every roster in a league at once: ONE schedule read, not
 * one per roster. Each player carries its own `rosterId`, which scopes emergency
 * overrides exactly as `hydrateRedraftLineupLocks` does for a single roster.
 */
export async function hydrateRedraftLineupLocksForRosters<T extends LockablePlayer & { rosterId: string }>(
  prisma: PrismaClient,
  args: {
    sport: string
    season: number
    week: number
    leagueSettings: unknown
    players: T[]
    now?: Date
    /** As on `hydrateRedraftLineupLocks`. */
    currentTeamByPlayerId?: ReadonlyMap<string, string | null>
  },
): Promise<{ players: T[]; warnings: string[] }> {
  if (args.players.length === 0) return { players: [], warnings: [] }
  const now = args.now ?? new Date()
  const ctx = await loadLockContext(prisma, args)
  const players = args.players.map((p) => stampLineupLock(p, ctx, { week: args.week, rosterId: p.rosterId, now }))
  return { players, warnings: ctx.kickoffs.warnings }
}
