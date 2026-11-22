/**
 * The signed-in viewer's standing on /pricing (the Plans board's "You're on …" banner and the YOUR PLAN
 * chip). Read on the server from the same entitlement resolver the /core shell uses; null for a
 * signed-out visitor or a failed read, in which case the page renders exactly as it did before.
 */
export type PricingAccount = {
  /** Plans actually held (not bundle-expanded), e.g. ['supreme']. Empty on the free tier. */
  planIds: string[]
  /** Display name of the first held plan; null on the free tier. */
  planName: string | null
  /** ISO end of the current billing period, when the entitlement carries one. */
  renewsAt: string | null
  /** Spendable tokens; null when the read did not return one. */
  tokenBalance: number | null
  /** Tokens spent per week, net of refunds, oldest first (lib/tokens/weeklyTokenSpend.ts); null when unread. */
  weeklySpend?: { weekStart: string; spent: number }[] | null
}

const FAMILY_BY_PLAN: Record<string, string> = {
  pro: 'af_pro',
  commissioner: 'af_commissioner',
  supreme: 'af_supreme',
}

/** AF Supreme bundles these two (lib/subscription/types.ts, SUPREME_INCLUDED_PLAN_IDS). */
const SUPREME_INCLUDES = new Set(['af_pro', 'af_commissioner'])

/**
 * `yours` — the viewer holds this plan; `included` — they hold Supreme and this lane is inside it;
 * null — neither (or no account). The Free card is `yours` only for a signed-in viewer with no plan.
 */
export function pricingCardStatus(family: string, account: PricingAccount | null): 'yours' | 'included' | null {
  if (!account) return null
  if (family === 'free') return account.planIds.length === 0 ? 'yours' : null
  const held = account.planIds.map((id) => FAMILY_BY_PLAN[id]).filter(Boolean)
  if (held.includes(family)) return 'yours'
  if (account.planIds.includes('supreme') && SUPREME_INCLUDES.has(family)) return 'included'
  return null
}
