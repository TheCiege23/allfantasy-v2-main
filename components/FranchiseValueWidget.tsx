"use client"

import { useGMFranchiseProfile } from "@/hooks/useGMFranchiseProfile"

/**
 * Displays franchise value and GM tier for a manager. Use in profile cards, leaderboards, or dashboards.
 */
export function FranchiseValueWidget({
  managerId,
  showTier = true,
  showPrestige = true,
  className = "",
}: {
  managerId: string | null
  showTier?: boolean
  showPrestige?: boolean
  className?: string
}) {
  const { profile, loading, error } = useGMFranchiseProfile(managerId)

  if (!managerId) return null
  if (loading) {
    return (
      <span className={`inline-block h-5 w-20 animate-pulse rounded bg-white/10 ${className}`} />
    )
  }
  if (error || !profile) return null

  const tierColor =
    profile.tierBadgeColor === "amber"
      ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
      : profile.tierBadgeColor === "emerald"
        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
        : profile.tierBadgeColor === "cyan"
          ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-200"
          : "border-white/20 bg-white/5 text-white/70"

  return (
    <span className={`inline-flex flex-wrap items-center gap-1.5 ${className}`}>
      <span className="font-mono text-sm text-cyan-400" title="Franchise value">
        {profile.franchiseValue.toFixed(0)} value
      </span>
      {showPrestige && (
        <span className="text-xs text-white/60" title="GM prestige">
          {profile.gmPrestigeScore.toFixed(0)} prestige
        </span>
      )}
      {showTier && profile.tierLabel && (
        <span
          className={`rounded border px-1.5 py-0.5 text-[11px] font-medium ${tierColor}`}
          title="GM tier"
        >
          {profile.tierLabel}
        </span>
      )}
    </span>
  )
}
