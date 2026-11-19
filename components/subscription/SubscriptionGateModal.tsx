'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { getGateDef } from '@/lib/subscription/featureGating'
import { buildFeatureUpgradePath } from '@/lib/subscription/feature-access'
import { monthlyUpgradeHref } from '@/lib/monetization/upgradeDestination'
import { withQueryParam } from '@/lib/monetization/checkout-urls'
import { useLockUpgradeHref } from '@/hooks/useLockUpgradeHref'
import type { SubscriptionFeatureId } from '@/lib/subscription/types'

export function SubscriptionGateModal({
  isOpen,
  onClose,
  featureId,
  featureLabel,
  highlightParam: highlightParamOverride,
}: {
  isOpen: boolean
  onClose: () => void
  featureId: SubscriptionFeatureId
  featureLabel?: string
  /** Optional query `?highlight=` for pricing surfaces; overrides catalog default from getGateDef. */
  highlightParam?: string
}) {
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  const def = getGateDef(featureId)
  const highlight = highlightParamOverride ?? def.highlightParam
  const planUrl = buildFeatureUpgradePath(featureId) || def.upgradeUrl
  const upgradeUrl = useLockUpgradeHref(
    monthlyUpgradeHref(highlight ? withQueryParam(planUrl, 'highlight', highlight) : planUrl),
    `lock_${featureId}`,
  )

  if (!isOpen) return null

  const planNames = def.requiredPlanDisplay

  return (
    <>
      <div
        className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-[3px]"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="gate-modal-title"
        className="fixed left-1/2 top-1/2 z-[110] w-[92vw] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/10 bg-[#0d0f1c] shadow-2xl"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-white/50 transition hover:bg-white/[0.10] hover:text-white focus:outline-none focus:ring-2 focus:ring-white/20"
        >
          <svg viewBox="0 0 14 14" fill="none" className="h-3 w-3" stroke="currentColor" strokeWidth={2}>
            <path d="M1 1l12 12M13 1L1 13" strokeLinecap="round" />
          </svg>
        </button>

        <div className="pointer-events-none absolute inset-x-0 top-0 h-px rounded-t-2xl bg-gradient-to-r from-transparent via-cyan-400/40 to-transparent" />

        <div className="p-5 pt-6">
          <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]">
            <svg
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              className="h-5 w-5 text-cyan-400/80"
            >
              <rect x="4" y="9" width="12" height="9" rx="2" />
              <path d="M7 9V6a3 3 0 016 0v3" strokeLinecap="round" />
            </svg>
          </div>

          <h2 id="gate-modal-title" className="text-base font-bold text-white">
            {featureLabel ?? def.label}
          </h2>

          <p className="mt-1 text-sm text-white/55">
            This is a{' '}
            <span className="font-semibold text-cyan-300">{planNames.join(' or ')}</span> subscription
            feature.
          </p>

          <p className="mt-2 text-sm leading-relaxed text-white/70">{def.description}</p>

          <Link
            href={upgradeUrl}
            data-ios-purchase
            onClick={onClose}
            className="mt-5 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-sky-500 px-4 py-2.5 text-sm font-bold text-[#030b14] transition hover:from-cyan-400 hover:to-sky-400"
          >
            {def.upgradeLabel}
            <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
              <path
                d="M3.5 8.5h9M9 5l3.5 3.5L9 12"
                stroke="currentColor"
                strokeWidth={1.5}
                strokeLinecap="round"
                fill="none"
              />
            </svg>
          </Link>

          <Link
            href="/pricing"
            data-ios-purchase
            onClick={onClose}
            className="mt-2 flex min-h-[36px] w-full items-center justify-center rounded-xl border border-white/10 px-4 py-2 text-xs font-semibold text-white/60 transition hover:border-white/20 hover:text-white/80"
          >
            See all plans and features
          </Link>

          <button
            type="button"
            onClick={onClose}
            className="mt-3 w-full text-center text-[11px] text-white/25 transition hover:text-white/45"
          >
            Maybe later
          </button>
        </div>
      </div>
    </>
  )
}
