import type { LiveGameCard, LiveImpact } from './liveScoresPage'
import type { PlayFeedItem } from './playFeedPresentation'
import { isRosteredPlayer, rosterNameKeys } from './rosterPlayMatch'

/** Vendor game IDs are namespaced. A resolved club and player must agree. */
export function playBelongsToGame(play: PlayFeedItem, game: LiveGameCard): boolean {
  if (play.canonicalGameId) return play.canonicalGameId === game.gameId
  if (game.espnDetail === false && play.gameId === game.gameId) return true
  return false
}

export function liveWorkspace(games: LiveGameCard[], plays: PlayFeedItem[], leagueId: string | null) {
  const starters = games.map(g => ({ ...g, tieIns: g.tieIns.filter(t => t.isStarter !== false) }))
  const scoped = leagueId ? starters.filter(g => g.tieIns.some(t => t.leagueId === leagueId))
    .map(g => ({ ...g, tieIns: g.tieIns.filter(t => t.leagueId === leagueId), leaguesAffected: 1 })) : starters
  const live = scoped.filter(g => g.isLive)
  const relevantPlays = plays.filter(p => scoped.some(g => playBelongsToGame(p, g) && (!leagueId || g.tieIns.some(t => p.sleeperId ? t.playerId === p.sleeperId : isRosteredPlayer(rosterNameKeys([t.playerName]), p.playerName)))))
  const mover = relevantPlays.find(p => live.some(g => playBelongsToGame(p, g) && g.tieIns.some(t => p.sleeperId ? t.playerId === p.sleeperId : isRosteredPlayer(rosterNameKeys([t.playerName]), p.playerName))))
  const leagues = new Map<string, { id: string; name: string; live: number; completed: number; remaining: number; missing: number }>()
  const seen = new Set<string>()
  for (const g of scoped) for (const t of g.tieIns) {
    const key = `${g.gameId}:${t.leagueId}:${t.playerId}`
    if (seen.has(key)) continue
    seen.add(key)
    const row = leagues.get(t.leagueId) ?? { id: t.leagueId, name: t.leagueName, live: 0, completed: 0, remaining: 0, missing: 0 }
    if (g.isLive || g.completed) {
      if (t.points == null) row.missing++
      else if (g.isLive) row.live += t.points
      else row.completed += t.points
    } else row.remaining++
    leagues.set(t.leagueId, row)
  }
  const impact: LiveImpact = {
    totalPoints: [...leagues.values()].reduce((sum, l) => sum + l.live, 0),
    livePlayers: new Set(live.flatMap(g => g.tieIns.map(t => t.playerId))).size,
    liveGames: live.filter(g => g.tieIns.length).length,
    plays: relevantPlays,
    biggestMover: mover ? { ...mover, leagues: [...new Set(live.filter(g => playBelongsToGame(mover, g)).flatMap(g => g.tieIns.filter(t => mover.sleeperId ? t.playerId === mover.sleeperId : isRosteredPlayer(rosterNameKeys([t.playerName]), mover.playerName)).map(t => t.leagueName)))] } : null,
    upNext: scoped.filter(g => !g.isLive && !g.completed && g.tieIns.length).sort((a,b) => a.startTime.localeCompare(b.startTime)).slice(0,3).map(g => ({ playerName: g.tieIns[0].playerName, matchup: `${g.away.abbrev} @ ${g.home.abbrev}`, startTime: g.startTime })),
  }
  return { games: scoped, impact, leagues: [...leagues.values()] }
}
