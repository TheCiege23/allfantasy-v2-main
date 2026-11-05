import 'server-only'
import { prisma } from '@/lib/prisma'
import { bridgeImportedGameLogIds } from '@/lib/redraft/importedGameLogIdBridge'
import { isDailyFormSport } from '@/lib/projections/dailySportForm'
import { loadDailySportOutlook, type OutlookPlayerInput } from '@/lib/projections/dailySportOutlook'
import { loadFinderCollegeSoccerOutlook } from '@/lib/projections/finderCollegeSoccerOutlook'
import { normalizeNcaabGameStats } from '@/lib/scoring-runtime/dailySportStatNormalization'
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
): Promise<DailyLineupPeriod | null> {
  const sport = String(league.sport ?? '').trim().toUpperCase()
  const fantrax = String(league.platform ?? '').trim().toLowerCase() === 'fantrax'
  const collegeBasketball = fantrax && sport === 'NCAAB'
  if ((!isDailyFormSport(sport) && !collegeBasketball) || resolved.size === 0) return null

  // The same object can sit under a roster id and a Sleeper id; price each one once, under every key.
  const pending = [...resolved.entries()].filter(([, p]) => p.afProjectedPoints == null || p.gameContext == null)
  if (pending.length === 0) return null

  const identityByFantraxId = new Map<string, string>()
  if (fantrax) {
    const rows = await prisma.playerIdentityMap
      .findMany({
        where: { sport, fantraxId: { in: pending.map(([id]) => id) } },
        select: { id: true, fantraxId: true },
      })
      .catch(() => [] as Array<{ id: string; fantraxId: string | null }>)
    const ambiguous = new Set<string>()
    for (const r of rows) {
      if (!r.fantraxId) continue
      if (identityByFantraxId.has(r.fantraxId)) ambiguous.add(r.fantraxId)
      identityByFantraxId.set(r.fantraxId, r.id)
    }
    for (const id of ambiguous) identityByFantraxId.delete(id)
  }

  const sleeperNba = sport === 'NBA' && String(league.platform ?? '').trim().toLowerCase() === 'sleeper'
  const identityBySleeperId = new Map<string, string>()
  if (sleeperNba) {
    const bridge = await bridgeImportedGameLogIds({
      provider: 'sleeper',
      sport,
      rosterIds: pending.map(([id]) => id),
    }).catch(() => null)
    for (const identityId of bridge?.gameLogIds ?? []) {
      const sleeperId = bridge?.rosterIdFor(identityId)
      if (sleeperId) identityBySleeperId.set(sleeperId, identityId)
    }
  }

  const players: OutlookPlayerInput[] = pending.map(([id, p]) => ({
    key: id,
    lookupId: sleeperNba
      ? identityBySleeperId.get(id) ?? `unbridged:${id}`
      : identityByFantraxId.get(id) ?? id,
    team: p.team,
    injuryStatus: p.injuryStatus,
  }))
  const season = league.season == null || String(league.season).trim() === '' ? null : Number(league.season)
  if (collegeBasketball) {
    const identityIds = [...new Set(identityByFantraxId.values())]
    const [outlook, logs] = await Promise.all([
      loadFinderCollegeSoccerOutlook(prisma, {
        league: { sport, season: Number.isInteger(season) ? season : null, settings: league.settings },
        players: pending.map(([id, player]) => ({
          key: id,
          lookupId: identityByFantraxId.get(id) ?? null,
          team: player.team,
          position: player.position,
          injuryStatus: player.injuryStatus,
        })),
        now,
      }).catch(() => null),
      identityIds.length && Number.isInteger(season)
        ? prisma.playerGameStat.findMany({
            where: { sportType: sport, season: season!, source: 'rolling_insights_live', playerId: { in: identityIds }, gameDate: { lte: now } },
            orderBy: [{ gameDate: 'desc' }, { gameId: 'desc' }],
            distinct: ['playerId'],
            select: { playerId: true, gameDate: true, normalizedStatMap: true },
          }).catch(() => [])
        : [],
    ])
    const logsByIdentity = new Map(logs.map((log) => [log.playerId, log]))
    for (const [id, player] of pending) {
      const log = logsByIdentity.get(identityByFantraxId.get(id) ?? '')
      if (log?.gameDate) {
        const stats = normalizeNcaabGameStats(log.normalizedStatMap).stats
        const box = ['pts', 'reb', 'ast', 'stl', 'blk', 'to'].flatMap((key) =>
          typeof stats?.[key] === 'number' ? [{ key, value: stats[key] }] : [],
        )
        if (box.length) player.latestCollegeBoxScore = { date: log.gameDate.toISOString().slice(0, 10), stats: box }
      }
      const form = outlook?.byKey.get(id)
      if (!form) continue
      if (player.afProjectedPoints == null) {
        player.afProjectedPoints = player.ruledOut ? 0 : form.projectedPoints
        player.projectionSource = 'allfantasy'
      }
      player.gameContext ??= dailyGameContext(player.team, form, 'week')
    }
    return outlook?.period ? { kind: 'week', day: null, week: outlook.period.week } : null
  }

  const outlook = await loadDailySportOutlook(prisma, {
    league: { sport, season: Number.isInteger(season) ? season : null, settings: league.settings },
    players,
    now,
  }).catch(() => null)
  if (!outlook) return null

  const kind = outlook.period?.kind ?? null
  for (const [id, p] of pending) {
    const o = outlook.byKey.get(id)
    if (!o) continue
    if (p.afProjectedPoints == null) {
      // AllFantasy's daily-form model priced him, not a vendor — the column must not say Sleeper.
      p.afProjectedPoints = p.ruledOut ? 0 : o.projectedPoints
      p.projectionSource = 'allfantasy'
    }
    if (p.gameContext == null) p.gameContext = dailyGameContext(p.team, o, kind)
    /*
     * The period's slate WAS read for him and holds no game for his team: an off day (daily lineup) or
     * an idle week. `periodGames` is null when his team's slate is unknown, and that stays unmarked —
     * an unread schedule is not a day off.
     */
    if (o.periodGames === 0 && kind && !o.opponent) p.noGamePeriod = kind
  }
  return outlook.period
    ? { kind: outlook.period.kind, day: outlook.period.day ?? null, week: outlook.period.week ?? null }
    : null
}

/** The period the outlook priced — one day in a daily-lineup league, else the sport's week. */
export type DailyLineupPeriod = { kind: 'day' | 'week'; day: string | null; week: number | null }

/**
 * The row's game line. A daily-lineup league knows the day's opponent ("BOS vs NYR"); a weekly one knows
 * how many games the team plays this week, which is what a weekly lineup is actually deciding on.
 * Null — the row's "no game found" — only when the slate is unknown, never a guessed zero.
 *
 * ⚠ A DAY PERIOD COUNTS ONE DAY. In a daily-lineup league `periodGames` is 0 or 1 for TODAY
 * (dailySportOutlook.ts), so "no games this week" beside a team that plays tomorrow was false. With the
 * period's kind passed, a day reads "no game today"; without it (older callers) the weekly wording stands.
 */
export function dailyGameContext(
  team: string | null,
  o: { opponent?: string | null; homeAway?: 'home' | 'away' | null; periodGames: number | null },
  kind: 'day' | 'week' | null = null,
): string | null {
  if (o.opponent) return `${team ?? '—'} ${o.homeAway === 'away' ? '@' : 'vs'} ${o.opponent}`
  if (o.periodGames == null) return null
  if (kind === 'day') return o.periodGames === 0 ? 'no game today' : 'game today'
  if (o.periodGames === 0) return 'no games this week'
  return `${o.periodGames} ${o.periodGames === 1 ? 'game' : 'games'} this week`
}
