import type { LiveGameCard } from './liveScoresPage'
import type { PlayFeedItem } from './playFeedPresentation'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'

export function canonicalPlayGames(plays: PlayFeedItem[], games: readonly LiveGameCard[], fixtures: Array<{ externalId: string; homeTeam: string; awayTeam: string; startTime: Date | string | null }>): PlayFeedItem[] {
  return plays.map(play => {
    const source = fixtures.filter(f => f.externalId === play.gameId)
    if (source.length !== 1 || !source[0].startTime) return { ...play, canonicalGameId: null }
    const f = source[0]
    const matches = games.filter(g => g.sport === 'NFL' && normalizeTeamAbbrev(f.homeTeam) === normalizeTeamAbbrev(g.home.abbrev) && normalizeTeamAbbrev(f.awayTeam) === normalizeTeamAbbrev(g.away.abbrev) && Math.abs(new Date(f.startTime!).getTime() - Date.parse(g.startTime)) <= 6 * 60 * 60 * 1000)
    return { ...play, canonicalGameId: matches.length === 1 ? matches[0].gameId : null }
  })
}
