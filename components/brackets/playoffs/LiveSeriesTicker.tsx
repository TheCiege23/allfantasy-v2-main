"use client"

import type { PlayoffSeriesView } from "@/lib/playoffs/types"

type Props = {
  series: PlayoffSeriesView[]
}

/**
 * LiveSeriesTicker
 *
 * Horizontally-scrollable ticker strip showing live and recently finalised
 * playoff series. Renders nothing when there is no interesting activity
 * (all series are "scheduled" with 0 wins).
 *
 * — Shows "🔴 Live" chips for STATUS_IN_PROGRESS series
 * — Shows compact "W–L Final" chips for completed series
 * — Shows score chips for in-between-game series that have started
 */
export default function LiveSeriesTicker({ series }: Props) {
  // Only show series that have meaningful activity (live, final, or partially played)
  const activeSeries = series.filter(
    (s) => s.status === "in_progress" || s.status === "final" || s.homeWins > 0 || s.awayWins > 0
  )

  if (activeSeries.length === 0) return null

  const liveSeries = activeSeries.filter((s) => s.status === "in_progress")
  const finalSeries = activeSeries.filter((s) => s.status === "final")
  const ongoingSeries = activeSeries.filter(
    (s) => s.status === "scheduled" && (s.homeWins > 0 || s.awayWins > 0)
  )

  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-900 py-2.5 shadow-sm">
      {/* Fade edges on desktop */}
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-6 bg-gradient-to-r from-slate-900 to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-6 bg-gradient-to-l from-slate-900 to-transparent" />

      {/* Scrollable track */}
      <div className="flex items-center gap-2.5 overflow-x-auto px-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {/* "LIVE" label */}
        {liveSeries.length > 0 && (
          <span className="shrink-0 rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-white">
            LIVE
          </span>
        )}

        {/* Live series chips */}
        {liveSeries.map((s) => (
          <TickerChip key={s.id} series={s} variant="live" />
        ))}

        {/* Divider between live and non-live */}
        {liveSeries.length > 0 && (ongoingSeries.length > 0 || finalSeries.length > 0) && (
          <span className="h-5 w-px shrink-0 bg-slate-600" />
        )}

        {/* Ongoing (between games) */}
        {ongoingSeries.map((s) => (
          <TickerChip key={s.id} series={s} variant="ongoing" />
        ))}

        {/* Final series */}
        {finalSeries.map((s) => (
          <TickerChip key={s.id} series={s} variant="final" />
        ))}
      </div>
    </div>
  )
}

function TickerChip({
  series,
  variant,
}: {
  series: PlayoffSeriesView
  variant: "live" | "ongoing" | "final"
}) {
  const homeName = shortName(series.homeTeamName)
  const awayName = shortName(series.awayTeamName)

  if (variant === "final") {
    // Show winner in bold, loser muted
    const homeWon = series.winnerTeamName === series.homeTeamName
    return (
      <div className="flex shrink-0 items-center gap-1.5 rounded-lg bg-slate-800 px-2.5 py-1 text-xs">
        <span className={homeWon ? "font-black text-emerald-400" : "font-medium text-slate-500"}>
          {homeName}
        </span>
        <span className="font-black text-slate-400">{series.homeWins}–{series.awayWins}</span>
        <span className={!homeWon ? "font-black text-emerald-400" : "font-medium text-slate-500"}>
          {awayName}
        </span>
        <span className="ml-0.5 rounded bg-emerald-900/50 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-400">
          Final
        </span>
      </div>
    )
  }

  if (variant === "live") {
    return (
      <div className="flex shrink-0 items-center gap-1.5 rounded-lg bg-rose-900/40 px-2.5 py-1 text-xs ring-1 ring-rose-700/50">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose-500" />
        <span className="font-semibold text-slate-200">{homeName}</span>
        <span className="font-black text-rose-300">{series.homeWins}–{series.awayWins}</span>
        <span className="font-semibold text-slate-200">{awayName}</span>
        <span className="text-[9px] font-bold uppercase tracking-wide text-rose-400">
          Game {series.homeWins + series.awayWins + 1}
        </span>
      </div>
    )
  }

  // ongoing (between games)
  return (
    <div className="flex shrink-0 items-center gap-1.5 rounded-lg bg-slate-800 px-2.5 py-1 text-xs">
      <span className="font-semibold text-slate-300">{homeName}</span>
      <span className="font-black text-slate-400">{series.homeWins}–{series.awayWins}</span>
      <span className="font-semibold text-slate-300">{awayName}</span>
    </div>
  )
}

/** Shorten a team name to its last word (nickname), max 10 chars */
function shortName(name: string): string {
  if (!name) return "?"
  const parts = name.trim().split(/\s+/)
  const last = parts[parts.length - 1]
  return last.length > 10 ? last.slice(0, 9) + "…" : last
}
