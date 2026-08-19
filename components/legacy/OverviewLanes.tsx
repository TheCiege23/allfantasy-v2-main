'use client'
import { useState } from 'react'
import { Trophy, TrendingUp, Target, Zap } from 'lucide-react'
import type { LaneStats } from '@/lib/legacy/overview-scoring'

const LANE_CONFIGS: Record<string, { icon: typeof Trophy; gradient: string; accent: string; border: string }> = {
  dynasty: { icon: Trophy, gradient: 'from-amber-500/15 to-orange-500/10', accent: 'text-amber-300', border: 'border-amber-500/25' },
  redraft: { icon: Zap, gradient: 'from-cyan-500/15 to-blue-500/10', accent: 'text-cyan-300', border: 'border-cyan-500/25' },
  specialty: { icon: Target, gradient: 'from-purple-500/15 to-rose-500/10', accent: 'text-purple-300', border: 'border-purple-500/25' },
}

const TAB_STYLES: Record<string, { active: string; inactive: string }> = {
  all: { active: 'bg-white/15 text-white border-white/25', inactive: 'text-white/50 hover:text-white/70' },
  dynasty: { active: 'bg-amber-500/20 text-amber-200 border-amber-400/30', inactive: 'text-amber-300/50 hover:text-amber-300/80' },
  redraft: { active: 'bg-cyan-500/20 text-cyan-200 border-cyan-400/30', inactive: 'text-cyan-300/50 hover:text-cyan-300/80' },
  specialty: { active: 'bg-purple-500/20 text-purple-200 border-purple-400/30', inactive: 'text-purple-300/50 hover:text-purple-300/80' },
}

function LaneCard({ lane }: { lane: LaneStats }) {
  const config = LANE_CONFIGS[lane.leagueClass] ?? LANE_CONFIGS.redraft

  return (
    <div className={`rounded-2xl bg-gradient-to-br ${config.gradient} border ${config.border} p-5 space-y-4`}>
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-xl bg-black/20 flex items-center justify-center`}>
          <config.icon className={`w-5 h-5 ${config.accent}`} />
        </div>
        <div>
          <h4 className={`text-lg font-bold ${config.accent}`}>{lane.label}</h4>
          <p className="text-xs text-white/50">{lane.leagues} league{lane.leagues !== 1 ? 's' : ''}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="text-center p-2.5 rounded-xl bg-black/20 border border-white/5">
          <div className="text-lg font-bold text-white">{lane.wins}-{lane.losses}{lane.ties > 0 ? `-${lane.ties}` : ''}</div>
          <div className="text-[10px] text-white/40 mt-0.5">Record</div>
        </div>
        <div className="text-center p-2.5 rounded-xl bg-black/20 border border-white/5">
          <div className="text-lg font-bold text-emerald-300">{lane.playoffRate}%</div>
          <div className="text-[10px] text-white/40 mt-0.5">Playoff Rate</div>
        </div>
        <div className="text-center p-2.5 rounded-xl bg-black/20 border border-white/5">
          <div className="text-lg font-bold text-amber-300">{lane.championshipRate}%</div>
          <div className="text-[10px] text-white/40 mt-0.5">Ship Rate</div>
        </div>
        <div className="text-center p-2.5 rounded-xl bg-black/20 border border-white/5">
          <div className="text-lg font-bold text-purple-300">{lane.difficultyScore}x</div>
          <div className="text-[10px] text-white/40 mt-0.5">Difficulty</div>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-start gap-2">
          <TrendingUp className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-white/70 leading-relaxed">{lane.topStrength}</p>
        </div>
        <div className="flex items-start gap-2">
          <Target className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-white/60 leading-relaxed">{lane.nextEdge}</p>
        </div>
      </div>

      {lane.adjustedWinRate > lane.winRate + 1 && (
        <div className="px-3 py-2 rounded-xl bg-black/20 border border-white/5">
          <p className="text-[11px] text-white/50">
            In tougher formats, you perform at <span className="text-cyan-300 font-semibold">{lane.adjustedWinRate}%</span>
            {' '}(raw: {lane.winRate}%)
          </p>
        </div>
      )}
    </div>
  )
}

type LaneFilter = 'all' | 'dynasty' | 'redraft' | 'specialty'

export default function OverviewLanes({ lanes }: { lanes: LaneStats[] }) {
  const [activeLane, setActiveLane] = useState<LaneFilter>('all')

  if (lanes.length === 0) return null

  const availableTabs: { id: LaneFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    ...lanes.map(l => ({
      id: l.leagueClass as LaneFilter,
      label: l.label.replace(' Career', '').replace(' Formats', ''),
    })),
  ]

  const filteredLanes = activeLane === 'all'
    ? lanes
    : lanes.filter(l => l.leagueClass === activeLane)

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold text-white flex items-center gap-2">
        Career Breakdown
        <span className="text-xs font-normal text-white/40">by league type</span>
      </h3>

      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {availableTabs.map(tab => {
          const style = TAB_STYLES[tab.id] ?? TAB_STYLES.all
          const isActive = activeLane === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => setActiveLane(tab.id)}
              className={`px-3.5 py-1.5 rounded-full text-xs font-medium border transition whitespace-nowrap ${
                isActive ? style.active : `${style.inactive} border-transparent`
              }`}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      <div className="grid gap-4">
        {filteredLanes.map(lane => (
          <LaneCard key={lane.leagueClass} lane={lane} />
        ))}
      </div>
    </div>
  )
}
