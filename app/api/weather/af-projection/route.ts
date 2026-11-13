import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { requireFeatureEntitlement } from '@/lib/subscription/entitlement-middleware'
import { getAFProjection, getAFProjectionBatch } from '@/lib/weather/afProjectionService'

/**
 * ⚠ THIS ROUTE WAS OPEN TO ANYONE: no sign-in, no plan check, no batch limit — while the catalog sells
 * weather-adjusted projections on two plans (`pro_af_projections` on Pro, `commissioner_weather_projections`
 * on Commissioner; Supreme inherits both). It now needs a signed-in user holding EITHER, and a batch is
 * capped so one request cannot fan out over a whole player pool.
 */
const MAX_BATCH = 60

export const dynamic = 'force-dynamic'

type SingleBody = {
  playerId: string
  playerName: string
  sport: string
  position: string
  baselineProjection: number
  lat?: number
  lng?: number
  gameTime?: string
  isIndoor?: boolean
  isDome?: boolean
  roofClosed?: boolean
  week?: number
  season?: number
  eventId?: string
}

export async function POST(request: NextRequest) {
  const session = (await getServerSession(authOptions as never).catch(() => null)) as { user?: { id?: string; email?: string | null } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userEmail = session?.user?.email ?? null
  // Either plan that sells it opens it; the first refusal is the one returned.
  const pro = await requireFeatureEntitlement({ userId, userEmail, featureId: 'pro_af_projections' })
  if (!pro.ok) {
    const commish = await requireFeatureEntitlement({ userId, userEmail, featureId: 'commissioner_weather_projections' })
    if (!commish.ok) return pro.response
  }

  try {
    const body = (await request.json()) as SingleBody | { players: SingleBody[] }

    if (body && Array.isArray((body as { players?: unknown }).players)) {
      const players = (body as { players: SingleBody[] }).players
      if (players.length > MAX_BATCH) {
        return NextResponse.json({ error: `At most ${MAX_BATCH} players per request` }, { status: 400 })
      }
      const mapped = players.map((p) => ({
        playerId: p.playerId,
        playerName: p.playerName,
        sport: p.sport,
        position: p.position,
        baselineProjection: Number(p.baselineProjection),
        gameLocation:
          p.lat != null && p.lng != null ? { lat: Number(p.lat), lng: Number(p.lng) } : null,
        gameTime: p.gameTime ? new Date(p.gameTime) : null,
        isIndoor: p.isIndoor,
        isDome: p.isDome,
        roofClosed: p.roofClosed,
        week: p.week,
        season: p.season,
        eventId: p.eventId,
      }))
      const results = await getAFProjectionBatch(mapped)
      return NextResponse.json({ projections: results })
    }

    const p = body as SingleBody
    if (!p?.playerId || !p.playerName || p.baselineProjection == null) {
      return NextResponse.json({ error: 'Missing playerId, playerName, or baselineProjection' }, { status: 400 })
    }

    const result = await getAFProjection({
      playerId: p.playerId,
      playerName: p.playerName,
      sport: p.sport ?? 'NFL',
      position: p.position ?? 'UNK',
      baselineProjection: Number(p.baselineProjection),
      gameLocation: p.lat != null && p.lng != null ? { lat: Number(p.lat), lng: Number(p.lng) } : null,
      gameTime: p.gameTime ? new Date(p.gameTime) : null,
      isIndoor: p.isIndoor,
      isDome: p.isDome,
      roofClosed: p.roofClosed,
      week: p.week,
      season: p.season,
      eventId: p.eventId,
    })

    return NextResponse.json(result)
  } catch (e) {
    console.error('[api/weather/af-projection]', e)
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}
