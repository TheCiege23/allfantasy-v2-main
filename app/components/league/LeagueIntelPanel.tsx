'use client'

import { useState } from 'react'
import type { LeagueIntelResult, TeamIntelCard, LeagueWideInsights } from '@/lib/league-intelligence'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function gradeColor(grade: string): string {
  if (grade === 'S' || grade === 'A+') return 'text-emerald-400'
  if (grade === 'A' || grade === 'B+') return 'text-green-400'
  if (grade === 'B' || grade === 'C+') return 'text-amber-400'
  if (grade === 'C' || grade === 'D') return 'text-orange-400'
  return 'text-red-400'
}

function gradeBg(grade: string): string {
  if (grade === 'S' || grade === 'A+') return 'bg-emerald-500/15 border-emerald-500/25'
  if (grade === 'A' || grade === 'B+') return 'bg-green-500/15 border-green-500/25'
  if (grade === 'B' || grade === 'C+') return 'bg-amber-500/15 border-amber-500/25'
  if (grade === 'C' || grade === 'D') return 'bg-orange-500/15 border-orange-500/25'
  return 'bg-red-500/15 border-red-500/25'
}

function categoryLabel(cat: string): string {
  const labels: Record<string, string> = {
    elite_contender: 'Elite Contender',
    contender: 'Contender',
    playoff_bubble: 'Playoff Bubble',
    middle_pack: 'Middle Pack',
    retooling: 'Retooling',
    rebuilding: 'Rebuilding',
    tanking: 'Tanking',
  }
  return labels[cat] ?? cat
}

function categoryColor(cat: string): string {
  if (cat === 'elite_contender' || cat === 'contender') return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
  if (cat === 'playoff_bubble') return 'bg-amber-500/10 text-amber-400 border-amber-500/20'
  if (cat === 'middle_pack') return 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20'
  return 'bg-red-500/10 text-red-400 border-red-500/20'
}

function trendIcon(trend: string): string {
  if (trend === 'rising') return '📈'
  if (trend === 'falling') return '📉'
  if (trend === 'volatile') return '🎢'
  return '➡️'
}

function ScoreBar({ score, label }: { score: number; label: string }) {
  const color = score >= 70 ? 'bg-emerald-500' : score >= 45 ? 'bg-amber-500' : 'bg-red-500'
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-[11px]">
        <span className="text-zinc-500">{label}</span>
        <span className="text-zinc-400">{score}</span>
      </div>
      <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${score}%` }} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// League Insight Callouts
// ---------------------------------------------------------------------------

function InsightCallout({ label, teamName, reason, color }: {
  label: string; teamName: string; reason: string; color: string
}) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${color}`}>
      <div className="text-[11px] uppercase font-medium opacity-70">{label}</div>
      <div className="text-xs font-semibold text-white mt-0.5">{teamName}</div>
      <div className="text-[11px] text-zinc-400 mt-0.5">{reason}</div>
    </div>
  )
}

function LeagueInsightsBar({ insights }: { insights: LeagueWideInsights }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <InsightCallout
        label="Strongest Team"
        teamName={insights.strongestTeam.teamName}
        reason={insights.strongestTeam.reason}
        color="bg-emerald-500/5 border-emerald-500/15"
      />
      {insights.mostOverratedTeam && (
        <InsightCallout
          label="Most Overrated"
          teamName={insights.mostOverratedTeam.teamName}
          reason={insights.mostOverratedTeam.reason}
          color="bg-amber-500/5 border-amber-500/15"
        />
      )}
      {insights.mostDangerousUnderdog && (
        <InsightCallout
          label="Dangerous Underdog"
          teamName={insights.mostDangerousUnderdog.teamName}
          reason={insights.mostDangerousUnderdog.reason}
          color="bg-purple-500/5 border-purple-500/15"
        />
      )}
      {insights.bestRebuild && (
        <InsightCallout
          label="Best Rebuild"
          teamName={insights.bestRebuild.teamName}
          reason={insights.bestRebuild.reason}
          color="bg-blue-500/5 border-blue-500/15"
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Team Card
// ---------------------------------------------------------------------------

function TeamCard({ card, expanded, onToggle }: {
  card: TeamIntelCard
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      <button onClick={onToggle} className="w-full p-3 text-left hover:bg-zinc-800/50 transition-colors">
        <div className="flex items-center justify-between gap-3">
          {/* Left: rank + name + category */}
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            <div className={`w-10 h-10 rounded-lg border flex items-center justify-center text-sm font-bold ${gradeBg(card.grade)} ${gradeColor(card.grade)}`}>
              {card.grade}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-white truncate">{card.teamName}</div>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className={`text-[11px] px-1.5 py-0.5 rounded border ${categoryColor(card.category)}`}>
                  {categoryLabel(card.category)}
                </span>
                <span className="text-[11px] text-zinc-500">{trendIcon(card.trend)} {card.trend}</span>
              </div>
            </div>
          </div>

          {/* Right: power score + luck */}
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className={`text-lg font-bold ${card.powerScore >= 70 ? 'text-emerald-400' : card.powerScore >= 45 ? 'text-amber-400' : 'text-red-400'}`}>
                {card.powerScore}
              </div>
              <div className="text-[11px] text-zinc-500 uppercase">Power</div>
            </div>
            <div className="text-right">
              <div className={`text-sm font-medium ${card.luckScore >= 60 ? 'text-emerald-400' : card.luckScore <= 40 ? 'text-red-400' : 'text-zinc-400'}`}>
                {card.luckScore >= 60 ? '🍀' : card.luckScore <= 40 ? '😤' : '⚖️'} {card.luckScore}
              </div>
              <div className="text-[11px] text-zinc-500 uppercase">Luck</div>
            </div>
          </div>
        </div>

        {/* Quick summary */}
        <div className="flex gap-3 mt-2 text-[11px] text-zinc-500">
          <span>Strength: {card.biggestStrength}</span>
          <span>•</span>
          <span>Weakness: {card.biggestWeakness}</span>
        </div>
      </button>

      {/* Expanded */}
      {expanded && (
        <div className="px-3 pb-3 pt-0 border-t border-zinc-800 space-y-3">
          {/* Score bars */}
          <div className="space-y-1.5 pt-2">
            <ScoreBar score={card.championshipWindowScore} label="Championship Window" />
            <ScoreBar score={card.rosterHealthScore} label="Roster Health" />
            <ScoreBar score={card.depthScore} label="Depth" />
            <ScoreBar score={card.futureAssetScore} label="Future Assets" />
          </div>

          {/* Recommendation */}
          <div className="bg-zinc-800/50 rounded-lg p-2.5">
            <span className="text-[11px] text-zinc-500 uppercase block mb-0.5">Recommended Action</span>
            <p className="text-xs text-white font-medium">{card.recommendedAction.replace(/_/g, ' ')}</p>
            <p className="text-xs text-zinc-400 mt-0.5">{card.recommendationExplanation}</p>
          </div>

          {/* Future outlook */}
          <div>
            <span className="text-[11px] text-zinc-500 uppercase">Outlook</span>
            <p className="text-xs text-zinc-400">{card.futureOutlook}</p>
          </div>

          {/* Needs + Surplus */}
          <div className="flex gap-3">
            {card.needs.length > 0 && (
              <div>
                <span className="text-[11px] text-red-400 uppercase">Needs</span>
                <div className="flex gap-1 mt-0.5 flex-wrap">
                  {card.needs.map(n => (
                    <span key={n} className="text-[11px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20">{n}</span>
                  ))}
                </div>
              </div>
            )}
            {card.surplus.length > 0 && (
              <div>
                <span className="text-[11px] text-emerald-400 uppercase">Surplus</span>
                <div className="flex gap-1 mt-0.5 flex-wrap">
                  {card.surplus.map(s => (
                    <span key={s} className="text-[11px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">{s}</span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Values */}
          <div className="flex gap-3 text-[11px] text-zinc-500">
            <span>Starters: {card.starterValue.toLocaleString()}</span>
            <span>Bench: {card.benchValue.toLocaleString()}</span>
            <span>Picks: {card.pickValue.toLocaleString()}</span>
          </div>

          {/* Risk flags */}
          {card.riskFlags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {card.riskFlags.map(f => (
                <span key={f} className="text-[11px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20">
                  {f.replace(/_/g, ' ')}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tier Section
// ---------------------------------------------------------------------------

type TierFilter = 'all' | 'contenders' | 'bubble' | 'middle' | 'rebuilders'

function filterCards(cards: TeamIntelCard[], filter: TierFilter): TeamIntelCard[] {
  if (filter === 'all') return cards
  if (filter === 'contenders') return cards.filter(c => c.category === 'elite_contender' || c.category === 'contender')
  if (filter === 'bubble') return cards.filter(c => c.category === 'playoff_bubble')
  if (filter === 'middle') return cards.filter(c => c.category === 'middle_pack' || c.category === 'retooling')
  if (filter === 'rebuilders') return cards.filter(c => c.category === 'rebuilding' || c.category === 'tanking')
  return cards
}

// ---------------------------------------------------------------------------
// Main Panel
// ---------------------------------------------------------------------------

export default function LeagueIntelPanel({ data }: { data: LeagueIntelResult }) {
  const [filter, setFilter] = useState<TierFilter>('all')
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null)

  const filtered = filterCards(data.teamCards, filter)
  const { leagueInsights } = data

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      {/* League Summary Bar */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 flex items-center justify-between">
        <div className="flex gap-3 text-xs">
          <span className="text-emerald-400">{leagueInsights.contenderCount} contender{leagueInsights.contenderCount !== 1 ? 's' : ''}</span>
          <span className="text-red-400">{leagueInsights.rebuilderCount} rebuilder{leagueInsights.rebuilderCount !== 1 ? 's' : ''}</span>
        </div>
        <span className={`text-[11px] px-2 py-0.5 rounded ${
          leagueInsights.leagueCompetitiveness === 'tight' ? 'bg-emerald-500/10 text-emerald-400' :
          leagueInsights.leagueCompetitiveness === 'lopsided' ? 'bg-red-500/10 text-red-400' :
          'bg-amber-500/10 text-amber-400'
        }`}>
          {leagueInsights.leagueCompetitiveness} league
        </span>
      </div>

      {/* Insight Callouts */}
      <LeagueInsightsBar insights={leagueInsights} />

      {/* Tier Filters */}
      <div className="flex gap-1.5 overflow-x-auto pb-0.5">
        {(['all', 'contenders', 'bubble', 'middle', 'rebuilders'] as TierFilter[]).map(f => (
          <button
            key={f}
            onClick={() => { setFilter(f); setExpandedIdx(null) }}
            className={`text-xs px-2.5 py-1 rounded-full whitespace-nowrap transition-colors ${
              filter === f ? 'bg-white text-black font-medium' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
            }`}
          >
            {f === 'all' ? 'All Teams' : f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Team Cards */}
      <div className="space-y-2">
        {filtered.map((card, i) => (
          <TeamCard
            key={card.rosterId}
            card={card}
            expanded={expandedIdx === i}
            onToggle={() => setExpandedIdx(expandedIdx === i ? null : i)}
          />
        ))}
        {filtered.length === 0 && (
          <div className="text-center text-sm text-zinc-500 py-8">No teams match this filter.</div>
        )}
      </div>
    </div>
  )
}
