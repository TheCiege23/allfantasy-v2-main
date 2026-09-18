"use client"

import { useState, useCallback, useEffect } from "react"
import Link from "next/link"
import { RefreshCw, Newspaper, Users, Sparkles, Trophy } from "lucide-react"

export type FeedItem = {
  id: string
  type: "player_news" | "league_update" | "ai_insight" | "community_highlight"
  title: string
  body: string
  href: string
  sport: string | null
  leagueId: string | null
  leagueName: string | null
  imageUrl?: string | null
  createdAt: string
}

const TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  player_news: Newspaper,
  league_update: Users,
  ai_insight: Sparkles,
  community_highlight: Trophy,
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  if (diff < 60000) return "Just now"
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  return d.toLocaleDateString()
}

export default function ContentFeedClient() {
  const [items, setItems] = useState<FeedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchFeed = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/content-feed?limit=30&t=${Date.now()}`, {
        cache: "no-store",
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? "Failed to load feed")
        setItems([])
        return
      }
      setItems(data.items ?? [])
    } catch {
      setError("Failed to load feed")
      setItems([])
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    fetchFeed(false)
  }, [fetchFeed])

  if (loading && items.length === 0) {
    return (
      <div className="py-12 text-center text-white/50">
        <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-2 opacity-50" />
        <p>Loading your feed...</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-white">Your feed</h2>
        <button
          type="button"
          onClick={() => fetchFeed(true)}
          disabled={refreshing}
          className="inline-flex items-center gap-2 rounded-xl border border-white/20 px-3 py-2 text-sm font-medium text-white/90 hover:bg-white/10 disabled:opacity-50 transition"
          aria-label="Refresh feed"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          {refreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {items.length === 0 && !error && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center text-white/60">
          <p>No feed items yet. Check back later or join a league to see personalized updates.</p>
          <Link href="/core" className="mt-3 inline-block text-cyan-400 hover:text-cyan-300 text-sm">
            Back to dashboard
          </Link>
        </div>
      )}

      <ul className="space-y-3">
        {items.map((item) => {
          const Icon = TYPE_ICONS[item.type] ?? Newspaper
          return (
            <li key={item.id}>
              <Link
                href={item.href}
                className="flex gap-3 rounded-xl border border-white/10 bg-white/5 p-4 hover:bg-white/10 transition"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10 text-white/80">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-white">{item.title}</p>
                  {item.body && (
                    <p className="mt-0.5 text-xs text-white/70 line-clamp-2">{item.body}</p>
                  )}
                  <p className="mt-1 text-[11px] text-white/50">
                    {item.type.replace("_", " ")}
                    {item.sport && ` · ${item.sport}`}
                    {" · "}
                    {formatTime(item.createdAt)}
                  </p>
                </div>
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
