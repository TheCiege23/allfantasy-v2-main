"use client"

import { useState, useCallback, useEffect } from "react"
import Link from "next/link"
import { FeedTabs } from "./FeedTabs"
import { FeedFilters } from "./FeedFilters"
import { FollowingFeed } from "./FollowingFeed"
import { ForYouFeed } from "./ForYouFeed"
import { TrendingFeed } from "./TrendingFeed"
import type { FeedMode, FeedItemType, ContentFeedItem } from "@/lib/content-feed"

const SAVED_STORAGE_KEY = "content-feed-saved"

export default function ContentFeedPage() {
  const [activeTab, setActiveTab] = useState<FeedMode>("for_you")
  const [sport, setSport] = useState<string | null>(null)
  const [contentType, setContentType] = useState<FeedItemType | null>(null)
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem(SAVED_STORAGE_KEY) : null
      if (raw) {
        const arr = JSON.parse(raw) as string[]
        if (Array.isArray(arr)) setSavedIds(new Set(arr))
      }
    } catch (_) {}
  }, [])

  const handleFollowCreator = useCallback((creatorHandle: string) => {
    window.location.assign(`/creators/${creatorHandle}`)
  }, [])

  const handleSave = useCallback((item: ContentFeedItem) => {
    setSavedIds((prev) => {
      const next = new Set(prev)
      if (next.has(item.id)) next.delete(item.id)
      else next.add(item.id)
      try {
        if (typeof window !== "undefined") {
          localStorage.setItem(SAVED_STORAGE_KEY, JSON.stringify(Array.from(next)))
        }
      } catch (_) {}
      return next
    })
  }, [])

  return (
    <div className="space-y-6" data-testid="content-feed-page">
      <div className="flex items-center gap-3">
        <Link
          href="/core"
          className="text-sm text-white/60 hover:text-white/80 transition"
        >
          ← Dashboard
        </Link>
      </div>

      <header>
        <h1 className="text-2xl font-bold text-white mb-2" data-testid="content-feed-title">Content feed</h1>
        <p className="text-sm text-white/60 mb-4">
          Creator posts, AI insights, story cards, blogs, recaps, trend alerts, and platform highlights.
        </p>
        <FeedTabs activeTab={activeTab} onTabChange={setActiveTab} />
      </header>

      <FeedFilters
        sport={sport}
        contentType={contentType}
        onSportChange={setSport}
        onContentTypeChange={setContentType}
      />

      {activeTab === "following" ? (
        <FollowingFeed
          sport={sport}
          contentType={contentType}
          onFollowCreator={handleFollowCreator}
          onSave={handleSave}
          savedIds={savedIds}
        />
      ) : activeTab === "trending" ? (
        <TrendingFeed
          sport={sport}
          contentType={contentType}
          onFollowCreator={handleFollowCreator}
          onSave={handleSave}
          savedIds={savedIds}
        />
      ) : (
        <ForYouFeed
          sport={sport}
          contentType={contentType}
          onFollowCreator={handleFollowCreator}
          onSave={handleSave}
          savedIds={savedIds}
        />
      )}
    </div>
  )
}
