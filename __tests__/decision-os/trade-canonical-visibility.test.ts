import { describe, expect, it } from 'vitest'
import {
  TRADE_CANONICAL_VISIBLE_FLAG,
  tradeCanonicalVisible,
  toTradeCanonicalOpinion,
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
