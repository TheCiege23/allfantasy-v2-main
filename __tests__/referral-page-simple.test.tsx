import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * /referral and Settings › Referrals on a phone (2026-11-25, the simplify pass).
 */
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/referral',
}))
vi.mock('@/components/i18n/LanguageProviderClient', async (original) => {
  const actual = await original<typeof import('@/components/i18n/LanguageProviderClient')>()
  return { ...actual, useLanguage: () => actual.defaultLanguageValue, useOptionalLanguage: () => actual.defaultLanguageValue }
})
vi.mock('@/components/referral/ProWeekOfferCard', () => ({ ProWeekOfferCard: () => null, default: () => null }))

import { ReferralDashboard } from '@/components/referral/ReferralDashboard'
import { ReferralSection } from '@/components/settings/ReferralSection'
import { ReferralShareBar } from '@/components/referral/ReferralShareBar'

const STATS = { clicks: 42, shares: 9, signups: 6, onboarded: 4, creatorReferrals: 0, claimableRewards: 1, pendingRewards: 1, redeemedRewards: 2, totalRewardValue: 300, conversionRate: 14.3 }
const DASHBOARD = {
  code: 'CIEGE26',
  link: 'https://allfantasy.ai/r/CIEGE26',
  audience: 'user',
  stats: STATS,
  progress: {
    audience: 'user', tier: { id: 'scout', label: 'Scout' }, nextMilestone: { signups: 10, label: 'Recruiter' },
    milestones: [], signups: 6, clicks: 42, shares: 9, onboarded: 4, claimableRewards: 1, pendingRewards: 1,
    redeemedRewards: 2, progressPct: 60, onboardingCompletionRate: 66.7,
  },
  rewards: [],
  leaderboard: [1, 2, 3, 4, 5].map((i) => ({
    rank: i, userId: `u${i}`, displayName: `Manager ${i}`, username: `mgr${i}`, avatarUrl: null, isCreator: false,
    signups: 20 - i, clicks: 50, shares: 5, onboarded: 3, redeemedRewards: 1, tier: 'Scout',
  })),
  referred: [],
  funnel: { clicked: 42, signedUp: 6, engaged: 5, onboarded: 4, rewarded: 2 },
  ctaCards: [
    { id: 'share', title: 'Share your link', description: 'x', href: '/referral', label: 'Copy link', variant: 'default' },
    { id: 'leaderboard', title: 'Climb the leaderboard', description: 'x', href: '/referral?tab=leaderboard', label: 'Leaderboard', variant: 'leaderboard' },
  ],
  updatedAt: new Date().toISOString(),
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url)
    const body = u.includes('/api/referral/dashboard') ? { ok: true, dashboard: DASHBOARD }
      : u.includes('/api/referral/link') ? { code: 'CIEGE26', link: DASHBOARD.link }
      : u.includes('/api/referral/stats') ? { stats: STATS }
      : u.includes('/api/referral/rewards') ? { rewards: [] }
      : {}
    return { ok: true, status: 200, json: async () => body }
  }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('/referral dashboard', () => {
  it('heading with an icon Reload, no eyebrow or intro', async () => {
    render(<ReferralDashboard />)
    expect(await screen.findByRole('heading', { name: 'Grow the league, earn the upside' })).toBeTruthy()
    expect(screen.getByTestId('referral-dashboard-reload').getAttribute('aria-label')).toBe('Reload data')
    expect(document.body.textContent).not.toMatch(/Referral System|Track referral signups/)
  })

  it('no call-to-action cards repeating the tabs, and the top three on Overview', async () => {
    render(<ReferralDashboard />)
    await screen.findByRole('heading', { name: 'Grow the league, earn the upside' })
    expect(screen.queryByText('Climb the leaderboard')).toBeNull()
    expect(screen.queryByTestId('referral-open-leaderboard')).toBeNull()
    expect(screen.getByText('Manager 3')).toBeTruthy()
    expect(screen.queryByText('Manager 4')).toBeNull()
  })

  it('one Copy link (beside the link box), not a second in the share row', async () => {
    render(<ReferralDashboard />)
    await screen.findByRole('heading', { name: 'Grow the league, earn the upside' })
    expect(screen.getByTestId('referral-copy-link')).toBeTruthy()
    expect(screen.queryByTestId('referral-share-copy_link')).toBeNull()
    expect(screen.getByTestId('referral-share-sms')).toBeTruthy()
  })

  it('stat grids are two across and every grid can shrink to the screen', async () => {
    const { container } = render(<ReferralDashboard />)
    const signups = await screen.findByTestId('referral-stat-signups')
    expect(signups.closest('.grid')!.className).toMatch(/(^|\s)grid-cols-2(\s|$)/)
    // A grid with no column set sizes its track to its widest child — that is what made the page 404px wide.
    for (const grid of Array.from(container.querySelectorAll('.grid'))) {
      expect(grid.className).toMatch(/(^|\s)grid-cols-(1|2)(\s|$)/)
    }
  })
})

describe('Settings › Referrals', () => {
  it('stats are two across, and the share row does not repeat Copy link', async () => {
    render(<ReferralSection />)
    expect((await screen.findByTestId('referral-stats-grid')).className).toMatch(/(^|\s)grid-cols-2(\s|$)/)
    expect(screen.queryByTestId('referral-share-copy_link')).toBeNull()
  })

  it('the share row still offers Copy link where nothing else does', () => {
    render(<ReferralShareBar referralLink="https://allfantasy.ai/r/X" />)
    expect(screen.getByTestId('referral-share-copy_link')).toBeTruthy()
  })
})
