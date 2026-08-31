/**
 * Which of a user's leagues can actually be re-synced — ONE definition, shared.
 *
 * ⚠ IT LIVES HERE BECAUSE TWO CALLERS MUST AGREE OR THE BUTTON LIES. The /core
 * shell greys "Sync now" out when this returns nothing, and `POST /api/core/sync`
 * decides what to sync from the same list. If those drifted apart the failure is
 * silent and exactly backwards from useful: an enabled button that syncs nothing,
 * or a greyed-out button over leagues the endpoint would happily have refreshed.
 * A count and a work-list computed by different code are not the same answer.
 *
 * The three tests are ImportedLeaguesPanel's `canResync`, plus the provider
 * availability check `POST /api/leagues/import/resync` itself applies:
 *
 *   1. It has a `platformLeagueId` — there is an external league to re-read.
 *   2. It has a native backing (`navigationLeagueId` or `hasUnifiedRecord`).
 *      ⚠ A career-board snapshot passes test 1 and fails this one, deliberately:
 *      re-syncing it would materialize a native league out of what the user sees
 *      as read-only history.
 *   3. Its provider is registered AND available today. Yahoo is registered but
 *      cannot complete an import, so offering it would fail every press.
 */

import { getDashboardLeagueListForUser } from '@/lib/dashboard/get-dashboard-league-list'
import { resolveProvider } from '@/lib/league-import/ImportProviderResolver'
import { isImportProviderAvailable } from '@/lib/league-import/provider-ui-config'
import type { ImportProvider } from '@/lib/league-import/types'

/** The subset of a dashboard league row these tests read. */
export type ResyncLeagueRow = {
  id?: string
  name?: string | null
  platform?: string | null
  platformLeagueId?: string | null
  navigationLeagueId?: string | null
  hasUnifiedRecord?: boolean | null
}

export type ResyncCandidate = {
  /** `provider:sourceId` — the identity a sync round hands back in `remaining`. */
  key: string
  row: ResyncLeagueRow
  provider: ImportProvider
  sourceId: string
}

/**
 * Pure, so the page can run it over the league list it has ALREADY fetched
 * rather than paying for a second read just to decide whether a button is
 * clickable. `getDashboardLeagueListForUser` types `leagues` as `unknown[]`.
 */
export function selectResyncCandidates(leagues: readonly unknown[]): ResyncCandidate[] {
  /*
   * Deduplicated by provider+sourceId: one external league can appear on the
   * dashboard list under more than one row, and re-syncing it twice is a wasted
   * provider fetch — and would double-count the "of N" the button reports.
   */
  const seen = new Set<string>()
  const out: ResyncCandidate[] = []

  for (const raw of leagues as ResyncLeagueRow[]) {
    const sourceId = typeof raw?.platformLeagueId === 'string' ? raw.platformLeagueId.trim() : ''
    if (!sourceId) continue
    if (!raw.navigationLeagueId && raw.hasUnifiedRecord !== true) continue
    const provider = resolveProvider(String(raw.platform ?? ''))
    if (!provider || !isImportProviderAvailable(provider)) continue
    const key = `${provider}:${sourceId}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ key, row: raw, provider, sourceId })
  }

  return out
}

/**
 * Every resyncable league on the account.
 *
 * ⚠ `null` MEANS "COULD NOT READ", NOT "NONE". They are different answers and
 * the caller must not collapse them — reporting a read failure as an empty set
 * greys out the button, which tells the user they have nothing to sync when in
 * fact we simply failed to look.
 */
export async function collectResyncCandidates(userId: string): Promise<ResyncCandidate[] | null> {
  const payload = await getDashboardLeagueListForUser(userId).catch(() => null)
  if (!payload || !Array.isArray(payload.leagues)) return null
  return selectResyncCandidates(payload.leagues)
}
