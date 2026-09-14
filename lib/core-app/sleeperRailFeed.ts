import 'server-only'
import { getLeagueInfo, getLeagueMatchups, getNflState } from '@/lib/sleeper-client'

// Shared across users on this Railway process. Bound memory, deduplicate in-flight
// requests, and pace starts below Sleeper's published per-minute guidance.
const cache = new Map<string, { value: unknown; expires: number }>()
const pending = new Map<string, Promise<unknown>>()
let nextStart = 0

export async function sleeperRailFeed(path: string, ttlMs: number): Promise<unknown> {
  if (!/^(state\/nfl|league\/[0-9]{10,22}(\/matchups\/[0-9]{1,2})?)$/.test(path)) throw new Error('Invalid Sleeper resource')
  const hit = cache.get(path)
  if (hit && hit.expires > Date.now()) return hit.value
  const underway = pending.get(path)
  if (underway) return underway
  const request = (async () => {
    const delay = Math.max(0, nextStart - Date.now())
    if (delay > 2000) throw new Error('Sleeper refresh busy')
    nextStart = Date.now() + delay + 125
    if (delay) await new Promise(resolve => setTimeout(resolve, delay))
    // Keep transport and its hard deadline in the existing provider client.
    const parts = path.split('/')
    const value: unknown = path === 'state/nfl'
      ? await getNflState()
      : parts.length === 2
        ? await getLeagueInfo(parts[1])
        : await getLeagueMatchups(parts[1], Number(parts[3]))
    if (value == null || (Array.isArray(value) && value.length === 0)) throw new Error('Sleeper unavailable')
    if (cache.size >= 1000) cache.delete(cache.keys().next().value!)
    cache.set(path, { value, expires: Date.now() + ttlMs })
    return value
  })()
  pending.set(path, request)
  try { return await request } finally { pending.delete(path) }
}

export function currentSleeperWeek(value: unknown): { season: number; week: number } | null {
  if (!value || typeof value !== 'object') return null
  const state = value as Record<string, unknown>
  const season = Number(state.season)
  const week = state.week
  if (state.season_type !== 'regular' || !Number.isInteger(season) || season < 2000 ||
    typeof week !== 'number' || !Number.isInteger(week) || week < 1 || week > 18) return null
  return { season, week }
}
