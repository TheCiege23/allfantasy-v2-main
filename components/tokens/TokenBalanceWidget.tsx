'use client'

import Link from 'next/link'
import { Coins, Loader2 } from 'lucide-react'
import { useTokenBalance } from '@/hooks/useTokenBalance'

export function TokenBalanceWidget() {
  const { balance, loading, error, refetch, isAdminBypassAccount } = useTokenBalance()

  return (
    <section
      className="rounded-xl border border-amber-400/25 bg-amber-500/10 p-3"
      aria-label="AI token balance"
      data-testid="token-balance-widget"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Coins className="h-4 w-4 text-amber-300" />
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-amber-100/90">AI Tokens</p>
        </div>
        <Link
          href="/tokens"
          className="rounded-md border border-amber-200/35 bg-black/20 px-2 py-1 text-[11px] text-amber-100 hover:bg-black/30"
          data-testid="token-balance-widget-open"
        >
          Open
        </Link>
      </div>
      <div className="mt-2 flex items-center gap-2">
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-amber-200/80" />
        ) : error || balance == null ? (
          <span className="text-xl font-semibold text-amber-100/50 tabular-nums" data-testid="token-balance-widget-unavailable">
            —
          </span>
        ) : (
          <span className="text-xl font-semibold text-amber-100 tabular-nums">{balance}</span>
        )}
        <span className="text-xs text-amber-100/75">available</span>
      </div>
      {isAdminBypassAccount && (
        <p className="mt-1.5 text-[10px] text-amber-100/50 italic" data-testid="token-balance-widget-bypass-notice">
          Admin bypass — synthetic balance, no ledger history
        </p>
      )}
      {error ? (
        <button
          type="button"
          onClick={() => void refetch()}
          className="mt-2 rounded-md border border-amber-200/35 bg-black/20 px-2 py-1 text-[11px] text-amber-100 hover:bg-black/30"
          data-testid="token-balance-widget-retry"
        >
          Retry balance
        </button>
      ) : null}
    </section>
  )
}
