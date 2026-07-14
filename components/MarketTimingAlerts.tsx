'use client'

import React, { useState, useEffect, useCallback } from 'react'
import MiniPlayerImg from '@/components/MiniPlayerImg'
import type { MarketAlert, MarketAlertResponse, MarketSignal } from '@/lib/types/market-alerts'
import { useUserTimezone } from '@/hooks/useUserTimezone'

const SIGNAL_CONFIG: Record<MarketSignal, { label: string; color: string; bg: string; border: string; icon: string }> = {
  STRONG_BUY: { label: 'Strong Buy', color: 'text-emerald-300', bg: 'bg-emerald-500/15', border: 'border-emerald-500/30', icon: '▲▲' },
  BUY: { label: 'Buy', color: 'text-green-300', bg: 'bg-green-500/12', border: 'border-green-500/25', icon: '▲' },
  HOLD: { label: 'Hold', color: 'text-slate-300', bg: 'bg-slate-500/10', border: 'border-slate-500/20', icon: '—' },
  SELL: { label: 'Sell', color: 'text-orange-300', bg: 'bg-orange-500/12', border: 'border-orange-500/25', icon: '▼' },
  STRONG_SELL: { label: 'Strong Sell', color: 'text-red-300', bg: 'bg-red-500/15', border: 'border-red-500/30', icon: '▼▼' },
}

const POSITION_COLORS: Record<string, string> = {
  QB: 'bg-red-500/20 text-red-300 border-red-500/30',
  RB: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  WR: 'bg-green-500/20 text-green-300 border-green-500/30',
  TE: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
}

type FilterTab = 'all' | 'nfl' | 'devy'
type PositionFilter = 'all' | 'QB' | 'RB' | 'WR' | 'TE'

function SignalBadge({ signal }: { signal: MarketSignal }) {
  const cfg = SIGNAL_CONFIG[signal]
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-bold ${cfg.bg} ${cfg.color} border ${cfg.border}`}>
      <span className="text-[10px]">{cfg.icon}</span>
      {cfg.label}
    </span>
  )
}

function TrendBar({ value, max }: { value: number; max: number }) {
  const pct = Math.min(100, Math.abs(value) / (max || 1) * 100)
  const isPositive = value >= 0
  return (
    <div className="flex items-center gap-1.5 w-full">
      <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${isPositive ? 'bg-emerald-400' : 'bg-red-400'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`text-[10px] font-mono font-bold min-w-[36px] text-right ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
        {isPositive ? '+' : ''}{value}%
      </span>
    </div>
  )
}

function AlertCard({ alert }: { alert: MarketAlert }) {
  const [expanded, setExpanded] = useState(false)
  const cfg = SIGNAL_CONFIG[alert.signal]
  const posColor = POSITION_COLORS[alert.position] || 'bg-slate-500/20 text-slate-300 border-slate-500/30'

  return (
    <div
      className={`rounded-xl border ${cfg.border} ${cfg.bg} p-3 cursor-pointer transition-all duration-200 active:scale-[0.98]`}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5">
          <MiniPlayerImg
            sleeperId={alert.sleeperId || undefined}
            name={alert.name}
            size={40}
          />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="font-semibold text-white text-sm truncate">{alert.name}</span>
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${posColor}`}>{alert.position}</span>
          </div>

          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-xs text-white/40">
              {alert.category === 'devy' ? alert.school : alert.team || 'FA'}
              {alert.category === 'devy' && alert.classYear ? ` · Yr ${alert.classYear}` : ''}
            </span>
            {alert.category === 'devy' && (
              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/25">DEVY</span>
            )}
          </div>

          <p className={`text-xs ${cfg.color} font-medium leading-snug mb-1.5`}>
            {alert.headline}
          </p>

          {alert.category === 'nfl' && alert.trendPercent !== 0 && (
            <TrendBar value={alert.trendPercent} max={25} />
          )}
        </div>

        <div className="flex-shrink-0 flex flex-col items-end gap-1.5">
          <SignalBadge signal={alert.signal} />
          {alert.category === 'nfl' && alert.dynastyValue > 0 && (
            <span className="text-[10px] text-white/30 font-mono">{Math.round(alert.dynastyValue).toLocaleString()} val</span>
          )}
          {alert.category === 'devy' && alert.projectedRound && (
            <span className="text-[10px] text-white/30 font-mono">Rd {alert.projectedRound} proj</span>
          )}
        </div>
      </div>

      {expanded && (
        <div className="mt-3 pt-2.5 border-t border-white/5">
          <p className="text-xs text-white/50 mb-2">{alert.reasoning}</p>

          <div className="flex flex-wrap gap-1.5">
            {alert.tags.map((tag, i) => (
              <span key={i} className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-white/5 text-white/50 border border-white/10">
                {tag}
              </span>
            ))}
          </div>

          {alert.category === 'nfl' && (
            <div className="flex gap-4 mt-2.5 text-[10px] text-white/30">
              <span>Overall #{alert.rank}</span>
              <span>{alert.position}{alert.positionRank}</span>
              {alert.volatility !== null && <span>Vol: {Math.round(alert.volatility)}%</span>}
              <span>30d: {alert.trend30Day > 0 ? '+' : ''}{Math.round(alert.trend30Day)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SummaryStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex flex-col items-center px-3 py-2">
      <span className={`text-lg font-bold ${color}`}>{value}</span>
      <span className="text-[10px] text-white/40 uppercase tracking-wider">{label}</span>
    </div>
  )
}

export default function MarketTimingAlerts() {
  const { formatTimeInTimezone } = useUserTimezone()
  const [data, setData] = useState<MarketAlertResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<FilterTab>('all')
  const [position, setPosition] = useState<PositionFilter>('all')

  const fetchAlerts = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (filter !== 'all') params.set('filter', filter)
      if (position !== 'all') params.set('position', position)
      params.set('limit', '50')

      const res = await fetch(`/api/market-alerts?${params}`)
      if (!res.ok) throw new Error('Failed to fetch alerts')

      const json: MarketAlertResponse = await res.json()
      setData(json)
    } catch (e: any) {
      setError(e.message || 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }, [filter, position])

  useEffect(() => {
    fetchAlerts()
  }, [fetchAlerts])

  const filterTabs: { id: FilterTab; label: string }[] = [
    { id: 'all', label: 'All Players' },
    { id: 'nfl', label: 'NFL' },
    { id: 'devy', label: 'College / Devy' },
  ]

  const positionTabs: { id: PositionFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'QB', label: 'QB' },
    { id: 'RB', label: 'RB' },
    { id: 'WR', label: 'WR' },
    { id: 'TE', label: 'TE' },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <svg className="w-5 h-5 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/>
              <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>
            </svg>
            Market Timing Alerts
          </h3>
          <p className="text-xs text-white/40 mt-0.5">AI-powered buy/sell signals based on dynasty market data</p>
        </div>
        <button
          onClick={fetchAlerts}
          disabled={loading}
          className="p-2 rounded-lg bg-white/5 border border-white/10 text-white/40 hover:text-white/70 transition disabled:opacity-50"
          title="Refresh alerts"
        >
          <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
            <polyline points="21 3 21 9 15 9"/>
          </svg>
        </button>
      </div>

      {data && !loading && (
        <div className="rounded-xl bg-white/[0.03] border border-white/10 flex items-center justify-center divide-x divide-white/10">
          <SummaryStat label="Strong Buy" value={data.summary.strongBuys} color="text-emerald-400" />
          <SummaryStat label="Buy" value={data.summary.buys} color="text-green-400" />
          <SummaryStat label="Sell" value={data.summary.sells} color="text-orange-400" />
          <SummaryStat label="Strong Sell" value={data.summary.strongSells} color="text-red-400" />
        </div>
      )}

      <div className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-1">
        {filterTabs.map(t => (
          <button
            key={t.id}
            onClick={() => setFilter(t.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition border ${
              filter === t.id
                ? 'bg-violet-500/20 text-violet-300 border-violet-500/30'
                : 'bg-white/5 text-white/40 border-white/10 hover:text-white/60'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex gap-1 overflow-x-auto scrollbar-hide">
        {positionTabs.map(t => (
          <button
            key={t.id}
            onClick={() => setPosition(t.id)}
            className={`px-2.5 py-1 rounded-md text-[11px] font-bold whitespace-nowrap transition border ${
              position === t.id
                ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/25'
                : 'bg-white/5 text-white/30 border-transparent hover:text-white/50'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex flex-col items-center justify-center py-12">
          <div className="w-8 h-8 border-2 border-violet-400 border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-sm text-white/40">Analyzing market signals...</p>
          <p className="text-xs text-white/25 mt-1">Scanning {filter === 'devy' ? 'college prospects' : filter === 'nfl' ? 'NFL players' : 'NFL & college players'}</p>
        </div>
      )}

      {error && !loading && (
        <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-4 text-center">
          <p className="text-sm text-red-300 mb-2">{error}</p>
          <button
            onClick={fetchAlerts}
            className="px-4 py-1.5 rounded-lg bg-red-500/20 text-red-300 text-xs font-semibold border border-red-500/30 hover:bg-red-500/30 transition"
          >
            Try Again
          </button>
        </div>
      )}

      {!loading && !error && data && data.alerts.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-3">
            <svg className="w-6 h-6 text-white/20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/>
              <path d="M21 21l-4.35-4.35"/>
            </svg>
          </div>
          <p className="text-sm text-white/40">No signals found for this filter</p>
          <p className="text-xs text-white/25 mt-1">Try broadening your search</p>
        </div>
      )}

      {!loading && !error && data && data.alerts.length > 0 && (
        <div className="space-y-2">
          {data.alerts.map(alert => (
            <AlertCard key={alert.id} alert={alert} />
          ))}
        </div>
      )}

      {!loading && data && (
        <p className="text-[10px] text-white/20 text-center pt-2">
          Market data refreshed {formatTimeInTimezone(data.generatedAt)} · Canonical market intelligence
        </p>
      )}
    </div>
  )
}
