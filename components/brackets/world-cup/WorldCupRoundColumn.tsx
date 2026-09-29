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
  align = "left",
  fillHeight = false,
  connectorSide = "none",
  compactBoard = false,
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
  align?: "left" | "right" | "center"
  fillHeight?: boolean
  connectorSide?: "left" | "right" | "both" | "none"
  compactBoard?: boolean
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
  const alignClass =
    align === "right" ? "items-end text-right" : align === "center" ? "items-center text-center" : "items-start text-left"
  const connectorClass =
    connectorSide === "right"
      ? "right-[-1.25rem] border-r border-y rounded-r-2xl"
      : connectorSide === "left"
        ? "left-[-1.25rem] border-l border-y rounded-l-2xl"
        : connectorSide === "both"
          ? "left-[-1.25rem] right-[-1.25rem] border-y"
          : ""
  return (
    <section
      className={[
        compactBoard
          ? "relative flex min-w-0 flex-col gap-2"
          : "relative flex min-w-[17.75rem] shrink-0 flex-col gap-3 sm:min-w-[19rem]",
        fillHeight ? "h-full" : "",
        alignClass,
      ].filter(Boolean).join(" ")}
    >
      <div className={[
        "sticky top-0 z-20 w-full rounded-xl border border-cyan-300/15 bg-slate-950/80 shadow-[0_12px_30px_-24px_rgba(34,211,238,0.7)] backdrop-blur",
        compactBoard ? "px-2 py-1.5" : "px-3 py-2",
      ].join(" ")}>
        <h2 className={`${compactBoard ? "text-[11px] tracking-[0.16em]" : "text-xs tracking-[0.2em]"} font-black uppercase text-white/70`}>
          {label}
        </h2>
      </div>
      {connectorSide !== "none" && (
        <div
          aria-hidden="true"
          className={[
            "pointer-events-none absolute bottom-10 top-16 z-0 hidden border-cyan-300/15 xl:block",
            connectorClass,
          ].join(" ")}
        />
      )}
      <div
        className={[
          "relative z-10 flex w-full flex-col gap-3",
          fillHeight ? "flex-1 justify-around" : "",
          align === "right" ? "items-end" : align === "center" ? "items-center" : "items-start",
        ].filter(Boolean).join(" ")}
      >
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
              compactBoard={compactBoard}
              pickInModalOnly={compactBoard}
            />
          )
        })}
      </div>
    </section>
  )
}
