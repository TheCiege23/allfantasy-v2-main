'use client'
import { useState } from 'react'
import { Info, X } from 'lucide-react'
import type { CompositeProfile, StrengthTag, SubGrade } from '@/lib/legacy/overview-scoring'

const TAG_COLORS: Record<string, string> = {
  amber: 'bg-amber-500/20 border-amber-400/30 text-amber-200',
  cyan: 'bg-cyan-500/20 border-cyan-400/30 text-cyan-200',
  emerald: 'bg-emerald-500/20 border-emerald-400/30 text-emerald-200',
  purple: 'bg-purple-500/20 border-purple-400/30 text-purple-200',
  rose: 'bg-rose-500/20 border-rose-400/30 text-rose-200',
}

function gradeColor(grade: string): string {
  if (grade.startsWith('A')) return 'text-emerald-300'
  if (grade.startsWith('B')) return 'text-cyan-300'
  if (grade.startsWith('C')) return 'text-yellow-300'
  if (grade.startsWith('D')) return 'text-orange-300'
  return 'text-red-300'
}

function TagBadge({ tag }: { tag: StrengthTag }) {
  const colorClass = TAG_COLORS[tag.color] ?? TAG_COLORS.cyan
  return (
    <span className={`px-3 py-1 rounded-full border text-xs font-medium ${colorClass}`}>
      {tag.label}
    </span>
  )
}

function SubGradeCard({ subGrade }: { subGrade: SubGrade }) {
  return (
    <div className="text-center p-3 rounded-xl bg-black/20 border border-white/10">
      <div className={`text-2xl font-bold ${gradeColor(subGrade.grade)}`}>{subGrade.grade}</div>
      <div className="text-[10px] text-white/40 mt-1">{subGrade.label}</div>
    </div>
  )
}

export default function OverviewReportCard({
  profile,
  tierName,
  tierLevel,
  careerXp,
}: {
  profile: CompositeProfile
  tierName?: string
  tierLevel?: number
  careerXp?: number
}) {
  const [showTooltip, setShowTooltip] = useState(false)

  return (
    <div className="relative rounded-3xl bg-gradient-to-br from-slate-900/90 via-slate-900/80 to-slate-950/90 border border-cyan-500/30 backdrop-blur-xl shadow-[0_20px_60px_rgba(0,0,0,0.5)]">
      <div className="h-2 bg-gradient-to-r from-cyan-400 via-purple-500 to-cyan-400 rounded-t-3xl" />
      <div className="p-6 sm:p-8">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
          <div className="col-span-1 text-center p-4 rounded-2xl bg-gradient-to-br from-purple-500/15 to-cyan-500/10 border border-purple-400/30 relative">
            <div className="flex items-center justify-center gap-1.5 mb-2">
              <div className="text-xs uppercase tracking-widest text-purple-400/80">Legacy Score</div>
              <button
                onClick={() => setShowTooltip(!showTooltip)}
                className="w-4 h-4 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition"
              >
                <Info className="w-2.5 h-2.5 text-white/50" />
              </button>
            </div>
            <div className="text-5xl sm:text-6xl font-black text-white">{profile.legacyScore}</div>
            <div className="text-[10px] text-white/40 mt-1">out of 100</div>

            {showTooltip && (
              <div className="absolute z-20 left-1/2 -translate-x-1/2 top-full mt-2 w-64 p-3 rounded-xl bg-slate-800 border border-white/15 shadow-xl text-left">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <span className="text-xs font-semibold text-white/80">What this means</span>
                  <button onClick={() => setShowTooltip(false)} className="text-white/40 hover:text-white/70">
                    <X className="w-3 h-3" />
                  </button>
                </div>
                <p className="text-[11px] text-white/60 leading-relaxed">
                  Your Legacy Score combines <span className="text-cyan-300">volume</span> (how many leagues you play) and <span className="text-purple-300">difficulty</span> (SF, TEP, large leagues). Higher difficulty leagues earn more credit. Win rate, playoff rate, and championships are all weighted and difficulty-adjusted.
                </p>
                <div className="mt-2 text-[10px] text-white/40 space-y-0.5">
                  <div>Win Rate: 30% weight</div>
                  <div>Playoff Rate: 25% weight</div>
                  <div>Championships: 25% weight</div>
                  <div>Volume + Difficulty: 20% weight</div>
                </div>
              </div>
            )}
          </div>

          <div className="col-span-1 text-center p-4 rounded-2xl bg-gradient-to-br from-cyan-500/15 to-purple-500/10 border border-cyan-400/30">
            <div className="text-xs uppercase tracking-widest text-cyan-400/80 mb-2">Legacy Tier</div>
            <div className="text-2xl sm:text-3xl font-black text-white mt-2">
              {tierName || 'Competitor'}
            </div>
            {tierLevel != null && (
              <div className="text-xs text-white/40 mt-1">Level {tierLevel}</div>
            )}
          </div>

          <div className="col-span-2 md:col-span-1 p-4 rounded-2xl bg-black/30 border border-white/10">
            <div className="text-xs uppercase tracking-widest text-white/50 mb-3">Win Rate</div>
            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-white/50">Raw</span>
                <span className="text-lg font-bold text-white">{profile.rawWinRate}%</span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-cyan-300/70">Difficulty-adjusted</span>
                <span className="text-lg font-bold text-cyan-300">{profile.adjustedWinRate}%</span>
              </div>
              <div className="text-[10px] text-white/30 mt-1">
                Avg difficulty: {profile.difficultyMultiplier}x
              </div>
            </div>
          </div>
        </div>

        <div className="mb-6 rounded-xl bg-gradient-to-r from-cyan-500/8 to-purple-500/8 border border-white/8 p-4">
          <div className="text-xs uppercase tracking-widest text-white/40 mb-3">Difficulty-Adjusted Performance</div>
          <div className="grid grid-cols-3 gap-3">
            {profile.lanes.map((lane) => (
              <div key={lane.leagueClass} className="text-center">
                <div className="text-[10px] text-white/50 mb-1">{lane.label.replace(' Career', '').replace(' Formats', '')}</div>
                <div className="text-lg font-bold text-cyan-200">{lane.adjustedWinRate}%</div>
                <div className="text-[9px] text-white/30">
                  raw {lane.winRate}% &middot; {lane.difficultyScore}x diff
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mb-6">
          <div className="text-xs uppercase tracking-widest text-white/40 mb-3">Strength Tags</div>
          <div className="flex flex-wrap gap-2">
            {profile.strengthTags.map((tag, i) => (
              <TagBadge key={i} tag={tag} />
            ))}
          </div>
        </div>

        <div>
          <div className="text-xs uppercase tracking-widest text-white/40 mb-3">Skill Grades</div>
          <div className="grid grid-cols-3 gap-3">
            {profile.subGrades.map((sg, i) => (
              <SubGradeCard key={i} subGrade={sg} />
            ))}
          </div>
        </div>

        <div className="flex items-center justify-center gap-2 text-xs text-white/40 mt-6">
          <span className="text-white/20">|</span>
          <span>Read-only analysis</span>
          <span className="text-white/20">|</span>
          <span>No passwords</span>
        </div>
      </div>
    </div>
  )
}
