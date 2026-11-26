/**
 * A pick in a STARTUP or REDRAFT draft being run now, priced from that draft's OWN remaining board
 * (owner's call, 2026-11-26). PURE — the grader supplies the board and prices the players on it.
 *
 * In a rookie draft the market quotes the pick itself ("2026 Pick 1.04"). In a startup or redraft draft
 * it quotes nothing — a pick there is worth the PLAYER taken with it — so every such swap was withheld.
 * The evidence for "the player taken with it" is already in hand: the players this draft has not taken
 * yet, in the order the draft expects them to go, each valued on this league's own chart.
 *
 * 🛑 NO CURVE. Nothing here invents a value for a slot. A pick at board index k (k open picks ahead of it,
 * counting the one on the clock as 0) is the league value of the players the draft expects there:
 *
 *   - ORDER: the draft room's own ADP (its warm pool snapshot) when the loader has it, else this
 *     league's chart rank. The loader says which, and the basis sentence repeats it.
 *   - WINDOW: the mean of the players at k−2 … k+2, shrunk SYMMETRICALLY at the board's ends so it stays
 *     centred on k (the pick on the clock is its one player, not the mean of the top three). Who goes at
 *     exactly k is uncertain by a few spots — ADP neighbours swap all the time — so one player is noise;
 *     ±2 is narrower than a third of a round in any league of 8+ teams, so 1.04 and 1.09 never share a
 *     player and still price apart.
 *   - ORDER-PRESERVING: an earlier pick can take anyone a later one could, so it is never worth less.
 *     Across the picks in one deal, each is raised to the best of the picks after it (an ADP-ordered
 *     board is not value-sorted, and a window can dip).
 *   - EXHAUSTION: a pick past the end of the board, a pick already made, or a window whose players the
 *     chart cannot price is NOT priced, with the reason — the deal is withheld, never graded on a guess.
 */

export type LiveDraftBoardPlayer = { name: string; position?: string | null; playerId?: string | null }

/** What the draft room knows about the board right now — read by `loadLiveDraftBoard`. */
export type LiveDraftBoard = {
  /** Overall numbers still open in this draft, ascending — the pick on the clock first. */
  openOveralls: number[]
  /**
   * The players not yet drafted, in the order the draft room expects them to go (its ADP). Null when the
   * room has no warm pool to read: the board is then this league's chart, ranked by value.
   */
  expected: LiveDraftBoardPlayer[] | null
  /** Players this draft has already taken — removed from a chart-ranked board. */
  drafted: { names: string[]; playerIds: string[] }
}

export type DraftBoardOrder = 'draft_room_adp' | 'league_chart'

export type DraftBoardPickQuote =
  | { overall: number; value: number; source: string | null; expected: string[] }
  | { overall: number; value: null; reason: string }

export const DRAFT_BOARD_WINDOW_HALF_WIDTH = 2

export const DRAFT_BOARD_UNAVAILABLE_REASON =
  "This draft's remaining board could not be read just now, so its picks are not priced and this deal is not graded."

export function draftBoardPickMadeReason(overall: number): string {
  return `Pick #${overall} has already been made in this draft, so it is a player now — trade the player. This deal is not graded as it stands.`
}

export function draftBoardExhaustedReason(overall: number): string {
  return `This draft's remaining board runs out before pick #${overall}, so that pick is not priced and this deal is not graded.`
}

export function draftBoardUnpricedWindowReason(overall: number): string {
  return `The players this draft expects at pick #${overall} have no value on this league's chart, so that pick is not priced and this deal is not graded.`
}

/** The sentence every grade with a board-priced pick carries in its basis. */
export function draftBoardBasisNote(order: DraftBoardOrder): string {
  return order === 'draft_room_adp'
    ? "Picks in this draft are priced from this draft's remaining board: the league value of the players the draft room's ADP expects at that pick (up to 5 around it)."
    : "Picks in this draft are priced from this draft's remaining board: the league value of the undrafted players this league's chart ranks at that pick (up to 5 around it)."
}

const norm = (s: string | null | undefined) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

/**
 * The board in expected order, with drafted players removed. A chart-ranked board is the chart's own
 * player rows (never its PICK rows), by value.
 */
export function draftBoardPlayers(
  board: LiveDraftBoard,
  fcPlayers: ReadonlyArray<{ player: { name: string; position: string; sleeperId?: string | null }; value: number }>,
): { players: LiveDraftBoardPlayer[]; order: DraftBoardOrder } {
  const names = new Set(board.drafted.names.map(norm).filter(Boolean))
  const ids = new Set(board.drafted.playerIds.map((s) => String(s ?? '').trim()).filter(Boolean))
  const taken = (p: LiveDraftBoardPlayer) => names.has(norm(p.name)) || (p.playerId != null && ids.has(String(p.playerId).trim()))
  if (board.expected) {
    return { players: board.expected.filter((p) => norm(p.name) && !taken(p)), order: 'draft_room_adp' }
  }
  const players = fcPlayers
    .filter((r) => String(r.player?.position ?? '').toUpperCase() !== 'PICK' && typeof r.value === 'number' && r.value > 0)
    .slice()
    .sort((a, b) => b.value - a.value)
    .map((r) => ({ name: r.player.name, position: r.player.position, playerId: r.player.sleeperId || null }))
    .filter((p) => !taken(p))
  return { players, order: 'league_chart' }
}

/** k: how many open picks come before this one. Null when the pick is not open (already made, or not on this board). */
export function draftBoardIndexOf(board: Pick<LiveDraftBoard, 'openOveralls'>, overall: number): number | null {
  const i = board.openOveralls.indexOf(overall)
  return i >= 0 ? i : null
}

/** The board indices averaged for index k — centred, ±half, shrunk symmetrically at either end. Null past the end. */
export function draftBoardWindow(boardLength: number, index: number, half = DRAFT_BOARD_WINDOW_HALF_WIDTH): number[] | null {
  if (!Number.isInteger(index) || index < 0 || index >= boardLength) return null
  const h = Math.max(0, Math.min(half, index, boardLength - 1 - index))
  const out: number[] = []
  for (let i = index - h; i <= index + h; i++) out.push(i)
  return out
}

/**
 * Quote every board pick in one deal. `valueOf` prices players on the league's chart — the grader's own
 * player pricing — and returns one entry per player (null value: the chart could not price him).
 */
export async function priceDraftBoardPicks(args: {
  overalls: readonly number[]
  board: LiveDraftBoard
  fcPlayers: Parameters<typeof draftBoardPlayers>[1]
  valueOf: (players: LiveDraftBoardPlayer[]) => Promise<Array<{ value: number | null; source?: string | null }>>
}): Promise<{ quotes: Map<number, DraftBoardPickQuote>; order: DraftBoardOrder }> {
  const { players, order } = draftBoardPlayers(args.board, args.fcPlayers)
  const quotes = new Map<number, DraftBoardPickQuote>()
  const priced: Array<{ overall: number; index: number }> = []
  for (const overall of [...new Set(args.overalls)]) {
    const index = draftBoardIndexOf(args.board, overall)
    if (index == null) {
      quotes.set(overall, { overall, value: null, reason: draftBoardPickMadeReason(overall) })
      continue
    }
    const window = draftBoardWindow(players.length, index)
    if (!window) {
      quotes.set(overall, { overall, value: null, reason: draftBoardExhaustedReason(overall) })
      continue
    }
    const at = window.map((i) => players[i]!)
    const values = await args.valueOf(at)
    const ok = values.map((v, i) => ({ v, p: at[i]! })).filter((x) => x.v?.value != null && Number.isFinite(x.v.value) && x.v.value! >= 0)
    if (ok.length === 0) {
      quotes.set(overall, { overall, value: null, reason: draftBoardUnpricedWindowReason(overall) })
      continue
    }
    const mean = Math.round(ok.reduce((s, x) => s + x.v.value!, 0) / ok.length)
    const centre = values[window.indexOf(index)]
    quotes.set(overall, {
      overall,
      value: mean,
      source: (centre?.value != null ? centre.source : ok[0]!.v.source) ?? null,
      expected: ok.map((x) => x.p.name),
    })
    priced.push({ overall, index })
  }
  // Order-preserving: walk from the latest pick back, raising each to the best value after it.
  priced.sort((a, b) => b.index - a.index)
  let best = -Infinity
  for (const { overall } of priced) {
    const q = quotes.get(overall)!
    if (q.value == null) continue
    if (q.value < best) quotes.set(overall, { ...q, value: best })
    else best = q.value
  }
  return { quotes, order }
}
