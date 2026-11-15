/**
 * Honest settings (2026-11-15): commissioner options either work or are not offered.
 *   - basketball Campus to Canton cannot pick settings that stop it scoring (lib/c2c/basketballC2CRules.ts);
 *   - the Zombie payout panel offers only the fee, which payouts read, and says how the rest of the money moves.
 * The trade lock is proven in __tests__/zombie/beta-2025-item-trades.test.ts; the C2C route in
 * __tests__/league-rules-explainer/devy-c2c-config-routes.test.ts.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

import { basketballC2CConflicts, basketballC2CScoringBlocked } from '@/lib/c2c/basketballC2CRules'
import { ZombiePayoutMatrixPanel } from '@/app/zombie/components/commissioner/ZombiePayoutMatrixPanel'

describe('basketball Campus to Canton', () => {
  it('names the changes that would stop scoring', () => {
    expect(basketballC2CConflicts({ bestBallCollege: true, standingsModel: 'hybrid' })).toEqual(['bestBallCollege', 'standingsModel'])
    expect(basketballC2CConflicts({ bestBallCollege: false, standingsModel: 'unified' })).toEqual([])
    expect(basketballC2CConflicts({})).toEqual([])
  })
  it('knows a league that is already stuck', () => {
    expect(basketballC2CScoringBlocked({ bestBallCollege: false, standingsModel: 'unified' })).toBe(false)
    expect(basketballC2CScoringBlocked({ bestBallCollege: true, standingsModel: 'unified' })).toBe(true)
    expect(basketballC2CScoringBlocked({ bestBallCollege: false, standingsModel: 'separate' })).toBe(true)
  })
})

describe('the Zombie payout panel', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ league: { paidConfig: { commissionerFeeRate: 0.05, weeklyPayoutRate: 0.3, totalPot: 500 } } }), { status: 200 })),
    )
  })

  it('offers only the fee, and says how the money really moves', async () => {
    render(<ZombiePayoutMatrixPanel leagueId="L1" canEdit isPaid tierLabel="Beta" />)
    await waitFor(() => expect(screen.getByTestId('zombie-payout-how-it-works')).toBeTruthy())
    expect(screen.getByText('Commissioner fee rate')).toBeTruthy()
    for (const gone of ['Weekly pool rate', 'Season / finale rate', 'Survivor bonus rate', 'Tracked total pot ($)', 'Weekly payout pool ($)']) {
      expect(screen.queryByText(gone)).toBeNull()
    }
    expect(screen.getByText(/split among the Survivors/)).toBeTruthy()
  })
})
