'use client'

import type { ManagerDnaViewModel } from '@/lib/decision-os/manager-dna'
import { decisionOsCardClassName } from './DecisionOsCardPrimitives'

type ManagerDnaCardProps = {
  profile: ManagerDnaViewModel
  variant?: 'dashboard' | 'league' | 'commissioner' | 'team'
  compact?: boolean
}

/** Compatibility boundary: never render a supplied or cached inferred profile. */
export default function ManagerDnaCard({ variant = 'dashboard' }: ManagerDnaCardProps) {
  return (
    <section data-testid={`manager-dna-card-${variant}`} className={decisionOsCardClassName} aria-label="Competitive Edge">
      <div className="space-y-3 p-5">
        <h2 className="text-xl font-bold text-primary">Competitive Edge</h2>
        <p className="text-sm leading-6 text-secondary">Open a trade, draft or waiver decision for guidance based on league facts. Complete manager profiles and personality scores are private.</p>
        <p className="text-sm leading-6 text-muted">Decision-specific negotiation evidence is still being connected. No acceptance prediction is available here yet.</p>
      </div>
    </section>
  )
}
