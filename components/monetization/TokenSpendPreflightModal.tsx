'use client'

/**
 * TokenSpendPreflightModal — confirms or blocks a token spend action.
 *
 * Insufficient balance state now shows:
 *  - How many more tokens are needed
 *  - Token pack options (with link to /tokens)
 *  - WassupFred coupon hint (20% off first purchase)
 *
 * Part 6 of the visual conversion build.
 */

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { AlertTriangle, Coins, Tag, Zap } from 'lucide-react'
import type { TokenSpendClientPreview } from '@/lib/tokens/client-confirm'
import {
  trackInsufficientTokenBuyClick,
  trackInsufficientTokenFlowViewed,
} from '@/lib/monetization-analytics'
import { trackAIInsufficientTokensShown } from '@/lib/promotions/couponAnalytics'

export function TokenSpendPreflightModal({
  open,
  preview,
  title,
  onClose,
  onConfirm,
  confirmLabel = 'Confirm token spend',
  testIdPrefix = 'token-preflight',
}: {
  open: boolean
  preview: TokenSpendClientPreview | null
  title: string
  onClose: () => void
  onConfirm: () => void
  confirmLabel?: string
  testIdPrefix?: string
}) {
  const trackedKeyRef = useRef<string | null>(null)
  const insufficient = Boolean(preview && !preview.canSpend)

  useEffect(() => {
    if (!open || !preview || !insufficient) return
    const nextKey = `${preview.ruleCode}:${preview.currentBalance}:${preview.tokenCost}`
    if (trackedKeyRef.current === nextKey) return
    trackedKeyRef.current = nextKey
    trackInsufficientTokenFlowViewed({
      surface: `token_preflight_modal:${testIdPrefix}`,
      ruleCode: preview.ruleCode,
      tokenCost: preview.tokenCost,
      currentBalance: preview.currentBalance,
    })
    trackAIInsufficientTokensShown({
      surface: `token_preflight_modal:${testIdPrefix}`,
      ruleCode: preview.ruleCode,
      tokenCost: preview.tokenCost,
      currentBalance: preview.currentBalance,
    })
  }, [insufficient, open, preview, testIdPrefix])

  if (!open || !preview) return null

  const tokensNeeded = insufficient ? Math.max(0, preview.tokenCost - preview.currentBalance) : 0

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 px-4">
      <div
        className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0a1228] p-4 shadow-2xl"
        data-testid={`${testIdPrefix}-modal`}
      >
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className={`mt-0.5 rounded-lg border p-1.5 ${insufficient ? 'border-red-400/35 bg-red-500/15' : 'border-amber-400/35 bg-amber-500/15'}`}>
            {insufficient ? (
              <AlertTriangle className="h-4 w-4 text-red-200" />
            ) : (
              <Coins className="h-4 w-4 text-amber-200" />
            )}
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">{title}</h3>
            <p className="mt-1 text-xs text-white/70">
              Cost:{" "}
              <span className="font-black text-amber-200">
                {preview.tokenCost} token{preview.tokenCost === 1 ? '' : 's'}
              </span>
            </p>
            <p className="mt-0.5 text-xs text-white/60">
              Your balance:{" "}
              <span className={`font-semibold ${insufficient ? 'text-red-200' : 'text-white'}`}>
                {preview.currentBalance} token{preview.currentBalance === 1 ? '' : 's'}
              </span>
            </p>
          </div>
        </div>

        {/* State messages */}
        {insufficient ? (
          <div
            className="mt-3 rounded-xl border border-red-400/25 bg-red-500/[0.08] p-3"
            data-testid={`${testIdPrefix}-insufficient-copy`}
          >
            <p className="flex items-start gap-1.5 text-xs font-semibold text-red-200">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Not enough tokens — you need {tokensNeeded} more to run this.
            </p>
            <p className="mt-1.5 text-[11px] text-white/50">
              Buy a token pack to continue. Your tokens never expire.
            </p>

            {/* WassupFred coupon hint */}
            <div className="mt-2.5 flex items-center gap-2 rounded-lg border border-amber-300/20 bg-amber-300/[0.06] px-2.5 py-2">
              <Tag className="h-3 w-3 shrink-0 text-amber-300" />
              <p className="text-[11px] text-white/60">
                Use code{" "}
                <span className="font-black text-amber-200">WassupFred</span>
                {" "}for 20% off your first pack
              </p>
            </div>
          </div>
        ) : (
          <p className="mt-3 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-2 text-xs text-cyan-100">
            No surprise deductions: tokens are only spent after you confirm.
          </p>
        )}

        {/* Actions */}
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/20 bg-black/20 px-3 py-1.5 text-xs text-white/85 hover:bg-white/10"
            data-testid={`${testIdPrefix}-cancel`}
          >
            Cancel
          </button>
          {insufficient ? (
            <Link
              href={`/tokens?ruleCode=${encodeURIComponent(preview.ruleCode)}`}
              onClick={() =>
                trackInsufficientTokenBuyClick({
                  surface: `token_preflight_modal:${testIdPrefix}`,
                  ruleCode: preview.ruleCode,
                })
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/40 bg-amber-500/20 px-3 py-1.5 text-xs font-bold text-amber-100 hover:bg-amber-500/30"
              data-testid={`${testIdPrefix}-buy-tokens`}
            >
              <Zap className="h-3 w-3" />
              Buy tokens
            </Link>
          ) : (
            <button
              type="button"
              onClick={onConfirm}
              className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-400/40 bg-cyan-500/15 px-3 py-1.5 text-xs font-medium text-cyan-100 hover:bg-cyan-500/25"
              data-testid={`${testIdPrefix}-confirm`}
            >
              <Coins className="h-3 w-3" />
              {confirmLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
