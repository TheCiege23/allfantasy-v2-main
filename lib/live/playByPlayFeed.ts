import { prisma } from '@/lib/prisma'
import { cacheBusted } from '@/lib/scores/gameScoreProviders'
import { normaliseStatus } from './rollingInsightsAdapter'
import { persistIdpForGame, gameWeekMeta } from '@/lib/idp/persistIdpLines'
import { parsePlayByPlay, playsToLiveEvents } from './rollingInsightsPlayByPlay'
import type { LiveEvent } from './eventDetector'

/**
 * The caller for the play-by-play parser: find the games actually being played,
 * ask for their plays, and keep a rolling feed of what happened.
 *
 * ⚠ NO MIGRATION, DELIBERATELY. There is no live-event table and adding one is
 * not a small change in this repo — migration history is a known hazard here.
 * `SportsDataCache` is an existing key / JSON / TTL store and a rolling game-day
 * feed is exactly a cache: it is worthless the next morning and nothing
 * reconciles against it. If plays ever need to be queried historically that is a
 * real table and a deliberate migration, not a widened cache.
 *
 * ⚠ `game_id` IS PER PROVIDER. The contract requires it and it must come from
 * Rolling Insights' own rows — SportsGame stores one row per (sport, externalId,
 * source), so ESPN and TheSportsDB carry different ids for the same fixture.
 * Passing a TheSportsDB id to RI returns nothing, quietly.
 */

const FEED_KEY = 'pbp:feed:NFL'
const CURSOR_KEY = 'pbp:cursor:NFL'
/** A game-day feed is stale by morning; nothing reconciles against it. */
const FEED_TTL_MS = 6 * 3_600_000
/** Enough for a Sunday's worth of scoring plays without unbounded growth. */
const FEED_MAX = 200

function riCredentials(): { token: string | null; base: string } {
  const token =
    process.env.ROLLING_INSIGHTS_RSC_TOKEN?.trim() ||
    process.env.ROLLING_INSIGHTS_RSC_TOKEN2?.trim() ||
    null
  const base =
    process.env.ROLLING_INSIGHTS_REST_BASE_URL?.trim() ||
    'https://rest.datafeeds.rolling-insights.com/api/v1'
  return { token, base }
}

/**
 * ⚠ SAME 304 DISCIPLINE AS THE SCORE PATH. PLAY-BY-PLAY.yaml records
 * `declared_304: false` for this endpoint, but ENDPOINTS.yaml's transport section
 * flags the 304 contradiction as unresolved — a response the spec does not
 * declare is exactly the one nobody handles. Cache-bust, send no-cache, retry
 * once; correct whichever reading turns out to be true.
 */
async function getJsonNoCache(url: string): Promise<unknown | null> {
  const attempt = async () => {
    const res = await fetch(cacheBusted(url), {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache, no-store, max-age=0', Pragma: 'no-cache' },
    })
    if (res.status === 304) return { status: 304, body: null as unknown }
    if (!res.ok) return { status: res.status, body: null as unknown }
    const text = await res.text()
    if (!text.trim()) return { status: res.status, body: null as unknown }
    return { status: res.status, body: JSON.parse(text) as unknown }
  }
  try {
    const first = await attempt()
    if (first.status !== 304) return first.body
    return (await attempt()).body
  } catch {
    return null
  }
}

/** Rolling Insights game ids for fixtures being played right now. */
export async function inProgressRiGameIds(now: Date = new Date()): Promise<string[]> {
  const from = new Date(now.getTime() - 4 * 3_600_000)
  const to = new Date(now.getTime() + 30 * 60_000)
  const rows = await prisma.sportsGame
    .findMany({
      where: {
        sport: 'NFL',
        // Only RI's own rows — see the note at the top about per-provider ids.
        source: 'rolling_insights',
        startTime: { gte: from, lte: to },
      },
      select: { externalId: true, status: true },
      take: 40,
    })
    .catch(() => [])

  return rows
    .filter((r) => normaliseStatus(r.status ?? undefined) === 'in_progress')
    .map((r) => r.externalId)
    .filter(Boolean)
}

type Cursor = Record<string, number>

async function readCache<T>(key: string): Promise<T | null> {
  const row = await prisma.sportsDataCache
    .findUnique({ where: { cacheKey: key } })
    .catch(() => null)
  if (!row || row.expiresAt.getTime() < Date.now()) return null
  return row.data as T
}

async function writeCache(key: string, data: unknown): Promise<void> {
  const expiresAt = new Date(Date.now() + FEED_TTL_MS)
  await prisma.sportsDataCache
    .upsert({
      where: { cacheKey: key },
      update: { data: data as never, expiresAt },
      create: { cacheKey: key, data: data as never, expiresAt },
    })
    .catch(() => undefined)
}

export type FeedRefreshResult = {
  gamesPolled: number
  newEvents: number
  /** Defensive stat rows written this pass — 0 on a quiet poll is correct. */
  idpRowsWritten: number
  skipped: 'no-token' | 'no-live-games' | null
}

/**
 * Poll play-by-play for every in-progress game and append what is new.
 *
 * ⚠ THE CURSOR IS PER GAME AND IS A HIGH-WATER MARK. PLAY-BY-PLAY.yaml warns
 * `sequence` is monotonic but SPARSE — never 1..N — so it can only be compared,
 * never counted. Re-reading the full plays array each poll and filtering by the
 * cursor is what the contract recommends, and it is also what makes a corrected
 * or reversed play safe: the array is authoritative, our cursor is just a
 * bookmark.
 */
export async function refreshPlayByPlayFeed(now: Date = new Date()): Promise<FeedRefreshResult> {
  const { token, base } = riCredentials()
  if (!token) return { gamesPolled: 0, newEvents: 0, idpRowsWritten: 0, skipped: 'no-token' }

  const gameIds = await inProgressRiGameIds(now)
  if (gameIds.length === 0) return { gamesPolled: 0, newEvents: 0, idpRowsWritten: 0, skipped: 'no-live-games' }

  const cursor = (await readCache<Cursor>(CURSOR_KEY)) ?? {}
  const feed = (await readCache<LiveEvent[]>(FEED_KEY)) ?? []
  const fresh: LiveEvent[] = []
  let idpWritten = 0

  for (const gameId of gameIds) {
    const url = `${base}/play-by-play/NFL?RSC_token=${encodeURIComponent(token)}&game_id=${encodeURIComponent(gameId)}`
    const payload = await getJsonNoCache(url)
    if (!payload) continue

    for (const game of parsePlayByPlay(payload)) {
      const since = cursor[game.gameId] ?? -1
      const events = playsToLiveEvents(game, { sinceSequence: since, now })
      if (events.length > 0) fresh.push(...events)

      // Advance to the highest sequence SEEN, not the highest that produced an
      // event — most plays are not scoring plays, and re-reading them every poll
      // would re-emit the next big play forever.
      const high = game.plays.reduce((m, p) => (p.sequence > m ? p.sequence : m), since)

      /*
       * Defensive stat lines are re-derived and written only when this game
       * actually produced new plays.
       *
       * ⚠ THE CURSOR IS THE THROTTLE. Without this check every poll would
       * re-upsert every defender in every live game — roughly 260 rows a pass
       * on a full Sunday, for stat lines that had not changed. Gating on the
       * cursor means a game in a television timeout costs nothing.
       *
       * Derivation is cumulative: each poll re-reads the whole plays array, so
       * the line written is always the complete one, not a delta to merge.
       */
      if (high > since) {
        const meta = await gameWeekMeta(game.gameId)
        const persisted = await persistIdpForGame(game, meta).catch(() => null)
        idpWritten += persisted?.playersWritten ?? 0
      }

      cursor[game.gameId] = high
    }
  }

  if (fresh.length > 0) {
    /*
     * Dedupe on idempotencyKey across the whole feed, not just this batch. A
     * retried invocation or an overlapping poll must not show the same
     * touchdown twice — the key is game + sequence + type precisely so this
     * check is cheap and total.
     */
    const seen = new Set(feed.map((e) => e.idempotencyKey))
    const merged = [...fresh.filter((e) => !seen.has(e.idempotencyKey)), ...feed]
    await writeCache(FEED_KEY, merged.slice(0, FEED_MAX))
  }
  await writeCache(CURSOR_KEY, cursor)

  return { gamesPolled: gameIds.length, newEvents: fresh.length, idpRowsWritten: idpWritten, skipped: null }
}

/**
 * The feed for rendering — newest first.
 *
 * Returns [] rather than throwing when nothing has been polled: an empty feed on
 * a Tuesday is the correct answer, not an error state.
 */
export async function readPlayByPlayFeed(limit = 20): Promise<LiveEvent[]> {
  const feed = (await readCache<LiveEvent[]>(FEED_KEY)) ?? []
  return feed.slice(0, Math.max(1, Math.min(limit, FEED_MAX)))
}
