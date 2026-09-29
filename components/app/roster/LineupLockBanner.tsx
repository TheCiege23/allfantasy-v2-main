"use client"

import type { LineupLockPayload } from "./useRosterManager"
import { Lock } from "lucide-react"

type LineupLockBannerProps = {
  lineupLock: LineupLockPayload | null
  canEditLineup: boolean
}

export default function LineupLockBanner({ lineupLock, canEditLineup }: LineupLockBannerProps) {
  if (canEditLineup && !lineupLock?.locked) return null

  const reason =
    lineupLock?.reason ||
    (lineupLock?.locked ? "Lineup changes are not available right now." : null)

  return (
    <div
      className="flex items-start gap-2 rounded-xl border border-amber-300/25 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100"
      data-testid="lineup-lock-banner"
    >
      <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-200/90" aria-hidden />
      <div className="min-w-0 space-y-0.5">
        <p className="font-semibold text-amber-50/95">Lineup locked</p>
        {reason && <p className="text-[11px] leading-snug text-amber-100/85">{reason}</p>}
        {lineupLock?.policy && (
          <p className="text-[11px] uppercase tracking-wide text-amber-200/60">
            Policy: {lineupLock.policy}
          </p>
        )}
      </div>
    </div>
  )
}
