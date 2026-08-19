'use client'
import { useState } from 'react'
import { ChevronRight, Info } from 'lucide-react'
import type { LaneStats, CompositeProfile } from '@/lib/legacy/overview-scoring'
import { generateLaneInsight } from '@/lib/legacy/overview-scoring'

function LaneInsightBlock({
  lane,
  onTabChange,
}: {
  lane: LaneStats
  onTabChange?: (tab: string) => void
}) {
  const insight = generateLaneInsight(lane)

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold text-white/80">{lane.label}</h4>

      <div className="space-y-1.5">
        {insight.strengths.map((s, i) => (
          <div key={i} className="flex items-start gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/60 flex-shrink-0 mt-1.5" />
            <p className="text-sm text-white/70 leading-relaxed">{s}</p>
          </div>
        ))}
      </div>

      <div className="flex items-start gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400/60 flex-shrink-0 mt-1.5" />
        <p className="text-sm text-white/60 leading-relaxed">
          <span className="text-cyan-300/80 font-medium">Next edge:</span> {insight.nextEdge}
        </p>
      </div>

      {onTabChange && (
        <button
          onClick={() => onTabChange(insight.nextAction.tab)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-400/20 text-xs text-cyan-300 transition font-medium"
        >
          {insight.nextAction.label}
          <ChevronRight className="w-3 h-3" />
        </button>
      )}
    </div>
  )
}

function buildHeadline(profile: CompositeProfile, lanes: LaneStats[]): string {
  const totalChips = lanes.reduce((s, l) => s + l.championships, 0)
  const avgDifficulty = lanes.length > 0
    ? lanes.reduce((s, l) => s + l.difficultyScore, 0) / lanes.length
    : 1.0

  if (profile.legacyScore >= 70 && totalChips >= 3) {
    return 'Elite legacy — championship proven across formats'
  }
  if (profile.legacyScore >= 70) {
    return 'Strong foundation with room to dominate'
  }
  if (avgDifficulty >= 1.15 && profile.legacyScore >= 45) {
    return 'Battle-tested in the toughest formats'
  }
  if (profile.legacyScore >= 50) {
    return 'Competitive manager building momentum'
  }
  if (totalChips > 0) {
    return 'Championship experience fueling your rise'
  }
  return 'Every season sharpens your edge'
}

function buildSummary(profile: CompositeProfile, lanes: LaneStats[]): string {
  const totalLeagues = lanes.reduce((s, l) => s + l.leagues, 0)
  const totalChips = lanes.reduce((s, l) => s + l.championships, 0)
  const avgDifficulty = lanes.length > 0
    ? lanes.reduce((s, l) => s + l.difficultyScore, 0) / lanes.length
    : 1.0

  const difficultyNote = avgDifficulty >= 1.1
    ? ` Your ${avgDifficulty.toFixed(2)}x average difficulty means your raw stats understate your real skill.`
    : ''

  if (totalChips > 0 && totalLeagues >= 20) {
    return `Sustaining ${profile.rawWinRate}% across ${totalLeagues} leagues while winning ${totalChips} championship${totalChips !== 1 ? 's' : ''} is rare.${difficultyNote} Keep stacking.`
  }
  if (totalChips > 0) {
    return `${totalChips} championship${totalChips !== 1 ? 's' : ''} across ${totalLeagues} leagues shows you know how to close.${difficultyNote} Focus on building consistency to turn good seasons into great ones.`
  }
  return `Across ${totalLeagues} leagues, you're building the experience base for a championship breakthrough.${difficultyNote} Every season sharpens your edge.`
}

export default function OverviewInsights({
  profile,
  lanes,
  onTabChange,
}: {
  profile: CompositeProfile
  lanes: LaneStats[]
  onTabChange?: (tab: string) => void
}) {
  const [expanded, setExpanded] = useState(false)

  const headline = buildHeadline(profile, lanes)
  const summaryLine = buildSummary(profile, lanes)

  return (
    <div className="rounded-2xl bg-gradient-to-br from-purple-500/8 via-transparent to-cyan-500/5 border border-purple-400/15 p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-purple-500/20 to-cyan-500/20 flex items-center justify-center text-lg">
            <span role="img" aria-label="robot">&#x1F916;</span>
          </div>
          <div className="text-sm font-semibold text-white/80">Chimmy Insight</div>
        </div>
        <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-400/20 text-[9px] text-emerald-300/70 font-medium flex items-center gap-1">
          <span className="w-1 h-1 rounded-full bg-emerald-400/80" />
          Computed from stats
        </span>
      </div>

      <div className="text-xl font-bold text-white mb-3 leading-tight">{headline}</div>
      <p className="text-sm text-white/60 leading-relaxed mb-5">{summaryLine}</p>

      {lanes.length > 0 && (
        <>
          {expanded && (
            <div className="space-y-5 mb-4 pl-1 border-l-2 border-purple-500/20 ml-1">
              {lanes.map(lane => (
                <div key={lane.leagueClass} className="pl-4">
                  <LaneInsightBlock lane={lane} onTabChange={onTabChange} />
                </div>
              ))}
            </div>
          )}
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-cyan-400/80 hover:text-cyan-300 transition flex items-center gap-1 mb-4"
          >
            {expanded ? 'Show less' : `View per-format breakdown (${lanes.length} lanes)`}
            <ChevronRight className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`} />
          </button>
        </>
      )}

      <div className="pt-3 border-t border-white/5 flex items-start gap-2">
        <Info className="w-3 h-3 text-white/20 flex-shrink-0 mt-0.5" />
        <p className="text-[10px] text-white/25 leading-relaxed">All insights are computed from your imported stats. No hallucinated analysis.</p>
      </div>
    </div>
  )
}
