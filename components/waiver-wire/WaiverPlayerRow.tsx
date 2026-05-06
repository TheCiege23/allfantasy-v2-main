"use client"

import Link from "next/link"
import Image from "next/image"
import { Plus, TrendingUp } from "lucide-react"
import { teamLogoUrl } from "@/lib/media-url"

type Props = {
  player: {
    id: string
    name: string
    position: string | null
    team: string | null
    headshotUrl?: string | null
    injuryStatus?: string | null
    /** From waiver adapter — optional experience chip */
    experienceSummary?: string | null
  }
  sport?: string | null
  onAddClick: () => void
  onRowClick?: () => void
  onToggleWatchlist?: () => void
  watchlisted?: boolean
  alreadyClaimed?: boolean
  trendScore?: number
}

export default function WaiverPlayerRow({
  player,
  sport,
  onAddClick,
  onRowClick,
  onToggleWatchlist,
  watchlisted,
  alreadyClaimed,
  trendScore,
}: Props) {
  const pos = player.position || "—"
  const team = player.team || "FA"
  const trend = typeof trendScore === "number" ? trendScore : 0
  const logo = player.team ? teamLogoUrl(player.team, sport ?? 'NFL') : ''
  const detailsHref = `/player-comparison?player=${encodeURIComponent(player.name)}&sport=${encodeURIComponent(
    sport ?? "NFL"
  )}`

  return (
    <li
      className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm sm:px-4"
      data-testid={`waiver-player-row-${player.id}`}
      onClick={onRowClick}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {player.headshotUrl && /^https?:\/\//i.test(player.headshotUrl) ? (
          <Image
            src={player.headshotUrl}
            alt=""
            width={36}
            height={36}
            className="h-9 w-9 shrink-0 rounded-full object-cover ring-1 ring-white/10"
            unoptimized
            data-testid={`waiver-player-headshot-${player.id}`}
          />
        ) : (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cyan-500/15 text-xs font-semibold text-cyan-100">
            {pos}
          </div>
        )}
        {logo ? (
          <Image
            src={logo}
            alt={`${team} logo`}
            data-testid={`waiver-player-team-logo-${player.id}`}
            width={28}
            height={28}
            unoptimized
            className="h-7 w-7 rounded object-contain"
            loading="lazy"
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1 text-white">
            <span className="truncate font-medium">{player.name}</span>
            <span className="text-xs text-white/60">· {team}</span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-white/55">
            {player.injuryStatus ? (
              <span className="rounded border border-amber-400/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-100">
                {player.injuryStatus}
              </span>
            ) : null}
            {player.experienceSummary ? (
              <span className="rounded border border-cyan-400/25 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] text-cyan-100">
                {player.experienceSummary}
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1">
              <TrendingUp className="h-3 w-3 text-emerald-300" />
              <span>Trend: {trend > 0 ? `+${trend}` : 'neutral'}</span>
            </span>
            {watchlisted && (
              <span className="rounded-full border border-fuchsia-400/40 bg-fuchsia-500/10 px-1.5 py-0.5 text-[10px] text-fuchsia-200">
                Watchlist
              </span>
            )}
            <span className="text-white/40">Waiver activity score</span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <Link
          href={detailsHref}
          onClick={(e) => e.stopPropagation()}
          data-testid={`waiver-player-detail-link-${player.id}`}
          className="rounded-lg border border-white/20 bg-black/40 px-2 py-1 text-[11px] text-white/75 hover:text-white"
        >
          Details
        </Link>
        {onToggleWatchlist && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onToggleWatchlist()
            }}
            data-testid={`waiver-watchlist-toggle-${player.id}`}
            className={`rounded-lg border px-2 py-1 text-[11px] ${
              watchlisted
                ? "border-fuchsia-400/60 bg-fuchsia-500/20 text-fuchsia-100"
                : "border-white/20 bg-black/40 text-white/70 hover:text-white"
            }`}
          >
            {watchlisted ? "Watchlisted" : "Watch"}
          </button>
        )}
        {alreadyClaimed ? (
          <span className="inline-flex items-center rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-200">
            Already claimed
          </span>
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onAddClick()
            }}
            data-testid={`waiver-claim-open-${player.id}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-400/50 bg-cyan-500/15 px-3 py-1.5 text-xs font-medium text-cyan-100 hover:bg-cyan-500/25"
          >
            <Plus className="h-3.5 w-3.5" />
            Claim
          </button>
        )}
        {trend > 0 && (
          <span className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-200">
            Trending
          </span>
        )}
        {alreadyClaimed && (
          <span className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-200">
            Claimed
          </span>
        )}
        {team === "FA" && (
          <span className="rounded-lg border border-white/20 bg-black/40 px-2 py-1 text-[10px] text-white/70">
            Free agent
          </span>
        )}
      </div>
    </li>
  )
}

