'use client'

import { useState } from 'react'
import type { PlayerOutlook } from '@/lib/player-outlook'
import { TIER_LABELS } from '@/lib/player-outlook'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tierColor(tier: number): string {
  if (tier <= 2) return 'text-emerald-400'
  if (tier <= 4) return 'text-amber-400'
  if (tier <= 5) return 'text-orange-400'
  return 'text-red-400'
}

function tierBg(tier: number): string {
  if (tier <= 2) return 'bg-emerald-500/15 border-emerald-500/25'
  if (tier <= 4) return 'bg-amber-500/15 border-amber-500/25'
  if (tier <= 5) return 'bg-orange-500/15 border-orange-500/25'
  return 'bg-red-500/15 border-red-500/25'
}

function trendColors(trend: string) {
  switch (trend) {
    case 'buy': return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25'
    case 'sell': return 'bg-red-500/15 text-red-400 border-red-500/25'
    default: return 'bg-amber-500/15 text-amber-400 border-amber-500/25'
  }
}

function riskColors(level: string) {
  switch (level) {
    case 'low': return 'bg-emerald-500/10 text-emerald-400'
    case 'moderate': return 'bg-amber-500/10 text-amber-400'
    case 'high': return 'bg-red-500/10 text-red-400'
    case 'extreme': return 'bg-red-500/20 text-red-300'
    default: return 'bg-zinc-500/10 text-zinc-400'
  }
}

// ---------------------------------------------------------------------------
// Score Ring (reused pattern)
// ---------------------------------------------------------------------------

function TierRing({ tier, label }: { tier: number; label: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className={`w-10 h-10 rounded-full border-2 border-current flex items-center justify-center text-xs font-bold ${tierColor(tier)}`}>
        {tier}
      </div>
      <span className="text-[11px] text-zinc-500 uppercase tracking-wide">{label}</span>
    </div>
  )
}

function ScoreBar({ score, label, maxLabel }: { score: number; label: string; maxLabel?: string }) {
  const color = score >= 70 ? 'bg-emerald-500' : score >= 45 ? 'bg-amber-500' : 'bg-red-500'
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-[11px]">
        <span className="text-zinc-500">{label}</span>
        <span className="text-zinc-400">{score}/100 {maxLabel ?? ''}</span>
      </div>
      <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${score}%` }} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function PlayerOutlookCard({
  outlook,
  compact = false,
  showNarrative = true,
  onPlayerClick,
}: {
  outlook: PlayerOutlook
  compact?: boolean
  showNarrative?: boolean
  onPlayerClick?: (name: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const o = outlook

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      {/* Header — always visible */}
      <button
        onClick={() => !compact && setExpanded(!expanded)}
        className="w-full p-4 text-left hover:bg-zinc-800/50 transition-colors"
      >
        <div className="flex items-start justify-between gap-3">
          {/* Left: Identity */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span
                className="text-base font-semibold text-white cursor-pointer hover:text-emerald-400 transition-colors"
                onClick={(e) => {
                  if (onPlayerClick) { e.stopPropagation(); onPlayerClick(o.playerName) }
                }}
              >
                {o.playerName}
              </span>
              <span className="text-xs text-zinc-500">{o.position} - {o.team ?? 'FA'}</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {/* Trend badge */}
              <span className={`text-xs font-medium px-2 py-0.5 rounded border ${trendColors(o.trend)}`}>
                {o.trend.toUpperCase()} {o.trendStrength > 0 ? `(${o.trendStrength})` : ''}
              </span>
              {/* Format fit */}
              <span className="text-[11px] text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded">
                {o.bestFormatFit}
              </span>
              {/* Risk */}
              <span className={`text-[11px] px-1.5 py-0.5 rounded ${riskColors(o.riskLevel)}`}>
                {o.riskLevel} risk
              </span>
              {/* Confidence */}
              <span className="text-[11px] text-zinc-500">
                {o.confidencePct}% conf
              </span>
            </div>
          </div>

          {/* Right: Tier rings */}
          <div className="flex gap-1.5">
            <TierRing tier={o.restOfSeasonTier} label="ROS" />
            <TierRing tier={o.weeklyTier} label="WK" />
            <TierRing tier={o.dynastyTier} label="DYN" />
          </div>
        </div>

        {/* One-line summary */}
        <p className="text-xs text-zinc-400 mt-2">{o.outlookSummary}</p>

        {/* Tags row */}
        {o.tags.length > 0 && (
          <div className="flex gap-1 mt-1.5 flex-wrap">
            {o.tags.slice(0, 5).map(tag => (
              <span key={tag} className="text-[11px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
                {tag.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        )}

        {/* Expand indicator */}
        {!compact && (
          <span className="text-[11px] text-zinc-600 mt-1 block">
            {expanded ? '▲ Collapse' : '▼ Expand details'}
          </span>
        )}
      </button>

      {/* Expanded section */}
      {expanded && !compact && (
        <div className="px-4 pb-4 pt-0 border-t border-zinc-800 space-y-3">
          {/* Score bars */}
          <div className="space-y-2 pt-2">
            <ScoreBar score={o.opportunityScore} label="Opportunity" />
            <ScoreBar score={o.roleSecurityScore} label="Role Security" />
          </div>

          {/* Tier detail */}
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              { tier: o.restOfSeasonTier, label: 'ROS' },
              { tier: o.weeklyTier, label: 'Weekly' },
              { tier: o.dynastyTier, label: 'Dynasty' },
            ].map(({ tier, label }) => (
              <div key={label} className={`rounded-lg p-2 border ${tierBg(tier)}`}>
                <div className={`text-lg font-bold ${tierColor(tier)}`}>{tier}</div>
                <div className="text-[11px] text-zinc-500">{label}: {TIER_LABELS[tier]}</div>
              </div>
            ))}
          </div>

          {/* Bullish / Bearish */}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-emerald-500/5 border border-emerald-500/15 rounded-lg p-2">
              <span className="text-[11px] text-emerald-500 uppercase font-medium block mb-0.5">Bullish</span>
              <p className="text-xs text-zinc-400">{o.bullishCase}</p>
            </div>
            <div className="bg-red-500/5 border border-red-500/15 rounded-lg p-2">
              <span className="text-[11px] text-red-500 uppercase font-medium block mb-0.5">Bearish</span>
              <p className="text-xs text-zinc-400">{o.bearishCase}</p>
            </div>
          </div>

          {/* AI Narrative */}
          {showNarrative && o.narrative && (
            <div className="bg-zinc-800/50 rounded-lg p-3">
              <span className="text-[11px] text-zinc-500 uppercase block mb-1">AI Analysis</span>
              <p className="text-sm text-zinc-300 leading-relaxed">{o.narrative}</p>
            </div>
          )}

          {/* Trend summary */}
          <div>
            <span className="text-[11px] text-zinc-500 uppercase block mb-0.5">Recent Trend</span>
            <p className="text-xs text-zinc-400">{o.recentTrendSummary}</p>
          </div>

          {/* Risk flags */}
          {o.riskFlags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {o.riskFlags.map(flag => (
                <span key={flag} className="text-[11px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20">
                  {flag.replace(/_/g, ' ')}
                </span>
              ))}
            </div>
          )}

          {/* Value + rank */}
          <div className="flex gap-3 text-xs text-zinc-500">
            <span>Value: {o.currentValue.toLocaleString()}</span>
            <span>Rank: #{o.currentRank}</span>
            <span>Pos: #{o.positionRank}</span>
            <span>Data: {o.dataCompleteness}%</span>
          </div>

          {/* Sources + freshness */}
          <div className="flex justify-between text-[11px] text-zinc-600">
            <span>Sources: {o.sourcesUsed.join(', ')}</span>
            <span>{o.fromCache ? `Cached (${o.cacheAge}s ago)` : 'Fresh'}</span>
          </div>
        </div>
      )}
    </div>
  )
}
