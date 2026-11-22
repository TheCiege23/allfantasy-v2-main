"use client"

import type { FeedMode } from "@/lib/content-feed"

const TABS: { value: FeedMode; label: string }[] = [
  { value: "following", label: "Following" },
  { value: "for_you", label: "For You" },
  { value: "trending", label: "Trending" },
]

interface FeedTabsProps {
  activeTab: FeedMode
  onTabChange: (tab: FeedMode) => void
  className?: string
}

export function FeedTabs({ activeTab, onTabChange, className = "" }: FeedTabsProps) {
  return (
    <div
      role="tablist"
      aria-label="Feed view"
      className={`flex rounded-xl border border-white/10 bg-white/5 p-1 ${className}`}
    >
      {TABS.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          role="tab"
          aria-selected={activeTab === value}
          onClick={() => onTabChange(value)}
          data-testid={`content-feed-tab-${value}`}
          className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 ${
            activeTab === value
              ? "bg-cyan-500/20 text-cyan-300 shadow-sm"
              : "text-white/70 hover:bg-white/10 hover:text-white"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
