/**
 * Draft-pick trades read from Fantrax's trade-history CSV export.
 *
 * 🛑 WHY A CSV, WHEN THERE IS AN API. Fantrax's `getDraftPicks` publishes future
 * picks for rounds 1-4 only. Measured 2026-11-18 on a 34-team dynasty league:
 * 1,360 rows, ten seasons, every one in rounds 1 to 4 — while that league's own
 * trade history shows a 2029 Round 5 pick changing hands. A later-round pick
 * trade is visible ONLY in the export of Transactions > History > Trades.
 *
 * The export, verbatim (header and two rows):
 *
 *     "Player","Team","Position","From","To","# Obj","Date (EST)","Week"
 *     "2029 Draft Pick, Round 5 (#18 Miami Dolphins)","","","#18 Miami Dolphins","#9 New York Jets","0","Mon Nov 16, 2026, 4:26PM","11"
 *     "Budget Amount: $5000.00","","","#27 Houston Oilers","#9 New York Jets","0","Mon Nov 16, 2026, 7:57PM","10"
 *
 * ⚠ A PICK ROW NAMES THREE TEAMS, AND THEY ARE NOT ALWAYS THE SAME TWO. The team
 * in parentheses is whose pick it ORIGINALLY was; From and To are who traded it
 * this time. A pick that has already moved once is sent by a team that is not its
 * original owner, so the original team is read from the parentheses, never from
 * the From column.
 *
 * ⚠ AN EXPORT IS A POINT IN TIME. It knows nothing about a trade made after it
 * was downloaded. That is why the API wins wherever it covers a pick, and why
 * this is used only for the rounds the API does not publish.
 */

export type FantraxCsvPickTrade = {
  season: number
  round: number
  /** Team name exactly as Fantrax prints it, e.g. "#18 Miami Dolphins". */
  originalTeam: string
  fromTeam: string
  toTeam: string
  /** Sortable wall-clock time, `YYYY-MM-DDTHH:mm`, in the export's own zone (EST). Null if unreadable. */
  tradedAt: string | null
  /** Position in the file, so two trades with an unreadable or equal time keep a stable order. */
  fileOrder: number
}

export type FantraxTradeCsvResult = {
  pickTrades: FantraxCsvPickTrade[]
  /** Data rows in the file, of any kind. */
  rows: number
  /** Rows that say "Draft Pick" but could not be read as one. Reported, never guessed. */
  unreadablePickRows: number
  /** False when the header is not the trade export's — the caller should refuse the file. */
  recognised: boolean
}

/** One CSV line into cells. Handles quoted cells and `""` as an escaped quote. */
function splitCsvLine(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        quoted = !quoted
      }
    } else if (char === ',' && !quoted) {
      cells.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  cells.push(current.trim())
  return cells
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

/**
 * "Mon Nov 16, 2026, 7:57PM" -> "2026-11-16T19:57".
 *
 * ⚠ PARSED BY HAND, NOT WITH `new Date()`. That string has no space before the
 * meridiem, which is not a format every JS engine accepts, and a date that parses
 * on one machine and is Invalid on another would silently reorder the trades.
 */
export function parseFantraxExportDate(value: string): string | null {
  const m = value.match(/([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{4}),?\s*(\d{1,2}):(\d{2})\s*([AaPp][Mm])/)
  if (!m) return null
  const month = MONTHS[m[1]!.toLowerCase()]
  if (!month) return null
  let hour = Number(m[4]) % 12
  if (m[6]!.toLowerCase() === 'pm') hour += 12
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${m[3]}-${pad(month)}-${pad(Number(m[2]))}T${pad(hour)}:${m[5]}`
}

/** "2029 Draft Pick, Round 5 (#18 Miami Dolphins)" -> its three parts. */
export function parseFantraxPickLabel(
  label: string,
): { season: number; round: number; originalTeam: string } | null {
  const m = label.match(/^\s*(\d{4})\s+Draft Pick,\s*Round\s+(\d+)\s*\((.+)\)\s*$/i)
  if (!m) return null
  const season = Number(m[1])
  const round = Number(m[2])
  const originalTeam = m[3]!.trim()
  if (!Number.isFinite(season) || !(round > 0) || !originalTeam) return null
  return { season, round, originalTeam }
}

/**
 * Read the pick trades out of a trade-history export.
 *
 * Columns are found BY NAME from the header, not by position: the export carries
 * a "# Obj" column between To and Date that an older reader in this repo did not
 * know about, which shifted every later column by one.
 */
export function parseFantraxTradeCsv(csv: string): FantraxTradeCsvResult {
  const lines = String(csv ?? '')
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim())
  const empty: FantraxTradeCsvResult = { pickTrades: [], rows: 0, unreadablePickRows: 0, recognised: false }
  if (lines.length === 0) return empty

  const header = splitCsvLine(lines[0]!).map((cell) => cell.toLowerCase())
  const column = (name: string) => header.findIndex((cell) => cell === name || cell.startsWith(name))
  const playerCol = column('player')
  const fromCol = column('from')
  const toCol = column('to')
  const dateCol = column('date')
  if (playerCol < 0 || fromCol < 0 || toCol < 0) return empty

  const pickTrades: FantraxCsvPickTrade[] = []
  let unreadablePickRows = 0
  let rows = 0
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]!)
    rows++
    const label = cells[playerCol] ?? ''
    if (!/draft pick/i.test(label)) continue
    const pick = parseFantraxPickLabel(label)
    const fromTeam = (cells[fromCol] ?? '').trim()
    const toTeam = (cells[toCol] ?? '').trim()
    if (!pick || !fromTeam || !toTeam) {
      unreadablePickRows++
      continue
    }
    pickTrades.push({
      ...pick,
      fromTeam,
      toTeam,
      tradedAt: dateCol >= 0 ? parseFantraxExportDate(cells[dateCol] ?? '') : null,
      fileOrder: i,
    })
  }
  return { pickTrades, rows, unreadablePickRows, recognised: true }
}

/* ------------------------------------------------------------------ *
 * Storage — kept on `FantraxLeague.transactions` under its own key.
 * ------------------------------------------------------------------ */

const keyOf = (t: FantraxCsvPickTrade) =>
  [t.season, t.round, t.originalTeam, t.fromTeam, t.toTeam, t.tradedAt ?? `#${t.fileOrder}`].join('\u0000')

/**
 * Add an upload's pick trades to what is already stored.
 *
 * ⚠ MERGED, NOT REPLACED. An export can be filtered to a date range, so a second
 * upload may be a different slice of history rather than a newer copy of the same
 * one. The same trade arriving twice is kept once.
 */
export function mergeFantraxPickTrades(
  existing: FantraxCsvPickTrade[],
  incoming: FantraxCsvPickTrade[],
): FantraxCsvPickTrade[] {
  const merged = new Map<string, FantraxCsvPickTrade>()
  for (const trade of [...existing, ...incoming]) merged.set(keyOf(trade), trade)
  return [...merged.values()]
}

/** Read stored pick trades back out of a `transactions` JSON value, trusting nothing. */
export function readStoredFantraxPickTrades(transactions: unknown): FantraxCsvPickTrade[] {
  if (transactions === null || typeof transactions !== 'object' || Array.isArray(transactions)) return []
  const raw = (transactions as Record<string, unknown>).pickTrades
  if (!Array.isArray(raw)) return []
  const out: FantraxCsvPickTrade[] = []
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object') continue
    const row = entry as Record<string, unknown>
    const season = Number(row.season)
    const round = Number(row.round)
    const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
    const originalTeam = text(row.originalTeam)
    const fromTeam = text(row.fromTeam)
    const toTeam = text(row.toTeam)
    if (!Number.isFinite(season) || !(round > 0) || !originalTeam || !fromTeam || !toTeam) continue
    out.push({
      season,
      round,
      originalTeam,
      fromTeam,
      toTeam,
      tradedAt: text(row.tradedAt) || null,
      fileOrder: Number.isFinite(Number(row.fileOrder)) ? Number(row.fileOrder) : 0,
    })
  }
  return out
}

/* ------------------------------------------------------------------ *
 * Ownership
 * ------------------------------------------------------------------ */

export type FantraxCsvPickOwnership = {
  season: number
  round: number
  originalTeam: string
  /** Who holds it after every trade in the export has been applied, oldest first. */
  currentTeam: string
}

/**
 * Who holds each traded pick now, by replaying the trades in order.
 *
 * ⚠ THE LAST TRADE WINS, NOT THE LAST ROW. Fantrax exports newest first, so the
 * rows are sorted by their own timestamp before being applied; a pick traded
 * A -> B and then B -> C must end on C whichever way the file happens to be
 * ordered. Rows with no readable time keep their file order, reversed, on the
 * same newest-first assumption.
 *
 * A pick that ends back with its original team is returned too, with
 * `currentTeam === originalTeam` — that is the traded-back case, and the caller
 * needs it to clear a stale row.
 */
export function resolveFantraxCsvPickOwnership(trades: FantraxCsvPickTrade[]): FantraxCsvPickOwnership[] {
  const ordered = [...trades].sort((a, b) => {
    if (a.tradedAt && b.tradedAt && a.tradedAt !== b.tradedAt) return a.tradedAt < b.tradedAt ? -1 : 1
    if (a.tradedAt && !b.tradedAt) return 1
    if (!a.tradedAt && b.tradedAt) return -1
    return b.fileOrder - a.fileOrder
  })
  const holders = new Map<string, FantraxCsvPickOwnership>()
  for (const trade of ordered) {
    const key = [trade.season, trade.round, trade.originalTeam].join('\u0000')
    holders.set(key, {
      season: trade.season,
      round: trade.round,
      originalTeam: trade.originalTeam,
      currentTeam: trade.toTeam,
    })
  }
  return [...holders.values()]
}
