'use client'

import { useState } from 'react'
import type { FranchiseRoadmap, YearPlan, DynastyRoadmapExtension, DevyRoadmapExtension, C2CRoadmapExtension } from '@/lib/franchise-roadmap'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function phaseColor(phase: string): string {
  const colors: Record<string, string> = {
    contending: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
    aging_contender: 'bg-amber-500/15 text-amber-400 border-amber-500/25',
    retooling: 'bg-blue-500/15 text-blue-400 border-blue-500/25',
    rebuilding: 'bg-red-500/15 text-red-400 border-red-500/25',
    emerging: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/25',
    prospect_heavy: 'bg-purple-500/15 text-purple-400 border-purple-500/25',
    misaligned: 'bg-orange-500/15 text-orange-400 border-orange-500/25',
  }
  return colors[phase] ?? 'bg-zinc-500/15 text-zinc-400 border-zinc-500/25'
}

function modeLabel(mode: string): string {
  return { dynasty: 'Dynasty', devy: 'Devy', c2c: 'C2C' }[mode] ?? mode
}

function windowColor(strength: string): string {
  if (strength === 'strong') return 'text-emerald-400'
  if (strength === 'moderate') return 'text-amber-400'
  return 'text-red-400'
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
// Hero Section
// ---------------------------------------------------------------------------

function HeroSection({ roadmap: r }: { roadmap: FranchiseRoadmap }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
      {/* Mode + Phase badges */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-bold px-2.5 py-1 rounded bg-white/10 text-white border border-white/20">
          {modeLabel(r.mode)} Roadmap
        </span>
        <span className={`text-xs font-medium px-2 py-0.5 rounded border ${phaseColor(r.currentPhase)}`}>
          {r.currentPhase.replace(/_/g, ' ')}
        </span>
        <span className="text-[11px] text-zinc-500">{r.confidencePct}% confidence | {r.horizonYears}-year plan</span>
      </div>

      {/* Championship Window */}
      {r.championshipWindow.startYear && (
        <div className="bg-zinc-800/50 rounded-lg p-3 flex items-center justify-between">
          <div>
            <span className="text-[11px] text-zinc-500 uppercase block">Championship Window</span>
            <span className={`text-lg font-bold ${windowColor(r.championshipWindow.windowStrength)}`}>
              {r.championshipWindow.startYear}–{r.championshipWindow.endYear ?? '?'}
            </span>
          </div>
          <span className={`text-xs font-medium px-2 py-0.5 rounded ${
            r.championshipWindow.windowStrength === 'strong' ? 'bg-emerald-500/15 text-emerald-400' :
            r.championshipWindow.windowStrength === 'moderate' ? 'bg-amber-500/15 text-amber-400' :
            'bg-red-500/15 text-red-400'
          }`}>
            {r.championshipWindow.windowStrength}
          </span>
        </div>
      )}
      {!r.championshipWindow.startYear && (
        <div className="bg-zinc-800/50 rounded-lg p-3">
          <span className="text-[11px] text-zinc-500 uppercase block">Championship Window</span>
          <span className="text-sm text-red-400">No current window — focus on building</span>
        </div>
      )}

      {/* Strategy summary */}
      <div>
        <span className="text-[11px] text-zinc-500 uppercase block mb-0.5">Strategy</span>
        <p className="text-sm text-zinc-300 leading-relaxed">{r.overallStrategy}</p>
      </div>

      {/* Roster identity */}
      <p className="text-xs text-zinc-500">{r.rosterIdentity}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Strengths / Weaknesses
// ---------------------------------------------------------------------------

function StrengthWeakness({ strengths, weaknesses }: { strengths: string[]; weaknesses: string[] }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="bg-emerald-500/5 border border-emerald-500/15 rounded-lg p-3">
        <h4 className="text-[11px] text-emerald-500 uppercase font-medium mb-1">Strengths</h4>
        {strengths.length > 0 ? (
          <ul className="text-xs text-zinc-400 space-y-0.5">
            {strengths.map((s, i) => <li key={i}>✓ {s}</li>)}
          </ul>
        ) : <p className="text-xs text-zinc-500">None identified</p>}
      </div>
      <div className="bg-red-500/5 border border-red-500/15 rounded-lg p-3">
        <h4 className="text-[11px] text-red-500 uppercase font-medium mb-1">Weaknesses</h4>
        {weaknesses.length > 0 ? (
          <ul className="text-xs text-zinc-400 space-y-0.5">
            {weaknesses.map((w, i) => <li key={i}>✗ {w}</li>)}
          </ul>
        ) : <p className="text-xs text-zinc-500">None identified</p>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Action Lists
// ---------------------------------------------------------------------------

function ActionList({ title, items, color, icon }: { title: string; items: string[]; color: string; icon: string }) {
  if (items.length === 0) return null
  return (
    <div className={`rounded-lg p-3 border ${color}`}>
      <h4 className="text-[11px] uppercase font-medium mb-1 opacity-80">{icon} {title}</h4>
      <ul className="text-xs text-zinc-400 space-y-0.5">
        {items.map((item, i) => <li key={i}>• {item}</li>)}
      </ul>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Asset Strategy
// ---------------------------------------------------------------------------

function AssetStrategySection({ strategy }: { strategy: FranchiseRoadmap['assetStrategy'] }) {
  const cards = [
    { label: 'Veterans', text: strategy.veterans, icon: '👨‍💼' },
    { label: 'Young Core', text: strategy.youngCore, icon: '🌱' },
    { label: 'Picks', text: strategy.picks, icon: '🎯' },
    { label: 'Prospects', text: strategy.prospects, icon: '🔮' },
  ]
  return (
    <div className="grid grid-cols-2 gap-2">
      {cards.map(c => (
        <div key={c.label} className="bg-zinc-800/50 rounded-lg p-2.5 border border-zinc-700">
          <span className="text-[11px] text-zinc-500 uppercase">{c.icon} {c.label}</span>
          <p className="text-xs text-zinc-400 mt-0.5">{c.text}</p>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Year Plan Timeline
// ---------------------------------------------------------------------------

function YearPlanCard({ plan, expanded, onToggle }: { plan: YearPlan; expanded: boolean; onToggle: () => void }) {
  return (
    <div className="relative pl-6">
      {/* Timeline dot */}
      <div className="absolute left-0 top-3 w-3 h-3 rounded-full bg-zinc-700 border-2 border-zinc-500" />
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
        <button onClick={onToggle} className="w-full p-3 text-left hover:bg-zinc-800/50 transition-colors">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs font-bold text-white">{plan.year}</span>
              <span className="text-xs text-zinc-500 ml-2">{plan.label}</span>
            </div>
            <span className="text-[11px] text-zinc-600">{expanded ? '▲' : '▼'}</span>
          </div>
          <p className="text-xs text-zinc-400 mt-0.5">{plan.objective}</p>
        </button>
        {expanded && (
          <div className="px-3 pb-3 pt-0 border-t border-zinc-800 space-y-2">
            <div>
              <span className="text-[11px] text-zinc-500 uppercase">Priorities</span>
              <ul className="text-xs text-zinc-400 space-y-0.5">
                {plan.priorities.map((p, i) => <li key={i}>• {p}</li>)}
              </ul>
            </div>
            <div>
              <span className="text-[11px] text-zinc-500 uppercase">Recommended Moves</span>
              <ul className="text-xs text-zinc-400 space-y-0.5">
                {plan.recommendedMoves.map((m, i) => <li key={i}>→ {m}</li>)}
              </ul>
            </div>
            {plan.riskWatch.length > 0 && (
              <div>
                <span className="text-[11px] text-red-400 uppercase">Risk Watch</span>
                <ul className="text-xs text-zinc-400 space-y-0.5">
                  {plan.riskWatch.map((r, i) => <li key={i}>⚠ {r}</li>)}
                </ul>
              </div>
            )}
            <div className="bg-zinc-800/50 rounded px-2 py-1">
              <span className="text-[11px] text-zinc-500">Milestone: </span>
              <span className="text-xs text-zinc-300">{plan.milestoneToReach}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Mode-Specific Panels
// ---------------------------------------------------------------------------

function DynastyPanel({ ext }: { ext: DynastyRoadmapExtension }) {
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold text-white">Dynasty Details</h4>
      <div className="space-y-1.5">
        <ScoreBar score={ext.rosterAgeScore} label="Roster Age Score" />
        <ScoreBar score={ext.contenderScore} label="Contender Score" />
        <ScoreBar score={ext.futureFlexibilityScore} label="Future Flexibility" />
      </div>
      {ext.veteranSellSignals.length > 0 && (
        <ActionList title="Veteran Sell Signals" items={ext.veteranSellSignals} color="bg-amber-500/5 border-amber-500/15 text-amber-400" icon="📉" />
      )}
      {ext.youngCoreFoundation.length > 0 && (
        <ActionList title="Young Core Foundation" items={ext.youngCoreFoundation} color="bg-emerald-500/5 border-emerald-500/15 text-emerald-400" icon="🌱" />
      )}
      <div className="bg-zinc-800/50 rounded-lg p-2.5 border border-zinc-700">
        <span className="text-[11px] text-zinc-500 uppercase">Pick Leverage</span>
        <p className="text-xs text-zinc-400 mt-0.5">{ext.pickLeverageAdvice}</p>
      </div>
    </div>
  )
}

function DevyPanel({ ext }: { ext: DevyRoadmapExtension }) {
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold text-white">Devy Pipeline</h4>
      <ScoreBar score={ext.pipelineStrengthScore} label="Pipeline Strength" />
      <div className="bg-zinc-800/50 rounded-lg p-2.5 border border-zinc-700">
        <span className="text-[11px] text-zinc-500 uppercase">Timeline Health</span>
        <p className="text-xs text-zinc-400 mt-0.5">{ext.devyTimelineHealth}</p>
      </div>
      {ext.stashPriorityTargets.length > 0 && <ActionList title="Stash" items={ext.stashPriorityTargets} color="bg-purple-500/5 border-purple-500/15 text-purple-400" icon="📦" />}
      {ext.holdCandidates.length > 0 && <ActionList title="Hold" items={ext.holdCandidates} color="bg-emerald-500/5 border-emerald-500/15 text-emerald-400" icon="🤲" />}
      {ext.flipCandidates.length > 0 && <ActionList title="Flip" items={ext.flipCandidates} color="bg-amber-500/5 border-amber-500/15 text-amber-400" icon="🔄" />}
      {ext.classBalanceNotes.length > 0 && (
        <div className="flex gap-1.5 flex-wrap">
          {ext.classBalanceNotes.map((n, i) => (
            <span key={i} className="text-[11px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">{n}</span>
          ))}
        </div>
      )}
    </div>
  )
}

function C2CPanel({ ext }: { ext: C2CRoadmapExtension }) {
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold text-white">C2C Dual-Window</h4>
      <div className="grid grid-cols-3 gap-2">
        <div className="text-center">
          <div className={`text-lg font-bold ${ext.collegeWindowScore >= 60 ? 'text-emerald-400' : ext.collegeWindowScore >= 40 ? 'text-amber-400' : 'text-red-400'}`}>{ext.collegeWindowScore}</div>
          <div className="text-[11px] text-zinc-500 uppercase">College</div>
        </div>
        <div className="text-center">
          <div className={`text-lg font-bold ${ext.alignmentScore >= 60 ? 'text-emerald-400' : ext.alignmentScore >= 40 ? 'text-amber-400' : 'text-red-400'}`}>{ext.alignmentScore}</div>
          <div className="text-[11px] text-zinc-500 uppercase">Alignment</div>
        </div>
        <div className="text-center">
          <div className={`text-lg font-bold ${ext.proWindowScore >= 60 ? 'text-emerald-400' : ext.proWindowScore >= 40 ? 'text-amber-400' : 'text-red-400'}`}>{ext.proWindowScore}</div>
          <div className="text-[11px] text-zinc-500 uppercase">Pro</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-blue-500/5 border border-blue-500/15 rounded-lg p-2">
          <span className="text-[11px] text-blue-400 uppercase font-medium">College Strategy</span>
          <p className="text-xs text-zinc-400 mt-0.5">{ext.collegeSideStrategy}</p>
        </div>
        <div className="bg-purple-500/5 border border-purple-500/15 rounded-lg p-2">
          <span className="text-[11px] text-purple-400 uppercase font-medium">Pro Strategy</span>
          <p className="text-xs text-zinc-400 mt-0.5">{ext.proSideStrategy}</p>
        </div>
      </div>
      <div className="bg-zinc-800/50 rounded-lg p-2.5 border border-zinc-700">
        <span className="text-[11px] text-zinc-500 uppercase">Pipeline Health</span>
        <p className="text-xs text-zinc-400 mt-0.5">{ext.promotionPipelineHealth}</p>
      </div>
      {ext.dualWindowWarnings.length > 0 && (
        <ActionList title="Warnings" items={ext.dualWindowWarnings} color="bg-red-500/5 border-red-500/15 text-red-400" icon="⚠️" />
      )}
      {ext.campusToProRecommendations.length > 0 && (
        <ActionList title="Campus → Pro Recommendations" items={ext.campusToProRecommendations} color="bg-cyan-500/5 border-cyan-500/15 text-cyan-400" icon="🎓" />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Panel
// ---------------------------------------------------------------------------

export default function FranchiseRoadmapPanel({ roadmap }: { roadmap: FranchiseRoadmap }) {
  const [expandedYear, setExpandedYear] = useState<number | null>(roadmap.yearPlans[0]?.year ?? null)
  const [showDetails, setShowDetails] = useState(false)
  const r = roadmap

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      {/* Hero */}
      <HeroSection roadmap={r} />

      {/* Strengths / Weaknesses */}
      <StrengthWeakness strengths={r.strengths} weaknesses={r.weaknesses} />

      {/* Urgent + Avoid */}
      <div className="grid grid-cols-2 gap-2">
        <ActionList title="Urgent Moves" items={r.urgentMoves} color="bg-red-500/5 border-red-500/15 text-red-400" icon="🔥" />
        <ActionList title="Avoid" items={r.avoidMoves} color="bg-zinc-800 border-zinc-700 text-zinc-400" icon="🚫" />
      </div>

      {/* Asset Strategy */}
      <AssetStrategySection strategy={r.assetStrategy} />

      {/* Year-by-Year Timeline */}
      <div>
        <h3 className="text-sm font-semibold text-white mb-2">Year-by-Year Roadmap</h3>
        <div className="space-y-2 border-l-2 border-zinc-700 ml-1.5">
          {r.yearPlans.map((plan) => (
            <YearPlanCard
              key={plan.year}
              plan={plan}
              expanded={expandedYear === plan.year}
              onToggle={() => setExpandedYear(expandedYear === plan.year ? null : plan.year)}
            />
          ))}
        </div>
      </div>

      {/* Mode-Specific Extensions */}
      {r.dynastyExtension && <DynastyPanel ext={r.dynastyExtension} />}
      {r.devyExtension && <DevyPanel ext={r.devyExtension} />}
      {r.c2cExtension && <C2CPanel ext={r.c2cExtension} />}

      {/* Expand: Risk, Trade Strategy, Draft, AI Notes */}
      <button
        onClick={() => setShowDetails(!showDetails)}
        className="w-full text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors py-1"
      >
        {showDetails ? '▲ Hide details' : '▼ Risk factors, trade strategy, draft advice, AI notes'}
      </button>

      {showDetails && (
        <div className="space-y-3">
          {r.riskFactors.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {r.riskFactors.map((f, i) => (
                <span key={i} className="text-[11px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20">{f}</span>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div className="bg-zinc-800/50 rounded-lg p-2.5 border border-zinc-700">
              <span className="text-[11px] text-zinc-500 uppercase">Trade Strategy</span>
              <p className="text-xs text-zinc-400 mt-0.5">{r.tradeStrategy}</p>
            </div>
            <div className="bg-zinc-800/50 rounded-lg p-2.5 border border-zinc-700">
              <span className="text-[11px] text-zinc-500 uppercase">Draft Capital</span>
              <p className="text-xs text-zinc-400 mt-0.5">{r.draftCapitalAdvice}</p>
            </div>
          </div>

          {r.marketInefficiencies.length > 0 && (
            <ActionList title="Market Inefficiencies" items={r.marketInefficiencies} color="bg-cyan-500/5 border-cyan-500/15 text-cyan-400" icon="💡" />
          )}

          <div className="bg-zinc-800/50 rounded-lg p-2.5 border border-zinc-700">
            <span className="text-[11px] text-zinc-500 uppercase">Timeline Summary</span>
            <p className="text-xs text-zinc-400 mt-0.5">{r.timelineSummary}</p>
          </div>

          {r.aiNotes.length > 0 && (
            <div>
              <span className="text-[11px] text-zinc-500 uppercase">AI Notes</span>
              {r.aiNotes.map((n, i) => <p key={i} className="text-xs text-zinc-400">{n}</p>)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
