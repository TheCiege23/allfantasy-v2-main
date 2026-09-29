"use client"

import { useState, useEffect, useMemo } from "react"
import { Target, Shield, ChevronDown } from "lucide-react"
import { ChimmyFreshnessChip } from "./ChimmyFreshnessChip"
import type {
  WorldCupMatchView,
  WorldCupPickView,
  WorldCupScoringValues,
  WorldCupLeaderboardRow,
} from "@/lib/world-cup/types"
import { WORLD_CUP_ROUNDS } from "@/lib/world-cup/types"
import type { WorldCupDataTrustReport } from "@/lib/world-cup/worldCupDataTrustService"
import type { WorldCupTeamIntelligenceReport } from "@/lib/world-cup/worldCupTeamIntelligenceService"

// ── Helpers ───────────────────────────────────────────────────────────────────

const ROUND_POINTS_KEY: Record<string, keyof WorldCupScoringValues> = {
  round_of_32: "roundOf32Points",
  round_of_16: "roundOf16Points",
  quarterfinal: "quarterFinalPoints",
  semifinal: "semiFinalPoints",
  third_place: "thirdPlacePoints",
  final: "finalPoints",
}

const ROUND_LABEL: Record<string, string> = {
  round_of_32: "Round of 32",
  round_of_16: "Round of 16",
  quarterfinal: "Quarterfinal",
  semifinal: "Semifinal",
  third_place: "Third Place",
  final: "Final",
}

function pointsForRound(round: string, scoring: WorldCupScoringValues): number {
  const key = ROUND_POINTS_KEY[round]
  if (!key) return 0
  const val = scoring[key]
  return typeof val === "number" && val > 0 ? val : 0
}

function roundOrder(round: string): number {
  return (WORLD_CUP_ROUNDS as readonly string[]).indexOf(round)
}

function formatSyncAgo(iso: string | null | undefined): string | null {
  if (!iso) return null
  const ageMs = Date.now() - new Date(iso).getTime()
  if (ageMs < 0) return null
  const m = Math.floor(ageMs / 60_000)
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} hr ago`
  return `${Math.floor(h / 24)}d ago`
}

function buildTrustChip(
  dt: WorldCupDataTrustReport | null
): { tier: string; label: string } | null {
  if (!dt) return null
  switch (dt.dataFreshness) {
    case "live": {
      const ago = formatSyncAgo(dt.lastScoreSyncAt)
      return { tier: "live", label: ago ? `Live · synced ${ago}` : "Live scores active" }
    }
    case "cached": {
      const ago = formatSyncAgo(dt.lastFixtureSyncAt)
      return { tier: "cached", label: ago ? `Cached · synced ${ago}` : "Updated within 24 hrs" }
    }
    case "schedule_only":
      return { tier: "schedule_only", label: "Schedule only" }
    case "pool_only":
      return { tier: "pool_only", label: "Pool data only" }
    default:
      return { tier: "none", label: "No data loaded" }
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

type MatchImpact = {
  matchId: string
  round: string
  matchLabel: string
  roundLabel: string
  homeTeamName: string
  awayTeamName: string
  rootFor: string
  worstResult: string
  pointsAtStake: number
  isChampionMatch: boolean
  championName: string | null
}

export type WorldCupMatchImpactCenterProps = {
  challengeId: string
  picks: WorldCupPickView[]
  matches: WorldCupMatchView[]
  scoring: WorldCupScoringValues
  userLeaderboardRow: WorldCupLeaderboardRow | null
  /** Total pool participant count — shown for context ("X people in this pool"). */
  poolParticipantCount?: number
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function WorldCupMatchImpactCenter({
  challengeId,
  picks,
  matches,
  scoring,
  userLeaderboardRow,
  poolParticipantCount,
}: WorldCupMatchImpactCenterProps) {
  const [dataTrust, setDataTrust] = useState<WorldCupDataTrustReport | null>(null)
  const [teamIntel, setTeamIntel] = useState<WorldCupTeamIntelligenceReport | null>(null)
  const [teamIntelTeamId, setTeamIntelTeamId] = useState<string | null>(null)
  const [teamIntelLoading, setTeamIntelLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/brackets/world-cup/${challengeId}/data-trust`)
      .then((res) => (res.ok ? (res.json() as Promise<{ report?: WorldCupDataTrustReport }>) : null))
      .then((data) => {
        if (!cancelled && data?.report) setDataTrust(data.report)
      })
      .catch(() => null)
    return () => {
      cancelled = true
    }
  }, [challengeId])

  function handleTeamInsight(teamId: string) {
    if (teamIntelTeamId === teamId) {
      setTeamIntel(null)
      setTeamIntelTeamId(null)
      return
    }
    setTeamIntelLoading(true)
    setTeamIntelTeamId(teamId)
    fetch(`/api/brackets/world-cup/${challengeId}/teams/${teamId}/intelligence`)
      .then((res) =>
        res.ok ? (res.json() as Promise<{ report?: WorldCupTeamIntelligenceReport }>) : null
      )
      .then((data) => {
        setTeamIntel(data?.report ?? null)
      })
      .catch(() => setTeamIntel(null))
      .finally(() => setTeamIntelLoading(false))
  }

  const topImpact = useMemo<MatchImpact | null>(() => {
    const active = matches.filter(
      (m) =>
        (m.status === "scheduled" || m.status === "live" || m.status === "halftime") &&
        m.homeTeamId !== null &&
        m.awayTeamId !== null
    )

    const championTeamId = userLeaderboardRow?.championTeamId ?? null
    const championPickName = userLeaderboardRow?.championPickName ?? null

    const candidates: MatchImpact[] = []

    for (const match of active) {
      const pick = picks.find((p) => p.matchId === match.id)
      if (!pick?.selectedTeamId) continue

      const rootFor =
        pick.selectedTeamId === match.homeTeamId
          ? match.homeTeamName
          : pick.selectedTeamId === match.awayTeamId
            ? match.awayTeamName
            : null
      if (!rootFor) continue

      const pts = pointsForRound(match.round, scoring)
      if (pts <= 0) continue

      const worstResult =
        rootFor === match.homeTeamName ? match.awayTeamName : match.homeTeamName

      const isChampionMatch = Boolean(
        championTeamId &&
          (match.homeTeamId === championTeamId || match.awayTeamId === championTeamId)
      )

      candidates.push({
        matchId: match.id,
        round: match.round,
        matchLabel: `${match.homeTeamName} vs ${match.awayTeamName}`,
        roundLabel: ROUND_LABEL[match.round] ?? match.round,
        homeTeamName: match.homeTeamName,
        awayTeamName: match.awayTeamName,
        rootFor,
        worstResult,
        pointsAtStake: pts,
        isChampionMatch,
        championName: isChampionMatch ? championPickName : null,
      })
    }

    candidates.sort((a, b) => {
      // Finals/semis first
      const roundDiff = roundOrder(b.round) - roundOrder(a.round)
      if (roundDiff !== 0) return roundDiff
      // Champion match takes priority at same round
      if (a.isChampionMatch !== b.isChampionMatch) return b.isChampionMatch ? 1 : -1
      return b.pointsAtStake - a.pointsAtStake
    })

    return candidates[0] ?? null
  }, [picks, matches, scoring, userLeaderboardRow])

  if (!topImpact) return null

  const trustChip = buildTrustChip(dataTrust)

  return (
    <section
      data-testid="world-cup-match-impact-center"
      className="mx-auto max-w-5xl rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5"
    >
      {/* Header */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 shrink-0 text-amber-300/70" aria-hidden />
          <h3 className="text-sm font-black text-white">Why This Match Matters</h3>
        </div>
        {trustChip && (
          <ChimmyFreshnessChip tier={trustChip.tier} label={trustChip.label} />
        )}
      </div>

      {/* Match title */}
      <div
        className="mb-4 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-3"
        data-testid="match-impact-match-title"
      >
        <p className="text-sm font-black text-white/95">{topImpact.matchLabel}</p>
        <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-widest text-white/40">
          {topImpact.roundLabel}
        </p>
      </div>

      {/* Impact grid */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <ImpactCell
          label="Root for"
          value={topImpact.rootFor}
          valueClass="text-emerald-300"
          testId="match-impact-root-for"
        />
        <ImpactCell
          label="Worst result"
          value={topImpact.worstResult}
          valueClass="text-rose-300/80"
          testId="match-impact-worst-result"
        />
        <ImpactCell
          label="Points at stake"
          value={`${topImpact.pointsAtStake} pts`}
          valueClass="text-amber-200/90"
          testId="match-impact-points"
        />
        {poolParticipantCount != null && poolParticipantCount > 1 && (
          <ImpactCell
            label="Pool size"
            value={`${poolParticipantCount} people`}
            valueClass="text-white/70"
          />
        )}
      </div>

      {/* Champion risk */}
      {topImpact.isChampionMatch && (
        <div
          className="mt-3 flex items-start gap-2 rounded-xl border border-amber-400/25 bg-amber-400/[0.07] px-3 py-2.5"
          data-testid="match-impact-champion-risk"
        >
          <Shield className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300/80" aria-hidden />
          <p className="text-[11px] text-amber-200/90">
            <span className="font-bold">Champion risk:</span> Your champion{" "}
            <span className="font-semibold">{topImpact.championName}</span> is playing. A loss
            ends your champion bonus points.
          </p>
        </div>
      )}

      {/* Team insight button */}
      {topImpact.rootFor && (
        <div className="mt-3 flex items-center gap-2">
          <TeamInsightButton
            label={topImpact.rootFor}
            teamId={
              picks.find(
                (p) =>
                  p.matchId === topImpact.matchId && p.selectedTeamId != null
              )?.selectedTeamId ?? null
            }
            active={
              teamIntelTeamId ===
              (picks.find(
                (p) => p.matchId === topImpact.matchId && p.selectedTeamId != null
              )?.selectedTeamId ?? null)
            }
            loading={teamIntelLoading}
            onToggle={handleTeamInsight}
          />
        </div>
      )}

      {/* Inline team intelligence card */}
      {teamIntel && !teamIntelLoading && (
        <div className="mt-3" data-testid="match-impact-team-intel">
          <TeamIntelligenceInline report={teamIntel} onClose={() => { setTeamIntel(null); setTeamIntelTeamId(null) }} />
        </div>
      )}
    </section>
  )
}

function ImpactCell({
  label,
  value,
  valueClass,
  testId,
}: {
  label: string
  value: string
  valueClass?: string
  testId?: string
}) {
  return (
    <div
      className="rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2.5"
      data-testid={testId}
    >
      <p className="text-[11px] font-black uppercase tracking-widest text-white/35">{label}</p>
      <p className={`mt-0.5 text-xs font-bold ${valueClass ?? "text-white/80"}`}>{value}</p>
    </div>
  )
}

function TeamInsightButton({
  label,
  teamId,
  active,
  loading,
  onToggle,
}: {
  label: string
  teamId: string | null
  active: boolean
  loading: boolean
  onToggle: (teamId: string) => void
}) {
  if (!teamId) return null
  return (
    <button
      onClick={() => onToggle(teamId)}
      data-testid="match-impact-team-insight-btn"
      disabled={loading}
      className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
        active
          ? "border-indigo-400/40 bg-indigo-500/15 text-indigo-200"
          : "border-white/[0.08] bg-white/[0.03] text-white/50 hover:border-white/15 hover:text-white/70"
      }`}
      aria-expanded={active}
    >
      {loading ? (
        <span className="animate-spin h-3 w-3 border border-white/30 border-t-white/80 rounded-full" />
      ) : (
        <ChevronDown
          className={`h-3 w-3 transition-transform ${active ? "rotate-180" : ""}`}
          aria-hidden
        />
      )}
      Team insight: {label}
    </button>
  )
}

function TeamIntelligenceInline({
  report,
  onClose,
}: {
  report: WorldCupTeamIntelligenceReport
  onClose: () => void
}) {
  const [showMissing, setShowMissing] = useState(false)

  const formDisplay = report.recentForm.map((f, i) => (
    <span
      key={i}
      className={`text-[11px] font-black ${
        f.result === "W"
          ? "text-emerald-300"
          : f.result === "L"
            ? "text-rose-300/80"
            : "text-white/50"
      }`}
      title={`${f.result} vs ${f.opponent} ${f.score}`}
    >
      {f.result}
    </span>
  ))

  return (
    <div
      data-testid="team-intel-inline"
      className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 py-3"
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {report.flagUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={report.flagUrl} alt="" className="h-4 w-6 rounded-sm object-cover" />
          )}
          <span className="text-[11px] font-black text-white">{report.teamName}</span>
          {report.fifaCode && (
            <span className="text-[11px] text-white/40 font-semibold">{report.fifaCode}</span>
          )}
        </div>
        <button
          onClick={onClose}
          aria-label="Close team insight"
          className="text-[11px] text-white/30 hover:text-white/60 transition-colors px-1"
        >
          Close
        </button>
      </div>

      {report.groupStanding && (
        <div data-testid="team-intel-standing" className="mb-2 flex flex-wrap gap-2 text-[11px]">
          <span className="text-white/50">
            Grp {report.groupStanding.groupName} · #{report.groupStanding.rank ?? "—"} · {report.groupStanding.points} pts
          </span>
          <span className="text-white/40">
            {report.groupStanding.wins}W-{report.groupStanding.draws}D-{report.groupStanding.losses}L
          </span>
          <span className="text-white/40">
            GD {report.groupStanding.goalDifference >= 0 ? "+" : ""}{report.groupStanding.goalDifference}
          </span>
        </div>
      )}

      {report.recentForm.length > 0 && (
        <div data-testid="team-intel-form" className="mb-2 flex items-center gap-1">
          <span className="text-[11px] text-white/35 font-semibold mr-1">Form:</span>
          {formDisplay}
        </div>
      )}

      <button
        onClick={() => setShowMissing((v) => !v)}
        className="text-[11px] text-white/30 hover:text-white/50 transition-colors"
      >
        {showMissing ? "Hide" : "What's not loaded?"}
      </button>
      {showMissing && (
        <p data-testid="team-intel-missing-list" className="mt-1 text-[11px] text-white/30">
          Not loaded: {report.missingData.join(", ")}.
        </p>
      )}
    </div>
  )
}
