'use client'

import React, { useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, Mic, Video, FileText, Share2 } from 'lucide-react'
import { MediaGenerationPanel } from '@/components/media-generation'
import type { MediaType } from '@/lib/media-generation/types'
import { SUPPORTED_SPORTS } from '@/lib/sport-scope'

const TOOLS: { type: MediaType; label: string; icon: React.ElementType }[] = [
  { type: 'podcast', label: 'Fantasy Podcast Generator', icon: Mic },
  { type: 'video', label: 'Video Generator', icon: Video },
  { type: 'blog', label: 'Blog Generator', icon: FileText },
  { type: 'social', label: 'Social Clip Generator', icon: Share2 },
]

const VIDEO_CONTENT_TYPES = [
  'weekly_recap',
  'waiver_targets',
  'matchup_preview',
  'sport_specific_content',
]
const BLOG_CATEGORIES = [
  'weekly_strategy',
  'waiver_wire',
  'trade_value',
  'draft_prep',
  'ranking_updates',
  'ai_explainer',
]
const SOCIAL_ASSET_TYPES = [
  'weekly_league_winners',
  'draft_highlights',
  'rivalry_moments',
  'ai_insight_moments',
]

export default function MediaPage() {
  const [selected, setSelected] = useState<MediaType | null>(null)
  const [sport, setSport] = useState<string>(SUPPORTED_SPORTS[0] ?? 'NFL')
  const [leagueName, setLeagueName] = useState('My League')
  const [weekLabel, setWeekLabel] = useState('Week 8')
  const [videoContentType, setVideoContentType] = useState(VIDEO_CONTENT_TYPES[0]!)
  const [blogCategory, setBlogCategory] = useState(BLOG_CATEGORIES[0]!)
  const [topicHint, setTopicHint] = useState('Key waiver and trade pivots this week')
  const [socialAssetType, setSocialAssetType] = useState(SOCIAL_ASSET_TYPES[0]!)
  const [tone, setTone] = useState('confident and witty')
  const [brandingHint, setBrandingHint] = useState('AllFantasy Pulse')

  const payload = useMemo(() => {
    if (!selected) return { sport, leagueName }
    if (selected === 'podcast') {
      return { sport, leagueName, weekLabel }
    }
    if (selected === 'video') {
      return { sport, leagueName, contentType: videoContentType }
    }
    if (selected === 'blog') {
      return { sport, category: blogCategory, topicHint }
    }
    return {
      sport,
      leagueName,
      assetType: socialAssetType,
      tone,
      brandingHint,
    }
  }, [
    selected,
    sport,
    leagueName,
    weekLabel,
    videoContentType,
    blogCategory,
    topicHint,
    socialAssetType,
    tone,
    brandingHint,
  ])

  return (
    <div className="mode-surface min-h-screen">
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
        <Link
          href="/ai"
          className="mb-6 inline-flex items-center gap-2 text-sm text-white/60 hover:text-white/90"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to Chimmy Hub
        </Link>
        <h1 className="mb-2 text-2xl font-bold text-white">Chimmy Media</h1>
        <p className="mb-6 text-sm text-white/60">
          Generate → Preview → Approve → Publish. Podcast & video (HeyGen), blog (OpenAI), social (Grok).
        </p>

        {!selected ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {TOOLS.map(({ type, label, icon: Icon }) => (
              <button
                key={type}
                type="button"
                onClick={() => setSelected(type)}
                data-testid={`media-tool-card-${type}`}
                className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-left transition hover:border-white/20 hover:bg-white/[0.06]"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-cyan-500/20 bg-cyan-500/10">
                  <Icon className="h-5 w-5 text-cyan-300" />
                </div>
                <span className="font-medium text-white">{label}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            <button
              type="button"
              onClick={() => setSelected(null)}
              data-testid="media-change-tool-button"
              className="text-sm text-white/60 hover:text-white/90"
            >
              ← Change tool
            </button>

            <div className="grid gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs text-white/65">
                <span className="block">Sport</span>
                <select
                  value={sport}
                  onChange={(e) => setSport(e.target.value)}
                  data-testid="media-sport-selector"
                  className="w-full rounded-lg border border-white/15 bg-black/30 px-2 py-2 text-sm text-white"
                >
                  {SUPPORTED_SPORTS.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1 text-xs text-white/65">
                <span className="block">League name</span>
                <input
                  value={leagueName}
                  onChange={(e) => setLeagueName(e.target.value)}
                  data-testid="media-league-name-input"
                  className="w-full rounded-lg border border-white/15 bg-black/30 px-2 py-2 text-sm text-white"
                />
              </label>

              {selected === 'podcast' && (
                <label className="space-y-1 text-xs text-white/65 sm:col-span-2">
                  <span className="block">Week label</span>
                  <input
                    value={weekLabel}
                    onChange={(e) => setWeekLabel(e.target.value)}
                    data-testid="media-week-label-input"
                    className="w-full rounded-lg border border-white/15 bg-black/30 px-2 py-2 text-sm text-white"
                  />
                </label>
              )}

              {selected === 'video' && (
                <label className="space-y-1 text-xs text-white/65 sm:col-span-2">
                  <span className="block">Video type</span>
                  <select
                    value={videoContentType}
                    onChange={(e) => setVideoContentType(e.target.value)}
                    data-testid="media-video-type-selector"
                    className="w-full rounded-lg border border-white/15 bg-black/30 px-2 py-2 text-sm text-white"
                  >
                    {VIDEO_CONTENT_TYPES.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {selected === 'blog' && (
                <>
                  <label className="space-y-1 text-xs text-white/65">
                    <span className="block">Blog category</span>
                    <select
                      value={blogCategory}
                      onChange={(e) => setBlogCategory(e.target.value)}
                      data-testid="media-blog-category-selector"
                      className="w-full rounded-lg border border-white/15 bg-black/30 px-2 py-2 text-sm text-white"
                    >
                      {BLOG_CATEGORIES.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1 text-xs text-white/65">
                    <span className="block">Topic hint</span>
                    <input
                      value={topicHint}
                      onChange={(e) => setTopicHint(e.target.value)}
                      data-testid="media-topic-hint-input"
                      className="w-full rounded-lg border border-white/15 bg-black/30 px-2 py-2 text-sm text-white"
                    />
                  </label>
                </>
              )}

              {selected === 'social' && (
                <>
                  <label className="space-y-1 text-xs text-white/65">
                    <span className="block">Clip type</span>
                    <select
                      value={socialAssetType}
                      onChange={(e) => setSocialAssetType(e.target.value)}
                      data-testid="media-social-clip-type-selector"
                      className="w-full rounded-lg border border-white/15 bg-black/30 px-2 py-2 text-sm text-white"
                    >
                      {SOCIAL_ASSET_TYPES.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1 text-xs text-white/65">
                    <span className="block">Tone</span>
                    <input
                      value={tone}
                      onChange={(e) => setTone(e.target.value)}
                      data-testid="media-tone-input"
                      className="w-full rounded-lg border border-white/15 bg-black/30 px-2 py-2 text-sm text-white"
                    />
                  </label>
                  <label className="space-y-1 text-xs text-white/65 sm:col-span-2">
                    <span className="block">Branding hint</span>
                    <input
                      value={brandingHint}
                      onChange={(e) => setBrandingHint(e.target.value)}
                      data-testid="media-branding-hint-input"
                      className="w-full rounded-lg border border-white/15 bg-black/30 px-2 py-2 text-sm text-white"
                    />
                  </label>
                </>
              )}
            </div>

            <MediaGenerationPanel type={selected} initialPayload={payload} />
          </div>
        )}
      </div>
    </div>
  )
}
