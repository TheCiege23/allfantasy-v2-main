/**
 * Phase 6K — LeaguePrestigeCard.
 *
 * Compact prestige snapshot for a league.
 * Privacy: shows leagueId implicitly via context only; no internal scoring exposed.
 * Mobile-first layout with prestige chips and key stats.
 */

import * as React from "react"
import { cn } from "@/lib/utils"
import {
  LeagueTierChip,
  LongRunningLeagueChip,
  HighRetentionChip,
} from "./PrestigeChips"
import type { LeagueReputationRecord } from "@/lib/reputation/types"

export function LeaguePrestigeCard({
  reputation,
  leagueName,
  className,
}: {
  reputation: LeagueReputationRecord
  leagueName?: string | null
  className?: string
}) {
  return (
    <div
      className={cn("rounded-xl border p-4 space-y-3", className)}
      style={{ borderColor: "var(--border)", background: "var(--panel)" }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {leagueName && (
            <p className="text-sm font-semibold truncate" style={{ color: "var(--text)" }}>
              {leagueName}
            </p>
          )}
        </div>
        {reputation.verifiedLeague && (
          <span
            className="shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider"
            style={{
              background: "rgba(34,197,94,0.12)",
              color:      "rgb(134,239,172)",
              border:     "1px solid rgba(34,197,94,0.3)",
            }}
          >
            Verified
          </span>
        )}
      </div>

      {/* Chips row */}
      <div className="flex flex-wrap gap-1.5">
        <LeagueTierChip tier={reputation.tier} />
        <LongRunningLeagueChip totalSeasons={reputation.totalSeasons} />
        <HighRetentionChip retentionRate={reputation.retentionRate} />
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        {reputation.totalSeasons > 0 && (
          <Stat label="Seasons" value={String(reputation.totalSeasons)} />
        )}
        {reputation.completionRate != null && (
          <Stat
            label="Completion"
            value={`${Math.round(reputation.completionRate * 100)}%`}
          />
        )}
        {reputation.retentionRate != null && (
          <Stat
            label="Retention"
            value={`${Math.round(reputation.retentionRate * 100)}%`}
          />
        )}
        {reputation.competitivenessScore != null && (
          <Stat
            label="Competitive"
            value={`${Math.round(reputation.competitivenessScore * 100)}%`}
          />
        )}
      </div>

      <p className="text-[11px] italic" style={{ color: "var(--muted2)" }}>
        Prestige computed from verified activity · No member history shown
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

export function LeaguePrestigeCardSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("h-28 animate-pulse rounded-xl", className)}
      style={{ background: "var(--panel2)" }}
    />
  )
}
