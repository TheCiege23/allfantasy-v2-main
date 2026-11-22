import 'server-only'

import { createHash } from 'crypto'
import { z } from 'zod'
import { cachedFetch } from '@/lib/api-cache'

/**
 * YouTube search for the chat panel's Music tab, with limits.
 *
 * ⚠ A SEARCH IS THE MOST EXPENSIVE YOUTUBE CALL THERE IS. `search.list` costs 100
 * quota units, and the project's whole day is 10,000 — which player highlights
 * (lib/highlights/youtube.ts) share on the same `YOUTUBE_API_KEY`. Unlimited
 * search would let ~100 searches a day switch highlights off for everyone.
 *
 * So, three layers, cheapest first:
 *   1. Every answer is cached in Postgres for a day per normalized query, so
 *      "game day hype" costs one call no matter how many people type it.
 *   2. Each person gets PER_USER_DAILY fresh searches a day (cache hits are free).
 *   3. Music as a whole gets APP_DAILY fresh searches a day — 6,000 units at most,
 *      leaving the rest of the day for highlights.
 * Budgets are only spent on a cache MISS, which is why they are taken inside the
 * fetcher. Stations and pasted links never come through here at all.
 *
 * ⚠ IF THE BUDGET CANNOT BE READ, NO SEARCH HAPPENS. The AI caps fail open; this
 * one fails closed, because the cost of guessing wrong lands on highlights, not on
 * the person searching.
 */

export const PER_USER_DAILY = 20
export const APP_DAILY = 60
/** ApiRateLimitRecord.provider is VarChar(32). Read by the admin usage readout too. */
export const MUSIC_SEARCH_PROVIDER = 'music-yt-search'
const PROVIDER = MUSIC_SEARCH_PROVIDER

/*
 * Counter rows under MUSIC_SEARCH_PROVIDER, one per UTC day:
 *   'app'          fresh YouTube searches (the quota spend) — also the app budget
 *   'user:<hash>'  one person's fresh searches — also their budget
 *   'searches'     EVERY search, cache hits included
 *   'refused-user' / 'refused-app'  searches turned away by a limit
 * The last three are tallies only: they never limit anything, and a failed tally
 * never fails a search. They exist so /admin/music-search can say how much the cache
 * saves and whether anyone is hitting the walls.
 */
export const TALLY_SEARCHES = 'searches'
export const TALLY_REFUSED_USER = 'refused-user'
export const TALLY_REFUSED_APP = 'refused-app'
const CACHE_TTL_SECONDS = 24 * 60 * 60
const MAX_RESULTS = 12
const MAX_QUERY = 80

export type MusicSearchHit = { videoId: string; title: string; channel: string; thumb: string | null }

export type MusicSearchOutcome =
  | { status: 'ok'; results: MusicSearchHit[] }
  | { status: 'limit'; scope: 'user' | 'app' }
  | { status: 'unavailable' }

/** Lower-case, single-spaced, trimmed — so "Game  Day" and "game day" share one cache row. */
export function normalizeMusicQuery(raw: string): string | null {
  const q = raw.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, MAX_QUERY).trim()
  return q.length >= 2 ? q : null
}

/** YouTube returns titles HTML-escaped ("Rock &amp; Roll"); show them as text. */
export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

const searchSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.object({ videoId: z.string().regex(/^[\w-]{11}$/).optional() }),
        snippet: z
          .object({
            title: z.string().optional(),
            channelTitle: z.string().optional(),
            liveBroadcastContent: z.string().optional(),
            thumbnails: z
              .object({
                medium: z.object({ url: z.string() }).optional(),
                default: z.object({ url: z.string() }).optional(),
              })
              .optional(),
          })
          .optional(),
      }),
    )
    .default([]),
})

export function parseSearchResponse(json: unknown): MusicSearchHit[] {
  const parsed = searchSchema.safeParse(json)
  if (!parsed.success) return []
  const hits: MusicSearchHit[] = []
  for (const item of parsed.data.items) {
    const videoId = item.id.videoId
    if (!videoId) continue
    // A live stream that has ended or not started plays as an error in the embed.
    if (item.snippet?.liveBroadcastContent === 'upcoming') continue
    const thumb = item.snippet?.thumbnails?.medium?.url ?? item.snippet?.thumbnails?.default?.url ?? null
    hits.push({
      videoId,
      title: decodeEntities(item.snippet?.title ?? 'YouTube video'),
      channel: decodeEntities(item.snippet?.channelTitle ?? ''),
      thumb: thumb && thumb.startsWith('https://i.ytimg.com/') ? thumb : null,
    })
  }
  return hits
}

/* ── Daily budgets ─────────────────────────────────────────────────────── */

function dayWindow(now = new Date()) {
  const windowStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  return { windowStart, windowEnd: new Date(windowStart.getTime() + 24 * 60 * 60 * 1000) }
}

/** Never the raw user id in a shared counter table. */
export function userBudgetKey(userId: string): string {
  return `user:${createHash('sha256').update(userId).digest('hex').slice(0, 32)}`
}

async function getPrisma() {
  const { prisma } = await import('@/lib/prisma')
  return prisma
}

/**
 * Take one unit from a budget. Increment FIRST and compare after, so two searches
 * at the same instant cannot both read "19 of 20" and both go through.
 */
async function take(endpoint: string, limit: number): Promise<boolean> {
  const prisma = await getPrisma()
  const { windowStart, windowEnd } = dayWindow()
  const row = await prisma.apiRateLimitRecord.upsert({
    where: { uniq_api_rate_limits_window: { provider: PROVIDER, endpoint, windowStart, windowEnd } },
    update: { callsMade: { increment: 1 }, callsLimit: limit },
    create: { provider: PROVIDER, endpoint, callsMade: 1, callsLimit: limit, windowStart, windowEnd },
    select: { callsMade: true },
  })
  return row.callsMade <= limit
}

/** Hand a unit back (a refused or failed search should not use up someone's day). */
async function giveBack(endpoint: string): Promise<void> {
  try {
    const prisma = await getPrisma()
    const { windowStart, windowEnd } = dayWindow()
    await prisma.apiRateLimitRecord.updateMany({
      where: { provider: PROVIDER, endpoint, windowStart, windowEnd, callsMade: { gt: 0 } },
      data: { callsMade: { decrement: 1 } },
    })
  } catch {
    /* worst case they lose one search today */
  }
}

/** Count something for the usage readout. Best-effort: never throws, never limits. */
async function tally(endpoint: string): Promise<void> {
  try {
    const prisma = await getPrisma()
    const { windowStart, windowEnd } = dayWindow()
    await prisma.apiRateLimitRecord.upsert({
      where: { uniq_api_rate_limits_window: { provider: PROVIDER, endpoint, windowStart, windowEnd } },
      update: { callsMade: { increment: 1 } },
      create: { provider: PROVIDER, endpoint, callsMade: 1, callsLimit: 0, windowStart, windowEnd },
      select: { callsMade: true },
    })
  } catch {
    /* the readout undercounts by one; the search is unaffected */
  }
}

/* ── The search ────────────────────────────────────────────────────────── */

class Refused extends Error {
  constructor(readonly outcome: Exclude<MusicSearchOutcome, { status: 'ok' }>) {
    super(outcome.status)
  }
}

async function callYouTube(q: string): Promise<MusicSearchHit[]> {
  const url = new URL('https://www.googleapis.com/youtube/v3/search')
  url.searchParams.set('part', 'snippet')
  url.searchParams.set('type', 'video')
  url.searchParams.set('videoEmbeddable', 'true') // only what can play inside the chat
  url.searchParams.set('maxResults', String(MAX_RESULTS))
  url.searchParams.set('q', q)
  // The credential goes in a header, never in the URL, a response or a log.
  const res = await fetch(url, {
    headers: { 'X-Goog-Api-Key': process.env.YOUTUBE_API_KEY!.trim() },
    signal: AbortSignal.timeout(5_000),
    cache: 'no-store',
  })
  // 403 is how YouTube says the day's quota is gone: treat it as the app budget.
  if (res.status === 403 || res.status === 429) throw new Refused({ status: 'limit', scope: 'app' })
  if (!res.ok) throw new Refused({ status: 'unavailable' })
  return parseSearchResponse(await res.json())
}

export async function searchYouTubeMusic(rawQuery: string, userId: string): Promise<MusicSearchOutcome> {
  const q = normalizeMusicQuery(rawQuery)
  if (!q) return { status: 'ok', results: [] }
  if (!process.env.YOUTUBE_API_KEY?.trim()) return { status: 'unavailable' }

  const userKey = userBudgetKey(userId)
  await tally(TALLY_SEARCHES)
  const outcome = await runSearch(q, userKey)
  if (outcome.status === 'limit') {
    await tally(outcome.scope === 'user' ? TALLY_REFUSED_USER : TALLY_REFUSED_APP)
  }
  return outcome
}

async function runSearch(q: string, userKey: string): Promise<MusicSearchOutcome> {
  try {
    const results = await cachedFetch(
      `youtube:music-search:v1:${q}`,
      CACHE_TTL_SECONDS,
      async () => {
        // Cache miss: this is the only path that spends quota.
        let userTaken = false
        try {
          if (!(await take(userKey, PER_USER_DAILY))) {
            await giveBack(userKey)
            throw new Refused({ status: 'limit', scope: 'user' })
          }
          userTaken = true
          if (!(await take('app', APP_DAILY))) {
            await giveBack('app')
            throw new Refused({ status: 'limit', scope: 'app' })
          }
        } catch (err) {
          if (userTaken) await giveBack(userKey)
          if (err instanceof Refused) throw err
          throw new Refused({ status: 'unavailable' }) // budget unreadable: fail closed
        }
        try {
          return await callYouTube(q)
        } catch (err) {
          await giveBack(userKey) // the person keeps their search; the app budget does not
          if (err instanceof Refused) throw err
          throw new Refused({ status: 'unavailable' })
        }
      },
      // An empty answer is not remembered for a day — it may be a hiccup.
      (hits) => hits.length > 0,
    )
    return { status: 'ok', results }
  } catch (err) {
    if (err instanceof Refused) return err.outcome
    return { status: 'unavailable' }
  }
}
