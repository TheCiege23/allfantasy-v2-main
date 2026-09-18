'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Search, TrendingUp, TrendingDown, ShoppingCart, DollarSign } from 'lucide-react'
import { MarketMoverRow } from './MarketMoverRow'

type Player = {
  name: string
  position: string
  team: string
  sleeperId?: string
  value: number
  trend30Day: number
  overallRank: number
  positionRank: number
  tier: string
  redraftValue: number
}

type SportFilter = 'NFL' | 'NBA' | 'MLB' | 'NHL'
type TimeFilter = '7d' | '30d'
type FormatFilter = 'dynasty' | 'redraft'
type Section = 'risers' | 'fallers' | 'buyLow' | 'sellHigh'

const SPORT_OPTIONS: SportFilter[] = ['NFL', 'NBA', 'MLB', 'NHL']

function tierLabel(value: number): string {
  if (value >= 7500) return 'S'
  if (value >= 5000) return 'A'
  if (value >= 2500) return 'B'
  if (value >= 1000) return 'C'
  return 'D'
}

export function MarketMoversClient() {
  const [sport, setSport] = useState<SportFilter>('NFL')
  const [format, setFormat] = useState<FormatFilter>('dynasty')
  const [timeframe, setTimeframe] = useState<TimeFilter>('30d')
  const [search, setSearch] = useState('')
  const [section, setSection] = useState<Section>('risers')
  const [players, setPlayers] = useState<Player[]>([])
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(
        `/api/player-valuations?sport=${sport.toLowerCase()}&limit=200&sortBy=value`,
        { cache: 'no-store' }
      )
      if (!res.ok) return
      const data = await res.json()
      const rows = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : []
      setPlayers(
        rows.map((p: any) => ({
          name: p.name ?? p.n ?? '',
          position: p.position ?? p.pos ?? '',
          team: p.team ?? p.tm ?? 'FA',
          sleeperId: p.sleeperId ?? p.sp ?? undefined,
          value: format === 'redraft' ? (p.redraftValue ?? p.value ?? 0) : (p.value ?? p.v ?? 0),
          trend30Day: p.trend ?? p.tr ?? 0,
          overallRank: p.overallRank ?? p.rank ?? 0,
          positionRank: p.positionRank ?? 0,
          tier: tierLabel(p.value ?? p.v ?? 0),
          redraftValue: p.redraftValue ?? 0,
        }))
      )
    } catch {} finally {
      setLoading(false)
    }
  }, [sport, format])

  useEffect(() => { fetchData() }, [fetchData])

  const filtered = useMemo(() => {
    let list = [...players]
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter((p) => p.name.toLowerCase().includes(q) || p.team.toLowerCase().includes(q) || p.position.toLowerCase().includes(q))
    }
    return list
  }, [players, search])

  const risers = useMemo(() =>
    [...filtered].filter((p) => p.trend30Day > 0).sort((a, b) => b.trend30Day - a.trend30Day).slice(0, 25),
    [filtered]
  )
  const fallers = useMemo(() =>
    [...filtered].filter((p) => p.trend30Day < 0).sort((a, b) => a.trend30Day - b.trend30Day).slice(0, 25),
    [filtered]
  )
  const buyLow = useMemo(() =>
    [...filtered].filter((p) => p.trend30Day < -100 && p.value > 1500).sort((a, b) => a.trend30Day - b.trend30Day).slice(0, 15),
    [filtered]
  )
  const sellHigh = useMemo(() =>
    [...filtered].filter((p) => p.trend30Day > 200 && p.value > 2000).sort((a, b) => b.trend30Day - a.trend30Day).slice(0, 15),
    [filtered]
  )

  const sections: Record<Section, { label: string; icon: React.ReactNode; data: Player[]; emptyMsg: string }> = {
    risers: { label: 'Risers', icon: <TrendingUp className="h-4 w-4 text-emerald-400" />, data: risers, emptyMsg: 'No rising players found.' },
    fallers: { label: 'Fallers', icon: <TrendingDown className="h-4 w-4 text-red-400" />, data: fallers, emptyMsg: 'No falling players found.' },
    buyLow: { label: 'Buy Low', icon: <ShoppingCart className="h-4 w-4 text-cyan-400" />, data: buyLow, emptyMsg: 'No buy-low targets found.' },
    sellHigh: { label: 'Sell High', icon: <DollarSign className="h-4 w-4 text-amber-400" />, data: sellHigh, emptyMsg: 'No sell-high targets found.' },
  }

  const active = sections[section]

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#080c18] via-[#0a0e1a] to-[#0f0f1a]">
      {/* Header */}
      <div className="border-b border-white/[0.06] bg-[#080c18]/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <Link href="/core" className="text-white/40 hover:text-white/60">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-lg font-black text-white">Market Movers</h1>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 py-6">
        {/* Filters */}
        <div className="mb-6 flex flex-wrap items-center gap-3">
          {/* Sport filter */}
          <div className="flex rounded-xl border border-white/[0.08] bg-white/[0.03]">
            {SPORT_OPTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSport(s)}
                className={`px-3 py-1.5 text-[11px] font-semibold transition ${
                  sport === s ? 'bg-cyan-500/15 text-cyan-300' : 'text-white/40 hover:text-white/60'
                }`}
              >
                {s}
              </button>
            ))}
          </div>

          {/* Format toggle */}
          <div className="flex rounded-xl border border-white/[0.08] bg-white/[0.03]">
            <button
              type="button"
              onClick={() => setFormat('dynasty')}
              className={`px-3 py-1.5 text-[11px] font-semibold transition ${format === 'dynasty' ? 'bg-purple-500/15 text-purple-300' : 'text-white/40 hover:text-white/60'}`}
            >
              Dynasty
            </button>
            <button
              type="button"
              onClick={() => setFormat('redraft')}
              className={`px-3 py-1.5 text-[11px] font-semibold transition ${format === 'redraft' ? 'bg-purple-500/15 text-purple-300' : 'text-white/40 hover:text-white/60'}`}
            >
              Redraft
            </button>
          </div>

          {/* Search */}
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/25" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search player or team..."
              className="w-full rounded-xl border border-white/[0.08] bg-white/[0.03] py-1.5 pl-8 pr-3 text-[12px] text-white placeholder:text-white/25 focus:border-cyan-500/30 focus:outline-none"
            />
          </div>
        </div>

        {/* Section tabs */}
        <div className="mb-5 flex gap-1 border-b border-white/[0.06]">
          {(Object.keys(sections) as Section[]).map((key) => {
            const s = sections[key]
            return (
              <button
                key={key}
                type="button"
                onClick={() => setSection(key)}
                className={`flex items-center gap-1.5 border-b-2 px-3 pb-2.5 pt-1 text-[12px] font-semibold transition ${
                  section === key ? 'border-cyan-400 text-white' : 'border-transparent text-white/35 hover:text-white/55'
                }`}
              >
                {s.icon} {s.label}
                <span className="ml-1 rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[9px] text-white/30">{s.data.length}</span>
              </button>
            )
          })}
        </div>

        {/* Content */}
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-xl bg-white/[0.04]" />
            ))}
          </div>
        ) : active.data.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-sm text-white/40">{active.emptyMsg}</p>
            <p className="mt-1 text-xs text-white/20">Try a different sport or format filter.</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {/* Column headers */}
            <div className="flex items-center gap-3 px-3 py-1 text-[9px] font-bold uppercase tracking-wide text-white/20">
              <span className="w-8 text-center">#</span>
              <span className="flex-1">Player</span>
              <span className="w-16 text-right">Value</span>
              <span className="w-16 text-right">Change</span>
              <span className="w-10 text-center">Tier</span>
            </div>
            {active.data.map((p, i) => (
              <MarketMoverRow key={`${p.name}-${i}`} player={p} rank={i + 1} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
