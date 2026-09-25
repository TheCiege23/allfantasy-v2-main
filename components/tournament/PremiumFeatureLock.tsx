'use client'

import Link from 'next/link'
import { Lock } from 'lucide-react'
import type { AfPlanId } from '@/lib/tournament/af-premium-plans'
import { AF_PLANS } from '@/lib/tournament/af-premium-plans'
import { upgradePathForPlan } from '@/lib/monetization/upgradeDestination'
import { cn } from '@/lib/utils'

export function PremiumFeatureLock({
  requiredPlan,
  featureLabel,
  className,
}: {
  requiredPlan: AfPlanId
  featureLabel: string
  className?: string
}) {
  const plan = AF_PLANS[requiredPlan]
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/25 bg-amber-950/20 px-3 py-2 text-[11px] text-amber-100/90',
        className,
      )}
    >
      <Lock className="h-3.5 w-3.5 shrink-0 text-amber-400/90" aria-hidden />
      <span>
        <span className="font-semibold">{featureLabel}</span> requires{' '}
        <span className="text-amber-50">{plan.label}</span>.
      </span>
      {/* The plan's checkout — `/settings` sells nothing. */}
      <Link href={upgradePathForPlan(requiredPlan)} className="ml-auto font-semibold text-cyan-300 underline-offset-2 hover:text-cyan-200 hover:underline">
        View plans
      </Link>
    </div>
  )
}
