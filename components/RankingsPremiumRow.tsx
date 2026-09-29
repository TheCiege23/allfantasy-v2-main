"use client"

import React, { useState } from "react"
import { MomentumSparkline } from "./MomentumSparkline"
import type { Tier, WinWindowLabel } from "@/lib/rankings-engine/premium-panels"

type HeatmapCell = {
  pos: string
  ldi: number
  trend: number
  posSample: number
  leagueSample: number
  tag: string
  topTargets: any[]
  evidence: Array<{ key: string; value: string | number }>
}

type TopDriver = {
  id: string
  polarity: string
  impact: number
  label: string
  confidence: string
}

interface RankingsPremiumRowProps {
  heatmapCells: HeatmapCell[]
  selectedTeam: any
  rankHistory: number[]
  tier: Tier
  winWindow: WinWindowLabel
  whatChanged: { rankDelta: number; topDrivers: TopDriver[] }
  onOpenTradeHub: () => void
  onGenerateOffers: () => void
}

const TIER_STYLES: Record<string, string> = {
  Contender: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
  Rising: "bg-cyan-500/15 text-cyan-400 border-cyan-500/20",
  "Playoff Threat": "bg-yellow-500/15 text-yellow-400 border-yellow-500/20",
  "Mid Pack": "bg-gray-700/50 text-gray-400 border-gray-600/30",
  Rebuilder: "bg-red-500/15 text-red-400 border-red-500/20",
  "Too Early": "bg-gray-700/30 text-gray-500 border-gray-700/30",
}

const WINDOW_STYLES: Record<string, string> = {
  "Win Now": "text-emerald-400",
  Competitive: "text-cyan-400",
  Rebuilding: "text-red-400",
  Retooling: "text-orange-400",
  Flexible: "text-gray-400",
}

function tagColor(tag: string) {
  if (tag === "HOT") return "border-red-500/40 bg-red-500/10"
  if (tag === "COLD") return "border-cyan-500/30 bg-cyan-500/10"
  if (tag === "LEARNING") return "border-yellow-500/20 bg-yellow-500/8"
  if (tag === "LOW_LEAGUE_SAMPLE") return "border-gray-700/50 bg-gray-800/30"
  return "border-gray-700 bg-gray-800/60"
}

function tagLabel(tag: string) {
  if (tag === "HOT") return { text: "HOT", cls: "text-red-400" }
  if (tag === "COLD") return { text: "COLD", cls: "text-cyan-400" }
  if (tag === "LEARNING") return { text: "LEARNING", cls: "text-yellow-400" }
  if (tag === "LOW_LEAGUE_SAMPLE") return { text: "LOW SAMPLE", cls: "text-gray-500" }
  return { text: "NEUTRAL", cls: "text-gray-400" }
}

export function RankingsPremiumRow(props: RankingsPremiumRowProps) {
  const [drawerPos, setDrawerPos] = useState<string | null>(null)
  const drawerCell = drawerPos ? props.heatmapCells.find((c) => c.pos === drawerPos) : null

  return (
    <div className="rounded-2xl bg-gray-950 border border-gray-800 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <h2 className="text-lg font-bold text-white">Premium Insights</h2>
        {props.selectedTeam && (
          <span className="text-xs text-gray-500">{props.selectedTeam.teamName ?? `Roster ${props.selectedTeam.rosterId}`}</span>
        )}
      </div>

      <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className={`px-2 py-1 text-xs font-semibold rounded border ${TIER_STYLES[props.tier] ?? TIER_STYLES["Mid Pack"]}`}>
              {props.tier}
            </span>
            <span className={`text-xs font-medium ${WINDOW_STYLES[props.winWindow] ?? "text-gray-400"}`}>
              {props.winWindow}
            </span>
          </div>

          {props.whatChanged.rankDelta !== 0 && (
            <div className="text-sm text-gray-300">
              <span className={props.whatChanged.rankDelta < 0 ? "text-green-400" : "text-red-400"}>
                {props.whatChanged.rankDelta < 0 ? "▲" : "▼"} {Math.abs(props.whatChanged.rankDelta)} spots
              </span>
              {props.whatChanged.topDrivers.length > 0 && (
                <span className="text-gray-500 ml-2">
                  driven by {props.whatChanged.topDrivers.map((d) => d.label.replace(/_/g, " ")).join(", ")}
                </span>
              )}
            </div>
          )}

          {props.rankHistory.length >= 2 && (
            <div>
              <div className="text-[11px] text-gray-500 uppercase tracking-wider mb-1">Rank Trend</div>
              <MomentumSparkline ranks={props.rankHistory} width={200} height={40} />
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button
              onClick={props.onOpenTradeHub}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-cyan-500/15 text-cyan-400 hover:bg-cyan-500/25 transition-colors border border-cyan-500/20"
            >
              Open Trade Hub
            </button>
            <button
              onClick={props.onGenerateOffers}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white/5 text-gray-300 hover:bg-white/10 transition-colors border border-white/10"
            >
              Generate Offers
            </button>
          </div>
        </div>

        <div>
          <div className="text-[11px] text-gray-500 uppercase tracking-wider mb-2">League Demand</div>
          <div className="grid grid-cols-2 gap-2">
            {props.heatmapCells.map((cell) => {
              const tl = tagLabel(cell.tag)
              return (
                <button
                  key={cell.pos}
                  onClick={() => setDrawerPos(drawerPos === cell.pos ? null : cell.pos)}
                  className={`rounded-lg border p-3 text-left transition-all ${tagColor(cell.tag)} ${
                    drawerPos === cell.pos ? "ring-2 ring-blue-500/50" : "hover:scale-[1.01]"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-gray-300">{cell.pos}</span>
                    <span className={`text-[11px] font-semibold ${tl.cls}`}>{tl.text}</span>
                  </div>
                  <div className="text-2xl font-black tracking-tight mt-1 text-white/80">{cell.ldi}</div>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {drawerCell && (
        <div className="border-t border-gray-800 px-4 py-4 space-y-3 bg-gray-900/60">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-white">{drawerCell.pos} Breakdown</h4>
            <button onClick={() => setDrawerPos(null)} className="text-xs text-gray-500 hover:text-white transition-colors">
              Close
            </button>
          </div>

          <div className="space-y-1">
            {drawerCell.evidence.map((e, i) => (
              <div key={i} className="flex items-center justify-between text-sm bg-gray-800/40 rounded px-3 py-1.5">
                <span className="text-white/40">{e.key}</span>
                <span className="text-white/70 font-medium">{e.value}</span>
              </div>
            ))}
          </div>

          {drawerCell.topTargets.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] text-white/40 uppercase tracking-wider">Top Targets</div>
              {drawerCell.topTargets.map((t: any, i: number) => (
                <div key={i} className="flex items-center justify-between bg-gray-800/40 rounded-lg px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-white font-medium">{t.name}</span>
                    <span className={`px-1.5 py-0.5 text-[11px] font-semibold rounded border ${
                      t.label === "Overpayer"
                        ? "bg-red-500/15 text-red-400 border-red-500/20"
                        : "bg-yellow-500/10 text-yellow-400 border-yellow-500/20"
                    }`}>
                      {t.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-gray-500">{t.nByPos} trades</span>
                    <span className={`font-medium ${t.meanPremiumPct > 0 ? "text-red-400" : "text-green-400"}`}>
                      {t.meanPremiumPct > 0 ? "+" : ""}{(t.meanPremiumPct * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
