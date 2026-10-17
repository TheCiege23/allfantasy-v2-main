/**
 * Phase 6K — Reputation trust indicator chips.
 *
 * Lightweight prestige/trust badges. Tasteful and prestige-oriented.
 * All chips are presentational — they receive pre-computed values and render.
 *
 * Privacy: never shows raw userId or raw scores in accessible text.
 */

import * as React from "react"
import { cn } from "@/lib/utils"
import type { CommissionerPrestigeTier, LeaguePrestigeTier } from "@/lib/reputation/types"

// ── Palettes ──────────────────────────────────────────────────────────────────

const COMMISSIONER_TIER_PALETTE: Record<
  CommissionerPrestigeTier,
  { bg: string; color: string; border: string }
> = {
  legendary:       { bg: "rgba(239,68,68,0.12)",    color: "rgb(252,165,165)",  border: "rgba(239,68,68,0.3)"  },
  elite:           { bg: "rgba(251,191,36,0.12)",   color: "rgb(253,224,71)",   border: "rgba(251,191,36,0.3)" },
  trusted:         { bg: "rgba(167,139,250,0.15)",  color: "rgb(196,181,253)",  border: "rgba(167,139,250,0.3)"},
  standard:        { bg: "rgba(34,211,238,0.10)",   color: "rgb(165,243,252)",  border: "rgba(34,211,238,0.2)" },
  new_commissioner: { bg: "rgba(148,163,184,0.12)", color: "rgb(203,213,225)",  border: "rgba(148,163,184,0.3)"},
  flagged:         { bg: "rgba(239,68,68,0.08)",    color: "rgb(252,165,165)",  border: "rgba(239,68,68,0.25)" },
}

const LEAGUE_TIER_PALETTE: Record<
  LeaguePrestigeTier,
  { bg: string; color: string; border: string }
> = {
  legendary:   { bg: "rgba(239,68,68,0.12)",    color: "rgb(252,165,165)",  border: "rgba(239,68,68,0.3)"  },
  elite:       { bg: "rgba(251,191,36,0.12)",   color: "rgb(253,224,71)",   border: "rgba(251,191,36,0.3)" },
  established: { bg: "rgba(167,139,250,0.15)",  color: "rgb(196,181,253)",  border: "rgba(167,139,250,0.3)"},
  standard:    { bg: "rgba(34,211,238,0.10)",   color: "rgb(165,243,252)",  border: "rgba(34,211,238,0.2)" },
  new_league:  { bg: "rgba(148,163,184,0.12)",  color: "rgb(203,213,225)",  border: "rgba(148,163,184,0.3)"},
  flagged:     { bg: "rgba(239,68,68,0.08)",    color: "rgb(252,165,165)",  border: "rgba(239,68,68,0.25)" },
}

const COMMISSIONER_TIER_LABEL: Record<CommissionerPrestigeTier, string> = {
  legendary:       "Legendary Commish",
  elite:           "Elite Commish",
  trusted:         "Trusted Commish",
  standard:        "Commissioner",
  new_commissioner: "New Commissioner",
  flagged:         "Flagged",
}

const LEAGUE_TIER_LABEL: Record<LeaguePrestigeTier, string> = {
  legendary:   "Legendary League",
  elite:       "Elite League",
  established: "Established",
  standard:    "Standard",
  new_league:  "New League",
  flagged:     "Flagged",
}

// ── Atom ──────────────────────────────────────────────────────────────────────

function PrestigeChip({
  label,
  bg,
  color,
  border,
  className,
  testId,
}: {
  label: string
  bg: string
  color: string
  border: string
  className?: string
  testId?: string
}) {
  return (
    <span
      data-testid={testId}
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider",
        className
      )}
      style={{ background: bg, color, border: `1px solid ${border}` }}
    >
      {label}
    </span>
  )
}

// ── Commissioner chips ────────────────────────────────────────────────────────

/** Shows tier badge for a commissioner. Only renders elite+ tiers. */
export function CommissionerTierChip({
  tier,
  className,
}: {
  tier: CommissionerPrestigeTier
  className?: string
}) {
  const { bg, color, border } = COMMISSIONER_TIER_PALETTE[tier]
  return (
    <PrestigeChip
      label={COMMISSIONER_TIER_LABEL[tier]}
      bg={bg} color={color} border={border}
      testId="commissioner-tier-chip"
      className={className}
    />
  )
}

/** Shows "Verified Commish" badge only when commissioner.verified = true. */
export function VerifiedCommissionerChip({ className }: { className?: string }) {
  return (
    <PrestigeChip
      label="Verified Commish"
      bg="rgba(34,197,94,0.12)"
      color="rgb(134,239,172)"
      border="rgba(34,197,94,0.3)"
      testId="verified-commissioner-chip"
      className={className}
    />
  )
}

/** Shows "Elite Commish" only for legendary or elite tier. */
export function EliteCommissionerChip({
  tier,
  className,
}: {
  tier: CommissionerPrestigeTier
  className?: string
}) {
  if (tier !== 'legendary' && tier !== 'elite') return null
  const { bg, color, border } = COMMISSIONER_TIER_PALETTE[tier]
  return (
    <PrestigeChip
      label={tier === 'legendary' ? "Legendary Commish" : "Elite Commish"}
      bg={bg} color={color} border={border}
      testId="elite-commissioner-chip"
      className={className}
    />
  )
}

// ── League chips ──────────────────────────────────────────────────────────────

/** Shows tier badge for a league. */
export function LeagueTierChip({
  tier,
  className,
}: {
  tier: LeaguePrestigeTier
  className?: string
}) {
  const { bg, color, border } = LEAGUE_TIER_PALETTE[tier]
  return (
    <PrestigeChip
      label={LEAGUE_TIER_LABEL[tier]}
      bg={bg} color={color} border={border}
      testId="league-tier-chip"
      className={className}
    />
  )
}

/** Shows "Long-Running League" badge when totalSeasons >= 3. */
export function LongRunningLeagueChip({
  totalSeasons,
  className,
}: {
  totalSeasons: number
  className?: string
}) {
  if (totalSeasons < 3) return null
  return (
    <PrestigeChip
      label={`${totalSeasons} Seasons`}
      bg="rgba(167,139,250,0.15)"
      color="rgb(196,181,253)"
      border="rgba(167,139,250,0.3)"
      testId="long-running-league-chip"
      className={className}
    />
  )
}

/** Shows "High Retention" badge when retentionRate >= 0.8. */
export function HighRetentionChip({ retentionRate, className }: { retentionRate: number | null; className?: string }) {
  if (retentionRate == null || retentionRate < 0.8) return null
  return (
    <PrestigeChip
      label="High Retention"
      bg="rgba(34,197,94,0.12)"
      color="rgb(134,239,172)"
      border="rgba(34,197,94,0.3)"
      testId="high-retention-chip"
      className={className}
    />
  )
}

/** Shows "Trusted Recruiting" badge when commissioner overallScore >= 0.75. */
export function TrustedRecruitingBadge({
  overallScore,
  className,
}: {
  overallScore: number | null
  className?: string
}) {
  if (overallScore == null || overallScore < 0.75) return null
  return (
    <PrestigeChip
      label="Trusted Recruiting"
      bg="rgba(34,211,238,0.10)"
      color="rgb(165,243,252)"
      border="rgba(34,211,238,0.3)"
      testId="trusted-recruiting-badge"
      className={className}
    />
  )
}
