import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TradeReviewPurchase } from '@/components/monetization/TradeReviewPurchase'
import { readTradeReviewDraft, saveTradeReviewDraft, tradeReviewPath, type TradeReviewDraft } from '@/lib/monetization/tradeReviewDraft'

const mocks = vi.hoisted(() => ({
  checkout: vi.fn(),
  hasAccess: false,
  cost: 30,
  canSpend: false,
  available: true,
}))

vi.mock('next-auth/react', () => ({ useSession: () => ({ status: 'authenticated' }) }))
vi.mock('@/lib/geo/useGeoRestriction', () => ({ useGeoRestriction: () => ({ isPaidBlocked: false, loading: false }) }))
vi.mock('@/lib/monetization/native-iap-client', () => ({ useNativeIapPrices: () => ({ nativeApp: false, prices: {} }) }))
vi.mock('@/lib/monetization/checkout-client', () => ({ resolveCheckoutUrl: mocks.checkout }))
vi.mock('@/hooks/useMonetizationContext', () => ({
  useMonetizationContext: () => ({
    feature: { hasAccess: mocks.hasAccess, available: mocks.available },
    previewsByRuleCode: new Map([['ai_trade_analyzer_full_review', { preview: { tokenCost: mocks.cost, canSpend: mocks.canSpend } }]]),
    loading: false,
    refetch: vi.fn(),
  }),
}))
vi.mock('@/lib/monetization-analytics', () => ({
  trackLockedFeatureViewed: vi.fn(),
  trackLockedFeatureConversionClick: vi.fn(),
  trackTokenPurchaseClicked: vi.fn(),
}))

const reviewDraft: TradeReviewDraft = {
  give: [{ kind: 'player', name: 'Player A' }],
  get: [{ kind: 'pick', year: 2027, round: 1 }, { kind: 'faab', amount: 10 }],
  sport: 'NFL',
  format: 'dynasty',
  leagueId: 'league-one',
}

beforeEach(() => {
  sessionStorage.clear()
  mocks.checkout.mockReset()
  mocks.hasAccess = false
  mocks.canSpend = false
  mocks.cost = 30
  mocks.available = true
})

afterEach(cleanup)

describe('the one-off trade review', () => {
  it('opens the existing Starter checkout with a short return path and leaves the token spend for after checkout', async () => {
    mocks.checkout.mockResolvedValue({ ok: false, error: 'Checkout unavailable' })
    const onReview = vi.fn()
    const back = tradeReviewPath(saveTradeReviewDraft(reviewDraft, 'known-draft', 'account-one'))
    render(<TradeReviewPurchase busy={false} onReview={onReview} saveReturnPath={() => back} />)

    expect(screen.getByText(/Starter pack covers 8 reviews/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Get 250 tokens · $4.99' }))
    await waitFor(() => expect(mocks.checkout).toHaveBeenCalledWith({
      sku: 'af_tokens_5', productType: 'token_pack', returnPath: back, entrySource: 'trade_review_starter_pack',
    }))
    expect(onReview).not.toHaveBeenCalled()
    expect(await screen.findByRole('alert')).toHaveTextContent('Checkout unavailable')
    expect(back).not.toContain('Player')
    expect(readTradeReviewDraft('known-draft', 'account-one')).toEqual(reviewDraft)
    expect(readTradeReviewDraft('known-draft', 'another-account')).toBeNull()
  })

  it('uses the quoted token cost when funded and shows a review action without checkout', () => {
    mocks.cost = 25
    mocks.canSpend = true
    const onReview = vi.fn()
    render(<TradeReviewPurchase busy={false} onReview={onReview} saveReturnPath={() => null} />)
    expect(screen.getByRole('button', { name: 'Unlock with AF Pro' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Review this trade · 25 tokens' }))
    expect(onReview).toHaveBeenCalledOnce()
    expect(mocks.checkout).not.toHaveBeenCalled()
  })

  it('hides both offers when the review tool is disabled', () => {
    mocks.available = false
    render(<TradeReviewPurchase busy={false} onReview={vi.fn()} saveReturnPath={() => null} />)
    expect(screen.getByRole('status')).toHaveTextContent('temporarily unavailable')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('lets a subscriber run the review without showing purchases', () => {
    mocks.hasAccess = true
    render(<TradeReviewPurchase busy={false} onReview={vi.fn()} saveReturnPath={() => null} />)
    expect(screen.getByRole('button', { name: 'Run full review' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Unlock with AF Pro' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('trade-starter-checkout')).not.toBeInTheDocument()
  })
})
