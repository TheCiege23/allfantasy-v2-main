"use client"
import { useEffect, useMemo, useState } from "react"
import { Check, Clock, Lock, Radio, Sparkles, Trophy, X } from "lucide-react"
import type { WorldCupMatchView, WorldCupPickView } from "@/lib/world-cup/types"
import {
  formatWorldCupKickoffShort,
  formatWorldCupMatchStatus,
  getWorldCupPickLiveState,
  isWorldCupMatchFinal,
  isWorldCupMatchLive,
} from "@/lib/world-cup/worldCupMatchStatus"
import {
  getWorldCupUnpickableReason,
  hasWorldCupPickSelection,
  isWorldCupMatchPickable,
} from "@/lib/world-cup/worldCupProjectedBracket"
import {
  estimateWorldCupWinProbability,
  getWorldCupPickRecommendation,
  getWorldCupUpsetRisk,
} from "@/lib/world-cup/worldCupAiInsights"
import WorldCupTeamFlag from "./WorldCupTeamFlag"
import { useOptionalLanguage } from "@/components/i18n/LanguageProviderClient"
import { makeWcT } from "@/lib/world-cup/worldCupI18n"

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

function selectedPickLabel(match: WorldCupMatchView, pick: WorldCupPickView): string {
  const homeSelected =
    pick.selectedTeamId === match.homeTeamId ||
    Boolean(pick.selectedSlotKey && pick.selectedSlotKey === match.homeSlotKey)
  if (homeSelected) {
    return formatWorldCupPlaceholder(match.homeSlotKey, match.homeTeamName, match.homeTeamId)
  }
  return formatWorldCupPlaceholder(match.awaySlotKey, match.awayTeamName, match.awayTeamId)
}

function aiMatchupSideLabel(slotKey: string | null | undefined, teamName: string | null | undefined, teamId: string | null | undefined, fallback: string) {
  const label = formatWorldCupPlaceholder(slotKey, teamName, teamId)
  return label && !/^TBD\b/i.test(label) ? label : fallback
}

function matchupPickVisualState(
  match: WorldCupMatchView,
  pick?: WorldCupPickView
): "none" | "pending" | "correct" | "incorrect" {
  if (!pick || !hasWorldCupPickSelection(pick)) return "none"
  if (!isWorldCupMatchFinal(match)) return "pending"
  if (pick.isCorrect === true) return "correct"
  if (pick.isCorrect === false) return "incorrect"
  return "pending"
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

export default function WorldCupMatchupCard({
  match,
  pick,
  locked,
  lockStrategy,
  tournamentLockAt,
  onPick,
  onOpenMatchupPicker,
  isSaving = false,
  aiInsightsUnlocked = false,
  confidenceScoringEnabled = false,
  compactBoard = false,
  pickInModalOnly = false,
}: {
  match: WorldCupMatchView
  pick?: WorldCupPickView
  locked?: boolean
  /** "per_match" | "tournament_start" */
  lockStrategy?: string
  /** ISO string — used when lockStrategy === "tournament_start" */
  tournamentLockAt?: string | null
  onPick?: (match: WorldCupMatchView, side: "home" | "away", confidencePoints?: number | null) => void
  onOpenMatchupPicker?: (matchId: string) => void
  isSaving?: boolean
  aiInsightsUnlocked?: boolean
  confidenceScoringEnabled?: boolean
  compactBoard?: boolean
  pickInModalOnly?: boolean
}) {
  const { language } = useOptionalLanguage()
  const t = useMemo(() => makeWcT(language), [language])

  const confidenceOptions = useMemo(() => Array.from({ length: 32 }, (_, index) => index + 1), [])
  const [confidenceDraft, setConfidenceDraft] = useState(() => pick?.confidencePoints ?? 1)

  useEffect(() => {
    setConfidenceDraft(pick?.confidencePoints ?? 1)
  }, [pick?.confidencePoints])

  // Hydration-safe gate: locale-formatted dates (toLocaleString) differ between
  // SSR (Node UTC default) and CSR (user locale + tz). Render those strings only
  // after mount so the first CSR pass matches SSR HTML.
  const [hasMounted, setHasMounted] = useState(false)
  useEffect(() => {
    setHasMounted(true)
  }, [])

  const isLive = isWorldCupMatchLive(match)
  const isFinal = isWorldCupMatchFinal(match)
  const pickLiveState = getWorldCupPickLiveState(match, pick)
  const statusLabel = formatWorldCupMatchStatus(match)
  const showScore = isLive || isFinal
  const matchIsPickable = isWorldCupMatchPickable(match)
  const unpickableReason = matchIsPickable ? null : getWorldCupUnpickableReason(match)
  const unpickableMessage =
    unpickableReason === "final"
      ? t("wc.matchup.unpickableFinal")
      : unpickableReason === "missing_home_team" ||
          unpickableReason === "missing_away_team" ||
          unpickableReason === "placeholder_team"
        ? t("wc.matchup.unpickableMissingTeam")
        : t("wc.matchup.unpickableUnknown")

  const teams = [
    { side: "home" as const, slotKey: match.homeSlotKey, teamId: match.homeTeamId, name: match.homeTeamName, logo: match.homeTeamLogo, score: match.homeScore },
    { side: "away" as const, slotKey: match.awaySlotKey, teamId: match.awayTeamId, name: match.awayTeamName, logo: match.awayTeamLogo, score: match.awayScore },
  ]
  const aiHomeLabel = aiMatchupSideLabel(match.homeSlotKey, match.homeTeamName, match.homeTeamId, t("wc.matchup.aiHomeSideFallback"))
  const aiAwayLabel = aiMatchupSideLabel(match.awaySlotKey, match.awayTeamName, match.awayTeamId, t("wc.matchup.aiAwaySideFallback"))
  const freeMatchupSignal = useMemo(() => {
    if (!matchIsPickable) return null
    return {
      probabilities: estimateWorldCupWinProbability(match),
      recommendation: getWorldCupPickRecommendation(match, "balanced"),
      upsetRisk: getWorldCupUpsetRisk(match),
    }
  }, [match, matchIsPickable])

  // Derive human-readable lock hint.
  // Locale-dependent date strings render only after mount to keep SSR HTML
  // identical to the first CSR render (avoids React #425 hydration mismatch).
  let lockHint: string | null = null
  if (!locked) {
    if (lockStrategy === "tournament_start" && tournamentLockAt) {
      lockHint = hasMounted
        ? t("wc.matchup.lockHintTournamentWithTime", { at: formatLockTime(tournamentLockAt) })
        : t("wc.matchup.lockHintTournament")
    } else if (lockStrategy === "per_match" || !lockStrategy) {
      if (match.startsAt) {
        lockHint = hasMounted
          ? t("wc.matchup.lockHintKickoffWithTime", { at: formatLockTime(match.startsAt as string) })
          : t("wc.matchup.lockHintKickoff")
      } else {
        lockHint = t("wc.matchup.lockHintKickoff")
      }
    }
  }

  const isScheduled = match.status === "scheduled"
  const isPostponed = match.status === "postponed"
  const isCancelled = match.status === "cancelled"
  const isSimulated = match.apiStatusShort === "SIM"
  const isTestFixture = match.apiStatusShort === "TEST"
  const pickVisual = matchupPickVisualState(match, pick)
  const openMatchupPicker = () => onOpenMatchupPicker?.(match.id)

  // Pick live state color helpers
  const pickStateBorderClass =
    pickLiveState === "correct" ? "border-cyan-300/80 shadow-[0_0_0_1px_rgba(103,232,249,0.28)]"
    : pickLiveState === "incorrect" ? "border-rose-400/70 shadow-[0_0_0_1px_rgba(251,113,133,0.2)]"
    : pickLiveState === "winning" ? "border-cyan-300/50"
    : pickLiveState === "losing" ? "border-rose-400/30"
    : "border-white/10"

  return (
    <article
      data-testid={`world-cup-match-${match.id}`}
      className={[
        compactBoard
          ? "w-full min-w-0 rounded-lg border bg-zinc-950/78 p-2 shadow-lg shadow-black/25 transition"
          : "w-[min(20rem,calc(100vw-2.5rem))] shrink-0 rounded-lg border bg-zinc-950/80 p-3 shadow-2xl shadow-black/30 transition sm:w-72",
        pickStateBorderClass,
      ].join(" ")}
    >
      {/* Header row — clicking opens guided picker */}
      <div
        className={`mb-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 ${onOpenMatchupPicker ? "cursor-pointer rounded hover:bg-white/[0.04] -mx-1 px-1 py-0.5 transition touch-manipulation" : ""}`}
        onClick={onOpenMatchupPicker ? () => onOpenMatchupPicker(match.id) : undefined}
        role={onOpenMatchupPicker ? "button" : undefined}
        tabIndex={onOpenMatchupPicker ? 0 : undefined}
        onKeyDown={onOpenMatchupPicker ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenMatchupPicker(match.id) } } : undefined}
        aria-label={onOpenMatchupPicker ? t("wc.matchup.openGuidedAria", { number: match.matchNumber }) : undefined}
      >
        <span className="text-[11px] font-black uppercase tracking-[0.18em] text-white/35">
          {t("wc.matchup.matchLabel", { number: match.matchNumber })}
        </span>
        <div className="flex items-center gap-1">
          {/* Live / HT status pill */}
          {isLive && (
            <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/25 bg-rose-500/15 px-2 py-0.5 text-[11px] font-black text-rose-300">
              <Radio className="h-2.5 w-2.5 animate-pulse" />
              LIVE
              {match.elapsedMinute != null && (
                <span className="font-bold tabular-nums text-white/65">
                  {match.elapsedMinute}{match.injuryTime ? `+${match.injuryTime}` : ""}′
                </span>
              )}
              {match.apiStatusShort?.toUpperCase() === "HT" && (
                <span className="font-bold text-white/65">· HT</span>
              )}
              {match.apiStatusShort?.toUpperCase() === "PEN" && (
                <span className="font-bold text-white/65">· PEN</span>
              )}
            </span>
          )}
          {isFinal && (
            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-bold text-white/85">
              {t("wc.matchup.statusFinal")}
            </span>
          )}
          {isPostponed && (
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-bold text-white/80">
              {t("wc.matchup.statusPostponed")}
            </span>
          )}
          {isCancelled && (
            <span className="rounded-full bg-zinc-500/15 px-2 py-0.5 text-[11px] font-bold text-zinc-400">
              {t("wc.matchup.statusCancelled")}
            </span>
          )}
          {isSimulated && (
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-bold text-white/80">
              {t("wc.matchup.statusSimulated")}
            </span>
          )}
          {isTestFixture && (
            <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[11px] font-bold text-white/80">
              {t("wc.matchup.statusTestFixture")}
            </span>
          )}
          {!matchIsPickable && !isFinal && (
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-bold text-white/80" title={unpickableReason ?? "unknown"}>
              {t("wc.matchup.notReadyPill")}
            </span>
          )}
          {isSaving ? (
            <span className="rounded-full bg-cyan-300/15 px-2 py-0.5 text-[11px] font-bold text-white/90">
              {t("wc.matchup.statusSaving")}
            </span>
          ) : null}
          {/* Pick result badges */}
          {pickLiveState === "correct" && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-400/15 px-1.5 py-0.5 text-[11px] font-bold text-white/85">
              <Check className="h-2.5 w-2.5" /> {t("wc.matchup.pickBadgeCorrect")}
            </span>
          )}
          {pickLiveState === "incorrect" && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-rose-400/15 px-1.5 py-0.5 text-[11px] font-bold text-white/80">
              <X className="h-2.5 w-2.5" /> {t("wc.matchup.pickBadgeIncorrect")}
            </span>
          )}
          {locked && !isLive && !isFinal ? (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-white/5 px-1.5 py-0.5 text-[11px] font-bold text-white/35">
              <Lock className="h-3 w-3" />
            </span>
          ) : null}
        </div>
      </div>

      {/* Pick + points summary */}
      {pick && hasWorldCupPickSelection(pick) && (
        <div
          data-testid={`wc-match-pick-summary-${match.id}`}
          className="mb-2 rounded-lg border border-cyan-400/15 bg-cyan-500/[0.06] px-2 py-1.5"
        >
          <div className="flex flex-wrap items-center justify-between gap-1 text-[11px]">
            <span className="text-white/50">
              {t("wc.matchup.yourPick")}{" "}
              {/* Team name (selectedPickLabel) intentionally NOT translated — Phase 5 brief. */}
              <span className="font-bold text-white">{selectedPickLabel(match, pick)}</span>
            </span>
            <span
              data-testid={`wc-match-earned-points-${match.id}`}
              className="font-black tabular-nums text-white/85"
            >
              {pick.pointsAwarded > 0
                ? t("wc.matchup.pointsPositive", { points: pick.pointsAwarded })
                : isFinal && pick.isCorrect === false
                  ? t("wc.matchup.zeroPts")
                  : !isFinal
                    ? t("wc.matchup.pending")
                    : "—"}
            </span>
          </div>
          {!compactBoard ? (
            <div
              data-testid="wc-match-pick-visual"
              data-state={pickVisual}
              className="mt-1 flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide"
            >
              {pickVisual === "correct" && (
                <span className="text-white/90">{t("wc.matchup.pickVisualCorrect")}</span>
              )}
              {pickVisual === "incorrect" && (
                <span className="text-white/70">{t("wc.matchup.pickVisualIncorrect")}</span>
              )}
              {pickVisual === "pending" && (
                <span className="text-white/65">{t("wc.matchup.pickVisualPending")}</span>
              )}
            </div>
          ) : null}
        </div>
      )}

      {isFinal && (match.winnerTeamName || match.winnerTeamId) && (
        <div
          data-testid={`wc-match-official-winner-${match.id}`}
          className="mb-2 text-center text-[11px] font-bold text-white/85"
        >
          {/* Team name (match.winnerTeamName) intentionally NOT translated — Phase 5 brief. */}
          {t("wc.matchup.winnerOfficial", { name: match.winnerTeamName ?? "—" })}
        </div>
      )}

      {!matchIsPickable && !isFinal ? (
        <p
          data-testid={`world-cup-match-disabled-reason-${match.id}`}
          className="mb-2 rounded-lg border border-amber-300/20 bg-amber-500/10 px-2 py-1.5 text-[11px] font-bold text-white/85"
        >
          {unpickableMessage}
        </p>
      ) : null}

      {confidenceScoringEnabled && matchIsPickable && !locked && !compactBoard ? (
        <label
          data-testid={`wc-match-confidence-selector-${match.id}`}
          className="mb-2 block rounded-lg border border-cyan-300/15 bg-cyan-300/[0.055] px-2 py-2 text-[11px] leading-4 text-white/75"
        >
          <span className="block font-black text-white">{t("wc.matchup.confidenceTitle")}</span>
          <span className="mt-1 block text-white/55">
            {t("wc.matchup.confidenceHint")}
          </span>
          <select
            value={confidenceDraft}
            onChange={(e) => setConfidenceDraft(Number(e.target.value))}
            className="mt-2 min-h-10 w-full rounded-md border border-white/10 bg-black/40 px-2 text-xs font-black text-white"
          >
            {confidenceOptions.map((value) => (
              <option key={value} value={value}>
                {t(
                  value === 1
                    ? "wc.matchup.confidencePointSingle"
                    : "wc.matchup.confidencePointPlural",
                  { value }
                )}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {compactBoard ? null : (
      <details
        data-testid={`world-cup-match-ai-insight-${match.id}`}
        className="mb-2 rounded-lg border border-cyan-300/20 bg-cyan-300/[0.055] px-2 py-2 text-[11px] text-white/90"
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 font-black">
          <span className="inline-flex items-center gap-1">
            <Sparkles className="h-3 w-3" />
            {t("wc.matchup.aiInsightsLabel")}
          </span>
          <span className="rounded-full border border-cyan-200/25 px-1.5 py-0.5 uppercase tracking-wide">
            {aiInsightsUnlocked ? t("wc.matchup.aiTierOpen") : t("wc.matchup.aiTierLocked")}
          </span>
        </summary>
        <div className="mt-2 space-y-1.5 leading-4 text-white/75">
          {freeMatchupSignal ? (
            <div
              data-testid={`world-cup-match-free-insight-${match.id}`}
              className="space-y-1.5 rounded-md border border-white/10 bg-black/20 px-2 py-1.5"
            >
              <p>
                <span className="font-black text-white">{t("wc.matchup.freeSignalTitle")}</span>{" "}
                <span>{t("wc.matchup.freeRecommendedBody", { name: freeMatchupSignal.recommendation.recommendedTeamName })}</span>
              </p>
              <p>
                <span className="font-black text-white">{t("wc.matchup.freeChanceLabel")}</span>{" "}
                <span>
                  {t("wc.matchup.freeChanceBody", {
                    home: aiHomeLabel,
                    homePct: formatPercent(freeMatchupSignal.probabilities.homeWinProbability),
                    away: aiAwayLabel,
                    awayPct: formatPercent(freeMatchupSignal.probabilities.awayWinProbability),
                  })}
                </span>
              </p>
              <p>
                <span className="font-black text-white">{t("wc.matchup.freeUpsetLabel")}</span>{" "}
                {t(`wc.matchup.upsetRisk.${freeMatchupSignal.upsetRisk}`)}
              </p>
              <p className="text-white/55">{freeMatchupSignal.recommendation.explanation}</p>
            </div>
          ) : (
            <p className="rounded-md border border-white/10 bg-black/20 px-2 py-1.5 text-white/60">
              {t("wc.matchup.freeMissingTeams")}
            </p>
          )}
          <p className="rounded-md border border-white/10 bg-black/20 px-2 py-1 text-white/55">
            <span className="font-black text-white">{t("wc.matchup.scoreboardLabel")}</span>{" "}
            {showScore
              ? `${match.homeScore ?? 0}-${match.awayScore ?? 0} · ${statusLabel}`
              : statusLabel || t("wc.matchup.scoreboardAwaiting")}
          </p>
          {aiInsightsUnlocked ? (
            <>
              <p><span className="font-black text-white">{t("wc.matchup.aiSaferPick")}</span> {t("wc.matchup.aiSaferBody", { name: aiHomeLabel })}</p>
              <p><span className="font-black text-white">{t("wc.matchup.aiUpsidePick")}</span> {t("wc.matchup.aiUpsideBody", { name: aiAwayLabel })}</p>
              <p><span className="font-black text-white">{t("wc.matchup.aiBracketImpact")}</span> {t("wc.matchup.aiBracketImpactBody")}</p>
              <p><span className="font-black text-white">{t("wc.matchup.aiUpsetRisk")}</span> {t("wc.matchup.aiUpsetRiskBody")}</p>
              <p className="rounded-md border border-white/10 bg-black/20 px-2 py-1 text-white/55">
                {t("wc.matchup.aiPrivacyNote")}
              </p>
            </>
          ) : (
            <p className="rounded-md border border-amber-200/20 bg-amber-300/[0.08] px-2 py-1.5 text-amber-50">
              {t("wc.matchup.aiLockedBody")}
            </p>
          )}
        </div>
      </details>
      )}

      {/* Score row — shown during / after match */}
      {showScore && (
        <div
          className="mb-2 flex flex-col items-center gap-0.5 text-center"
          {...(isLive ? { "aria-live": "polite" as const } : {})}
        >
          {/* Minute (live) or FT badge (final) centered above score */}
          {isLive && match.elapsedMinute != null && (
            <span className="text-[11px] font-black tabular-nums text-rose-400">
              {match.elapsedMinute}{match.injuryTime ? `+${match.injuryTime}` : ""}′
            </span>
          )}
          {isLive && match.apiStatusShort?.toUpperCase() === "HT" && (
            <span className="text-[11px] font-black text-white/55">HT</span>
          )}
          {isLive && match.apiStatusShort?.toUpperCase() === "PEN" && (
            <span className="text-[11px] font-black text-amber-300/80">PEN</span>
          )}
          <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
            {isFinal && (
              <span className="rounded-md bg-emerald-500/25 px-2 py-0.5 text-[11px] font-black uppercase tracking-wide text-white/90">
                {t("wc.matchup.ftBadge")}
              </span>
            )}
            <span className="text-lg font-black tabular-nums text-white sm:text-xl">{match.homeScore ?? 0}</span>
            <span className="text-xs text-white/35">–</span>
            <span className="text-lg font-black tabular-nums text-white sm:text-xl">{match.awayScore ?? 0}</span>
            {(match.homePenaltyScore !== null || match.awayPenaltyScore !== null) && (
              <span className="w-full text-[11px] text-white/40 sm:w-auto">
                ({match.homePenaltyScore ?? 0}–{match.awayPenaltyScore ?? 0} {t("wc.matchup.pensAbbr")})
              </span>
            )}
          </div>
        </div>
      )}

      {/* Kickoff date — only before match. Gated on hasMounted because toLocaleString output
          differs between Node SSR (UTC default) and the browser (user locale + timezone). */}
      {hasMounted && isScheduled && match.startsAt && !compactBoard && (
        <div className="mb-2 text-center text-[11px] text-white/40" data-testid={`wc-match-kickoff-${match.id}`}>
          {formatWorldCupKickoffShort(match.startsAt)}
        </div>
      )}

      {/* Venue — small hint line */}
      {match.venueName && isScheduled && !compactBoard && (
        <div className="mb-2 truncate text-center text-[11px] text-white/25">
          {match.venueName}{match.venueCity ? `, ${match.venueCity}` : ""}
        </div>
      )}

      {/* Team buttons */}
      <div className={compactBoard ? "space-y-1" : "space-y-2"}>
        {/* Iterator renamed from `t` to `team` to avoid shadowing the
            outer translator function `t`. */}
        {teams.map((team) => {
          const displayName = formatWorldCupPlaceholder(team.slotKey, team.name, team.teamId)
          const selected =
            pick?.selectedSlotKey === team.slotKey ||
            Boolean(pick?.selectedTeamId && team.teamId && pick.selectedTeamId === team.teamId)
          const winner =
            isFinal &&
            (match.winnerTeamName === team.name || Boolean(match.winnerTeamId && team.teamId === match.winnerTeamId))
          const isPlaceholder = !team.name || team.name.toLowerCase().startsWith("tbd") || !team.teamId

          // Live state color for individual team row
          const teamIsLeading = isLive && team.score !== null && (
            team.side === "home"
              ? (match.homeScore ?? 0) > (match.awayScore ?? 0)
              : (match.awayScore ?? 0) > (match.homeScore ?? 0)
          )

          const disabledReason = locked
            ? t("wc.matchup.disabledLocked")
            : isSaving
              ? t("wc.matchup.disabledSaving")
              : !matchIsPickable
                ? unpickableMessage
                : undefined
          const teamButtonDisabled = pickInModalOnly
            ? isSaving || !onOpenMatchupPicker
            : locked || isSaving || !matchIsPickable
          // Team name (displayName) intentionally NOT translated — Phase 5 brief.
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
              disabled={teamButtonDisabled}
              onClick={() => {
                if (pickInModalOnly && onOpenMatchupPicker) {
                  onOpenMatchupPicker(match.id)
                  return
                }
                return locked || isSaving || !matchIsPickable ? undefined : onPick?.(match, team.side, confidenceScoringEnabled ? confidenceDraft : null)
              }}
              title={pickInModalOnly ? t("wc.matchup.openGuidedAria", { number: match.matchNumber }) : disabledReason}
              className={[
                compactBoard
                  ? "flex min-h-[2.3rem] w-full touch-manipulation items-center gap-1.5 rounded-md border px-2 py-0.5 text-left transition"
                  : "flex min-h-[3.5rem] w-full touch-manipulation items-center gap-2 rounded-md border px-2 py-1 text-left transition sm:h-14 sm:py-0",
                winner ? "border-emerald-400/80 bg-emerald-400/[0.14] shadow-[0_0_0_1px_rgba(52,211,153,0.15)]"
                : isFinal && !winner ? "border-white/[0.06] bg-white/[0.02] opacity-45"
                : selected && isLive && pickLiveState === "winning" ? "border-cyan-300/60 bg-cyan-300/[0.08]"
                : selected && isLive && pickLiveState === "losing" ? "border-rose-400/30 bg-rose-400/[0.06]"
                : selected ? "border-cyan-300/70 bg-cyan-300/10"
                : teamIsLeading ? "border-white/20 bg-white/[0.06]"
                : "border-white/10 bg-white/[0.03]",
                teamButtonDisabled ? "cursor-not-allowed" : !isFinal ? "hover:bg-white/[0.06]" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <WorldCupTeamFlag flagUrl={team.logo} teamName={displayName} size="sm" />
              <span className="min-w-0 flex-1 overflow-hidden">
                <span className={`block truncate font-bold leading-tight ${compactBoard ? "text-[11px]" : "text-sm"} ${isPlaceholder ? "italic text-white/40" : winner ? "text-emerald-200 font-black" : isFinal ? "text-white/50" : "text-white"}`}>
                  {displayName}
                </span>
                <span className="block truncate text-[11px] text-white/30">{team.slotKey}</span>
                {hasMounted && isScheduled && match.startsAt && !compactBoard && (
                  <span className="mt-0.5 block text-[11px] text-white/35" data-testid={`wc-row-kickoff-${match.id}-${team.side}`}>
                    {formatWorldCupKickoffShort(match.startsAt)}
                  </span>
                )}
              </span>
              <span className="flex shrink-0 flex-col items-end gap-0.5 text-right">
                {/* testid preserved for test compat; minute now lives in header pill + score row */}
                <span
                  data-testid={`wc-row-live-status-${match.id}-${team.side}`}
                  className="sr-only"
                  aria-hidden="true"
                />
                {showScore && team.score != null && (
                  <span className={`text-sm font-black tabular-nums ${teamIsLeading ? "text-white" : "text-white/70"}`}>{team.score}</span>
                )}
              </span>
              {selected && !locked && matchIsPickable && !winner && !isFinal && <Check className="h-4 w-4 shrink-0 text-white/75" />}
              {selected && locked && !winner && <Lock className="h-3.5 w-3.5 shrink-0 text-white/25" />}
              {winner && (
                <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-black uppercase text-white/85">
                  <Trophy className="h-4 w-4" />
                  {t("wc.matchup.winnerLabel")}
                </span>
              )}
              {selected && isFinal && !winner && <X className="h-3.5 w-3.5 shrink-0 text-white/30" />}
            </button>
          )
        })}
      </div>

      {/* Lock hint / venue footer */}
      {lockHint && isScheduled && !compactBoard && (
        <div className="mt-2 flex items-center gap-1 text-[11px] text-white/30">
          <Clock className="h-3 w-3" />
          {lockHint}
        </div>
      )}
    </article>
  )
}
