import { describe, expect, it } from 'vitest'
import { gradeTrade } from '@/lib/decision-os/trade/tradeGrade'
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
  it('shows a missing-value reason instead of inventing a letter', () => {
    const { html } = buildPendingTradeOfferEmail({ ...params,
      grade: { graded: false, reason: 'Missing defender projection', basis: null },
    })
    expect(html).toContain('Missing defender projection')
    expect(html).not.toContain('Our read, from your side')
  })
})
