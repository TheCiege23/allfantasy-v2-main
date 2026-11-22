import type { LearnedMarketReport, ReportRow } from '@/lib/trade-market/learnedMarketReport'
import type { TradeMarketGroup, TradeMarketRow } from './demoTenant'

/**
 * THE PARTNER PANEL ON REAL NUMBERS (owner's call, 2026-11-22: "tie the panel into real numbers, use my leagues").
 *
 * "What your managers actually pay in trades" was sample data. This turns the stored learned market — measured daily
 * from completed trades across every AllFantasy-connected league, the owner's included (`learnedMarketReport.ts`) —
 * into the panel's rows: the same numbers `/admin/trade-market` shows and the grades use, nothing invented.
 *
 * One book per group (the one with the most published rows; dynasty superflex wins a tie, as the most traded), at most
 * MAX_PER_GROUP rows each, published first. A row that is not published yet stays, with how many trades it has — "not
 * enough yet" is part of what the panel shows. No published row anywhere → null, and the page keeps the sample.
 *
 * PURE. Counts and percentages only: no league, manager or player name reaches a partner.
 */

export const MAX_PER_GROUP = 3
const BOOK_ORDER = ['DYNASTY:SUPERFLEX', 'DYNASTY:ONE_QB', 'REDRAFT:SUPERFLEX', 'REDRAFT:ONE_QB']

/** "not enough trades yet (9 of 30)" → 30. */
const neededOf = (note: string): number | undefined => {
  const m = /of (\d+)\)/.exec(note) ?? /need (\d+)/.exec(note)
  return m ? Number(m[1]) : undefined
}

function pickLabel(label: string): string {
  // "1st · Next draft" → "Next draft, 1st round"
  const [round, horizon] = label.split(' · ')
  return horizon ? `${horizon}, ${round} round` : label
}

function needLabel(label: string): string | null {
  // "TE · short (an open slot)" → "Teams with an open TE slot"; other need levels are measured, not applied — left out.
  const m = /^([A-Z]+) · short \(an open slot\)$/.exec(label)
  return m ? `Teams with an open ${m[1]} slot` : null
}

function postureLabel(label: string): string {
  return label
    .replace('Contenders (.600+) buying', 'Contenders buying')
    .replace('Rebuilders (.400−) buying', 'Rebuilding teams buying')
    .replace(' (27+)', '')
    .replace(' (24−)', '')
    .replace('youth', 'young players')
}

function bestBook<T extends { book: string; rows: ReportRow[] }>(books: readonly T[]): T | null {
  if (!books.length) return null
  return [...books].sort((a, b) => {
    const pa = a.rows.filter((r) => r.published).length
    const pb = b.rows.filter((r) => r.published).length
    if (pa !== pb) return pb - pa
    const rank = (book: string) => (BOOK_ORDER.includes(book) ? BOOK_ORDER.indexOf(book) : BOOK_ORDER.length)
    return rank(a.book) - rank(b.book)
  })[0]!
}

export function realTradeMarketRows(report: LearnedMarketReport | null | undefined): TradeMarketRow[] | null {
  if (!report) return null
  const out: TradeMarketRow[] = []
  const add = (group: TradeMarketGroup, rows: Array<{ label: string; r: ReportRow }>) => {
    const ordered = [...rows].sort((a, b) => Number(b.r.published) - Number(a.r.published) || b.r.trades - a.r.trades).slice(0, MAX_PER_GROUP)
    for (const { label, r } of ordered) {
      out.push({
        group,
        label,
        premiumPct: r.published && r.pct != null ? Math.round(r.pct) : null,
        trades: r.trades,
        ...(r.published ? {} : { needed: neededOf(r.note) }),
      })
    }
  }
  for (const section of report.sections) {
    // A table the grades would ignore (too old) is not shown as the live market either.
    if (section.status.missing || section.status.stale) continue
    const book = bestBook(section.books)
    if (!book) continue
    if (section.key === 'picks') add('Draft picks', book.rows.map((r) => ({ label: pickLabel(r.label), r })))
    if (section.key === 'posture') add('Team situation', book.rows.map((r) => ({ label: postureLabel(r.label), r })))
    if (section.key === 'need') add('Roster need', book.rows.flatMap((r) => { const l = needLabel(r.label); return l ? [{ label: l, r }] : [] }))
  }
  return out.some((r) => r.premiumPct != null) ? out : null
}
