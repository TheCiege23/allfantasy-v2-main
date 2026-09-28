import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

/*
 * The token pages say only what tokens actually buy (lib/tokens/tokenPurchasable.ts).
 * Before 2026-09-25 /tokens listed all 64 priced actions — 51 of which no screen could buy —
 * promised "every action shows its cost before you click", and rendered every recent-spend row
 * as a blank name and "0". Lock cards offered "Or use N tokens" for features that take none,
 * and the AF Legacy spotlight had a "Buy tokens" button for a rule nothing charges.
 */

vi.mock('@/components/i18n/LanguageProviderClient', async () => {
  const { translations } = await import('@/lib/i18n/translations')
  return { useLanguage: () => ({ t: (k: string) => translations.en[k] ?? k }) }
})
vi.mock('@/hooks/useTokenBalance', () => ({ useTokenBalance: () => ({ balance: 120, loading: false }) }))
vi.mock('@/hooks/usePostPurchaseSync', () => ({
  usePostPurchaseSync: () => ({ state: { phase: 'idle', message: '' }, retrySync: vi.fn() }),
}))
vi.mock('@/components/monetization/CheckoutOutcomePanel', () => ({ CheckoutOutcomePanel: () => null }))

vi.mock('@/hooks/useEntitlement', () => ({
  useEntitlement: () => ({
    featureAccess: false,
    loading: false,
    entitlement: { status: 'none', requiredPlan: null, message: null },
    upgradePath: '/upgrade?plan=pro',
  }),
}))
vi.mock('@/hooks/useAccessTier', () => ({ useAccessTier: () => ({ isGuest: false, loading: false }) }))
const preview = vi.hoisted(() => vi.fn(async (code: string) => ({ ruleCode: code, tokenCost: 30, featureLabel: 'x' })))
vi.mock('@/lib/tokens/client-confirm', () => ({ previewTokenSpend: preview }))

import { TokenCentreV4 } from '@/components/core-app/screens/TokenCentreV4'
import { FeatureGate } from '@/components/subscription/FeatureGate'
import { AFWarRoomPlanSpotlight } from '@/components/monetization/AFWarRoomPlanSpotlight'
import { listTokenSpendRuleMatrix } from '@/lib/tokens/pricing-matrix'
import { TOKEN_PURCHASABLE_RULES } from '@/lib/tokens/tokenPurchasable'

const PACKS = [
  { sku: 'af_tokens_5', amountUsd: 4.99, tokenAmount: 250 },
  { sku: 'af_tokens_25', amountUsd: 19.99, tokenAmount: 1500 },
]

function stubApis() {
  const rules = listTokenSpendRuleMatrix().map((r) => ({ ...r, requiredPlan: r.requiredPlan }))
  const entries = [
    // The history API's real shape (TokenSpendService `toLedgerView`).
    { id: 'l1', entryType: 'spend', tokenDelta: -10, spendFeatureLabel: 'Chimmy chat message', description: null, createdAt: '2026-09-24T12:00:00.000Z' },
    { id: 'l2', entryType: 'purchase', tokenDelta: 250, spendFeatureLabel: null, description: 'Token pack purchase', tokenPackageSku: 'af_tokens_5', createdAt: '2026-09-23T12:00:00.000Z' },
  ]
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input)
      const body = url.includes('/api/tokens/spend-rules') ? { rules } : url.includes('/api/tokens/history') ? { entries } : {}
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    }),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  stubApis()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('/tokens', () => {
  it('🛑 lists only the 13 actions a screen can sell — not the 64 the price table holds', async () => {
    render(<TokenCentreV4 packs={PACKS} />)
    const list = await screen.findByTestId('tokens-buyable-list')
    expect(list.querySelectorAll('li')).toHaveLength(TOKEN_PURCHASABLE_RULES.length)
    for (const r of TOKEN_PURCHASABLE_RULES) {
      expect(screen.getByTestId(`tokens-rule-${r.code}`).textContent).toContain(r.label)
    }
    // Priced but unsellable — gone.
    expect(screen.queryByTestId('tokens-rule-ai_war_room_multi_step_planning')).toBeNull()
    expect(document.body.textContent).not.toContain('Survivor quick vote-risk check')
  })

  it('says who can buy the commissioner and pool-manager actions', async () => {
    render(<TokenCentreV4 packs={PACKS} />)
    expect((await screen.findByTestId('tokens-rule-commissioner_ai_cycle_run')).textContent).toContain('commissioners only')
    expect(screen.getByTestId('tokens-rule-world_cup_ai_commissioner_report').textContent).toContain('pool managers only')
    expect(screen.getByTestId('tokens-rule-ai_chimmy_chat_message').textContent).not.toContain('only')
  })

  it('🛑 says what tokens do NOT buy, and drops the promise the product does not keep', async () => {
    render(<TokenCentreV4 packs={PACKS} />)
    await screen.findByTestId('tokens-buyable-list')
    const not = screen.getByTestId('tokens-not-included').textContent ?? ''
    expect(not).toContain("What tokens don't buy")
    expect(not).toContain('AF Pro')
    expect(not).toContain('Survivor and Big Brother AI')
    expect(document.body.textContent).not.toContain('before you click')
    expect(document.body.textContent).toContain('never expire')
  })

  it('a pack says what it buys in Chimmy questions, from the live Chimmy price', async () => {
    render(<TokenCentreV4 packs={PACKS} />)
    expect((await screen.findByTestId('tokens-pack-about-af_tokens_5')).textContent).toBe('About 25 Chimmy questions')
    expect(screen.getByTestId('tokens-pack-about-af_tokens_25').textContent).toBe('About 150 Chimmy questions')
  })

  it('🛑 recent spend shows what was bought and how much — not a blank name and "0"', async () => {
    render(<TokenCentreV4 packs={PACKS} />)
    await waitFor(() => expect(document.body.textContent).toContain('Chimmy chat message'))
    expect(document.body.textContent).toContain('-10')
    expect(document.body.textContent).toContain('Token pack purchase')
    expect(document.body.textContent).toContain('+250')
  })
})

describe('lock cards', () => {
  it('offers tokens for a feature that takes them', async () => {
    render(
      <FeatureGate featureId={'trade_analyzer' as never} tokenRuleCodeOverride={'ai_trade_analyzer_full_review' as never}>
        <p>unlocked</p>
      </FeatureGate>,
    )
    const link = await screen.findByTestId('locked-feature-token-fallback-link')
    expect(link.getAttribute('href')).toBe('/tokens?ruleCode=ai_trade_analyzer_full_review')
  })

  it('🛑 never offers tokens for a feature nothing will charge', async () => {
    render(
      <FeatureGate
        featureId={'draft_strategy_build' as never}
        tokenRuleCodeOverride={'ai_draft_helper_session_recommendation' as never}
      >
        <p>unlocked</p>
      </FeatureGate>,
    )
    await screen.findByTestId('locked-feature-upgrade-link').catch(() => screen.findByTestId('locked-feature-upgrade-button'))
    expect(screen.queryByTestId('locked-feature-token-fallback-link')).toBeNull()
    expect(preview).not.toHaveBeenCalled()
  })
})

describe('AF Legacy spotlight', () => {
  it('🛑 has no "Buy tokens" button — no AF Legacy tool accepts tokens', () => {
    render(<AFWarRoomPlanSpotlight />)
    expect(screen.queryByTestId('af-war-room-token-link')).toBeNull()
    expect(document.body.textContent).not.toMatch(/tokens where policy allows/i)
    expect(screen.getByTestId('af-war-room-upgrade-link').getAttribute('href')).toBe('/upgrade?plan=war_room')
  })
})
