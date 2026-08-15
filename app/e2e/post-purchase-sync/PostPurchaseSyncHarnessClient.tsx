'use client'

import { Coins } from 'lucide-react'
import { usePostPurchaseSync } from '@/hooks/usePostPurchaseSync'
import { useTokenBalance } from '@/hooks/useTokenBalance'
import { InContextMonetizationCard } from '@/components/monetization/InContextMonetizationCard'

export function PostPurchaseSyncHarnessClient() {
  const postPurchaseSync = usePostPurchaseSync({
    successMessage: 'Purchase complete. Access and tokens are refreshed.',
    tokenSuccessMessage: 'Tokens added and refreshed.',
  })
  const { balance } = useTokenBalance()

  return (
    <main className="min-h-screen space-y-4 bg-[#05060a] p-6 text-white">
      <h1 className="text-xl font-semibold">E2E Post-Purchase Sync Harness</h1>

      {postPurchaseSync.state.phase !== 'idle' ? (
        <section
          className="rounded-xl border border-cyan-300/30 bg-cyan-500/10 p-3 text-sm text-cyan-100"
          data-testid="post-purchase-sync-banner"
        >
          <p data-testid="post-purchase-sync-status">{postPurchaseSync.state.message}</p>
          {(postPurchaseSync.state.phase === 'pending' ||
            postPurchaseSync.state.phase === 'failed') ? (
            <button
              type="button"
              onClick={() => void postPurchaseSync.retrySync()}
              disabled={postPurchaseSync.isSyncing}
              className="mt-2 rounded-lg border border-white/25 bg-black/25 px-3 py-2 text-xs font-semibold text-white/90 hover:bg-black/35 disabled:opacity-60"
              data-testid="post-purchase-sync-retry"
            >
              {postPurchaseSync.isSyncing ? 'Refreshing...' : 'Retry sync'}
            </button>
          ) : null}
        </section>
      ) : null}

      <section
        className="inline-flex items-center gap-2 rounded-lg border border-amber-400/35 bg-amber-500/10 px-3 py-2"
        data-testid="post-purchase-sync-token-balance"
      >
        <Coins className="h-4 w-4 text-amber-300" />
        <span className="text-sm font-semibold text-amber-100 tabular-nums">{balance}</span>
        <span className="text-xs text-amber-100/80">tokens available</span>
      </section>

      <InContextMonetizationCard
        title="Premium access check"
        featureId="trade_analyzer"
        tokenRuleCodes={['ai_trade_analyzer_full_review']}
        testIdPrefix="post-purchase-feature"
      />
    </main>
  )
}
