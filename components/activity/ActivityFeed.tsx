"use client"

import Link from "next/link"
import { ArrowRightLeft, MessageSquare, Megaphone, UserPlus, LayoutGrid, ChevronRight, HeartPulse, TrendingUp, Loader2 } from "lucide-react"
import { useActivityFeed } from "@/hooks/useActivityFeed"
import type { ActivityFeedItem } from "@/lib/activity/types"

export type { ActivityFeedItem } from "@/lib/activity/types"

const TYPE_ICONS = {
  trade: ArrowRightLeft,
  waiver: UserPlus,
  lineup: LayoutGrid,
  message: MessageSquare,
  announcement: Megaphone,
  injury: HeartPulse,
  standings: TrendingUp,
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  if (diff < 60000) return "Just now"
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  if (diff < 172800000) return "Yesterday"
  return d.toLocaleDateString()
}

export default function ActivityFeed({
  items: itemsProp,
  leagueId,
}: {
  items?: ActivityFeedItem[]
  leagueId?: string
}) {
  const { items: fetchedItems, loading } = useActivityFeed({ limit: 50, leagueId })
  const items = itemsProp ?? fetchedItems
  const filtered = leagueId ? items.filter((i) => i.leagueId === leagueId) : items

  return (
    <section
      className="rounded-2xl border p-3 text-xs"
      style={{
        borderColor: "var(--border)",
        background: "color-mix(in srgb, var(--panel) 96%, transparent)",
      }}
    >
      <header className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
          Activity Feed
        </h2>
        <p className="text-[10px]" style={{ color: "var(--muted)" }}>
          Trades, waivers, lineups, messages, announcements
        </p>
      </header>
      <ul className="space-y-2">
        {loading && itemsProp === undefined ? (
          <li className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin" style={{ color: "var(--muted)" }} />
          </li>
        ) : filtered.length === 0 ? (
          <li className="py-4 text-center text-[11px]" style={{ color: "var(--muted)" }}>
            No league activity yet.
          </li>
        ) : (
          filtered.map((item) => {
            const Icon = TYPE_ICONS[item.type] ?? Megaphone
            const initials = item.userName
              .split(" ")
              .map((s) => s[0])
              .join("")
              .slice(0, 2)
              .toUpperCase()
            return (
              <li
                key={item.id}
                className="flex gap-3 rounded-xl border px-2.5 py-2 transition-colors hover:bg-black/5"
                style={{ borderColor: "var(--border)" }}
              >
                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold"
                  style={{
                    background: "var(--panel2)",
                    color: "var(--text)",
                    border: "1px solid var(--border)",
                  }}
                >
                  {item.avatarUrl ? (
                    <img
                      src={item.avatarUrl}
                      alt=""
                      className="h-9 w-9 rounded-full object-cover"
                    />
                  ) : (
                    initials
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-medium" style={{ color: "var(--text)" }}>
                    {item.userName}
                  </p>
                  <p className="mt-0.5 text-[11px]" style={{ color: "var(--muted2)" }}>
                    {item.description}
                  </p>
                  <div className="mt-1 flex items-center gap-2 flex-wrap">
                    <span className="text-[10px]" style={{ color: "var(--muted)" }}>
                      {formatTime(item.timestamp)}
                    </span>
                    {item.leagueId && item.leagueName && (
                      <Link
                        href={`/league/${item.leagueId}`}
                        className="inline-flex items-center gap-1 text-[10px] font-medium"
                        style={{ color: "var(--accent-cyan-strong)" }}
                      >
                        {item.leagueName}
                        <ChevronRight className="h-3 w-3" />
                      </Link>
                    )}
                  </div>
                </div>
                <div
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                  style={{
                    background: "color-mix(in srgb, var(--panel2) 90%, transparent)",
                    border: "1px solid var(--border)",
                    color: "var(--muted2)",
                  }}
                >
                  <Icon className="h-4 w-4" />
                </div>
              </li>
            )
          })
        )}
      </ul>
    </section>
  )
}
