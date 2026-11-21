/**
 * THE LEARNING LOOP'S LAST STEP (re-score build item 7, 2026-11-19): AllFantasy's graded record goes back
 * to the advice it grades.
 *
 * The ledger (`ledgerRecord.ts` / `ledgerGrading.ts`) has graded three of AllFantasy's own calls since
 * 2026-11-15: My Team's bench check, the waiver panel's #1 pickup, and every trade grade. Until now the
 * result was shown on one card (Receipts) and nowhere else, so a trade letter that had not held up kept
 * being shown with the same weight as one that had, and Chimmy, asked about either, had no numbers.
 * This file turns the stored record into what the advice surfaces show beside their call:
 *
 *   - a trade letter → how deals graded that letter have actually scored since (Trade Center, Chimmy);
 *   - the waiver panel → how its #1 pickup has done;
 *   - Chimmy → all three, as one prompt block it may quote and must not go beyond.
 *
 * 🛑 THE CALL ITSELF IS NOT CHANGED. The engines are live and their letters and rankings stay theirs; what
 * the outcome changes is how the call is PRESENTED — a letter whose deals have not held up says so. Shifting
 * a letter or a confidence on this evidence would be a second, invented calibration on top of the engine's
 * own, and the ledger measures something narrower than the letter claims (standard PPR, players only,
 * redraft only) — so it is reported, never applied.
 *
 * ⚠ ONE NARROW EXCEPTION, AND IT IS NOT HERE (2026-11-20): the waiver engine's CONFIDENCE (never its ranking)
 * is corrected by its own graded #1 claims, but only in a redraft full-PPR NFL league — the one scope where the
 * ledger's measure IS the league's, so the objection above does not apply. See `lib/decision-os/waiver/calibration.ts`.
 * The waiver panel's record below is still reported as it always was; trade letters are still never moved.
 *
 * 🛑 THE SAMPLE RULES ARE THE LEDGER'S: a letter is absent below MIN_TRADES_PER_LETTER graded deals, and a
 * pickup rate is null below MIN_GRADED_FOR_OVERALL_RATE. Nothing here lowers either.
 *
 * Pure (type imports only), so the client components and the chat route share it.
 */

import type { LedgerRecordView, TradeLetter } from './ledgerRecord'
import { tradeLetterConfidence, type TradeLetterConfidence } from '@/lib/decision-os/trade/letterCalibration'

/** Did deals graded this letter score the way the letter said? `even` for C, which promises no direction. */
export type LetterVerdict = 'held_up' | 'not_held_up' | 'even'

export type TradeLetterRecord = {
  letter: TradeLetter
  n: number
  netPerWeek: number
  aheadPct: number | null
  verdict: LetterVerdict
  /**
   * How sure a grade of this letter is, from its graded deals (`letterCalibration.ts`) — null until the letter has
   * enough decided deals, and always null for C. 🛑 It is stated BESIDE the letter; it never moves it.
   */
  confidence: TradeLetterConfidence | null
}

export function letterVerdict(letter: TradeLetter, netPerWeek: number): LetterVerdict {
  if (letter === 'C' || netPerWeek === 0 || !Number.isFinite(netPerWeek)) return 'even'
  const favoured = letter === 'A' || letter === 'B'
  return favoured === netPerWeek > 0 ? 'held_up' : 'not_held_up'
}

/** The record for one letter, or null when that letter has too few graded deals (or the view has none). */
export function tradeLetterRecord(view: LedgerRecordView | null | undefined, letter: string | null | undefined): TradeLetterRecord | null {
  const l = typeof letter === 'string' ? letter.trim().charAt(0).toUpperCase() : ''
  const row = view?.trades?.find((t) => t.letter === l)
  if (!row) return null
  return {
    letter: row.letter,
    n: row.n,
    netPerWeek: row.netPerWeek,
    aheadPct: row.aheadPct ?? null,
    verdict: letterVerdict(row.letter, row.netPerWeek),
    confidence: tradeLetterConfidence(row.letter, view?.tradeConfidence),
  }
}

/**
 * For the commissioner's trade review: the letter's record over trades a COMMISSIONER was shown, when that
 * letter has enough of them; otherwise the record over every graded deal. `scope` says which, so the copy can
 * say it. Null when neither qualifies — the panel then shows the grade alone.
 */
export function commissionerLetterRecord(
  view: LedgerRecordView | null | undefined,
  letter: string | null | undefined,
): (TradeLetterRecord & { scope: 'commissioner' | 'everyone' }) | null {
  const own = tradeLetterRecord(
    view ? { ...view, trades: view.commissionerTrades ?? null, tradeConfidence: view.commissionerTradeConfidence ?? null } : null,
    letter,
  )
  if (own) return { ...own, scope: 'commissioner' }
  const all = tradeLetterRecord(view, letter)
  return all ? { ...all, scope: 'everyone' } : null
}

/**
 * The ledger's trade letters are graded on REDRAFT NFL deals only (`ledgerGrading.ts`): a dynasty deal is
 * priced for years, not weeks. So the record belongs beside a grade only when that grade is too.
 */
export function letterRecordApplies(input: { sport: string | null | undefined; leagueType: string | null | undefined }): boolean {
  return String(input.sport ?? '').trim().toUpperCase() === 'NFL' && String(input.leagueType ?? '').toLowerCase().includes('redraft')
}

/** The waiver panel's #1-pickup record across everyone, only once it carries a rate. */
export function pickupRecord(view: LedgerRecordView | null | undefined): { ratePct: number; graded: number } | null {
  const e = view?.pickups?.everyone
  if (!e || e.ratePct == null) return null
  return { ratePct: e.ratePct, graded: e.graded }
}

const signed = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(1)}`
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/**
 * The block handed to the chat model with each turn, beside Chimmy's own start/sit record. It states the
 * numbers and forbids any other — with nothing graded it says THAT, so a model asked "do your trade grades
 * work?" cannot invent a hit rate.
 */
export function renderEngineRecordPromptLine(view: LedgerRecordView | null): string {
  const lines = [
    "ALLFANTASY'S OWN RECORD (its bench check, waiver panel #1 pickup and trade grades, graded against what actually happened: NFL, standard PPR, rebuilt every few hours):",
  ]

  const b = view?.bench
  if (b?.you || b?.everyone) {
    const parts: string[] = []
    if (b.you) parts.push(`with this user ${b.you.right} right, ${b.you.wrong} wrong${b.you.ratePct != null ? ` (${b.you.ratePct}%)` : ''}`)
    if (b.everyone)
      parts.push(
        b.everyone.ratePct != null
          ? `across everyone ${b.everyone.ratePct}% right over ${plural(b.everyone.right + b.everyone.wrong, 'decided call', 'decided calls')}`
          : `across everyone ${plural(b.everyone.right + b.everyone.wrong, 'decided call', 'decided calls')} so far, too few for a percentage`,
      )
    lines.push(`- My Team's bench check ("start X over Y"): ${parts.join('; ')}.`)
  } else {
    lines.push("- My Team's bench check: no graded calls yet.")
  }

  const p = view?.pickups
  if (p?.you || p?.everyone) {
    const parts: string[] = []
    if (p.everyone)
      parts.push(
        p.everyone.ratePct != null
          ? `across everyone ${p.everyone.ratePct}% averaged 10+ PPR a week over the next three weeks (${p.everyone.graded} graded)`
          : `across everyone ${plural(p.everyone.graded, 'graded pickup', 'graded pickups')} so far, too few for a percentage`,
      )
    if (p.you) parts.push(`with this user ${p.you.startable} of ${p.you.graded} did`)
    lines.push(`- The waiver panel's #1 pickup: ${parts.join('; ')}.`)
  } else {
    lines.push("- The waiver panel's #1 pickup: no graded pickups yet.")
  }

  const letters = view?.trades ?? []
  if (letters.length) {
    const parts = letters.map((t) => {
      const v = letterVerdict(t.letter, t.netPerWeek)
      const ahead = t.aheadPct != null ? `, ahead in ${t.aheadPct}%` : ''
      const verdict = v === 'held_up' ? ' — has held up' : v === 'not_held_up' ? ' — has NOT held up' : ''
      const c = tradeLetterConfidence(t.letter, view?.tradeConfidence)
      const sure = c ? `; how sure a ${t.letter} is: ${c.level} (about ${c.heldPct}% of its deals held up — ${c.decided} decided, recent ones weighted more, steadied toward even odds)` : ''
      return `${t.letter} ${signed(t.netPerWeek)} PPR a week (${t.n} deals${ahead})${verdict}${sure}`
    })
    lines.push(`- Trade grades (redraft deals; the graded side's players against the players it gave, from the next week on): ${parts.join('; ')}.`)
  } else {
    lines.push('- Trade grades: no letter has enough graded deals yet.')
  }

  lines.push(
    'When you give a trade grade, a waiver pickup or a bench call, you may say how that kind of call has held up — quote these numbers exactly, and say plainly when a letter has not held up. Never state or imply any other record, hit rate or win percentage for AllFantasy.',
    'Where a letter above carries "how sure", that is how sure a redraft NFL grade of that letter is: say it beside the grade (a low one means the deal is closer than the letter suggests). It never changes the letter — the grade is the trade engine\'s.',
  )
  return lines.join('\n')
}
