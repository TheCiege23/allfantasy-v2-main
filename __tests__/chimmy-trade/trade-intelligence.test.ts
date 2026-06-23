import { describe, it, expect } from 'vitest'
import { classifyTradeIntent } from '@/lib/chimmy-trade/intent'
import {
  TRADE_INTELLIGENCE_SYSTEM_RULES,
  FORBIDDEN_PHRASE_PATTERNS,
  assertSafeText,
  COMMISSIONER_REVIEW_FRAMING,
} from '@/lib/chimmy-trade/answerPolicy'
import { commissionerTradeReview, explainPlayerMarketValue } from '@/lib/chimmy-trade/tradeIntelligenceTools'

describe('T10 intent classifier (deterministic, no hidden-id guessing)', () => {
  const cases: Array<[string, string]> = [
    ['Is this trade fair?', 'explain_trade'],
    ['Should I veto this trade?', 'commissioner_review'],
    ['Who should I trade with?', 'find_partners'],
    ['What can I offer for Bijan?', 'suggest_packages'],
    ['Why is this player value moving?', 'explain_player_value'],
    ['Who is on the trade block?', 'summarize_block'],
    ['Explain trades to a beginner', 'teach'],
  ]
  for (const [q, kind] of cases) {
    it(`"${q}" → ${kind}`, () => {
      expect(classifyTradeIntent(q).kind).toBe(kind)
    })
  }

  it('non-trade question is not trade-related', () => {
    const r = classifyTradeIntent('Who should I start at QB this week?')
    expect(r.isTradeRelated).toBe(false)
    expect(r.kind).toBe('general_trade')
  })

  it('empty message is safe', () => {
    expect(classifyTradeIntent('').isTradeRelated).toBe(false)
  })
})

describe('T10 answer policy / prompt hardening', () => {
  it('system rules forbid "must veto", auto-actions, and collusion framing', () => {
    const rules = TRADE_INTELLIGENCE_SYSTEM_RULES.toLowerCase()
    expect(rules).toContain('never say a user "must"') // no veto command
    expect(rules).toContain('manual review suggested')
    expect(rules).toContain('collusion')
    expect(rules).toContain('will not auto-submit')
    // distinct value sources spelled out
    expect(rules).toContain('official allfantasy market value')
    expect(rules).toContain('provider/adp/projection')
    expect(rules).toContain('snapshot')
    expect(rules).toContain('preview')
  })

  it('assertSafeText scrubs veto-command / collusion / guarantee phrasing', () => {
    expect(assertSafeText('You must veto this trade')).not.toMatch(/must veto/i)
    expect(assertSafeText('This is collusion')).not.toMatch(/collusion/i)
    expect(assertSafeText('This is a guaranteed win')).not.toMatch(/guaranteed/i)
    // benign text passes through unchanged
    const ok = 'This trade graded B with fairness 78/100.'
    expect(assertSafeText(ok)).toBe(ok)
  })

  it('forbidden patterns catch the unsafe phrases', () => {
    const bad = ['you must veto', 'auto-submit', 'collusion', 'guaranteed']
    for (const phrase of bad) {
      expect(FORBIDDEN_PHRASE_PATTERNS.some((re) => re.test(phrase))).toBe(true)
    }
  })

  it('commissioner framing is neutral, not a command', () => {
    expect(COMMISSIONER_REVIEW_FRAMING).toMatch(/not an instruction to veto/i)
  })
})

describe('T10 permission + insufficient-data (no DB required — early returns)', () => {
  it('manager cannot see commissioner review', async () => {
    const r = await commissionerTradeReview('any-proposal', 'manager')
    expect(r.ok).toBe(false)
    expect(r.data).toBeNull()
    expect(r.limitations[0]?.code).toBe('PERMISSION_REQUIRED')
    expect(JSON.stringify(r).toLowerCase()).not.toContain('collusion')
  })

  it('non-member cannot see commissioner review', async () => {
    const r = await commissionerTradeReview('any-proposal', 'non_member')
    expect(r.ok).toBe(false)
    expect(r.limitations[0]?.code).toBe('PERMISSION_REQUIRED')
  })

  it('player value with no sport scope returns limited-data, never a fabricated number', async () => {
    const r = await explainPlayerMarketValue('player-x', null)
    expect(r.ok).toBe(false)
    expect(r.data).toBeNull()
    expect(r.limitations[0]?.code).toBe('LIMITED_DATA')
    expect(r.text.join(' ')).toMatch(/cannot be resolved/i)
    // no invented value leaked
    expect(r.text.join(' ')).not.toMatch(/\b\d{2,}\b/)
  })
})
