'use client'

import { useState } from 'react'
import type { StoryContent, FeaturedPlayer, TurningPoint } from '@/lib/story-templates'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function storyTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    weekly_recap: 'Weekly Recap',
    matchup_recap: 'Matchup Recap',
    upset_of_the_week: 'Upset of the Week',
    manager_spotlight: 'Manager Spotlight',
    rivalry_recap: 'Rivalry Recap',
    trade_reaction: 'Trade Reaction',
    playoff_race: 'Playoff Race',
    championship_preview: 'Championship Preview',
    season_narrative: 'Season Narrative',
  }
  return labels[type] ?? type.replace(/_/g, ' ')
}

function storyTypeColor(type: string): string {
  const colors: Record<string, string> = {
    weekly_recap: 'bg-blue-500/15 text-blue-400 border-blue-500/25',
    matchup_recap: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
    upset_of_the_week: 'bg-red-500/15 text-red-400 border-red-500/25',
    manager_spotlight: 'bg-purple-500/15 text-purple-400 border-purple-500/25',
    rivalry_recap: 'bg-orange-500/15 text-orange-400 border-orange-500/25',
    trade_reaction: 'bg-amber-500/15 text-amber-400 border-amber-500/25',
    playoff_race: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/25',
    championship_preview: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/25',
    season_narrative: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/25',
  }
  return colors[type] ?? 'bg-zinc-500/15 text-zinc-400 border-zinc-500/25'
}

function dramaColor(score: number): string {
  if (score >= 70) return 'text-red-400'
  if (score >= 45) return 'text-amber-400'
  return 'text-zinc-400'
}

// ---------------------------------------------------------------------------
// Featured Player Chip
// ---------------------------------------------------------------------------

function PlayerChip({ player }: { player: FeaturedPlayer }) {
  return (
    <div className="flex items-center gap-2 bg-zinc-800/50 rounded-lg px-2.5 py-1.5 border border-zinc-700">
      <div>
        <span className="text-xs font-medium text-white">{player.name}</span>
        <span className="text-[11px] text-zinc-500 ml-1">{player.position}</span>
      </div>
      <span className="text-xs font-bold text-emerald-400">{player.points.toFixed(1)}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Turning Point Item
// ---------------------------------------------------------------------------

function TurningPointItem({ tp }: { tp: TurningPoint }) {
  const impactColor = tp.impact === 'decisive' ? 'text-red-400' : tp.impact === 'significant' ? 'text-amber-400' : 'text-zinc-400'
  return (
    <div className="flex items-start gap-2 text-xs">
      <span className={`text-[11px] uppercase font-medium ${impactColor} whitespace-nowrap`}>{tp.impact}</span>
      <span className="text-zinc-400">{tp.description}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Share Button
// ---------------------------------------------------------------------------

function ShareButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation()
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {})
  }

  return (
    <button
      onClick={handleCopy}
      className="text-[11px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 hover:bg-zinc-700 transition-colors border border-zinc-700"
    >
      {copied ? '✓ Copied' : '📋 Share'}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Main Card
// ---------------------------------------------------------------------------

export default function StoryRecapCard({
  story,
  compact = false,
  pinned = false,
}: {
  story: StoryContent
  compact?: boolean
  pinned?: boolean
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className={`bg-zinc-900 border rounded-xl overflow-hidden ${
      pinned ? 'border-amber-500/30 ring-1 ring-amber-500/10' : 'border-zinc-800'
    }`}>
      {/* Pin indicator */}
      {pinned && (
        <div className="bg-amber-500/10 px-3 py-1 text-[11px] text-amber-400 flex items-center gap-1">
          📌 Commissioner Featured
        </div>
      )}

      {/* Header — always visible */}
      <button
        onClick={() => !compact && setExpanded(!expanded)}
        className="w-full p-4 text-left hover:bg-zinc-800/50 transition-colors"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            {/* Type badge + drama score */}
            <div className="flex items-center gap-2 mb-1.5">
              <span className={`text-[11px] font-medium px-2 py-0.5 rounded border ${storyTypeColor(story.storyType)}`}>
                {storyTypeLabel(story.storyType)}
              </span>
              {story.dramaScore >= 60 && (
                <span className={`text-[11px] ${dramaColor(story.dramaScore)}`}>
                  🔥 {story.dramaScore}
                </span>
              )}
              {story.isPinworthy && !pinned && (
                <span className="text-[11px] text-amber-400">⭐ Pinworthy</span>
              )}
            </div>

            {/* Headline */}
            <h3 className="text-base font-semibold text-white leading-tight">{story.headline}</h3>
            <p className="text-xs text-zinc-500 mt-0.5">{story.subheadline}</p>
          </div>

          <ShareButton text={story.socialCaption} />
        </div>

        {/* Short summary */}
        <p className="text-sm text-zinc-400 mt-2 leading-relaxed">{story.shortSummary}</p>

        {/* Featured players (compact row) */}
        {story.featuredPlayers.length > 0 && (
          <div className="flex gap-1.5 mt-2 overflow-x-auto pb-0.5">
            {story.featuredPlayers.slice(0, 3).map((p) => (
              <PlayerChip key={p.name} player={p} />
            ))}
          </div>
        )}

        {/* Tags */}
        {story.tags.length > 0 && (
          <div className="flex gap-1 mt-2">
            {story.tags.slice(0, 4).map(tag => (
              <span key={tag} className="text-[11px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500 border border-zinc-700">
                #{tag}
              </span>
            ))}
          </div>
        )}

        {!compact && (
          <span className="text-[11px] text-zinc-600 mt-1 block">{expanded ? '▲ Show less' : '▼ Full story'}</span>
        )}
      </button>

      {/* Expanded — Full story */}
      {expanded && !compact && (
        <div className="px-4 pb-4 pt-0 border-t border-zinc-800 space-y-3">
          {/* Long recap */}
          {story.longRecap && (
            <div className="pt-2">
              <p className="text-sm text-zinc-300 leading-relaxed">{story.longRecap}</p>
            </div>
          )}

          {/* Turning points */}
          {story.turningPoints.length > 0 && (
            <div>
              <h4 className="text-[11px] text-zinc-500 uppercase font-medium mb-1">Turning Points</h4>
              <div className="space-y-1">
                {story.turningPoints.map((tp, i) => (
                  <TurningPointItem key={i} tp={tp} />
                ))}
              </div>
            </div>
          )}

          {/* Biggest surprise + What it means */}
          <div className="grid grid-cols-2 gap-2">
            {story.biggestSurprise && (
              <div className="bg-purple-500/5 border border-purple-500/15 rounded-lg p-2">
                <span className="text-[11px] text-purple-400 uppercase font-medium block mb-0.5">Biggest Surprise</span>
                <p className="text-xs text-zinc-400">{story.biggestSurprise}</p>
              </div>
            )}
            {story.whatItMeansNext && (
              <div className="bg-blue-500/5 border border-blue-500/15 rounded-lg p-2">
                <span className="text-[11px] text-blue-400 uppercase font-medium block mb-0.5">What It Means</span>
                <p className="text-xs text-zinc-400">{story.whatItMeansNext}</p>
              </div>
            )}
          </div>

          {/* More featured players */}
          {story.featuredPlayers.length > 3 && (
            <div>
              <h4 className="text-[11px] text-zinc-500 uppercase font-medium mb-1">More Featured Players</h4>
              <div className="flex gap-1.5 flex-wrap">
                {story.featuredPlayers.slice(3).map((p) => (
                  <PlayerChip key={p.name} player={p} />
                ))}
              </div>
            </div>
          )}

          {/* Social caption (shareable) */}
          <div className="bg-zinc-800/50 rounded-lg p-2.5 flex items-start gap-2">
            <span className="text-[11px] text-zinc-500 uppercase whitespace-nowrap">Social</span>
            <p className="text-xs text-zinc-400 flex-1">{story.socialCaption}</p>
            <ShareButton text={story.socialCaption} />
          </div>
        </div>
      )}
    </div>
  )
}
