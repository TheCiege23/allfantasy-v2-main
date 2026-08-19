'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { Layers, Users, Zap, Target, AlertTriangle, ChevronDown, ChevronRight, BarChart3, Loader2 } from 'lucide-react'
import MiniPlayerImg from '@/components/MiniPlayerImg'
import { teamLogoUrl } from '@/lib/media-url'

const POS_COLORS: Record<string, string> = {
  QB: 'bg-red-500/20 text-red-300 border-red-500/30',
  RB: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  WR: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  TE: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
}

const POS_DOT: Record<string, string> = {
  QB: 'bg-red-400', RB: 'bg-emerald-400', WR: 'bg-blue-400', TE: 'bg-amber-400',
}

type ADPPlayer = {
  name: string
  position: string
  team: string | null
  adp: number
  adpTrend: number | null
  value: number | null
  sleeperId?: string | null
}

type ManagerDNACard = {
  manager: string
  teamIdx: number
  reachFrequency: number
  reachLabel: string
  rookieAppetite: number
  rookieLabel: string
  stackTendency: number
  stackLabel: string
  panicResponse: string
  panicScore: number
  overallArchetype: string
  positionalAggression: Record<string, { early: number; mid: number; late: number }>
  tendency: Record<string, number>
  rosterCounts: Record<string, number>
  avatarUrl?: string | null
  platformUserId?: string | null
}

type PickTarget = {
  player: string
  position: string
  probability: number
  why: string
  sleeperId?: string | null
  team?: string | null
  scorecard: {
    adpWeight: number
    teamNeedWeight: number
    managerTendencyWeight: number
    newsImpactWeight: number
    rookieRankBoostWeight: number
  }
}

type PickForecast = {
  overall: number
  round: number
  pick: number
  manager: string
  topTargets: PickTarget[]
  volatility: {
    chaosLevel: 'low' | 'medium' | 'high'
    chaosScore: number
    tierStability: 'stable' | 'fragile'
  }
}

type SnipeAlert = {
  player: string
  position: string
  snipeProbability: number
  snipedByManagers: Array<{ manager: string; probability: number }>
  urgencyLevel: 'critical' | 'warning' | 'watch'
  expectedValueLost: number
  sleeperId?: string | null
  team?: string | null
}

type SnipeRadarEntry = {
  userPickOverall: number
  round: number
  pick: number
  picksBefore: number
  alerts: SnipeAlert[]
}

function TeamLogo({ team, size = 14 }: { team?: string | null; size?: number }) {
  const [err, setErr] = useState(false)
  const src = team ? teamLogoUrl(team) : ''
  if (!src || err) return null
  return (
    <img
      src={src}
      alt={team || ''}
      width={size}
      height={size}
      className="rounded-full bg-black/60 border border-white/10 flex-shrink-0"
      onError={() => setErr(true)}
      loading="lazy"
    />
  )
}

type League = {
  id: string
  name: string
  isDynasty?: boolean
  leagueSize?: number
  teams?: any[]
}

const SCENARIO_OPTIONS = [
  { id: 'heavy_rookie_hype', label: 'Rookie Hype', icon: '🔥', desc: 'Rookies get drafted earlier' },
  { id: 'rb_scarcity_spike', label: 'RB Scarcity', icon: '🏃', desc: 'RBs get scarce fast' },
  { id: 'injury_risk_conservative', label: 'Injury Caution', icon: '🩹', desc: 'Injury-prone players drop' },
  { id: 'league_overvalues_qbs', label: 'QB Premium', icon: '🎯', desc: 'QBs go early' },
]

interface Props {
  leagues: League[]
  username: string
}

export default function MockDraftBoard({ leagues, username }: Props) {
  const [selectedLeague, setSelectedLeague] = useState<string>('')
  const [adpPlayers, setAdpPlayers] = useState<ADPPlayer[]>([])
  const [adpLoading, setAdpLoading] = useState(false)
  const [dnaCards, setDnaCards] = useState<ManagerDNACard[]>([])
  const [dnaLoading, setDnaLoading] = useState(false)
  const [predictions, setPredictions] = useState<PickForecast[]>([])
  const [predLoading, setPredLoading] = useState(false)
  const [snipeEntries, setSnipeEntries] = useState<SnipeRadarEntry[]>([])
  const [snipeLoading, setSnipeLoading] = useState(false)
  const [activeScenarios, setActiveScenarios] = useState<string[]>([])
  const [viewMode, setViewMode] = useState<'board' | 'dna' | 'predictions' | 'snipe'>('board')
  const [rounds, setRounds] = useState(3)
  const [expandedDna, setExpandedDna] = useState<number | null>(null)
  const [expandedPick, setExpandedPick] = useState<number | null>(null)
  const [posFilter, setPosFilter] = useState<string>('ALL')
  const [error, setError] = useState<string | null>(null)

  const league = leagues.find(l => l.id === selectedLeague)

  useEffect(() => {
    if (leagues.length > 0 && !selectedLeague) {
      setSelectedLeague(leagues[0].id)
    }
  }, [leagues, selectedLeague])

  const fetchADP = useCallback(async () => {
    if (!selectedLeague) return
    setAdpLoading(true)
    setError(null)
    try {
      const type = league?.isDynasty ? 'dynasty' : 'redraft'
      const res = await fetch(`/api/mock-draft/adp?type=${type}&limit=250`)
      const data = await res.json()
      if (data.entries) setAdpPlayers(data.entries)
      else setError(data.error || 'Failed to load ADP data')
    } catch {
      setError('Failed to load ADP data')
    } finally {
      setAdpLoading(false)
    }
  }, [selectedLeague, league?.isDynasty])

  const fetchDNA = useCallback(async () => {
    if (!selectedLeague) return
    setDnaLoading(true)
    try {
      const res = await fetch('/api/mock-draft/manager-dna', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId: selectedLeague }),
      })
      const data = await res.json()
      if (data.dnaCards) setDnaCards(data.dnaCards)
    } catch {}
    setDnaLoading(false)
  }, [selectedLeague])

  const fetchPredictions = useCallback(async () => {
    if (!selectedLeague) return
    setPredLoading(true)
    try {
      const res = await fetch('/api/mock-draft/predict-board', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId: selectedLeague, rounds, simulations: 200, scenarios: activeScenarios }),
      })
      const data = await res.json()
      if (data.forecasts) setPredictions(data.forecasts)
    } catch {}
    setPredLoading(false)
  }, [selectedLeague, rounds, activeScenarios])

  const fetchSnipeRadar = useCallback(async () => {
    if (!selectedLeague) return
    setSnipeLoading(true)
    try {
      const res = await fetch('/api/mock-draft/snipe-radar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId: selectedLeague, rounds }),
      })
      const data = await res.json()
      if (data.snipeRadar) setSnipeEntries(data.snipeRadar)
    } catch {}
    setSnipeLoading(false)
  }, [selectedLeague, rounds])

  useEffect(() => {
    if (selectedLeague) {
      fetchADP()
      fetchDNA()
    }
  }, [selectedLeague, fetchADP, fetchDNA])

  const toggleScenario = (id: string) => {
    setActiveScenarios(prev =>
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    )
  }

  const teamCount = league?.leagueSize || league?.teams?.length || 12

  const filteredPlayers = posFilter === 'ALL'
    ? adpPlayers
    : adpPlayers.filter(p => p.position === posFilter)

  const boardRounds: ADPPlayer[][] = []
  for (let r = 0; r < Math.min(rounds + 2, 8); r++) {
    boardRounds.push(filteredPlayers.slice(r * teamCount, (r + 1) * teamCount))
  }

  if (leagues.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <Layers className="w-12 h-12 text-white/20" />
        <p className="text-white/40 text-sm text-center">Import a league first to access Mock Draft tools.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-purple-500/20 to-cyan-500/20 flex items-center justify-center">
            <Layers className="w-5 h-5 text-purple-300" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">Mock Draft Simulator</h2>
            <p className="text-xs text-white/40">Chimmy-powered draft predictions & scouting</p>
          </div>
        </div>

        <select
          value={selectedLeague}
          onChange={e => setSelectedLeague(e.target.value)}
          className="bg-slate-800/80 border border-white/10 text-white text-sm rounded-xl px-3 py-2 min-w-[200px]"
        >
          {leagues.map(l => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
        {([
          { id: 'board' as const, label: 'Draft Board', icon: <BarChart3 className="w-3.5 h-3.5" /> },
          { id: 'predictions' as const, label: 'Predictions', icon: <Target className="w-3.5 h-3.5" /> },
          { id: 'dna' as const, label: 'Manager DNA', icon: <Users className="w-3.5 h-3.5" /> },
          { id: 'snipe' as const, label: 'Snipe Radar', icon: <AlertTriangle className="w-3.5 h-3.5" /> },
        ]).map(v => (
          <button
            key={v.id}
            onClick={() => {
              setViewMode(v.id)
              if (v.id === 'predictions' && predictions.length === 0 && !predLoading) fetchPredictions()
              if (v.id === 'snipe' && snipeEntries.length === 0 && !snipeLoading) fetchSnipeRadar()
            }}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium whitespace-nowrap transition ${
              viewMode === v.id
                ? 'bg-purple-500/20 text-purple-300 border border-purple-400/30'
                : 'bg-slate-800/50 text-white/50 border border-white/5 hover:text-white/70'
            }`}
          >
            {v.icon} {v.label}
          </button>
        ))}
      </div>

      {viewMode === 'board' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            {['ALL', 'QB', 'RB', 'WR', 'TE'].map(pos => (
              <button
                key={pos}
                onClick={() => setPosFilter(pos)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition ${
                  posFilter === pos
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/30'
                    : 'bg-slate-800/50 text-white/40 border border-white/5'
                }`}
              >
                {pos}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-2 text-xs text-white/30">
              <span>Rounds:</span>
              <select
                value={rounds}
                onChange={e => setRounds(Number(e.target.value))}
                className="bg-slate-800/80 border border-white/10 text-white rounded-lg px-2 py-1"
              >
                {[2, 3, 4, 5, 6].map(r => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
          </div>

          {adpLoading ? (
            <div className="flex items-center justify-center py-16 gap-2 text-white/40">
              <Loader2 className="w-5 h-5 animate-spin" /> Loading ADP board...
            </div>
          ) : error ? (
            <div className="text-center py-12 text-red-400/70 text-sm">{error}</div>
          ) : (
            <div className="space-y-3">
              {boardRounds.map((roundPlayers, rIdx) => (
                roundPlayers.length > 0 && (
                  <div key={rIdx}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[10px] font-bold text-white/30 uppercase tracking-wider">Round {rIdx + 1}</span>
                      <div className="flex-1 h-px bg-white/5" />
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-1.5">
                      {roundPlayers.map((p, pIdx) => {
                        const overall = rIdx * teamCount + pIdx + 1
                        return (
                          <div
                            key={`${p.name}-${overall}`}
                            className={`relative rounded-xl border p-2.5 transition hover:scale-[1.02] ${POS_COLORS[p.position] || 'bg-slate-700/30 text-white/60 border-white/10'}`}
                          >
                            <div className="flex items-start justify-between mb-1">
                              <span className="text-[9px] font-bold opacity-50">#{overall}</span>
                              <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-black/20">
                                {p.position}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <div className="relative flex-shrink-0">
                                <MiniPlayerImg sleeperId={p.sleeperId || undefined} name={p.name} size={28} />
                                {p.team && (
                                  <div className="absolute -bottom-0.5 -right-0.5">
                                    <TeamLogo team={p.team} size={12} />
                                  </div>
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="text-xs font-semibold truncate leading-tight">{p.name}</div>
                                <div className="flex items-center justify-between mt-0.5">
                                  <span className="text-[9px] opacity-50">{p.team || '—'}</span>
                                  {p.adpTrend !== null && p.adpTrend !== 0 && (
                                    <span className={`text-[9px] font-medium ${p.adpTrend > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                      {p.adpTrend > 0 ? '↑' : '↓'}{Math.abs(p.adpTrend).toFixed(1)}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              ))}
            </div>
          )}
        </div>
      )}

      {viewMode === 'predictions' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 flex-wrap">
              {SCENARIO_OPTIONS.map(s => (
                <button
                  key={s.id}
                  onClick={() => toggleScenario(s.id)}
                  title={s.desc}
                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-medium transition ${
                    activeScenarios.includes(s.id)
                      ? 'bg-purple-500/25 text-purple-300 border border-purple-400/40'
                      : 'bg-slate-800/50 text-white/40 border border-white/5 hover:text-white/60'
                  }`}
                >
                  <span>{s.icon}</span> {s.label}
                </button>
              ))}
            </div>
            <button
              onClick={fetchPredictions}
              disabled={predLoading}
              className="flex items-center gap-1.5 px-3 py-2 bg-gradient-to-r from-purple-600/40 to-cyan-600/40 text-white text-xs font-semibold rounded-xl border border-purple-400/20 hover:from-purple-600/50 hover:to-cyan-600/50 transition disabled:opacity-40"
            >
              {predLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
              {predLoading ? 'Simulating...' : 'Run Simulation'}
            </button>
          </div>

          {activeScenarios.length > 0 && (
            <div className="text-[10px] text-purple-300/60 flex items-center gap-1">
              <Zap className="w-3 h-3" /> Scenario active — predictions adjusted for: {activeScenarios.map(s => SCENARIO_OPTIONS.find(o => o.id === s)?.label).join(', ')}
            </div>
          )}

          {predLoading ? (
            <div className="flex items-center justify-center py-16 gap-2 text-white/40">
              <Loader2 className="w-5 h-5 animate-spin" /> Running Monte Carlo simulation...
            </div>
          ) : predictions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Target className="w-10 h-10 text-white/15" />
              <p className="text-white/30 text-sm">Click &quot;Run Simulation&quot; to generate pick predictions</p>
            </div>
          ) : (
            <div className="space-y-2">
              {predictions.map((pick, idx) => {
                const isExpanded = expandedPick === idx
                const top = pick.topTargets[0]
                const chaosColor = pick.volatility?.chaosLevel === 'high' ? 'text-red-400' : pick.volatility?.chaosLevel === 'medium' ? 'text-amber-400' : 'text-emerald-400'
                return (
                  <div
                    key={idx}
                    className="rounded-xl border border-white/8 bg-slate-900/50 overflow-hidden"
                  >
                    <button
                      onClick={() => setExpandedPick(isExpanded ? null : idx)}
                      className="w-full flex items-center gap-3 p-3 text-left hover:bg-white/[0.02] transition"
                    >
                      <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center text-xs font-bold text-white/50">
                        {pick.overall}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-white/80 truncate">{pick.manager}</span>
                          <span className="text-[9px] text-white/30">R{pick.round}.{pick.pick}</span>
                        </div>
                        {top && (
                          <div className="flex items-center gap-2 mt-0.5">
                            <MiniPlayerImg sleeperId={top.sleeperId || undefined} name={top.player} size={16} />
                            <span className="text-xs text-white/60">{top.player}</span>
                            <TeamLogo team={top.team} size={12} />
                            <span className="text-[9px] text-cyan-400/70">{Math.round(top.probability * 100)}%</span>
                          </div>
                        )}
                      </div>
                      <span className={`text-[9px] font-medium ${chaosColor}`}>
                        {pick.volatility?.chaosLevel || 'low'}
                      </span>
                      {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-white/30" /> : <ChevronRight className="w-3.5 h-3.5 text-white/30" />}
                    </button>

                    {isExpanded && pick.topTargets.length > 0 && (
                      <div className="border-t border-white/5 p-3 space-y-2 bg-slate-950/30">
                        {pick.topTargets.slice(0, 5).map((t, tIdx) => (
                          <div key={tIdx} className="flex items-center gap-3">
                            <span className="text-[9px] text-white/20 w-4 text-right">{tIdx + 1}.</span>
                            <div className="relative flex-shrink-0">
                              <MiniPlayerImg sleeperId={t.sleeperId || undefined} name={t.player} size={20} />
                              {t.team && (
                                <div className="absolute -bottom-0.5 -right-0.5">
                                  <TeamLogo team={t.team} size={10} />
                                </div>
                              )}
                            </div>
                            <span className="text-xs text-white/70 flex-1">{t.player}</span>
                            <span className="text-[10px] text-white/30">{t.position}</span>
                            <span className="text-[10px] text-cyan-400/80 font-medium">{Math.round(t.probability * 100)}%</span>
                          </div>
                        ))}
                        {pick.topTargets[0]?.scorecard && (
                          <div className="mt-2 pt-2 border-t border-white/5">
                            <div className="text-[9px] text-white/25 mb-1.5">Chimmy Factor Breakdown (Top Pick)</div>
                            <div className="flex gap-0.5 h-2 rounded-full overflow-hidden">
                              {[
                                { w: pick.topTargets[0].scorecard.adpWeight, c: 'bg-blue-500', l: 'ADP' },
                                { w: pick.topTargets[0].scorecard.teamNeedWeight, c: 'bg-emerald-500', l: 'Need' },
                                { w: pick.topTargets[0].scorecard.managerTendencyWeight, c: 'bg-purple-500', l: 'Style' },
                                { w: pick.topTargets[0].scorecard.newsImpactWeight, c: 'bg-amber-500', l: 'News' },
                                { w: pick.topTargets[0].scorecard.rookieRankBoostWeight, c: 'bg-red-500', l: 'Rookie' },
                              ].map((bar, bi) => (
                                bar.w > 0 && <div key={bi} className={`${bar.c} rounded-sm`} style={{ width: `${bar.w}%` }} title={`${bar.l}: ${bar.w}%`} />
                              ))}
                            </div>
                            <div className="flex gap-3 mt-1">
                              {[
                                { c: 'bg-blue-500', l: 'ADP' },
                                { c: 'bg-emerald-500', l: 'Need' },
                                { c: 'bg-purple-500', l: 'Style' },
                                { c: 'bg-amber-500', l: 'News' },
                                { c: 'bg-red-500', l: 'Rookie' },
                              ].map((leg, li) => (
                                <span key={li} className="flex items-center gap-1 text-[8px] text-white/25">
                                  <span className={`w-1.5 h-1.5 rounded-full ${leg.c}`} />{leg.l}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {viewMode === 'dna' && (
        <div className="space-y-2">
          {dnaLoading ? (
            <div className="flex items-center justify-center py-16 gap-2 text-white/40">
              <Loader2 className="w-5 h-5 animate-spin" /> Loading Manager DNA...
            </div>
          ) : dnaCards.length === 0 ? (
            <div className="text-center py-12 text-white/30 text-sm">No manager data available for this league.</div>
          ) : (
            dnaCards.map((dna, idx) => {
              const isExpanded = expandedDna === idx
              return (
                <div key={idx} className="rounded-xl border border-white/8 bg-slate-900/50 overflow-hidden">
                  <button
                    onClick={() => setExpandedDna(isExpanded ? null : idx)}
                    className="w-full flex items-center gap-3 p-3 text-left hover:bg-white/[0.02] transition"
                  >
                    <MiniPlayerImg name={dna.manager} sleeperId={null} avatarUrl={dna.avatarUrl} size={36} className="rounded-xl" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-white/80 truncate">{dna.manager}</div>
                      <div className="text-[10px] text-purple-300/60 mt-0.5">{dna.overallArchetype}</div>
                    </div>
                    <div className="flex gap-1.5 flex-wrap justify-end">
                      {[
                        { label: dna.reachLabel, color: dna.reachFrequency > 0.5 ? 'text-red-300 bg-red-500/10' : 'text-emerald-300 bg-emerald-500/10' },
                        { label: dna.rookieLabel, color: dna.rookieAppetite > 0.6 ? 'text-amber-300 bg-amber-500/10' : 'text-blue-300 bg-blue-500/10' },
                      ].map((badge, bi) => (
                        <span key={bi} className={`text-[8px] px-1.5 py-0.5 rounded-full ${badge.color} font-medium`}>
                          {badge.label}
                        </span>
                      ))}
                    </div>
                    {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-white/30" /> : <ChevronRight className="w-3.5 h-3.5 text-white/30" />}
                  </button>

                  {isExpanded && (
                    <div className="border-t border-white/5 p-3 space-y-3 bg-slate-950/30">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {[
                          { label: 'Reach', value: dna.reachLabel, score: dna.reachFrequency },
                          { label: 'Rookie', value: dna.rookieLabel, score: dna.rookieAppetite },
                          { label: 'Stacking', value: dna.stackLabel, score: dna.stackTendency },
                          { label: 'Panic', value: dna.panicResponse, score: dna.panicScore },
                        ].map((stat, si) => (
                          <div key={si} className="bg-white/[0.03] rounded-lg p-2">
                            <div className="text-[9px] text-white/30 mb-1">{stat.label}</div>
                            <div className="text-xs font-semibold text-white/70">{stat.value}</div>
                            <div className="mt-1 h-1 rounded-full bg-white/5 overflow-hidden">
                              <div
                                className="h-full bg-gradient-to-r from-cyan-500/60 to-purple-500/60 rounded-full"
                                style={{ width: `${Math.round(stat.score * 100)}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>

                      {dna.positionalAggression && Object.keys(dna.positionalAggression).length > 0 && (
                        <div>
                          <div className="text-[9px] text-white/25 mb-1.5">Positional Aggression</div>
                          <div className="grid grid-cols-4 gap-1.5">
                            {['QB', 'RB', 'WR', 'TE'].map(pos => {
                              const agg = dna.positionalAggression[pos]
                              if (!agg) return null
                              return (
                                <div key={pos} className="bg-white/[0.02] rounded-lg p-1.5 text-center">
                                  <div className={`text-[9px] font-bold ${POS_DOT[pos] ? POS_DOT[pos].replace('bg-', 'text-') : 'text-white/40'}`}>{pos}</div>
                                  <div className="flex justify-center gap-1 mt-1">
                                    {['early', 'mid', 'late'].map(phase => (
                                      <div key={phase} className="text-center">
                                        <div className="text-[7px] text-white/20">{phase[0].toUpperCase()}</div>
                                        <div className="text-[9px] text-white/50">{((agg as any)[phase] * 100).toFixed(0)}%</div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      )}

      {viewMode === 'snipe' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-white/40">Players at risk of being drafted before your picks</p>
            <button
              onClick={fetchSnipeRadar}
              disabled={snipeLoading}
              className="flex items-center gap-1.5 px-3 py-2 bg-gradient-to-r from-red-600/30 to-amber-600/30 text-white text-xs font-semibold rounded-xl border border-red-400/20 hover:from-red-600/40 hover:to-amber-600/40 transition disabled:opacity-40"
            >
              {snipeLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <AlertTriangle className="w-3.5 h-3.5" />}
              {snipeLoading ? 'Scanning...' : 'Scan Threats'}
            </button>
          </div>

          {snipeLoading ? (
            <div className="flex items-center justify-center py-16 gap-2 text-white/40">
              <Loader2 className="w-5 h-5 animate-spin" /> Scanning snipe threats...
            </div>
          ) : snipeEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <AlertTriangle className="w-10 h-10 text-white/15" />
              <p className="text-white/30 text-sm">Click &quot;Scan Threats&quot; to analyze snipe risks</p>
            </div>
          ) : (
            <div className="space-y-4">
              {snipeEntries.map((entry, eIdx) => (
                <div key={eIdx} className="space-y-2">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="px-2 py-0.5 rounded-lg bg-white/5 text-white/50 font-semibold">Pick #{entry.userPickOverall}</span>
                    <span className="text-white/30">R{entry.round}.{entry.pick}</span>
                    <span className="text-white/20">{entry.picksBefore} picks before yours</span>
                  </div>
                  {entry.alerts.length === 0 ? (
                    <div className="text-[10px] text-emerald-400/50 pl-2">No major snipe threats for this pick</div>
                  ) : (
                    entry.alerts.map((alert, aIdx) => {
                      const urgencyColors = {
                        critical: 'border-red-500/30 bg-red-500/5',
                        warning: 'border-amber-500/30 bg-amber-500/5',
                        watch: 'border-white/10 bg-white/[0.02]',
                      }
                      const urgencyBadge = {
                        critical: 'bg-red-500/20 text-red-300',
                        warning: 'bg-amber-500/20 text-amber-300',
                        watch: 'bg-white/10 text-white/40',
                      }
                      return (
                        <div key={aIdx} className={`rounded-xl border p-3 ${urgencyColors[alert.urgencyLevel]}`}>
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-2">
                              <div className="relative flex-shrink-0">
                                <MiniPlayerImg sleeperId={alert.sleeperId || undefined} name={alert.player} size={22} />
                                {alert.team && (
                                  <div className="absolute -bottom-0.5 -right-0.5">
                                    <TeamLogo team={alert.team} size={10} />
                                  </div>
                                )}
                              </div>
                              <span className="text-sm font-semibold text-white/80">{alert.player}</span>
                              <span className="text-[10px] text-white/30">{alert.position}</span>
                            </div>
                            <span className={`text-[9px] px-2 py-0.5 rounded-full font-medium ${urgencyBadge[alert.urgencyLevel]}`}>
                              {alert.urgencyLevel}
                            </span>
                          </div>
                          <div className="flex items-center gap-4 text-[10px] text-white/40">
                            <span>Snipe prob: <strong className="text-white/60">{alert.snipeProbability}%</strong></span>
                            <span>EV lost: <strong className="text-white/60">{alert.expectedValueLost}</strong></span>
                          </div>
                          {alert.snipedByManagers.length > 0 && (
                            <div className="flex gap-2 mt-2 flex-wrap">
                              {alert.snipedByManagers.slice(0, 3).map((s, si) => (
                                <span key={si} className="text-[9px] text-white/30 bg-white/[0.03] px-2 py-0.5 rounded-full">
                                  {s.manager} ({s.probability}%)
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
