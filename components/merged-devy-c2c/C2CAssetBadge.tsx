'use client'

/**
 * PROMPT 4: Asset type badges for C2C (COLLEGE, DECLARED, DRAFTED, PROMOTION ELIGIBLE, PROMOTED, ROOKIE POOL, HYBRID SCORER).
 */

import { cn } from '@/lib/utils'

export type C2CBadgeType =
  | 'COLLEGE'
  | 'DECLARED'
  | 'DRAFTED'
  | 'PROMOTION_ELIGIBLE'
  | 'PROMOTED'
  | 'ROOKIE_POOL'
  | 'HYBRID_SCORER'

const BADGE_STYLES: Record<C2CBadgeType, string> = {
  COLLEGE: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  DECLARED: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
  DRAFTED: 'bg-violet-500/20 text-violet-300 border-violet-500/40',
  PROMOTION_ELIGIBLE: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  PROMOTED: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
  ROOKIE_POOL: 'bg-slate-500/20 text-slate-300 border-slate-500/40',
  HYBRID_SCORER: 'bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/40',
}

const BADGE_LABELS: Record<C2CBadgeType, string> = {
  COLLEGE: 'College',
  DECLARED: 'Declared',
  DRAFTED: 'Drafted',
  PROMOTION_ELIGIBLE: 'Promotion eligible',
  PROMOTED: 'Promoted',
  ROOKIE_POOL: 'Rookie pool',
  HYBRID_SCORER: 'Hybrid scorer',
}

export function C2CAssetBadge({ type, className }: { type: C2CBadgeType; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide border',
        BADGE_STYLES[type],
        className
      )}
    >
      {BADGE_LABELS[type]}
    </span>
  )
}
