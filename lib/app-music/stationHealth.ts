import 'server-only'

import { z } from 'zod'
import { YOUTUBE_STATIONS, type YouTubeStation } from '@/lib/draft-music/youtube'

/**
 * Weekly health check for the Music tab's YouTube stations.
 *
 * WHY. Stations rot quietly: a channel stops posting, a playlist is deleted, a video
 * stops allowing play outside YouTube. Nothing in the app notices — a listener just
 * finds a tile that plays a two-year-old episode or YouTube's "unavailable" card. So
 * once a week this asks YouTube about every station and reports what changed.
 *
 * ⚠ NOT youtube.com/feeds/videos.xml. That endpoint answered 404 for EVERY channel on
 * 2026-11-15, including stations that play fine, and an F1 channel was wrongly
 * dropped as "wrong id" on that false negative. This uses the Data API instead, on
 * the same key as highlights: one unit per playlist plus one for all video statuses,
 * about 25 of the 10,000 daily units, once a week.
 *
 * ⚠ YOUTUBE MUSIC'S EDITORIAL LISTS (`RDCLAK5uy_…`) MAY NOT BE READABLE THROUGH THE
 * API. Their oEmbed already answers 404 while they play fine. So a not-found on one of
 * those is reported as UNCHECKED, never BROKEN — only playing it proves anything.
 *
 * What it can and cannot see. A playlist's NEWEST item is the max publish date among
 * its first 50 entries: right for channel upload lists (`UULF…`, newest first) and for
 * the curated podcast playlists in use today, which are also newest first. A curated
 * playlist that someday sorts oldest-first with more than 50 items would read as stale.
 */

export type StationStatus = 'ok' | 'stale' | 'broken' | 'unchecked'

export type StationCheck = {
  id: string
  label: string
  status: StationStatus
  /** Plain-English reason, safe to email. */
  detail: string
  /** Publish date of the newest item, when known. */
  newest?: string
  ageDays?: number
}

/*
 * Podcast stations go stale; music playlists do not (a hits list from 2024 is still
 * a hits list). Only stations listed here are judged on age. The windows allow for
 * each sport's off-season, so a quiet March for cricket is not an alarm.
 *
 * Keyed by station id rather than stored on the station, so adding a station never
 * touches this file's neighbours in youtube.ts. A test requires every `-podcast`
 * station to appear here; an id with no station yet (a station still in review) is
 * simply never looked up.
 */
export const STALE_AFTER_DAYS: Record<string, number> = {
  'ff-podcast': 45, // NFL podcasts post through the off-season
  'fb-podcast': 45,
  'mlb-podcast': 60,
  'nhl-podcast': 60,
  'epl-podcast': 60,
  'golf-podcast': 60,
  'nascar-podcast': 120, // off-season December–February
  'f1-podcast': 120, // off-season December–March
  'cricket-podcast': 240, // English season April–September
  'esports-podcast': 45,
  'rugby-podcast': 150, // international windows leave gaps of up to four months
  'lacrosse-podcast': 60,
}

const DAY_MS = 24 * 60 * 60 * 1000

export function isYouTubeMusicList(listId: string): boolean {
  return listId.startsWith('RDCLAK5uy')
}

/* ── YouTube responses (only the fields used) ──────────────────────────── */

const playlistItemsSchema = z.object({
  items: z
    .array(
      z.object({
        contentDetails: z
          .object({ videoId: z.string(), videoPublishedAt: z.string().optional() })
          .partial({ videoId: true }),
      }),
    )
    .default([]),
})

const videosSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string(),
        status: z
          .object({ embeddable: z.boolean().optional(), privacyStatus: z.string().optional() })
          .optional(),
      }),
    )
    .default([]),
})

export type YouTubeGet = (
  endpoint: 'playlistItems' | 'videos',
  params: Record<string, string>,
) => Promise<{ status: number; json: unknown }>

/** The real call. The key goes in a header — never in a URL, a result or a log. */
export function youtubeGet(apiKey: string): YouTubeGet {
  return async (endpoint, params) => {
    const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`)
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
    const res = await fetch(url, {
      headers: { 'X-Goog-Api-Key': apiKey },
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    })
    let json: unknown = null
    try {
      json = await res.json()
    } catch {
      /* non-JSON error page */
    }
    return { status: res.status, json }
  }
}

/* ── The check ─────────────────────────────────────────────────────────── */

type Pending = { station: YouTubeStation; check: StationCheck; videoId?: string }

function fmtDate(iso: string): string {
  return iso.slice(0, 10)
}

export async function checkStations(
  get: YouTubeGet,
  stations: YouTubeStation[] = YOUTUBE_STATIONS,
  now: Date = new Date(),
): Promise<StationCheck[]> {
  const pending: Pending[] = []

  for (const station of stations) {
    const base = { id: station.id, label: station.label }
    const { source } = station

    if (source.kind === 'video') {
      pending.push({ station, videoId: source.videoId, check: { ...base, status: 'ok', detail: 'Plays.' } })
      continue
    }

    let res: { status: number; json: unknown }
    try {
      res = await get('playlistItems', { part: 'contentDetails', playlistId: source.listId, maxResults: '50' })
    } catch {
      pending.push({ station, check: { ...base, status: 'unchecked', detail: 'YouTube did not answer.' } })
      continue
    }

    if (res.status === 404) {
      pending.push({
        station,
        check: isYouTubeMusicList(source.listId)
          ? { ...base, status: 'unchecked', detail: 'YouTube Music list; the API cannot read it. Check by playing it.' }
          : { ...base, status: 'broken', detail: 'The playlist no longer exists.' },
      })
      continue
    }
    if (res.status === 403 || res.status === 429) {
      pending.push({ station, check: { ...base, status: 'unchecked', detail: 'YouTube refused (quota).' } })
      continue
    }
    if (res.status !== 200) {
      pending.push({ station, check: { ...base, status: 'unchecked', detail: `YouTube answered ${res.status}.` } })
      continue
    }

    const parsed = playlistItemsSchema.safeParse(res.json)
    const items = parsed.success ? parsed.data.items : []
    const dated = items
      .map((i) => ({ id: i.contentDetails.videoId, at: i.contentDetails.videoPublishedAt }))
      .filter((i): i is { id: string; at: string } => Boolean(i.id && i.at))
    if (dated.length === 0) {
      pending.push({ station, check: { ...base, status: 'broken', detail: 'The playlist has nothing playable in it.' } })
      continue
    }

    const newest = dated.reduce((a, b) => (Date.parse(b.at) > Date.parse(a.at) ? b : a))
    const ageDays = Math.floor((now.getTime() - Date.parse(newest.at)) / DAY_MS)
    const limit = STALE_AFTER_DAYS[station.id]
    const check: StationCheck =
      limit !== undefined && ageDays > limit
        ? {
            ...base,
            status: 'stale',
            detail: `Nothing new in ${ageDays} days (newest ${fmtDate(newest.at)}; allowed ${limit}).`,
            newest: newest.at,
            ageDays,
          }
        : { ...base, status: 'ok', detail: `Newest ${fmtDate(newest.at)}.`, newest: newest.at, ageDays }
    pending.push({ station, videoId: newest.id, check })
  }

  // One call for every video that matters: each video station, and each playlist's newest item.
  const ids = [...new Set(pending.map((p) => p.videoId).filter((v): v is string => Boolean(v)))]
  if (ids.length > 0) {
    let statuses: Map<string, { embeddable?: boolean; privacyStatus?: string }> | null = null
    try {
      const res = await get('videos', { part: 'status', id: ids.slice(0, 50).join(',') })
      if (res.status === 200) {
        const parsed = videosSchema.safeParse(res.json)
        if (parsed.success) statuses = new Map(parsed.data.items.map((v) => [v.id, v.status ?? {}]))
      }
    } catch {
      /* leave statuses null: nothing is marked broken on a failed lookup */
    }
    if (statuses) {
      for (const p of pending) {
        if (!p.videoId || p.check.status === 'broken') continue
        const s = statuses.get(p.videoId)
        const isVideo = p.station.source.kind === 'video'
        if (!s) {
          p.check = {
            ...p.check,
            status: 'broken',
            detail: isVideo ? 'The video is gone (deleted or private).' : `${p.check.detail} Its newest video is gone.`,
          }
        } else if (s.embeddable === false) {
          p.check = {
            ...p.check,
            status: 'broken',
            detail: isVideo
              ? 'The video no longer plays outside YouTube.'
              : `${p.check.detail} Its newest video no longer plays outside YouTube.`,
          }
        }
      }
    }
  }

  return pending.map((p) => p.check)
}

/** Only what needs a person: broken and stale stations. Unchecked is reported, not alarmed. */
export function needsAttention(checks: StationCheck[]): StationCheck[] {
  return checks.filter((c) => c.status === 'broken' || c.status === 'stale')
}

export function summarize(checks: StationCheck[]): Record<StationStatus, number> {
  const out: Record<StationStatus, number> = { ok: 0, stale: 0, broken: 0, unchecked: 0 }
  for (const c of checks) out[c.status]++
  return out
}
