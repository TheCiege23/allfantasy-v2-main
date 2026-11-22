/**
 * The advice ledger's trade half (2026-11-15) — PURE. Every `evaluateTrade()` call already saves its
 * receipt (`trade_decision_snapshots.evaluationReceipt`, ./receiptStore.ts): the letter, the assets and,
 * when rosters were given, which player went to which roster. Nothing ever graded those receipts. This
 * turns one into a gradable row, and grades rows once the weeks are played:
 *
 *   net = (points the GET side's players scored) − (points the GIVE side's players scored),
 *         per week, from the first week not kicked off when the trade was evaluated through the last
 *         fully played week.
 *
 * The question it answers is whether the letter means anything: do A trades out-score F trades?
 *
 * ⚠ WHAT IT CANNOT SEE, SAID IN THE REPORT RATHER THAN HIDDEN:
 *   - Picks and FAAB have no points; a trade with them is graded on its players only, and counted.
 *   - Points are standard PPR from the week-stats feed, not each league's scoring.
 *   - A DYNASTY trade is priced for years, not weeks — reported apart, and read as a weak signal.
 *   - Only receipts with `canonical.moves` (rosters given) say which way each player went; an ad-hoc
 *     by-name evaluation has no moves and is counted as ungradable, never guessed.
 */

import { EVIDENCE_KINDS, evidenceKindsOf, type EvidenceKind } from '@/lib/trade-market/evidenceKinds'

export type TradeLedgerRow = {
  surface: string
  /** The letter for the GIVE side ("you"), first character only: A, B, C, D or F. */
  letter: string
  format: 'dynasty' | 'redraft' | 'other'
  /** The first week not yet kicked off when the trade was evaluated. */
  fromWeek: number
  getPlayerIds: string[]
  givePlayerIds: string[]
  /** True when the deal also moved picks or FAAB, which carry no points. */
  nonPlayerAssets: boolean
  /** The evaluation was of a real proposal/trade (tradeId set), not an ad-hoc what-if. */
  isTrade: boolean
  /** The measured evidence the grade rested on (`evidenceKindsOf`) — empty for a grade on the chart alone. */
  evidence?: EvidenceKind[]
  /**
   * The league-value letter when the headline was the YOUR-TEAM letter and the two differ — the counterfactual the
   * outcome check compares against (did the roster-adjusted letter or the market letter hold up?). Null otherwise.
   */
  marketLetter?: string | null
}

type TradeLedgerSkip = 'ungraded' | 'no_moves' | 'no_players' | 'season_over'

type Json = Record<string, unknown>
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {})
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

/** PURE. One saved receipt → a gradable row, or why it is not one. */
export function tradeLedgerRow(input: {
  receipt: unknown
  surface: string | null
  isTrade: boolean
  /** First week not kicked off at `capturedAt` — the caller computes it from the season calendar. */
  fromWeek: number | null
}): TradeLedgerRow | { skip: TradeLedgerSkip } {
  const r = obj(input.receipt)
  const grade = obj(r.grade)
  const letter = typeof grade.letter === 'string' ? grade.letter.trim().charAt(0).toUpperCase() : ''
  if (grade.graded !== true || !'ABCDF'.includes(letter) || !letter) return { skip: 'ungraded' }
  if (input.fromWeek == null) return { skip: 'season_over' }

  const canonical = obj(r.canonical)
  const proposer = typeof canonical.proposerRosterId === 'string' ? canonical.proposerRosterId : null
  const moves = arr(canonical.moves).map(obj)
  if (!proposer || moves.length === 0) return { skip: 'no_moves' }
  const getIds: string[] = []
  const giveIds: string[] = []
  for (const m of moves) {
    const pid = typeof m.playerId === 'string' && m.playerId.trim() ? m.playerId.trim() : null
    if (!pid) continue
    if (m.toRosterId === proposer) getIds.push(pid)
    else if (m.fromRosterId === proposer) giveIds.push(pid)
  }
  if (getIds.length === 0 && giveIds.length === 0) return { skip: 'no_players' }

  const assets = arr(r.assets).map(obj)
  const type = String(obj(grade.leagueType).type ?? '').toLowerCase()
  return {
    surface: input.surface ?? String(r.surface ?? 'unknown'),
    letter,
    format: type.includes('dynasty') || type.includes('keeper') ? 'dynasty' : type.includes('redraft') ? 'redraft' : 'other',
    fromWeek: input.fromWeek,
    getPlayerIds: [...new Set(getIds)],
    givePlayerIds: [...new Set(giveIds)],
    nonPlayerAssets: assets.some((a) => a.kind === 'pick' || a.kind === 'faab'),
    isTrade: input.isTrade,
    evidence: evidenceKindsOf(grade),
    marketLetter: marketLetterIfDifferent(grade, letter),
  }
}

function marketLetterIfDifferent(grade: Json, letter: string): string | null {
  if (grade.letterBasis !== 'your_team') return null
  const m = obj(grade.market)
  const ml = typeof m.letter === 'string' ? m.letter.trim().charAt(0).toUpperCase() : ''
  return ml && 'ABCDF'.includes(ml) && ml !== letter ? ml : null
}

/** A directional letter held up when its side came out the way it promised (the `letterCalibration.ts` rule). */
export function letterHeld(letter: string, netPerWeek: number): boolean | null {
  if (netPerWeek === 0) return null
  if (letter === 'A' || letter === 'B') return netPerWeek > 0
  if (letter === 'D' || letter === 'F') return netPerWeek < 0
  return null
}

export type EvidenceOutcome = { group: string; scored: number; decided: number; held: number; heldPct: number | null; netPerWeek: number | null }

/**
 * PURE. The held-up record split by the evidence each grade rested on: one group per kind (a grade with two kinds
 * counts in both), "none" for grades on the chart alone, and "any" for every grade with some evidence.
 */
export function outcomesByEvidence(scored: ReadonlyArray<{ row: TradeLedgerRow; netPerWeek: number }>): EvidenceOutcome[] {
  const groups = new Map<string, Array<{ row: TradeLedgerRow; netPerWeek: number }>>()
  const add = (g: string, s: { row: TradeLedgerRow; netPerWeek: number }) => groups.set(g, [...(groups.get(g) ?? []), s])
  for (const s of scored) {
    const kinds = s.row.evidence ?? []
    if (kinds.length === 0) add('none', s)
    else {
      add('any', s)
      for (const k of kinds) add(k, s)
    }
  }
  const order = ['none', 'any', ...EVIDENCE_KINDS]
  return order.flatMap((group) => {
    const list = groups.get(group)
    if (!list?.length) return []
    const verdicts = list.map((s) => letterHeld(s.row.letter, s.netPerWeek)).filter((v): v is boolean => v != null)
    const held = verdicts.filter(Boolean).length
    const net = list.reduce((n, s) => n + s.netPerWeek, 0) / list.length
    return [{ group, scored: list.length, decided: verdicts.length, held, heldPct: verdicts.length ? Math.round((held / verdicts.length) * 1000) / 10 : null, netPerWeek: Math.round(net * 10) / 10 }]
  })
}

/**
 * PURE. Where the your-team letter and the market letter disagreed: which one held up. The fair test of the roster
 * adjustments (need, posture) — same deal, same outcome, two letters.
 */
export function yourTeamVsMarket(scored: ReadonlyArray<{ row: TradeLedgerRow; netPerWeek: number }>): { deals: number; yourTeamHeld: number; marketHeld: number; bothDecided: number } {
  let deals = 0
  let yourTeamHeld = 0
  let marketHeld = 0
  let bothDecided = 0
  for (const s of scored) {
    if (!s.row.marketLetter) continue
    deals++
    const a = letterHeld(s.row.letter, s.netPerWeek)
    const b = letterHeld(s.row.marketLetter, s.netPerWeek)
    if (a == null || b == null) continue
    bothDecided++
    if (a) yourTeamHeld++
    if (b) marketHeld++
  }
  return { deals, yourTeamHeld, marketHeld, bothDecided }
}

type LetterSummary = { n: number; netPerWeek: number; positive: number; negative: number }

/**
 * PURE. Grade rows: per letter, how many, the mean net PPR per week, and how many came out ahead.
 * `pointsPerWeek(ids, from, through)` returns the players' combined points per week over the window, or
 * null when none of them could be placed in the feed (the row is then unscored, not zero).
 */
export function gradeTradeRows<R extends TradeLedgerRow>(
  rows: readonly R[],
  through: number,
  pointsPerWeek: (ids: readonly string[], from: number, through: number) => number | null,
): {
  byLetter: Map<string, LetterSummary>
  pending: number
  unscored: number
  /** Each scored row with its net per week — what the letter's confidence is folded from (`letterCalibration.ts`). */
  scored: Array<{ row: R; netPerWeek: number }>
} {
  const byLetter = new Map<string, LetterSummary>()
  const scored: Array<{ row: R; netPerWeek: number }> = []
  let pending = 0
  let unscored = 0
  for (const row of rows) {
    if (row.fromWeek > through) {
      pending++
      continue
    }
    const get = row.getPlayerIds.length ? pointsPerWeek(row.getPlayerIds, row.fromWeek, through) : 0
    const give = row.givePlayerIds.length ? pointsPerWeek(row.givePlayerIds, row.fromWeek, through) : 0
    if (get == null || give == null) {
      unscored++
      continue
    }
    const net = get - give
    scored.push({ row, netPerWeek: net })
    const s = byLetter.get(row.letter) ?? { n: 0, netPerWeek: 0, positive: 0, negative: 0 }
    s.n++
    s.netPerWeek += net
    if (net > 0) s.positive++
    else if (net < 0) s.negative++
    byLetter.set(row.letter, s)
  }
  for (const s of byLetter.values()) s.netPerWeek = s.n ? Math.round((s.netPerWeek / s.n) * 10) / 10 : 0
  return { byLetter, pending, unscored, scored }
}
