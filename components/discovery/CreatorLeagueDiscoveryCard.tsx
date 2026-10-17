"use client"

import Link from "next/link"
import { Users, Sparkles, Zap } from "lucide-react"
import { VerifiedCreatorBadge } from "@/components/creator/VerifiedCreatorBadge"
import { trackDiscoveryJoinClick } from "@/lib/discovery-analytics/client"
import { getFanCredBoundaryDisclosureShort } from "@/lib/legal/FanCredBoundaryDisclosure"
import type { DiscoveryCard } from "@/lib/public-discovery/types"

export interface CreatorLeagueDiscoveryCardProps {
  league: DiscoveryCard
}

function leagueTypeLabel(type: string | null | undefined): string {
  if (!type) return "League"
  if (type === "BRACKET") return "Bracket"
  if (type === "FANTASY") return "Fantasy"
  return type
}

function isNew(createdAt: string): boolean {
  try {
    const d = new Date(createdAt)
    return Date.now() - d.getTime() < 7 * 24 * 60 * 60 * 1000
  } catch {
    return false
  }
}

export function CreatorLeagueDiscoveryCard({ league }: CreatorLeagueDiscoveryCardProps) {
  const isFull = league.maxMembers > 0 && league.memberCount >= league.maxMembers
  const fillingFast =
    !isFull && league.maxMembers > 0 && league.fillPct >= 50
  const showNew = isNew(league.createdAt)
  const hasAI = Array.isArray(league.aiFeatures) && league.aiFeatures.length > 0
  const creatorHandle = league.creatorSlug ?? undefined
  const creatorName = league.creatorName ?? "Creator"
  const paidBoundaryDisclosure = getFanCredBoundaryDisclosureShort()

  return (
    <article
      data-testid={`creator-league-card-${league.id}`}
      className="group rounded-2xl border overflow-hidden flex flex-col h-full transition-all duration-200 hover:border-[var(--accent)]/30 hover:shadow-lg"
      style={{
        borderColor: "var(--border)",
        background: "var(--panel)",
        boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
      }}
    >
      <div className="p-3 sm:p-4 flex-1 flex flex-col gap-2.5 sm:gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          {creatorHandle ? (
            <Link
              href={`/creators/${encodeURIComponent(creatorHandle)}`}
              data-testid={`creator-discovery-profile-link-${creatorHandle}`}
              className="font-medium text-xs sm:text-sm hover:opacity-90"
              style={{ color: "var(--text)" }}
            >
              {creatorName}
            </Link>
          ) : (
            <span className="font-medium text-xs sm:text-sm" style={{ color: "var(--text)" }}>
              {creatorName}
            </span>
          )}
          {league.isCreatorVerified && creatorHandle && (
            <VerifiedCreatorBadge handle={creatorHandle} showLabel={false} linkToProfile={false} size="sm" />
          )}
        </div>

        <h3 className="font-semibold text-sm sm:text-base leading-tight truncate" style={{ color: "var(--text)" }}>
          {league.name}
        </h3>

        <div className="text-[11px] sm:text-xs" style={{ color: "var(--muted)" }}>
          League type: {leagueTypeLabel(league.creatorLeagueType)} | Teams filled: {league.memberCount}
          {league.maxMembers > 0 ? ` / ${league.maxMembers}` : ""}
        </div>

        {/* League badges */}
        <div className="flex flex-wrap gap-1.5">
          <span
            className="inline-flex items-center rounded-md px-1.5 sm:px-2 py-0.5 text-[11px] sm:text-xs font-medium"
            style={{ background: "var(--panel2)", color: "var(--text)" }}
          >
            {league.sport}
          </span>
          <span
            className="inline-flex items-center rounded-md px-1.5 sm:px-2 py-0.5 text-[11px] sm:text-xs font-medium"
            style={{
              background: "rgba(168, 85, 247, 0.15)",
              color: "rgb(216, 180, 254)",
            }}
          >
            Creator · {leagueTypeLabel(league.creatorLeagueType)}
          </span>
          {league.isPaid ? (
            <span
              className="inline-flex items-center rounded-md px-1.5 sm:px-2 py-0.5 text-[11px] sm:text-xs font-medium"
              title={paidBoundaryDisclosure}
              style={{ background: "rgba(234, 179, 8, 0.15)", color: "rgb(250, 204, 21)" }}
            >
              Paid
            </span>
          ) : (
            <span
              className="inline-flex items-center rounded-md px-1.5 sm:px-2 py-0.5 text-[11px] sm:text-xs font-medium"
              style={{ background: "rgba(34, 197, 94, 0.12)", color: "rgb(74, 222, 128)" }}
            >
              Free
            </span>
          )}
          {fillingFast && (
            <span
              className="inline-flex items-center gap-0.5 rounded-md px-1.5 sm:px-2 py-0.5 text-[11px] sm:text-xs font-medium"
              style={{ background: "rgba(34, 211, 238, 0.12)", color: "rgb(34, 211, 238)" }}
            >
              <Zap className="h-3 w-3" />
              Filling fast
            </span>
          )}
          {showNew && (
            <span
              className="inline-flex items-center rounded-md px-1.5 sm:px-2 py-0.5 text-[11px] sm:text-xs font-medium"
              style={{ background: "rgba(251, 146, 60, 0.15)", color: "rgb(251, 146, 60)" }}
            >
              New
            </span>
          )}
          {hasAI && (
            <span
              className="inline-flex items-center gap-0.5 rounded-md px-1.5 sm:px-2 py-0.5 text-[11px] sm:text-xs font-medium"
              style={{ background: "rgba(167, 139, 250, 0.15)", color: "rgb(196, 181, 253)" }}
            >
              <Sparkles className="h-3 w-3" />
              AI-enabled
            </span>
          )}
        </div>
        {league.isPaid ? (
          <p className="text-[11px]" style={{ color: "rgba(250, 204, 21, 0.75)" }}>
            Paid league dues and payouts are external via FanCred.
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

        <div className="flex items-center gap-2 text-[11px] sm:text-xs mt-auto" style={{ color: "var(--muted)" }}>
          <Users className="h-3 w-3 sm:h-3.5 sm:w-3.5 shrink-0" />
          <span>
            {league.memberCount}
            {league.maxMembers > 0 ? ` / ${league.maxMembers}` : ""} spots
          </span>
        </div>
        {league.maxMembers > 0 && (
          <div
            className="h-1.5 rounded-full overflow-hidden"
            style={{ background: "var(--panel2)" }}
          >
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${Math.min(100, league.fillPct)}%`,
                background: isFull ? "var(--muted)" : "var(--accent)",
              }}
            />
          </div>
        )}
      </div>
      <div
        className="p-3 sm:p-4 pt-0 flex flex-wrap items-center gap-2 border-t"
        style={{ borderColor: "var(--border)" }}
      >
        <Link
          href={league.detailUrl}
          data-testid={`creator-discovery-view-${league.id}`}
          className="rounded-lg border px-2.5 sm:px-3 py-2.5 min-h-[40px] sm:min-h-[44px] inline-flex items-center justify-center text-xs sm:text-sm font-medium transition-colors hover:bg-white/5 touch-manipulation"
          style={{ borderColor: "var(--border)", color: "var(--text)" }}
        >
          View
        </Link>
        {!isFull ? (
          <Link
            href={league.joinUrl}
            data-testid={`creator-discovery-join-${league.id}`}
            onClick={() =>
              trackDiscoveryJoinClick({
                leagueId: league.id,
                source: "creator",
                leagueName: league.name,
                sport: league.sport,
                joinUrl: league.joinUrl,
              })
            }
            className="rounded-lg px-2.5 sm:px-3 py-2.5 min-h-[40px] sm:min-h-[44px] inline-flex items-center justify-center text-xs sm:text-sm font-medium transition-opacity hover:opacity-90 touch-manipulation"
            style={{ background: "var(--accent)", color: "var(--bg)" }}
            title={league.isPaid ? paidBoundaryDisclosure : undefined}
          >
            Join
          </Link>
        ) : (
          <span
            className="rounded-lg px-2.5 sm:px-3 py-2.5 min-h-[40px] sm:min-h-[44px] inline-flex items-center justify-center text-xs sm:text-sm font-medium"
            style={{ background: "var(--panel2)", color: "var(--muted)" }}
          >
            Full
          </span>
        )}
        {league.creatorSlug && (
          <Link
            href={`/creators/${encodeURIComponent(league.creatorSlug)}`}
            data-testid={`creator-discovery-footer-profile-link-${league.creatorSlug}`}
            className="text-xs sm:text-sm font-medium ml-auto"
            style={{ color: "var(--accent)" }}
          >
            Creator
          </Link>
        )}
      </div>
    </article>
  )
}
