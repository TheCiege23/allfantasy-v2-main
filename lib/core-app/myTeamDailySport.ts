import 'server-only'
import { prisma } from '@/lib/prisma'
import { isDailyFormSport } from '@/lib/projections/dailySportForm'
import { loadDailySportOutlook, type OutlookPlayerInput } from '@/lib/projections/dailySportOutlook'
import type { LineupPlayer } from './myTeam'

/**
 * NBA / NHL / MLB on My Team: each player's projection under THIS league's scoring, and his game,
 * from the daily-sport outlook the roster and waiver screens already use
 * (lib/projections/dailySportOutlook.ts).
 *
 * 🛑 MY TEAM WAS NFL-ONLY FOR THESE SPORTS AND SAID SO ON EVERY ROW. `resolvePlayers` prices from the
 * Sleeper NFL weekly feed (`fantasy_projections`, keyed on Sleeper ids) and finds games by an NFL-style
 * week number (`resolveSportsWeek` requires `SportsGame.week`). An NHL roster has neither, so every row
 * read "no game found for this week" and the lineup carried "none of them could be priced under this
 * league's scoring" — while the NHL schedule (1,474 games in the 30-day window, production 2026-10-30)
 * and per-game projections sat in Postgres for the screens next door. Reported on a Fantrax NHL league.
 *
 * Fills only what is missing — a player the NFL path already priced is left alone — and mutates the
 * map in place, as the caller's game-day pass does. A Fantrax roster holds Fantrax player ids; the
 * outlook's bridge finds identity ids, Rolling Insights numbers and TheSportsDB names, so a Fantrax id
 * is translated through `PlayerIdentityMap.fantraxId` first (written by the scheduled
 * ingestProFantraxIdentities). DB only; any failure leaves the rows as they were, never a thrown error.
 */
export async function applyDailySportToLineup(
  resolved: Map<string, LineupPlayer>,
  league: { sport: string; season: number | string | null; settings: unknown; platform: string | null },
  now: Date = new Date(),
): Promise<void> {
  const sport = String(league.sport ?? '').trim().toUpperCase()
  if (!isDailyFormSport(sport) || resolved.size === 0) return

  // The same object can sit under a roster id and a Sleeper id; price each one once, under every key.
  const pending = [...resolved.entries()].filter(([, p]) => p.afProjectedPoints == null || p.gameContext == null)
  if (pending.length === 0) return

  const identityByFantraxId = new Map<string, string>()
  if (String(league.platform ?? '').trim().toLowerCase() === 'fantrax') {
    const rows = await prisma.playerIdentityMap
      .findMany({
        where: { sport, fantraxId: { in: pending.map(([id]) => id) } },
        select: { id: true, fantraxId: true },
      })
      .catch(() => [] as Array<{ id: string; fantraxId: string | null }>)
    for (const r of rows) if (r.fantraxId) identityByFantraxId.set(r.fantraxId, r.id)
  }

  const players: OutlookPlayerInput[] = pending.map(([id, p]) => ({
    key: id,
    lookupId: identityByFantraxId.get(id) ?? id,
    team: p.team,
    injuryStatus: p.injuryStatus,
  }))
  const season = league.season == null || String(league.season).trim() === '' ? null : Number(league.season)
  const outlook = await loadDailySportOutlook(prisma, {
    league: { sport, season: Number.isInteger(season) ? season : null, settings: league.settings },
    players,
    now,
  }).catch(() => null)
  if (!outlook) return

  for (const [id, p] of pending) {
    const o = outlook.byKey.get(id)
    if (!o) continue
    if (p.afProjectedPoints == null) p.afProjectedPoints = p.ruledOut ? 0 : o.projectedPoints
    if (p.gameContext == null) p.gameContext = dailyGameContext(p.team, o)
  }
}

/**
 * The row's game line. A daily-lineup league knows the day's opponent ("BOS vs NYR"); a weekly one knows
 * how many games the team plays this week, which is what a weekly lineup is actually deciding on.
 * Null — the row's "no game found" — only when the slate is unknown, never a guessed zero.
 */
export function dailyGameContext(
  team: string | null,
  o: { opponent?: string | null; homeAway?: 'home' | 'away' | null; periodGames: number | null },
): string | null {
  if (o.opponent) return `${team ?? '—'} ${o.homeAway === 'away' ? '@' : 'vs'} ${o.opponent}`
  if (o.periodGames == null) return null
  if (o.periodGames === 0) return 'no games this week'
  return `${o.periodGames} ${o.periodGames === 1 ? 'game' : 'games'} this week`
}
