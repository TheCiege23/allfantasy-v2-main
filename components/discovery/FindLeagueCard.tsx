"use client"

import Link from "next/link"
import { Calendar, User, Sparkles, Zap } from "lucide-react"
import { trackDiscoveryJoinClick } from "@/lib/discovery-analytics/client"
import { getFanCredBoundaryDisclosureShort } from "@/lib/legal/FanCredBoundaryDisclosure"
import type { DiscoveryCard } from "@/lib/public-discovery/types"
import { useUserTimezone } from "@/hooks/useUserTimezone"

export interface FindLeagueCardProps {
  league: DiscoveryCard
}

function formatDraftDate(
  iso: string | null,
  formatDateInTimezone: (date: Date | string | number) => string
): string {
  if (!iso) return "—"
  try {
    return formatDateInTimezone(iso)
  } catch {
    return "—"
  }
}

function isNew(createdAt: string): boolean {
  try {
    const d = new Date(createdAt)
    return Date.now() - d.getTime() < 7 * 24 * 60 * 60 * 1000
  } catch {
    return false
  }
}

function formatLeagueType(league: DiscoveryCard): string {
  const style = String(league.leagueStyle ?? "").trim()
  if (style.length > 0) return style.replace(/_/g, " ")
  return String(league.leagueType ?? league.source ?? "league").replace(/_/g, " ")
}

function formatDraftStatus(status: string | null | undefined): string {
  const raw = String(status ?? "").trim()
  if (!raw) return "—"
  return raw.replace(/_/g, " ")
}

function getSourceLabel(source: DiscoveryCard["source"]): string {
  if (source === "fantasy") return "Public league"
  if (source === "creator") return "Creator league"
  return "Bracket"
}

function getSourceBadgeStyle(source: DiscoveryCard["source"]): {
  background: string
  color: string
} {
  if (source === "fantasy") {
    return { background: "rgba(14, 165, 233, 0.14)", color: "rgb(125, 211, 252)" }
  }
  if (source === "creator") {
    return { background: "rgba(168, 85, 247, 0.15)", color: "rgb(216, 180, 254)" }
  }
  return { background: "rgba(59, 130, 246, 0.15)", color: "rgb(96, 165, 250)" }
}

export function FindLeagueCard({ league }: FindLeagueCardProps) {
  const { formatDateInTimezone } = useUserTimezone()
  const paidBoundaryDisclosure = getFanCredBoundaryDisclosureShort()
  const isFull = league.maxMembers > 0 && league.memberCount >= league.maxMembers
  const fillingFast =
    !isFull && league.maxMembers > 0 && league.fillPct >= 50
  const showNew = isNew(league.createdAt)
  const hasAI = Array.isArray(league.aiFeatures) && league.aiFeatures.length > 0
  const canJoinDirect =
    !isFull &&
    !(league.inviteOnlyByTier === true || league.canJoinByRanking === false)
  const rankFitScore = Math.max(0, Number(league.rankingEffectScore ?? 0))
  const sourceBadgeStyle = getSourceBadgeStyle(league.source)
  const visibleAiFeatures = hasAI ? league.aiFeatures.slice(0, 2) : []

  return (
    <article
      data-testid={`find-league-card-${league.id}`}
      className="group rounded-2xl border overflow-hidden flex flex-col h-full transition-all duration-200 hover:border-[var(--accent)]/35 hover:shadow-lg"
      style={{
        borderColor: "var(--border)",
        background:
          "linear-gradient(155deg, color-mix(in srgb, var(--panel2) 32%, var(--panel)) 0%, var(--panel) 72%)",
        boxShadow: "0 2px 8px rgba(0,0,0,0.14)",
      }}
    >
      <div className="p-3 sm:p-4 flex-1 flex flex-col gap-2.5 sm:gap-3">
        <div className="flex items-start justify-between gap-2">
          <h3
            className="font-semibold text-sm sm:text-base leading-tight truncate flex-1 min-w-0"
            style={{ color: "var(--text)" }}
          >
            {league.name}
          </h3>
          <span
            className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap"
            style={sourceBadgeStyle}
          >
            {getSourceLabel(league.source)}
          </span>
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
            className="inline-flex items-center rounded-md px-1.5 sm:px-2 py-0.5 text-[11px] sm:text-xs font-medium capitalize"
            style={sourceBadgeStyle}
          >
            {league.source}
          </span>
          <span
            className="inline-flex items-center rounded-md px-1.5 sm:px-2 py-0.5 text-[11px] sm:text-xs font-medium capitalize"
            style={{ background: "rgba(148, 163, 184, 0.14)", color: "rgb(203, 213, 225)" }}
          >
            {formatLeagueType(league)}
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
          {rankFitScore > 0 && (
            <span
              className="inline-flex items-center rounded-md px-1.5 sm:px-2 py-0.5 text-[11px] sm:text-xs font-medium"
              title="Ranking effect score based on league tier fit and direct-join eligibility."
              style={{ background: "rgba(56, 189, 248, 0.14)", color: "rgb(125, 211, 252)" }}
            >
              Rank fit +{rankFitScore}
            </span>
          )}
        </div>
        {league.isPaid ? (
          <p className="text-[11px]" style={{ color: "rgba(250, 204, 21, 0.75)" }}>
            Paid league dues and payouts are managed externally via FanCred.
          </p>
        ) : null}

        <p className="text-xs sm:text-sm truncate" style={{ color: "var(--muted)" }}>
          {league.sport}
          {league.tournamentName ? ` · ${league.tournamentName}` : ""}
          {league.season != null ? ` · ${league.season}` : ""}
        </p>
        {visibleAiFeatures.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {visibleAiFeatures.map((feature) => (
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
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-[11px] sm:text-xs" style={{ color: "var(--muted)" }}>
          <span>League type: {formatLeagueType(league)}</span>
          <span>Draft type: {league.draftType ?? "—"}</span>
          <span>Draft status: {formatDraftStatus(league.draftStatus)}</span>
          <span>
            Teams filled: {league.memberCount}
            {league.teamCount > 0 ? ` / ${league.teamCount}` : ""}
          </span>
          <span>AI features: {hasAI ? league.aiFeatures.join(", ") : "None"}</span>
          <span className="flex items-center gap-1">
            <Calendar className="h-3.5 w-3.5 shrink-0" />
            {formatDraftDate(league.draftDate, formatDateInTimezone)}
          </span>
          <span className="flex items-center gap-1">
            <User className="h-3.5 w-3.5 shrink-0" />
            {league.commissionerName || "Commissioner"}
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
                background: isFull ? "var(--muted)" : fillingFast ? "rgba(251,146,60,0.85)" : "var(--accent)",
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
          data-testid={`find-league-view-${league.id}`}
          className="rounded-lg border px-2.5 sm:px-3 py-2.5 min-h-[40px] sm:min-h-[44px] inline-flex items-center justify-center text-xs sm:text-sm font-medium transition-colors hover:bg-white/5 touch-manipulation"
          style={{ borderColor: "var(--border)", color: "var(--text)" }}
        >
          View
        </Link>
        {isFull ? (
          <span
            data-testid={`find-league-full-${league.id}`}
            className="rounded-lg px-2.5 sm:px-3 py-2.5 min-h-[40px] sm:min-h-[44px] inline-flex items-center justify-center text-xs sm:text-sm font-medium"
            style={{ background: "var(--panel2)", color: "var(--muted)" }}
          >
            Full
          </span>
        ) : league.inviteOnlyByTier === true || league.canJoinByRanking === false ? (
          <span
            data-testid={`find-league-invite-required-${league.id}`}
            className="rounded-lg px-2.5 sm:px-3 py-2.5 min-h-[40px] sm:min-h-[44px] inline-flex items-center justify-center text-xs sm:text-sm font-medium"
            style={{ background: "rgba(251, 146, 60, 0.14)", color: "rgb(251, 146, 60)" }}
            title="This league is outside your current rank window and needs commissioner invite."
          >
            Invite required
          </span>
        ) : (
          <Link
            href={league.joinUrl}
            data-testid={`find-league-join-${league.id}`}
            onClick={() =>
              trackDiscoveryJoinClick({
                leagueId: league.id,
                source: league.source,
                leagueName: league.name,
                sport: league.sport,
                joinUrl: league.joinUrl,
              })
            }
            className="rounded-lg px-2.5 sm:px-3 py-2.5 min-h-[40px] sm:min-h-[44px] inline-flex items-center justify-center text-xs sm:text-sm font-medium transition-opacity hover:opacity-90 touch-manipulation"
            style={{ background: "var(--accent)", color: "var(--bg)" }}
            aria-disabled={!canJoinDirect}
            title={league.isPaid ? paidBoundaryDisclosure : undefined}
          >
            Join
          </Link>
        )}
        {league.creatorSlug && (
          <Link
            href={`/creators/${encodeURIComponent(league.creatorSlug)}`}
            className="text-sm font-medium ml-auto"
            style={{ color: "var(--accent)" }}
          >
            Creator
          </Link>
        )}
      </div>
    </article>
  )
}
