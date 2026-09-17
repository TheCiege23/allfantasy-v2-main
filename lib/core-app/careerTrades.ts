/**
 * Career trades — the trade half of the timeline and the record book.
 *
 * ⚠ PURE HELPERS AT THE TOP, THE READ BELOW. `tradeAssetCount` is imported by
 * the stored profile and by tests; the loader needs prisma and is only reached
 * from server code.
 *
 * ── What a trade can honestly say ───────────────────────────────────────────
 *
 * ⚠ NO TRADE HERE CARRIES A VALUE. Measured 2026-09-16 on the production copy:
 * 17,033 `LeagueTrade` rows, and `valueGiven`, `valueReceived`,
 * `valueDifferential` and `partnerName` are null on every one; `analyzed` is
 * false on every one. So "biggest trade" is the most players and picks moved in
 * one deal — a size, which the row does record — and never a value win. Pricing
 * a 2021 trade with today's values would grade it on things nobody knew then.
 */

type Json = unknown

function arr(v: Json): unknown[] {
  return Array.isArray(v) ? v : []
}

/** Players plus picks, both directions. */
export function tradeAssetCount(t: {
  playersGiven: Json
  playersReceived: Json
  picksGiven: Json
  picksReceived: Json
}): number {
  return arr(t.playersGiven).length + arr(t.playersReceived).length + arr(t.picksGiven).length + arr(t.picksReceived).length
}

/** "2024 R1" — a Sleeper traded-pick entry as stored on `LeagueTrade`. */
export function pickLabel(p: unknown): string | null {
  if (!p || typeof p !== 'object') return null
  const o = p as { season?: unknown; round?: unknown }
  const round = Number(o.round)
  if (!Number.isFinite(round) || round <= 0) return null
  const season = o.season != null ? String(o.season) : ''
  return `${season ? `${season} ` : ''}R${round}`
}

export function playerIds(v: Json): string[] {
  return arr(v)
    .map((x) => (typeof x === 'string' || typeof x === 'number' ? String(x) : null))
    .filter((x): x is string => !!x)
}

export type CareerTradeEvent = {
  id: string
  season: number
  week: number
  /** ISO. Every stored trade carries one (17,033 of 17,033). */
  date: string | null
  leagueName: string | null
  leagueKey: string | null
  gave: string[]
  got: string[]
  assets: number
  /** Only graded trades know the other side. */
  partner: string | null
  /** Net points while held — graded trades only. */
  net: number | null
  /** Current letter — graded trades only, and never shown without `net`. */
  grade: string | null
}

/** "Ja'Marr Chase, 2025 R1" — names first, unresolved ids last as "1 player". */
export function describeSide(names: string[], unresolved: number): string {
  const bits = [...names]
  if (unresolved > 0) bits.push(`${unresolved} more ${unresolved === 1 ? 'player' : 'players'}`)
  return bits.length ? bits.join(', ') : 'nothing listed'
}
