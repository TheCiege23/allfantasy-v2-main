import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const FRESH_WINDOW_MS = 24 * 60 * 60 * 1000

type FeedHealth = { ok: boolean; lastSyncedAt: string | null }

function feedHealth(ts: Date | null | undefined, now: number): FeedHealth {
  const ageMs = ts ? now - ts.getTime() : null
  return { ok: ageMs != null && ageMs < FRESH_WINDOW_MS, lastSyncedAt: ts ? ts.toISOString() : null }
}

/**
 * Latest fetch timestamp for one normalized live-feed table, isolated in its own try/catch so
 * a single feed's query failure (or a Prisma model that isn't present in a given environment)
 * can never take down the whole health check or flip the top-level connection state.
 */
async function latestFetchedAt(query: () => Promise<{ fetchedAt: Date } | null>): Promise<Date | null> {
  try {
    const row = await query()
    return row?.fetchedAt ?? null
  } catch {
    return null
  }
}

/**
 * Real backing for the dashboard's "Live data connected" chip (previously hardcoded, no
 * check at all — see AF_DATA_PROVENANCE_AUDIT.md demo risk #3). Reads actual freshness
 * signals written by the live sports-data chain (lib/workers/api-chain.ts → normalized
 * SportsGame/SportsInjury/SportsNews/FantasyProjection tables + the SportsDataCache) and the
 * weather cache (OpenWeatherMap, lib/weather/weatherService.ts) rather than claiming
 * connectivity for categories nothing here actually verifies.
 *
 * Response shape:
 *   ok        — overall chain liveness (the single most-recent SportsDataCache write across
 *               ANY feed). This is what colors the chip. It stays gated on chain liveness, NOT
 *               on any one feed, precisely so it does not false-alarm in the NFL offseason when
 *               individual feeds (scores/injuries) legitimately idle — see the residual-#3 note.
 *   feeds     — per-feed { ok, lastSyncedAt } for Scores / Injuries / News / Projections /
 *               Weather, each traced to a real normalized table's fetchedAt (or honest null when
 *               that feed has no recent rows — never a fabricated "connected").
 *   sports    — kept for backward compatibility with existing consumers (= overall liveness).
 *   weather   — kept for backward compatibility (= feeds.weather).
 */
export async function GET() {
  try {
    const now = Date.now()
    const [latestSportsCache, latestWeatherCache] = await Promise.all([
      prisma.sportsDataCache.findFirst({
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
      prisma.weatherCache.findFirst({
        orderBy: { fetchedAt: 'desc' },
        select: { fetchedAt: true },
      }),
    ])

    // Per-feed freshness from the normalized live-chain tables. Each is isolated so a missing
    // table or a slow query degrades that one feed to an honest null, not a whole-check 500.
    const [scoresTs, injuriesTs, newsTs, projectionsTs] = await Promise.all([
      latestFetchedAt(() =>
        prisma.sportsGame.findFirst({ orderBy: { fetchedAt: 'desc' }, select: { fetchedAt: true } }),
      ),
      latestFetchedAt(() =>
        prisma.sportsInjury.findFirst({ orderBy: { fetchedAt: 'desc' }, select: { fetchedAt: true } }),
      ),
      latestFetchedAt(() =>
        prisma.sportsNews.findFirst({ orderBy: { fetchedAt: 'desc' }, select: { fetchedAt: true } }),
      ),
      latestFetchedAt(() =>
        prisma.fantasyProjection.findFirst({ orderBy: { fetchedAt: 'desc' }, select: { fetchedAt: true } }),
      ),
    ])

    const sportsAgeMs = latestSportsCache ? now - latestSportsCache.createdAt.getTime() : null
    const sportsOk = sportsAgeMs != null && sportsAgeMs < FRESH_WINDOW_MS

    const weatherFeed = feedHealth(latestWeatherCache?.fetchedAt, now)
    const feeds = {
      scores: feedHealth(scoresTs, now),
      injuries: feedHealth(injuriesTs, now),
      news: feedHealth(newsTs, now),
      projections: feedHealth(projectionsTs, now),
      weather: weatherFeed,
    }

    return NextResponse.json({
      // Offseason decision (AF_DATA_PROVENANCE_AUDIT.md demo risk #3 residual): top-level `ok`
      // is gated on overall chain liveness (latest SportsDataCache write) — NOT on scores or
      // weather freshness, both of which legitimately go stale between games. Per-feed detail
      // below surfaces the real per-category last-updated for observability without flipping the
      // chip. `degraded` still flags the sports-fresh / weather-stale case.
      ok: sportsOk,
      degraded: sportsOk && !weatherFeed.ok,
      sports: { ok: sportsOk, lastSyncedAt: latestSportsCache?.createdAt.toISOString() ?? null },
      weather: weatherFeed,
      feeds,
      checkedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[health/data-providers] failed:', error)
    return NextResponse.json(
      {
        ok: false,
        sports: { ok: false, lastSyncedAt: null },
        weather: { ok: false, lastSyncedAt: null },
        feeds: null,
        error: 'Health check failed',
      },
      { status: 500 },
    )
  }
}
