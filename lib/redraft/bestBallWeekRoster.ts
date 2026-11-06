/**
 * WHO WAS ON A BEST BALL ROSTER FOR *THAT* WEEK — not who is on it now.
 *
 * 🛑 BEST BALL SCORED THE CURRENT ROSTER (`droppedAt: null`). In a best ball league every rostered
 * player can count, so whoever is on the roster when a week is scored decides it. A Guilly chop runs
 * 24–48h after the week ends (`nativeGuillotineWeek`, the correction window): a free agent added in
 * that gap counted for the week that had already been played, and a player dropped in it was erased
 * from the week he had earned. Either is enough to decide who is eliminated.
 *
 * The daily-lineup path already answers this per day (`daysOnRoster`, lib/redraft/dailyLineups.ts),
 * but best ball scores ONE lineup over WEEKLY totals and per-day stat rows exist only for daily-lineup
 * leagues, so it cannot split a week. The rule here is the weekly form of the same idea:
 *
 *   A player counts for the team that held him at HIS FIRST GAME LOCK of the week — his team's first
 *   kickoff that week (`buildWeekKickoffMap().byTeam`), else the week's first kickoff.
 *     - added before that lock and not dropped before it  → counts, for the whole week;
 *     - added at or after it                               → counts from next week (no hindsight adds);
 *     - dropped at or after it                             → still counts this week (earned points stay).
 *   Exactly one team can hold a player at one instant, so a player never scores for two teams.
 *
 * ⚠ DRAFTED AND KEPT PLAYERS ARE HELD FROM BEFORE THE SEASON, WHATEVER THEIR `addedAt` SAYS. A row's
 * `addedAt` is when the ROW was written; draft finalisation can write it minutes or hours after the
 * draft ends. Reading it as an acquisition time would take a team's own draft picks off a week.
 * What happens to a draft that finishes after games start is a separate, unpublished policy.
 *
 * ⚠ A TRADE MOVES THE ROW and keeps `addedAt` (lib/league-runtime/redraftRosterMoveSync.ts), so a
 * traded player is not split by this rule. Native best ball refuses trades on both trade paths.
 *
 * Fails toward the old behaviour, never toward losing points: an imported league (its rows are
 * materialised whenever the importer runs) or a week whose schedule cannot be read scores the current
 * roster exactly as before.
 */
import type { PrismaClient } from '@prisma/client'
import { buildWeekKickoffMap, lockTeamLookupKeys, type WeekKickoffs } from '@/lib/redraft/lineupLock'
import { resolveWriteAuthority } from '@/lib/league/write-authority'

export type BestBallRosterRow = {
  playerId: string
  team?: string | null
  addedAt?: Date | null
  droppedAt?: Date | null
  acquisitionType?: string | null
  isKept?: boolean | null
}

const HELD_FROM_SEASON_START = new Set(['drafted', 'keeper', 'kept'])

/** True when the row's team held the player at `lock`. Pure. */
export function heldAtLock(row: BestBallRosterRow, lock: Date): boolean {
  const fromSeasonStart = row.isKept === true || HELD_FROM_SEASON_START.has(String(row.acquisitionType ?? '').toLowerCase())
  if (!fromSeasonStart && row.addedAt && row.addedAt.getTime() >= lock.getTime()) return false
  if (row.droppedAt && row.droppedAt.getTime() < lock.getTime()) return false
  return true
}

/** The player's first game lock of the week: his team's first kickoff, else the week's first. */
export function playerWeekLock(sport: string, row: Pick<BestBallRosterRow, 'team'>, kickoffs: Pick<WeekKickoffs, 'byTeam' | 'firstKickoff'>): Date | null {
  for (const key of lockTeamLookupKeys(sport, row.team)) {
    const k = kickoffs.byTeam.get(key)
    if (k) return k
  }
  return kickoffs.firstKickoff
}

/** The rows that count for the week, given the week's kickoffs. Pure; rows must include this week's drops. */
export function selectBestBallWeekRows<T extends BestBallRosterRow>(
  sport: string,
  rows: readonly T[],
  kickoffs: Pick<WeekKickoffs, 'byTeam' | 'firstKickoff'>,
): T[] {
  return rows.filter((row) => {
    const lock = playerWeekLock(sport, row, kickoffs)
    // No lock at all (no schedule): only the current roster, as before.
    if (!lock) return row.droppedAt == null
    return heldAtLock(row, lock)
  })
}

/*
 * One schedule read per (sport, season, week) per minute: a score-sync tick scores every roster of a
 * season, and the kickoffs are the same for all of them.
 */
const KICKOFF_TTL_MS = 60_000
const kickoffCache = new Map<string, { at: number; value: Promise<WeekKickoffs | null> }>()

export function loadWeekKickoffsCached(
  db: PrismaClient,
  args: { sport: string; season: number; week: number },
  now: number = Date.now(),
): Promise<WeekKickoffs | null> {
  const key = `${String(args.sport).toUpperCase()}:${args.season}:${args.week}`
  const hit = kickoffCache.get(key)
  if (hit && now - hit.at < KICKOFF_TTL_MS) return hit.value
  const value = buildWeekKickoffMap(db, args).catch((err) => {
    console.warn(`[bestBallWeekRoster] ${key}: kickoffs unreadable, scoring the current roster`, err)
    return null
  })
  kickoffCache.set(key, { at: now, value })
  return value
}

/** Test seam. */
export function clearBestBallKickoffCache(): void {
  kickoffCache.clear()
}

type RosterPlayerDb = Pick<PrismaClient, 'redraftRosterPlayer'>

/**
 * Load the best ball rows that count for one week. An imported league (`resolveWriteAuthority` not
 * NATIVE — the one definition, so the scorer and the finalizer cannot disagree about a null platform)
 * or an unreadable schedule keeps the old current-roster read. Callers that seal stats (the week finalizer)
 * and callers that score (`scoreRosterBestBall`) must both use this, so the players sealed and the
 * players scored are the same set.
 */
export async function loadBestBallWeekRosterRows(
  db: RosterPlayerDb,
  args: { rosterIds: readonly string[]; sport: string; season: number; week: number; platform: string | null | undefined; kickoffs?: WeekKickoffs | null },
): Promise<Awaited<ReturnType<RosterPlayerDb['redraftRosterPlayer']['findMany']>>> {
  if (args.rosterIds.length === 0) return []
  // One roster reads by id, exactly the query the scorer always made; several read with `in`.
  const rosterId = args.rosterIds.length === 1 ? args.rosterIds[0]! : { in: [...args.rosterIds] }
  const current = () => db.redraftRosterPlayer.findMany({ where: { rosterId, droppedAt: null } })
  if (resolveWriteAuthority(args.platform) !== 'NATIVE') return current()
  const kickoffs =
    args.kickoffs !== undefined
      ? args.kickoffs
      : await loadWeekKickoffsCached(db as unknown as PrismaClient, { sport: args.sport, season: args.season, week: args.week })
  if (!kickoffs?.firstKickoff) return current()
  const rows = await db.redraftRosterPlayer.findMany({
    where: {
      rosterId,
      // Dropped before the week's first kickoff can never have been held at a lock this week.
      OR: [{ droppedAt: null }, { droppedAt: { gte: kickoffs.firstKickoff } }],
    },
  })
  return selectBestBallWeekRows(args.sport, rows, kickoffs)
}
