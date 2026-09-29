"use client"

import Link from "next/link"
import { Lock, Sparkles, Trophy, Users, Zap } from "lucide-react"
import { trackDiscoveryJoinClick } from "@/lib/discovery-analytics/client"
import { getFanCredBoundaryDisclosureShort } from "@/lib/legal/FanCredBoundaryDisclosure"
import type { DiscoveryCard } from "@/lib/public-discovery/types"

export interface LeagueDiscoveryCardProps {
  league: DiscoveryCard
}

function isNew(createdAt: string): boolean {
  try {
    return Date.now() - new Date(createdAt).getTime() < 7 * 24 * 60 * 60 * 1000
  } catch {
    return false
  }
}

function getSourceLabel(league: DiscoveryCard): string {
  if (league.source === "fantasy") return "Public league"
  if (league.source === "creator") return "Creator league"
  return "Bracket"
}

export function LeagueDiscoveryCard({ league }: LeagueDiscoveryCardProps) {
  const isFull = league.maxMembers > 0 && league.memberCount >= league.maxMembers
  const fillingFast = !isFull && league.maxMembers > 0 && league.fillPct >= 60
  const showNew = isNew(league.createdAt)
  const hasAI = Array.isArray(league.aiFeatures) && league.aiFeatures.length > 0
  const canJoinDirect = !isFull && !league.inviteOnlyByTier && league.canJoinByRanking !== false
  const paidBoundaryDisclosure = getFanCredBoundaryDisclosureShort()

  return (
    <article
      data-testid={`league-discovery-card-${league.source}-${league.id}`}
      className="group flex h-full flex-col overflow-hidden rounded-2xl sm:rounded-3xl border transition-all duration-200 hover:shadow-lg"
      style={{
        borderColor: "var(--border)",
        background:
          league.source === "creator"
            ? "linear-gradient(160deg, color-mix(in srgb, var(--accent) 9%, var(--panel)) 0%, var(--panel) 70%)"
            : "var(--panel)",
      }}
    >
      <div className="flex flex-1 flex-col gap-2.5 sm:gap-3 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] sm:text-[11px] font-semibold uppercase tracking-[0.18em] sm:tracking-[0.22em]" style={{ color: "var(--muted)" }}>
              {getSourceLabel(league)}
            </p>
            <h3 className="mt-1.5 sm:mt-2 truncate text-base sm:text-lg font-semibold" style={{ color: "var(--text)" }}>
              {league.name}
            </h3>
          </div>
          {league.leagueTier != null ? (
            <span
              className="inline-flex items-center rounded-full border px-2.5 sm:px-3 py-0.5 sm:py-1 text-[11px] sm:text-xs font-semibold"
              style={{ borderColor: "var(--border)", color: "var(--text)" }}
            >
              Tier {league.leagueTier}
            </span>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-1.5">
          <span
            className="inline-flex items-center rounded-full px-2 sm:px-2.5 py-0.5 sm:py-1 text-[11px] sm:text-xs font-semibold"
            style={{ background: "var(--panel2)", color: "var(--text)" }}
          >
            {league.sport}
          </span>
          {league.leagueStyle ? (
            <span
              className="inline-flex items-center rounded-full px-2 sm:px-2.5 py-0.5 sm:py-1 text-[11px] sm:text-xs font-semibold capitalize"
              style={{ background: "rgba(14, 165, 233, 0.12)", color: "rgb(56, 189, 248)" }}
            >
              {league.leagueStyle.replace(/_/g, " ")}
            </span>
          ) : null}
          <span
            className="inline-flex items-center rounded-full px-2 sm:px-2.5 py-0.5 sm:py-1 text-[11px] sm:text-xs font-semibold"
            title={league.isPaid ? paidBoundaryDisclosure : undefined}
            style={{
              background: league.isPaid ? "rgba(234, 179, 8, 0.16)" : "rgba(34, 197, 94, 0.12)",
              color: league.isPaid ? "rgb(250, 204, 21)" : "rgb(74, 222, 128)",
            }}
          >
            {league.isPaid ? "Paid" : "Free"}
          </span>
          {fillingFast ? (
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 sm:px-2.5 py-0.5 sm:py-1 text-[11px] sm:text-xs font-semibold"
              style={{ background: "rgba(34, 211, 238, 0.12)", color: "rgb(34, 211, 238)" }}
            >
              <Zap className="h-3 w-3" />
              Filling fast
            </span>
          ) : null}
          {showNew ? (
            <span
              className="inline-flex items-center rounded-full px-2 sm:px-2.5 py-0.5 sm:py-1 text-[11px] sm:text-xs font-semibold"
              style={{ background: "rgba(251, 146, 60, 0.14)", color: "rgb(251, 146, 60)" }}
            >
              New
            </span>
          ) : null}
          {league.inviteOnlyByTier ? (
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 sm:px-2.5 py-0.5 sm:py-1 text-[11px] sm:text-xs font-semibold"
              title="This league is outside your current rank window and needs a commissioner invite."
              style={{ background: "rgba(251, 146, 60, 0.16)", color: "rgb(251, 146, 60)" }}
            >
              <Lock className="h-3 w-3" />
              Invite required
            </span>
          ) : null}
          {hasAI ? (
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 sm:px-2.5 py-0.5 sm:py-1 text-[11px] sm:text-xs font-semibold"
              style={{ background: "rgba(167, 139, 250, 0.15)", color: "rgb(196, 181, 253)" }}
            >
              <Sparkles className="h-3 w-3" />
              AI-enabled
            </span>
          ) : null}
        </div>
        {league.isPaid ? (
          <p className="text-[11px]" style={{ color: "rgba(250, 204, 21, 0.75)" }}>
            Dues and payouts for paid leagues are external via FanCred.
          </p>
        ) : null}

        {hasAI ? (
          <div className="flex flex-wrap gap-1.5">
            {league.aiFeatures.slice(0, 2).map((feature) => (
              <span
                key={`${league.id}-${feature}`}
                className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium"
                style={{ borderColor: "rgba(167, 139, 250, 0.35)", color: "rgb(221, 214, 254)" }}
              >
                {feature}
              </span>
            ))}
          </div>
        ) : null}

        {league.description ? (
          <p className="line-clamp-3 text-xs sm:text-sm" style={{ color: "var(--muted)" }}>
            {league.description}
          </p>
        ) : null}

        {league.creatorName && league.source === "creator" ? (
          <p className="text-xs sm:text-sm" style={{ color: "var(--muted)" }}>
            by {league.creatorName}
            {league.isCreatorVerified ? (
              <span className="ml-1 font-semibold" style={{ color: "var(--text)" }}>
                Verified
              </span>
            ) : null}
          </p>
        ) : null}

        {league.tournamentName ? (
          <p className="text-xs sm:text-sm" style={{ color: "var(--muted)" }}>
            {league.tournamentName}
            {league.season ? ` · ${league.season}` : ""}
          </p>
        ) : null}

        <div className="mt-auto space-y-2">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-[11px] sm:text-xs" style={{ color: "var(--muted)" }}>
            <span className="inline-flex items-center gap-1">
              <Users className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
              {league.memberCount}
              {league.maxMembers > 0 ? ` / ${league.maxMembers}` : ""} spots
            </span>
            <span className="inline-flex items-center gap-1">
              <Trophy className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
              {league.fillPct}% full
            </span>
          </div>
          {league.maxMembers > 0 ? (
            <div className="h-1.5 overflow-hidden rounded-full" style={{ background: "var(--panel2)" }}>
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${Math.min(100, league.fillPct)}%`,
                  background: isFull ? "var(--muted)" : "var(--accent)",
                }}
              />
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t p-4 sm:p-5 pt-3 sm:pt-4" style={{ borderColor: "var(--border)" }}>
        <Link
          href={league.detailUrl}
          data-testid={`league-discovery-view-${league.id}`}
          className="inline-flex min-h-[40px] sm:min-h-[44px] items-center justify-center rounded-xl border px-3 sm:px-3.5 py-2.5 text-xs sm:text-sm font-semibold"
          style={{ borderColor: "var(--border)", color: "var(--text)" }}
        >
          View details
        </Link>

        {canJoinDirect ? (
          <Link
            href={league.joinUrl}
            data-testid={`league-discovery-join-${league.id}`}
            className="inline-flex min-h-[40px] sm:min-h-[44px] items-center justify-center rounded-xl px-3 sm:px-3.5 py-2.5 text-xs sm:text-sm font-semibold"
            onClick={() =>
              trackDiscoveryJoinClick({
                leagueId: league.id,
                source: league.source,
                leagueName: league.name,
                sport: league.sport,
                joinUrl: league.joinUrl,
              })
            }
            style={{ background: "var(--accent)", color: "var(--bg)" }}
            title={league.isPaid ? paidBoundaryDisclosure : undefined}
          >
            Join league
          </Link>
        ) : league.inviteOnlyByTier ? (
          <span
            className="rounded-xl px-3 sm:px-3.5 py-2.5 text-xs sm:text-sm font-semibold"
            style={{ background: "rgba(251, 146, 60, 0.14)", color: "rgb(251, 146, 60)" }}
          >
            Invite required
          </span>
        ) : (
          <span
            className="rounded-xl px-3 sm:px-3.5 py-2.5 text-xs sm:text-sm font-semibold"
            style={{ background: "var(--panel2)", color: "var(--muted)" }}
          >
            {isFull ? "Full" : "Unavailable"}
          </span>
        )}

        {league.creatorSlug ? (
          <Link
            href={`/creators/${encodeURIComponent(league.creatorSlug)}`}
            data-testid={`league-discovery-creator-${league.creatorSlug}`}
            className="ml-auto text-sm font-semibold"
            style={{ color: "var(--accent)" }}
          >
            Creator profile
          </Link>
        ) : null}
      </div>
    </article>
  )
}
