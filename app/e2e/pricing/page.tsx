import { getMonetizationCatalog } from '@/lib/monetization/catalog'
import { getPlanPresentations } from '@/lib/monetization/planPresentation'
import { buildPlanComparison } from '@/lib/monetization/planComparison'
import type { PricingPlan, PricingPack } from '@/components/core-app/screens/PricingV4'
import type { PricingAccount } from '@/lib/core-app/pricingAccount'
import PricingHarnessClient from './PricingHarnessClient'

/**
 * DB-free render of /pricing for visual review. Production is refused by app/e2e/layout.tsx.
 * Prices come from the real catalog, exactly as app/pricing/page.tsx reads them; only the account is
 * made up.
 *
 *   /e2e/pricing                  a visitor (not signed in)
 *   /e2e/pricing?state=free       a signed-in free account with 40 tokens
 *   /e2e/pricing?state=supreme    an AF Supreme member who spent tokens recently
 *   /e2e/pricing?state=pro        an AF Pro member
 */
type State = 'visitor' | 'free' | 'supreme' | 'pro'

const WEEKS = ['2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09']

const ACCOUNTS: Record<State, PricingAccount | null> = {
  visitor: null,
  free: { planIds: [], planName: null, renewsAt: null, tokenBalance: 40, weeklySpend: WEEKS.map((weekStart) => ({ weekStart, spent: 0 })) },
  supreme: {
    planIds: ['supreme'],
    planName: 'AF Supreme',
    renewsAt: '2026-12-14T12:00:00.000Z',
    tokenBalance: 120,
    weeklySpend: WEEKS.map((weekStart, i) => ({ weekStart, spent: [0, 4, 12, 0, 9, 22, 6, 3][i] })),
  },
  pro: { planIds: ['pro'], planName: 'AF Pro', renewsAt: '2026-12-02T12:00:00.000Z', tokenBalance: 0, weeklySpend: null },
}

export default async function PricingHarnessPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const { state: raw } = await searchParams
  const state: State = raw === 'free' || raw === 'supreme' || raw === 'pro' ? raw : 'visitor'

  const plans: PricingPlan[] = getPlanPresentations().map((p) => ({
    planFamily: p.planFamily,
    name: p.name,
    description: p.description,
    monthlySku: p.monthly?.sku ?? null,
    monthlyPrice: p.monthly?.amountUsd ?? null,
    yearlySku: p.yearly?.sku ?? null,
    yearlyPrice: p.yearly?.amountUsd ?? null,
    savings: p.savings
      ? { savedUsd: p.savings.savedUsd, savedPct: p.savings.savedPct, effectiveMonthly: p.savings.effectiveMonthly }
      : null,
  }))
  const packs: PricingPack[] = getMonetizationCatalog().tokenPacks.map((t) => ({
    sku: t.sku,
    title: t.title,
    amountUsd: t.amountUsd,
    tokenAmount: t.tokenAmount,
  }))

  return (
    <PricingHarnessClient
      plans={plans}
      packs={packs}
      signedIn={state !== 'visitor'}
      account={ACCOUNTS[state]}
      comparison={buildPlanComparison()}
    />
  )
}
