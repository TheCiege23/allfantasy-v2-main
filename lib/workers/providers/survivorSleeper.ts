import 'server-only'
/** Sleeper transport stays in the worker provider boundary; manager views read stored data. */
export async function fetchSGNflCatalog(): Promise<unknown> {
  const response = await fetch('https://api.sleeper.app/v1/players/nfl', { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw Error('NFL player catalog HTTP ' + response.status)
  return response.json()
}
export async function fetchSGNflState(): Promise<{ season?: unknown; week?: unknown; season_type?: unknown }> {
  const response = await fetch('https://api.sleeper.app/v1/state/nfl', { signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw Error('NFL season state is unavailable')
  return response.json()
}

export async function fetchNflWeekPlayerMap(season: number, week: number, seasonType: string): Promise<Map<string, unknown> | null> {
  const url = `https://api.sleeper.com/stats/nfl/${encodeURIComponent(season)}/${encodeURIComponent(week)}?season_type=${encodeURIComponent(seasonType)}`
  try {
    const { rateLimitManager } = await import('@/lib/workers/rate-limit-manager')
    const endpoint = 'stats/nfl/week'
    if (!await rateLimitManager.canCall('sleeper', endpoint).catch(() => true)) return null
    const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(20_000) })
    await rateLimitManager.recordCall('sleeper', endpoint, res.ok ? 1 : 0, 0, { cached: false }).catch(() => undefined)
    if (!res.ok) return null
    return asPlayerStatMap(await res.json())
  } catch { return null }
}

/** Sleeper week-wide payload may be an object keyed by id, or an array of rows. */
function asPlayerStatMap(payload: unknown): Map<string, unknown> | null {
  if (!payload || typeof payload !== 'object') return null
  const map = new Map<string, unknown>()
  if (Array.isArray(payload)) {
    for (const row of payload) {
      const id = row && typeof row === 'object' ? String((row as { player_id?: unknown }).player_id ?? '') : ''
      const stats = row && typeof row === 'object' ? (row as { stats?: unknown }).stats ?? row : row
      if (id) map.set(id, stats)
    }
    return map
  }
  for (const [id, row] of Object.entries(payload as Record<string, unknown>)) {
    const stats = row && typeof row === 'object' ? (row as { stats?: unknown }).stats ?? row : row
    map.set(id, stats)
  }
  return map
}
