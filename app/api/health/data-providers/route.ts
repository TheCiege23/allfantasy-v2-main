import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const FRESH_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * Real backing for the dashboard's "Live data connected" chip (previously hardcoded, no
 * check at all — see AF_DATA_PROVENANCE_AUDIT.md demo risk #3). Checks actual freshness
 * signals already written by the live sports-data chain (SportsDataCache, fed by Rolling
 * Insights/API-Sports/TheSportsDB/ClearSports via lib/workers/api-chain.ts) and the weather
 * cache (OpenWeatherMap, lib/weather/weatherService.ts) rather than claiming connectivity
 * for categories nothing here actually verifies.
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

    const sportsAgeMs = latestSportsCache ? now - latestSportsCache.createdAt.getTime() : null
    const weatherAgeMs = latestWeatherCache ? now - latestWeatherCache.fetchedAt.getTime() : null

    const sportsOk = sportsAgeMs != null && sportsAgeMs < FRESH_WINDOW_MS
    const weatherOk = weatherAgeMs != null && weatherAgeMs < FRESH_WINDOW_MS

    return NextResponse.json({
      ok: sportsOk && weatherOk,
      sports: { ok: sportsOk, lastSyncedAt: latestSportsCache?.createdAt.toISOString() ?? null },
      weather: { ok: weatherOk, lastSyncedAt: latestWeatherCache?.fetchedAt.toISOString() ?? null },
      checkedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[health/data-providers] failed:', error)
    return NextResponse.json(
      { ok: false, sports: { ok: false, lastSyncedAt: null }, weather: { ok: false, lastSyncedAt: null }, error: 'Health check failed' },
      { status: 500 }
    )
  }
}
