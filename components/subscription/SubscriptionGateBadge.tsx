'use client'

import { getGateDef } from '@/lib/subscription/featureGating'
import type { SubscriptionFeatureId } from '@/lib/subscription/types'

export function SubscriptionGateBadge({
  featureId,
  onClick,
  size = 'xs',
}: {
  featureId: SubscriptionFeatureId
  onClick?: () => void
  size?: 'xs' | 'sm'
}) {
  const def = getGateDef(featureId)
  const planLabel = def.requiredPlanDisplay[0] ?? 'Subscription'

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${def.label} requires ${planLabel}`}
      className={[
        'inline-flex items-center gap-1 rounded-full border border-amber-500/25',
        'bg-amber-500/10 font-semibold text-amber-300/80',
        'transition hover:border-amber-400/40 hover:text-amber-200',
        'focus:outline-none focus:ring-1 focus:ring-amber-400/30',
        size === 'xs' ? 'px-1.5 py-0.5 text-[11px]' : 'px-2 py-0.5 text-[11px]',
      ].join(' ')}
    >
      🔒 {planLabel}
    </button>
  )
}
