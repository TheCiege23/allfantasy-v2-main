/**
 * Phase 6F — RecommendedLeagueCard.
 *
 * Compact, mobile-first card for a single `LeagueRecommendation`.
 * Renders exclusively from public DTOs — never reaches into private
 * resume fields. Honors theme via CSS vars.
 */

import * as React from "react"
import { cn } from "@/lib/utils"
import { explainFit, type LeagueRecommendation } from "@/lib/matchmaking"
import { CompatibilityBadge, CommissionerTrustChip, FitTagChip, OpenSeatsTag } from "./chips"
import { LeagueTierChip, LongRunningLeagueChip } from "@/components/reputation"
import type { LeaguePrestigeTier } from "@/lib/reputation/types"

export function RecommendedLeagueCard({
  rec,
  className,
  href,
}: {
  rec: LeagueRecommendation
  className?: string
  /** Optional click-through target (e.g. league join page). */
  href?: string
}) {
  const explanation = explainFit(rec.score, rec.league)
  const title = rec.league.name ?? "Unnamed league"

  const body = (
    <article
      data-testid="recommended-league-card"
      className={cn(
        "rounded-2xl p-3 sm:p-4 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400",
        href && "hover:translate-y-[-1px]",
        className
      )}
      style={{ background: "var(--panel)", border: "1px solid var(--border)" }}
      aria-label={`Recommended league ${title}`}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3
            className="truncate text-sm sm:text-base font-semibold"
            style={{ color: "var(--text)" }}
          >
            {title}
          </h3>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px]" style={{ color: "var(--muted2)" }}>
            <span className="font-semibold uppercase tracking-wider">{rec.league.sport}</span>
            <span>·</span>
            <span className="capitalize">{rec.league.leagueType.replace(/_/g, " ")}</span>
            <span>·</span>
            <span>{rec.league.format}</span>
          </div>
        </div>
        <CompatibilityBadge score={rec.score.score} />
      </header>

      <p
        className="mt-2 text-xs sm:text-sm"
        style={{ color: "var(--text)" }}
      >
        {explanation.headline}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {explanation.tags.map((t) => (
          <FitTagChip key={t.key} label={t.label} tier={t.tier} />
        ))}
        <CommissionerTrustChip
          trust={rec.league.commissionerCredibility}
          verified={rec.league.commissionerVerified}
        />
        {rec.league.leaguePrestigeTier && (
          <LeagueTierChip tier={rec.league.leaguePrestigeTier as LeaguePrestigeTier} />
        )}
        {rec.league.leagueTotalSeasons != null && (
          <LongRunningLeagueChip totalSeasons={rec.league.leagueTotalSeasons} />
        )}
        <OpenSeatsTag seats={rec.league.openSeats} />
      </div>

      {explanation.caveat && (
        <p className="mt-2 text-[11px] italic" style={{ color: "var(--muted2)" }}>
          {explanation.caveat}
        </p>
      )}
    </article>
  )

  if (!href) return body
  return (
    <a href={href} className="block">
      {body}
    </a>
  )
}

export function RecommendedLeagueCardSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-2xl p-3 sm:p-4 animate-pulse",
        className
      )}
      style={{ background: "var(--panel)", border: "1px solid var(--border)" }}
      aria-busy
      aria-live="polite"
    >
      <div className="flex justify-between gap-3">
        <div className="space-y-2 w-full">
          <div className="h-4 w-2/3 rounded bg-[color:var(--subtle-bg)]" />
          <div className="h-3 w-1/2 rounded bg-[color:var(--subtle-bg)]" />
        </div>
        <div className="h-5 w-14 rounded-full bg-[color:var(--subtle-bg)]" />
      </div>
      <div className="mt-3 h-3 w-full rounded bg-[color:var(--subtle-bg)]" />
      <div className="mt-2 flex gap-1.5">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-4 w-14 rounded-full bg-[color:var(--subtle-bg)]" />
        ))}
      </div>
    </div>
  )
}
