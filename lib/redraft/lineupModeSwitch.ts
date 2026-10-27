import type { PrismaClient } from '@prisma/client'

import { resolveDailySportWeekWindow } from '@/lib/season-week/dailySportSeasonStarts'
import { normalizeRedraftSeasonStatus, REDRAFT_SEASON_STATUS } from '@/lib/redraft/seasonStatus'
import { isDailyLineupScoringEnabled } from './dailyLineups'
import { DAILY_LINEUP_LOCK_SPORTS } from './lineupLock'

/**
 * The commissioner's "Lineups: Daily / Weekly" switch for NBA, NHL and MLB leagues
 * (docs/DAILY_LINEUPS_DESIGN.md, phase E).
 *
 * Daily is the three-part gate `isDailyLineupScoringEnabled` reads — `sportConfig.lineupLockType:
 * 'daily'` AND `sportConfig.dailyLineupsEnabled: true` AND a daily sport. The switch writes BOTH
 * fields together (`withLineupMode`), so a league is never left with one half of the gate. Weekly is
 * every other state. A NEW NBA or NHL redraft points league is created daily (`defaultsToDailyLineups`,
 * read by league creation); nothing turns an existing league daily on its own.
 *
 * 🛑 THE SWITCH IS REFUSED WHILE A SEASON IS UNDER WAY, NOT DEFERRED TO THE NEXT WEEK. Daily-sport
 * weeks are back to back (seven days from the opener), so "between weeks" is an instant, and a
 * week-effective switch would need the LOCK to honour the effective week too: it reads the two
 * fields directly (`readLineupLockSettings` in lineupLock.ts). Turning daily on mid-week would put
 * the daily lock — players movable again the next day — on a week still scored weekly, which is the
 * B5 exploit (a manager benches a player after his bad game and the game leaves his week). Refusing
 * keeps every week scored, locked and saved under ONE mode from its first day to its seal.
 * So the switch is open while no season is running: before the draft (`setup`), after the draft but
 * before week 1 starts, and once a season is `complete`.
 *
 * ⚠ DAILY ALSO NEEDS ITS TABLES. `redraft_daily_lineups` / `player_daily_scores` arrive with migration
 * `20261020120000_daily_lineups`; a daily league on a database without them fails every lineup save
 * and every score (P2021). Turning daily on is refused until both tables exist — checked by effect
 * with `to_regclass`, so it opens by itself once the migration is applied.
 */

export type LineupMode = 'daily' | 'weekly'

export const LINEUP_MODES: readonly LineupMode[] = ['daily', 'weekly']

export function parseLineupMode(raw: unknown): LineupMode | null {
  const v = String(raw ?? '').trim().toLowerCase()
  return v === 'daily' || v === 'weekly' ? v : null
}

export function supportsDailyLineups(sport: string | null | undefined): boolean {
  return DAILY_LINEUP_LOCK_SPORTS.includes(String(sport ?? '').trim().toUpperCase())
}

/**
 * Sports whose NEW native redraft points leagues start in daily lineups (owner, 2026-10-27). MLB
 * stays weekly by default; a commissioner can still switch any of the three before the season.
 * Category and roto leagues keep their one-lineup-a-week lock (a category week is one team total).
 */
export const DAILY_LINEUP_DEFAULT_SPORTS: readonly string[] = ['NBA', 'NHL']

export function defaultsToDailyLineups(args: {
  sport: string | null | undefined
  leagueType: string | null | undefined
  scoringMode: string | null | undefined
}): boolean {
  return (
    DAILY_LINEUP_DEFAULT_SPORTS.includes(String(args.sport ?? '').trim().toUpperCase()) &&
    String(args.leagueType ?? '').trim().toLowerCase() === 'redraft' &&
    String(args.scoringMode ?? 'points').trim().toLowerCase() === 'points'
  )
}

/** The mode a league is in now — exactly what the scorer and the lock read. */
export function readLineupMode(leagueSettings: unknown, sport: string | null | undefined): LineupMode {
  return isDailyLineupScoringEnabled(leagueSettings, sport) ? 'daily' : 'weekly'
}

/**
 * `sportConfig` with the mode written into BOTH gate fields. Weekly turns the opt-in off and, when the
 * stored lock type is `'daily'`, names the lock it has always behaved as (`per_player_kickoff`); any
 * other lock type (a category league's `first_game_of_week`, `manual`) is kept.
 * `weeklyLockType` lets the lock-mode route name the weekly lock the commissioner chose.
 */
export function withLineupMode(
  sportConfig: Record<string, unknown>,
  mode: LineupMode,
  weeklyLockType?: string,
): Record<string, unknown> {
  if (mode === 'daily') return { ...sportConfig, lineupLockType: 'daily', dailyLineupsEnabled: true }
  const stored = String(sportConfig.lineupLockType ?? '').trim().toLowerCase()
  const lineupLockType = weeklyLockType ?? (stored === 'daily' ? 'per_player_kickoff' : sportConfig.lineupLockType)
  const next: Record<string, unknown> = { ...sportConfig, dailyLineupsEnabled: false }
  if (lineupLockType === undefined) delete next.lineupLockType
  else next.lineupLockType = lineupLockType
  return next
}

/**
 * A `sportConfig` written wholesale (the settings PATCH's `sportConfig` key, which the sport-config
 * panel sends from its own possibly stale copy) keeps the stored daily/weekly state: only the switch
 * may change it, so it cannot be flipped mid-season, or half-flipped, by a blob save.
 */
export function keepLineupModeFields(
  storedSportConfig: Record<string, unknown>,
  incoming: Record<string, unknown> | null,
  sport: string | null | undefined,
): Record<string, unknown> | null {
  const storedMode = readLineupMode({ sportConfig: storedSportConfig }, sport)
  const incomingMode = readLineupMode({ sportConfig: incoming ?? {} }, sport)
  if (storedMode === incomingMode) return incoming
  return withLineupMode(incoming ?? {}, storedMode)
}

export type SeasonForLineupSwitch = { sport: string; season: number; status: string | null }

export type LineupModeRefusal = { status: number; code: string; message: string }

/**
 * Pure timing rule. Refused while any season of the league is running and its week 1 has begun —
 * `setup` and `complete` seasons never block. A running season whose week window is unknown is
 * refused too: the switch cannot tell whether a week is under way.
 */
export function lineupModeSwitchTimingRefusal(
  seasons: readonly SeasonForLineupSwitch[],
  now: Date,
): LineupModeRefusal | null {
  for (const s of seasons) {
    const status = normalizeRedraftSeasonStatus(s.status)
    if (status === REDRAFT_SEASON_STATUS.SETUP || status === REDRAFT_SEASON_STATUS.COMPLETE) continue
    const week1 = resolveDailySportWeekWindow(s.sport, s.season, 1)
    if (week1 && week1.start.getTime() > now.getTime()) continue
    return {
      status: 409,
      code: 'lineup_mode_season_in_progress',
      message:
        `Lineups can switch between daily and weekly only before the season's first week starts or after the ` +
        `season ends. The ${s.season} season is under way, and a week must be scored under one mode.`,
    }
  }
  return null
}

type LineupSwitchDb = Pick<PrismaClient, 'redraftSeason' | '$queryRaw'>

/** True when both per-day tables exist. `to_regclass` never throws on a missing table. */
export async function dailyLineupTablesExist(db: Pick<LineupSwitchDb, '$queryRaw'>): Promise<boolean> {
  try {
    const rows = await db.$queryRaw<Array<{ ok: boolean }>>`SELECT (to_regclass('public.redraft_daily_lineups') IS NOT NULL
        AND to_regclass('public.player_daily_scores') IS NOT NULL) AS ok`
    return rows?.[0]?.ok === true
  } catch {
    return false
  }
}

/**
 * Whether the league may move from `from` to `to` now. `null` = allowed (including no change).
 * Refusals: 400 for a sport without daily lineups, 409 while the per-day tables are missing (turning
 * daily ON only) or while a season is under way.
 */
export async function lineupModeSwitchRefusal(
  db: LineupSwitchDb,
  args: { leagueId: string; sport: string | null | undefined; from: LineupMode; to: LineupMode; now?: Date },
): Promise<LineupModeRefusal | null> {
  if (!supportsDailyLineups(args.sport)) {
    return {
      status: 400,
      code: 'lineup_mode_sport_unsupported',
      message: 'Daily and weekly lineups can only be chosen in NBA, NHL and MLB leagues.',
    }
  }
  if (args.from === args.to) return null
  if (args.to === 'daily' && !(await dailyLineupTablesExist(db))) {
    return {
      status: 409,
      code: 'lineup_mode_unavailable',
      message: 'Daily lineups are not available yet on this server.',
    }
  }
  const seasons = await db.redraftSeason.findMany({
    where: { leagueId: args.leagueId },
    select: { sport: true, season: true, status: true },
  })
  return lineupModeSwitchTimingRefusal(seasons, args.now ?? new Date())
}
