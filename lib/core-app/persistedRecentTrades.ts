import 'server-only'
import { prisma } from '@/lib/prisma'
import type { RecentTrade, RecentTradeAsset, RecentTradesLeague } from './recentTrades'
import { attachPlayerMediaBatch } from '@/lib/player-media'
import { resolveProviderRosterPlayers, type ResolvedProviderPlayer } from '@/lib/player-identity/resolveProviderRosterPlayers'

const PLATFORM_LABEL: Record<string, string> = { espn: 'ESPN', yahoo: 'Yahoo', mfl: 'MFL', fantrax: 'Fantrax', fleaflicker: 'Fleaflicker' }

/**
 * 🛑 ONLY SLEEPER IDS WERE EVER NAMED HERE. An ESPN trade's player ids went straight to the card as
 * "Player 4432620" (production 2026-09-28, Washington Pro Knockout on /core) — a raw provider id in
 * front of a manager, and "a player with no name on file cannot be priced" underneath it. Each
 * non-Sleeper platform's ids resolve through its own `PlayerIdentityMap` column, the resolver the
 * roster materializer and the trade engine already use. What still does not resolve says so, and
 * never shows the raw id.
 */
async function resolveForeignPlayers(
  rows: Array<{ platform: string; sport: string | null; playersReceived: unknown }>,
): Promise<Map<string, ResolvedProviderPlayer>> {
  const groups = new Map<string, { platform: string; sport: string; ids: string[] }>()
  for (const r of rows) {
    if (r.platform === 'sleeper' || !Array.isArray(r.playersReceived)) continue
    const sport = String(r.sport ?? 'nfl').toUpperCase()
    const key = `${r.platform}|${sport}`
    const g = groups.get(key) ?? { platform: r.platform, sport, ids: [] }
    g.ids.push(...r.playersReceived.map(String))
    groups.set(key, g)
  }
  const out = new Map<string, ResolvedProviderPlayer>()
  await Promise.all([...groups.values()].map(async (g) => {
    const found = await resolveProviderRosterPlayers(g.platform, g.ids, g.sport).catch(() => new Map<string, ResolvedProviderPlayer>())
    for (const [id, p] of found) out.set(`${g.platform}|${g.sport}|${id}`, p)
  }))
  return out
}

/** Completed ingestion events are news even while their analytical grade is pending. */
export async function persistedRecentTrades(leagues: RecentTradesLeague[], cutoff: Date): Promise<RecentTrade[]> {
  if (!prisma.leagueTrade) return []
  const bySource = new Map(leagues.filter(l => l.platformLeagueId).map(l => [`${String(l.platform ?? 'sleeper').toLowerCase()}:${l.platformLeagueId}`, l]))
  if (!bySource.size) return []
  const rows = await prisma.leagueTrade.findMany({
    where: { OR: [...bySource.values()].map(l => ({ platform: String(l.platform ?? 'sleeper').toLowerCase(), history: { sleeperLeagueId: l.platformLeagueId! } })), tradeDate: { gte: cutoff } },
    orderBy: { tradeDate: 'desc' }, take: 400,
    select: { transactionId: true, tradeDate: true, platform: true, sport: true, playersReceived: true, picksReceived: true,
      history: { select: { sleeperLeagueId: true, sleeperUsername: true } } },
  })
  const ids = [...new Set(rows.filter(r => r.platform === 'sleeper' && String(r.sport).toLowerCase() === 'nfl').flatMap(r => Array.isArray(r.playersReceived) ? r.playersReceived.map(String) : []))]
  const [players, teams, media, foreign] = await Promise.all([
    ids.length ? prisma.sportsPlayer.findMany({ where: { sleeperId: { in: ids } }, select: { sleeperId: true, name: true, position: true } }) : [],
    prisma.leagueTeam.findMany({ where: { leagueId: { in: leagues.map(l => l.id) } },
      select: { leagueId: true, externalId: true, platformUserId: true, ownerName: true, teamName: true, avatarUrl: true } }),
    attachPlayerMediaBatch(ids.map(playerId => ({ playerId, sport: 'nfl' }))).catch(() => new Map()),
    resolveForeignPlayers(rows).catch(() => new Map<string, ResolvedProviderPlayer>()),
  ])
  const named = new Map(players.filter(p => p.sleeperId).map(p => [p.sleeperId!, p]))
  const grouped = new Map<string, RecentTrade>()
  for (const row of rows) {
    const league = bySource.get(`${row.platform}:${row.history.sleeperLeagueId}`)
    if (!league || !row.tradeDate) continue
    const key = `${row.platform}:${row.history.sleeperLeagueId}:${row.transactionId}`
    let trade = grouped.get(key)
    if (!trade) {
      trade = { id: key, leagueId: league.id, leagueName: league.name, leagueAvatarUrl: league.avatarUrl ?? null,
        sport: league.sport ?? row.sport, platformLeagueId: row.history.sleeperLeagueId, acceptedAt: row.tradeDate.toISOString(), sides: [], partial: false, verdict: null }
      grouped.set(key, trade)
    }
    const team = teams.find(t => t.leagueId === league.id && t.platformUserId === row.history.sleeperUsername)
    const rosterId = team?.externalId ?? row.history.sleeperUsername
    if (trade.sides.some(s => String(s.rosterId) === rosterId)) continue
    const received: RecentTradeAsset[] = (Array.isArray(row.playersReceived) ? row.playersReceived : []).map(raw => {
      const id = String(raw), nflSleeper = row.platform === 'sleeper' && String(row.sport).toLowerCase() === 'nfl', player = nflSleeper ? named.get(id) : null, image = nflSleeper ? media.get(id) : null
      const other = nflSleeper ? null : foreign.get(`${row.platform}|${String(row.sport ?? 'nfl').toUpperCase()}|${id}`) ?? null
      const realName = player?.name ?? other?.name ?? null
      const unnamed = row.platform === 'sleeper' ? `Player ${id}` : `Unrecognised ${PLATFORM_LABEL[row.platform] ?? row.platform} player`
      return { kind: 'player', playerId: nflSleeper ? id : null, name: realName ?? unnamed, position: player?.position ?? other?.position ?? null,
        team: image?.teamAbbr ?? other?.team ?? null, headshotUrl: image?.media.headshotUrl ?? other?.imageUrl ?? null, teamLogoUrl: image?.media.teamLogoUrl ?? null,
        // Graded by the REAL name only: a placeholder is nobody, and pricing it would price nobody.
        gradeAs: realName ? { kind: 'player', name: realName } : null }
    })
    for (const raw of Array.isArray(row.picksReceived) ? row.picksReceived : []) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
      const pick = raw as { season?: unknown; round?: unknown }
      const season = Number(pick.season), round = Number(pick.round)
      received.push({ kind: 'pick', playerId: null, name: `${pick.season ?? 'Future'} round ${pick.round ?? '?'}`,
        position: null, team: null, headshotUrl: null, teamLogoUrl: null,
        gradeAs: Number.isInteger(season) && Number.isInteger(round) && round > 0 ? { kind: 'pick', season, round } : null })
    }
    trade.sides.push({ rosterId, managerName: team?.ownerName ?? 'Manager', teamName: team?.teamName ?? null,
      avatarUrl: team?.avatarUrl ?? null, received, grade: null, gradeBasis: null, gradeReason: 'Trade received. Grade pending.' })
  }
  return [...grouped.values()].map(t => ({ ...t, partial: t.sides.length < 2 || t.sides.some(s => !s.received.length) }))
}
