/**
 * The mock-draft board (`/draft`), as players keyed by SLEEPER ID and ordered by consensus ADP.
 *
 * 🛑 THE ID CONTRACT. Every `id` this returns is a bare Sleeper id (`4984` = QB Josh Allen). The
 * board route sends it to the client as `DraftPlayerRow.id`; `DraftShell` queues it
 * (`DraftRoomUserQueue.playerIds`), drafts it (`DraftRoomPickRecord.playerId`), and opens the player
 * modal with it (`/api/draft/player-detail?playerId=<id>`). The worker and the CPU pick resolve queued
 * ids against THIS board and pick best-available from it, so every party reads one id space.
 *
 * It used to be whatever `SportsPlayer.externalId` the first name-matched row carried — a backfill or
 * Rolling Insights number for half the board — and `2135` meant Josh Allen on the board, Josh
 * Hines-Allen to the worker, and Ha Ha Clinton-Dix to the player modal.
 *
 * Only NFL has a Sleeper namespace (`mayBeSleeperId`), so only NFL has a board here.
 */

import { getLiveAdpByName, type LiveAdpEntry } from '@/lib/adp/liveAdpFallback'
import { sleeperHeadshotUrl } from '@/lib/player-media-urls'
import { toImageUrl } from '@/lib/media/imageUrl'
import {
  indexSleeperCandidates,
  loadSleeperCandidatesByName,
  resolveSleeperCandidate,
} from '@/lib/draft/sleeperNameCandidates'

export interface SleeperBoardPlayer {
  /** Bare Sleeper id. */
  id: string
  name: string
  position: string
  /** Team abbreviation, '' for a free agent. */
  team: string
  imageUrl: string | null
  status: string | null
  adp: number
}

/**
 * How many ADP names to resolve per requested row. An ADP entry that does not resolve to exactly one
 * Sleeper player is DROPPED (it would have no id, or the wrong one), so over-fetch to fill the board.
 */
const NAME_LOOKUP_MULTIPLIER = 3

/**
 * The board, best ADP first, or `null` when there is no ADP board for this sport (only NFL is
 * populated). Never throws for a missing board — a fallback that can take down the draft is worse
 * than the gap it fills.
 */
export async function loadSleeperAdpBoard(opts: { sport: string; take: number }): Promise<SleeperBoardPlayer[] | null> {
  const sport = opts.sport.toUpperCase()
  if (sport !== 'NFL') return null

  const adp = await getLiveAdpByName({ sport }).catch(() => new Map<string, LiveAdpEntry>())
  if (adp.size === 0) return null

  const ranked = [...adp.values()]
    .filter((e) => Number.isFinite(e.adp))
    .sort((a, b) => a.adp - b.adp)
    .slice(0, opts.take * NAME_LOOKUP_MULTIPLIER)

  const candidates = await loadSleeperCandidatesByName(
    sport,
    ranked.map((e) => e.name),
  )
  const index = indexSleeperCandidates(candidates)

  const seen = new Set<string>()
  const out: SleeperBoardPlayer[] = []
  for (const entry of ranked) {
    if (out.length >= opts.take) break
    const match = resolveSleeperCandidate(
      index,
      { name: entry.name, position: entry.position ?? null, team: entry.team ?? null },
      // The ADP board's team lags trades; it may narrow namesakes but never veto a lone match.
      { teamMayBeStale: true },
    )
    // Unresolved or ambiguous: no id we can stand behind, so the player is not draftable here.
    if (!match || seen.has(match.sleeperId)) continue
    seen.add(match.sleeperId)
    out.push({
      id: match.sleeperId,
      name: match.name,
      position: match.position ?? entry.position ?? '',
      team: match.team ?? '',
      imageUrl: toImageUrl(match.imageUrl) ?? sleeperHeadshotUrl(match.sleeperId, 'nfl'),
      status: match.status,
      adp: entry.adp,
    })
  }
  return out
}

/**
 * The player an autopick / CPU pick takes: the first QUEUED id that is still on the board and not
 * taken, else the best-ADP player not taken. `null` when the board has nothing left — the caller
 * refuses rather than inventing a pick.
 *
 * 🛑 NEVER ALPHABETICAL. The old fallback was `SportsPlayer` ordered by `name asc`, so every CPU and
 * auto pick drafted "A. J." before Ja'Marr Chase.
 *
 * A queued id that is NOT on the board is skipped, not looked up: queues written before the board
 * spoke Sleeper ids hold provider numbers (`2135` meant Josh Allen then; it is Ha Ha Clinton-Dix in
 * Sleeper's space), and the board is the one place an id is known to mean the player it was queued as.
 */
export function pickFromBoard(
  board: readonly SleeperBoardPlayer[],
  takenIds: ReadonlySet<string>,
  queuedIds: readonly string[] = [],
): SleeperBoardPlayer | null {
  const byId = new Map(board.map((p) => [p.id, p]))
  for (const raw of queuedIds) {
    const id = String(raw ?? '').trim()
    if (!id || takenIds.has(id)) continue
    const p = byId.get(id)
    if (p) return p
  }
  for (const p of board) {
    if (!takenIds.has(p.id)) return p
  }
  return null
}

/** The deepest board the routes ask for; autopick looks this far before giving up. */
export const MAX_BOARD_SIZE = 600
