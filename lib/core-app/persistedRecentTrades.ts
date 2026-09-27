import 'server-only'
import { prisma } from '@/lib/prisma'
import type { RecentTrade, RecentTradeAsset, RecentTradesLeague } from './recentTrades'
import { attachPlayerMediaBatch } from '@/lib/player-media'

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
  const [players, teams, media] = await Promise.all([
    ids.length ? prisma.sportsPlayer.findMany({ where: { sleeperId: { in: ids } }, select: { sleeperId: true, name: true, position: true } }) : [],
    prisma.leagueTeam.findMany({ where: { leagueId: { in: leagues.map(l => l.id) } },
      select: { leagueId: true, externalId: true, platformUserId: true, ownerName: true, teamName: true, avatarUrl: true } }),
    attachPlayerMediaBatch(ids.map(playerId => ({ playerId, sport: 'nfl' }))).catch(() => new Map()),
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
      return { kind: 'player', playerId: nflSleeper ? id : null, name: player?.name ?? `Player ${id}`, position: player?.position ?? null,
        team: image?.teamAbbr ?? null, headshotUrl: image?.media.headshotUrl ?? null, teamLogoUrl: image?.media.teamLogoUrl ?? null,
        // Graded by the REAL name only: "Player 123" is a placeholder, and pricing it would price nobody.
        gradeAs: player?.name ? { kind: 'player', name: player.name } : null }
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
