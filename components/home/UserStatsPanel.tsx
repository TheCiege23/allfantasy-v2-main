"use client"

import { useMemo, useState } from "react"
import { ChevronDown, ChevronUp } from "lucide-react"

type HistoricalPoint = {
  year: number
  wins: number
  losses: number
  championships: number
}

export interface UserStatsPanelProps {
  avatarUrl?: string | null
  username?: string | null
  tierName?: string
  tierColor?: string
  totalWins?: number
  totalLosses?: number
  championships?: number
  leaguesJoined?: number
  commissionerReviews?: number
  currentRanking?: number
  history?: HistoricalPoint[]
}

export default function UserStatsPanel(props: UserStatsPanelProps) {
  // Placeholder data with sensible defaults; wired for future ranking engine input.
  const {
    avatarUrl,
    username = "Guest",
    tierName = "Rookie",
    tierColor = "var(--accent-cyan-strong)",
    totalWins = 0,
    totalLosses = 0,
    championships = 0,
    leaguesJoined = 0,
    commissionerReviews = 0,
    currentRanking = 0,
    history: historyProp,
  } = props

  const [expanded, setExpanded] = useState(false)

  const history: HistoricalPoint[] = useMemo(
    () =>
      historyProp && historyProp.length
        ? historyProp
        : [
            { year: 2022, wins: 18, losses: 10, championships: 1 },
            { year: 2023, wins: 22, losses: 8, championships: 1 },
            { year: 2024, wins: 15, losses: 9, championships: 0 },
          ],
    [historyProp],
  )

  const maxWins = Math.max(...history.map((p) => p.wins), 1)
  const maxLosses = Math.max(...history.map((p) => p.losses), 1)

  const initial = (username ?? '').charAt(0).toUpperCase()

  return (
    <section className="px-4 py-6 sm:px-6 sm:py-8">
      <div
        className="mx-auto flex max-w-6xl flex-col gap-4 rounded-2xl border p-4 sm:p-5 md:p-6"
        style={{
          borderColor: "color-mix(in srgb, var(--accent-emerald) 35%, var(--border))",
          background: "color-mix(in srgb, var(--panel) 86%, transparent)",
        }}
      >
        {/* Header: avatar + username + tier badge */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="relative h-12 w-12 sm:h-14 sm:w-14 rounded-full border flex items-center justify-center text-sm font-semibold mode-image-safe" style={{ borderColor: "var(--border)", background: "var(--panel2)" }}>
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatarUrl}
                  alt={username ?? "User avatar"}
                  className="h-full w-full rounded-full object-cover"
                />
              ) : (
                <span style={{ color: "var(--text)" }}>{initial || "A"}</span>
              )}
              <span
                className="absolute -bottom-1 -right-1 rounded-full px-2 py-0.5 text-[11px] font-semibold shadow"
                style={{
                  background: tierColor,
                  color: "var(--on-accent-bg)",
                  border: "1px solid rgba(15,23,42,0.45)",
                }}
              >
                {tierName}
              </span>
            </div>
            <div className="min-w-0">
              <div
                className="truncate text-sm font-semibold sm:text-base"
                style={{ color: "var(--text)" }}
              >
                {username}
              </div>
              <p className="mt-0.5 text-[11px] sm:text-xs" style={{ color: "var(--muted)" }}>
                Multi‑platform fantasy history and bracket performance will appear here.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-[11px] sm:text-xs">
            <div
              className="rounded-xl px-3 py-1 font-semibold"
              style={{
                background: "color-mix(in srgb, var(--accent-cyan) 15%, transparent)",
                color: "var(--accent-cyan-strong)",
              }}
            >
              Current ranking: #{currentRanking || 0}
            </div>
          </div>
        </div>

        {/* Stats grid */}
        <div className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-3 md:grid-cols-6">
          <StatItem label="Total wins" value={totalWins} />
          <StatItem label="Total losses" value={totalLosses} />
          <StatItem label="Championships" value={championships} />
          <StatItem label="Leagues joined" value={leaguesJoined} />
          <StatItem label="Commissioner reviews" value={commissionerReviews} />
          <StatItem label="Head start rank" value={currentRanking || 0} />
        </div>

        {/* Historical chart */}
        <div className="mt-3 border-t pt-3 sm:mt-4 sm:pt-4" style={{ borderColor: "var(--border)" }}>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-medium"
            style={{
              background: "color-mix(in srgb, var(--panel2) 86%, transparent)",
              color: "var(--muted2)",
            }}
          >
            {expanded ? (
              <>
                <ChevronUp className="h-3 w-3" /> Hide historical stats
              </>
            ) : (
              <>
                <ChevronDown className="h-3 w-3" /> Show historical stats
              </>
            )}
          </button>

          {expanded && (
            <div className="mt-3 space-y-2 text-[11px] sm:text-xs">
              <div className="flex justify-between text-[11px]" style={{ color: "var(--muted2)" }}>
                <span>Year</span>
                <span>Wins / Losses / Titles</span>
              </div>
              <div className="space-y-1.5">
                {history.map((point) => {
                  const winWidth = `${Math.max(4, (point.wins / maxWins) * 100)}%`
                  const lossWidth = `${Math.max(4, (point.losses / maxLosses) * 100)}%`
                  return (
                    <div key={point.year} className="space-y-0.5">
                      <div className="flex items-center justify-between">
                        <span style={{ color: "var(--text)" }}>{point.year}</span>
                        <span style={{ color: "var(--muted)" }}>
                          {point.wins}-{point.losses}
                          {point.championships > 0 ? ` · ${point.championships}x champ` : ""}
                        </span>
                      </div>
                      <div className="flex gap-1">
                        <div
                          className="h-1.5 rounded-full"
                          style={{
                            width: winWidth,
                            background:
                              "linear-gradient(90deg, var(--accent-emerald-strong), var(--accent-emerald))",
                          }}
                        />
                        <div
                          className="h-1.5 rounded-full"
                          style={{
                            width: lossWidth,
                            background:
                              "linear-gradient(90deg, var(--accent-red-strong), var(--accent-red))",
                          }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function StatItem({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl px-3 py-2" style={{ background: "color-mix(in srgb, var(--panel2) 88%, transparent)" }}>
      <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--muted2)" }}>
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold" style={{ color: "var(--text)" }}>
        {value}
      </div>
    </div>
  )
}

