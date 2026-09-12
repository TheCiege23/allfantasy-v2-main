/**
 * Fleaflicker draft board → `NormalizedDraftPick[]`.
 *
 * 🛑 THE ENDPOINT RETURNS TWO STRUCTURALLY DIFFERENT ENVELOPES, AND THE SEASON IS
 * NOT THE RULE. Measured against one league, requests identical but for the season:
 *
 *   season=2019  ->  { draftOrder, rows, rosters }   a BOARD, rounds of cells
 *   season=2020  ->  { orderedSelections }           a FLAT LIST of the same cells
 *   season=2021  ->  { }                             HTTP 200, zero keys
 *
 * All three are HTTP 200. A mapper written against either envelope alone reads the
 * other as "no draft" and says nothing about it.
 *
 * ⚡ ONE MAPPER SERVES BOTH, BECAUSE THE PICK OBJECT IS IDENTICAL — `rows[].cells[]`
 * and `orderedSelections[]` each hold `{ team, player, slot, color }`. So this
 * branches on WHICH KEY IS PRESENT, never on the season. The season correlates with
 * something this contract has not identified (draft type? a platform change?), so
 * keying on the year would pass on the probed league and fail on the next one. See
 * G-10 in contracts/fleaflicker/GAPS.md.
 *
 * 🛑 AND `{}` IS NOT "THIS LEAGUE NEVER DRAFTED". The same league answers richly for
 * other seasons, and `draft_number` does not change it. Zero keys means "no board for
 * this season" — never a fetch failure, never absence of draft history. The caller
 * gets `envelope: 'empty'` so it can report that honestly rather than writing nothing
 * and looking successful.
 */
import type { NormalizedDraftPick } from '@/lib/league-import/types'

/** One selection. Identical in both envelopes — that is what makes one mapper work. */
export interface FleaflickerDraftCell {
  team?: { id?: number | null; name?: string | null } | null
  player?: {
    proPlayer?: {
      id?: number | null
      nameFull?: string | null
      position?: string | null
      proTeamAbbreviation?: string | null
    } | null
  } | null
  /**
   * ⚠ THE OBJECT IS CALLED `slot` AND SO IS ITS IN-ROUND FIELD. `slot.slot` is the
   * pick WITHIN the round; `slot.overall` is the overall selection number. Reaching
   * for `slot.slot` is the natural mistake and it is the wrong one — see `pick_no`.
   */
  slot?: { round?: number | null; slot?: number | null; overall?: number | null } | null
}

export interface FleaflickerDraftBoard {
  rows?: Array<{ round?: number | null; cells?: FleaflickerDraftCell[] | null }> | null
  orderedSelections?: FleaflickerDraftCell[] | null
}

export interface FleaflickerDraftSummary {
  picks: NormalizedDraftPick[]
  /** Which shape the payload actually was. `empty` is a real answer, not a failure. */
  envelope: 'board' | 'list' | 'empty'
  /** Cells seen before mapping, so a caller can report what it dropped. */
  cellCount: number
  /** Cells skipped because they carried no usable player or slot. */
  skippedCount: number
}

/**
 * Flatten whichever envelope arrived.
 *
 * ⚠ `rows[].round` is REDUNDANT with `cells[].slot.round` — measured equal on every
 * cell of the board fixture — so this deliberately does not read it. Taking the round
 * from the row would give the list form no equivalent and force two code paths for a
 * value both forms already carry.
 */
function cellsOf(board: FleaflickerDraftBoard | null | undefined): {
  cells: FleaflickerDraftCell[]
  envelope: FleaflickerDraftSummary['envelope']
} {
  if (Array.isArray(board?.rows)) {
    return {
      cells: board!.rows!.flatMap((r) => (Array.isArray(r?.cells) ? r.cells : [])),
      envelope: 'board',
    }
  }
  if (Array.isArray(board?.orderedSelections)) {
    return { cells: board!.orderedSelections!, envelope: 'list' }
  }
  return { cells: [], envelope: 'empty' }
}

export function mapFleaflickerDraftBoard(
  board: FleaflickerDraftBoard | null | undefined,
  options: { season?: number | null } = {},
): FleaflickerDraftSummary {
  const { cells, envelope } = cellsOf(board)
  const picks: NormalizedDraftPick[] = []
  let skipped = 0

  for (const cell of cells) {
    const playerId = cell?.player?.proPlayer?.id
    const teamId = cell?.team?.id
    const round = cell?.slot?.round
    const overall = cell?.slot?.overall

    /*
     * ⚠ `source_player_id` and `source_roster_id` are REQUIRED strings, and `round`
     * and `pick_no` are required numbers. A cell missing any of them cannot become a
     * pick, and coercing it to `''` or `0` would write a row no reader can resolve
     * while making the import look complete. Skip, and let `skippedCount` say so.
     */
    if (playerId == null || teamId == null || round == null || overall == null) {
      skipped++
      continue
    }

    const pro = cell!.player!.proPlayer!

    picks.push({
      round,
      /*
       * 🛑 `slot.overall`, NOT `slot.slot`. The canonical `pick_no` is the OVERALL
       * selection number — Sleeper's is, and every consumer treats it that way.
       * Writing the in-round number here would make every round look like it had
       * sixteen first-round picks.
       *
       * Verified arithmetic on the committed fixtures across BOTH envelopes:
       * `overall === (round - 1) * 16 + slot` for every cell of a 16-team league
       * (round 4, slot 3, overall 51). The two numbers are only equal in round 1,
       * which is exactly how this mistake survives a casual check.
       */
      pick_no: overall,
      /*
       * ⚠ NUMBER -> STRING, DELIBERATELY. Fleaflicker ids are integers
       * (`proPlayer.id: 8512`), the canonical fields are strings, and this repo has
       * already been bitten by numeric coercion in the other direction — an MFL
       * franchise id "0001" that `String(Number(x))` turned into "1" and no reader
       * could join again. Nothing here reformats; it only changes type.
       */
      source_roster_id: String(teamId),
      source_player_id: String(playerId),
      ...(options.season != null ? { season: options.season } : {}),
      ...(pro.nameFull ? { player_name: pro.nameFull } : {}),
      ...(pro.position ? { position: pro.position } : {}),
      ...(pro.proTeamAbbreviation ? { team: pro.proTeamAbbreviation } : {}),
    })
  }

  return { picks, envelope, cellCount: cells.length, skippedCount: skipped }
}

/**
 * A coverage note describing what the draft import actually got, in the same spirit
 * as the Fantrax one — a caller should never have to infer "missing" from an empty
 * array, because empty has three distinct causes here.
 */
export function describeFleaflickerDraftCoverage(
  summary: FleaflickerDraftSummary,
): { state: 'full' | 'partial' | 'missing'; note?: string } {
  if (summary.envelope === 'empty') {
    return {
      state: 'missing',
      note: 'Fleaflicker returned an empty draft board for this season (HTTP 200, no keys). The same league can still have draft history in other seasons.',
    }
  }
  if (summary.skippedCount > 0) {
    return {
      state: 'partial',
      note: `${summary.picks.length} of ${summary.cellCount} draft cells mapped; ${summary.skippedCount} lacked a player, team or slot.`,
    }
  }
  return { state: 'full' }
}
