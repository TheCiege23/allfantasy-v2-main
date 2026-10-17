'use client'

import { useState } from 'react'
import Link from 'next/link'
import { SubscriptionGateModal } from '@/components/subscription/SubscriptionGateModal'
import type { SubscriptionFeatureId } from '@/lib/subscription/types'

const PRO_LEAGUE_NAV_FEATURE: SubscriptionFeatureId = 'pro_start_sit'

export type ProLeagueLinkProps = {
  leagueId: string
  leagueName: string
  label?: string
  hasProAccess: boolean
  /** Optional path override (e.g. ?tab=trades). */
  href?: string
}

export function ProLeagueLink({
  leagueId,
  leagueName,
  label = 'Open league →',
  hasProAccess,
  href,
}: ProLeagueLinkProps) {
  const [gateOpen, setGateOpen] = useState(false)
  const to = href ?? `/league/${leagueId}`

  if (hasProAccess) {
    return (
      <Link href={to} className="text-[11px] font-semibold text-cyan-400 transition hover:text-cyan-300">
        {label}
      </Link>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setGateOpen(true)}
        className="inline-flex items-center gap-1 text-[11px] font-semibold text-white/35 transition hover:text-white/60"
        title="AF Pro required to open leagues from dashboard"
        aria-label={`Open ${leagueName} (PRO)`}
      >
        {label}
        <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1 py-0.5 text-[11px] text-amber-400">
          PRO
        </span>
      </button>
      <SubscriptionGateModal
        isOpen={gateOpen}
        onClose={() => setGateOpen(false)}
        featureId={PRO_LEAGUE_NAV_FEATURE}
      />
    </>
  )
}
