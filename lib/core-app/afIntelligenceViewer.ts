/**
 * Does THIS viewer's plan include AF Intelligence (AF Pro, AF Commissioner, AF Supreme)? For the loaders deep under
 * a screen that sum AF's numbers — the rail, the scoreboard, matchup win odds — so a locked viewer's totals are the
 * plain ones (lib/core-app/afIntelligenceWithhold.ts covers each player's own number on the way out).
 *
 * One plan read per viewer per minute: a single /core render reaches this from several loaders at once, and the
 * answer cannot change mid-render. A failed read is LOCKED, like every /core depth after launch; no viewer is false.
 */
import 'server-only'

import { resolveCoreDepth } from '@/lib/core-app/corePaywall'

const MEMO_MS = 60_000
const memo = new Map<string, { at: number; value: Promise<boolean> }>()

export function viewerHasAfIntelligence(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return Promise.resolve(false)
  const now = Date.now()
  const hit = memo.get(userId)
  if (hit && now - hit.at < MEMO_MS) return hit.value
  const value = resolveCoreDepth(userId, 'af_intelligence').then((a) => a.unlocked === true).catch(() => false)
  memo.set(userId, { at: now, value })
  if (memo.size > 5_000) for (const [k, v] of memo) if (now - v.at >= MEMO_MS) memo.delete(k)
  return value
}

/** Test hook. */
export function resetAfIntelligenceViewerMemo(): void {
  memo.clear()
}
