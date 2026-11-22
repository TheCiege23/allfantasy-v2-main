'use client'

import Link from 'next/link'
import type { SurvivorSettingsPanelProps } from './types'

export function SurvivorAdvancedPanel({ leagueId }: SurvivorSettingsPanelProps) {
  return <div className="space-y-4 px-6 py-6 text-sm text-white/80">
    <h3 className="font-semibold text-white">Advanced operations</h3>
    <p>Survivor audit events and live phase status are in the Commissioner Hub. Its “Fix a problem” card changes a Tribal Council result, redraws the tribes, starts the merge early, corrects a score or removes a manager who quit.</p>
    <Link href={`/survivor/${encodeURIComponent(leagueId)}/commissioner`} className="inline-flex rounded-xl border border-white/15 bg-white/[0.04] px-4 py-2 text-cyan-300 hover:bg-white/[0.08]">Open Commissioner Hub →</Link>
  </div>
}
