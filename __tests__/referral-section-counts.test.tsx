import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

/**
 * Settings › Referrals — two bugs fixed 2026-10-02.
 *
 *  1. The "Pending rewards" tile counted only `status: "pending"`, so rewards waiting on the user to
 *     claim them read as 0; redeeming then decremented a number that never included the reward.
 *  2. `expired` and `blocked` are real reward statuses and both rendered as "Pending".
 */

vi.mock('@/components/i18n/LanguageProviderClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/i18n/LanguageProviderClient')>()
  return { ...actual, useLanguage: () => actual.defaultLanguageValue }
})

import { ReferralSection } from '@/components/settings/ReferralSection'

const json = (body: unknown) => new Response(JSON.stringify(body))

function stub(stats: Record<string, number>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/redeem')) return json({ ok: true })
      if (url.includes('/stats')) return json({ stats })
      if (url.includes('/rewards'))
        return json({
          rewards: [
            { id: 'r1', label: 'Bonus XP', status: 'claimable' },
            { id: 'r2', label: 'Badge', status: 'expired' },
            { id: 'r3', label: 'Perk', status: 'blocked' },
          ],
        })
      void init
      return json({ code: 'GUAP42', link: 'https://allfantasy.ai/r/GUAP42' })
    }),
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ReferralSection counts and statuses', () => {
  it('counts claimable rewards as pending, and a redeem moves one to redeemed', async () => {
    stub({ clicks: 3, signups: 2, pendingRewards: 0, claimableRewards: 2, redeemedRewards: 1 })
    render(<ReferralSection />)
    const tile = await screen.findByTestId('referral-stat-pending-rewards')
    await waitFor(() => expect(tile.textContent).toContain('2'))

    fireEvent.click(await screen.findByTestId('referral-redeem-r1'))
    await waitFor(() => expect(screen.getByTestId('referral-stat-pending-rewards').textContent).toContain('1'))
    expect(screen.getByTestId('referral-stat-redeemed-rewards').textContent).toContain('2')
  })

  it('labels expired and blocked rewards as what they are', async () => {
    stub({ clicks: 0, signups: 0, pendingRewards: 0, claimableRewards: 1, redeemedRewards: 0 })
    render(<ReferralSection />)
    expect(await screen.findByText('Expired')).toBeTruthy()
    expect(screen.getByText('Not eligible')).toBeTruthy()
  })
})
