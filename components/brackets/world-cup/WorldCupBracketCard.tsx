"use client"
import { useMemo } from "react"
import { Check, Lock, Radio, Trophy } from "lucide-react"
import type { WorldCupMatchView, WorldCupPickView } from "@/lib/world-cup/types"
import { formatWorldCupPlaceholder } from "@/lib/world-cup/worldCupBracketUtils"
import {
  getWorldCupPickLiveState,
  isWorldCupMatchFinal,
  isWorldCupMatchLive,
} from "@/lib/world-cup/worldCupMatchStatus"
import {
  getWorldCupUnpickableReason,
  isWorldCupMatchPickable,
} from "@/lib/world-cup/worldCupProjectedBracket"
import WorldCupTeamFlag from "./WorldCupTeamFlag"
import { useOptionalLanguage } from "@/components/i18n/LanguageProviderClient"
import { makeWcT } from "@/lib/world-cup/worldCupI18n"

/**
 * Compact bracket card used inside the left/right bracket layout.
 *
 * Fixed height of 88 px (h-[5.5rem]) keeps the bracket column spacer
 * math (CARD_H=88, SLOT=96) aligned across all rounds. For richer
 * detail, clicking the match header opens the guided matchup picker.
 *
 * Preserves all testids and aria-labels expected by the component test
 * suite so that existing shell tests continue to pass without changes.
 */
export default function WorldCupBracketCard({
  match,
  pick,
  locked,
  onPick,
  onOpenMatchupPicker,
  isSaving = false,
}: {
  match: WorldCupMatchView
  pick?: WorldCupPickView
  locked?: boolean
  onPick?: (match: WorldCupMatchView, side: "home" | "away", confidencePoints?: number | null) => void
  onOpenMatchupPicker?: (matchId: string) => void
  isSaving?: boolean
}) {
  const { language } = useOptionalLanguage()
  const t = useMemo(() => makeWcT(language), [language])

  const isLive = isWorldCupMatchLive(match)
  const isFinal = isWorldCupMatchFinal(match)
  const matchIsPickable = isWorldCupMatchPickable(match)
  const pickLiveState = getWorldCupPickLiveState(match, pick)
  const showScore = isLive || isFinal

  const unpickableReason = matchIsPickable ? null : getWorldCupUnpickableReason(match)
  const unpickableMessage =
    unpickableReason === "final"
      ? t("wc.matchup.unpickableFinal")
      : unpickableReason === "missing_home_team" ||
          unpickableReason === "missing_away_team" ||
          unpickableReason === "placeholder_team"
        ? t("wc.matchup.unpickableMissingTeam")
        : t("wc.matchup.unpickableUnknown")

  const pickStateBorderClass =
    pickLiveState === "correct"
      ? "border-cyan-300/80 shadow-[0_0_0_1px_rgba(103,232,249,0.28)]"
      : pickLiveState === "incorrect"
        ? "border-rose-400/70 shadow-[0_0_0_1px_rgba(251,113,133,0.2)]"
        : pickLiveState === "winning"
          ? "border-cyan-300/50"
          : pickLiveState === "losing"
            ? "border-rose-400/30"
            : "border-white/10"

  const teams = [
    {
      side: "home" as const,
      slotKey: match.homeSlotKey,
      teamId: match.homeTeamId,
      name: match.homeTeamName,
      logo: match.homeTeamLogo,
      score: match.homeScore,
    },
    {
      side: "away" as const,
      slotKey: match.awaySlotKey,
      teamId: match.awayTeamId,
      name: match.awayTeamName,
      logo: match.awayTeamLogo,
      score: match.awayScore,
    },
  ]

  return (
    <article
      data-testid={`world-cup-match-${match.id}`}
      className={`h-[5.5rem] w-full overflow-hidden rounded-md border bg-zinc-950/80 transition ${pickStateBorderClass}`}
    >
      {/* ── Match header — tap to open guided picker ── */}
      <div
        role={onOpenMatchupPicker ? "button" : undefined}
        tabIndex={onOpenMatchupPicker ? 0 : undefined}
        onClick={onOpenMatchupPicker ? () => onOpenMatchupPicker(match.id) : undefined}
        onKeyDown={
          onOpenMatchupPicker
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  onOpenMatchupPicker(match.id)
                }
              }
            : undefined
        }
        aria-label={
          onOpenMatchupPicker
            ? t("wc.matchup.openGuidedAria", { number: match.matchNumber })
            : undefined
        }
        className={`flex h-4 items-center justify-between border-b border-white/5 px-1.5 ${
          onOpenMatchupPicker
            ? "cursor-pointer touch-manipulation hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-300/40"
            : ""
        }`}
      >
        <span className="text-[8px] font-black uppercase tracking-wider text-white/30">
          {t("wc.matchup.matchLabel", { number: match.matchNumber })}
        </span>
        <span className="flex items-center gap-0.5">
          {isLive && <Radio className="h-2.5 w-2.5 text-rose-400/80" />}
          {isSaving && (
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400/80" />
          )}
          {locked && !isLive && <Lock className="h-2.5 w-2.5 text-white/20" />}
        </span>
      </div>

      {/* ── Team pick buttons ── */}
      {teams.map((team, idx) => {
        const displayName = formatWorldCupPlaceholder(team.slotKey, team.name, team.teamId)
        const selected =
          pick?.selectedSlotKey === team.slotKey ||
          Boolean(pick?.selectedTeamId && team.teamId && pick.selectedTeamId === team.teamId)
        const winner =
          isFinal &&
          (match.winnerTeamName === team.name ||
            Boolean(match.winnerTeamId && team.teamId === match.winnerTeamId))
        const isPlaceholder =
          !team.name || team.name.toLowerCase().startsWith("tbd") || !team.teamId

        const pickAriaLabel = selected
          ? t("wc.matchup.pickAriaSelected", { name: displayName })
          : t("wc.matchup.pickAriaPicked", { name: displayName })

        return (
          <button
            key={team.side}
            type="button"
            data-testid={`world-cup-team-${match.id}-${team.side}`}
            aria-pressed={selected}
            aria-label={pickAriaLabel}
            disabled={locked || isSaving || !matchIsPickable}
            onClick={
              locked || isSaving || !matchIsPickable
                ? undefined
                : () => onPick?.(match, team.side, null)
            }
            className={[
              "flex h-9 w-full items-center gap-1.5 px-1.5 text-left transition touch-manipulation",
              idx === 1 ? "border-t border-white/5" : "",
              winner
                ? "bg-emerald-400/15"
                : selected && isFinal && !winner
                  ? "bg-rose-400/[0.06] opacity-75"
                  : selected
                    ? "bg-cyan-300/10"
                    : locked || isSaving || !matchIsPickable
                      ? "opacity-60"
                      : "hover:bg-white/[0.04]",
              locked || isSaving || !matchIsPickable
                ? "cursor-not-allowed"
                : "cursor-pointer",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <WorldCupTeamFlag flagUrl={team.logo} teamName={displayName} size="xs" />
            <span
              className={`min-w-0 flex-1 truncate text-[11px] font-bold leading-tight ${
                isPlaceholder ? "italic text-white/35" : "text-white/85"
              }`}
            >
              {displayName}
            </span>
            {showScore && team.score !== null && (
              <span className="ml-auto shrink-0 text-xs font-black tabular-nums text-white/80">
                {team.score}
              </span>
            )}
            {selected && !winner && !locked && (
              <Check className="h-3 w-3 shrink-0 text-cyan-300/80" />
            )}
            {winner && <Trophy className="h-3 w-3 shrink-0 text-emerald-300" />}
            {selected && locked && !winner && (
              <Lock className="h-2.5 w-2.5 shrink-0 text-white/25" />
            )}
          </button>
        )
      })}

      {/* Accessible disabled-reason — screen-reader only so layout stays 88 px. */}
      {!matchIsPickable && !isFinal ? (
        <span
          data-testid={`world-cup-match-disabled-reason-${match.id}`}
          className="sr-only"
        >
          {unpickableMessage}
        </span>
      ) : null}
    </article>
  )
}
