"use client"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { TradeSimulationStrip } from "@/components/ai/sim/TradeSimulationStrip"
import { IdpTradeLineupWarning } from "@/components/idp/IdpTradeLineupWarning"
import { InContextMonetizationCard } from "@/components/monetization/InContextMonetizationCard"
import {
  GradeLeaguePicker,
  gradeLeagueOptions,
  noLeagueGradeHint,
  type GradeLeagueListRow,
} from "@/components/trade-evaluator/GradeLeaguePicker"
import { usePlayerComparisonUIOptional } from "@/components/player-comparison-ui"
import { DEFAULT_SPORT, SUPPORTED_SPORTS, normalizeToSupportedSport, type SupportedSport } from "@/lib/sport-scope"
import type { NegotiationToolkit } from "@/lib/trade-engine/types"
import { liveGradePanel } from "@/lib/decision-os/trade/receiptViews"

type LeagueFormat = "dynasty" | "keeper" | "redraft"
type QBFormat = "sf" | "1qb"
type ScoringFormat =
  | "PPR"
  | "Half PPR"
  | "Standard"
  | "TE Premium"
  | "Superflex"
  | "Points"
  | "Categories"

/**
 * The band the verdict moves across when the unmeasured IDP defence-vs-offence ceiling is
 * varied over a defensible range. The route emits it ONLY when that band spans 50 — i.e.
 * when the constant WE picked, not the trade, is what decides who wins.
 */
interface IdpCeilingCaveat {
  lowFairness: number
  highFairness: number
  flipsWinner: boolean
  note: string
}

type PhaseKey = "plan" | "pricing" | "engine" | "ai" | "check"
type VerdictKey =
  | "SMASH ACCEPT"
  | "ACCEPT"
  | "LEAN ACCEPT"
  | "FAIR"
  | "LEAN DECLINE"
  | "DECLINE"
  | "SMASH DECLINE"
  | "NOT GRADED"

interface TradePlayer {
  id: string
  name: string
  position: string
  team: string
  age: string
}

interface TradePick {
  id: string
  year: string
  round: string
  projectedRange: "early" | "mid" | "late" | "unknown"
}

interface TradeSide {
  teamName: string
  record: string
  isProMember: boolean
  players: TradePlayer[]
  picks: TradePick[]
  faab: number
}

interface TradeDriver {
  id: string
  direction: "positive" | "negative" | "neutral"
  strength: "strong" | "moderate" | "weak"
  label: string
  detail: string
}

interface TradeLabelChip {
  id: string
  name: string
  emoji: string
  description: string
  kind: "positive" | "warning"
}

interface TradeResult {
  verdict: VerdictKey
  /**
   * 🛑 LIVE MODE SHOWS ONLY THE RECEIPT'S NUMBERS. The route's composite fairness, value delta,
   * confidence, acceptance drivers and signal chips are priced differently from the one grade and
   * could contradict the letter beside them, so the page carries `receiptTotals` and hides them.
   * Historical (`asOfDate`) mode shows the same one grade since 2026-09-27; its old letters are gone.
   */
  live: boolean
  /** In `asOfDate` mode: what the grade is on, and the as-of-date gap as a labelled number. */
  historicalNote: string | null
  receiptTotals: { send: number; get: number; gapPct: number } | null
  fairnessScore: number | null
  fairnessMethod: string | null
  /** Null when the grade was withheld — `gradeWithheld` says why. */
  senderGrade: string | null
  receiverGrade: string | null
  gradeWithheld: string | null
  valueDelta: number | null
  confidencePct: number | null
  recommendation: string
  /** The AI's own summary, shown under the grade's recommendation in live mode. */
  aiSummary: string | null
  analysisBullets: string[]
  providers: string[]
  pECRIterations?: number
  pECRPassed?: boolean
  drivers: TradeDriver[]
  labels: TradeLabelChip[]
  warnings: string[]
  idpLineupWarning: string | null
  idpCeilingCaveat: IdpCeilingCaveat | null
  counterOffer?: string
  negotiationSteps: string[]
  betterAlternatives: Array<{ teamId: string; whyBetter: string; tradeFramework: string; fitScore: number }>
  rawPayload: ApiTradeResponse
  /** The league this evaluation was graded in, as sent — null means none was chosen. */
  gradedLeagueId: string | null
}

interface ApiDriver {
  id: string
  name?: string
  direction?: string
  strength?: string
  value?: number
  evidence?: {
    metric?: string
    raw?: number
    unit?: string
    note?: string
  }
}

interface ApiTradeResponse {
  evaluation?: {
    verdict?: {
      overall?: string
      teamA?: string
      teamB?: string
    }
    explanation?: {
      summary?: string
      teamAReasoning?: string
      teamBReasoning?: string
      leagueContextNotes?: string[]
    }
    confidence?: {
      score?: number
      rating?: string
      drivers?: string[]
    }
    betterAlternatives?: Array<{
      teamId: string
      fitScore: number
      whyBetter: string
      tradeFramework: string
    }>
    riskFlags?: string[]
    negotiation?: {
      dmMessages?: Array<{ tone?: string; hook?: string; message?: string }>
      counters?: Array<{ label?: string; rationale?: string; ifTheyObject?: string }>
      sweeteners?: Array<{ label?: string; whenToUse?: string }>
      redLines?: string[]
    }
  }
  tradeInsights?: {
    fairnessScore?: number
    fairnessMethod?: string
    netDeltaPct?: number
    labels?: Array<{ id: string; name: string; emoji: string; description: string }>
    warnings?: Array<{ id: string; name: string; emoji: string; description: string }>
    veto?: boolean
    vetoReason?: string | null
    expertWarning?: string | null
    idpLineupWarning?: string | null
    idpCeilingCaveat?: IdpCeilingCaveat | null
  }
  valuationReport?: {
    teamA?: {
      netValue?: number
      totalGiven?: number
      totalReceived?: number
      fairnessScore?: number
    }
    teamB?: {
      netValue?: number
      totalGiven?: number
      totalReceived?: number
      fairnessScore?: number
    }
  }
  serverConfidence?: {
    score?: number
  }
  acceptProbability?: {
    probability?: number
    percentDisplay?: string
    verdict?: string
    lean?: string
    drivers?: ApiDriver[]
    confidenceDrivers?: ApiDriver[]
    acceptBullets?: string[]
    sensitivitySentence?: string
  }
  negotiationToolkit?: NegotiationToolkit
  /** The one trade engine's grade, from the sender's side (`lib/decision-os/trade/evaluateTrade.ts`). */
  tradeGrade?: {
    grade: string | null
    partnerGrade: string | null
    gradeLabel: string | null
    gradeWithheld: string | null
    percentDiff: number | null
    giveValue: number | null
    getValue: number | null
    recommendation: string | null
    evaluationReceiptId: string | null
  }
  /** The as-of-date value comparison — numbers only; the route sends no letter for it. */
  dualModeGrades?: {
    atTheTime?: { percentDiff?: number }
    withHindsight?: { percentDiff?: number }
  }
  /** Which provider wrote the explanation of the grade (one call, Phase 4), keyed by provider name. */
  aiProviders?: {
    openai?: string
    anthropic?: string
    xai?: string
    deepseek?: string
    grok?: string
  }
}

const SPORT_LABELS: Record<SupportedSport, string> = {
  NFL: "NFL",
  NHL: "NHL",
  NBA: "NBA",
  MLB: "MLB",
  NCAAF: "NCAA Football",
  NCAAB: "NCAA Basketball",
  SOCCER: "Soccer",
}

const FORMAT_OPTIONS: Array<{ value: LeagueFormat; label: string }> = [
  { value: "dynasty", label: "Dynasty" },
  { value: "keeper", label: "Keeper" },
  { value: "redraft", label: "Redraft" },
]

const QB_FORMAT_OPTIONS: Array<{ value: QBFormat; label: string }> = [
  { value: "sf", label: "Superflex (2QB)" },
  { value: "1qb", label: "1QB" },
]

const SCORING_OPTIONS: ScoringFormat[] = [
  "PPR",
  "Half PPR",
  "Standard",
  "TE Premium",
  "Superflex",
  "Points",
  "Categories",
]

const PHASES: Array<{ key: PhaseKey; label: string; icon: string }> = [
  { key: "plan", label: "Planning", icon: "📋" },
  { key: "pricing", label: "Pricing", icon: "💰" },
  { key: "engine", label: "Engine", icon: "⚙️" },
  { key: "ai", label: "AI", icon: "🧠" },
  { key: "check", label: "Check", icon: "✅" },
]

const VERDICT_CONFIG: Record<VerdictKey, { color: string; glow: string; emoji: string }> = {
  "SMASH ACCEPT": { color: "#10b981", glow: "rgba(16,185,129,0.35)", emoji: "🚀" },
  ACCEPT: { color: "#34d399", glow: "rgba(52,211,153,0.32)", emoji: "✅" },
  "LEAN ACCEPT": { color: "#6ee7b7", glow: "rgba(110,231,183,0.28)", emoji: "📈" },
  FAIR: { color: "#fbbf24", glow: "rgba(251,191,36,0.30)", emoji: "⚖️" },
  "LEAN DECLINE": { color: "#fb923c", glow: "rgba(251,146,60,0.28)", emoji: "📉" },
  DECLINE: { color: "#f87171", glow: "rgba(248,113,113,0.30)", emoji: "❌" },
  "SMASH DECLINE": { color: "#ef4444", glow: "rgba(239,68,68,0.35)", emoji: "🚫" },
  "NOT GRADED": { color: "#94a3b8", glow: "rgba(148,163,184,0.22)", emoji: "⏸️" },
}

/** The one grade's label as this page's verdict — the badge reads off the same number as the letter. */
function verdictFromGradeLabel(label: string | null | undefined): VerdictKey {
  switch (label) {
    case "Major win (you)":
      return "SMASH ACCEPT"
    case "Slightly favors you":
      return "LEAN ACCEPT"
    case "Even":
      return "FAIR"
    case "Slightly favors opponent":
      return "LEAN DECLINE"
    case "Major overpay":
      return "SMASH DECLINE"
    default:
      return "NOT GRADED"
  }
}

const POSITION_OPTIONS = ["", "QB", "RB", "WR", "TE", "K", "DEF", "PG", "SG", "SF", "PF", "C", "SP", "RP", "OF", "SS", "2B", "3B", "1B", "LW", "RW", "D", "G", "UTIL", "FLEX", "IDP"]
const PICK_YEAR_OPTIONS = ["2025", "2026", "2027", "2028", "2029"]
const PICK_ROUND_OPTIONS = ["1", "2", "3", "4", "5"]

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

function emptyPlayer(name = ""): TradePlayer {
  return {
    id: uid(),
    name,
    position: "",
    team: "",
    age: "",
  }
}

function emptyPick(): TradePick {
  return {
    id: uid(),
    year: "2026",
    round: "1",
    projectedRange: "mid",
  }
}

function emptySide(name: string, firstPlayerName = ""): TradeSide {
  return {
    teamName: name,
    record: "",
    isProMember: false,
    players: [emptyPlayer(firstPlayerName)],
    picks: [],
    faab: 0,
  }
}

type LinkedLeague = GradeLeagueListRow & {
  id: string
  sleeperLeagueId?: string | null
  platformLeagueId?: string | null
  unifiedLeagueId?: string | null
  hasUnifiedRecord?: boolean
  isDynasty?: boolean
  leagueType?: string | null
  format?: string | null
  scoring?: string | null
}

function formatFromLinkedLeague(league: LinkedLeague): LeagueFormat {
  if (league.isDynasty) return "dynasty"
  const raw = (league.leagueType ?? league.format ?? "").toLowerCase()
  if (raw.includes("dynasty")) return "dynasty"
  if (raw.includes("keeper")) return "keeper"
  return "redraft"
}

function scoringFromLinkedLeague(league: LinkedLeague): ScoringFormat | null {
  const raw = (league.scoring ?? "").toLowerCase()
  if (!raw) return null
  if (raw.includes("half")) return "Half PPR"
  if (raw.includes("standard") || raw === "std") return "Standard"
  if (raw.includes("ppr")) return "PPR"
  return null
}




function providerList(payload: ApiTradeResponse) {
  const providers = payload.aiProviders
  if (!providers) return ["AI"]

  const labels: string[] = []
  if (providers.openai === "ok") labels.push("OpenAI")
  if (providers.anthropic === "ok") labels.push("Anthropic")
  if (providers.xai === "ok" || providers.grok === "ok") labels.push("Grok")
  if (providers.deepseek === "ok") labels.push("DeepSeek")
  return labels.length > 0 ? labels : ["AI"]
}

function buildNegotiationSteps(payload: ApiTradeResponse) {
  const toolkit = payload.negotiationToolkit
  if (toolkit) {
    const steps: string[] = []
    steps.push(`Open with leverage: ${toolkit.dmMessages.opener}`)
    steps.push(`Lead the rationale with: ${toolkit.dmMessages.rationale}`)
    if (toolkit.counters[0]?.description) steps.push(`Primary counter: ${toolkit.counters[0].description}`)
    if (toolkit.sweeteners[0]?.suggestion) steps.push(`Sweetener if needed: ${toolkit.sweeteners[0].suggestion}`)
    if (toolkit.redLines[0]?.rule) steps.push(`Red line: ${toolkit.redLines[0].rule}`)
    if (toolkit.dmMessages.fallback) steps.push(`Fallback close: ${toolkit.dmMessages.fallback}`)
    return steps.slice(0, 6)
  }

  const legacy = payload.evaluation?.negotiation
  if (!legacy) return []

  const steps: string[] = []
  if (legacy.dmMessages?.[0]?.message) steps.push(legacy.dmMessages[0].message)
  if (legacy.counters?.[0]?.rationale) steps.push(`Counter with: ${legacy.counters[0].rationale}`)
  if (legacy.sweeteners?.[0]?.whenToUse) steps.push(`Use a sweetener when: ${legacy.sweeteners[0].whenToUse}`)
  if (legacy.redLines?.[0]) steps.push(`Red line: ${legacy.redLines[0]}`)
  return steps
}

function buildCounterOffer(payload: ApiTradeResponse) {
  if (payload.negotiationToolkit?.counters[0]?.description) return payload.negotiationToolkit.counters[0].description
  if (payload.evaluation?.negotiation?.counters?.[0]?.rationale) return payload.evaluation.negotiation.counters[0].rationale
  return undefined
}

function buildWarnings(payload: ApiTradeResponse) {
  return [
    payload.tradeInsights?.vetoReason ?? null,
    payload.tradeInsights?.expertWarning ?? null,
    ...(payload.evaluation?.riskFlags ?? []),
  ].filter((value): value is string => Boolean(value && value.trim()))
}

/**
 * `asOfDate` mode (2026-09-27). The one grader has no as-of-date pricing, so the letter is today's —
 * and this says so, beside the gap on the requested date as a NUMBER. That old gap used to become a
 * letter of its own (`computeDualModeGrades`, `gradeFromPercentDiff`), a second scale on one screen.
 */
function historicalNoteFor(payload: ApiTradeResponse, asOfDate: string): string | null {
  if (!asOfDate) return null
  const base = `Graded on today's league values — grades have no as-of-date pricing yet, so this is not a grade for ${asOfDate}.`
  const then = payload.dualModeGrades?.atTheTime?.percentDiff
  if (typeof then !== "number" || !Number.isFinite(then)) return base
  const pct = Math.round(Math.abs(then))
  if (pct === 0) return `${base} On ${asOfDate}'s values the two sides were even.`
  return `${base} On ${asOfDate}'s values the sender ${then > 0 ? "received" : "gave up"} about ${pct}% more value — a value comparison, not a grade.`
}

function mapApiResponse(payload: ApiTradeResponse, headers: Headers, asOfDate: string): Omit<TradeResult, "gradedLeagueId"> {
  /*
   * 🛑 THE LETTER IS THE SERVER'S ONE GRADE, NOT ONE MADE HERE. This used to be
   * `gradeFromPercentDiff` over the route's composite totals — a third scale, computed in the
   * browser. A withheld grade shows no letter and the reason, never a fallback letter.
   */
  const pecrIterations = headers.get("x-pecr-iterations")
  const pecrPassed = headers.get("x-pecr-passed")
  const shared = {
    providers: providerList(payload),
    pECRIterations: pecrIterations ? Number(pecrIterations) : undefined,
    pECRPassed: pecrPassed ? pecrPassed === "true" : undefined,
    warnings: buildWarnings(payload),
    idpLineupWarning: payload.tradeInsights?.idpLineupWarning ?? null,
  }
  const warningChips: TradeLabelChip[] = (payload.tradeInsights?.warnings ?? []).map((label) => ({ ...label, kind: "warning" as const }))

  /*
   * 🛑 LIVE: EVERY NUMBER IS THE RECEIPT'S (2026-09-27). The verdict badge, the totals and the
   * headline all read off the one grade; the composite fairness, value delta, confidence,
   * acceptance drivers/bullets, positive signal chips and the IDP fairness-range caveat are hidden,
   * because they are priced differently and could contradict the letter. The AI summary stays, as
   * supporting text under the grade — its prompt now leads with the receipt.
   */
  const panel = liveGradePanel(payload.tradeGrade)
  return {
    ...shared,
    live: true,
    historicalNote: historicalNoteFor(payload, asOfDate),
    receiptTotals: panel.totals,
    verdict: verdictFromGradeLabel(panel.gradeLabel),
    fairnessScore: null,
    fairnessMethod: null,
    senderGrade: panel.senderGrade,
    receiverGrade: panel.receiverGrade,
    gradeWithheld: panel.gradeWithheld,
    valueDelta: panel.totals ? panel.totals.get - panel.totals.send : null,
    confidencePct: null,
    recommendation: panel.headline,
    aiSummary: payload.evaluation?.explanation?.summary ?? null,
    analysisBullets: (payload.evaluation?.explanation?.leagueContextNotes ?? []).filter(Boolean),
    drivers: [],
    labels: warningChips,
    idpCeilingCaveat: null,
    counterOffer: buildCounterOffer(payload),
    negotiationSteps: buildNegotiationSteps(payload),
    betterAlternatives: payload.evaluation?.betterAlternatives ?? [],
    rawPayload: payload,
  }
}

function ResultBadge({ verdict }: { verdict: VerdictKey }) {
  const config = VERDICT_CONFIG[verdict]
  return (
    <div
      className="rounded-2xl border px-5 py-4 text-center"
      style={{ borderColor: `${config.color}55`, background: `radial-gradient(circle at top, ${config.glow}, rgba(9,12,24,0.94))` }}
    >
      <div className="text-4xl">{config.emoji}</div>
      <div className="mt-2 text-xl font-black" style={{ color: config.color }}>
        {verdict}
      </div>
      <div className="mt-1 text-[11px] uppercase tracking-[0.25em] text-white/40">Verdict</div>
    </div>
  )
}

function LoadingState({ phase }: { phase: PhaseKey }) {
  const activeIndex = PHASES.findIndex((item) => item.key === phase)

  return (
    <div className="rounded-3xl border border-white/8 bg-[#0c0c1e] p-6 sm:p-8">
      <div className="text-center">
        <div className="mx-auto flex w-fit items-center gap-1.5">
          {[0, 1, 2].map((index) => (
            <div
              key={index}
              className="h-2.5 w-2.5 rounded-full bg-cyan-400"
              style={{ animation: "pulse 1s ease-in-out infinite", animationDelay: `${index * 0.18}s` }}
            />
          ))}
        </div>
        <h2 className="mt-5 text-xl font-bold text-white">Running multi-stage trade analysis</h2>
        <p className="mt-2 text-sm text-white/50">Planning, pricing, engine reasoning, AI synthesis, and output checks.</p>
      </div>

      <div className="mt-8 grid gap-3 sm:grid-cols-5">
        {PHASES.map((item, index) => {
          const isDone = index < activeIndex
          const isActive = index === activeIndex
          return (
            <div
              key={item.key}
              className={`rounded-2xl border px-4 py-4 text-center transition-all ${
                isActive
                  ? "border-cyan-400/35 bg-cyan-500/10"
                  : isDone
                    ? "border-emerald-400/20 bg-emerald-500/10"
                    : "border-white/8 bg-white/[0.02]"
              }`}
            >
              <div className="text-2xl">{item.icon}</div>
              <div className="mt-2 text-sm font-semibold text-white">{item.label}</div>
              <div className="mt-1 text-[11px] text-white/45">{isDone ? "Done" : isActive ? "In progress" : "Queued"}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function AssetPanel({
  label,
  accent,
  side,
  onChange,
  onClear,
}: {
  label: string
  accent: string
  side: TradeSide
  onChange: (side: TradeSide) => void
  onClear: () => void
}) {
  const playerCount = side.players.filter((player) => player.name.trim()).length
  const pickCount = side.picks.length

  return (
    <div className="rounded-3xl border border-white/8 bg-[#0c0c1e] p-5 sm:p-6" data-testid={`trade-side-${label.toLowerCase().includes("sender") ? "sender" : "receiver"}`}>
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.28em]" style={{ color: accent }}>
            {label}
          </div>
          <div className="mt-2 text-xs text-white/45">
            {playerCount} player{playerCount === 1 ? "" : "s"} · {pickCount} pick{pickCount === 1 ? "" : "s"} · {side.faab} FAAB
          </div>
        </div>
        <button
          type="button"
          onClick={onClear}
          className="touch-manipulation rounded-xl border border-white/10 px-3 py-2 text-xs font-medium text-white/45 hover:border-white/20 hover:text-white/75 min-h-[40px] sm:min-h-0 sm:py-1.5"
        >
          Clear
        </button>
      </div>

      <div className="space-y-4">
        <input
          value={side.teamName}
          onChange={(event) => onChange({ ...side, teamName: event.target.value })}
          placeholder="Manager / Team name"
          className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-base text-white placeholder:text-white/25 focus:border-cyan-500/40 focus:outline-none sm:text-sm"
        />

        <input
          value={side.record}
          onChange={(event) => onChange({ ...side, record: event.target.value })}
          placeholder="Record / rank (optional)"
          className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-base text-white placeholder:text-white/25 focus:border-cyan-500/40 focus:outline-none sm:text-sm"
        />

        <label className="flex items-center gap-2 text-sm text-white/70">
          <input
            type="checkbox"
            checked={side.isProMember}
            onChange={(event) => onChange({ ...side, isProMember: event.target.checked })}
            className="h-4 w-4 rounded border-white/20 bg-transparent"
          />
          AF Pro member
        </label>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/45">Players Giving</span>
            <button
              type="button"
              onClick={() => onChange({ ...side, players: [...side.players, emptyPlayer()] })}
              data-testid={`trade-add-player-${label.toLowerCase().includes("sender") ? "sender" : "receiver"}`}
              className="touch-manipulation text-xs font-semibold min-h-[40px] px-1 sm:min-h-0"
              style={{ color: accent }}
            >
              + Add Player
            </button>
          </div>

          {side.players.map((player, index) => (
            <div
              key={player.id}
              className="flex flex-col gap-2 rounded-xl border border-white/5 bg-white/[0.02] p-2 sm:grid sm:grid-cols-12 sm:items-center sm:gap-2 sm:border-0 sm:bg-transparent sm:p-0"
            >
              <input
                value={player.name}
                onChange={(event) => {
                  const players = [...side.players]
                  players[index] = { ...players[index], name: event.target.value }
                  onChange({ ...side, players })
                }}
                placeholder="Player name"
                className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-base text-white placeholder:text-white/25 focus:border-cyan-500/40 focus:outline-none sm:col-span-5 sm:text-sm"
              />
              <select
                value={player.position}
                onChange={(event) => {
                  const players = [...side.players]
                  players[index] = { ...players[index], position: event.target.value }
                  onChange({ ...side, players })
                }}
                className="min-h-[44px] w-full rounded-xl border border-white/10 bg-[#101224] px-3 py-2.5 text-base text-white focus:border-cyan-500/40 focus:outline-none sm:col-span-2 sm:min-h-0 sm:text-sm"
              >
                {POSITION_OPTIONS.map((position) => (
                  <option key={position || "blank"} value={position}>
                    {position || "Pos"}
                  </option>
                ))}
              </select>
              <input
                value={player.team}
                onChange={(event) => {
                  const players = [...side.players]
                  players[index] = { ...players[index], team: event.target.value }
                  onChange({ ...side, players })
                }}
                placeholder="Team"
                className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-base text-white placeholder:text-white/25 focus:border-cyan-500/40 focus:outline-none sm:col-span-2 sm:text-sm"
              />
              <div className="flex items-center gap-2 sm:contents">
                <input
                  type="number"
                  min={0}
                  value={player.age}
                  onChange={(event) => {
                    const players = [...side.players]
                    players[index] = { ...players[index], age: event.target.value }
                    onChange({ ...side, players })
                  }}
                  placeholder="Age"
                  className="min-h-[44px] w-full min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-base text-white placeholder:text-white/25 focus:border-cyan-500/40 focus:outline-none sm:col-span-2 sm:min-h-0 sm:text-sm"
                />
                <button
                  type="button"
                  onClick={() => onChange({ ...side, players: side.players.filter((_, rowIndex) => rowIndex !== index) })}
                  className="flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-xl text-lg text-red-300/70 hover:bg-red-500/10 hover:text-red-300 sm:col-span-1"
                  aria-label="Remove player"
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/45">Draft Picks</span>
            <button
              type="button"
              onClick={() => onChange({ ...side, picks: [...side.picks, emptyPick()] })}
              data-testid={`trade-add-pick-${label.toLowerCase().includes("sender") ? "sender" : "receiver"}`}
              className="touch-manipulation text-xs font-semibold min-h-[40px] px-1 sm:min-h-0"
              style={{ color: accent }}
            >
              + Add Pick
            </button>
          </div>

          {side.picks.length === 0 ? <div className="text-xs italic text-white/25">No picks added</div> : null}

          {side.picks.map((pick, index) => (
            <div
              key={pick.id}
              className="flex flex-col gap-2 rounded-xl border border-white/5 bg-white/[0.02] p-2 sm:grid sm:grid-cols-12 sm:items-center sm:gap-2 sm:border-0 sm:bg-transparent sm:p-0"
            >
              <select
                value={pick.year}
                onChange={(event) => {
                  const picks = [...side.picks]
                  picks[index] = { ...picks[index], year: event.target.value }
                  onChange({ ...side, picks })
                }}
                className="min-h-[44px] w-full rounded-xl border border-white/10 bg-[#101224] px-3 py-2.5 text-base text-white focus:border-cyan-500/40 focus:outline-none sm:col-span-4 sm:min-h-0 sm:text-sm"
              >
                {PICK_YEAR_OPTIONS.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
              <select
                value={pick.round}
                onChange={(event) => {
                  const picks = [...side.picks]
                  picks[index] = { ...picks[index], round: event.target.value }
                  onChange({ ...side, picks })
                }}
                className="min-h-[44px] w-full rounded-xl border border-white/10 bg-[#101224] px-3 py-2.5 text-base text-white focus:border-cyan-500/40 focus:outline-none sm:col-span-3 sm:min-h-0 sm:text-sm"
              >
                {PICK_ROUND_OPTIONS.map((round) => (
                  <option key={round} value={round}>
                    R{round}
                  </option>
                ))}
              </select>
              <select
                value={pick.projectedRange}
                onChange={(event) => {
                  const picks = [...side.picks]
                  picks[index] = { ...picks[index], projectedRange: event.target.value as TradePick["projectedRange"] }
                  onChange({ ...side, picks })
                }}
                className="min-h-[44px] w-full rounded-xl border border-white/10 bg-[#101224] px-3 py-2.5 text-base text-white focus:border-cyan-500/40 focus:outline-none sm:col-span-4 sm:min-h-0 sm:text-sm"
              >
                <option value="early">Early</option>
                <option value="mid">Mid</option>
                <option value="late">Late</option>
                <option value="unknown">Unknown</option>
              </select>
              <button
                type="button"
                onClick={() => onChange({ ...side, picks: side.picks.filter((_, rowIndex) => rowIndex !== index) })}
                className="flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center self-end rounded-xl text-lg text-red-300/70 hover:bg-red-500/10 hover:text-red-300 sm:col-span-1 sm:self-center"
                aria-label="Remove pick"
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <div>
          <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.24em] text-white/45">FAAB Included</label>
          <input
            type="number"
            min={0}
            value={side.faab}
            onChange={(event) => onChange({ ...side, faab: Number(event.target.value) || 0 })}
            className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-base text-white placeholder:text-white/25 focus:border-cyan-500/40 focus:outline-none sm:text-sm"
          />
        </div>
      </div>
    </div>
  )
}

function TradeHubInner() {
  const playerCompareUi = usePlayerComparisonUIOptional()
  const searchParams = useSearchParams()
  const previewSender = searchParams?.get("previewSender") ?? ""
  const previewReceiver = searchParams?.get("previewReceiver") ?? ""
  const linkedLeagueIdParam = searchParams?.get("leagueId") ?? ""

  const [sender, setSender] = useState<TradeSide>(() => emptySide("Sender Team", previewSender))
  const [receiver, setReceiver] = useState<TradeSide>(() => emptySide("Receiver Team", previewReceiver))
  const [format, setFormat] = useState<LeagueFormat>("dynasty")
  const [qbFormat, setQbFormat] = useState<QBFormat>("sf")
  const [sport, setSport] = useState<SupportedSport>(DEFAULT_SPORT)
  const [scoring, setScoring] = useState<ScoringFormat>("PPR")
  const [asOfDate, setAsOfDate] = useState("")
  const [linkedLeagueId, setLinkedLeagueId] = useState("")
  const [leagueRows, setLeagueRows] = useState<LinkedLeague[]>([])
  const [phase, setPhase] = useState<PhaseKey>("plan")
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<TradeResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const resultRef = useRef<HTMLDivElement | null>(null)

  const senderHasAssets = useMemo(
    () => sender.players.some((player) => player.name.trim()) || sender.picks.length > 0 || sender.faab > 0,
    [sender]
  )
  const receiverHasAssets = useMemo(
    () => receiver.players.some((player) => player.name.trim()) || receiver.picks.length > 0 || receiver.faab > 0,
    [receiver]
  )
  const canEvaluate = senderHasAssets && receiverHasAssets && !loading

  const miniCompare = useMemo(() => {
    const a = sender.players.find((player) => player.name.trim())?.name.trim() ?? ""
    const b = receiver.players.find((player) => player.name.trim())?.name.trim() ?? ""
    return { a, b, ready: Boolean(a && b) }
  }, [sender.players, receiver.players])

  useEffect(() => {
    if (result && resultRef.current) {
      resultRef.current.scrollIntoView({ behavior: "smooth", block: "start" })
    }
  }, [result])

  /*
   * One read of the viewer's leagues serves both the `?leagueId=` link and the league picker the
   * grade needs (`GradeLeaguePicker`). `summary=1` drops `settings`/`rosters` — ~94% of the payload
   * — which nothing here reads.
   */
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch("/api/league/list?summary=1")
        if (!res.ok) return
        const data = (await res.json()) as { leagues?: LinkedLeague[] }
        if (cancelled) return
        const rows = data.leagues ?? []
        setLeagueRows(rows)
        if (!linkedLeagueIdParam) return
        const league = rows.find(
          (l) =>
            l.id === linkedLeagueIdParam ||
            l.sleeperLeagueId === linkedLeagueIdParam ||
            l.platformLeagueId === linkedLeagueIdParam
        )
        if (!league) return
        // Only a unified (native League.id) row passes the API's membership
        // gate — a legacy/Sleeper-space id would 403 the whole evaluation.
        if (league.hasUnifiedRecord) {
          setLinkedLeagueId(String(league.unifiedLeagueId ?? league.id))
        }
        setFormat(formatFromLinkedLeague(league))
        const leagueScoring = scoringFromLinkedLeague(league)
        if (leagueScoring) setScoring(leagueScoring)
      } catch {
        /* league-blind evaluation still works */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [linkedLeagueIdParam])

  const gradeLeagues = useMemo(() => gradeLeagueOptions(leagueRows), [leagueRows])

  /** Choosing a league re-labels format and scoring to its own, and drops a grade taken elsewhere. */
  const chooseGradeLeague = useCallback(
    (leagueId: string) => {
      setLinkedLeagueId(leagueId)
      setResult(null)
      const league = leagueRows.find((l) => l.hasUnifiedRecord && String(l.unifiedLeagueId ?? l.id) === leagueId)
      if (!league) return
      setFormat(formatFromLinkedLeague(league))
      const leagueScoring = scoringFromLinkedLeague(league)
      if (leagueScoring) setScoring(leagueScoring)
    },
    [leagueRows]
  )

  const resetTrade = useCallback(() => {
    setSender(emptySide("Sender Team"))
    setReceiver(emptySide("Receiver Team"))
    setFormat("dynasty")
    setQbFormat("sf")
    setSport(DEFAULT_SPORT)
    setScoring("PPR")
    setAsOfDate("")
    setPhase("plan")
    setResult(null)
    setError(null)
  }, [])

  const swapSides = useCallback(() => {
    setSender(receiver)
    setReceiver(sender)
    setResult(null)
    setError(null)
  }, [receiver, sender])

  const evaluate = useCallback(async () => {
    if (!canEvaluate) return

    setLoading(true)
    setError(null)
    setResult(null)
    setPhase("plan")

    const timers = [
      window.setTimeout(() => setPhase("pricing"), 700),
      window.setTimeout(() => setPhase("engine"), 1800),
      window.setTimeout(() => setPhase("ai"), 3300),
      window.setTimeout(() => setPhase("check"), 5200),
    ]

    try {
      const response = await fetch("/api/trade-evaluator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trade_id: `trade_${Date.now()}`,
          confirmTokenSpend: true,
          ...(linkedLeagueId ? { leagueId: linkedLeagueId } : {}),
          sender: {
            manager_name: sender.teamName.trim() || "Sender Team",
            is_af_pro: sender.isProMember,
            record_or_rank: sender.record.trim() || undefined,
            gives_players: sender.players
              .filter((player) => player.name.trim())
              .map((player) => ({
                name: player.name.trim(),
                position: player.position.trim() || undefined,
                team: player.team.trim() || undefined,
                age: player.age.trim() ? Number(player.age) : undefined,
              })),
            gives_picks: sender.picks.map((pick) => ({
              year: Number(pick.year),
              round: Number(pick.round),
              projected_range: pick.projectedRange,
            })),
            gives_faab: sender.faab,
          },
          receiver: {
            manager_name: receiver.teamName.trim() || "Receiver Team",
            is_af_pro: receiver.isProMember,
            record_or_rank: receiver.record.trim() || undefined,
            gives_players: receiver.players
              .filter((player) => player.name.trim())
              .map((player) => ({
                name: player.name.trim(),
                position: player.position.trim() || undefined,
                team: player.team.trim() || undefined,
                age: player.age.trim() ? Number(player.age) : undefined,
              })),
            gives_picks: receiver.picks.map((pick) => ({
              year: Number(pick.year),
              round: Number(pick.round),
              projected_range: pick.projectedRange,
            })),
            gives_faab: receiver.faab,
          },
          league: {
            format,
            sport: normalizeToSupportedSport(sport),
            scoring_summary: scoring,
            qb_format: qbFormat,
          },
          asOfDate: asOfDate || undefined,
        }),
      })

      const data = (await response.json().catch(() => ({}))) as ApiTradeResponse & {
        error?: string
        message?: string
      }
      if (!response.ok) {
        /*
         * ⚠ `error` IS A CODE, `message` IS THE SENTENCE. Reading `error` first rendered
         * refusals to the user as bare machine strings — "UNPRICED_ASSETS", "DEVY_SCALE",
         * "AMBIGUOUS_PLAYER" — while the route was sending a written explanation right beside
         * it saying which player, and what to do about it. Prefer the sentence; keep the code
         * as the fallback for responses that carry no message.
         */
        throw new Error(data.message ?? data.error ?? `Trade evaluator returned ${response.status}`)
      }

      setResult({ ...mapApiResponse(data, response.headers, asOfDate), gradedLeagueId: linkedLeagueId || null })
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "Trade analysis failed.")
    } finally {
      timers.forEach((timer) => window.clearTimeout(timer))
      setLoading(false)
    }
  }, [asOfDate, canEvaluate, format, linkedLeagueId, qbFormat, receiver, scoring, sender, sport])

  return (
    <div className="min-h-screen bg-[#07071a] text-white">
      <div className="border-b border-white/6 bg-[#07071a]/90 backdrop-blur-xl pt-[max(0.25rem,env(safe-area-inset-top))]">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.24em] text-cyan-300">
                AI Trade Analyzer
              </span>
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.24em] text-white/50">
                PECR
              </span>
            </div>
            <h1 className="mt-2 text-xl font-black sm:text-3xl">Trade Hub</h1>
          </div>
          <div className="flex flex-wrap gap-2 sm:shrink-0 sm:justify-end">
            <button
              type="button"
              onClick={swapSides}
              data-testid="trade-swap-sides-button"
              className="touch-manipulation min-h-[44px] rounded-xl border border-white/10 px-4 py-2.5 text-xs font-medium text-white/60 hover:border-white/20 hover:text-white sm:min-h-0 sm:py-2"
            >
              Swap sides
            </button>
            <button
              type="button"
              onClick={resetTrade}
              data-testid="trade-reset-button"
              className="touch-manipulation min-h-[44px] rounded-xl border border-white/10 px-4 py-2.5 text-xs font-medium text-white/60 hover:border-white/20 hover:text-white sm:min-h-0 sm:py-2"
            >
              Reset
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-6 pb-24 sm:px-6 sm:py-8 lg:pb-10">
        <Link
          href="/"
          className="inline-flex min-h-[44px] touch-manipulation items-center gap-2 py-1 text-sm text-white/45 hover:text-white/75 sm:min-h-0"
        >
          <span aria-hidden>←</span>
          <span>Back to Home</span>
        </Link>

        <div className="mt-6 rounded-3xl border border-white/8 bg-[radial-gradient(circle_at_top,rgba(6,182,212,0.18),transparent_45%),#0a0d1a] p-4 sm:p-8">
          <div className="max-w-3xl">
            <div className="text-xs font-bold uppercase tracking-[0.3em] text-cyan-300/80">Premium Analysis</div>
            <h2 className="mt-3 text-2xl font-black leading-tight sm:text-4xl">
              Run the same backend trade engine through a modern visual workspace.
            </h2>
            <p className="mt-4 text-sm leading-6 text-white/60 sm:text-base">
              Planning, pricing, engine reasoning, AI synthesis, and output checks flow into one premium trade review.
            </p>
          </div>
        </div>

        <InContextMonetizationCard
          className="mt-6"
          title="Trade Analyzer access"
          featureId="trade_analyzer"
          tokenRuleCodes={["ai_trade_analyzer_full_review"]}
          testIdPrefix="trade-monetization"
        />

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <AssetPanel label="Sender · Giving" accent="#06b6d4" side={sender} onChange={setSender} onClear={() => setSender(emptySide("Sender Team"))} />
          <AssetPanel label="Receiver · Giving" accent="#a78bfa" side={receiver} onChange={setReceiver} onClear={() => setReceiver(emptySide("Receiver Team"))} />
        </div>

        {miniCompare.ready ? (
          <div
            className="mt-4 flex flex-col gap-3 rounded-2xl border border-cyan-400/20 bg-cyan-500/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            data-testid="trade-evaluator-mini-compare-panel"
          >
            <p className="text-xs text-white/70">
              <span className="font-semibold text-cyan-200">Head-to-head compare</span>
              <span className="text-white/45"> — uses the first named player on each side</span>
            </p>
            {playerCompareUi ? (
              <button
                type="button"
                onClick={() =>
                  playerCompareUi.openComparison({
                    playerA: miniCompare.a,
                    playerB: miniCompare.b,
                    sport,
                    source: "trade",
                  })
                }
                data-testid="trade-evaluator-mini-compare-open"
                className="inline-flex min-h-[48px] w-full touch-manipulation shrink-0 items-center justify-center rounded-xl border border-cyan-400/35 bg-cyan-500/12 px-4 py-3 text-sm font-medium text-cyan-100 hover:bg-cyan-500/20 sm:w-auto sm:min-h-0 sm:py-2"
              >
                Compare {miniCompare.a} vs {miniCompare.b}
              </button>
            ) : (
              <Link
                href={`/player-compare?playerA=${encodeURIComponent(miniCompare.a)}&playerB=${encodeURIComponent(miniCompare.b)}&sport=${encodeURIComponent(sport)}`}
                data-testid="trade-evaluator-mini-compare-fallback"
                className="inline-flex shrink-0 text-sm font-medium text-cyan-300 underline hover:text-cyan-100"
              >
                Open compare ({miniCompare.a} vs {miniCompare.b})
              </Link>
            )}
          </div>
        ) : null}

        <div className="mt-6 rounded-3xl border border-white/8 bg-[#0c0c1e] p-5 sm:p-6">
          <div className="mb-4 text-xs font-bold uppercase tracking-[0.28em] text-white/45">League Settings</div>
          <div className="mb-4 max-w-xl">
            <GradeLeaguePicker options={gradeLeagues} value={linkedLeagueId} onChange={chooseGradeLeague} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <label className="block">
              <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.24em] text-white/45">Format</span>
              <select
                value={format}
                onChange={(event) => setFormat(event.target.value as LeagueFormat)}
                className="min-h-[44px] w-full rounded-xl border border-white/10 bg-[#101224] px-3 py-3 text-base text-white focus:border-cyan-500/40 focus:outline-none sm:min-h-0 sm:text-sm"
              >
                {FORMAT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.24em] text-white/45">QB Format</span>
              <select
                value={qbFormat}
                onChange={(event) => setQbFormat(event.target.value as QBFormat)}
                className="min-h-[44px] w-full rounded-xl border border-white/10 bg-[#101224] px-3 py-3 text-base text-white focus:border-cyan-500/40 focus:outline-none sm:min-h-0 sm:text-sm"
              >
                {QB_FORMAT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.24em] text-white/45">Sport</span>
              {/*
                A stable hook for the trade e2e suite. It previously reached this
                control through DOM shape — `label:has-text("Sport") + select` —
                which matched nothing, because the select is a CHILD of the label
                and not its sibling. That selector returned an empty list and the
                assertion failed on an empty array rather than on anything real.
              */}
              <select
                data-testid="trade-sport-select"
                value={sport}
                onChange={(event) => setSport(normalizeToSupportedSport(event.target.value))}
                className="min-h-[44px] w-full rounded-xl border border-white/10 bg-[#101224] px-3 py-3 text-base text-white focus:border-cyan-500/40 focus:outline-none sm:min-h-0 sm:text-sm"
              >
                {/*
                  ⚠ NON-NFL SPORTS ARE OFFERED BUT NOT PICKABLE. The valuation
                  pipeline behind this page prices only NFL assets — every other
                  sport resolved each player to 0 and let the narration paper
                  over it. Disabled-with-Soon is honest; a grade built on zeros
                  is not. Re-enable per sport when its value source exists.
                */}
                {SUPPORTED_SPORTS.map((supportedSport) => (
                  <option key={supportedSport} value={supportedSport} disabled={supportedSport !== 'NFL'}>
                    {SPORT_LABELS[supportedSport]}
                    {supportedSport !== 'NFL' ? ' (Soon)' : ''}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.24em] text-white/45">Scoring</span>
              <select
                value={scoring}
                onChange={(event) => setScoring(event.target.value as ScoringFormat)}
                className="min-h-[44px] w-full rounded-xl border border-white/10 bg-[#101224] px-3 py-3 text-base text-white focus:border-cyan-500/40 focus:outline-none sm:min-h-0 sm:text-sm"
              >
                {SCORING_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.24em] text-white/45">As Of Date</span>
              <input
                type="date"
                value={asOfDate}
                onChange={(event) => setAsOfDate(event.target.value)}
                className="min-h-[44px] w-full rounded-xl border border-white/10 bg-[#101224] px-3 py-3 text-base text-white focus:border-cyan-500/40 focus:outline-none [color-scheme:dark] sm:min-h-0 sm:text-sm"
              />
            </label>
          </div>
        </div>

        <div className="mt-6 flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={() => void evaluate()}
            disabled={!canEvaluate}
            data-testid="trade-evaluate-button"
            className="w-full max-w-xl touch-manipulation rounded-2xl px-6 py-4 text-base font-black tracking-wide text-white transition-all disabled:cursor-not-allowed disabled:opacity-40"
            style={{
              background: canEvaluate ? "linear-gradient(135deg, #0891b2, #7c3aed)" : "rgba(255,255,255,0.05)",
              boxShadow: canEvaluate ? "0 10px 32px rgba(8,145,178,0.28)" : "none",
            }}
          >
            {loading ? "Analyzing Trade..." : "Evaluate Trade"}
          </button>
          {!senderHasAssets || !receiverHasAssets ? (
            <p className="text-xs text-white/35">Add at least one player, pick, or FAAB on both sides to enable analysis.</p>
          ) : null}
        </div>

        {canEvaluate ? (
          <TradeSimulationStrip
            senderTeamName={sender.teamName.trim() || "Sender Team"}
            receiverTeamName={receiver.teamName.trim() || "Receiver Team"}
            senderPlayers={sender.players}
            receiverPlayers={receiver.players}
            leagueSize={12}
            groundedLeagueId={linkedLeagueId || undefined}
          />
        ) : null}

        {error ? (
          <div className="mt-6 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="mt-8">
            <LoadingState phase={phase} />
          </div>
        ) : null}

        {!loading && result ? (
          <div ref={resultRef} className="mt-8 space-y-6">
            <div className="grid gap-6 xl:grid-cols-[300px_minmax(0,1fr)]">
              <div className="space-y-4">
                <ResultBadge verdict={result.verdict} />

                {/*
                  Both IDP qualifiers sit with the verdict, because the verdict is what they
                  qualify. They are deliberately NOT in `result.warnings`: that list is veto
                  reasons, expert flags and risk flags — things wrong with the TRADE — and the
                  ceiling caveat is a statement about the limits of OUR OWN pricing.
                */}
                <IdpTradeLineupWarning idpLineupWarning={result.idpLineupWarning} />

                {result.idpCeilingCaveat ? (
                  <div
                    data-testid="idp-ceiling-caveat"
                    className="rounded-2xl border border-sky-400/25 bg-sky-500/[0.07] p-4 text-sm text-sky-100/90"
                  >
                    <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-sky-300/70">
                      Close call — rests on our IDP rate
                    </div>
                    <p className="mt-2 leading-relaxed text-sky-100/80">{result.idpCeilingCaveat.note}</p>
                    <div className="mt-3 flex items-center gap-2 text-[11px] text-sky-200/70">
                      <span className="rounded-md border border-sky-400/25 bg-sky-500/10 px-2 py-1 font-semibold tabular-nums">
                        {Math.min(result.idpCeilingCaveat.lowFairness, result.idpCeilingCaveat.highFairness)}
                        {" – "}
                        {Math.max(result.idpCeilingCaveat.lowFairness, result.idpCeilingCaveat.highFairness)}
                      </span>
                      <span>fairness range across a defensible ceiling</span>
                    </div>
                  </div>
                ) : null}

                {result.historicalNote ? (
                  <p data-testid="historical-note" className="rounded-xl border border-amber-300/20 bg-amber-300/[0.06] px-3 py-2 text-[12px] text-amber-100/80">
                    {result.historicalNote}
                  </p>
                ) : null}

                {result.live ? (
                  result.receiptTotals ? (
                    <div data-testid="receipt-totals" className="rounded-2xl border border-white/8 bg-[#0c0c1e] p-4">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/40">League value</div>
                      <div className="mt-4 grid grid-cols-3 gap-3">
                        <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3 text-center">
                          <div className="text-2xl font-black text-white">{result.receiptTotals.send.toLocaleString()}</div>
                          <div className="mt-1 text-[10px] text-white/35">Sender gives</div>
                        </div>
                        <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3 text-center">
                          <div className="text-2xl font-black text-white">{result.receiptTotals.get.toLocaleString()}</div>
                          <div className="mt-1 text-[10px] text-white/35">Sender gets</div>
                        </div>
                        <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3 text-center">
                          <div className={`text-2xl font-black ${result.receiptTotals.gapPct >= 0 ? "text-emerald-300" : "text-red-300"}`}>
                            {result.receiptTotals.gapPct > 0 ? "+" : ""}
                            {result.receiptTotals.gapPct}%
                          </div>
                          <div className="mt-1 text-[10px] text-white/35">Gap</div>
                        </div>
                      </div>
                    </div>
                  ) : null
                ) : (
                  <div className="rounded-2xl border border-white/8 bg-[#0c0c1e] p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/40">Score Cards</div>
                    <div className="mt-4 grid grid-cols-3 gap-3">
                      <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3 text-center">
                        <div className="text-2xl font-black text-white">{result.fairnessScore ?? "—"}</div>
                        <div className="mt-1 text-[10px] text-white/35">Fairness</div>
                      </div>
                      <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3 text-center">
                        <div className={`text-2xl font-black ${(result.valueDelta ?? 0) >= 0 ? "text-emerald-300" : "text-red-300"}`}>
                          {(result.valueDelta ?? 0) > 0 ? "+" : ""}
                          {result.valueDelta == null ? "—" : Math.round(result.valueDelta)}
                        </div>
                        <div className="mt-1 text-[10px] text-white/35">Value Delta</div>
                      </div>
                      <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3 text-center">
                        <div className="text-2xl font-black text-white">{result.confidencePct == null ? "—" : `${result.confidencePct}%`}</div>
                        <div className="mt-1 text-[10px] text-white/35">Confidence</div>
                      </div>
                    </div>
                  </div>
                )}

                <div className="rounded-2xl border border-white/8 bg-[#0c0c1e] p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/40">Grades</div>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 p-4 text-center">
                      <div className="text-3xl font-black text-cyan-200">{result.senderGrade ?? '—'}</div>
                      <div className="mt-1 text-[10px] uppercase tracking-[0.24em] text-cyan-100/70">Sender</div>
                    </div>
                    <div className="rounded-xl border border-fuchsia-500/20 bg-fuchsia-500/10 p-4 text-center">
                      <div className="text-3xl font-black text-fuchsia-200">{result.receiverGrade ?? '—'}</div>
                      <div className="mt-1 text-[10px] uppercase tracking-[0.24em] text-fuchsia-100/70">Receiver</div>
                    </div>
                  </div>
                  {result.gradeWithheld && (
                    <div data-testid="trade-grade-withheld" className="mt-3 text-xs text-amber-200/90">
                      Not graded. {result.gradeWithheld}
                      {!result.gradedLeagueId ? (
                        <span data-testid="trade-grade-no-league-hint" className="mt-1 block text-white/60">
                          {noLeagueGradeHint(gradeLeagues.length)}
                        </span>
                      ) : null}
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border border-white/8 bg-[#0c0c1e] p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/40">Providers</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {result.providers.map((provider) => (
                      <span key={provider} className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/70">
                        {provider}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <div className="space-y-6">
                <div className="rounded-3xl border border-white/8 bg-[#0c0c1e] p-6">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.24em] text-cyan-300">
                      AI Analysis
                    </span>
                    {result.fairnessMethod ? (
                      <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.24em] text-white/45">
                        {result.fairnessMethod}
                      </span>
                    ) : null}
                    {typeof result.pECRIterations === "number" && result.pECRIterations > 1 ? (
                      <span className="ml-auto rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.24em] text-white/50">
                        {result.pECRIterations} PECR iterations
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-4 text-base leading-7 text-white/80">{result.recommendation}</p>
                  {result.aiSummary ? <p className="mt-3 text-sm leading-6 text-white/60">{result.aiSummary}</p> : null}
                  {result.analysisBullets.length > 0 ? (
                    <ul className="mt-4 space-y-2">
                      {result.analysisBullets.map((bullet, index) => (
                        <li key={`${bullet}-${index}`} className="flex gap-3 text-sm leading-6 text-white/60">
                          <span className="mt-2 h-1.5 w-1.5 rounded-full bg-cyan-400" />
                          <span>{bullet}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>

                {result.labels.length > 0 ? (
                  <div className="rounded-2xl border border-white/8 bg-[#0c0c1e] p-5">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/40">Trade Signals</div>
                    <div className="mt-4 flex flex-wrap gap-3">
                      {result.labels.map((label) => (
                        <div
                          key={label.id}
                          className={`rounded-2xl border px-3 py-2 ${
                            label.kind === "positive"
                              ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-200"
                              : "border-amber-400/20 bg-amber-500/10 text-amber-200"
                          }`}
                          title={label.description}
                        >
                          <div className="text-xs font-semibold">
                            {label.emoji} {label.name}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {result.drivers.length > 0 ? (
                  <div className="rounded-2xl border border-white/8 bg-[#0c0c1e] p-5">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/40">Trade Drivers</div>
                    <div className="mt-4 space-y-3">
                      {result.drivers.map((driver) => (
                        <div key={driver.id} className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                          <div className="flex items-center gap-3">
                            <div
                              className={`h-2.5 w-2.5 rounded-full ${
                                driver.direction === "positive"
                                  ? "bg-emerald-400"
                                  : driver.direction === "negative"
                                    ? "bg-red-400"
                                    : "bg-amber-400"
                              }`}
                            />
                            <div className="text-sm font-semibold text-white">{driver.label}</div>
                            <div className="ml-auto text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">{driver.strength}</div>
                          </div>
                          <p className="mt-2 text-sm leading-6 text-white/55">{driver.detail}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {result.counterOffer && (result.verdict === "DECLINE" || result.verdict === "SMASH DECLINE" || result.verdict === "LEAN DECLINE") ? (
                  <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-5">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-amber-300">Counter-Offer</div>
                    <p className="mt-3 text-sm leading-6 text-white/75">{result.counterOffer}</p>
                  </div>
                ) : null}

                {result.negotiationSteps.length > 0 ? (
                  <div className="rounded-2xl border border-white/8 bg-[#0c0c1e] p-5">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/40">Negotiation Playbook</div>
                    <ol className="mt-4 space-y-3">
                      {result.negotiationSteps.map((step, index) => (
                        <li key={`${step}-${index}`} className="flex gap-3 text-sm leading-6 text-white/65">
                          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-[11px] font-bold text-white/50">
                            {index + 1}
                          </span>
                          <span>{step}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                ) : null}

                {result.betterAlternatives.length > 0 ? (
                  <div className="rounded-2xl border border-white/8 bg-[#0c0c1e] p-5">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/40">Better Alternatives</div>
                    <div className="mt-4 space-y-3">
                      {result.betterAlternatives.map((alternative) => (
                        <div key={`${alternative.teamId}-${alternative.tradeFramework}`} className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm font-semibold text-white">{alternative.teamId}</div>
                            <div className="text-xs text-cyan-200">Fit {alternative.fitScore}</div>
                          </div>
                          <p className="mt-2 text-sm leading-6 text-white/60">{alternative.whyBetter}</p>
                          <p className="mt-2 text-xs uppercase tracking-[0.2em] text-white/35">{alternative.tradeFramework}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {result.warnings.length > 0 ? (
                  <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-5">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-red-200">Warnings</div>
                    <ul className="mt-4 space-y-2">
                      {result.warnings.map((warning, index) => (
                        <li key={`${warning}-${index}`} className="flex gap-3 text-sm leading-6 text-red-100/85">
                          <span className="mt-2 h-1.5 w-1.5 rounded-full bg-red-300" />
                          <span>{warning}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {!loading && !result && !error ? (
          <div className="mt-8 rounded-3xl border border-dashed border-white/12 bg-white/[0.02] p-8 text-center">
            <h3 className="text-lg font-semibold text-white/85">Build both sides and evaluate the trade</h3>
            <p className="mt-2 text-sm text-white/45">
              Add players, picks, or FAAB to each side. The analyzer will keep the same backend route and surface the structured results in this new UI.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default function TradeEvaluatorPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#07071a]" />}>
      <TradeHubInner />
    </Suspense>
  )
}

