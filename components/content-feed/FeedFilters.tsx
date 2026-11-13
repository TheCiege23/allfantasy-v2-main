"use client"

import { SUPPORTED_SPORTS } from "@/lib/sport-scope"
import type { FeedItemType } from "@/lib/content-feed"

const SPORT_LABELS: Record<string, string> = {
  NFL: "NFL",
  NHL: "NHL",
  NBA: "NBA",
  MLB: "MLB",
  NCAAF: "NCAA Football",
  NCAAB: "NCAA Basketball",
  SOCCER: "Soccer",
}

const CONTENT_TYPE_LABELS: Record<FeedItemType, string> = {
  creator_post: "Creators",
  ai_story_card: "AI stories",
  power_rankings_card: "Rankings",
  trend_alert: "Trends",
  blog_preview: "Blog",
  league_recap_card: "Recaps",
  bracket_highlight_card: "Bracket",
  matchup_card: "Matchups",
  player_news: "News",
  league_update: "League",
  ai_insight: "AI insight",
  community_highlight: "Community",
}

interface FeedFiltersProps {
  sport: string | null
  contentType: FeedItemType | null
  onSportChange: (sport: string | null) => void
  onContentTypeChange: (contentType: FeedItemType | null) => void
  className?: string
}

export function FeedFilters({
  sport,
  contentType,
  onSportChange,
  onContentTypeChange,
  className = "",
}: FeedFiltersProps) {
  return (
    <div className={`space-y-3 ${className}`}>
      <div className="flex flex-wrap gap-2">
        <span className="text-xs font-medium text-white/50 self-center mr-1">Sport</span>
        <button
          type="button"
          onClick={() => onSportChange(null)}
          data-testid="content-feed-sport-filter-all"
          className={`rounded-full px-3 py-1.5 text-xs font-medium transition border ${
            sport === null
              ? "bg-cyan-500/20 border-cyan-400/40 text-cyan-300"
              : "border-white/20 text-white/70 hover:bg-white/10"
          }`}
        >
          All
        </button>
        {(SUPPORTED_SPORTS as readonly string[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onSportChange(s)}
            data-testid={`content-feed-sport-filter-${s}`}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition border ${
              sport === s
                ? "bg-cyan-500/20 border-cyan-400/40 text-cyan-300"
                : "border-white/20 text-white/70 hover:bg-white/10"
            }`}
          >
            {SPORT_LABELS[s] ?? s}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <span className="text-xs font-medium text-white/50 self-center mr-1">Type</span>
        <button
          type="button"
          onClick={() => onContentTypeChange(null)}
          data-testid="content-feed-type-filter-all"
          className={`rounded-full px-3 py-1.5 text-xs font-medium transition border ${
            contentType === null
              ? "bg-cyan-500/20 border-cyan-400/40 text-cyan-300"
              : "border-white/20 text-white/70 hover:bg-white/10"
          }`}
        >
          All
        </button>
        {(
          [
            "creator_post",
            "trend_alert",
            "blog_preview",
            "ai_story_card",
            "power_rankings_card",
            "league_recap_card",
            "bracket_highlight_card",
            "matchup_card",
          ] as FeedItemType[]
        ).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onContentTypeChange(t)}
            data-testid={`content-feed-type-filter-${t}`}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition border ${
              contentType === t
                ? "bg-cyan-500/20 border-cyan-400/40 text-cyan-300"
                : "border-white/20 text-white/70 hover:bg-white/10"
            }`}
          >
            {CONTENT_TYPE_LABELS[t] ?? t}
          </button>
        ))}
      </div>
    </div>
  )
}
