"use client"
import { useMemo } from "react"
import { Check, Loader2, Sparkles } from "lucide-react"
import type { WorldCupMatchView, WorldCupPickView } from "@/lib/world-cup/types"
import {
  hasWorldCupPickSelection,
  isWorldCupMatchPickable,
} from "@/lib/world-cup/worldCupProjectedBracket"
import { formatWorldCupPlaceholder } from "@/lib/world-cup/worldCupBracketUtils"
import { useOptionalLanguage } from "@/components/i18n/LanguageProviderClient"
import { makeWcT } from "@/lib/world-cup/worldCupI18n"
import WorldCupTeamFlag from "./WorldCupTeamFlag"

/**
 * Premium compact bracket card — fixed h-[5.5rem] (88 px) so it stacks
 * precisely in the championship-tree geometry managed by WorldCupBracketBoard.
 *
 * Layout: 16 px header (match label + live/FT status) +
 *         36 px home row (flag + name + checkmark + score) +
 *         36 px away row.
 *
 * Visual states:
 *   default  – deep navy bg, subtle border
 *   selected – cyan glow ring, stronger background
 *   live     – emerald pulsing border, elapsed-minute label
 *   final    – muted; winner row is brighter
 *   saving   – spinner replaces status label
 */
export default function WorldCupBracketCard({
  match,
  pick,
  locked = false,
  onPick,
  onOpenMatchupPicker,
  isSaving = false,
  aiInsightsUnlocked = false,
}: {
  match: WorldCupMatchView
  pick?: WorldCupPickView
  locked?: boolean
  onPick?: (match: WorldCupMatchView, side: "home" | "away", confidencePoints?: number | null) => void
  onOpenMatchupPicker?: (matchId: string) => void
  isSaving?: boolean
  aiInsightsUnlocked?: boolean
}) {
  const { language } = useOptionalLanguage()
  const t = useMemo(() => makeWcT(language), [language])

  const pickable = isWorldCupMatchPickable(match)
  const homeName = formatWorldCupPlaceholder(match.homeSlotKey, match.homeTeamName, match.homeTeamId)
  const awayName = formatWorldCupPlaceholder(match.awaySlotKey, match.awayTeamName, match.awayTeamId)

  const homeSelected =
    pick &&
    hasWorldCupPickSelection(pick) &&
    (pick.selectedTeamId === match.homeTeamId ||
      (pick.selectedSlotKey != null && pick.selectedSlotKey === match.homeSlotKey))
  const awaySelected =
    pick && hasWorldCupPickSelection(pick) && !homeSelected

  const isLive = match.status === "live" || match.status === "halftime"
  const isFinal = match.status === "final"

  // Winner detection (for final-state matches)
  const homeWon = isFinal && match.winnerTeamId != null && match.winnerTeamId === match.homeTeamId
  const awayWon = isFinal && match.winnerTeamId != null && match.winnerTeamId === match.awayTeamId

  const statusText = (() => {
    if (isLive) {
      if (match.elapsedMinute) return `${match.elapsedMinute}'`
      return "LIVE"
    }
    if (isFinal) return "FT"
    if (isSaving) return "…"
    return null
  })()

  // Compact schedule label shown in the header when match hasn't started yet.
  // Uses "en" locale so SSR and CSR always produce the same string (no
  // hydration mismatch from browser-locale differences).
  const scheduleLabel = useMemo<string | null>(() => {
    if (isLive || isFinal || isSaving) return null
    if (!match.startsAt) return t("wc.matchup.scheduleTbd")
    try {
      const d = new Date(match.startsAt)
      // "Jun 12" — compact enough for the 9px header
      return d.toLocaleDateString("en", { month: "short", day: "numeric" })
    } catch {
      return null
    }
  }, [match.startsAt, isLive, isFinal, isSaving, t])

  function handlePick(side: "home" | "away") {
    if (locked || !pickable || isSaving) return
    onPick?.(match, side, null)
  }

  // ── Card-level classes ──────────────────────────────────────────────────────
  const cardClasses = [
    "h-[5.5rem] overflow-hidden rounded-xl border backdrop-blur relative",
    isLive
      ? "border-emerald-400/35 bg-[#08140f]/90 shadow-[0_0_14px_-4px_rgba(52,211,153,0.22)]"
      : isFinal
      ? "border-white/[0.09] bg-[#060a14]/80"
      : "border-white/[0.14] bg-[#07111f]/88",
  ].join(" ")

  // ── Team row builder ────────────────────────────────────────────────────────
  function teamRowClasses(
    selected: boolean | Pick<typeof pick, never> | undefined,
    won: boolean
  ) {
    return [
      "flex h-9 w-full items-center gap-1.5 px-2 transition-colors",
      locked || !pickable
        ? "cursor-default opacity-55"
        : "hover:bg-white/[0.07] active:bg-white/[0.11]",
      selected
        ? "bg-cyan-300/[0.17] text-white shadow-[inset_0_0_0_1px_rgba(103,232,249,0.22)]"
        : won
        ? "bg-white/[0.05] text-white/90"
        : "text-white/72",
    ].join(" ")
  }

  return (
    <div data-testid={`world-cup-match-${match.id}`} className={cardClasses}>
      {/* Live pulse ring — sits on top of border */}
      {isLive && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-emerald-400/25 animate-pulse"
        />
      )}

      {/* ── Header row: match label + status ─────────────────────────────── */}
      <div
        className={[
          "flex h-4 items-center justify-between gap-1 border-b px-2",
          isLive ? "border-emerald-400/[0.12]" : "border-white/[0.07]",
        ].join(" ")}
      >
        <button
          type="button"
          role="button"
          aria-label={t("wc.matchup.openGuidedAria", { number: match.matchNumber })}
          onClick={() => onOpenMatchupPicker?.(match.id)}
          className="min-w-0 flex-1 truncate text-left text-[9px] font-black uppercase tracking-[0.14em] text-white/35 hover:text-white/65 transition-colors"
        >
          {match.label ?? `M${match.matchNumber}`}
        </button>

        {/* Right-side header indicators: saving spinner → live status → FT → date → AI sparkle */}
        <div className="flex shrink-0 items-center gap-1">
          {isSaving ? (
            <Loader2 className="h-2.5 w-2.5 animate-spin text-white/40" />
          ) : isLive ? (
            <span className="flex items-center gap-0.5 text-[8px] font-black text-emerald-300">
              <span
                className="mr-0.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping"
                aria-hidden
              />
              {statusText}
            </span>
          ) : statusText ? (
            <span className="text-[8px] font-black uppercase tracking-wide text-white/40">
              {statusText}
            </span>
          ) : scheduleLabel ? (
            <span className="text-[8px] font-semibold text-white/30" aria-label={`Kickoff ${scheduleLabel}`}>
              {scheduleLabel}
            </span>
          ) : null}

          {/* AI Insights button — visible for all users; gating is handled inside
               the guided picker (free users see an upgrade prompt, Pro sees the panel) */}
          {onOpenMatchupPicker && !isSaving && (
            <button
              type="button"
              onClick={() => onOpenMatchupPicker(match.id)}
              aria-label={t("wc.matchup.aiInsightsAria", { number: match.matchNumber })}
              className={[
                "flex h-3.5 w-3.5 items-center justify-center rounded transition-colors",
                aiInsightsUnlocked
                  ? "text-cyan-300/70 hover:text-cyan-200"
                  : "text-white/20 hover:text-white/45",
              ].join(" ")}
            >
              <Sparkles className="h-2.5 w-2.5" aria-hidden />
            </button>
          )}
        </div>

        {/* Screen-reader only: unpickable reason */}
        {!pickable && (
          <span
            data-testid={`world-cup-match-disabled-reason-${match.id}`}
            className="sr-only"
          >
            {t("wc.matchup.unpickableTeams")}
          </span>
        )}
      </div>

      {/* ── Home team row ──────────────────────────────────────────────────── */}
      <button
        type="button"
        data-testid={`world-cup-team-${match.id}-home`}
        onClick={() => handlePick("home")}
        disabled={locked || !pickable || isSaving}
        aria-pressed={homeSelected ? true : undefined}
        aria-label={
          homeSelected
            ? t("wc.matchup.pickAriaSelected", { name: homeName })
            : t("wc.matchup.pickAriaPicked", { name: homeName })
        }
        className={teamRowClasses(homeSelected, homeWon)}
      >
        <WorldCupTeamFlag
          flagUrl={match.homeTeamLogo}
          teamName={match.homeTeamName}
          size="xs"
          className="shrink-0"
        />
        <span
          className={[
            "min-w-0 flex-1 truncate text-left text-[11px] leading-none",
            homeSelected || homeWon ? "font-black" : "font-bold",
          ].join(" ")}
        >
          {homeName}
        </span>
        {homeSelected && (
          <Check className="h-2.5 w-2.5 shrink-0 text-cyan-300" aria-hidden />
        )}
        {match.homeScore != null && match.awayScore != null && (
          <span
            className={[
              "shrink-0 text-[11px] font-black",
              homeWon ? "text-white" : "text-white/50",
            ].join(" ")}
          >
            {match.homeScore}
          </span>
        )}
      </button>

      {/* ── Away team row ──────────────────────────────────────────────────── */}
      <button
        type="button"
        data-testid={`world-cup-team-${match.id}-away`}
        onClick={() => handlePick("away")}
        disabled={locked || !pickable || isSaving}
        aria-pressed={awaySelected ? true : undefined}
        aria-label={
          awaySelected
            ? t("wc.matchup.pickAriaSelected", { name: awayName })
            : t("wc.matchup.pickAriaPicked", { name: awayName })
        }
        className={[
          "border-t",
          isLive ? "border-emerald-400/[0.10]" : "border-white/[0.07]",
          teamRowClasses(awaySelected, awayWon),
        ].join(" ")}
      >
        <WorldCupTeamFlag
          flagUrl={match.awayTeamLogo}
          teamName={match.awayTeamName}
          size="xs"
          className="shrink-0"
        />
        <span
          className={[
            "min-w-0 flex-1 truncate text-left text-[11px] leading-none",
            awaySelected || awayWon ? "font-black" : "font-bold",
          ].join(" ")}
        >
          {awayName}
        </span>
        {awaySelected && (
          <Check className="h-2.5 w-2.5 shrink-0 text-cyan-300" aria-hidden />
        )}
        {match.homeScore != null && match.awayScore != null && (
          <span
            className={[
              "shrink-0 text-[11px] font-black",
              awayWon ? "text-white" : "text-white/50",
            ].join(" ")}
          >
            {match.awayScore}
          </span>
        )}
      </button>
    </div>
  )
}
