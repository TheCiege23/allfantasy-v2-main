/**
 * Fantrax draft results → the canonical `draft_picks` shape.
 *
 * 🛑 THE ENDPOINTS WERE CATALOGUED AND NEVER CALLED. `getDraftPicks` and
 * `getDraftResults` sat in `FANTRAX_ENDPOINTS` with no wrapper function while
 * every other entry had one, so `FantraxAdapter`'s coverage reported
 * `draftHistory` as "currently reflects traded draft-pick events when
 * available" — i.e. traded picks only, never an actual draft. A completed
 * 192-pick draft was one unwritten function away.
 *
 * Every claim below is measured against the committed fixtures
 * (`__tests__/fixtures/fantrax-draft-results.json`, `…-picks.json`, Cream Bowl),
 * not inferred.
 *
 * ── TWO THINGS THAT WILL BITE ────────────────────────────────────────────────
 *
 * 🛑 `pick` MEANS DIFFERENT THINGS IN THE TWO ENDPOINTS. `getDraftResults.pick`
 * is the OVERALL pick (1-192 in a 12-team, 16-round league);
 * `getDraftPicks.pick` is the pick WITHIN the round (1-12). Joining them on
 * `round + pick + teamId` returns ZERO matches — measured, 36 against 36 with no
 * overlap. Join on `round + pickInRound + teamId` and they are exactly equal.
 *
 * ⚠ `playerId` IS ABSENT, NOT NULL, ON AN UNMADE PICK. 156 of the fixture's 192
 * slots carry one; the other 36 simply lack the key. Those 36 are the same picks
 * `getDraftPicks.currentDraftPicks` reports as outstanding — verified as an exact
 * set match once the `pick`/`pickInRound` confusion above is accounted for.
 *
 * So a draft board is not a list of picks made: it is a list of SLOTS, and only
 * the filled ones are draft history.
 */
import {
  parseFantraxFuturePicks,
  type FantraxDraftPickInventory,
  type FantraxDraftResults,
  type FantraxFuturePick,
} from '@/lib/league-import/fantrax/fantraxApi'
import type { NormalizedDraftPick } from '@/lib/league-import/types'

export interface FantraxDraftSummary {
  picks: NormalizedDraftPick[]
  /** Slots in the board, filled or not. */
  slotCount: number
  /** Slots with a player — what becomes draft history. */
  madeCount: number
  /** Slots still outstanding. `slotCount - madeCount`, surfaced so coverage can say so. */
  outstandingCount: number
  /** Fantrax's own word for the draft's state ("completed"), or null. */
  draftState: string | null
}

/**
 * Map a draft board onto `NormalizedDraftPick[]`.
 *
 * ⚠ ONLY MADE PICKS ARE EMITTED, and that is forced by the canonical type rather
 * than chosen: `NormalizedDraftPick.source_player_id` is a required string. An
 * unmade slot has no player, and filling it with `''` or a placeholder would put
 * rows in draft history for picks that never happened — indistinguishable, to
 * every reader, from a real pick of an unknown player.
 *
 * The outstanding count is returned alongside so the caller can report the gap
 * honestly instead of the absence being invisible.
 */
export function mapFantraxDraftResults(
  results: FantraxDraftResults | null | undefined,
  options: { season?: number | null } = {},
): FantraxDraftSummary {
  const slots = Array.isArray(results?.picks) ? results!.picks : []
  const picks: NormalizedDraftPick[] = []

  for (const slot of slots) {
    /*
     * ⚠ `playerId` null means the slot is UNMADE — see the header. This is the
     * one branch that decides whether draft history is real or invented.
     */
    if (!slot.playerId) continue

    picks.push({
      round: slot.round,
      /*
       * ⚠ `pick` (OVERALL), NOT `pickInRound`. The canonical `pick_no` is the
       * overall selection number — Sleeper's `pick_no` is overall, and every
       * consumer treats it that way. Writing the in-round number here would make
       * every round look like it had twelve first-round picks.
       */
      pick_no: slot.pick,
      source_roster_id: slot.teamId,
      source_player_id: slot.playerId,
      ...(options.season != null ? { season: options.season } : {}),
    })
  }

  const madeCount = picks.length
  const slotCount = slots.length

  return {
    picks,
    slotCount,
    madeCount,
    outstandingCount: slotCount - madeCount,
    draftState: results?.draftState ?? null,
  }
}

/**
 * A coverage note describing what the draft import actually got.
 *
 * ⚠ DELIBERATELY DISTINGUISHES "NOT DRAFTED YET" FROM "PARTIALLY DRAFTED" FROM
 * "COMPLETE". The previous note said only that draft history "reflects traded
 * draft-pick events", which was true and told a reader nothing about whether
 * their league's draft came across.
 */
export function describeFantraxDraftCoverage(summary: FantraxDraftSummary): string {
  if (summary.slotCount === 0) return 'No Fantrax draft board was available for this league.'
  if (summary.madeCount === 0) {
    return `Fantrax reports a ${summary.slotCount}-slot draft board with no picks made yet.`
  }
  if (summary.outstandingCount > 0) {
    return `${summary.madeCount} of ${summary.slotCount} Fantrax draft slots have been picked; ${summary.outstandingCount} are still outstanding.`
  }
  return `All ${summary.madeCount} Fantrax draft picks were imported.`
}

/* ------------------------------------------------------------------ *
 * Storage
 *
 * `FantraxLeague.draftBoard` and `FantraxLeague.draftPicks` are JSON columns.
 * These are the shapes written to them and the readers that take them back out.
 *
 * ⚠ THE READERS TRUST NOTHING. A JSON column holds whatever was written by
 * whichever version of this file wrote it, so every field is re-checked on the
 * way out and a row that does not look like a pick is dropped, not coerced.
 * ------------------------------------------------------------------ */

type PlayerDirectory = Record<string, { name?: string | null; position?: string | null; team?: string | null }>

/** One slot of the stored draft board. `playerId` is null for a slot not yet used. */
export type StoredFantraxDraftSlot = {
  round: number
  /** OVERALL pick number. */
  pick: number
  pickInRound: number
  /** Fantrax's own team id. */
  teamId: string
  time: number | null
  playerId: string | null
  /**
   * Who the player was, resolved WHEN THE DRAFT WAS STORED.
   *
   * ⚠ NOT LOOKED UP LATER, ON PURPOSE. The reader only has the players currently
   * on a roster, and a drafted player who was since dropped is not among them —
   * so resolving at read time would leave every cut player nameless. The import
   * holds the sport's whole player directory, so the name is taken there.
   */
  playerName: string | null
  playerPosition: string | null
  playerTeam: string | null
}

export type StoredFantraxDraftBoard = {
  version: 1
  fetchedAt: string
  draftState: string | null
  draftType: string | null
  draftOrder: string[]
  draftDate: string | null
  startDate: string | null
  endDate: string | null
  picks: StoredFantraxDraftSlot[]
}

export type StoredFantraxPickInventory = {
  version: 1
  fetchedAt: string
  /** This season's unused picks. ⚠ `pick` is the pick WITHIN the round here. */
  current: Array<{ round: number; pick: number; teamId: string }>
  /** Future-season picks exactly as Fantrax sent them — see `futureRaw` in fantraxApi. */
  futureRaw: unknown[]
}

export function toStoredFantraxDraftBoard(
  results: FantraxDraftResults,
  players: PlayerDirectory = {},
  now: Date = new Date(),
): StoredFantraxDraftBoard {
  return {
    version: 1,
    fetchedAt: now.toISOString(),
    draftState: results.draftState,
    draftType: results.draftType,
    draftOrder: results.draftOrder,
    draftDate: results.draftDate,
    startDate: results.startDate,
    endDate: results.endDate,
    picks: results.picks.map((slot) => {
      const player = slot.playerId ? players[slot.playerId] : undefined
      return {
        round: slot.round,
        pick: slot.pick,
        pickInRound: slot.pickInRound,
        teamId: slot.teamId,
        time: slot.time,
        playerId: slot.playerId,
        playerName: player?.name?.trim() || null,
        playerPosition: player?.position?.trim() || null,
        playerTeam: player?.team?.trim() || null,
      }
    }),
  }
}

export function toStoredFantraxPickInventory(
  inventory: FantraxDraftPickInventory,
  now: Date = new Date(),
): StoredFantraxPickInventory {
  return {
    version: 1,
    fetchedAt: now.toISOString(),
    current: inventory.current.map((p) => ({ round: p.round, pick: p.pick, teamId: p.teamId })),
    futureRaw: inventory.futureRaw,
  }
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** Read a stored board back. Null when the column is empty or not a board. */
export function parseStoredFantraxDraftBoard(raw: unknown): StoredFantraxDraftBoard | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const body = raw as Record<string, unknown>
  if (!Array.isArray(body.picks)) return null

  const picks: StoredFantraxDraftSlot[] = []
  for (const entry of body.picks) {
    if (entry === null || typeof entry !== 'object') continue
    const row = entry as Record<string, unknown>
    const round = finite(row.round)
    const pick = finite(row.pick)
    const pickInRound = finite(row.pickInRound)
    const teamId = text(row.teamId)
    if (round == null || pick == null || pickInRound == null || !teamId) continue
    picks.push({
      round,
      pick,
      pickInRound,
      teamId,
      time: finite(row.time),
      playerId: text(row.playerId),
      playerName: text(row.playerName),
      playerPosition: text(row.playerPosition),
      playerTeam: text(row.playerTeam),
    })
  }

  return {
    version: 1,
    fetchedAt: text(body.fetchedAt) ?? '',
    draftState: text(body.draftState),
    draftType: text(body.draftType),
    draftOrder: Array.isArray(body.draftOrder) ? body.draftOrder.map(text).filter((t): t is string => t != null) : [],
    draftDate: text(body.draftDate),
    startDate: text(body.startDate),
    endDate: text(body.endDate),
    picks,
  }
}

/**
 * The future picks on a stored inventory, still in Fantrax's team-id space.
 *
 * `stored` is false when the column is empty or is not an inventory — which is a
 * different fact from a stored inventory with no future picks, and the caller
 * reports them differently.
 */
export function futurePicksFromStoredInventory(raw: unknown): {
  stored: boolean
  picks: FantraxFuturePick[]
} {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { stored: false, picks: [] }
  const body = raw as Record<string, unknown>
  if (!Array.isArray(body.futureRaw)) return { stored: false, picks: [] }
  return { stored: true, picks: parseFantraxFuturePicks(body.futureRaw) }
}

/** A made pick, in the import payload's shape but still in Fantrax's team-id space. */
export type FantraxBoardPick = {
  round: number
  pickNumber: number
  /** Fantrax's own team id — the caller maps it onto its own team ids. */
  sourceTeamId: string
  playerId: string
  playerName: string | null
  position: string | null
  team: string | null
}

/**
 * The picks actually made on a stored board, in draft order.
 *
 * ⚠ ONLY MADE PICKS, for the reason `mapFantraxDraftResults` gives: a slot with
 * no player is not draft history. `outstanding` says how many were left out.
 */
export function madePicksFromStoredBoard(board: StoredFantraxDraftBoard | null): {
  picks: FantraxBoardPick[]
  slots: number
  outstanding: number
  draftState: string | null
} {
  if (!board) return { picks: [], slots: 0, outstanding: 0, draftState: null }
  const picks: FantraxBoardPick[] = []
  for (const slot of board.picks) {
    if (!slot.playerId) continue
    picks.push({
      round: slot.round,
      /* OVERALL, not in-round — see the header of this file. */
      pickNumber: slot.pick,
      sourceTeamId: slot.teamId,
      playerId: slot.playerId,
      playerName: slot.playerName,
      position: slot.playerPosition,
      team: slot.playerTeam,
    })
  }
  picks.sort((a, b) => a.pickNumber - b.pickNumber)
  return {
    picks,
    slots: board.picks.length,
    outstanding: board.picks.length - picks.length,
    draftState: board.draftState,
  }
}
