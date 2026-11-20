import 'server-only'

import {
  boardPlayerValue,
  isBoardValueSport,
  loadLeagueValueBoard,
  type LeagueValueBoard,
  type LeagueValueBoardDeps,
} from '@/lib/sport-values/leagueValueBoard'

/**
 * THE ASKER'S ROSTER ON THE LEAGUE'S VALUE BOARD — NBA, MLB, NHL (Player Value OS, 2026-11-20 re-score push).
 *
 * 🛑 THESE SPORTS HAD NO VALUE IN THE PACKET AT ALL. The market slice is NFL-shaped, so for a board sport it returns a
 * placeholder and the packet files it as `not_requested`; the values reached Chimmy only when the model thought to
 * call `get_player_value` for one named player. This prices the asker's whole roster on the league's own board — the
 * trade grade's price (`boardPlayerValue`, rest-of-season value over the best free agent at his position) — so a
 * "who is my most valuable player / should I sell X" turn has the numbers in its context.
 *
 * ⚠ ONE SCALE, STATED. A board value is points or category score over replacement in THIS league, not the 0–10000
 * NFL scale; every row carries the unit and the closing line says never to convert or compare.
 *
 * Never throws. NFL and anything not on a board returns `not_board_sport` before any query.
 */

export type RosterBoardValueResult =
  | { kind: 'not_board_sport' }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'ok'; text: string; priced: number }

type RosterPlayer = { playerId?: unknown; name?: unknown; position?: unknown }

const MAX_ROWS = 30
const fmt = (n: number) => (Math.round(n * 10) / 10).toLocaleString('en-US')

function rosterOf(rosterValue: unknown): Array<{ id: string; name: string | null; position: string | null; slot: 'starter' | 'bench' }> {
  if (!rosterValue || typeof rosterValue !== 'object') return []
  const v = rosterValue as { starters?: unknown; bench?: unknown }
  const out: Array<{ id: string; name: string | null; position: string | null; slot: 'starter' | 'bench' }> = []
  const seen = new Set<string>()
  for (const [slot, group] of [['starter', v.starters], ['bench', v.bench]] as const) {
    if (!Array.isArray(group)) continue
    for (const p of group as RosterPlayer[]) {
      const id = typeof p?.playerId === 'string' ? p.playerId.trim() : ''
      if (!id || seen.has(id)) continue
      seen.add(id)
      out.push({
        id,
        name: typeof p.name === 'string' && p.name.trim() ? p.name.trim() : null,
        position: typeof p.position === 'string' && p.position.trim() ? p.position.trim().toUpperCase() : null,
        slot,
      })
    }
  }
  return out
}

/** PURE over a loaded board: the asker's roster priced, most valuable first. */
export function renderRosterBoardValues(board: LeagueValueBoard, rosterValue: unknown): RosterBoardValueResult {
  if (board.kind === 'not_board_sport') return { kind: 'not_board_sport' }
  if (board.kind === 'unavailable') return { kind: 'unavailable', reason: board.reason }
  const roster = rosterOf(rosterValue)
  if (roster.length === 0) return { kind: 'unavailable', reason: 'No roster was returned for you in this league, so nothing could be priced.' }

  const priced: Array<{ label: string; value: number; line: string }> = []
  const unpriced: string[] = []
  let unit = ''
  let window = ''
  for (const p of roster) {
    const r = boardPlayerValue(board, { playerId: p.id, rosterPlayerId: p.id, name: p.name })
    const label = `${p.name ?? `player ${p.id}`}${p.position ? ` (${p.position})` : ''}`
    if (!r.available) {
      unpriced.push(label)
      continue
    }
    const d = r.data
    unit = d.unit
    window = `${d.seasonLabel}, ${d.scheduleKnown ? `${d.gamesRemaining} games left` : 'a full season (schedule not posted yet)'}`
    priced.push({
      label,
      value: d.value,
      line:
        `  ${label}: ${fmt(d.value)} ${d.unit} over replacement rest of season ` +
        `(${fmt(d.perGame)}/game vs ${fmt(d.replacementPerGame)} for the best free agent)` +
        (d.dynastyValue != null ? `; dynasty ${fmt(d.dynastyValue)}` : '') +
        (d.sample?.thin ? ' — thin sample' : ''),
    })
  }
  if (priced.length === 0) {
    return { kind: 'unavailable', reason: 'None of your rostered players could be found on this league’s value board.' }
  }
  priced.sort((a, b) => b.value - a.value)
  const lines = [
    `Your roster on this league's ${board.sport} value board (${window}), most valuable first — the same price the trade grade uses:`,
    ...priced.slice(0, MAX_ROWS).map((p) => p.line),
  ]
  if (priced.length > MAX_ROWS) lines.push(`  (+${priced.length - MAX_ROWS} more priced players not shown)`)
  if (unpriced.length) lines.push(`  Not on the board (no value, NOT zero): ${unpriced.slice(0, 10).join(', ')}${unpriced.length > 10 ? ` (+${unpriced.length - 10} more)` : ''}`)
  lines.push(
    `  UNIT: ${unit} over replacement in THIS league — not the AllFantasy 0–10000 NFL scale and not comparable across leagues. Quote these numbers; never convert or compare them.`,
  )
  return { kind: 'ok', text: lines.join('\n'), priced: priced.length }
}

/** Load the league's board and price the roster. Never throws. */
export async function loadRosterBoardValues(
  args: { leagueId: string; sport: string | null | undefined; rosterValue: unknown },
  deps: Partial<LeagueValueBoardDeps> = {},
): Promise<RosterBoardValueResult> {
  if (!isBoardValueSport(args.sport)) return { kind: 'not_board_sport' }
  try {
    const board = await loadLeagueValueBoard(args.leagueId, deps)
    return renderRosterBoardValues(board, args.rosterValue)
  } catch {
    return { kind: 'unavailable', reason: 'The league’s value board could not be read just now.' }
  }
}
