/**
 * Per-player cache in front of Grok player news for the mock draft.
 *
 * 🛑 /api/mock-draft/ai-pick CALLED GROK (with X search) ON EVERY PICK OF AN NFL MOCK DRAFT.
 *
 * Every action — including `predict-next`, which the simulator fires on each pick, and
 * `pick`, which every CPU team makes — fetched news for the top 15 available players, with
 * no cache, before even branching on the action: ~180 Grok calls for one 12-team,
 * 15-round mock. A player's news does not change between pick 14 and pick 15, so it is
 * cached per PLAYER for two hours and Grok is asked only about names it has not seen.
 * A failed fetch is not cached (the next pick retries); a player with no news IS cached as
 * such, so an unknown rookie is not re-asked about on every pick.
 *
 * In-process on purpose: this is per-draft burst traffic, and a restart costing one refetch
 * per player is cheap. Bounded by clearing past MAX entries (the pool is ~a few thousand).
 */
import { fetchPlayerNewsFromGrok } from '@/lib/ai-gm-intelligence'

export type GrokPlayerNews = Awaited<ReturnType<typeof fetchPlayerNewsFromGrok>>[number]

const GROK_NEWS_TTL_MS = 2 * 60 * 60 * 1000
const GROK_NEWS_CACHE_MAX = 5_000
const grokNewsCache = new Map<string, { at: number; item: GrokPlayerNews | null }>()

function grokNewsKey(name: string): string {
  return name.trim().toLowerCase()
}

export async function fetchPlayerNewsCached(
  names: string[],
  fetchNews: typeof fetchPlayerNewsFromGrok = fetchPlayerNewsFromGrok,
  now: number = Date.now(),
): Promise<GrokPlayerNews[]> {
  const fresh = (name: string) => {
    const hit = grokNewsCache.get(grokNewsKey(name))
    return hit && now - hit.at < GROK_NEWS_TTL_MS ? hit : null
  }
  const missing = names.filter((name) => !fresh(name))
  if (missing.length > 0) {
    const fetched = await fetchNews(missing, 'nfl').catch(() => null)
    if (fetched) {
      if (grokNewsCache.size > GROK_NEWS_CACHE_MAX) grokNewsCache.clear()
      const byName = new Map(fetched.map((item) => [grokNewsKey(item.playerName), item]))
      for (const name of missing) {
        grokNewsCache.set(grokNewsKey(name), { at: now, item: byName.get(grokNewsKey(name)) ?? null })
      }
    }
  }
  return names
    .map((name) => fresh(name)?.item ?? null)
    .filter((item): item is GrokPlayerNews => item != null)
}

/** Test seam: the cache is module state. */
export function __resetGrokNewsCacheForTests(): void {
  grokNewsCache.clear()
}
