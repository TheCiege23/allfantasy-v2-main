"use client"

import Link from "next/link"
import Image from "next/image"
import { Newspaper, Users, Sparkles, Trophy, User, TrendingUp, BookOpen, BarChart3, Swords, Bookmark } from "lucide-react"
import type { ContentFeedItem, FeedItemType } from "@/lib/content-feed"

const TYPE_ICONS: Record<FeedItemType, React.ComponentType<{ className?: string }>> = {
  player_news: Newspaper,
  league_update: Users,
  ai_insight: Sparkles,
  community_highlight: Trophy,
  creator_post: User,
  ai_story_card: Sparkles,
  power_rankings_card: BarChart3,
  trend_alert: TrendingUp,
  blog_preview: BookOpen,
  league_recap_card: Newspaper,
  bracket_highlight_card: Trophy,
  matchup_card: Swords,
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

function getSafeHref(rawHref: string | null | undefined): string {
  const href = typeof rawHref === "string" ? rawHref.trim() : ""
  if (!href) return "/feed"
  if (href.startsWith("/")) return href
  if (/^https?:\/\//i.test(href)) return href
  return "/feed"
}

interface FeedCardRendererProps {
  item: ContentFeedItem
  onFollowCreator?: (creatorHandle: string) => void
  onSave?: (item: ContentFeedItem) => void
  savedIds?: Set<string>
}

export function FeedCardRenderer({
  item,
  onFollowCreator,
  onSave,
  savedIds = new Set(),
}: FeedCardRendererProps) {
  const Icon = TYPE_ICONS[item.type] ?? Newspaper
  const isSaved = savedIds.has(item.id)
  const showCreatorCta =
    item.type === "creator_post" && (item.creatorHandle ?? item.creatorId)
  const safeId = item.id.replace(/[^a-zA-Z0-9_-]/g, "_")
  const itemHref = getSafeHref(item.href)
  const isAiInsightCard =
    item.type === "ai_insight" || item.type === "ai_story_card" || item.type === "power_rankings_card"

  return (
    <article
      className="rounded-xl border border-white/10 bg-white/5 overflow-hidden hover:bg-white/[0.07] transition"
      data-feed-id={item.id}
      data-feed-type={item.type}
      data-testid={`content-feed-card-${safeId}`}
    >
      <Link
        href={itemHref}
        className="block p-4"
        data-testid={
          isAiInsightCard
            ? `content-feed-ai-insight-card-${safeId}`
            : `content-feed-article-link-${safeId}`
        }
      >
        <div className="flex gap-3">
          {item.creatorAvatarUrl ? (
            <div className="relative h-10 w-10 shrink-0 rounded-full overflow-hidden bg-white/10">
              <Image
                src={item.creatorAvatarUrl}
                alt=""
                width={40}
                height={40}
                className="object-cover"
              />
            </div>
          ) : (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-white/80">
              <Icon className="h-5 w-5" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-white">{item.title}</p>
            {item.body && (
              <p className="mt-0.5 text-xs text-white/70 line-clamp-2">{item.body}</p>
            )}
            <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-white/50">
              <span className="capitalize">{item.type.replace(/_/g, " ")}</span>
              {item.sport && <span>· {item.sport}</span>}
              <span>· {formatTime(item.createdAt)}</span>
            </p>
          </div>
        </div>
      </Link>

      <div className="flex items-center justify-between gap-2 px-4 pb-3 pt-0">
        <div className="flex items-center gap-2">
          {showCreatorCta && (
            <Link
              href={`/creators/${item.creatorHandle ?? item.creatorId}`}
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 px-2.5 py-1.5 text-xs font-medium text-white/90 hover:bg-white/10 transition"
              data-testid={`content-feed-view-creator-cta-${safeId}`}
            >
              <User className="h-3.5 w-3.5" />
              {item.creatorDisplayName || item.creatorHandle || "View creator"}
            </Link>
          )}
          {onFollowCreator && showCreatorCta && item.creatorHandle && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onFollowCreator(item.creatorHandle!)
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/40 px-2.5 py-1.5 text-xs font-medium text-cyan-300 hover:bg-cyan-500/20 transition"
              data-testid={`content-feed-follow-creator-cta-${safeId}`}
            >
              Follow
            </button>
          )}
        </div>
        {onSave && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onSave(item)
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 px-2.5 py-1.5 text-xs font-medium text-white/70 hover:bg-white/10 transition"
            aria-label={isSaved ? "Unsave" : "Save"}
            data-testid={`content-feed-save-item-cta-${safeId}`}
          >
            <Bookmark
              className={`h-3.5 w-3.5 ${isSaved ? "fill-amber-400/80 text-amber-400/80" : ""}`}
            />
            {isSaved ? "Saved" : "Save"}
          </button>
        )}
      </div>
    </article>
  )
}
