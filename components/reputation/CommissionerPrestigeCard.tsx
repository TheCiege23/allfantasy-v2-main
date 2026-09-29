/**
 * Phase 6K — CommissionerPrestigeCard.
 *
 * Compact prestige snapshot for a commissioner.
 * Privacy: never shows raw commissionerId or raw internal scores.
 * Suitable for embedding in recruiting cards, league headers, or profiles.
 */

import * as React from "react"
import { cn } from "@/lib/utils"
import {
  CommissionerTierChip,
  VerifiedCommissionerChip,
  EliteCommissionerChip,
  TrustedRecruitingBadge,
} from "./PrestigeChips"
import type { CommissionerPrestigeRecord } from "@/lib/reputation/types"

export function CommissionerPrestigeCard({
  prestige,
  className,
}: {
  prestige: CommissionerPrestigeRecord
  className?: string
}) {
  return (
    <div
      className={cn("rounded-xl border p-4 space-y-3", className)}
      style={{ borderColor: "var(--border)", background: "var(--panel)" }}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex flex-wrap gap-1.5">
          <CommissionerTierChip tier={prestige.tier} />
          {prestige.verified && <VerifiedCommissionerChip />}
          <TrustedRecruitingBadge overallScore={prestige.overallScore} />
        </div>
      </div>

      {/* Key stats */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        {prestige.totalSeasonsCommissioned > 0 && (
          <Stat
            label="Seasons"
            value={String(prestige.totalSeasonsCommissioned)}
          />
        )}
        {prestige.totalLeaguesCommissioned > 0 && (
          <Stat
            label="Leagues"
            value={String(prestige.totalLeaguesCommissioned)}
          />
        )}
        {prestige.reliabilityScore != null && (
          <Stat
            label="Reliability"
            value={`${Math.round(prestige.reliabilityScore * 100)}%`}
          />
        )}
        {prestige.inviteAcceptanceRate != null && (
          <Stat
            label="Invite accept"
            value={`${Math.round(prestige.inviteAcceptanceRate * 100)}%`}
          />
        )}
      </div>

      {/* Footer */}
      <p className="text-[11px] italic" style={{ color: "var(--muted2)" }}>
        Prestige is computed from verified league activity · No personal history shown
      </p>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="block" style={{ color: "var(--muted)" }}>{label}</span>
      <span className="font-semibold" style={{ color: "var(--text)" }}>{value}</span>
    </div>
  )
}

export function CommissionerPrestigeCardSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("h-28 animate-pulse rounded-xl", className)}
      style={{ background: "var(--panel2)" }}
    />
  )
}
