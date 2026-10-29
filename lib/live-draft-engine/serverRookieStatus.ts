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
 * MLB / NBA / NHL pools carry a three-state verdict from stored season stats (`rookieVerdict`,
 * `lib/draft-room/seasonStatsRookieStatus.ts`): only a proven `not_rookie` is refused, and an
 * `unknown` player is accepted. A rookies-only board with unknowns on it keeps them, so a proven
 * non-rookie's ABSENCE proves nothing there — the snapshot's `provenNonRookies` list names them.
 *
 * It answers `null` — "unknown, keep the previous behaviour" — when:
 * - no warm snapshot exists (never triggers a cold pool build on the pick path);
 * - the pool carries no rookie data at all: that is the case where the board falls back to the full
 *   pool and tells the manager picks are not checked for rookie status, so refusing here would
 *   contradict the board;
 * - the player is absent from a board that is not rookies-only (it may simply not be in the pool),
 *   or two board entries share the player's name.
 *
 * ⚠ AUTOPICK MUST FILTER ITS CANDIDATES WITH THE SAME RESOLVER (`filterCandidatesForPlayerPool`).
 * A refused autopick is retried with the same player on the next tick, so a candidate list that
 * disagrees with this check stalls the clock rather than merely losing one pick.
 */
import { getWarmDraftPoolSnapshotFast } from '@/lib/draft-room/ensureDraftPoolReady'
import { normalizeDraftPoolNameForDedupe } from '@/lib/draft-room/getResolvedDraftPoolForLeague'
import { entryRookieVerdict, hasRookieVerdicts, type EntryRookieVerdict } from '@/lib/draft-room/rookieFilterState'

type PoolEntryLike = { playerId?: unknown; name?: unknown; isRookie?: unknown; rookieVerdict?: unknown }
type PlayerRef = { playerId?: string | null; playerName?: string | null }

export type ServerRookieStatusResolver = (player: PlayerRef) => boolean | null

function indexByIdAndName<T extends { playerId?: unknown; name?: unknown }>(rows: readonly T[]) {
  const byId = new Map<string, T>()
  const byName = new Map<string, T[]>()
  for (const row of rows) {
    const id = String(row.playerId ?? '').trim()
    if (id && !byId.has(id)) byId.set(id, row)
    const name = normalizeDraftPoolNameForDedupe(String(row.name ?? ''))
    if (name) byName.set(name, [...(byName.get(name) ?? []), row])
  }
  /** The row for this player, `null` when two rows share his name, `undefined` when absent. */
  return (player: PlayerRef): T | null | undefined => {
    const id = String(player.playerId ?? '').trim()
    const byIdMatch = id ? byId.get(id) : undefined
    if (byIdMatch) return byIdMatch
    const name = normalizeDraftPoolNameForDedupe(String(player.playerName ?? ''))
    const named = name ? byName.get(name) ?? [] : []
    // Two pool players with one name cannot be told apart by name: unknown, not a guess.
    if (named.length > 1) return null
    return named[0]
  }
}

/**
 * Indexes the board once, so autopick can judge hundreds of candidates against it.
 *
 * `provenNonRookies` (MLB/NBA/NHL) are the players a rookies-only VERDICT pool took off the board
 * because stored season stats prove they are not rookies. In such a pool
 * (`rookieFilterState.ts` `hasRookieVerdicts`) a row without a rookie flag is `unknown` — null here,
 * so it is never refused — and only a `not_rookie` verdict, on the board or in that list, is `false`.
 */
export function buildRookieStatusResolver(
  entries: ReadonlyArray<unknown>,
  provenNonRookies: ReadonlyArray<unknown> = [],
): ServerRookieStatusResolver {
  const rows = entries.filter((e): e is PoolEntryLike => Boolean(e) && typeof e === 'object')
  const removed = provenNonRookies.filter((e): e is PoolEntryLike => Boolean(e) && typeof e === 'object')
  const find = indexByIdAndName(rows)

  if (removed.length > 0 || hasRookieVerdicts(rows as Array<{ rookieVerdict?: EntryRookieVerdict | null }>)) {
    const verdictOf = (row: PoolEntryLike) =>
      entryRookieVerdict({ isRookie: row.isRookie === true, rookieVerdict: row.rookieVerdict as EntryRookieVerdict | undefined })
    const verdicts = rows.map(verdictOf)
    if (removed.length === 0 && !verdicts.some((v) => v !== 'unknown')) return () => null
    const allRookies = rows.length > 0 && verdicts.every((v) => v === 'rookie')
    const findRemoved = indexByIdAndName(removed)
    return (player) => {
      const match = find(player)
      if (match === null) return null
      if (match) {
        const verdict = verdictOf(match)
        return verdict === 'rookie' ? true : verdict === 'not_rookie' ? false : null
      }
      if (findRemoved(player)) return false
      return allRookies ? false : null
    }
  }

  if (!rows.some((e) => e.isRookie === true)) return () => null
  const allRookies = rows.every((e) => e.isRookie === true)

  return (player) => {
    const match = find(player)
    if (match) return match.isRookie === true
    if (match === null) return null
    // Absent from a board of nothing but rookies: the rookies-only filter removed them.
    return allRookies ? false : null
  }
}

export function rookieStatusFromPoolEntries(
  entries: ReadonlyArray<unknown>,
  player: PlayerRef,
  provenNonRookies?: ReadonlyArray<unknown>,
): boolean | null {
  return buildRookieStatusResolver(entries, provenNonRookies)(player)
}

export function isRookieRestrictedPlayerPool(playerPool: unknown): boolean {
  const mode = String(playerPool ?? '').toLowerCase()
  return mode === 'rookies_only' || mode === 'veterans_only'
}

/** False only when the server's verdict contradicts the pool mode; unknown stays eligible. */
export function isEligibleForPlayerPool(playerPool: unknown, rookie: boolean | null): boolean {
  const mode = String(playerPool ?? '').toLowerCase()
  if (mode === 'rookies_only') return rookie !== false
  if (mode === 'veterans_only') return rookie !== true
  return true
}

export async function loadServerRookieStatusResolver(leagueId: string): Promise<ServerRookieStatusResolver | null> {
  try {
    const snapshot = await getWarmDraftPoolSnapshotFast(leagueId, { allowStale: true })
    if (!snapshot.warm || !snapshot.payload) return null
    const { entries, provenNonRookies } = snapshot.payload as { entries?: unknown; provenNonRookies?: unknown }
    if (!Array.isArray(entries)) return null
    return buildRookieStatusResolver(entries, Array.isArray(provenNonRookies) ? provenNonRookies : [])
  } catch (err) {
    console.warn('[draft] server rookie status unavailable:', err instanceof Error ? err.message : String(err))
    return null
  }
}

export async function resolveServerRookieStatus(args: {
  leagueId: string
  playerId?: string | null
  playerName: string
}): Promise<boolean | null> {
  const resolver = await loadServerRookieStatusResolver(args.leagueId)
  return resolver ? resolver(args) : null
}

/**
 * Drops autopick candidates that pick validation would refuse in a rookies-only / veterans-only
 * draft. A no-op for every other pool mode and when the server cannot tell (no warm snapshot).
 */
export async function filterCandidatesForPlayerPool<T>(
  leagueId: string,
  playerPool: unknown,
  candidates: T[],
  toPlayer: (candidate: T) => PlayerRef,
): Promise<T[]> {
  if (!isRookieRestrictedPlayerPool(playerPool) || candidates.length === 0) return candidates
  const resolver = await loadServerRookieStatusResolver(leagueId)
  if (!resolver) return candidates
  return candidates.filter((c) => isEligibleForPlayerPool(playerPool, resolver(toPlayer(c))))
}
