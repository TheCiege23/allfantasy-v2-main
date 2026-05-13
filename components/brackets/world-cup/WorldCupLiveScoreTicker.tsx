"use client"
import Image from "next/image"
import { Radio } from "lucide-react"
import type { WorldCupMatchView } from "@/lib/world-cup/types"
import {
  formatWorldCupKickoffShort,
  formatWorldCupMatchStatus,
  getWorldCupMatchDisplayScore,
  isWorldCupMatchFinal,
  isWorldCupMatchLive,
} from "@/lib/world-cup/worldCupMatchStatus"

function TeamChip({ name, logo }: { name: string; logo?: string | null }) {
  return (
    <span className="flex items-center gap-1">
      {logo ? (
        <Image
          src={logo}
          alt=""
          width={16}
          height={16}
          className="h-4 w-4 rounded-full bg-white object-contain"
        />
      ) : (
        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-white/10 text-[8px] font-black text-white/50">
          {name.slice(0, 2).toUpperCase()}
        </span>
      )}
      <span className="max-w-[72px] truncate font-bold text-white/80">{name}</span>
    </span>
  )
}

function MatchChip({ match }: { match: WorldCupMatchView }) {
  const isLive = isWorldCupMatchLive(match)
  const isFinal = isWorldCupMatchFinal(match)
  const statusLabel = formatWorldCupMatchStatus(match)
  const score = getWorldCupMatchDisplayScore(match)
  const isSimulated = match.apiStatusShort === "SIM"

  return (
    <div className="flex shrink-0 items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-3 py-1.5 text-[11px] text-white/60 transition-colors hover:border-white/25">
      {isLive && (
        <span className="flex items-center gap-0.5 text-rose-300 font-bold">
          <Radio className="h-3 w-3" />
          {statusLabel}
        </span>
      )}
      {isFinal && (
        <span className="text-emerald-300 font-bold text-[10px]">FT</span>
      )}
      {isSimulated && <span className="text-amber-300 font-bold text-[10px]">SIM</span>}
      <TeamChip name={match.homeTeamName || "TBD"} logo={match.homeTeamLogo} />
      <span className={`tabular-nums font-black ${isLive ? "text-white" : "text-white/50"}`}>
        {score}
      </span>
      <TeamChip name={match.awayTeamName || "TBD"} logo={match.awayTeamLogo} />
    </div>
  )
}

export default function WorldCupLiveScoreTicker({ matches }: { matches: WorldCupMatchView[] }) {
  if (!matches || matches.length === 0) {
    return (
      <div className="flex items-center gap-1.5 border-b border-white/10 bg-black/30 px-4 py-2 text-[11px] text-white/30">
        <Radio className="h-3 w-3 shrink-0 opacity-40" />
        <span className="italic">World Cup fixtures will appear here once synced.</span>
      </div>
    )
  }

  // Priority: live > halftime > scheduled (upcoming) > recently final
  const live = matches.filter(isWorldCupMatchLive)
  const upcoming = matches
    .filter((m) => m.status === "scheduled" && m.startsAt)
    .sort((a, b) => (a.startsAt! > b.startsAt! ? 1 : -1))
    .slice(0, 4)
  const recent = matches.filter(isWorldCupMatchFinal).slice(-4)

  const primary = live.length > 0 ? live : upcoming.length > 0 ? upcoming : recent
  if (primary.length === 0) return null

  const showLiveDot = live.length > 0

  return (
    <div className="flex items-center gap-2 overflow-x-auto border-b border-white/10 bg-black/40 px-3 py-2 scrollbar-none">
      {showLiveDot && (
        <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-rose-300">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-rose-400" />
          Live
        </span>
      )}
      {!showLiveDot && upcoming.length > 0 && (
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-widest text-white/30">
          Next
        </span>
      )}
      {!showLiveDot && upcoming.length > 0 && (
        <span className="shrink-0 text-[10px] text-white/40">
          {formatWorldCupKickoffShort(upcoming[0]?.startsAt)}
        </span>
      )}
      {primary.map((m) => (
        <MatchChip key={m.id} match={m} />
      ))}
    </div>
  )
}

