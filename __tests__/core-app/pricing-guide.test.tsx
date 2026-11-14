/**
 * /pricing guide pass (2026-11-14): the answer as the headline, the yearly saving as one honest range,
 * AF Supreme's value said once with numbers, yearly prices only on the cards, and the comparison folded
 * with the all-"Coming soon" rows as one line. Rules in lib/core-app/pricingGuide.ts.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/pricing',
  redirect: vi.fn(),
}))
vi.mock('@/lib/monetization/checkout-client', () => ({ resolveCheckoutUrl: vi.fn(async () => ({ ok: false as const, error: 'stopped in test' })) }))
vi.mock('@/hooks/usePostPurchaseSync', () => ({
  usePostPurchaseSync: () => ({ state: { phase: 'idle', message: '' }, isSyncing: false, retrySync: vi.fn() }),
}))
vi.mock('@/lib/geo/useGeoRestriction', () => ({
  useGeoRestriction: () => ({ isPaidBlocked: false, loading: false, stateName: null, stateCode: null }),
}))
vi.mock('@/components/tokens/TokenBalanceWidget', () => ({ TokenBalanceWidget: () => null }))

import { PricingV4, type PricingPlan } from '@/components/core-app/screens/PricingV4'
import {
  pricingHeadline,
  splitComingSoon,
  supremeValue,
  SUPREME_VALUE_BULLET,
  yearlySavingsRange,
} from '@/lib/core-app/pricingGuide'
import { pricingGuideMessages } from '@/lib/core-app/messages/pricingGuide'
import { PLAN_FAMILY_INCLUDES } from '@/lib/monetization/planIncludes'
import { missingMessages } from '@/lib/i18n/messages'
import type { ComparisonGroup } from '@/lib/monetization/planComparison'

afterEach(() => cleanup())

/** Shaped like the live catalog on 2026-11-14, but the tests read only what they pass in. */
const plan = (planFamily: string, name: string, monthly: number, yearly: number, savedPct: number): PricingPlan => ({
  planFamily,
  name,
  description: `${name} description`,
  monthlySku: `${planFamily}_monthly`,
  monthlyPrice: monthly,
  yearlySku: `${planFamily}_yearly`,
  yearlyPrice: yearly,
  savings: { savedUsd: Math.round((monthly * 12 - yearly) * 100) / 100, savedPct, effectiveMonthly: Math.round((yearly / 12) * 100) / 100 },
})
const PLANS = [
  plan('af_pro', 'AF Pro', 9.99, 79.99, 33),
  plan('af_commissioner', 'AF Commissioner', 14.99, 129.99, 28),
  plan('af_supreme', 'AF Supreme', 19.99, 159.99, 33),
]

const yes = { kind: 'yes' as const }
const no = { kind: 'no' as const }
const soon = { kind: 'soon' as const }
const COMPARISON: ComparisonGroup[] = [
  {
    id: 'run',
    title: 'Run your league',
    rows: [{ id: 'drafts', label: 'Drafts and trades', cells: { free: yes, af_pro: yes, af_commissioner: yes, af_supreme: yes } }],
  },
  {
    id: 'soon',
    title: 'Coming soon',
    rows: [
      { id: 'keepers', label: 'Keepers on the draft board', cells: { free: soon, af_pro: soon, af_commissioner: soon, af_supreme: soon } },
      { id: 'voting', label: 'Rule-change voting', cells: { free: soon, af_pro: soon, af_commissioner: soon, af_supreme: soon } },
    ],
  },
  {
    id: 'mixed',
    title: 'Commissioner OS',
    rows: [{ id: 'health', label: 'League Health', cells: { free: no, af_pro: no, af_commissioner: yes, af_supreme: soon } }],
  },
] as ComparisonGroup[]

const cardOf = (name: string) => screen.getByRole('heading', { name: new RegExp(`^${name} (Monthly|Yearly)$`) }).closest('section') as HTMLElement

describe('the rules', () => {
  it('headline: a paid viewer is told their plan; everyone else the rule and the cheapest monthly price', () => {
    expect(pricingHeadline({ planIds: ['supreme'], planName: 'AF Supreme', renewsAt: null, tokenBalance: null }, PLANS)).toEqual({
      kind: 'plan',
      planName: 'AF Supreme',
      supreme: true,
    })
    expect(pricingHeadline({ planIds: ['pro'], planName: 'AF Pro', renewsAt: null, tokenBalance: null }, PLANS)).toEqual({
      kind: 'plan',
      planName: 'AF Pro',
      supreme: false,
    })
    expect(pricingHeadline(null, PLANS)).toEqual({ kind: 'free', fromMonthly: 9.99 })
    expect(pricingHeadline({ planIds: [], planName: null, renewsAt: null, tokenBalance: 3 }, PLANS)).toEqual({ kind: 'free', fromMonthly: 9.99 })
    expect(pricingHeadline(null, [])).toEqual({ kind: 'free', fromMonthly: null })
  })

  it('yearly saving is the range across the plans, not only the smallest', () => {
    expect(yearlySavingsRange(PLANS)).toEqual({ min: 28, max: 33 })
    expect(yearlySavingsRange([PLANS[0]])).toEqual({ min: 33, max: 33 })
    expect(yearlySavingsRange([{ ...PLANS[0], savings: null }])).toBeNull()
  })

  it('Supreme value is real arithmetic for the interval on screen, and absent when it does not hold', () => {
    expect(supremeValue(PLANS, 'month')).toEqual({ supreme: 19.99, separately: 24.98 })
    expect(supremeValue(PLANS, 'year')).toEqual({ supreme: 159.99, separately: 209.98 })
    const dear = PLANS.map((p) => (p.planFamily === 'af_supreme' ? { ...p, monthlyPrice: 30 } : p))
    expect(supremeValue(dear, 'month')).toBeNull()
    expect(supremeValue(PLANS.slice(1), 'month')).toBeNull()
  })

  it('the bullet it replaces is still spelled the way planIncludes spells it', () => {
    // If this fails, the Supreme card would print the value twice again.
    expect(PLAN_FAMILY_INCLUDES.af_supreme).toContain(SUPREME_VALUE_BULLET)
  })

  it('pulls out only rows that are Coming soon on every plan, and drops a group left empty', () => {
    const { groups, soon: rows } = splitComingSoon(COMPARISON)
    expect(rows.map((r) => r.id)).toEqual(['keepers', 'voting'])
    expect(groups.map((g) => g.id)).toEqual(['run', 'mixed'])
  })
})

describe('the page', () => {
  it('a visitor gets the rule and the cheapest price as the headline, and one honest saving range', () => {
    render(<PricingV4 plans={PLANS} packs={[]} />)
    expect(screen.getByTestId('pricing-headline').textContent).toBe('Every league is free. Plans from $9.99 a month')
    expect(screen.getByTestId('pricing-save-chip').textContent).toBe('Save 28–33% paying yearly')
    expect(screen.queryByText(/Win more with tools/)).toBeNull()
  })

  it('a Supreme member is told what they have', () => {
    render(<PricingV4 plans={PLANS} packs={[]} signedIn account={{ planIds: ['supreme'], planName: 'AF Supreme', renewsAt: null, tokenBalance: null }} />)
    expect(screen.getByTestId('pricing-headline').textContent).toBe('You’re on AF Supreme')
    expect(screen.getByTestId('pricing-intro').textContent).toMatch(/^Every paid tool is included/)
  })

  it('says Supreme is cheaper once, with numbers, and follows the interval', () => {
    render(<PricingV4 plans={PLANS} packs={[]} />)
    const card = cardOf('AF Supreme')
    expect(within(card).getByTestId('pricing-supreme-value').textContent).toBe('Both paid plans for $19.99 a month instead of $24.98.')
    expect(within(card).queryByText(SUPREME_VALUE_BULLET)).toBeNull()
    expect(within(card).queryByText('Best value')).toBeNull()
    expect(card.textContent).not.toMatch(/less than buying both/)

    fireEvent.click(screen.getByRole('button', { name: 'Yearly' }))
    expect(within(cardOf('AF Supreme')).getByTestId('pricing-supreme-value').textContent).toBe('Both paid plans for $159.99 a year instead of $209.98.')
  })

  it('shows yearly prices once — on the cards — and keeps the yearly checkout buttons', () => {
    render(<PricingV4 plans={PLANS} packs={[]} />)
    expect(screen.queryByText(/if you.d rather pay once/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Yearly' }))
    const page = document.body.textContent ?? ''
    expect(page.split('$79.99').length - 1).toBe(1)
    expect(screen.getByTestId('pricing-subscription-cta-af_pro_yearly')).toBeTruthy()
  })

  it('drops the "What you can do" boxes', () => {
    render(<PricingV4 plans={PLANS} packs={[]} />)
    expect(screen.queryByTestId('pricing-plan-examples')).toBeNull()
  })

  it('folds the comparison, and turns the all-Coming-soon rows into one line', () => {
    render(<PricingV4 plans={PLANS} packs={[]} comparison={COMPARISON} />)
    const compare = screen.getByTestId('pricing-compare')
    expect(compare.tagName).toBe('DETAILS')
    expect((compare as HTMLDetailsElement).open).toBe(false)
    expect(within(compare).getByText('Compare every feature')).toBeTruthy()
    expect(within(compare).queryByTestId('pricing-compare-row-keepers')).toBeNull()
    expect(within(compare).getByTestId('pricing-compare-row-health')).toBeTruthy()
    expect(screen.getByTestId('pricing-coming-soon').textContent).toBe(
      'Coming soon on every plan: Keepers on the draft board, Rule-change voting.'
    )
  })

  it('a signed-in viewer has one Back to app, in the header — not again at the foot', () => {
    const { container } = render(<PricingV4 plans={PLANS} packs={[]} signedIn />)
    expect(container.querySelector('.af-pr-foot a[href="/core"]')).toBeNull()
  })

  it('a visitor still ends on Start free', () => {
    const { container } = render(<PricingV4 plans={PLANS} packs={[]} />)
    expect(container.querySelector('.af-pr-foot a[href="/signup"]')?.textContent).toBe('Start free')
  })
})

describe('Spanish', () => {
  it('defines every message', () => {
    expect(missingMessages(pricingGuideMessages, 'es')).toEqual([])
  })
})
