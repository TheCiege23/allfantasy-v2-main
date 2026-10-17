export type PlayerHighlight = {
  videoId: string
  title: string
  channelTitle: string
  channelId: string
  publishedAt: string
  thumbnailUrl: string
  kind: 'player' | 'game'
}

export type PlayerHighlightsResult = {
  status: 'ready' | 'unavailable' | 'unsupported'
  videos: PlayerHighlight[]
  message: string | null
  checkedAt: string | null
}

export type TeamHighlight = PlayerHighlight & { players: Array<{ sleeperId: string; name: string }> }
export type TeamHighlightsResult = Omit<PlayerHighlightsResult, 'videos'> & { videos: TeamHighlight[] }
