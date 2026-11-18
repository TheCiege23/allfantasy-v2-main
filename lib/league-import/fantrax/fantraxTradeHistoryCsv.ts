/**
 * Reads Fantrax's "Transaction History → Trade" CSV export into trades.
 *
 * The export is one row per ASSET MOVED, not one row per trade:
 *
 *   "Player","Team","Position","From","To","# Obj","Date (EST)","Week"
 *   "Sample Player","NYG","QB","#4 Team A","#12 Team B","0","Sun Oct 4, 2026, 1:00PM","5"
 *   "2027 Draft Pick, Round 1 (#12 Team B)","","","#12 Team B","#4 Team A","0","Sun Oct 4, 2026, 1:00PM","5"
 *   "Budget Amount: $25.00","","","#12 Team B","#4 Team A","0","Sun Oct 4, 2026, 1:00PM","5"
 *
 * So a trade is rebuilt from rows sharing the exact `Date (EST)` minute AND connected by the teams they move between
 * — two unrelated trades accepted in the same minute stay two trades.
 *
 * ⚠ THE WEEK COLUMN IS NOT RELIABLE. In a real export two trades accepted the same afternoon carry weeks 10 and 11.
 * It is kept (the smallest in the trade) because LeagueTrade.week is required, but nothing should rank by it; the
 * trade's date is the fact.
 *
 * 🛑 TEAM LABELS ARE KEPT EXACTLY AS WRITTEN — "#4 Team A" stays "#4 Team A". This reader first stripped the "#N "
 * as a standings number, and on the first real league (2026-11-18) the number was PART OF THE TEAM NAME: the league
 * stores "#27 Harbor Owls", so every stripped label missed and an upload of five trades added none. Which reading
 * holds differs by league, so the reader does not choose; the planner matches the exact name first and the
 * prefix-stripped name only as a fallback (`fantraxTradeHistoryPlan.ts`).
 *
 * Nothing is dropped silently: a row that cannot be read is returned in `skipped` with the reason.
 *
 * Pure (no I/O).
 */
import { createHash } from 'node:crypto'

export type FantraxCsvAsset =
  | { kind: 'player'; name: string; proTeam: string | null; position: string | null }
  | { kind: 'pick'; season: number; round: number; originalOwner: string }
  | { kind: 'budget'; amount: number }

export type FantraxCsvMove = { asset: FantraxCsvAsset; from: string; to: string }

export type FantraxCsvTrade = {
  /** Stable across re-uploads of the same export: the same trade always gets the same id. ≤ 64 chars. */
  transactionId: string
  /** The `Date (EST)` text exactly as exported. */
  dateText: string
  /** That time in UTC (US Eastern, daylight saving applied). */
  tradeDate: Date
  week: number | null
  /** Every team in the trade, in order of first appearance. */
  teams: string[]
  moves: FantraxCsvMove[]
}

export type FantraxCsvSkip = { line: number; reason: string }

export type FantraxCsvParseResult =
  | { ok: true; trades: FantraxCsvTrade[]; skipped: FantraxCsvSkip[] }
  | { ok: false; error: string }

const REQUIRED_HEADERS = ['Player', 'Team', 'Position', 'From', 'To', 'Date (EST)'] as const
const PICK = /^(\d{4}) Draft Pick, Round (\d+) \((.+)\)$/
const BUDGET = /^Budget Amount: \$([\d,]+(?:\.\d+)?)$/
const DATE = /^(?:[A-Za-z]{3} )?([A-Za-z]{3}) (\d{1,2}), (\d{4}), (\d{1,2}):(\d{2})\s*([AP]M)$/i
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** RFC 4180: quoted fields, "" as an escaped quote, commas and newlines inside quotes. Returns rows with their line. */
export function readCsvRows(text: string): Array<{ line: number; cells: string[] }> {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const rows: Array<{ line: number; cells: string[] }> = []
  let cells: string[] = []
  let cell = ''
  let quoted = false
  let line = 1
  let rowLine = 1
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++ }
      else if (c === '"') quoted = false
      else { if (c === '\n') line++; cell += c }
      continue
    }
    if (c === '"') quoted = true
    else if (c === ',') { cells.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      cells.push(cell)
      if (cells.some((v) => v.trim() !== '')) rows.push({ line: rowLine, cells })
      cells = []; cell = ''
      line++; rowLine = line
    } else cell += c
  }
  cells.push(cell)
  if (cells.some((v) => v.trim() !== '')) rows.push({ line: rowLine, cells })
  return rows
}

/** "#4 Team A" → "Team A". A label without the prefix is returned trimmed. */
export function stripFantraxStandingPrefix(label: string): string {
  return String(label ?? '').trim().replace(/^#\d+\s+/, '').trim()
}

/** Minutes east of UTC for US Eastern at an instant: -300 (EST) or -240 (EDT). */
function easternOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(at)
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  const asUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'))
  return Math.round((asUtc - at.getTime()) / 60_000)
}

/** "Sun Oct 4, 2026, 1:00PM" (US Eastern wall clock) → the UTC instant, or null when it is not that shape. */
export function parseFantraxEasternDate(text: string): Date | null {
  const m = DATE.exec(String(text ?? '').trim())
  if (!m) return null
  const month = MONTHS.indexOf(m[1].toLowerCase())
  const day = Number(m[2])
  const year = Number(m[3])
  let hour = Number(m[4])
  const minute = Number(m[5])
  if (month < 0 || day < 1 || day > 31 || hour < 1 || hour > 12 || minute > 59) return null
  if (m[6].toUpperCase() === 'PM' && hour !== 12) hour += 12
  if (m[6].toUpperCase() === 'AM' && hour === 12) hour = 0
  const wall = Date.UTC(year, month, day, hour, minute)
  if (new Date(wall).getUTCDate() !== day) return null // Feb 30 and friends
  // Two passes settle the offset on either side of a daylight-saving change.
  let guess = wall - easternOffsetMinutes(new Date(wall)) * 60_000
  guess = wall - easternOffsetMinutes(new Date(guess)) * 60_000
  return new Date(guess)
}

function readAsset(player: string, proTeam: string, position: string): FantraxCsvAsset | string {
  const text = player.trim()
  if (!text) return 'The Player column is empty.'
  const pick = PICK.exec(text)
  if (pick) {
    const round = Number(pick[2])
    if (round < 1) return `"${text}" has no usable round.`
    return { kind: 'pick', season: Number(pick[1]), round, originalOwner: pick[3].trim() }
  }
  const budget = BUDGET.exec(text)
  if (budget) {
    const amount = Number(budget[1].replace(/,/g, ''))
    if (!Number.isFinite(amount) || amount < 0) return `"${text}" is not a usable amount.`
    return { kind: 'budget', amount }
  }
  if (/draft pick/i.test(text) || /budget/i.test(text)) return `"${text}" looks like a pick or budget line in a shape this reader does not know.`
  return { kind: 'player', name: text, proTeam: proTeam.trim() || null, position: position.trim() || null }
}

function canonicalMove(m: FantraxCsvMove): string {
  const a = m.asset
  const what = a.kind === 'player' ? `p|${a.name}|${a.proTeam ?? ''}|${a.position ?? ''}` : a.kind === 'pick' ? `k|${a.season}|${a.round}|${a.originalOwner}` : `b|${a.amount.toFixed(2)}`
  return `${what}|${m.from}|${m.to}`
}

export function parseFantraxTradeHistoryCsv(text: string): FantraxCsvParseResult {
  const rows = readCsvRows(String(text ?? ''))
  if (!rows.length) return { ok: false, error: 'The file is empty.' }
  const header = rows[0].cells.map((h) => h.trim())
  const col: Record<string, number> = {}
  for (const name of [...REQUIRED_HEADERS, 'Week']) col[name] = header.indexOf(name)
  const missing = REQUIRED_HEADERS.filter((h) => col[h] < 0)
  if (missing.length) {
    return { ok: false, error: `This is not a Fantrax trade history export — missing column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.` }
  }

  type Row = { line: number; dateText: string; date: Date; week: number | null; move: FantraxCsvMove }
  const skipped: FantraxCsvSkip[] = []
  const good: Row[] = []
  for (const { line, cells } of rows.slice(1)) {
    const get = (name: string) => (col[name] >= 0 ? String(cells[col[name]] ?? '') : '')
    const from = get('From').trim()
    const to = get('To').trim()
    if (!from || !to) { skipped.push({ line, reason: 'From or To is empty.' }); continue }
    if (from === to) { skipped.push({ line, reason: 'From and To are the same team.' }); continue }
    const dateText = get('Date (EST)').trim()
    const date = parseFantraxEasternDate(dateText)
    if (!date) { skipped.push({ line, reason: `"${dateText}" is not a date this reader understands.` }); continue }
    const asset = readAsset(get('Player'), get('Team'), get('Position'))
    if (typeof asset === 'string') { skipped.push({ line, reason: asset }); continue }
    const weekNum = Number(get('Week').trim())
    good.push({ line, dateText, date, week: get('Week').trim() && Number.isInteger(weekNum) && weekNum >= 0 ? weekNum : null, move: { asset, from, to } })
  }

  // Same minute, then connected by the teams involved (union-find over team labels).
  const byMinute = new Map<string, Row[]>()
  for (const r of good) {
    const k = r.dateText
    const list = byMinute.get(k) ?? []
    list.push(r)
    byMinute.set(k, list)
  }
  const trades: FantraxCsvTrade[] = []
  for (const [dateText, list] of byMinute) {
    const parent = new Map<string, string>()
    const find = (x: string): string => {
      let p = parent.get(x) ?? x
      while (p !== (parent.get(p) ?? p)) p = parent.get(p) ?? p
      parent.set(x, p)
      return p
    }
    for (const r of list) {
      const a = find(r.move.from)
      const b = find(r.move.to)
      if (a !== b) parent.set(a, b)
    }
    const groups = new Map<string, Row[]>()
    for (const r of list) {
      const root = find(r.move.from)
      const g = groups.get(root) ?? []
      g.push(r)
      groups.set(root, g)
    }
    for (const g of groups.values()) {
      const teams: string[] = []
      for (const r of g) for (const t of [r.move.from, r.move.to]) if (!teams.includes(t)) teams.push(t)
      const weeks = g.map((r) => r.week).filter((w): w is number => w != null)
      const canon = g.map((r) => canonicalMove(r.move)).sort().join('\n')
      const hash = createHash('sha256').update(`${dateText}\n${canon}`).digest('hex').slice(0, 24)
      trades.push({
        transactionId: `fantrax-csv:${hash}`,
        dateText,
        tradeDate: g[0].date,
        week: weeks.length ? Math.min(...weeks) : null,
        teams,
        moves: g.map((r) => r.move),
      })
    }
  }
  trades.sort((a, b) => b.tradeDate.getTime() - a.tradeDate.getTime() || a.transactionId.localeCompare(b.transactionId))
  return { ok: true, trades, skipped }
}

/** One team's side of a trade: what it received and what it gave. */
export function fantraxCsvTradeSide(trade: FantraxCsvTrade, team: string): { received: FantraxCsvAsset[]; gave: FantraxCsvAsset[] } {
  return {
    received: trade.moves.filter((m) => m.to === team).map((m) => m.asset),
    gave: trade.moves.filter((m) => m.from === team).map((m) => m.asset),
  }
}
