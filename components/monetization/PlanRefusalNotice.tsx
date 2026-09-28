'use client'

import Link from 'next/link'
import { Lock } from 'lucide-react'

import type { PlanRefusal } from '@/lib/monetization/planRefusal'

/**
 * What a screen shows when the server says "that needs a plan" (or "that's today's limit", or
 * "sign in first"): the server's own sentence and the one button that fixes it. See
 * lib/monetization/planRefusal.ts for why this exists — from Oct 15 these answers used to print as
 * the bare words "Premium feature".
 *
 * `block` is the centred version for a tool modal's body; `inline` sits where an error line was.
 */
export function PlanRefusalNotice({
  refusal,
  variant = 'inline',
  className = '',
}: {
  refusal: PlanRefusal
  variant?: 'block' | 'inline'
  className?: string
}) {
  const action =
    refusal.actionHref && refusal.actionLabel ? (
      <Link
        href={refusal.actionHref}
        className="inline-flex min-h-[44px] items-center rounded-lg border border-amber-300/40 bg-amber-500/20 px-4 text-[13px] font-semibold text-amber-100 hover:bg-amber-500/30"
        data-testid="plan-refusal-action"
      >
        {refusal.actionLabel}
      </Link>
    ) : null

  if (variant === 'block') {
    return (
      <div className={`flex flex-col items-center py-12 text-center ${className}`} data-testid="plan-refusal" role="status">
        <div className="flex h-12 w-12 items-center justify-center rounded-full border border-amber-400/30 bg-amber-500/10">
          <Lock className="h-5 w-5 text-amber-200" aria-hidden />
        </div>
        <p className="mt-4 max-w-sm text-[13px] text-[#c9cfe0]">{refusal.message}</p>
        {action ? <div className="mt-4">{action}</div> : null}
      </div>
    )
  }

  return (
    <div
      className={`flex flex-wrap items-center gap-3 rounded-[10px] border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-50 ${className}`}
      data-testid="plan-refusal"
      role="status"
    >
      <Lock className="h-4 w-4 shrink-0 text-amber-200" aria-hidden />
      <span className="min-w-0 flex-1">{refusal.message}</span>
      {action}
    </div>
  )
}
