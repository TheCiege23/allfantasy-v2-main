/**
 * /tokens guide pass (2026-11-14): the balance as the headline in Chimmy questions, packs before the
 * price list, one fold for what tokens don't cover, plain-word activity, and a way back to the app.
 * Also pins the styling fix: the root carries `af-core`, without which six colour tokens were empty.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'

const balanceState = vi.hoisted(() => ({ value: { balance: 250 as number | null, loading: false } }))

vi.mock('@/components/i18n/LanguageProviderClient', async () => {
  const { translations } = await import('@/lib/i18n/translations')
  return { useLanguage: () => ({ t: (k: string) => translations.en[k] ?? k }), useOptionalLanguage: () => ({ language: 'en' }) }
})
vi.mock('@/hooks/useTokenBalance', () => ({ useTokenBalance: () => balanceState.value }))
vi.mock('@/hooks/usePostPurchaseSync', () => ({
  usePostPurchaseSync: () => ({ state: { phase: 'idle', message: '' }, retrySync: vi.fn() }),
}))
vi.mock('@/components/monetization/CheckoutOutcomePanel', () => ({ CheckoutOutcomePanel: () => null }))

import { TokenCentreV4 } from '@/components/core-app/screens/TokenCentreV4'
import { activityRow, tokensHeadline } from '@/lib/core-app/tokensGuide'
import { tokensGuideMessages } from '@/lib/core-app/messages/tokensGuide'
import { listTokenSpendRuleMatrix } from '@/lib/tokens/pricing-matrix'
import { missingMessages } from '@/lib/i18n/messages'

const PACKS = [{ sku: 'af_tokens_5', amountUsd: 4.99, tokenAmount: 250 }]

/** The real ledger shapes, including the two older descriptions seen on the owner's account. */
const ENTRIES = [
  { id: 'a', entryType: 'spend', tokenDelta: -30, spendFeatureLabel: 'Full trade review', createdAt: '2026-11-12T20:00:00Z' },
  { id: 'b', entryType: 'purchase', tokenDelta: 5, description: 'Stripe purchase: AllFantasy AI Tokens (5)', createdAt: '2026-11-10T15:00:00Z' },
  { id: 'c', entryType: 'adjustment', tokenDelta: 0, description: 'Daily free allowance (20 token floor)', createdAt: '2026-11-09T09:00:00Z' },
  { id: 'd', entryType: 'adjustment', tokenDelta: 15, description: 'Daily free allowance (20 token floor)', createdAt: '2026-11-08T09:00:00Z' },
  { id: 'e', entryType: 'adjustment', tokenDelta: 20, sourceType: 'daily_free_tokens', description: 'Daily free floor: 2 Chimmy questions', createdAt: '2026-11-07T09:00:00Z' },
  { id: 'f', entryType: 'refund', tokenDelta: 10, spendFeatureLabel: 'Chimmy question', createdAt: '2026-11-06T09:00:00Z' },
]

function stubApis() {
  const rules = listTokenSpendRuleMatrix()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input)
      const body = url.includes('/api/tokens/spend-rules') ? { rules } : url.includes('/api/tokens/history') ? { entries: ENTRIES } : {}
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    }),
  )
}

beforeEach(() => {
  balanceState.value = { balance: 250, loading: false }
  stubApis()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('the rules', () => {
  it('the headline is the balance, and what it buys in Chimmy questions', () => {
    expect(tokensHeadline(250, false, 10)).toEqual({ kind: 'balance', balance: 250, questions: 25 })
    expect(tokensHeadline(9, false, 10)).toEqual({ kind: 'balance', balance: 9, questions: 0 })
    expect(tokensHeadline(250, false, null)).toEqual({ kind: 'balance', balance: 250, questions: null })
    expect(tokensHeadline(null, true, 10)).toEqual({ kind: 'loading' })
    // /tokens is behind sign-in, so a missing balance is a failed read — never "sign in".
    expect(tokensHeadline(null, false, 10)).toEqual({ kind: 'unavailable' })
  })

  it('history rows read in plain words, and a row that changed nothing is dropped', () => {
    const rows = ENTRIES.map(activityRow)
    expect(rows.map((r) => r && r.kind)).toEqual(['spend', 'bought', null, 'dailyTopUp', 'dailyTopUp', 'refund'])
    expect(rows[0]).toMatchObject({ label: 'Full trade review', delta: -30 })
    expect(rows[5]).toMatchObject({ label: 'Chimmy question', delta: 10 })
  })
})

describe('the page', () => {
  it('says the balance as an answer, with the number keeping its e2e id', async () => {
    render(<TokenCentreV4 packs={PACKS} />)
    await waitFor(() => expect(screen.getByTestId('tokens-headline').textContent).toBe('You have 250 tokens: about 25 Chimmy questions'))
    expect(screen.getByTestId('tokens-balance-display').textContent).toBe('250')
  })

  it('a failed balance read says so, rather than asking a signed-in viewer to sign in', () => {
    balanceState.value = { balance: null, loading: false }
    render(<TokenCentreV4 packs={PACKS} />)
    expect(screen.getByTestId('tokens-headline').textContent).toBe('We couldn’t load your balance')
    expect(document.body.textContent).not.toMatch(/Sign in to see/)
  })

  it('has a way back to the app and to the plans', () => {
    render(<TokenCentreV4 packs={PACKS} />)
    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(within(nav).getByTestId('tokens-back-to-app').getAttribute('href')).toBe('/core')
    expect(within(nav).getByRole('link', { name: 'See plans' }).getAttribute('href')).toBe('/pricing')
  })

  it('puts the packs before the price list', async () => {
    render(<TokenCentreV4 packs={PACKS} />)
    const list = await screen.findByTestId('tokens-buyable-list')
    const buy = screen.getByTestId('tokens-buy-cta-af_tokens_5')
    expect(buy.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('folds what tokens don’t cover into one section, closed', () => {
    render(<TokenCentreV4 packs={PACKS} />)
    const fold = screen.getByTestId('tokens-not-included') as HTMLDetailsElement
    expect(fold.tagName).toBe('DETAILS')
    expect(fold.open).toBe(false)
    expect(fold.textContent).toContain('What tokens don’t cover')
    expect(fold.textContent).toContain('AF Pro')
    expect(fold.textContent).toContain('lineup checks')
    expect(screen.queryByText('What never costs tokens')).toBeNull()
  })

  it('calls the history Recent activity, in plain words, with no 0 rows', async () => {
    render(<TokenCentreV4 packs={PACKS} />)
    const list = await screen.findByTestId('tokens-activity')
    const text = list.textContent ?? ''
    expect(screen.queryByText('Recent spend')).toBeNull()
    expect(screen.getByText('Recent activity')).toBeTruthy()
    expect(text).toContain('Bought 5 tokens')
    expect(text).toContain('Daily free top-up')
    expect(text).toContain('Refund: Chimmy question')
    expect(text).not.toMatch(/Stripe purchase|token floor/)
    expect(list.querySelectorAll('li')).toHaveLength(5)
  })

  it('does not say "AI" in the intro, and keeps the rules the old page stated', () => {
    render(<TokenCentreV4 packs={PACKS} />)
    const intro = screen.getByTestId('tokens-intro').textContent ?? ''
    expect(intro).not.toMatch(/\bAI\b/)
    expect(document.body.textContent).toContain('never expire')
    expect(document.body.textContent).toContain('once a day')
  })

  it('carries the af-core class, so the colour tokens the stylesheet reads exist', () => {
    const { container } = render(<TokenCentreV4 packs={PACKS} />)
    expect((container.firstElementChild as HTMLElement).classList.contains('af-core')).toBe(true)
  })
})

describe('Spanish', () => {
  it('defines every message', () => {
    expect(missingMessages(tokensGuideMessages, 'es')).toEqual([])
  })
})
