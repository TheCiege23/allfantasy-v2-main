import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  TRADE_CANONICAL_VISIBLE_FLAG,
  tradeCanonicalVisible,
  toTradeCanonicalOpinion,
  describeTradeCanonicalOpinion,
} from '@/lib/decision-os/trade/canonicalVisibility'

const CMP = {
  canonicalGrade: 'B+',
  canonicalConfidenceScore: 71,
  canonicalAdvantage: 'you' as const,
  agreement: true as boolean | null,
}

describe('Phase 3B trade canonical visibility — the gate', () => {
  it('is off when the flag is absent', () => {
    expect(tradeCanonicalVisible({})).toBe(false)
  })

  it('accepts only the exact string "true", matching every other Decision OS gate', () => {
    for (const v of ['true', 'TRUE', ' true ']) {
      expect(tradeCanonicalVisible({ [TRADE_CANONICAL_VISIBLE_FLAG]: v })).toBe(true)
    }
    // The values a reasonable person might expect to work, and which the app rejects everywhere else.
    for (const v of ['1', 'yes', 'on', 'True!', '']) {
      expect(tradeCanonicalVisible({ [TRADE_CANONICAL_VISIBLE_FLAG]: v })).toBe(false)
    }
  })
})

describe('Phase 3B trade canonical visibility — the projection', () => {
  const ON = { [TRADE_CANONICAL_VISIBLE_FLAG]: 'true' }

  it('returns null when the flag is off, even with a real comparison in hand', () => {
    expect(toTradeCanonicalOpinion(CMP, {})).toBeNull()
  })

  it('returns null when there is no comparison, so the response field is ABSENT not empty', () => {
    // An absent field reads as "no second opinion". A present object full of nulls reads as an
    // opinion of nothing, which is the shape that has already caused one wrong reading here.
    expect(toTradeCanonicalOpinion(null, ON)).toBeNull()
  })

  it('projects the canonical fields when enabled', () => {
    expect(toTradeCanonicalOpinion(CMP, ON)).toEqual({
      grade: 'B+',
      confidence: 71,
      advantage: 'you',
      agreesWithConsole: true,
    })
  })

  it('🛑 keeps a null agreement NULL — it must never become false or true', () => {
    // agreement: null means the comparison produced no verdict. Rendering it as agreement inflates
    // the flip gate; rendering it as disagreement invents a conflict. It stays null.
    const out = toTradeCanonicalOpinion({ ...CMP, agreement: null }, ON)
    expect(out?.agreesWithConsole).toBeNull()
    expect(out?.agreesWithConsole).not.toBe(false)
  })

  it('🛑 keeps a null grade NULL, and does not substitute a neutral one', () => {
    // A refusal to price is not a grade of "even". Zero confidence is not a judgement of fairness.
    const out = toTradeCanonicalOpinion(
      { canonicalGrade: null, canonicalConfidenceScore: 0, canonicalAdvantage: null, agreement: null },
      ON,
    )
    expect(out).not.toBeNull()
    expect(out?.grade).toBeNull()
    expect(out?.advantage).toBeNull()
    expect(out?.confidence).toBe(0)
  })

  it('preserves a genuine disagreement', () => {
    const out = toTradeCanonicalOpinion({ ...CMP, agreement: false }, ON)
    expect(out?.agreesWithConsole).toBe(false)
  })
})

/**
 * The render states. These exist because Phase 3B named three of them in a comment above the JSX
 * and implemented two — and the modal has no test, so nothing failed.
 *
 * The `no_signal` cases below are not hypothetical shapes: they are the four observations
 * `decision_parity_record` actually holds for `manager.trade.evaluate` (2026-09-04 to 09-05, all
 * authenticated and league-scoped), every one of them `confidenceScore: 0` with a grade present.
 * Under the old branch all four rendered as a confident grade.
 */
describe('describeTradeCanonicalOpinion — the three honesty states', () => {
  const OPINION = { grade: 'B+', confidence: 61, advantage: 'you' as const, agreesWithConsole: true }

  it('absent opinion stays absent — nothing to render', () => {
    expect(describeTradeCanonicalOpinion(null)).toBeNull()
  })

  it('a null grade is unpriced, and carries no grade to print', () => {
    const s = describeTradeCanonicalOpinion({ ...OPINION, grade: null })
    expect(s).toEqual({ kind: 'unpriced' })
  })

  it.each([
    ['A+', 'the 2027-1st-for-2027-1st pair, 09-04 15:35 and 16:10'],
    ['C+', 'the 4-for-2, 09-05 05:52'],
    ['B-', 'the 2-for-1, 09-05 05:54'],
  ])('confidence 0 with grade %s is NO SIGNAL, not an opinion (%s)', (grade) => {
    const s = describeTradeCanonicalOpinion({ ...OPINION, grade, confidence: 0 })
    expect(s).toEqual({ kind: 'no_signal', grade })
    // The grade is carried but the state forbids leading with it; there is no confidence field
    // to render, because there is no confidence.
    expect(s).not.toHaveProperty('confidence')
    expect(s).not.toHaveProperty('agreesWithConsole')
  })

  it('a NaN confidence is no signal — a NaN must never pass as a number', () => {
    expect(describeTradeCanonicalOpinion({ ...OPINION, confidence: Number.NaN })).toEqual({
      kind: 'no_signal',
      grade: 'B+',
    })
  })

  it('negative confidence is no signal', () => {
    expect(describeTradeCanonicalOpinion({ ...OPINION, confidence: -1 })).toEqual({
      kind: 'no_signal',
      grade: 'B+',
    })
  })

  it('confidence 1 IS an opinion — zero is the line, not an invented floor', () => {
    const s = describeTradeCanonicalOpinion({ ...OPINION, confidence: 1 })
    expect(s).toEqual({ kind: 'opinion', grade: 'B+', confidence: 1, agreesWithConsole: true })
  })

  it('a real opinion keeps its confidence and its verdict', () => {
    expect(describeTradeCanonicalOpinion(OPINION)).toEqual({
      kind: 'opinion',
      grade: 'B+',
      confidence: 61,
      agreesWithConsole: true,
    })
  })

  it('a verdictless opinion with real confidence stays an opinion, agreement null', () => {
    const s = describeTradeCanonicalOpinion({ ...OPINION, agreesWithConsole: null })
    expect(s).toEqual({ kind: 'opinion', grade: 'B+', confidence: 61, agreesWithConsole: null })
  })
})

/**
 * ⚠ The modal is the thing that was wrong, so assert against the modal SOURCE too. Reading its
 * subject with no existsSync guard on purpose: if the file moves this must fail loudly rather than
 * scan nothing and pass.
 */
describe('TradeValueModal renders from the resolved state, not from `grade`', () => {
  const src = readFileSync(
    join(process.cwd(), 'components/ai-tools/modals/TradeValueModal.tsx'),
    'utf8',
  )

  it('imports and uses the tested resolver', () => {
    expect(src).toContain('describeTradeCanonicalOpinion')
    expect(src).toMatch(/const decisionOsState = describeTradeCanonicalOpinion\(/)
  })

  it('branches on the state kind, never on a bare `decisionOs.grade`', () => {
    expect(src).toContain("decisionOsState?.kind === 'opinion'")
    expect(src).toContain("decisionOsState?.kind === 'no_signal'")
    expect(src).not.toMatch(/\{decisionOs\.grade \?/)
  })

  it('the no-signal branch never prints a grade and says it is not neutral', () => {
    expect(src).toContain('nothing in this deal could be priced')
    expect(src).toContain('not a neutral one')
  })
})
