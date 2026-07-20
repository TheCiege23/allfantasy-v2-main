import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { NFL_VENUE_COORDS } from '@/lib/openweathermap'
import { getWeatherForEvent, MLB_VENUE_COORDS } from '@/lib/weather/weatherService'
import { requireCronAuth } from '@/app/api/cron/_auth'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

function resolveVenueCoords(venue: string | null): { lat: number; lng: number } | null {
  if (!venue?.trim()) return null
  const v = venue.trim()
  for (const name of Object.keys(NFL_VENUE_COORDS)) {
    if (v.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(v.toLowerCase())) {
      const c = NFL_VENUE_COORDS[name]!
      return { lat: c.lat, lng: c.lon }
    }
  }
  for (const name of Object.keys(MLB_VENUE_COORDS)) {
    if (v.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(v.toLowerCase())) {
      const c = MLB_VENUE_COORDS[name]!
      return { lat: c.lat, lng: c.lng }
    }
  }
  return null
}

// This branch added its own cron GET here; #284 landed an identical one further down
// (kept), so both would have exported `GET` from the same module. Git auto-merged this
// without a conflict because the two sit in different places — the duplicate export only
// shows up at build time. Dropped this copy; main's is the shipped version and avoids the
// build bug by not writing the literal `0 */3 * * *`, whose `*/` closes a block comment.

export async function POST(request: NextRequest) {
  if (!requireCronAuth(request, 'CRON_SECRET')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  const horizon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

  let refreshed = 0
  try {
    const games = await prisma.sportsGame.findMany({
      where: {
        startTime: { gte: now, lte: horizon },
        sport: { in: ['NFL', 'NCAAF', 'MLB', 'SOCCER'] },
      },
      take: 120,
      orderBy: { startTime: 'asc' },
    })

    for (const g of games) {
      const coords = resolveVenueCoords(g.venue)
      if (!coords || !g.startTime) continue

      const hoursUntil = (g.startTime.getTime() - now.getTime()) / (1000 * 60 * 60)
      let force = false
      if (hoursUntil < 48) {
        force = true
      } else {
        const cacheKey = `${coords.lat.toFixed(2)}_${coords.lng.toFixed(2)}_${g.startTime.toISOString().slice(0, 13)}`
        const row = await prisma.weatherCache.findUnique({ where: { cacheKey } })
        const stale =
          !row || row.expiresAt <= now || now.getTime() - row.fetchedAt.getTime() > 3 * 60 * 60 * 1000
        if (stale) force = true
      }

      if (!force) continue

      await getWeatherForEvent({
        lat: coords.lat,
        lng: coords.lng,
        gameTime: g.startTime,
        sport: g.sport,
        eventId: g.externalId,
        forceRefresh: true,
      })
      refreshed += 1
    }
  } catch (e) {
    console.error('[weather/refresh-cron]', e)
    return NextResponse.json({ ok: false, error: String(e), refreshed }, { status: 500 })
  }

  console.info(`[weather/refresh-cron] refreshed ${refreshed} cache entries`)
  return NextResponse.json({ ok: true, refreshed })
}

/**
 * Vercel Cron issues a GET, but this route only exported POST — so every scheduled run since
 * it was added returned 405 and refreshed nothing. Measured in production 2026-07-19.
 * Delegates to POST, which already gates on `requireCronAuth`; no auth behaviour changes.
 */
export async function GET(request: NextRequest) {
  return POST(request)
}
