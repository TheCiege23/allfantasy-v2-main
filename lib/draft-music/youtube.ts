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
 * Genre playlists of real artists, plus one lo-fi stream for focus.
 *
 * Every entry was PLAYED in YouTube's embedded player (youtube-nocookie
 * videoseries) in Chrome on 2026-11-15 — not just looked up — because a
 * playlist can exist and still refuse embedded playback. First tracks heard:
 * Crime Mob, 50 Cent, Thomas Rhett, Dolly Parton, Linkin Park, The Police,
 * Olivia Rodrigo, Ariana Grande, Alan Walker.
 *
 * ⚠ THE `RDCLAK5uy_…` IDS ARE YOUTUBE MUSIC'S OWN EDITORIAL PLAYLISTS, which
 * YouTube keeps current — and YouTube's oEmbed endpoint answers 404 for every
 * one of them. That 404 is NOT evidence a list is gone; only an embed test is.
 * Hip-hop has no findable editorial list, so those two are curator lists:
 * Warner Records' own, and Redlist's.
 *
 * Playlists drift: a label can pull a video or block embedding on it. YouTube
 * then skips or shows its own "unavailable" card for that track. If a whole
 * station dies, swap the id here and re-run the embed test.
 */
export const YOUTUBE_STATIONS: YouTubeStation[] = [
  {
    /*
     * American stadium game day: Saliva "Ladies and Gentlemen", "Sirius",
     * "Welcome to the Jungle", "Kernkraft 400", "Enter Sandman", "Eye of the
     * Tiger", "Jump Around", "Still D.R.E.", "Song 2", "Pump Up the Jam" — read
     * off the playlist page 2026-11-15, 76+ tracks, and played in the embed.
     * ⚠ NOT Redlist's "Best Football Anthems": despite the name it is soccer —
     * FIFA World Cup songs from "Waka Waka" down — which is the wrong game day.
     */
    id: 'game-day',
    label: 'Game day hype',
    channel: 'Stadium anthems',
    source: { kind: 'playlist', listId: 'PLzLL4DfilFdyUvq2CKE0IZVHjmMM0k_fa' },
  },
  {
    /*
     * Talk, not music. The Fantasy Footballers' own "The Fantasy Footballers
     * Podcast" playlist (channel UC-No2ITxJsNt50oJQ3fLmUA), taken from their
     * channel's Podcasts tab.
     * ⚠ IT MUST BE NEWEST-FIRST, OR THE STATION OPENS ON AN OLD EPISODE. Checked
     * 2026-11-15: its first entry (Ep. 2015, "Week 10 Matchups") was the same as
     * the channel's newest upload. If they ever reorder it, use the channel's
     * uploads list instead — "UU" + the channel id after "UC" — which is
     * always newest-first, at the cost of including their short clips.
     */
    id: 'ff-podcast',
    label: 'Football podcast',
    channel: 'The Fantasy Footballers',
    source: { kind: 'playlist', listId: 'PLoISu6EAcn3AQQnURLbOkch3mloBBijQd' },
  },
  {
    /*
     * Talk, not music. Locked On Fantasy Basketball's own full-episode playlist
     * — a daily show, hosted by Basketball Monster's lead analyst.
     * Newest-first was checked, not assumed: on 2026-11-15 (playlist "Updated
     * today") its first eight entries matched the channel's newest uploads in
     * order, starting with "Fantasy Basketball Streaming Monday". Same fallback
     * as the football podcast if that ever changes: the channel's "UU…" uploads.
     */
    id: 'fb-podcast',
    label: 'Basketball podcast',
    channel: 'Locked On',
    source: { kind: 'playlist', listId: 'PL1U5boGn_ErQHkDY_ytdLguynLmxS9bRB' },
  },
  {
    /*
     * Talk, not music. Locked On Fantasy Baseball's own full-episode playlist
     * (same network as the basketball show).
     * Checked 2026-11-15, in the offseason on purpose: still posting ("Updated
     * yesterday" — 2026 awards recap, 2027 draft targets, team reviews), and its
     * first six entries matched the channel's newest uploads in order. Same
     * "UU…" uploads fallback as the other podcasts if the order ever changes.
     */
    id: 'mlb-podcast',
    label: 'Baseball podcast',
    channel: 'Locked On',
    source: { kind: 'playlist', listId: 'PLc30fhmgZQgV4w1mYm1dXsHPGrLGTaszA' },
  },
  {
    id: 'hiphop-hype',
    label: 'Hip-hop hype',
    channel: 'Warner Records',
    source: { kind: 'playlist', listId: 'PLHAJiQEawl7gyNq4C8PbcqkrM163oroMJ' },
  },
  {
    id: 'rap-workout',
    label: 'Rap workout',
    channel: 'Redlist',
    source: { kind: 'playlist', listId: 'PLi13rLFLL6Q87nSTlAwpgczsy7kP35oYH' },
  },
  {
    id: 'country',
    label: 'Country hits',
    channel: 'YouTube Music',
    source: { kind: 'playlist', listId: 'RDCLAK5uy_lJ8xZWiZj2GCw7MArjakb6b0zfvqwldps' },
  },
  {
    id: 'classic-country',
    label: 'Classic country',
    channel: 'YouTube Music',
    source: { kind: 'playlist', listId: 'RDCLAK5uy_kVfoKrYSsJaHx3SLO8mp3WYuRHMrS8U_Q' },
  },
  {
    id: 'rock',
    label: 'Rock hits',
    channel: 'YouTube Music',
    source: { kind: 'playlist', listId: 'RDCLAK5uy_l3PeyHeqJh1dR78WjfsMJwRHJx9ofMvvc' },
  },
  {
    id: 'classic-rock',
    label: 'Classic rock',
    channel: 'YouTube Music',
    source: { kind: 'playlist', listId: 'RDCLAK5uy_nZiG9ehz_MQoWQxY5yElsLHCcG0tv9PRg' },
  },
  {
    id: 'pop',
    label: 'Pop hits',
    channel: 'YouTube Music',
    source: { kind: 'playlist', listId: 'RDCLAK5uy_nSq67AJ2d75MFNJ3j_4ClEtSgC-opBM84' },
  },
  {
    id: 'rnb',
    label: 'R&B',
    channel: 'YouTube Music',
    source: { kind: 'playlist', listId: 'RDCLAK5uy_lOprH1vCx0efMJQDYichTFzifw_BkJgbg' },
  },
  {
    id: 'edm',
    label: 'EDM',
    channel: 'YouTube Music',
    source: { kind: 'playlist', listId: 'RDCLAK5uy_kHSavu4ofFfVIOzsA_wa4SuMS3dc76TYQ' },
  },
  {
    // A 24/7 live stream, not a playlist: the one quiet option, for focus.
    id: 'lofi',
    label: 'Lo-fi beats',
    channel: 'Chillhop Music',
    source: { kind: 'video', videoId: '7NOSDKb0HlU' },
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
