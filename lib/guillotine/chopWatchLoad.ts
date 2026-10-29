import 'server-only'

/**
 * Server half of ./chopWatch.ts. Every member's league home asks for it, and building it scores every
 * surviving team, so one build serves the whole league for a minute — about as often as the stats
 * underneath it change (score-sync runs every five minutes, the live tick more often).
 *
 * Never throws: a watch that cannot be built leaves the chop line on its old source.
 */
import { loadChopPreview } from './chopPreviewLoad'
import { chopWatchFromPreview, type ChopWatch } from './chopWatch'

export const CHOP_WATCH_TTL_MS = 60 * 1000

const cache = new Map<string, { at: number; value: Promise<ChopWatch | null> }>()

export async function loadChopWatch(
  leagueId: string,
  week: number,
  deps: { loadPreview?: typeof loadChopPreview; now?: () => number } = {},
): Promise<ChopWatch | null> {
  const now = (deps.now ?? Date.now)()
  const key = `${leagueId}:${week}`
  const hit = cache.get(key)
  if (hit && now - hit.at < CHOP_WATCH_TTL_MS) return hit.value
  // The promise is cached, not the result, so members arriving together share one build.
  const value = (deps.loadPreview ?? loadChopPreview)(leagueId)
    .then((preview) => ('error' in preview ? null : chopWatchFromPreview(preview, week)))
    .catch(() => null)
  cache.set(key, { at: now, value })
  if (cache.size > 500) {
    for (const [k, v] of cache) if (now - v.at >= CHOP_WATCH_TTL_MS) cache.delete(k)
  }
  return value
}

/** Tests only. */
export function clearChopWatchCache(): void {
  cache.clear()
}
