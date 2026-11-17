/**
 * The trade audit — pure. A commissioner's answer to "those two are colluding": every trade a team
 * made, what each side sent, what it was worth WHEN IT HAPPENED, and whether that sits inside the
 * range the trade review calls fair. No IO, so every line a commissioner posts can be reproduced.
 *
 * ⚠ ONE SCALE, THE REVIEW'S. The bands are the trade review's own (`lib/decision-os/trade/tradeReview.ts`
 * `LOPSIDED_GAP_PCT` and `lib/trade-intel/gradeScale.ts` `PROJECTED_EVEN_BAND`): under 10% is even, 10–40%
 * is worth a look, over 40% is what the review itself raises as lopsided. A second set of thresholds
 * here would let the audit and the review disagree about the same trade.
 *
 * ⚠ AND ONE TRADE IS NEVER A PATTERN. Two managers who like each other's rosters trade a lot; that
 * is a league working. `pairFrequency` names a pair only when it traded with each other well above
 * what the league's own trade volume would predict, AND at least three times.
 */

import { PROJECTED_EVEN_BAND } from '@/lib/trade-intel/gradeScale'

/** The trade review's lopsided line. Mirrors `LOPSIDED_GAP_PCT` in tradeReview.ts (asserted in tests). */
export const AUDIT_OUTSIDE_PCT = 40

export type FairnessBand = 'fair' | 'watch' | 'outside'

export function fairnessBand(gapPct: number): FairnessBand {
  const gap = Math.abs(gapPct)
  if (gap < PROJECTED_EVEN_BAND) return 'fair'
  if (gap <= AUDIT_OUTSIDE_PCT) return 'watch'
  return 'outside'
}

export type AuditBasis = 'at_completion' | 'trade_date' | 'first_audited'

export function basisLabel(basis: string): string {
  if (basis === 'at_completion') return 'priced when the trade went through'
  if (basis === 'trade_date') return 'priced on the trade date'
  return 'priced when first audited — no value from the trade date was on record'
}

export type AuditRow = {
  tradeKey: string
  sideATeamId: string
  sideBTeamId: string
  sideAName: string
  sideBName: string
  sideAGave: string[]
  sideBGave: string[]
  /** League value of what each side SENT. */
  sideAValue: number
  sideBValue: number
  /** Signed from side A: + means side A received more. */
  gapPct: number
  basis: string
  completedAt: string | null
}

/** One trade from a chosen team's point of view. */
type TeamTradeLine = {
  tradeKey: string
  completedAt: string | null
  partnerTeamId: string
  partnerName: string
  sent: string[]
  received: string[]
  sentValue: number
  receivedValue: number
  /** + means this team received more. */
  gapPct: number
  band: FairnessBand
  basis: string
}

export function teamTradeLines(rows: readonly AuditRow[], teamId: string): TeamTradeLine[] {
  const out: TeamTradeLine[] = []
  for (const r of rows) {
    const isA = r.sideATeamId === teamId
    if (!isA && r.sideBTeamId !== teamId) continue
    const gap = isA ? r.gapPct : -r.gapPct
    out.push({
      tradeKey: r.tradeKey,
      completedAt: r.completedAt,
      partnerTeamId: isA ? r.sideBTeamId : r.sideATeamId,
      partnerName: isA ? r.sideBName : r.sideAName,
      sent: isA ? r.sideAGave : r.sideBGave,
      received: isA ? r.sideBGave : r.sideAGave,
      sentValue: isA ? r.sideAValue : r.sideBValue,
      receivedValue: isA ? r.sideBValue : r.sideAValue,
      gapPct: gap,
      band: fairnessBand(gap),
      basis: r.basis,
    })
  }
  return out.sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
}

/** Every team that appears in the audit, by name, for the team picker. */
export function auditTeams(rows: readonly AuditRow[]): { teamId: string; name: string; trades: number }[] {
  const byId = new Map<string, { teamId: string; name: string; trades: number }>()
  for (const r of rows) {
    for (const [id, name] of [
      [r.sideATeamId, r.sideAName],
      [r.sideBTeamId, r.sideBName],
    ] as const) {
      const t = byId.get(id) ?? { teamId: id, name, trades: 0 }
      t.trades += 1
      byId.set(id, t)
    }
  }
  return [...byId.values()].sort((a, b) => b.trades - a.trades || a.name.localeCompare(b.name))
}

/** The minimum trades between one pair before frequency means anything. */
const PAIR_MIN_TRADES = 3
/** How many times the league's expected count a pair must reach. */
const PAIR_MULTIPLE = 3

export type PairFinding = {
  teamIds: [string, string]
  names: [string, string]
  count: number
  /** What an even spread of the league's trades would give one pair. */
  expected: number
  /** Of this pair's trades, how many fell outside the fair range — and which way the value went. */
  outside: number
  /** Net value received by the first team across the pair's trades, as a share of everything exchanged. */
  netShareToFirst: number
}

/**
 * Pairs that traded with each other far more than the league's volume predicts. `teamCount` is the
 * league's team count; the expected count per pair is total trades ÷ the number of possible pairs.
 */
/** "about 2", or "fewer than one" — a decimal of a trade reads as noise. */
export function expectedLabel(expected: number): string {
  return expected < 1 ? 'fewer than one' : `about ${Math.round(expected * 10) / 10}`
}

export function pairFrequency(rows: readonly AuditRow[], teamCount: number): PairFinding[] {
  const pairs = teamCount >= 2 ? (teamCount * (teamCount - 1)) / 2 : 1
  const expected = rows.length / pairs
  const groups = new Map<string, AuditRow[]>()
  for (const r of rows) {
    const key = [r.sideATeamId, r.sideBTeamId].sort().join('|')
    groups.set(key, [...(groups.get(key) ?? []), r])
  }
  const out: PairFinding[] = []
  for (const [key, list] of groups) {
    if (list.length < PAIR_MIN_TRADES || list.length < expected * PAIR_MULTIPLE) continue
    const [first, second] = key.split('|') as [string, string]
    const nameOf = (id: string) => {
      const r = list.find((x) => x.sideATeamId === id || x.sideBTeamId === id)!
      return r.sideATeamId === id ? r.sideAName : r.sideBName
    }
    let toFirst = 0
    let total = 0
    for (const r of list) {
      const firstIsA = r.sideATeamId === first
      const firstReceived = firstIsA ? r.sideBValue : r.sideAValue
      const firstSent = firstIsA ? r.sideAValue : r.sideBValue
      toFirst += firstReceived - firstSent
      total += r.sideAValue + r.sideBValue
    }
    out.push({
      teamIds: [first, second],
      names: [nameOf(first), nameOf(second)],
      count: list.length,
      expected: Math.round(expected * 10) / 10,
      outside: list.filter((r) => fairnessBand(r.gapPct) === 'outside').length,
      netShareToFirst: total > 0 ? toFirst / total : 0,
    })
  }
  return out.sort((a, b) => b.count - a.count)
}

const fmt = (n: number) => Math.round(n).toLocaleString('en-US')
const bandWord: Record<FairnessBand, string> = { fair: 'within the fair range', watch: 'worth a look', outside: 'outside the fair range' }

/** The "Trade history review" a commissioner posts to the league. */
export function buildTradeReviewText(input: { teamName: string; lines: readonly TeamTradeLine[] }): string {
  const out = [`Trade history review — ${input.teamName}`]
  if (input.lines.length === 0) {
    out.push('No completed trades on record.')
    return out.join('\n')
  }
  for (const l of input.lines) {
    const date = l.completedAt ? l.completedAt.slice(0, 10) : 'date unknown'
    const sent = l.sent.length ? l.sent.join(', ') : 'nothing'
    const received = l.received.length ? l.received.join(', ') : 'nothing'
    out.push(
      `${date} with ${l.partnerName}: sent ${sent} (${fmt(l.sentValue)}) for ${received} (${fmt(l.receivedValue)}) — ${Math.round(Math.abs(l.gapPct))}% gap, ${bandWord[l.band]}.`,
    )
  }
  const counts = { fair: 0, watch: 0, outside: 0 }
  for (const l of input.lines) counts[l.band] += 1
  out.push(`${input.lines.length} trades: ${counts.fair} fair, ${counts.watch} worth a look, ${counts.outside} outside the fair range.`)
  out.push(`Values are league values when each trade happened, not today's. Fair is a gap under ${PROJECTED_EVEN_BAND}%; outside is over ${AUDIT_OUTSIDE_PCT}%.`)
  return out.join('\n')
}
