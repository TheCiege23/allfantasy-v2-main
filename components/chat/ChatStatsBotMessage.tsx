"use client"

import { BarChart2 } from "lucide-react"
import type { ChatStatsBotUpdate } from "@/types/chat"

type Props = {
  update: ChatStatsBotUpdate
  compact?: boolean
}

export default function ChatStatsBotMessage({ update, compact }: Props) {
  return (
    <article
      className="rounded-xl border px-3 py-2.5 text-xs"
      style={{
        borderColor: "var(--border)",
        background: "color-mix(in srgb, var(--accent-cyan-strong) 6%, var(--panel))",
      }}
    >
      <div className="flex items-center gap-2" style={{ color: "var(--muted2)" }}>
        <BarChart2 className="h-3.5 w-3.5" style={{ color: "var(--accent-cyan-strong)" }} />
        <span className="font-semibold" style={{ color: "var(--text)" }}>
          Chat Stats Bot
        </span>
        <span className="text-[11px]">{update.weekLabel}</span>
      </div>
      {compact ? (
        <p className="mt-1 text-[11px]" style={{ color: "var(--muted2)" }}>
          Best: {update.bestTeam} · Worst: {update.worstTeam} · Top player: {update.bestPlayer}
        </p>
      ) : (
        <ul className="mt-2 space-y-1 text-[11px]" style={{ color: "var(--muted2)" }}>
          <li>🏆 Best Team: {update.bestTeam}</li>
          <li>📉 Worst Team: {update.worstTeam}</li>
          <li>⭐ Best Player: {update.bestPlayer}</li>
          <li>🔥 Win Streak: {update.winStreak}</li>
          <li>❄️ Loss Streak: {update.lossStreak}</li>
        </ul>
      )}
    </article>
  )
}

export function placeholderStatsBotUpdate(leagueId: string): ChatStatsBotUpdate {
  return {
    id: `stats-${leagueId}-${Date.now()}`,
    type: "stats_bot",
    leagueId,
    weekLabel: "Week 12",
    bestTeam: "Rival GM (9-3)",
    worstTeam: "Taco Corp (2-10)",
    bestPlayer: "Josh Allen, Team A",
    winStreak: "Stacked Contender — 4W",
    lossStreak: "Rebuilder — 3L",
    createdAt: new Date().toISOString(),
  }
}
