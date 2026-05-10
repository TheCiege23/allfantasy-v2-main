"use client"
import Image from "next/image"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Lock,
  Radio,
  Sparkles,
  Trophy,
  X,
} from "lucide-react"
import { WORLD_CUP_ROUND_LABELS } from "@/lib/world-cup/types"
import type {
  WorldCupAiMatchupPreview,
  WorldCupAiStrategy,
  WorldCupMatchView,
  WorldCupPickView,
  WorldCupRound,
} from "@/lib/world-cup/types"
import {
  formatWorldCupKickoffShort,
  formatWorldCupMatchStatus,
  getWorldCupMatchDisplayScore,
  getWorldCupPickLiveState,
  isWorldCupMatchFinal,
  isWorldCupMatchLive,
} from "@/lib/world-cup/worldCupMatchStatus"
import {
  buildWorldCupProjectedMatches,
  countRemainingPicks,
  findFirstUnpickedMatch,
  findNextMatchInGuidedOrder,
  getWorldCupUnpickableReason,
  getInvalidDownstreamPickIds,
  hasWorldCupPickSelection,
  getOrderedRounds,
  isBracketComplete,
  isWorldCupMatchPickable,
} from "@/lib/world-cup/worldCupProjectedBracket"
import { getWorldCupAiMatchupPreview } from "@/lib/world-cup/worldCupClientApi"

// ── Types ─────────────────────────────────────────────────────────────────────

export type GuidedPickPayload = {
  matchId: string
  selectedTeamId: string | null
  selectedSlotKey: string | null
  selectedSide: "home" | "away"
}

type SaveState = "idle" | "saving" | "saved" | "error"

// ── Small helpers ─────────────────────────────────────────────────────────────

function TeamLogo({ src, name }: { src?: string | null; name: string }) {
  if (src) {
    return (
      <Image
        src={src}
        alt=""
        width={56}
        height={56}
        className="h-14 w-14 rounded-full bg-white object-contain p-0.5"
      />
    )
  }
  return (
    <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/10 text-lg font-black text-white/60">
      {name.slice(0, 2).toUpperCase()}
    </span>
  )
}

function formatMatchDate(iso: string | null): string {
  if (!iso) return "Time TBD"
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    })
  } catch {
    return "Time TBD"
  }
}

function formatScore(home: number | null, away: number | null): string {
  if (home === null || away === null) return ""
  return `${home} – ${away}`
}

// ── Team selection card ───────────────────────────────────────────────────────

function TeamCard({
  teamId,
  teamName,
  teamLogo,
  score,
  penaltyScore,
  isWinner,
  isPicked,
  isSaving,
  isLocked,
  matchStatus,
  pickState,
  onPick,
}: {
  teamId: string | null
  teamName: string
  teamLogo: string | null
  score: number | null
  penaltyScore: number | null
  isWinner: boolean
  isPicked: boolean
  isSaving: boolean
  isLocked: boolean
  matchStatus: string
  pickState?: "not_started" | "winning" | "drawing" | "losing" | "correct" | "incorrect" | "unknown"
  onPick: () => void
}) {
  const showScore = matchStatus === "live" || matchStatus === "halftime" || matchStatus === "final"
  const tbd = !teamId && teamName === "TBD"

  return (
    <button
      type="button"
      onClick={onPick}
      disabled={isLocked || isSaving || tbd || !teamId}
      className={[
        "relative flex w-full flex-col items-center gap-3 rounded-2xl border-2 px-6 py-8 text-center transition-all active:scale-[0.98]",
        "disabled:cursor-not-allowed",
        pickState === "correct"
          ? "border-emerald-400 bg-emerald-400/[0.10] shadow-[0_0_32px_rgba(52,211,153,0.15)]"
          : pickState === "incorrect"
          ? "border-rose-400/40 bg-rose-400/[0.06] opacity-70"
          : pickState === "winning"
          ? "border-cyan-300 bg-cyan-300/[0.12] shadow-[0_0_32px_rgba(103,232,249,0.15)]"
          : pickState === "losing"
          ? "border-rose-400/30 bg-rose-400/[0.05]"
          : pickState === "drawing"
          ? "border-amber-300/40 bg-amber-300/[0.06]"
          : isPicked
          ? "border-cyan-300 bg-cyan-300/[0.12] shadow-[0_0_32px_rgba(103,232,249,0.15)]"
          : isWinner
          ? "border-emerald-400 bg-emerald-400/[0.08]"
          : tbd
          ? "border-white/5 bg-white/[0.02] opacity-50"
          : isLocked
          ? "border-white/10 bg-white/[0.04] opacity-70"
          : "border-white/15 bg-white/[0.05] hover:border-white/30 hover:bg-white/[0.09]",
      ].join(" ")}
    >
      {pickState === "correct" && (
        <span className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-emerald-400">
          <Check className="h-3.5 w-3.5 text-black" />
        </span>
      )}
      {pickState === "incorrect" && (
        <span className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-rose-400">
          <X className="h-3.5 w-3.5 text-black" />
        </span>
      )}
      {isPicked && !pickState?.startsWith("correct") && !pickState?.startsWith("incorrect") && (
        <span className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-cyan-300">
          <Check className="h-3.5 w-3.5 text-black" />
        </span>
      )}
      {isWinner && !isPicked && pickState !== "correct" && (
        <span className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-emerald-400">
          <Trophy className="h-3.5 w-3.5 text-black" />
        </span>
      )}

      <TeamLogo src={teamLogo} name={teamName} />
      <span className="hyphens-auto break-words text-xl font-black text-white">{teamName}</span>
      {showScore && (
        <span className="text-2xl font-black tabular-nums text-white/80">
          {score ?? 0}
          {penaltyScore !== null ? (
            <span className="ml-1 text-sm font-normal text-white/40">
              ({penaltyScore})
            </span>
          ) : null}
        </span>
      )}
      {tbd && (
        <span className="text-xs text-white/30">Awaiting result</span>
      )}
    </button>
  )
}

// ── Match status badge ────────────────────────────────────────────────────────

function MatchStatusBadge({ match }: { match: WorldCupMatchView }) {
  const label = formatWorldCupMatchStatus(match)
  const isLive = isWorldCupMatchLive(match)
  const isFinal = isWorldCupMatchFinal(match)
  if (isLive)
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/20 px-3 py-1 text-xs font-bold text-rose-200">
        <Radio className="h-3 w-3" /> {label}
      </span>
    )
  if (isFinal)
    return (
      <span className="rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-bold text-emerald-200">
        Final
      </span>
    )
  if (match.status === "postponed")
    return (
      <span className="rounded-full bg-amber-400/15 px-3 py-1 text-xs font-bold text-amber-300">
        Postponed
      </span>
    )
  return null
}

// ── Progress bar ──────────────────────────────────────────────────────────────

function ProgressBar({
  done,
  total,
  round,
  roundDone,
  roundTotal,
}: {
  done: number
  total: number
  round: WorldCupRound
  roundDone: number
  roundTotal: number
}) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px] text-white/40">
        <span>
          {WORLD_CUP_ROUND_LABELS[round]} · {roundDone}/{roundTotal} picks
        </span>
        <span>{pct}% overall</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-cyan-300 transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

// ── Complete state ────────────────────────────────────────────────────────────

function BracketCompleteView({
  champion,
  onClose,
  onReview,
}: {
  champion: WorldCupPickView | null
  onClose: () => void
  onReview: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-6 px-6 py-12 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-amber-300/20">
        <Trophy className="h-10 w-10 text-amber-300" />
      </div>
      <div>
        <h2 className="text-2xl font-black text-white">Bracket Complete!</h2>
        <p className="mt-2 text-sm text-white/50">
          You've picked every match.
        </p>
        {champion?.selectedTeamName && (
          <p className="mt-3 text-lg font-black text-amber-200">
            🏆 {champion.selectedTeamName}
          </p>
        )}
      </div>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={onReview}
          className="rounded-xl border border-white/15 bg-white/[0.06] px-5 py-2.5 text-sm font-bold text-white"
        >
          Review Bracket
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl bg-cyan-300 px-5 py-2.5 text-sm font-black text-black"
        >
          Done
        </button>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

// ── AI Preview Panel ──────────────────────────────────────────────────────────

const STRATEGY_OPTIONS: { value: WorldCupAiStrategy; label: string; emoji: string }[] = [
  { value: "safe", label: "Safe", emoji: "🛡️" },
  { value: "balanced", label: "Balanced", emoji: "⚖️" },
  { value: "upset", label: "Upset", emoji: "💥" },
  { value: "chaos", label: "Chaos", emoji: "🌪️" },
]

function AiPreviewPanel({
  challengeId,
  entryId,
  matchId,
  homeName,
  awayName,
  onUsePick,
  disabled,
}: {
  challengeId: string
  entryId: string
  matchId: string
  homeName: string
  awayName: string
  onUsePick: (side: "home" | "away") => void
  disabled: boolean
}) {
  const [strategy, setStrategy] = useState<WorldCupAiStrategy>("balanced")
  const [preview, setPreview] = useState<WorldCupAiMatchupPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setPreview(null)
    setError(null)
    setLoading(true)
    getWorldCupAiMatchupPreview(challengeId, { matchId, entryId, strategy })
      .then((p) => { if (!cancelled) { setPreview(p); setLoading(false) } })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load AI preview")
          setLoading(false)
        }
      })
    return () => { cancelled = true }
  }, [challengeId, entryId, matchId, strategy])

  return (
    <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3 space-y-3">
      {/* Header */}
      <div className="flex items-center gap-1.5">
        <Sparkles className="h-3.5 w-3.5 text-cyan-300" />
        <span className="text-[11px] font-bold text-cyan-300 uppercase tracking-wide">AI Matchup Preview</span>
      </div>

      {/* Strategy selector */}
      <div className="flex gap-1.5 flex-wrap">
        {STRATEGY_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setStrategy(opt.value)}
            className={`rounded-lg px-2.5 py-1 text-[11px] font-bold transition-colors ${
              strategy === opt.value
                ? "bg-cyan-300 text-black"
                : "bg-white/[0.06] text-white/60 hover:bg-white/10"
            }`}
          >
            {opt.emoji} {opt.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading && (
        <div className="space-y-2 animate-pulse">
          <div className="h-2.5 w-3/4 rounded bg-white/10" />
          <div className="h-2.5 w-1/2 rounded bg-white/10" />
          <div className="h-2.5 w-5/6 rounded bg-white/10" />
        </div>
      )}

      {!loading && error && (
        <p className="text-[11px] text-red-400">{error}</p>
      )}

      {!loading && preview && (
        <div className="space-y-2">
          {/* Win probability bars */}
          <div className="space-y-1.5">
            <ProbBar label={homeName} pct={Math.round(preview.homeWinProbability * 100)} side="home" />
            <ProbBar label={awayName} pct={Math.round(preview.awayWinProbability * 100)} side="away" />
          </div>

          {/* Badges */}
          <div className="flex gap-1.5 flex-wrap">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${upsetBadgeClass(preview.upsetRisk)}`}>
              Upset {preview.upsetRisk}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${confidenceBadgeClass(preview.confidence)}`}>
              Confidence: {preview.confidence}
            </span>
            {preview.generative && (
              <span className="rounded-full bg-violet-500/20 px-2 py-0.5 text-[10px] font-bold text-violet-300">
                AI
              </span>
            )}
          </div>

          {/* Key factors */}
          {preview.keyFactors.length > 0 && (
            <ul className="space-y-0.5">
              {preview.keyFactors.slice(0, 3).map((f) => (
                <li key={f} className="text-[10px] text-white/40 before:content-['·_']">{f}</li>
              ))}
            </ul>
          )}

          {/* Summary */}
          <p className="text-[11px] text-white/70 leading-relaxed">{preview.summary}</p>

          {/* Safe / Contrarian */}
          <div className="grid grid-cols-2 gap-1.5 text-[10px]">
            <div className="rounded-lg bg-white/[0.05] px-2 py-1.5">
              <span className="block text-white/40 font-semibold uppercase text-[9px]">Safe Pick</span>
              <span className="text-white/80 font-bold">{preview.safePick}</span>
            </div>
            <div className="rounded-lg bg-white/[0.05] px-2 py-1.5">
              <span className="block text-white/40 font-semibold uppercase text-[9px]">Contrarian</span>
              <span className="text-white/80 font-bold">{preview.contrarianPick}</span>
            </div>
          </div>

          {/* Use AI Pick button */}
          {!disabled && preview.recommendedSide && (
            <button
              type="button"
              onClick={() => onUsePick(preview.recommendedSide!)}
              className="w-full rounded-xl bg-cyan-300/90 py-2 text-xs font-black text-black hover:bg-cyan-300 transition-colors"
            >
              Use AI Pick · {preview.recommendedTeamName}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function ProbBar({ label, pct, side }: { label: string; pct: number; side: "home" | "away" }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 truncate text-[10px] text-white/50 text-right">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${side === "home" ? "bg-cyan-400" : "bg-violet-400"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-8 text-[10px] text-white/50">{pct}%</span>
    </div>
  )
}

function upsetBadgeClass(risk: "low" | "medium" | "high") {
  if (risk === "high") return "bg-red-500/20 text-red-300"
  if (risk === "medium") return "bg-amber-500/20 text-amber-300"
  return "bg-green-500/20 text-green-300"
}

function confidenceBadgeClass(confidence: "low" | "medium" | "high") {
  if (confidence === "high") return "bg-cyan-500/20 text-cyan-300"
  if (confidence === "medium") return "bg-white/10 text-white/60"
  return "bg-white/5 text-white/40"
}


export default function WorldCupGuidedMatchupPicker({
  challengeId,
  entryId,
  entryName,
  matches,
  picks: initialPicks,
  isOpen,
  initialMatchId,
  isLocked,
  includeThirdPlace = false,
  onClose,
  onSavePick,
  onPicksUpdated,
}: {
  challengeId: string
  entryId: string
  entryName: string
  matches: WorldCupMatchView[]
  picks: WorldCupPickView[]
  isOpen: boolean
  initialMatchId?: string | null
  isLocked: boolean
  includeThirdPlace?: boolean
  onClose: () => void
  /** Called to persist a pick. Should throw on failure. */
  onSavePick: (
    payload: GuidedPickPayload,
    currentPicks: WorldCupPickView[],
    options?: { suppressToast?: boolean }
  ) => Promise<WorldCupPickView[]>
  /** Called after picks are successfully updated — lets the shell refresh its state. */
  onPicksUpdated?: (picks: WorldCupPickView[]) => void
}) {
  // Local picks mirror — updated on successful saves
  const [picks, setPicks] = useState<WorldCupPickView[]>(initialPicks)
  const [saveState, setSaveState] = useState<SaveState>("idle")
  const [saveError, setSaveError] = useState<string | null>(null)
  const [showComplete, setShowComplete] = useState(false)

  // Sync external picks changes into local state
  useEffect(() => {
    setPicks(initialPicks)
  }, [initialPicks])

  const orderedRounds = useMemo(
    () => getOrderedRounds(matches.filter(isWorldCupMatchPickable), includeThirdPlace),
    [matches, includeThirdPlace]
  )

  // Projected matches (teams filled forward from picks)
  const projected = useMemo(
    () => buildWorldCupProjectedMatches(matches, picks),
    [matches, picks]
  )
  const pickableProjected = useMemo(
    () => projected.filter(isWorldCupMatchPickable),
    [projected]
  )
  const unpickableDebug = useMemo(
    () =>
      matches
        .filter((m) => !isWorldCupMatchPickable(m))
        .slice(0, 5)
        .map((m) => ({ matchNumber: m.matchNumber, reason: getWorldCupUnpickableReason(m) })),
    [matches]
  )
  const hasPickableMatchups = useMemo(
    () => pickableProjected.length > 0,
    [pickableProjected]
  )

  // Determine the current match to display
  const [currentMatchId, setCurrentMatchId] = useState<string | null>(() => {
    if (initialMatchId) return initialMatchId
    const unpicked = findFirstUnpickedMatch(
      buildWorldCupProjectedMatches(matches, initialPicks).filter(isWorldCupMatchPickable),
      initialPicks,
      getOrderedRounds(matches.filter(isWorldCupMatchPickable), includeThirdPlace)
    )
    return unpicked?.id ?? null
  })

  // When opener changes initialMatchId (e.g. user clicked a specific match on the board)
  useEffect(() => {
    if (!isOpen) return
    if (initialMatchId) {
      const requested = projected.find((m) => m.id === initialMatchId)
      setCurrentMatchId(requested && isWorldCupMatchPickable(requested) ? initialMatchId : null)
      setShowComplete(false)
      return
    }
    const unpicked = findFirstUnpickedMatch(pickableProjected, picks, orderedRounds)
    if (unpicked) {
      setCurrentMatchId(unpicked.id)
      setShowComplete(false)
    } else {
      setCurrentMatchId(null)
      setShowComplete(isBracketComplete(projected, picks, includeThirdPlace))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialMatchId, projected, pickableProjected, picks, orderedRounds, includeThirdPlace])

  // Detect completion
  useEffect(() => {
    if (isBracketComplete(projected, picks, includeThirdPlace)) {
      setShowComplete(true)
    }
  }, [projected, picks, includeThirdPlace])

  const currentMatch = useMemo(
    () => projected.find((m) => m.id === currentMatchId) ?? null,
    [projected, currentMatchId]
  )

  // Stats for header
  const totalRequired = useMemo(
    () =>
      pickableProjected.filter((m) => m.round !== "third_place" || includeThirdPlace)
        .length,
    [pickableProjected, includeThirdPlace]
  )
  const totalPicked = useMemo(
    () => picks.filter(hasWorldCupPickSelection).length,
    [picks]
  )
  const roundMatches = useMemo(
    () =>
      currentMatch
        ? pickableProjected.filter((m) => m.round === currentMatch.round)
        : [],
    [pickableProjected, currentMatch]
  )
  const roundPickedCount = useMemo(
    () =>
      roundMatches.filter((m) =>
        picks.some((p) => p.matchId === m.id && hasWorldCupPickSelection(p))
      ).length,
    [roundMatches, picks]
  )

  // Navigation
  const canGoBack = useMemo(() => {
    if (!currentMatch) return false
    const sameRound = pickableProjected
      .filter((m) => m.round === currentMatch.round)
      .sort((a, b) => a.matchNumber - b.matchNumber)
    const idx = sameRound.findIndex((m) => m.id === currentMatch.id)
    if (idx > 0) return true
    const roundIdx = orderedRounds.indexOf(currentMatch.round)
    return roundIdx > 0
  }, [currentMatch, pickableProjected, orderedRounds])

  function goBack() {
    if (!currentMatch) return
    const sameRound = pickableProjected
      .filter((m) => m.round === currentMatch.round)
      .sort((a, b) => a.matchNumber - b.matchNumber)
    const idx = sameRound.findIndex((m) => m.id === currentMatch.id)
    if (idx > 0) {
      setCurrentMatchId(sameRound[idx - 1].id)
      return
    }
    const roundIdx = orderedRounds.indexOf(currentMatch.round)
    if (roundIdx > 0) {
      const prevRound = orderedRounds[roundIdx - 1]
      const prevRoundMatches = pickableProjected
        .filter((m) => m.round === prevRound)
        .sort((a, b) => a.matchNumber - b.matchNumber)
      if (prevRoundMatches.length > 0) {
        setCurrentMatchId(prevRoundMatches[prevRoundMatches.length - 1].id)
      }
    }
  }

  function goToNext(afterMatchId: string, updatedPicks: WorldCupPickView[]) {
    const nextMatch = findNextMatchInGuidedOrder(
      afterMatchId,
      buildWorldCupProjectedMatches(matches, updatedPicks).filter(isWorldCupMatchPickable),
      updatedPicks,
      orderedRounds
    )
    if (nextMatch) {
      setCurrentMatchId(nextMatch.id)
    } else {
      setCurrentMatchId(null)
      setShowComplete(isBracketComplete(matches, updatedPicks, includeThirdPlace))
    }
  }

  // ── Pick handler ───────────────────────────────────────────────────────
  const handlePick = useCallback(
    async (side: "home" | "away") => {
      if (!currentMatch || isLocked || saveState === "saving") return
      const selectedTeamId =
        side === "home" ? currentMatch.homeTeamId : currentMatch.awayTeamId
      const selectedSlotKey =
        side === "home" ? currentMatch.homeSlotKey : currentMatch.awaySlotKey
      if (!selectedSlotKey || !selectedTeamId || !isWorldCupMatchPickable(currentMatch)) {
        setSaveState("error")
        setSaveError("This matchup is not ready for picks yet.")
        return
      }

      // Find invalid downstream picks we need to clear locally
      const invalidIds = getInvalidDownstreamPickIds(
        projected,
        picks,
        currentMatch.id,
        selectedTeamId
      )

      // Optimistic local update — apply new pick and clear invalids
      const optimistic: WorldCupPickView = {
        id: `optimistic-${currentMatch.id}`,
        matchId: currentMatch.id,
        round: currentMatch.round,
        selectedTeamId,
        selectedSlotKey,
        selectedTeamName:
          side === "home"
            ? currentMatch.homeTeamName
            : currentMatch.awayTeamName,
        pointsAwarded: 0,
        isCorrect: null,
        lockedAt: null,
      }

      const optimisticPicks: WorldCupPickView[] = [
        ...picks.filter(
          (p) =>
            p.matchId !== currentMatch.id &&
            !invalidIds.includes(p.id)
        ),
        optimistic,
      ]

      setPicks(optimisticPicks)
      setSaveState("saving")
      setSaveError(null)

      try {
        const payload: GuidedPickPayload = {
          matchId: currentMatch.id,
          selectedTeamId,
          selectedSlotKey,
          selectedSide: side,
        }
        // onSavePick returns the updated picks array from the server
        const serverPicks = await onSavePick(payload, picks)
        setPicks(serverPicks)
        onPicksUpdated?.(serverPicks)
        setSaveState("saved")

        // Auto-advance after short visual feedback
        setTimeout(() => {
          setSaveState("idle")
          goToNext(currentMatch.id, serverPicks)
        }, 400)
      } catch (err) {
        // Roll back optimistic update
        setPicks(picks)
        setSaveState("error")
        setSaveError(err instanceof Error ? err.message : "Failed to save pick")
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentMatch, isLocked, saveState, picks, projected, orderedRounds]
  )

  // Trap focus & keyboard navigation
  const modalRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!isOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const pick = currentMatch
    ? picks.find((p) => p.matchId === currentMatch.id) ?? null
    : null
  const champion = picks.find((p) => p.round === "final") ?? null

  return (
    <div
      ref={modalRef}
      role="dialog"
      aria-modal="true"
      aria-label="Guided Matchup Picker"
      className="fixed inset-0 z-[80] flex flex-col bg-[#05070b] text-white"
    >
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <header className="shrink-0 border-b border-white/10 bg-zinc-950/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-widest text-white/35">
              {entryName}
            </p>
            <h1 className="text-base font-black text-white">
              {showComplete
                ? "Bracket Complete"
                : currentMatch
                ? WORLD_CUP_ROUND_LABELS[currentMatch.round]
                : "Guided Picks"}
            </h1>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-white/40">
            <span className="tabular-nums">
              {totalPicked}/{totalRequired}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.05] text-white/60 hover:text-white"
            aria-label="Close guided picker"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {currentMatch && !showComplete && (
          <div className="mt-2">
            <ProgressBar
              done={totalPicked}
              total={totalRequired}
              round={currentMatch.round}
              roundDone={roundPickedCount}
              roundTotal={roundMatches.length}
            />
          </div>
        )}
        {saveError && (
          <div className="mt-2 flex items-center gap-2 rounded-lg border border-rose-400/25 bg-rose-400/10 px-3 py-2 text-xs text-rose-100">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            {saveError}
          </div>
        )}
        {isLocked && (
          <div className="mt-2 flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-white/50">
            <Lock className="h-3.5 w-3.5 shrink-0" />
            This bracket is locked. Picks can no longer be changed.
          </div>
        )}
      </header>

      {/* ── Body ──────────────────────────────────────────────────────────── */}
      <main className="min-h-0 flex-1 overflow-y-auto">
        {showComplete ? (
          <BracketCompleteView
            champion={champion}
            onClose={onClose}
            onReview={() => setShowComplete(false)}
          />
        ) : currentMatch ? (
          <MatchView
            match={currentMatch}
            pick={pick}
            saveState={saveState}
            isLocked={isLocked}
            onPick={handlePick}
            challengeId={challengeId}
            entryId={entryId}
          />
        ) : (
          <div className="flex flex-col items-center justify-center gap-4 py-16 text-center text-sm text-white/40">
            <Clock className="h-8 w-8" />
            <p>
              {hasPickableMatchups
                ? "Teams for this round will appear once earlier matches are picked."
                : "Fixtures are loaded, but real team matchups are not resolved yet."}
            </p>
            {!hasPickableMatchups && unpickableDebug.length > 0 && (
              <p className="max-w-xl text-[11px] text-white/35">
                Debug: {unpickableDebug.map((item) => `M${item.matchNumber}:${item.reason}`).join(" · ")}
              </p>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl bg-white/[0.06] px-5 py-2.5 text-sm font-bold text-white/70"
            >
              Close
            </button>
          </div>
        )}
      </main>

      {/* ── Footer nav ────────────────────────────────────────────────────── */}
      {!showComplete && currentMatch && (
        <footer className="shrink-0 border-t border-white/10 bg-zinc-950/95 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] pt-3">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={goBack}
              disabled={!canGoBack || saveState === "saving"}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2 text-xs font-bold text-white/60 disabled:opacity-30"
            >
              <ChevronLeft className="h-4 w-4" />
              Back
            </button>

            <div className="text-center text-[10px] text-white/30">
              Match {currentMatch.matchNumber}
              {currentMatch.startsAt ? (
                <span className="ml-1">
                  · {formatMatchDate(currentMatch.startsAt)}
                </span>
              ) : null}
            </div>

            <button
              type="button"
              onClick={() => goToNext(currentMatch.id, picks)}
              disabled={saveState === "saving"}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2 text-xs font-bold text-white/60 disabled:opacity-30"
            >
              Skip
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </footer>
      )}
    </div>
  )
}

// ── Match content view ────────────────────────────────────────────────────────

function MatchView({
  match,
  pick,
  saveState,
  isLocked,
  onPick,
  challengeId,
  entryId,
}: {
  match: WorldCupMatchView
  pick: WorldCupPickView | null
  saveState: SaveState
  isLocked: boolean
  onPick: (side: "home" | "away") => void
  challengeId: string
  entryId: string
}) {
  const isSaving = saveState === "saving"
  const isFinal = isWorldCupMatchFinal(match)
  const isLive = isWorldCupMatchLive(match)
  const showScore = isLive || isFinal
  const pickLiveState = getWorldCupPickLiveState(match, pick)
  const scoreStr = showScore ? getWorldCupMatchDisplayScore(match) : null

  const homePickState = pick?.selectedTeamId === match.homeTeamId ||
    (pick?.selectedSlotKey && pick.selectedSlotKey === match.homeSlotKey)
    ? pickLiveState : "not_started"
  const awayPickState = pick?.selectedTeamId === match.awayTeamId ||
    (pick?.selectedSlotKey && pick.selectedSlotKey === match.awaySlotKey)
    ? pickLiveState : "not_started"

  return (
    <div className="flex flex-col gap-4 px-4 py-6 sm:py-10">
      {/* Match meta */}
      <div className="flex flex-col items-center gap-2 text-center">
        <MatchStatusBadge match={match} />
        {scoreStr && (
          <div className="text-3xl font-black tabular-nums text-white">{scoreStr}</div>
        )}
        {match.startsAt && match.status === "scheduled" && (
          <div className="flex items-center gap-1.5 text-sm text-white/45">
            <Clock className="h-3.5 w-3.5" />
            {formatWorldCupKickoffShort(match.startsAt)}
          </div>
        )}
        {match.venueName && (
          <div className="text-xs text-white/30">
            {match.venueName}{match.venueCity ? `, ${match.venueCity}` : ""}
          </div>
        )}
        {isSaving && (
          <div className="text-xs text-cyan-300">Saving…</div>
        )}
        {saveState === "saved" && (
          <div className="flex items-center gap-1 text-xs text-emerald-300">
            <Check className="h-3.5 w-3.5" /> Saved
          </div>
        )}
      </div>

      {/* vs. divider */}
      <div className="flex flex-col items-stretch gap-3 sm:flex-row">
        <TeamCard
          teamId={match.homeTeamId}
          teamName={match.homeTeamName || "TBD"}
          teamLogo={match.homeTeamLogo}
          score={match.homeScore}
          penaltyScore={match.homePenaltyScore}
          isWinner={isFinal && match.winnerTeamId === match.homeTeamId}
          isPicked={
            pick !== null &&
            (pick.selectedTeamId === match.homeTeamId ||
              (pick.selectedSlotKey !== null &&
                pick.selectedSlotKey === match.homeSlotKey))
          }
          isSaving={isSaving}
          isLocked={isLocked || isFinal}
          matchStatus={match.status}
          pickState={homePickState as "not_started" | "winning" | "drawing" | "losing" | "correct" | "incorrect" | "unknown"}
          onPick={() => onPick("home")}
        />

        <div className="flex shrink-0 items-center justify-center">
          <span className="rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1 text-xs font-black text-white/25">
            VS
          </span>
        </div>

        <TeamCard
          teamId={match.awayTeamId}
          teamName={match.awayTeamName || "TBD"}
          teamLogo={match.awayTeamLogo}
          score={match.awayScore}
          penaltyScore={match.awayPenaltyScore}
          isWinner={isFinal && match.winnerTeamId === match.awayTeamId}
          isPicked={
            pick !== null &&
            (pick.selectedTeamId === match.awayTeamId ||
              (pick.selectedSlotKey !== null &&
                pick.selectedSlotKey === match.awaySlotKey))
          }
          isSaving={isSaving}
          isLocked={isLocked || isFinal}
          matchStatus={match.status}
          pickState={awayPickState as "not_started" | "winning" | "drawing" | "losing" | "correct" | "incorrect" | "unknown"}
          onPick={() => onPick("away")}
        />
      </div>

      {/* Pick hint */}
      {!isLocked && !isFinal && !pick && (
        <p className="text-center text-xs text-white/35">
          Tap a team to select the winner
        </p>
      )}
      {!isWorldCupMatchPickable(match) && (
        <p className="text-center text-xs text-amber-200/90">
          This matchup is not ready for picks yet.
        </p>
      )}
      {pick && !isLocked && !isFinal && (
        <p className="text-center text-xs text-white/35">
          Tap the other team to change your pick
        </p>
      )}
      {(isLocked || isFinal) && (
        <p className="text-center text-xs text-white/30">
          {isFinal ? "This match has ended." : "Picks are locked for this match."}
        </p>
      )}

      {/* AI Matchup Preview */}
      {!isFinal && (
        <AiPreviewPanel
          challengeId={challengeId}
          entryId={entryId}
          matchId={match.id}
          homeName={match.homeTeamName || match.homeSlotKey}
          awayName={match.awayTeamName || match.awaySlotKey}
          onUsePick={onPick}
          disabled={isLocked}
        />
      )}
    </div>
  )
}
