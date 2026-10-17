import 'server-only'

import { prisma } from '@/lib/prisma'
import {
  HIGHLIGHT_KICKOFF_WINDOW_MS,
  matchGameHighlights,
  type SlateGameForHighlight,
} from '@/lib/live/gameHighlightMatch'
import type { LiveGameDetail } from '@/lib/live/espnGameSummary'

/**
 * Highlight videos for finished games, read from `SportsGame` — never from the
 * vendor. `fetchTheSportsDbGames` (the import-scores cron) already stores every
 * TheSportsDB event whole in `raw`, `strVideo` included, so this is a DB-first
 * read of data we hold. See `gameHighlightMatch.ts` for the join.
 *
 * ⚠ A HIGHLIGHT IS DECORATION. Every failure here returns an empty map: a
 * missing video must never cost a live page its scores.
 */

type CacheEntry = { at: number; value: Map<string, string> }
/*
 * ⚠ CACHED BECAUSE THE SLATE POLLS. `getLivePageData` runs on every 20-second
 * poll from every open tab, and a finished game's video does not change on that
 * clock. Keyed on the exact set of games asked about, so a game finishing
 * produces a new key rather than a stale answer.
 */
const CACHE_TTL_MS = 5 * 60 * 1000
const CACHE_MAX = 200
const cache = new Map<string, CacheEntry>()

export async function loadGameHighlights(
  sport: string,
  games: readonly SlateGameForHighlight[],
): Promise<Map<string, string>> {
  const dated = games.filter((g) => g.startTime && Number.isFinite(new Date(g.startTime).getTime()))
  if (dated.length === 0) return new Map()

  const cacheKey = `${sport}|${dated.map((g) => g.key).sort().join(',')}`
  const hit = cache.get(cacheKey)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value

  const times = dated.map((g) => new Date(g.startTime!).getTime())
  try {
    const rows = await prisma.sportsGame.findMany({
      where: {
        sport,
        source: 'thesportsdb',
        // Only rows that carry a video: `raw` is the whole event record, and a
        // Saturday's college window is ~150 of them.
        raw: { path: ['strVideo'], string_starts_with: 'http' },
        startTime: {
          gte: new Date(Math.min(...times) - HIGHLIGHT_KICKOFF_WINDOW_MS),
          lte: new Date(Math.max(...times) + HIGHLIGHT_KICKOFF_WINDOW_MS),
        },
      },
      select: { homeTeam: true, awayTeam: true, startTime: true, raw: true },
    })
    const value = matchGameHighlights(
      dated,
      rows.map((r) => ({
        homeTeam: r.homeTeam,
        awayTeam: r.awayTeam,
        startTime: r.startTime,
        videoUrl: (r.raw as Record<string, unknown> | null)?.strVideo,
      })),
    )
    if (cache.size >= CACHE_MAX) cache.clear()
    cache.set(cacheKey, { at: Date.now(), value })
    return value
  } catch (err) {
    console.error('[live] highlight read failed:', err instanceof Error ? err.message : err)
    return new Map()
  }
}

/**
 * The highlight for the clicked-game view, finals only.
 *
 * The summary names its kickoff now (`startTime`); a summary cached before that
 * field existed falls back to the ESPN row we store for the same event id.
 */
export async function highlightForGameDetail(detail: LiveGameDetail | null): Promise<string | null> {
  if (!detail || detail.status.state !== 'post') return null
  const startTime = detail.startTime ?? (await espnKickoffFromDb(detail.sport, detail.gameId))
  if (!startTime) return null
  const found = await loadGameHighlights(detail.sport, [
    { key: detail.gameId, homeName: detail.home.name, awayName: detail.away.name, startTime },
  ])
  return found.get(detail.gameId) ?? null
}

/**
 * The kickoff of one ESPN game, read from the ESPN rows we already store.
 */
async function espnKickoffFromDb(sport: string, espnGameId: string): Promise<string | null> {
  try {
    const row = await prisma.sportsGame.findFirst({
      where: { sport, externalId: espnGameId, source: { in: ['espn', 'espn_live'] }, startTime: { not: null } },
      select: { startTime: true },
    })
    return row?.startTime?.toISOString() ?? null
  } catch {
    return null
  }
}
