/**
 * Reads Fantrax's "Transaction History → Claim/Drop" CSV export into claims and drops.
 *
 * One row per move (contracts/fantrax/fixtures/2026-transaction-history-download.json, GAPS F-19):
 *
 *   "Player","Team","Position","Type","Team","Bid","Date (EST)","Week"
 *   "Sample Receiver","PHI","WR","Claim","#5 Team A","7000.00","Sat Nov 21, 2026, 9:00AM","11"
 *   "Sample Back","NYG","RB","Drop","#23 Team B","","Sat Nov 21, 2026, 6:07AM","11"
 *
 * ⚠ TWO COLUMNS ARE NAMED "Team". The first is the player's pro club, the second is the fantasy team. They
 * are read by POSITION relative to `Type`, never by name: a lookup by name finds the first one twice.
 *
 * ⚠ NO PLAYER ID. A row names the player, his club and his position, and is matched the way a row of the
 * Trade export is (`fantraxTradeHistoryPlan.ts`).
 *
 * Pure: no database, no clock.
 */
import { createHash } from 'node:crypto'
import { parseFantraxEasternDate, readCsvRows, type FantraxCsvSkip } from './fantraxTradeHistoryCsv'

export type FantraxCsvClaimDrop = {
  /** Stable across re-reads of the same export: the same move always gets the same id. 40 chars. */
  id: string
  kind: 'claim' | 'drop'
  playerName: string
  proTeam: string | null
  position: string | null
  /** The fantasy team's label exactly as exported, e.g. "#5 Team A". */
  team: string
  /** The winning bid. Null when the export left it blank: a drop, or a pickup that needed no bid. */
  bid: number | null
  /** The `Date (EST)` text exactly as exported. */
  dateText: string
  date: Date
  /** The `Week` column as exported, or null when it is not a whole number. */
  week: number | null
}

export type FantraxClaimDropParseResult =
  | { ok: true; moves: FantraxCsvClaimDrop[]; skipped: FantraxCsvSkip[] }
  | { ok: false; error: string }

export const WRONG_CLAIM_DROP_EXPORT_ERROR =
  'This looks like the Trades export, not Claims/Drops. On Fantrax, open Transactions → History, choose Claim/Drop and download that CSV.'

const HEADER = ['Player', 'Team', 'Position', 'Type', 'Team', 'Bid', 'Date (EST)', 'Week'] as const

export function parseFantraxClaimDropCsv(text: string): FantraxClaimDropParseResult {
  const rows = readCsvRows(String(text ?? ''))
  if (!rows.length) return { ok: false, error: 'The file is empty.' }
  const header = rows[0].cells.map((h) => h.trim())
  if (header.includes('From') && header.includes('To')) return { ok: false, error: WRONG_CLAIM_DROP_EXPORT_ERROR }
  if (header.length < HEADER.length || HEADER.some((name, i) => header[i] !== name)) {
    return { ok: false, error: `This is not a Fantrax claim/drop history export. Expected the columns: ${HEADER.join(', ')}.` }
  }

  const moves: FantraxCsvClaimDrop[] = []
  const skipped: FantraxCsvSkip[] = []
  /* Two identical rows are two moves (the same player claimed twice at one instant does not happen, but a
     repeated row must not collapse silently): the second gets its own id. */
  const seen = new Map<string, number>()
  for (const { line, cells } of rows.slice(1)) {
    const cell = (i: number) => String(cells[i] ?? '').trim()
    const playerName = cell(0)
    const type = cell(3).toLowerCase()
    const team = cell(4)
    const dateText = cell(6)
    if (!playerName) { skipped.push({ line, reason: 'The Player column is empty.' }); continue }
    if (type !== 'claim' && type !== 'drop') { skipped.push({ line, reason: `"${cell(3)}" is not a Claim or a Drop.` }); continue }
    if (!team) { skipped.push({ line, reason: 'The fantasy team column is empty.' }); continue }
    const date = parseFantraxEasternDate(dateText)
    if (!date) { skipped.push({ line, reason: `"${dateText}" is not a date this reader knows.` }); continue }
    const bidText = cell(5).replace(/[$,]/g, '')
    const bid = bidText === '' || bidText === '-' ? null : Number(bidText)
    if (bid !== null && (!Number.isFinite(bid) || bid < 0)) { skipped.push({ line, reason: `"${cell(5)}" is not a usable bid.` }); continue }
    const weekNumber = Number(cell(7))
    const key = [type, playerName, cell(1), cell(2), team, dateText, bid ?? ''].join('|')
    const occurrence = seen.get(key) ?? 0
    seen.set(key, occurrence + 1)
    moves.push({
      id: createHash('sha256').update(`${key}|${occurrence}`).digest('hex').slice(0, 40),
      kind: type,
      playerName,
      proTeam: cell(1) || null,
      position: cell(2) || null,
      team,
      bid,
      dateText,
      date,
      week: cell(7) !== '' && Number.isInteger(weekNumber) && weekNumber >= 0 ? weekNumber : null,
    })
  }
  if (!moves.length && !skipped.length) return { ok: false, error: 'The file has a header and no rows.' }
  return { ok: true, moves, skipped }
}
