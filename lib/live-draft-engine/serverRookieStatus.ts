/**
 * The server's own answer to "is this player a rookie?" for rookies-only / veterans-only drafts.
 *
 * 🛑 A ROOKIES-ONLY DRAFT ACCEPTED VETERANS. `validateSpecialtyDraftPools` refused a pick only when
 * the CLIENT's pick metadata said `isRookie: false`, and the draft room never sends `false` — it sends
 * `isRookie: true` when a player's eligibility note mentions "rookie" and nothing otherwise. So any
 * veteran pick reached the board-hidden path unchecked: a stale board, a direct API call, or a
 * client bug was enough. The rule was enforced only by what the board chose to show.
 *
 * This reads the warm draft-pool snapshot — the board itself. ⚠ That snapshot is built AFTER
 * `applyDraftModePoolFilters`, so in a rookies-only draft it usually holds rookies ONLY and a veteran
 * is simply absent from it. Looking a veteran up and finding nothing must therefore not read as
 * "unknown": when every entry on the board is a rookie, a player who is not on it is not a rookie.
 * (The cache key does not include the pool mode, so a snapshot built before the mode was set can be
 * unfiltered; a player found there is judged by the entry's own `isRookie`.)
 *
 * It answers `null` — "unknown, keep the previous behaviour" — when:
 * - no warm snapshot exists (never triggers a cold pool build on the pick path);
 * - the pool carries no rookie data at all: that is the case where the board falls back to the full
 *   pool and tells the manager picks are not checked for rookie status, so refusing here would
 *   contradict the board;
 * - the player is absent from a board that is not rookies-only (it may simply not be in the pool),
 *   or two board entries share the player's name.
 */
import { getWarmDraftPoolSnapshotFast } from '@/lib/draft-room/ensureDraftPoolReady'
import { normalizeDraftPoolNameForDedupe } from '@/lib/draft-room/getResolvedDraftPoolForLeague'

type PoolEntryLike = { playerId?: unknown; name?: unknown; isRookie?: unknown }

export function rookieStatusFromPoolEntries(
  entries: ReadonlyArray<unknown>,
  player: { playerId?: string | null; playerName?: string | null },
): boolean | null {
  const rows = entries.filter((e): e is PoolEntryLike => Boolean(e) && typeof e === 'object')
  if (!rows.some((e) => e.isRookie === true)) return null

  const id = String(player.playerId ?? '').trim()
  let match = id ? rows.find((e) => String(e.playerId ?? '').trim() === id) : undefined
  let nameMatches = 0
  if (!match) {
    const name = normalizeDraftPoolNameForDedupe(String(player.playerName ?? ''))
    if (name) {
      const byName = rows.filter((e) => normalizeDraftPoolNameForDedupe(String(e.name ?? '')) === name)
      nameMatches = byName.length
      // Two pool players with one name cannot be told apart by name: unknown, not a guess.
      if (byName.length === 1) match = byName[0]
    }
  }
  if (match) return match.isRookie === true
  if (nameMatches > 1) return null
  // Absent from a board of nothing but rookies: the rookies-only filter removed them.
  return rows.every((e) => e.isRookie === true) ? false : null
}

export async function resolveServerRookieStatus(args: {
  leagueId: string
  playerId?: string | null
  playerName: string
}): Promise<boolean | null> {
  try {
    const snapshot = await getWarmDraftPoolSnapshotFast(args.leagueId)
    if (!snapshot.warm || !snapshot.payload) return null
    const entries = (snapshot.payload as { entries?: unknown }).entries
    if (!Array.isArray(entries)) return null
    return rookieStatusFromPoolEntries(entries, args)
  } catch (err) {
    console.warn('[draft] server rookie status unavailable:', err instanceof Error ? err.message : String(err))
    return null
  }
}
