'use client'

import { useState, useEffect, useCallback } from 'react'

interface HeatCellTarget {
  rosterId: string
  name: string
  score: number
  ldiByPos: number
  meanPremiumPct: number
  nByPos: number
  label: 'Overpayer' | 'Learning'
}

interface HeatCell {
  pos: string
  ldi: number
  trend: number
  posSample: number
  leagueSample: number
  tag: 'HOT' | 'COLD' | 'NEUTRAL' | 'LEARNING' | 'LOW_LEAGUE_SAMPLE'
  topTargets: HeatCellTarget[]
  evidence: Array<{ key: string; value: string | number }>
}

interface HeatmapData {
  leagueId: string
  leagueName: string
  season: string
  week: number
  phase: string
  computedAt: number
  cells: HeatCell[]
}

interface DemandHeatmapProps {
  leagueId: string
  week: number
  compact?: boolean
}

function tileColor(ldi: number, tag: string): string {
  if (tag === 'LOW_LEAGUE_SAMPLE') return 'border-gray-700/50 bg-gray-800/30'
  if (tag === 'LEARNING') return 'border-gray-700 bg-gray-800/60'
  if (tag === 'HOT') return 'border-red-500/40 bg-red-500/10'
  if (ldi >= 50) return 'border-orange-500/30 bg-orange-500/8'
  if (tag === 'COLD') return 'border-cyan-500/30 bg-cyan-500/10'
  return 'border-gray-700 bg-gray-800/60'
}

function ldiTextColor(tag: string, ldi: number): string {
  if (tag === 'LOW_LEAGUE_SAMPLE') return 'text-gray-500'
  if (tag === 'LEARNING') return 'text-gray-400'
  if (tag === 'HOT') return 'text-red-400'
  if (ldi >= 50) return 'text-orange-400'
  if (tag === 'COLD') return 'text-cyan-400'
  return 'text-white'
}

function tagBadge(tag: string): { text: string; cls: string } | null {
  switch (tag) {
    case 'HOT': return { text: 'HOT', cls: 'bg-red-500/20 text-red-400 border-red-500/30' }
    case 'COLD': return { text: 'COLD', cls: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30' }
    case 'LEARNING': return { text: 'LEARNING', cls: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/20' }
    case 'NEUTRAL': return { text: 'NEUTRAL', cls: 'bg-gray-700/50 text-gray-400 border-gray-600/30' }
    case 'LOW_LEAGUE_SAMPLE': return { text: 'LOW SAMPLE', cls: 'bg-gray-700/30 text-gray-500 border-gray-700/30' }
    default: return null
  }
}

function trendArrow(trend: number): string {
  if (trend > 2) return '\u2191'
  if (trend < -2) return '\u2193'
  return '\u2192'
}

function trendColor(trend: number): string {
  if (trend > 2) return 'text-green-400'
  if (trend < -2) return 'text-red-400'
  return 'text-gray-500'
}

export default function DemandHeatmap({ leagueId, week, compact = false }: DemandHeatmapProps) {
  const [data, setData] = useState<HeatmapData | null>(null)
  const [activePos, setActivePos] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [ldiFallback, setLdiFallback] = useState<{ fallbackMode: boolean; rankingSourceNote: string } | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/leagues/${leagueId}/ldi-heatmap?week=${week}`)
      if (res.ok) {
        const json = await res.json()
        if (json.fallbackMode) {
          setLdiFallback({ fallbackMode: true, rankingSourceNote: json.rankingSourceNote || '' })
        } else {
          setLdiFallback(null)
        }
        setData(json)
      }
    } catch (e) {
      console.error('Failed to load heatmap', String(e))
    }
    setLoading(false)
  }, [leagueId, week])

  useEffect(() => {
    if (leagueId && week) fetchData()
  }, [leagueId, week, fetchData])

  if (loading) {
    return (
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
        <div className="animate-pulse space-y-3">
          <div className="h-5 bg-gray-800 rounded w-48" />
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-28 bg-gray-800 rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (!data || !data.cells.length) {
    return (
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
        <h3 className="text-lg font-semibold text-white mb-2">League Demand Heatmap</h3>
        {ldiFallback?.fallbackMode ? (
          <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-3 text-xs text-yellow-200">
            <div className="font-semibold">Market Baseline Mode</div>
            <div className="mt-1 text-yellow-300/80">
              {ldiFallback.rankingSourceNote || "No trade sample yet — using baseline demand until trades occur."}
            </div>
          </div>
        ) : (
          <p className="text-gray-400 text-sm">
            Not enough trade data yet. Import your league to see what positions your league overpays for.
          </p>
        )}
      </div>
    )
  }

  const activeCell = activePos ? data.cells.find(c => c.pos === activePos) : null

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <div>
          <h3 className="text-lg font-semibold text-white">League Demand Heatmap</h3>
          <p className="text-[11px] text-gray-500 mt-0.5">
            {data.leagueName} &middot; {data.season} &middot; Week {data.week}
          </p>
        </div>
      </div>

      <div className="p-4">
        <div className={`grid gap-3 ${data.cells.length <= 4 ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3'}`}>
          {data.cells.map(cell => (
            <button
              key={cell.pos}
              onClick={() => setActivePos(activePos === cell.pos ? null : cell.pos)}
              className={`relative rounded-lg border p-4 text-left transition-all duration-200 ${tileColor(cell.ldi, cell.tag)} ${
                activePos === cell.pos ? 'ring-2 ring-blue-500/50 scale-[1.02]' : 'hover:scale-[1.01]'
              }`}
            >
              <div className="flex items-start justify-between">
                <span className="text-sm font-bold text-gray-300">{cell.pos}</span>
                {(() => {
                  const b = tagBadge(cell.tag)
                  if (!b) return null
                  return (
                    <span className={`px-1.5 py-0.5 text-[9px] font-semibold rounded border ${b.cls}`}>
                      {b.text}
                    </span>
                  )
                })()}
              </div>

              <div className="mt-2 flex items-end gap-2">
                <span className={`text-3xl font-black tracking-tight ${ldiTextColor(cell.tag, cell.ldi)}`}>
                  {cell.ldi}
                </span>
                <div className="flex items-center gap-0.5 mb-1">
                  <span className={`text-sm ${trendColor(cell.trend)}`}>
                    {trendArrow(cell.trend)}
                  </span>
                  {cell.trend !== 0 && (
                    <span className={`text-[10px] font-medium ${trendColor(cell.trend)}`}>
                      {cell.trend > 0 ? '+' : ''}{cell.trend}
                    </span>
                  )}
                </div>
              </div>

              <div className="mt-1 text-[10px] text-gray-500">
                {cell.posSample} pos / {cell.leagueSample} league
              </div>
            </button>
          ))}
        </div>
      </div>

      {activeCell && (
        <div className="border-t border-gray-800 bg-gray-900/80">
          <div className="px-4 py-3 flex items-center justify-between border-b border-gray-800/50">
            <h4 className="text-sm font-semibold text-white">{activeCell.pos} Demand Breakdown</h4>
            <button
              onClick={() => setActivePos(null)}
              className="text-xs text-gray-500 hover:text-white transition-colors"
            >
              Close
            </button>
          </div>

          <div className="px-4 py-4 space-y-4">
            <div>
              <div className="text-[10px] font-semibold text-white/40 uppercase tracking-wider mb-2">Evidence</div>
              <div className="space-y-1">
                {activeCell.evidence.map((e, i) => (
                  <div key={i} className="flex items-center justify-between text-sm bg-gray-800/40 rounded px-3 py-1.5">
                    <span className="text-white/40">{e.key}</span>
                    <span className="text-white/70 font-medium">{e.value}</span>
                  </div>
                ))}
              </div>
            </div>

            {activeCell.topTargets.length > 0 && (
              <div>
                <div className="text-[10px] font-semibold text-white/40 uppercase tracking-wider mb-2">Top proposal targets</div>
                <div className="space-y-1.5">
                  {activeCell.topTargets.map((t, i) => (
                    <div key={i} className="flex items-center justify-between bg-gray-800/40 rounded-lg px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-white font-medium">{t.name}</span>
                        <span className={`px-1.5 py-0.5 text-[9px] font-semibold rounded border ${
                          t.label === 'Overpayer'
                            ? 'bg-red-500/15 text-red-400 border-red-500/20'
                            : 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
                        }`}>
                          {t.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs">
                        <span className="text-gray-500">{t.nByPos} trades</span>
                        <span className={`font-medium ${t.meanPremiumPct > 0 ? 'text-red-400' : 'text-green-400'}`}>
                          {t.meanPremiumPct > 0 ? '+' : ''}{(t.meanPremiumPct * 100).toFixed(1)}%
                        </span>
                        <span className="text-gray-400">LDI {t.ldiByPos}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeCell.tag === 'LOW_LEAGUE_SAMPLE' && (
              <div className="px-3 py-2 bg-gray-700/20 border border-gray-700/30 rounded-lg">
                <p className="text-[11px] text-gray-500">
                  Need more league trade data to generate reliable recommendations. Targets will appear as your league trades more.
                </p>
              </div>
            )}

            {activeCell.tag === 'LEARNING' && (
              <div className="px-3 py-2 bg-yellow-500/8 border border-yellow-500/15 rounded-lg">
                <p className="text-[11px] text-yellow-400">
                  Limited data for {activeCell.pos}. Target labels may change as more trades happen.
                </p>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <a
                href={`/af-legacy?tab=trade&leagueId=${data.leagueId}&pos=${encodeURIComponent(activeCell.pos)}&mode=generate`}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-cyan-500/15 text-cyan-400 hover:bg-cyan-500/25 transition-colors border border-cyan-500/20"
              >
                Generate Offers
              </a>
              <a
                href={`/af-legacy?tab=finder&leagueId=${data.leagueId}&pos=${encodeURIComponent(activeCell.pos)}`}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white/5 text-gray-300 hover:bg-white/10 transition-colors border border-white/10"
              >
                Find Overpayers
              </a>
              <a
                href={`/af-legacy?tab=trade&leagueId=${data.leagueId}`}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white/5 text-gray-300 hover:bg-white/10 transition-colors border border-white/10"
              >
                Open Trade Hub
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
