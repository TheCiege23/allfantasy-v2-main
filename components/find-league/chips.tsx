/**
 * Phase 6F — Discovery UI atoms.
 *
 * Tiny presentational chips used by RecommendedLeagueCard /
 * MatchmakingRow / DiscoveryRail. Theme-aware via the same CSS vars
 * the prestige primitives use (`--panel`, `--border`, `--text`,
 * `--muted2`, `--subtle-bg`).
 */

import * as React from "react"
import { cn } from "@/lib/utils"
import { formatFitPercent } from "@/lib/matchmaking"

export function CompatibilityBadge({
  score,
  className,
}: {
  score: number
  className?: string
}) {
  const pct = Math.max(0, Math.min(1, score))
  const tier = pct >= 0.8 ? "strong" : pct >= 0.6 ? "ok" : "weak"
  const palette =
    tier === "strong"
      ? { bg: "rgba(34,197,94,0.15)", color: "rgb(134,239,172)" }
      : tier === "ok"
        ? { bg: "rgba(34,211,238,0.12)", color: "rgb(165,243,252)" }
        : { bg: "rgba(148,163,184,0.15)", color: "rgb(203,213,225)" }
  return (
    <span
      data-testid="compatibility-badge"
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums",
        className
      )}
      style={{
        background: palette.bg,
        color: palette.color,
        border: "1px solid var(--border)",
      }}
      aria-label={`${formatFitPercent(pct)} compatibility`}
    >
      {formatFitPercent(pct)}
    </span>
  )
}

export function CommissionerTrustChip({
  trust,
  verified,
  className,
}: {
  trust: number | null
  verified: boolean
  className?: string
}) {
  if (trust == null && !verified) return null
  const label = verified
    ? `Verified commish${trust != null ? ` · ${Math.round(trust * 100)}% trust` : ""}`
    : `${Math.round((trust ?? 0) * 100)}% trust`
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider",
        className
      )}
      style={{
        background: "var(--subtle-bg)",
        color: "var(--text)",
        border: "1px solid var(--border)",
      }}
      title="Commissioner credibility"
    >
      {label}
    </span>
  )
}

export function FitTagChip({
  label,
  tier,
}: {
  label: string
  tier: "strong" | "ok" | "weak"
}) {
  const palette =
    tier === "strong"
      ? { bg: "rgba(167,139,250,0.15)", color: "rgb(196,181,253)" }
      : tier === "ok"
        ? { bg: "rgba(34,211,238,0.10)", color: "rgb(165,243,252)" }
        : { bg: "rgba(148,163,184,0.12)", color: "rgb(203,213,225)" }
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{
        background: palette.bg,
        color: palette.color,
        border: "1px solid var(--border)",
      }}
    >
      {label}
    </span>
  )
}

export function OpenSeatsTag({ seats }: { seats: number | null }) {
  if (seats == null || seats <= 0) return null
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider"
      style={{
        background: "rgba(34,197,94,0.12)",
        color: "rgb(134,239,172)",
        border: "1px solid rgba(34,197,94,0.3)",
      }}
    >
      {seats} {seats === 1 ? "seat" : "seats"} open
    </span>
  )
}

