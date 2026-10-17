import type { PlayerHighlightsResult, TeamHighlight, TeamHighlightsResult } from './types'

export function mergeRosterHighlights(results: Array<{ sleeperId: string; name: string; result: PlayerHighlightsResult }>): TeamHighlightsResult {
  const videos = new Map<string, TeamHighlight>()
  for (const player of results) for (const video of player.result.videos) {
    const existing = videos.get(video.videoId)
    if (existing) {
      if (!existing.players.some(p => p.sleeperId === player.sleeperId)) existing.players.push({ sleeperId: player.sleeperId, name: player.name })
      if (video.kind === 'player') existing.kind = 'player'
    } else videos.set(video.videoId, { ...video, players: [{ sleeperId: player.sleeperId, name: player.name }] })
  }
  const ready = results.some(player => player.result.status === 'ready')
  const sorted = [...videos.values()].sort((a, b) => Number(b.kind === 'player') - Number(a.kind === 'player') || b.publishedAt.localeCompare(a.publishedAt)).slice(0, 24)
  return {
    status: ready ? 'ready' : 'unavailable', videos: sorted,
    checkedAt: results.map(p => p.result.checkedAt).filter((date): date is string => !!date).sort().at(-1) ?? null,
    message: !ready ? 'Highlights are temporarily unavailable. Please try again later.' : !sorted.length ? 'No matching highlights in the NFL channel’s recent uploads. Check back after the game.' : null,
  }
}
