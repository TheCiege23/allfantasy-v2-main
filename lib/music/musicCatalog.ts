import { prisma } from '@/lib/prisma'
import { fetchAudioDbArtists, fetchAudioDbTopTracks, type AudioDbArtist, type AudioDbTrack } from './theAudioDbFetch'

/**
 * TheAudioDB, read through the durable cache (security cleanup, 2026-11-15). The /api/music routes read
 * here; the vendor call lives alone in `./theAudioDbFetch.ts`.
 *
 * An artist search or a top-ten list changes slowly, so an answer is kept for 30 days in
 * `sportsDataCache` — every widget open after the first costs one indexed read instead of a vendor call
 * with the key in its URL. An EMPTY answer is kept for a day only: it is a real answer, but a short one,
 * in case the artist is added. A FAILURE is never kept — writing "no answer" would turn one outage into
 * a month of nothing (the weather geocode's rule).
 */

const DAY_MS = 86_400_000
const FOUND_TTL_MS = 30 * DAY_MS
const EMPTY_TTL_MS = DAY_MS
const PREFIX = 'music:audiodb:v1:'

type Db = Pick<typeof prisma, 'sportsDataCache'>

export function musicCacheKey(kind: 'artists' | 'top10', name: string): string {
  return `${PREFIX}${kind}:${name.trim().toLowerCase().replace(/\s+/g, ' ')}`
}

async function readThrough<T>(db: Db, key: string, fetcher: () => Promise<T[] | null>, now: Date): Promise<T[] | null> {
  const cached = await db.sportsDataCache.findUnique({ where: { cacheKey: key } }).catch(() => null)
  if (cached && cached.expiresAt > now && Array.isArray(cached.data)) return cached.data as T[]
  const fresh = await fetcher()
  if (fresh === null) return Array.isArray(cached?.data) ? (cached!.data as T[]) : null // stale beats nothing
  const expiresAt = new Date(now.getTime() + (fresh.length ? FOUND_TTL_MS : EMPTY_TTL_MS))
  await db.sportsDataCache
    .upsert({ where: { cacheKey: key }, update: { data: fresh as never, expiresAt }, create: { cacheKey: key, data: fresh as never, expiresAt } })
    .catch(() => undefined)
  return fresh
}

export function searchArtistsCached(name: string, opts: { db?: Db; now?: Date } = {}): Promise<AudioDbArtist[] | null> {
  const n = name.trim()
  if (!n) return Promise.resolve([])
  return readThrough(opts.db ?? prisma, musicCacheKey('artists', n), () => fetchAudioDbArtists(n), opts.now ?? new Date())
}

export function topTracksCached(artist: string, opts: { db?: Db; now?: Date } = {}): Promise<AudioDbTrack[] | null> {
  const n = artist.trim()
  if (!n) return Promise.resolve([])
  return readThrough(opts.db ?? prisma, musicCacheKey('top10', n), () => fetchAudioDbTopTracks(n), opts.now ?? new Date())
}
