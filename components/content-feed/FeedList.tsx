"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { RefreshCw } from "lucide-react"
import type { ContentFeedItem, FeedMode, FeedItemType } from "@/lib/content-feed"
import { FeedCardRenderer } from "./FeedCardRenderer"

export interface FeedListProps {
  tab: FeedMode
  sport: string | null
  contentType: FeedItemType | null
  onFollowCreator?: (creatorHandle: string) => void
  onSave?: (item: ContentFeedItem) => void
  savedIds?: Set<string>
}

function buildQuery(tab: FeedMode, sport: string | null, contentType: FeedItemType | null): string {
  const params = new URLSearchParams()
  params.set("tab", tab)
  if (sport) params.set("sport", sport)
  if (contentType) params.set("contentType", contentType)
  params.set("limit", "50")
  return `/api/content-feed?${params.toString()}`
}

export function FeedList({
  tab,
  sport,
  contentType,
  onFollowCreator,
  onSave,
  savedIds = new Set(),
}: FeedListProps) {
  const [items, setItems] = useState<ContentFeedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchFeed = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true)
      else setLoading(true)
      setError(null)
      const url = buildQuery(tab, sport, contentType)
      const track = isRefresh ? "feed_refresh" : "feed_view"
      try {
        const res = await fetch(`${url}&track=${track}&t=${Date.now()}`, { cache: "no-store" })
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
    },
    [tab, sport, contentType]
  )

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
    <div className="space-y-4" data-testid="content-feed-list">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-white" data-testid="content-feed-active-tab-title">
          {tab === "following" ? "Following" : tab === "trending" ? "Trending" : "For you"}
        </h2>
        <button
          type="button"
          onClick={() => fetchFeed(true)}
          disabled={refreshing}
          className="inline-flex items-center gap-2 rounded-xl border border-white/20 px-3 py-2 text-sm font-medium text-white/90 hover:bg-white/10 disabled:opacity-50 transition"
          aria-label="Refresh feed"
          data-testid="content-feed-refresh-button"
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
          <p>
            {tab === "following"
              ? "Join creator leagues or follow creators to see their updates here."
              : "No feed items yet. Check back later or adjust filters."}
          </p>
          <Link
            href="/core"
            className="mt-3 inline-block text-cyan-400 hover:text-cyan-300 text-sm"
          >
            Back to dashboard
          </Link>
        </div>
      )}

      <ul className="space-y-3" data-testid="content-feed-cards">
        {items.map((item) => (
          <li key={item.id}>
            <FeedCardRenderer
              item={item}
              onFollowCreator={onFollowCreator}
              onSave={onSave}
              savedIds={savedIds}
            />
          </li>
        ))}
      </ul>
    </div>
  )
}
