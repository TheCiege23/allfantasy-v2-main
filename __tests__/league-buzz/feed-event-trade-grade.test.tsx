/**
 * The league feed page draws a trade's grade (2026-09-27) — `components/feed/FeedEvent.tsx`, the
 * same `tradeGrade` /core's Comms feed draws, worded by the same `tradeGradeLabel`.
 */
import React from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import FeedEvent from '@/components/feed/FeedEvent'
import type { ActivityFeedItem } from '@/lib/activity/types'

const trade = (over: Partial<ActivityFeedItem> = {}): ActivityFeedItem => ({
  id: 'native-trade:t1', type: 'trade', userId: '', userName: 'Trade', description: 'Ada gets X · Bea gets Y',
  timestamp: new Date().toISOString(), leagueId: 'L1', leagueName: 'Kings', source: 'native', ...over,
})

describe('FeedEvent — trade grade', () => {
  it('draws each team’s letter and that a native trade was graded at proposal', () => {
    render(<FeedEvent item={trade({ tradeGrade: { graded: true, basis: 'at-proposal', sides: [{ name: 'Ada', letter: 'A' }, { name: 'Bea', letter: 'F' }] } })} />)
    const line = screen.getByTestId('feed-trade-grade')
    expect(line.textContent).toBe('AdaABeaFgraded when it was proposed')
  })

  it('a withheld grade says why; no grade draws nothing; a non-trade never draws one', () => {
    const { rerender } = render(<FeedEvent item={trade({ tradeGrade: { graded: false, reason: 'only two-team trades are graded' } })} />)
    expect(screen.getByTestId('feed-trade-grade-withheld').textContent).toBe('Not graded: only two-team trades are graded')
    rerender(<FeedEvent item={trade()} />)
    expect(screen.queryByTestId('feed-trade-grade')).toBeNull()
    expect(screen.queryByTestId('feed-trade-grade-withheld')).toBeNull()
    rerender(<FeedEvent item={trade({ type: 'waiver', tradeGrade: { graded: true, basis: 'today', sides: [{ name: 'Ada', letter: 'A' }, { name: 'Bea', letter: 'F' }] } })} />)
    expect(screen.queryByTestId('feed-trade-grade')).toBeNull()
  })
})
