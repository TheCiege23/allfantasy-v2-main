"use client"

import { useEffect, useState } from "react"
import { useUserTimezone } from "@/hooks/useUserTimezone"

type TradeHistoryEntry = {
  id: string
  createdAt: string
  status: "accepted" | "rejected" | "pending"
  summary: string
}

export function TradeHistory({ leagueId }: { leagueId?: string }) {
  const [items, setItems] = useState<TradeHistoryEntry[]>([])

  useEffect(() => {
    // Placeholder: later load from /api/trades/history?leagueId=...
    setItems([
      {
        id: "t1",
        createdAt: new Date().toISOString(),
        status: "accepted",
        summary: "You sent Garrett Wilson; received Brandon Aiyuk + 2025 2nd.",
      },
      {
        id: "t2",
        createdAt: new Date(Date.now() - 86_400_000).toISOString(),
        status: "rejected",
        summary: "You offered Travis Kelce for 2025 1st + George Pickens.",
      },
      {
        id: "t3",
        createdAt: new Date(Date.now() - 3_600_000).toISOString(),
        status: "pending",
        summary: "Pending: you send Rachaad White; receive 2025 1st.",
      },
    ])
  }, [leagueId])

  const grouped = {
    accepted: items.filter((i) => i.status === "accepted"),
    rejected: items.filter((i) => i.status === "rejected"),
    pending: items.filter((i) => i.status === "pending"),
  }

  return (
    <section className="space-y-2 rounded-2xl border border-white/10 bg-black/20 p-3 text-xs text-white/80">
      <header className="mb-1 flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-white">Trade History</p>
          <p className="text-[11px] text-white/65">
            Accepted, rejected, and pending offers (placeholder feed wired for API later).
          </p>
        </div>
      </header>
      <div className="grid gap-2 md:grid-cols-3">
        <HistoryColumn title="Accepted" items={grouped.accepted} tone="accepted" />
        <HistoryColumn title="Rejected" items={grouped.rejected} tone="rejected" />
        <HistoryColumn title="Pending" items={grouped.pending} tone="pending" />
      </div>
    </section>
  )
}

function HistoryColumn({
  title,
  items,
  tone,
}: {
  title: string
  items: TradeHistoryEntry[]
  tone: "accepted" | "rejected" | "pending"
}) {
  const { formatInTimezone } = useUserTimezone()
  const toneClass =
    tone === "accepted"
      ? "border-emerald-400/40 text-emerald-200"
      : tone === "rejected"
      ? "border-red-400/45 text-red-200"
      : "border-amber-300/40 text-amber-200"

  return (
    <div className="space-y-1.5 rounded-xl border border-white/12 bg-black/40 p-2.5">
      <p className="text-[11px] font-semibold text-white/80">{title}</p>
      {items.length === 0 ? (
        <p className="text-[11px] text-white/50">No {title.toLowerCase()} trades yet.</p>
      ) : (
        <ul className="space-y-1.5 text-[11px]">
          {items.map((i) => (
            <li
              key={i.id}
              className="rounded-lg border border-white/12 bg-black/50 px-2 py-1.5"
            >
              <p className={`mb-0.5 font-medium ${toneClass}`}>{formatInTimezone(i.createdAt)}</p>
              <p className="text-white/80">{i.summary}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

