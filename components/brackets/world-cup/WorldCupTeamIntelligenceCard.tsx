"use client"

import { useState } from "react"
import { ChevronDown, ChevronUp, Info } from "lucide-react"
import type { WorldCupTeamIntelligenceReport } from "@/lib/world-cup/worldCupTeamIntelligenceService"

// ── Types ─────────────────────────────────────────────────────────────────────

type Props = {
  report: WorldCupTeamIntelligenceReport
  onClose?: () => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function WorldCupTeamIntelligenceCard({ report, onClose }: Props) {
  const [showMissing, setShowMissing] = useState(false)

  const formParts = report.recentForm.map((f) => {
    const cls =
      f.result === "W"
        ? "text-emerald-300 font-black"
        : f.result === "L"
          ? "text-rose-300/80 font-black"
          : "text-white/60 font-semibold"
    return (
      <span key={`${f.opponent}-${f.startsAt}`} className={`${cls} text-[11px]`} title={`${f.result} vs ${f.opponent} ${f.score}`}>
        {f.result}
      </span>
    )
  })

  return (
    <div
      data-testid="world-cup-team-intelligence-card"
      className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
    >
      {/* Header */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {report.flagUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={report.flagUrl}
              alt={`${report.teamName} flag`}
              className="h-5 w-7 rounded-sm object-cover"
            />
          ) : (
            <Info className="h-4 w-4 text-white/40" aria-hidden />
          )}
          <h3 className="text-sm font-black text-white">{report.teamName}</h3>
          {report.fifaCode && (
            <span className="rounded bg-white/[0.07] px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-white/50">
              {report.fifaCode}
            </span>
          )}
        </div>
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Close team intelligence"
            className="rounded-lg p-1 text-white/40 hover:bg-white/[0.07] hover:text-white/80 transition-colors"
          >
            <ChevronUp className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Key facts row */}
      <div className="mb-3 flex flex-wrap gap-1.5 text-[11px]">
        {report.groupName && (
          <span className="rounded bg-white/[0.06] px-2 py-1 text-white/60">
            Group {report.groupName}
          </span>
        )}
        {report.confederation && (
          <span className="rounded bg-white/[0.06] px-2 py-1 text-white/60">
            {report.confederation}
          </span>
        )}
        {report.fifaRank && (
          <span className="rounded bg-white/[0.06] px-2 py-1 text-white/60">
            FIFA #{report.fifaRank}
          </span>
        )}
        {report.qualificationStatus && report.qualificationStatus !== "tbd" && (
          <span className="rounded bg-white/[0.06] px-2 py-1 text-white/50 capitalize">
            {report.qualificationStatus.replace(/_/g, " ")}
          </span>
        )}
      </div>

      {/* Group standing */}
      {report.groupStanding && (
        <div
          data-testid="team-intel-standing"
          className="mb-3 rounded-xl border border-white/[0.07] bg-white/[0.04] px-3 py-2"
        >
          <p className="mb-1.5 text-[11px] font-black uppercase tracking-widest text-white/35">
            Group {report.groupStanding.groupName} Standing
          </p>
          <div className="grid grid-cols-4 gap-1 text-center">
            <StatPill label="Pts" value={String(report.groupStanding.points)} />
            <StatPill label="W-D-L" value={`${report.groupStanding.wins}-${report.groupStanding.draws}-${report.groupStanding.losses}`} />
            <StatPill label="GD" value={report.groupStanding.goalDifference >= 0 ? `+${report.groupStanding.goalDifference}` : String(report.groupStanding.goalDifference)} />
            <StatPill label="Rank" value={report.groupStanding.rank ? `#${report.groupStanding.rank}` : "—"} />
          </div>
          {report.groupStanding.isThirdPlaceAdvancer && (
            <p className="mt-1.5 text-[11px] text-amber-300/80">3rd-place advancer</p>
          )}
        </div>
      )}

      {/* Captain + key players */}
      {(report.captain || (report.keyPlayers && report.keyPlayers.length > 0)) && (
        <div data-testid="team-intel-roster" className="mb-3 rounded-xl border border-white/[0.07] bg-white/[0.04] px-3 py-2">
          <p className="mb-1.5 text-[11px] font-black uppercase tracking-widest text-white/35">
            Squad
          </p>
          {report.captain && (
            <p className="mb-1 text-[11px] text-white/70">
              <span className="text-white/40 text-[11px] uppercase tracking-widest mr-1.5">Captain</span>
              {report.captain}
            </p>
          )}
          {report.injuryNotes && (
            <p className="mb-1 text-[11px] text-amber-300/70">
              <span className="text-white/40 text-[11px] uppercase tracking-widest mr-1.5">Injuries</span>
              {report.injuryNotes}
            </p>
          )}
          {report.suspensionNotes && (
            <p className="mb-1 text-[11px] text-rose-300/70">
              <span className="text-white/40 text-[11px] uppercase tracking-widest mr-1.5">Suspended</span>
              {report.suspensionNotes}
            </p>
          )}
          {report.keyPlayers && report.keyPlayers.length > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-widest text-white/35 mb-0.5">Key Players</p>
              <p className="text-[11px] text-white/60">{report.keyPlayers.slice(0, 6).join(" · ")}</p>
            </div>
          )}
        </div>
      )}

      {/* Recent form */}
      {report.recentForm.length > 0 && (
        <div data-testid="team-intel-form" className="mb-3">
          <p className="mb-1 text-[11px] font-black uppercase tracking-widest text-white/35">
            Recent Form (last {report.recentForm.length})
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            {formParts}
            <span className="text-[11px] text-white/30 ml-1">
              {report.recentForm
                .slice(0, 3)
                .map((f) => `${f.result} ${f.score} vs ${f.opponent}`)
                .join(" · ")}
            </span>
          </div>
        </div>
      )}

      {/* Missing data */}
      <div className="mt-2">
        <button
          onClick={() => setShowMissing((v) => !v)}
          data-testid="team-intel-missing-toggle"
          className="flex items-center gap-1 text-[11px] text-white/35 hover:text-white/55 transition-colors"
          aria-expanded={showMissing}
        >
          {showMissing ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
          {showMissing ? "Hide" : "What data is not loaded?"}
        </button>
        {showMissing && (
          <div
            data-testid="team-intel-missing-list"
            className="mt-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2 text-[11px] text-white/40"
          >
            <p className="mb-1 font-semibold text-white/50">Not loaded for this team:</p>
            <ul className="space-y-0.5 list-disc list-inside">
              {report.missingData.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <p className="mt-1.5 text-white/30 text-[11px]">{report.dataSourceLabel}</p>
          </div>
        )}
      </div>
    </div>
  )
}

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-white/[0.04] px-1.5 py-1">
      <p className="text-[11px] font-black uppercase tracking-widest text-white/30">{label}</p>
      <p className="text-[11px] font-bold text-white/80">{value}</p>
    </div>
  )
}
