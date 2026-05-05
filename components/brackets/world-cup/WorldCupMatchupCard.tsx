"use client"
import Image from "next/image"
import { Check, Clock, Lock, Radio, Trophy } from "lucide-react"
import type { WorldCupMatchView, WorldCupPickView } from "@/lib/world-cup/types"

function Logo({ src, name }: { src?: string | null; name: string }) {
  return src ? (
    <Image src={src} alt="" width={28} height={28} className="h-7 w-7 shrink-0 rounded-full bg-white object-contain p-0.5" />
  ) : (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/10 text-[10px] font-black text-white/70">
      {name.slice(0, 2).toUpperCase()}
    </span>
  )
}

function formatLockTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    })
  } catch {
    return iso
  }
}

export { formatWorldCupPlaceholder } from "@/lib/world-cup/worldCupBracketUtils"
import { formatWorldCupPlaceholder } from "@/lib/world-cup/worldCupBracketUtils"

export default function WorldCupMatchupCard({
  match,
  pick,
  locked,
  lockStrategy,
  tournamentLockAt,
  onPick,
}: {
  match: WorldCupMatchView
  pick?: WorldCupPickView
  locked?: boolean
  /** "per_match" | "tournament_start" */
  lockStrategy?: string
  /** ISO string — used when lockStrategy === "tournament_start" */
  tournamentLockAt?: string | null
  onPick?: (match: WorldCupMatchView, side: "home" | "away") => void
}) {
  const teams = [
    { side: "home" as const, slotKey: match.homeSlotKey, teamId: match.homeTeamId, name: match.homeTeamName, logo: match.homeTeamLogo, score: match.homeScore },
    { side: "away" as const, slotKey: match.awaySlotKey, teamId: match.awayTeamId, name: match.awayTeamName, logo: match.awayTeamLogo, score: match.awayScore },
  ]

  // Derive human-readable lock hint
  let lockHint: string | null = null
  if (!locked) {
    if (lockStrategy === "tournament_start" && tournamentLockAt) {
      lockHint = `Locks ${formatLockTime(tournamentLockAt)}`
    } else if (lockStrategy === "per_match" || !lockStrategy) {
      if (match.startsAt) {
        lockHint = `Locks at kickoff · ${formatLockTime(match.startsAt as string)}`
      } else {
        lockHint = "Locks at kickoff"
      }
    }
  }

  const isPostponed = match.status === "postponed"
  const isCancelled = match.status === "cancelled"
  const isScheduled = match.status === "scheduled"

  return (
    <article className={`w-72 shrink-0 rounded-lg border bg-zinc-950/80 p-3 shadow-2xl shadow-black/30 ${locked ? "border-white/5" : "border-white/10"}`}>
      {/* Header row */}
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[10px] font-black uppercase tracking-[0.18em] text-white/35">
          Match {match.matchNumber}
        </span>
        <div className="flex items-center gap-1">
          {(match.status === "live" || match.status === "halftime") && (
            <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-bold text-rose-200">
              <Radio className="h-3 w-3" />
              {match.status === "halftime" ? "HT" : "Live"}
            </span>
          )}
          {match.status === "final" && (
            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-200">
              Final
            </span>
          )}
          {isPostponed && (
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-200">
              Postponed
            </span>
          )}
          {isCancelled && (
            <span className="rounded-full bg-zinc-500/15 px-2 py-0.5 text-[10px] font-bold text-zinc-400">
              Cancelled
            </span>
          )}
          {locked ? (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-white/5 px-1.5 py-0.5 text-[10px] font-bold text-white/35">
              <Lock className="h-3 w-3" />
              Locked
            </span>
          ) : null}
        </div>
      </div>

      {/* Team buttons */}
      <div className="space-y-2">
        {teams.map((t) => {
          const displayName = formatWorldCupPlaceholder(t.slotKey, t.name, t.teamId)
          const selected =
            pick?.selectedSlotKey === t.slotKey ||
            Boolean(pick?.selectedTeamId && t.teamId && pick.selectedTeamId === t.teamId)
          const winner =
            match.status === "final" &&
            (match.winnerTeamName === t.name || Boolean(match.winnerTeamId && t.teamId === match.winnerTeamId))
          const isPlaceholder = t.name?.toLowerCase().startsWith("tbd") || !t.teamId

          return (
            <button
              key={t.side}
              type="button"
              disabled={locked}
              onClick={() => !locked && onPick?.(match, t.side)}
              title={locked ? "Picks are locked for this match" : undefined}
              className={[
                "flex h-14 w-full items-center gap-2 rounded-md border px-2 text-left transition",
                selected ? "border-cyan-300/70 bg-cyan-300/10" : "border-white/10 bg-white/[0.03]",
                winner ? "border-emerald-300/70 bg-emerald-400/10" : "",
                match.status === "final" && selected && !winner ? "opacity-45" : "",
                locked ? "cursor-not-allowed opacity-60" : "hover:bg-white/[0.06]",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <Logo src={t.logo} name={displayName} />
              <span className="min-w-0 flex-1">
                <span className={`block truncate text-sm font-bold ${isPlaceholder ? "italic text-white/40" : "text-white"}`}>
                  {displayName}
                </span>
                <span className="block truncate text-[10px] text-white/30">{t.slotKey}</span>
              </span>
              {t.score != null && (
                <span className="text-sm font-black text-white">{t.score}</span>
              )}
              {selected && !locked && <Check className="h-4 w-4 shrink-0 text-cyan-200" />}
              {selected && locked && <Lock className="h-3.5 w-3.5 shrink-0 text-white/25" />}
              {winner && <Trophy className="h-4 w-4 shrink-0 text-emerald-200" />}
            </button>
          )
        })}
      </div>

      {/* Lock hint footer */}
      {lockHint && isScheduled && (
        <div className="mt-2 flex items-center gap-1 text-[10px] text-white/30">
          <Clock className="h-3 w-3" />
          {lockHint}
        </div>
      )}
    </article>
  )
}
