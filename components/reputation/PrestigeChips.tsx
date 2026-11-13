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
import type { LeaguePrestigeTier } from "@/lib/reputation/types"

// ── Palettes ──────────────────────────────────────────────────────────────────

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

