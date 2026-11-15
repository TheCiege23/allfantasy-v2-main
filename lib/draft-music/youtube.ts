/**
 * YouTube for the draft room: preset stations and pasted links.
 *
 * Played through YouTube's own embedded player, so it needs no API key and
 * no quota. YouTube's rules apply: the player stays visible (at least 200×200),
 * nothing is overlaid on it, and it is never hidden to make it audio-only.
 */

export type YouTubeSource =
  | { kind: 'video'; videoId: string }
  | { kind: 'playlist'; listId: string; videoId?: string }

export type YouTubeStation = {
  id: string
  label: string
  channel: string
  source: YouTubeSource
}

/**
 * Checked 2026-11-15 against YouTube's oEmbed endpoint (title and channel
 * returned). These are long-running live streams; if one ever ends, its tile
 * shows YouTube's own "unavailable" card — swap the id here.
 */
export const YOUTUBE_STATIONS: YouTubeStation[] = [
  {
    id: 'lofi',
    label: 'Lo-fi beats',
    channel: 'Chillhop Music',
    source: { kind: 'video', videoId: '7NOSDKb0HlU' },
  },
  {
    id: 'jazzy',
    label: 'Jazzy lo-fi',
    channel: 'Chillhop Music',
    source: { kind: 'video', videoId: '5yx6BWlEVcY' },
  },
  {
    id: 'synthwave',
    label: 'Synthwave',
    channel: 'Lofi Girl',
    source: { kind: 'video', videoId: '4xDzrJKXOOY' },
  },
]

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/
const LIST_ID = /^[A-Za-z0-9_-]{10,80}$/
const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
])

/** Turns a pasted YouTube link (or bare video id) into something we can embed. */
export function parseYouTubeLink(input: string): YouTubeSource | null {
  const text = input.trim()
  if (!text) return null
  if (VIDEO_ID.test(text)) return { kind: 'video', videoId: text }

  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`)
  } catch {
    return null
  }
  if (!YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) return null

  const listParam = url.searchParams.get('list')
  const listId = listParam && LIST_ID.test(listParam) ? listParam : null

  let videoId: string | null = null
  if (url.hostname.toLowerCase().endsWith('youtu.be')) {
    videoId = url.pathname.split('/')[1] ?? null
  } else if (url.pathname === '/watch') {
    videoId = url.searchParams.get('v')
  } else {
    const match = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?#]+)/)
    if (match && match[1] !== 'videoseries') videoId = match[1]
  }
  if (videoId && !VIDEO_ID.test(videoId)) videoId = null

  if (listId) return videoId ? { kind: 'playlist', listId, videoId } : { kind: 'playlist', listId }
  if (videoId) return { kind: 'video', videoId }
  return null
}

/** The privacy-enhanced embed URL. Autoplay only ever follows a user's click. */
export function youTubeEmbedUrl(source: YouTubeSource, opts: { autoplay: boolean }): string {
  const params = new URLSearchParams({
    playsinline: '1',
    rel: '0',
  })
  if (opts.autoplay) params.set('autoplay', '1')

  let path: string
  if (source.kind === 'video') {
    path = `/embed/${source.videoId}`
  } else if (source.videoId) {
    path = `/embed/${source.videoId}`
    params.set('list', source.listId)
  } else {
    path = '/embed/videoseries'
    params.set('list', source.listId)
  }
  return `https://www.youtube-nocookie.com${path}?${params.toString()}`
}
