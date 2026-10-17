import 'server-only'

import { z } from 'zod'
import { cachedFetch } from '@/lib/api-cache'
import { selectPlayerHighlights } from './match'
import type { PlayerHighlight, PlayerHighlightsResult } from './types'

const videoId = z.string().regex(/^[\w-]{11}$/)
const channelSchema = z.object({ items: z.array(z.object({
  id: z.string(), contentDetails: z.object({ relatedPlaylists: z.object({ uploads: z.string() }) }),
})) })
const playlistSchema = z.object({
  nextPageToken: z.string().optional(),
  items: z.array(z.object({ contentDetails: z.object({ videoId }) })),
})
const videosSchema = z.object({ items: z.array(z.object({
  id: videoId,
  snippet: z.object({
    title: z.string(), channelTitle: z.string(), channelId: z.string(),
    publishedAt: z.string().datetime(), liveBroadcastContent: z.string().optional(),
  }),
  status: z.object({ embeddable: z.boolean(), privacyStatus: z.string(), uploadStatus: z.string() }),
  contentDetails: z.object({ regionRestriction: z.object({
    allowed: z.array(z.string()).optional(), blocked: z.array(z.string()).optional(),
  }).optional() }),
})) })

type Feed = { videos: Omit<PlayerHighlight, 'kind'>[]; checkedAt: string }
let memory: { feed: Feed; until: number } | null = null
let pending: Promise<Feed> | null = null
let retryAfter = 0

async function youtube<T>(endpoint: string, params: Record<string, string>, schema: z.ZodType<T>): Promise<T> {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  // The credential is sent in a header, never in a URL, response, or log.
  const response = await fetch(url, {
    headers: { 'X-Goog-Api-Key': process.env.YOUTUBE_API_KEY!.trim() },
    signal: AbortSignal.timeout(5_000), cache: 'no-store',
  })
  if (!response.ok) throw new Error(`YouTube unavailable (HTTP ${response.status})`)
  return schema.parse(await response.json())
}

async function loadFeed(cacheChannel = true): Promise<Feed> {
  const resolveChannel = async () => {
    const result = await youtube('channels', { part: 'contentDetails', forHandle: '@NFL' }, channelSchema)
    if (!result.items[0]) throw new Error('Official channel unavailable')
    return result.items[0]
  }
  const channel = cacheChannel
    ? await cachedFetch('youtube:official-nfl-channel:v1', 86_400, resolveChannel)
    : await resolveChannel()
  const ids: string[] = []
  let pageToken: string | undefined
  // Bounded recent catalog: two playlist reads + two video reads per refresh,
  // shared across all players. No expensive per-player search requests.
  for (let page = 0; page < 2; page++) {
    const result = await youtube('playlistItems', {
      part: 'contentDetails', playlistId: channel.contentDetails.relatedPlaylists.uploads,
      maxResults: '50', ...(pageToken ? { pageToken } : {}),
    }, playlistSchema)
    ids.push(...result.items.map((item) => item.contentDetails.videoId))
    pageToken = result.nextPageToken
    if (!pageToken) break
  }
  const videos: Feed['videos'] = []
  for (let i = 0; i < ids.length; i += 50) {
    const result = await youtube('videos', {
      part: 'snippet,status,contentDetails', id: ids.slice(i, i + 50).join(','),
    }, videosSchema)
    for (const video of result.items) {
      const region = video.contentDetails.regionRestriction
      const published = Date.parse(video.snippet.publishedAt)
      if (video.snippet.channelId !== channel.id || !video.status.embeddable
        || video.status.privacyStatus !== 'public' || video.status.uploadStatus !== 'processed'
        || (video.snippet.liveBroadcastContent && video.snippet.liveBroadcastContent !== 'none')
        || (region?.allowed?.length || region?.blocked?.length)
        || published < Date.now() - 30 * 86_400_000 || published > Date.now()) continue
      videos.push({
        videoId: video.id, title: video.snippet.title, channelTitle: video.snippet.channelTitle,
        channelId: video.snippet.channelId, publishedAt: video.snippet.publishedAt,
        thumbnailUrl: `https://i.ytimg.com/vi/${video.id}/mqdefault.jpg`,
      })
    }
  }
  return { videos: videos.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)), checkedAt: new Date().toISOString() }
}

/** Read-only provider smoke test: bypasses both database cache reads and writes. */
export async function fetchOfficialNflCatalog(): Promise<Feed> {
  if (!process.env.YOUTUBE_API_KEY?.trim()) throw new Error('YouTube key is not configured')
  return loadFeed(false)
}

async function feed(): Promise<Feed> {
  if (memory && memory.until > Date.now()) return memory.feed
  memory = null
  if (retryAfter > Date.now()) throw new Error('YouTube cooling down')
  if (!pending) {
    pending = cachedFetch('youtube:official-nfl-highlights:v1', 900, loadFeed)
      .then((data) => {
        memory = { feed: data, until: Math.min(Date.now() + 900_000, Date.parse(data.checkedAt) + 900_000) }
        return data
      })
      .catch(() => {
        // Avoid repeated provider calls on missing permissions, quota exhaustion, or outages.
        retryAfter = Date.now() + 60_000
        throw new Error('YouTube unavailable')
      })
      .finally(() => { pending = null })
  }
  return pending
}

export async function getPlayerHighlights(player: { sport: string; name: string; team: string | null }): Promise<PlayerHighlightsResult> {
  if (player.sport.toUpperCase() !== 'NFL') return {
    status: 'unsupported', videos: [], message: 'Highlights are available for NFL players first.', checkedAt: null,
  }
  if (!process.env.YOUTUBE_API_KEY?.trim()) return {
    status: 'unavailable', videos: [], message: 'Highlights are not available right now.', checkedAt: null,
  }
  try {
    const catalog = await feed()
    const videos = selectPlayerHighlights(catalog.videos, player.name, player.team)
    return {
      status: 'ready', videos, checkedAt: catalog.checkedAt,
      message: videos.length ? null : 'No matching highlights in the NFL channel’s recent uploads. Check back after the game.',
    }
  } catch {
    return { status: 'unavailable', videos: [], message: 'Highlights are temporarily unavailable. Please try again later.', checkedAt: null }
  }
}
