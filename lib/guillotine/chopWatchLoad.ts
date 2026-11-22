import 'server-only'

/**
 * Server half of ./chopWatch.ts. Every member's league home asks for it, and building it scores every
 * surviving team, so one build serves the whole league for a minute — about as often as the stats
 * underneath it change (score-sync runs every five minutes, the live tick more often).
 *
 * Never throws: a watch that cannot be built leaves the chop line on its old source.
 */
import { loadChopPreview } from './chopPreviewLoad'
import { chopWatchDangerRows, chopWatchFromPreview, type ChopWatch } from './chopWatch'
import { getDangerTiers } from './GuillotineDangerEngine'
import type { GuillotineDangerRow } from './types'

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

/**
 * The danger tiers for `weekOrPeriod`, live when Chop Watch can build them, else the danger engine's.
 *
 * 🛑 USE THIS, NOT `getDangerTiers`, WHEREVER A WEEK IS BEING PLAYED. The engine ranks on
 * `GuillotinePeriodScore`, which is written only when a week is chopped, so during the week it ranked
 * on last week's season totals with one team always in the chop zone (./chopWatch.ts). `live` says
 * which source answered: only a live row's `projectedPoints` is this week's score.
 */
export async function getLiveDangerTiers(
  input: { leagueId: string; weekOrPeriod: number },
  deps: { loadWatch?: typeof loadChopWatch; loadTiers?: typeof getDangerTiers } = {},
): Promise<{ rows: GuillotineDangerRow[]; live: boolean }> {
  const watch = await (deps.loadWatch ?? loadChopWatch)(input.leagueId, input.weekOrPeriod).catch(() => null)
  if (watch) return { rows: chopWatchDangerRows(watch), live: true }
  return { rows: await (deps.loadTiers ?? getDangerTiers)(input), live: false }
}

/** Tests only. */
export function clearChopWatchCache(): void {
  cache.clear()
}
