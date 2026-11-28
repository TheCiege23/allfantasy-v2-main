/**
 * Trade review as a picker (owner request, 2026-11-28). "No review" is stored as `instant`: the redraft
 * runtime reads a stored `none` as "trades disabled" and falls back to commissioner review
 * (lib/league-trade-engine/leagueTradeReviewSetting.ts).
 */
import { describe, expect, it } from 'vitest'
import { buildGeneralGroups } from '@/lib/league-settings-hub/hubModel'

const reviewRow = (snapshot: Record<string, unknown>) =>
  buildGeneralGroups({ league: { sport: 'NFL', teamCount: 12, playoffStartWeek: 15 }, settingsSnapshot: snapshot }, 'redraft')
    .flatMap((g) => g.rows)
    .find((r) => r.key === 'review')!

describe('trade review picker', () => {
  it('offers commissioner, league vote and no review, saved as tradeReviewType', () => {
    const row = reviewRow({ trade_review_mode: 'commissioner' })
    expect(row.edit?.field).toBe('tradeReviewType')
    expect(row.edit?.choices.map((c) => c.value)).toEqual(['commissioner', 'league_vote', 'instant'])
    expect(row.edit?.current).toBe('commissioner')
  })

  it('reads a stored instant, none or no_veto as No review, and marks it current', () => {
    for (const stored of ['instant', 'none', 'no_veto']) {
      const row = reviewRow({ trade_review_mode: stored })
      expect(row.value).toBe('No review')
      expect(row.edit?.current).toBe('instant')
    }
  })

  it('never offers none, which the redraft runtime reads as trades disabled', () => {
    expect(reviewRow({}).edit?.choices.some((c) => c.value === 'none')).toBe(false)
  })

  it('a league vote reads as League vote', () => {
    const row = reviewRow({ trade_review_mode: 'league_vote' })
    expect(row.value).toBe('League vote')
    expect(row.edit?.current).toBe('league_vote')
  })
})
