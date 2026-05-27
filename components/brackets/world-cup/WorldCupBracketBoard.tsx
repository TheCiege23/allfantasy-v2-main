"use client"
import { Fragment, useEffect, useMemo, useRef, useState } from "react"
import { Trophy } from "lucide-react"
import type {
  WorldCupChallengeView,
  WorldCupMatchView,
  WorldCupPickView,
  WorldCupRound,
} from "@/lib/world-cup/types"
import {
  findWorldCupPickForMatch,
  hasWorldCupPickSelection,
} from "@/lib/world-cup/worldCupProjectedBracket"
import WorldCupBracketCard from "./WorldCupBracketCard"
import { useOptionalLanguage } from "@/components/i18n/LanguageProviderClient"
import { makeWcT } from "@/lib/world-cup/worldCupI18n"

// ── Bracket geometry ─────────────────────────────────────────────────────────
// Card height matches h-[5.5rem] in WorldCupBracketCard. SLOT = card + gap.
// 8 R32 slots per side → column height = 8×SLOT − CARD_GAP = 760 px.
const CARD_H = 88
const CARD_GAP = 8
const SLOT = CARD_H + CARD_GAP
const COLUMN_H = SLOT * 8 - CARD_GAP // 760 px

/** Top (and symmetric bottom) spacer height for a column at a given depth. */
function bracketTopOffset(depth: number): number {
  return (SLOT * (Math.pow(2, depth) - 1)) / 2
}

/** Vertical gap between consecutive cards in a column at a given depth. */
function bracketMatchGap(depth: number): number {
  return SLOT * Math.pow(2, depth) - CARD_H
}

const ROUND_DEPTH: Partial<Record<WorldCupRound, number>> = {
  round_of_32: 0,
  round_of_16: 1,
  quarterfinal: 2,
  semifinal: 3,
}

// Left side flows inward: outermost (R32) → innermost (SF)
const LEFT_ROUNDS: WorldCupRound[] = ["round_of_32", "round_of_16", "quarterfinal", "semifinal"]
// Right side mirrors: innermost (SF) → outermost (R32)
const RIGHT_ROUNDS: WorldCupRound[] = ["semifinal", "quarterfinal", "round_of_16", "round_of_32"]

function splitMatchesBySide(matches: WorldCupMatchView[]): {
  left: WorldCupMatchView[]
  right: WorldCupMatchView[]
} {
  const sorted = [...matches].sort((a, b) => a.roundIndex - b.roundIndex)
  const mid = Math.ceil(sorted.length / 2)
  return { left: sorted.slice(0, mid), right: sorted.slice(mid) }
}

// ── Shared prop shape passed to every BracketColumn ──────────────────────────
type ColSharedProps = {
  picks: WorldCupPickView[]
  onPick: (match: WorldCupMatchView, side: "home" | "away", confidencePoints?: number | null) => void
  onOpenMatchupPicker?: (matchId: string) => void
  savingMatchIds?: Set<string>
  isBracketLocked: boolean
  lockStrategy?: string
  tournamentLockAt?: string | null
  now: Date
  aiInsightsUnlocked: boolean
}

function BracketColumn({
  matches,
  depth,
  picks,
  onPick,
  onOpenMatchupPicker,
  savingMatchIds,
  isBracketLocked,
  lockStrategy,
  tournamentLockAt,
  now,
  aiInsightsUnlocked,
}: { matches: WorldCupMatchView[]; depth: number } & ColSharedProps) {
  const topOffset = bracketTopOffset(depth)
  const matchGap = bracketMatchGap(depth)

  return (
    <div className="flex w-40 shrink-0 flex-col" style={{ height: COLUMN_H }}>
      {/* Top spacer aligns first card with its pair of feeder matches */}
      <div style={{ height: topOffset, flexShrink: 0 }} />

      {matches.map((match, idx) => {
        const kickoffPast = Boolean(match.startsAt && new Date(match.startsAt) <= now)
        const apiStatus = (match.apiStatusShort ?? "").trim().toUpperCase()
        const nonOfficialTestState = apiStatus === "SIM" || apiStatus === "TEST"
        const tournamentPast =
          lockStrategy === "tournament_start" && tournamentLockAt
            ? new Date(tournamentLockAt) <= now
            : false
        const locked =
          isBracketLocked ||
          kickoffPast ||
          tournamentPast ||
          (!nonOfficialTestState &&
            (match.status === "final" || match.status === "live" || match.status === "halftime"))

        return (
          <Fragment key={match.id}>
            <WorldCupBracketCard
              match={match}
              pick={findWorldCupPickForMatch(picks, match) ?? undefined}
              locked={locked}
              onPick={onPick}
              onOpenMatchupPicker={onOpenMatchupPicker}
              isSaving={savingMatchIds?.has(match.id) ?? false}
              aiInsightsUnlocked={aiInsightsUnlocked}
            />
            {idx < matches.length - 1 && (
              <div style={{ height: matchGap, flexShrink: 0 }} />
            )}
          </Fragment>
        )
      })}

      {/* Symmetric bottom spacer — top + content + bottom = COLUMN_H exactly */}
      <div style={{ height: topOffset, flexShrink: 0 }} />
    </div>
  )
}

// ── Main board ────────────────────────────────────────────────────────────────
export default function WorldCupBracketBoard({
  view,
  picks,
  matches,
  onPick,
  onOpenMatchupPicker,
  savingMatchIds,
  isLocked = false,
  aiInsightsUnlocked = false,
  confidenceScoringEnabled = false, // kept for API compatibility
}: {
  view: WorldCupChallengeView
  picks: WorldCupPickView[]
  matches: WorldCupMatchView[]
  onPick: (match: WorldCupMatchView, side: "home" | "away", confidencePoints?: number | null) => void
  onOpenMatchupPicker?: (matchId: string) => void
  savingMatchIds?: Set<string>
  isLocked?: boolean
  aiInsightsUnlocked?: boolean
  confidenceScoringEnabled?: boolean
}) {
  const { language } = useOptionalLanguage()
  const t = useMemo(() => makeWcT(language), [language])
  // Fix: use /_([a-z0-9])/g so "round_of_32" → "roundOf32" (not "roundOf_32")
  const toCamelRound = (r: string) =>
    r.replace(/_([a-z0-9])/g, (_: string, c: string) => c.toUpperCase())

  // Hydration-safe clock — seed epoch so SSR and first CSR render are identical
  const [now, setNow] = useState<Date>(() => new Date(0))
  useEffect(() => {
    setNow(new Date())
    const id = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(id)
  }, [])

  // Scroll the bracket so it is horizontally centered on first render.
  // overflow-x-auto anchors to the left by default; scrollLeft = (scrollWidth - clientWidth) / 2
  // centers the content. This runs once after mount (no deps), which is safe because the
  // bracket geometry is fixed-pixel and doesn't change after hydration.
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2
  }, [])

  const champion = picks.find((p) => p.round === "final" && hasWorldCupPickSelection(p))
  const { pickLockStrategy, pickLockAt } = view.challenge

  const byRound = useMemo(() => {
    const map: Record<string, WorldCupMatchView[]> = {}
    for (const m of matches) {
      ;(map[m.round] ??= []).push(m)
    }
    return map
  }, [matches])

  const splitByRound = useMemo(() => {
    const result: Record<string, { left: WorldCupMatchView[]; right: WorldCupMatchView[] }> = {}
    for (const round of LEFT_ROUNDS) {
      result[round] = splitMatchesBySide(byRound[round] ?? [])
    }
    return result
  }, [byRound])

  const finalMatches = byRound["final"] ?? []
  const thirdPlaceMatches = byRound["third_place"] ?? []
  const showThirdPlace = view.challenge.includeThirdPlace && thirdPlaceMatches.length > 0

  function matchLocked(match: WorldCupMatchView): boolean {
    const kickoffPast = Boolean(match.startsAt && new Date(match.startsAt) <= now)
    const apiStatus = (match.apiStatusShort ?? "").trim().toUpperCase()
    const nonOfficialTestState = apiStatus === "SIM" || apiStatus === "TEST"
    const tournamentPast =
      pickLockStrategy === "tournament_start" && pickLockAt
        ? new Date(pickLockAt) <= now
        : false
    return (
      isLocked ||
      kickoffPast ||
      tournamentPast ||
      (!nonOfficialTestState &&
        (match.status === "final" || match.status === "live" || match.status === "halftime"))
    )
  }

  const colProps: ColSharedProps = {
    picks,
    onPick,
    onOpenMatchupPicker,
    savingMatchIds,
    isBracketLocked: isLocked,
    lockStrategy: pickLockStrategy,
    tournamentLockAt: pickLockAt,
    now,
    aiInsightsUnlocked,
  }

  return (
    <div
      ref={scrollContainerRef}
      data-testid="world-cup-knockout-board-scroll"
      className="min-h-full overflow-x-auto scroll-pt-32 px-3 pb-6 pt-6 sm:px-5 sm:pt-8"
    >
      {/* Champion pick banner — gold treatment */}
      <div className="mb-4 flex min-w-0 flex-col gap-2 sm:mb-5 sm:min-w-max sm:flex-row sm:items-center sm:gap-3">
        <div className="relative overflow-hidden rounded-xl border border-amber-400/30 bg-gradient-to-r from-amber-500/[0.12] via-amber-600/[0.07] to-transparent px-3 py-2.5 sm:px-4 sm:py-3">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(251,191,36,0.09),transparent_60%)]"
          />
          <div className="relative flex items-center gap-2">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-amber-400/30 bg-amber-400/[0.12]">
              <Trophy className="h-3.5 w-3.5 text-amber-300" aria-hidden />
            </div>
            <div>
              <div className="text-[9px] font-black uppercase tracking-[0.18em] text-amber-300/65 sm:text-[10px]">
                {t("wc.matchup.bracketBoardChampionLabel")}
              </div>
              <div className="mt-0.5 truncate text-base font-black text-white sm:mt-1 sm:text-lg">
                {champion?.selectedTeamName ?? (
                  <span className="text-white/40 text-sm italic font-semibold">
                    {t("wc.matchup.bracketBoardChampionFallback")}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-[11px] leading-snug text-white/45 sm:px-4 sm:py-3 sm:text-xs">
          {t("wc.matchup.bracketBoardHelper")}
        </div>
      </div>

      {/* Bracket scroll area — min-w-max keeps columns from wrapping */}
      <div className="min-w-max">
        {/* Round label row: R32 | R16 | QF | SF | FINAL | SF | QF | R16 | R32 */}
        <div className="mb-1 flex gap-1">
          {LEFT_ROUNDS.map((round) => (
            <div
              key={`lbl-l-${round}`}
              className="w-40 shrink-0 text-center text-[8px] font-black uppercase tracking-[0.16em] text-white/30"
            >
              {t(`wc.round.${toCamelRound(round)}`)}
            </div>
          ))}
          <div className="w-40 shrink-0 text-center text-[9px] font-black uppercase tracking-[0.16em] text-amber-300/70">
            {t("wc.round.final")}
          </div>
          {RIGHT_ROUNDS.map((round) => (
            <div
              key={`lbl-r-${round}`}
              className="w-40 shrink-0 text-center text-[8px] font-black uppercase tracking-[0.16em] text-white/30"
            >
              {t(`wc.round.${toCamelRound(round)}`)}
            </div>
          ))}
        </div>

        {/* Bracket columns — 9 total: 4 left + final + 4 right */}
        <div className="flex items-start gap-1" style={{ height: COLUMN_H }}>
          {/* Left side: R32 → R16 → QF → SF (outermost to innermost) */}
          {LEFT_ROUNDS.map((round) => (
            <BracketColumn
              key={`l-${round}`}
              matches={splitByRound[round]?.left ?? []}
              depth={ROUND_DEPTH[round] ?? 0}
              {...colProps}
            />
          ))}

          {/* Center: Final card + champion trophy */}
          <div className="flex w-40 shrink-0 flex-col" style={{ height: COLUMN_H }}>
            <div style={{ height: bracketTopOffset(3), flexShrink: 0 }} />
            {finalMatches.map((match) => (
              <WorldCupBracketCard
                key={match.id}
                match={match}
                pick={findWorldCupPickForMatch(picks, match) ?? undefined}
                locked={matchLocked(match)}
                onPick={onPick}
                onOpenMatchupPicker={onOpenMatchupPicker}
                isSaving={savingMatchIds?.has(match.id) ?? false}
                aiInsightsUnlocked={aiInsightsUnlocked}
              />
            ))}
            {champion?.selectedTeamName && (
              <div className="mt-2 flex flex-col items-center gap-1 px-2">
                <div className="relative flex h-8 w-8 items-center justify-center rounded-xl border border-amber-400/40 bg-amber-400/[0.12] shadow-[0_0_16px_-4px_rgba(251,191,36,0.4)]">
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-0 rounded-xl bg-[radial-gradient(circle,rgba(251,191,36,0.18),transparent_70%)] blur-sm"
                  />
                  <Trophy className="relative h-4 w-4 text-amber-300" aria-hidden />
                </div>
                <span className="text-center text-[10px] font-black leading-tight text-amber-200/80">
                  {champion.selectedTeamName}
                </span>
              </div>
            )}
          </div>

          {/* Right side: SF → QF → R16 → R32 (innermost to outermost) */}
          {RIGHT_ROUNDS.map((round) => (
            <BracketColumn
              key={`r-${round}`}
              matches={splitByRound[round]?.right ?? []}
              depth={ROUND_DEPTH[round] ?? 0}
              {...colProps}
            />
          ))}
        </div>

        {/* Third place — rendered below the bracket when enabled */}
        {showThirdPlace && (
          <div className="mt-6">
            <div className="mb-1 text-[8px] font-black uppercase tracking-[0.15em] text-white/35">
              {t("wc.round.thirdPlace")}
            </div>
            <div className="flex gap-1">
              {thirdPlaceMatches.map((match) => (
                <div key={match.id} className="w-40">
                  <WorldCupBracketCard
                    match={match}
                    pick={findWorldCupPickForMatch(picks, match) ?? undefined}
                    locked={matchLocked(match)}
                    onPick={onPick}
                    onOpenMatchupPicker={onOpenMatchupPicker}
                    isSaving={savingMatchIds?.has(match.id) ?? false}
                    aiInsightsUnlocked={aiInsightsUnlocked}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
