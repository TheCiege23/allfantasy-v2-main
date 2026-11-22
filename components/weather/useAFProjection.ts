'use client'

import { useCallback, useState } from 'react'
import { readPlanRefusal } from '@/lib/monetization/planRefusal'
import {
  parseAfProjectionResponse,
  toAFProjectionDisplay,
  type AFProjectionDisplay,
} from '@/lib/weather/afProjectionAdapter'

const projectionCache = new Map<string, AFProjectionDisplay>()

export type UseAFProjectionParams = {
  playerId: string
  playerName: string
  sport: string
  position: string
  baselineProjection: number
  lat?: number | null
  lng?: number | null
  gameTime?: string | null
  isIndoor?: boolean
  isDome?: boolean
  roofClosed?: boolean
  week?: number
  season?: number
  eventId?: string
}

function buildCacheKey(p: UseAFProjectionParams): string {
  return [
    p.playerId,
    p.playerName,
    p.sport,
    p.position,
    p.week ?? 'w',
    p.season ?? 's',
    p.eventId ?? 'e',
    Number(p.baselineProjection).toFixed(4),
    p.lat ?? 'lat',
    p.lng ?? 'lng',
    p.gameTime ?? 'gt',
    p.isIndoor ? '1' : '0',
    p.isDome ? '1' : '0',
    p.roofClosed ? '1' : '0',
  ].join('|')
}

export function useAFProjection(params: UseAFProjectionParams) {
  const [state, setState] = useState<{
    loading: boolean
    data: AFProjectionDisplay | null
    fetched: boolean
  }>({ loading: false, data: null, fetched: false })

  const {
    playerId,
    playerName,
    sport,
    position,
    baselineProjection,
    lat,
    lng,
    gameTime,
    isIndoor,
    isDome,
    roofClosed,
    week,
    season,
    eventId,
  } = params

  const cacheKey = buildCacheKey(params)

  const fetchProjection = useCallback(async () => {
    const cached = projectionCache.get(cacheKey)
    if (cached) {
      setState({ loading: false, data: cached, fetched: true })
      return
    }

    setState((s) => ({ ...s, loading: true }))

    try {
      const res = await fetch('/api/weather/af-projection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          playerId,
          playerName,
          sport,
          position,
          baselineProjection: Number(baselineProjection),
          lat: lat ?? undefined,
          lng: lng ?? undefined,
          gameTime: gameTime ?? undefined,
          isIndoor,
          isDome,
          roofClosed,
          week,
          season,
          eventId,
        }),
      })

      const raw = await res.json()
      if (!res.ok) {
        const errMsg =
          readPlanRefusal(res.status, raw)?.message ??
          (raw && typeof raw === 'object' && typeof (raw as { error?: unknown }).error === 'string'
            ? (raw as { error: string }).error
            : 'AF projection unavailable')
        throw new Error(errMsg)
      }
      const parsed = parseAfProjectionResponse(raw)
      if (!parsed) {
        throw new Error('AF projection unavailable')
      }
      const display = toAFProjectionDisplay(parsed, false, null)

      projectionCache.set(cacheKey, display)
      setState({ loading: false, data: display, fetched: true })
    } catch (err) {
      const fallback = toAFProjectionDisplay(
        null,
        false,
        err instanceof Error ? err.message : 'unavailable'
      )
      setState({ loading: false, data: fallback, fetched: true })
    }
  }, [cacheKey, playerId, playerName, sport, position, baselineProjection, lat, lng, gameTime, isIndoor, isDome, roofClosed, week, season, eventId])

  return {
    loading: state.loading,
    data: state.data,
    fetched: state.fetched,
    fetch: fetchProjection,
  }
}
