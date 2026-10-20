/**
 * Is the league's trade window open RIGHT NOW — decided by the server, for every sport.
 *
 * 🛑 THE DEADLINE WAS NEVER ENFORCED FOR NATIVE TRADES, BECAUSE THE WEEK CAME FROM THE CLIENT.
 * `isPastTradeDeadline(league, currentWeek)` returns false when `currentWeek` is null, and the
 * Trade Center's propose path (`/api/leagues/[leagueId]/trades`) never passed one — nor did
 * `ProposeTradeModal`. The counter route forwarded `body.currentWeek` verbatim, so a client could
 * send `1` in week 15. Nothing re-checked at accept time or before a delayed trade executed, and
 * the redraft Trade Center path enforced deadline and `lockAllMoves` only through the NFL runtime,
 * so NBA / NHL / MLB leagues had neither.
 *
 * So the week is resolved HERE, never accepted from a caller:
 *   1. the league's newest `RedraftSeason.currentWeek` — the column the redraft runtimes advance
 *      (`resolveNflRedraftTradeRuntime`, the chimmy current-week helper, the lineup/scoring routes).
 *      A season row at week 0 has not started, so no deadline can be past.
 *   2. otherwise `League.settings.currentWeek` (the key `weekFromLeagueSettingsForLineup` reads),
 *      WITHOUT that helper's default of 1 — an unknown week is reported as unknown.
 *
 * An unset deadline (`tradeDeadlineWeek == null`) means no deadline, unchanged. An unresolvable week
 * also means the deadline cannot be shown to have passed, and the check stays open; `lockAllMoves`
 * needs no week and is always enforced.
 */

import type { League } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { resolveLeagueTradeSettings } from '@/lib/league-trade-engine/tradeSettingsResolver'

export const TRADE_DEADLINE_CODE = 'TRADE_DEADLINE'
export const MOVES_LOCKED_CODE = 'MOVES_LOCKED'

export type TradeWindowRefusal = { code: typeof TRADE_DEADLINE_CODE | typeof MOVES_LOCKED_CODE; message: string }

type WeekDb = { redraftSeason: { findFirst: (args: any) => Promise<{ currentWeek: number | null } | null> } }

function settingsWeek(settings: unknown): number | null {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null
  const o = settings as Record<string, unknown>
  const raw = o.currentWeek ?? o.current_week ?? o.week
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? parseInt(raw, 10) : NaN
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null
}

/** The league's current fantasy week, from server state only. `null` = unknown / not started. */
export async function resolveServerTradeWeek(
  league: Pick<League, 'id' | 'settings'>,
  opts: { seasonId?: string | null; db?: WeekDb } = {},
): Promise<number | null> {
  const db = opts.db ?? (prisma as unknown as WeekDb)
  let season: { currentWeek: number | null } | null = null
  try {
    season = await db.redraftSeason.findFirst({
      where: opts.seasonId ? { id: opts.seasonId, leagueId: league.id } : { leagueId: league.id },
      orderBy: { createdAt: 'desc' },
      select: { currentWeek: true },
    })
  } catch {
    season = null
  }
  if (season) {
    const w = Number(season.currentWeek)
    return Number.isFinite(w) && w > 0 ? Math.floor(w) : null
  }
  return settingsWeek(league.settings)
}

/** Pure: the refusal for this league at this week, or null when trading is open. */
export function tradeWindowRefusal(
  league: Pick<League, 'lockAllMoves'> & Partial<League>,
  currentWeek: number | null,
  deadlineWeek?: number | null,
): TradeWindowRefusal | null {
  if (league.lockAllMoves) {
    return { code: MOVES_LOCKED_CODE, message: 'Roster moves are locked by the commissioner, so trades cannot be proposed or accepted right now.' }
  }
  const deadline =
    deadlineWeek !== undefined ? deadlineWeek : resolveLeagueTradeSettings(league as League)?.tradeDeadlineWeek ?? null
  if (deadline == null || currentWeek == null) return null
  if (currentWeek > deadline) {
    return { code: TRADE_DEADLINE_CODE, message: `The trade deadline has passed (it was after week ${deadline}; it is now week ${currentWeek}).` }
  }
  return null
}

/** Resolve the week server-side and evaluate the window. */
export async function resolveTradeWindow(
  league: League,
  opts: { seasonId?: string | null; db?: WeekDb } = {},
): Promise<{ currentWeek: number | null; refusal: TradeWindowRefusal | null }> {
  const currentWeek = await resolveServerTradeWeek(league, opts)
  return { currentWeek, refusal: tradeWindowRefusal(league, currentWeek) }
}

/** Load the league by id and evaluate. A missing league is not this guard's refusal to make. */
export async function resolveTradeWindowForLeague(
  leagueId: string,
  opts: { seasonId?: string | null } = {},
): Promise<{ currentWeek: number | null; refusal: TradeWindowRefusal | null }> {
  let league: League | null = null
  try {
    league = await prisma.league.findUnique({ where: { id: leagueId } })
  } catch {
    league = null
  }
  if (!league) return { currentWeek: null, refusal: null }
  return resolveTradeWindow(league, opts)
}
