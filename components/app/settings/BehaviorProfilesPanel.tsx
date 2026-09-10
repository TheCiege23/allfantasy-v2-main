'use client'

import Link from 'next/link'
import type { LeagueTabProps } from '@/components/app/tabs/types'

export default function BehaviorProfilesPanel({ leagueId }: LeagueTabProps) {
  return <section aria-label="Competitive Edge" className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
    <h2 className="text-lg font-semibold text-white">Competitive Edge</h2>
    <p className="text-sm text-white/70">Use your league's trade, draft and waiver tools to evaluate a specific move. Complete manager profiles and personality scores are private.</p>
    <p className="text-sm text-white/60">Decision-specific negotiation evidence is still being connected. No acceptance prediction is available here yet.</p>
    <Link href={'/app/league/' + encodeURIComponent(leagueId)} className="inline-block text-sm text-cyan-300">Open league decisions</Link>
  </section>
}
