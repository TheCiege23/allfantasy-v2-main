import { describe, expect, it } from 'vitest'
import { gradeTrade, withYourTeamLetter } from '@/lib/decision-os/trade/tradeGrade'
import { buildPendingTradeOfferEmail } from '@/lib/trade-intel/tradeGradeEmail'

describe('pending email uses the shared proposal grade', () => {
  const params = {
    leagueName: 'IDP', proposerName: 'Manager', youGive: [{ playerName: 'Outgoing', playerId: '1', position: 'LB', team: 'BUF', isPick: false }], youGet: [{ playerName: '<script>player</script>', playerId: '2', position: 'LB', team: 'BUF', isPick: false }],
    reviewUrl: 'https://allfantasy.ai/core/trades', baseUrl: 'https://allfantasy.ai',
  }
  it('renders the exact league prices and shared letter with escaped player names', () => {
    const evaluation = gradeTrade({
      giveValue: 1000, getValue: 1500, giveMarket: 1000, getMarket: 1500,
      unpriced: 0, giveCount: 1, getCount: 1, basis: 'Dynasty',
      scoringApplied: false, needApplied: false, needGap: null,
      lines: [{ side: 'give', name: 'Outgoing', leagueValue: 1000, marketValue: 1000 }, { side: 'get', name: '<script>player</script>', leagueValue: 1500, marketValue: 1500 }],
      moves: [],
    })
    const { html } = buildPendingTradeOfferEmail({ ...params, grade: evaluation })
    expect(html).toContain('Our read, from your side')
    expect(html).toContain('1,000')
    expect(html).toContain('&lt;script&gt;player&lt;/script&gt;')
    expect(html).toContain('values at email time')
  })
  const marketGrade = () => {
    const grade = gradeTrade({ giveValue: 1766, getValue: 1584, giveMarket: 1766, getMarket: 1584,
      unpriced: 0, giveCount: 1, getCount: 1, basis: 'Dynasty', scoringApplied: false,
      needApplied: false, needGap: null, lines: [], moves: [] })
    if (!grade.graded) throw new Error('expected a grade')
    return { ...grade, rosterFit: { giveValue: 1695, getValue: 1584, percentDiff: -7,
      moves: [{ side: 'give' as const, name: '<script>player</script>', base: 1766, leagueValue: 1695, reasons: ['surplus WR depth'] }] } }
  }

  it('grades the offer for your team and shows the market letter beside it (2026-10-10)', () => {
    // Surplus WR depth: -10 on league value (D), -7 for this roster (C).
    const { subject, html } = buildPendingTradeOfferEmail({ ...params, grade: withYourTeamLetter(marketGrade()) })
    expect(subject).toContain('C for you')
    expect(html).toContain('Our read, for your team')
    expect(html).toContain('Market: D (')
    expect(html).toContain('Your roster fit · what your grade is taken on')
    expect(html).toContain('1,695')
    expect(html).toContain('&lt;script&gt;player&lt;/script&gt;')
    expect(html).not.toContain('<script>player</script>')
  })

  it('keeps a league-value headline when the grade is not a your-team grade, and never calls the fit separate', () => {
    const { subject, html } = buildPendingTradeOfferEmail({ ...params, grade: marketGrade() })
    expect(subject).toContain('D for you')
    expect(html).toContain('Our read, from your side')
    expect(html).not.toContain('Market: ')
    expect(html).not.toMatch(/separate from the trade-value grade|does not change the headline letter/)
  })
  it('shows a missing-value reason instead of inventing a letter', () => {
    const { html } = buildPendingTradeOfferEmail({ ...params,
      grade: { graded: false, reason: 'Missing defender projection', basis: null },
    })
    expect(html).toContain('Missing defender projection')
    expect(html).not.toContain('Our read, from your side')
  })
})
