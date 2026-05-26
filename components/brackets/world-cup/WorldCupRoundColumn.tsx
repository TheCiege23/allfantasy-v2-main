"use client"
import { useEffect, useState } from "react"
import type { WorldCupMatchView, WorldCupPickView, WorldCupRound } from "@/lib/world-cup/types"
import { findWorldCupPickForMatch } from "@/lib/world-cup/worldCupProjectedBracket"
import WorldCupMatchupCard from "./WorldCupMatchupCard"
export default function WorldCupRoundColumn({
  round,
  label,
  matches,
  picks,
  onPick,
  onOpenMatchupPicker,
  savingMatchIds,
  isBracketLocked = false,
  lockStrategy,
  tournamentLockAt,
  aiInsightsUnlocked = false,
  confidenceScoringEnabled = false,
}: {
  round: WorldCupRound
  /** Translated round label supplied by the parent (avoids an extra locale hook in this component). */
  label: string
  matches: WorldCupMatchView[]
  picks: WorldCupPickView[]
  onPick: (match: WorldCupMatchView, side: "home" | "away", confidencePoints?: number | null) => void
  onOpenMatchupPicker?: (matchId: string) => void
  savingMatchIds?: Set<string>
  isBracketLocked?: boolean
  lockStrategy?: string
  tournamentLockAt?: string | null
  aiInsightsUnlocked?: boolean
  confidenceScoringEnabled?: boolean
}) {
  // Hydration-safe: seed with epoch so SSR and the first CSR render produce
  // identical HTML (kickoffPast/tournamentPast both false). After mount, swap
  // to the real clock and refresh every 60s so lock state updates as matches
  // approach. Replaces a previously per-render `new Date()` that tripped
  // React #425 / #418 hydration warnings on the Knockouts tab.
  const [now, setNow] = useState<Date>(() => new Date(0))
  useEffect(() => {
    setNow(new Date())
    const id = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(id)
  }, [])
  return (
    <section className="flex min-w-[13rem] shrink-0 flex-col gap-3 sm:min-w-[17rem]">
      <div className="sticky top-0 z-10 rounded-lg border border-white/10 bg-black/70 px-3 py-2 backdrop-blur">
        <h2 className="text-xs font-black uppercase tracking-[0.2em] text-white/70">
          {label}
        </h2>
      </div>
      <div className="flex flex-col gap-3">
        {matches.map((match) => {
          const kickoffPast = Boolean(match.startsAt && new Date(match.startsAt) <= now)
          const apiStatus = (match.apiStatusShort ?? "").trim().toUpperCase()
          const nonOfficialTestState = apiStatus === "SIM" || apiStatus === "TEST"
          const tournamentPast = lockStrategy === "tournament_start" && tournamentLockAt
            ? new Date(tournamentLockAt) <= now
            : false
          const locked =
            isBracketLocked ||
            kickoffPast ||
            tournamentPast ||
            (!nonOfficialTestState &&
              (match.status === "final" ||
                match.status === "live" ||
                match.status === "halftime"))
          return (
            <WorldCupMatchupCard
              key={match.id}
              match={match}
              pick={findWorldCupPickForMatch(picks, match) ?? undefined}
              locked={locked}
              lockStrategy={lockStrategy}
              tournamentLockAt={tournamentLockAt}
              onPick={onPick}
              onOpenMatchupPicker={onOpenMatchupPicker}
              isSaving={savingMatchIds?.has(match.id) ?? false}
              aiInsightsUnlocked={aiInsightsUnlocked}
              confidenceScoringEnabled={confidenceScoringEnabled}
            />
          )
        })}
      </div>
    </section>
  )
}
