import { getMonetizationCatalog } from '@/lib/monetization/catalog'
import { listTokenSpendRuleMatrix } from '@/lib/tokens/pricing-matrix'
import TokensHarnessClient from './TokensHarnessClient'

/**
 * DB-free render of /tokens for visual review. Production is refused by app/e2e/layout.tsx. Packs and
 * spend rules are the real catalog and price matrix; only the balance and the history are made up.
 *
 *   /e2e/tokens                 250 tokens, a mixed history like the owner's account
 *   /e2e/tokens?state=low       12 tokens, nothing bought yet
 *   /e2e/tokens?state=error     the balance read failed
 */
export default async function TokensHarnessPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const { state: raw } = await searchParams
  const state = raw === 'low' || raw === 'error' ? raw : 'normal'
  const packs = getMonetizationCatalog().tokenPacks.map((t) => ({ sku: t.sku, amountUsd: t.amountUsd, tokenAmount: t.tokenAmount }))
  const rules = listTokenSpendRuleMatrix().map((r) => ({ code: r.code, tokenCost: r.tokenCost }))
  return <TokensHarnessClient state={state} packs={packs} rules={rules} />
}
