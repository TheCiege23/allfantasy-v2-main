'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import { Loader2, Copy, Sparkles, X, Search, TrendingUp, TrendingDown, Minus, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { gtagEvent } from '@/lib/gtag'
import { trackMetaBrowserEvent } from '@/lib/meta-client'
import ImproveTradeModal from './ImproveTradeModal'

const track = gtagEvent

type PlayerAsset = {
  name: string
  position: string
  team: string
  age: number
  value: number
  rank: number
  trend: number
  espnId?: string | null
  sleeperId?: string | null
}

type PickAsset = {
  label: string
  year: number
  round: number
  pickNumber?: number
  tier?: string
}

type TradeResult = {
  verdict: string
  lean: string
  confidence: 'LOW' | 'MEDIUM' | 'HIGH'
  bullets: string[]
  sensitivity?: string
  detectedLeagueSize?: number | null
  leagueSize?: number
  fairnessScore?: number
  values?: {
    youGive: { name: string; value: number; source: string }[]
    youGet: { name: string; value: number; source: string }[]
    youGiveTotal: number
    youGetTotal: number
    percentDiff: number
    fairnessScore?: number
  }
}

const LEAGUE_SIZES = [8, 10, 12, 14, 16, 32]

const NFL_TEAMS = new Set([
  'ARI','ATL','BAL','BUF','CAR','CHI','CIN','CLE','DAL','DEN','DET','GB',
  'HOU','IND','JAX','KC','LAC','LAR','LV','MIA','MIN','NE','NO','NYG',
  'NYJ','PHI','PIT','SEA','SF','TB','TEN','WAS',
])

function getPlayerHeadshotUrl(player: PlayerAsset): string | null {
  if (player.espnId) return `https://a.espncdn.com/combiner/i?img=/i/headshots/nfl/players/full/${player.espnId}.png&w=96&h=70&cb=1`
  if (player.sleeperId) return `https://sleepercdn.com/content/nfl/players/thumb/${player.sleeperId}.jpg`
  return null
}

function getTeamLogoUrl(team: string): string | null {
  if (!team) return null
  if (NFL_TEAMS.has(team.toUpperCase())) return `https://a.espncdn.com/combiner/i?img=/i/teamlogos/nfl/500/${team.toLowerCase()}.png&h=40&w=40`
  return null
}

const posColor = (pos: string) => {
  switch (pos) {
    case 'QB': return '#ef4444'
    case 'RB': return '#22d3ee'
    case 'WR': return '#a855f7'
    case 'TE': return '#f59e0b'
    default: return 'var(--muted2)'
  }
}

function PlayerHeadshot({ player, size = 32 }: { player: PlayerAsset; size?: number }) {
  const [error, setError] = useState(false)
  const url = getPlayerHeadshotUrl(player)

  if (!url || error) {
    return (
      <div
        className="rounded-full flex items-center justify-center shrink-0"
        style={{ width: size, height: size, background: posColor(player.position) + '25' }}
      >
        <span className="text-[11px] font-bold" style={{ color: posColor(player.position) }}>{player.position}</span>
      </div>
    )
  }

  return (
    <div className="relative shrink-0 rounded-full overflow-hidden" style={{ width: size, height: size, background: 'var(--panel2)' }}>
      <img
        src={url}
        alt={player.name}
        width={size}
        height={size}
        className="object-cover w-full h-full"
        onError={() => setError(true)}
      />
    </div>
  )
}

function TeamLogo({ team, size = 16 }: { team: string; size?: number }) {
  const [error, setError] = useState(false)
  const url = getTeamLogoUrl(team)

  if (!url || error || !team) return null

  return (
    <img
      src={url}
      alt={team}
      width={size}
      height={size}
      className="object-contain shrink-0"
      onError={() => setError(true)}
    />
  )
}

function PlayerSearch({ onSelect }: { onSelect: (p: PlayerAsset) => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PlayerAsset[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [highlightIdx, setHighlightIdx] = useState(-1)
  const ref = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<NodeJS.Timeout>()

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const searchPlayers = useCallback(async (q: string) => {
    if (q.length < 2) { setResults([]); return }
    setLoading(true)
    try {
      const res = await fetch(`/api/instant/player-search?q=${encodeURIComponent(q)}`)
      const data = await res.json()
      setResults(data)
      setIsOpen(true)
      setHighlightIdx(-1)
    } catch { setResults([]) }
    setLoading(false)
  }, [])

  const handleChange = (val: string) => {
    setQuery(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => searchPlayers(val), 250)
  }

  const selectAndClear = (p: PlayerAsset) => {
    onSelect(p)
    setQuery(''); setIsOpen(false); setResults([]); setHighlightIdx(-1)
  }

  return (
    <div ref={ref} className="relative">
      <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: 'var(--panel2)', border: '1px solid var(--border)' }}>
        <Search className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--muted2)' }} />
        <input
          type="text"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => { if (results.length > 0) setIsOpen(true) }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setHighlightIdx(prev => Math.min(prev + 1, results.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setHighlightIdx(prev => Math.max(prev - 1, -1))
            } else if (e.key === 'Enter' && query.trim().length >= 2) {
              e.preventDefault()
              if (highlightIdx >= 0 && highlightIdx < results.length) {
                selectAndClear(results[highlightIdx])
              } else if (results.length > 0) {
                selectAndClear(results[0])
              } else {
                selectAndClear({ name: query.trim(), position: '??', team: '', age: 0, value: 0, rank: 0, trend: 0 })
              }
            }
          }}
          placeholder="Search players..."
          className="w-full bg-transparent text-xs outline-none"
          style={{ color: 'var(--text)' }}
        />
        {loading && <Loader2 className="w-3 h-3 animate-spin shrink-0" style={{ color: 'var(--muted2)' }} />}
      </div>
      <AnimatePresence>
        {isOpen && results.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="absolute z-50 w-full mt-1 rounded-lg shadow-xl overflow-hidden"
            style={{ background: 'var(--panel)', border: '1px solid var(--border)' }}
          >
            {results.map((p, i) => (
              <button
                key={i}
                onClick={() => selectAndClear(p)}
                className={`w-full flex items-center justify-between px-3 py-2 text-xs transition-colors ${i === highlightIdx ? 'bg-cyan-500/15' : 'hover:bg-cyan-500/10'}`}
              >
                <div className="flex items-center gap-2.5">
                  <PlayerHeadshot player={p} size={28} />
                  <span className="px-1.5 py-0.5 rounded text-[11px] font-bold" style={{ background: posColor(p.position) + '20', color: posColor(p.position) }}>{p.position}</span>
                  <span className="font-medium" style={{ color: 'var(--text)' }}>{p.name}</span>
                  <div className="flex items-center gap-1">
                    <TeamLogo team={p.team} size={14} />
                    <span className="text-[11px]" style={{ color: 'var(--muted2)' }}>{p.team}</span>
                  </div>
                </div>
                <span className="font-mono text-[11px] font-semibold" style={{ color: 'var(--accent-cyan-strong)' }}>{p.value.toLocaleString()}</span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function AssetCard({ asset, onRemove, type }: { asset: PlayerAsset | PickAsset; onRemove: () => void; type: 'player' | 'pick' }) {
  if (type === 'pick') {
    const pick = asset as PickAsset
    return (
      <div className="flex items-center justify-between px-3 py-2 rounded-lg" style={{ background: 'var(--panel2)', border: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0" style={{ background: 'rgba(168,85,247,0.15)' }}>
            <span className="text-[11px] font-bold" style={{ color: '#a855f7' }}>📋</span>
          </div>
          <span className="text-xs font-medium" style={{ color: 'var(--text)' }}>{pick.label}</span>
        </div>
        <button onClick={onRemove} className="p-0.5 rounded hover:bg-red-500/20 transition-colors"><X className="w-3 h-3" style={{ color: 'var(--muted2)' }} /></button>
      </div>
    )
  }

  const player = asset as PlayerAsset
  const pc = posColor(player.position)

  return (
    <div className="flex items-center justify-between px-3 py-2 rounded-lg" style={{ background: 'var(--panel2)', border: '1px solid var(--border)' }}>
      <div className="flex items-center gap-2.5 min-w-0">
        <PlayerHeadshot player={player} size={32} />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="px-1 py-0.5 rounded text-[11px] font-bold shrink-0" style={{ background: pc + '20', color: pc }}>{player.position}</span>
            <span className="text-xs font-medium truncate" style={{ color: 'var(--text)' }}>{player.name}</span>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] mt-0.5" style={{ color: 'var(--muted2)' }}>
            <TeamLogo team={player.team} size={12} />
            <span>{player.team}</span>
            {player.age > 0 && <>
              <span>·</span>
              <span>{player.age?.toFixed(1)} y.o.</span>
            </>}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <div className="text-right">
          <div className="text-xs font-bold font-mono" style={{ color: 'var(--accent-cyan-strong)' }}>{player.value.toLocaleString()}</div>
          <div className="flex items-center gap-0.5 justify-end">
            {player.trend > 0 ? <TrendingUp className="w-2.5 h-2.5 text-emerald-400" /> : player.trend < 0 ? <TrendingDown className="w-2.5 h-2.5 text-red-400" /> : <Minus className="w-2.5 h-2.5" style={{ color: 'var(--muted2)' }} />}
            <span className={`text-[11px] font-mono ${player.trend > 0 ? 'text-emerald-400' : player.trend < 0 ? 'text-red-400' : ''}`} style={player.trend === 0 ? { color: 'var(--muted2)' } : undefined}>
              {player.trend > 0 ? '+' : ''}{player.trend}
            </span>
          </div>
        </div>
        <button onClick={onRemove} className="p-0.5 rounded hover:bg-red-500/20 transition-colors"><X className="w-3 h-3" style={{ color: 'var(--muted2)' }} /></button>
      </div>
    </div>
  )
}

function PickSelector({ onSelect, leagueSize }: { onSelect: (pick: PickAsset) => void; leagueSize: number }) {
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<'tiered' | 'specific'>('tiered')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const years = [2025, 2026, 2027]
  const rounds = [1, 2, 3]
  const roundLabels: Record<number, string> = { 1: '1st', 2: '2nd', 3: '3rd' }
  const tiers = ['Early', 'Mid', 'Late']

  const tieredPicks = useMemo(() => {
    const picks: PickAsset[] = []
    for (const year of years) {
      for (const round of rounds) {
        for (const tier of tiers) {
          picks.push({
            label: `${year} ${tier} ${roundLabels[round]}`,
            year,
            round,
            tier: tier.toLowerCase(),
          })
        }
      }
    }
    return picks
  }, [])

  const specificPicks = useMemo(() => {
    const picks: PickAsset[] = []
    for (const year of years) {
      for (const round of rounds) {
        for (let pick = 1; pick <= leagueSize; pick++) {
          const pickStr = pick.toString().padStart(2, '0')
          picks.push({
            label: `${year} ${round}.${pickStr}`,
            year,
            round,
            pickNumber: pick,
          })
        }
      }
    }
    return picks
  }, [leagueSize])

  const allPicks = mode === 'tiered' ? tieredPicks : specificPicks

  const filteredPicks = query.trim().length > 0
    ? allPicks.filter(p => p.label.toLowerCase().includes(query.toLowerCase()))
    : allPicks

  const displayPicks = filteredPicks.slice(0, 20)

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="text-[11px] px-2 py-1 rounded-md transition-all hover:opacity-80"
        style={{ background: 'rgba(168,85,247,0.15)', color: '#a855f7', border: '1px solid rgba(168,85,247,0.3)' }}
      >
        + Pick
      </button>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="absolute z-50 right-0 mt-1 rounded-xl shadow-xl overflow-hidden"
            style={{ background: 'var(--panel)', border: '1px solid var(--border)', width: '240px' }}
          >
            <div className="p-2 space-y-2" style={{ borderBottom: '1px solid var(--border)' }}>
              <div className="flex gap-1">
                <button
                  onClick={() => { setMode('tiered'); setQuery('') }}
                  className="flex-1 text-[11px] py-1 rounded-md font-medium transition-all"
                  style={mode === 'tiered' ? { background: 'rgba(168,85,247,0.2)', color: '#a855f7' } : { color: 'var(--muted2)' }}
                >
                  Tiered
                </button>
                <button
                  onClick={() => { setMode('specific'); setQuery('') }}
                  className="flex-1 text-[11px] py-1 rounded-md font-medium transition-all"
                  style={mode === 'specific' ? { background: 'rgba(168,85,247,0.2)', color: '#a855f7' } : { color: 'var(--muted2)' }}
                >
                  Specific
                </button>
              </div>
              <div className="flex items-center gap-1.5 rounded-md px-2 py-1" style={{ background: 'var(--panel2)', border: '1px solid var(--border)' }}>
                <Search className="w-3 h-3 shrink-0" style={{ color: 'var(--muted2)' }} />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={mode === 'tiered' ? 'e.g. 2026 early 1st' : 'e.g. 2026 1.01'}
                  className="w-full bg-transparent text-[11px] outline-none"
                  style={{ color: 'var(--text)' }}
                  autoFocus
                />
              </div>
            </div>
            <div className="max-h-[200px] overflow-y-auto">
              {displayPicks.map((p, i) => (
                <button
                  key={i}
                  onClick={() => { onSelect(p); setIsOpen(false); setQuery('') }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-left hover:bg-purple-500/10 transition-colors"
                  style={{ color: 'var(--text)' }}
                >
                  <span className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-[11px]" style={{ background: 'rgba(168,85,247,0.15)', color: '#a855f7' }}>📋</span>
                  <span>{p.label}</span>
                </button>
              ))}
              {displayPicks.length === 0 && (
                <div className="px-3 py-4 text-center text-[11px]" style={{ color: 'var(--muted2)' }}>No picks match</div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default function InstantTradeAnalyzer() {
  const [teamAPlayers, setTeamAPlayers] = useState<PlayerAsset[]>([])
  const [teamAPicks, setTeamAPicks] = useState<PickAsset[]>([])
  const [teamBPlayers, setTeamBPlayers] = useState<PlayerAsset[]>([])
  const [teamBPicks, setTeamBPicks] = useState<PickAsset[]>([])
  const [leagueSize, setLeagueSize] = useState(12)
  const [scoring, setScoring] = useState<'ppr' | 'half' | 'standard' | 'superflex'>('ppr')
  const [isDynasty, setIsDynasty] = useState(false)
  const [tePremium, setTePremium] = useState(false)
  const [isSuperFlex, setIsSuperFlex] = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<TradeResult | null>(null)
  const [error, setError] = useState('')
  const [showImproveModal, setShowImproveModal] = useState(false)

  const teamATotal = teamAPlayers.reduce((s, p) => s + p.value, 0)
  const teamBTotal = teamBPlayers.reduce((s, p) => s + p.value, 0)
  const hasAssets = teamAPlayers.length + teamAPicks.length > 0 && teamBPlayers.length + teamBPicks.length > 0

  const buildTradeText = () => {
    const giveItems = [
      ...teamAPlayers.map(p => p.name),
      ...teamAPicks.map(p => p.label),
    ]
    const getItems = [
      ...teamBPlayers.map(p => p.name),
      ...teamBPicks.map(p => p.label),
    ]
    return `I give: ${giveItems.join(' + ')}\nI get: ${getItems.join(' + ')}`
  }

  const runAnalysis = async () => {
    if (!hasAssets) return

    setLoading(true)
    setError('')
    setResult(null)

    const tradeText = buildTradeText()
    const eventId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
    track('trade_analysis_started', { league_size: leagueSize, scoring, dynasty: isDynasty, tePremium, isSuperFlex })

    const getCookie = (name: string) =>
      document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'))?.[2]

    try {
      const res = await fetch('/api/instant/trade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tradeText,
          leagueSize,
          scoring,
          isDynasty,
          tePremium,
          isSuperFlex,
          eventId,
          fbp: getCookie('_fbp'),
          fbc: getCookie('_fbc'),
        }),
      })

      const data = await res.json()
      if (res.ok) {
        setResult(data)
        track('trade_analysis_completed', { league_size: leagueSize, scoring, dynasty: isDynasty, tePremium, isSuperFlex, verdict: data.verdict, confidence: data.confidence })
        trackMetaBrowserEvent({
          eventName: 'ViewContent',
          eventId,
          customData: {
            content_name: 'Trade Analysis',
            content_category: 'Fantasy Football',
            value: 0,
            currency: 'USD',
          },
        })
      } else {
        setError(data?.error || 'Analysis failed')
      }
    } catch {
      setError('Network error — please try again')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (result) track('early_access_cta_viewed')
  }, [result])

  const tradeText = buildTradeText()

  const copyAnalysis = () => {
    if (!result) return
    const text = `${result.verdict}\n\n${result.bullets.join('\n')}\n\nLeague: ${leagueSize}-team ${isDynasty ? 'Dynasty' : 'Redraft'} ${scoring.toUpperCase()}${isSuperFlex ? ' SF' : ''}${tePremium ? ' TEP' : ''}`
    navigator.clipboard.writeText(text)
    toast.success('Analysis copied to clipboard')
  }

  const clearAll = () => {
    setTeamAPlayers([]); setTeamAPicks([])
    setTeamBPlayers([]); setTeamBPicks([])
    setResult(null); setError('')
  }

  const loadQuickExample = () => {
    setTeamAPlayers([{ name: "Ja'Marr Chase", position: 'WR', team: 'CIN', age: 24.8, value: 9500, rank: 2, trend: 50 }])
    setTeamAPicks([{ label: '2025 2nd', year: 2025, round: 2 }])
    setTeamBPlayers([{ name: 'CeeDee Lamb', position: 'WR', team: 'DAL', age: 25.5, value: 8200, rank: 5, trend: -30 }])
    setTeamBPicks([])
  }

  return (
    <div className="relative rounded-3xl p-5 sm:p-6 shadow-2xl" style={{ background: 'var(--panel)', border: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-cyan-500 to-purple-600 flex items-center justify-center text-2xl shadow-lg shadow-cyan-500/30">
            ⚖️
          </div>
          <div>
            <div className="font-bold text-lg sm:text-xl tracking-tight" style={{ color: 'var(--text)' }}>AI Trade Calculator</div>
            <div className="text-[11px]" style={{ color: 'var(--muted2)' }}>Powered by AI + real-time values</div>
          </div>
        </div>
        {(teamAPlayers.length > 0 || teamBPlayers.length > 0) && (
          <button onClick={clearAll} className="text-[11px] px-2 py-1 rounded-md hover:opacity-80 transition-all" style={{ color: 'var(--muted2)', border: '1px solid var(--border)' }}>
            Clear All
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <button onClick={loadQuickExample} className="px-3 py-1.5 text-[11px] rounded-full transition-all active:scale-95" style={{ background: 'var(--subtle-bg)', border: '1px solid var(--border)', color: 'var(--muted)' }}>
          Chase + 2nd → Lamb
        </button>
        <button
          onClick={() => {
            setTeamAPlayers([{ name: 'Justin Jefferson', position: 'WR', team: 'MIN', age: 25.3, value: 9800, rank: 1, trend: 20 }])
            setTeamAPicks([])
            setTeamBPlayers([{ name: 'Bijan Robinson', position: 'RB', team: 'ATL', age: 22.5, value: 8500, rank: 3, trend: 100 }])
            setTeamBPicks([{ label: '2026 1st', year: 2026, round: 1 }])
          }}
          className="px-3 py-1.5 text-[11px] rounded-full transition-all active:scale-95"
          style={{ background: 'var(--subtle-bg)', border: '1px solid var(--border)', color: 'var(--muted)' }}
        >
          Jefferson → Bijan + 1st
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: '#ef4444' }}>Team 1 gives</div>
            <PickSelector onSelect={(p) => setTeamAPicks(prev => [...prev, p])} leagueSize={leagueSize} />
          </div>
          <PlayerSearch onSelect={(p) => setTeamAPlayers(prev => [...prev, p])} />
          <div className="space-y-1.5 min-h-[44px]">
            {teamAPlayers.map((p, i) => (
              <AssetCard key={`ap-${i}`} asset={p} type="player" onRemove={() => setTeamAPlayers(prev => prev.filter((_, j) => j !== i))} />
            ))}
            {teamAPicks.map((p, i) => (
              <AssetCard key={`apk-${i}`} asset={p} type="pick" onRemove={() => setTeamAPicks(prev => prev.filter((_, j) => j !== i))} />
            ))}
            {teamAPlayers.length === 0 && teamAPicks.length === 0 && (
              <div className="flex items-center justify-center h-[44px] rounded-lg text-[11px]" style={{ color: 'var(--muted2)', border: '1px dashed var(--border)' }}>
                Add players or picks
              </div>
            )}
          </div>
          {teamATotal > 0 && (
            <div className="text-right">
              <span className="text-[11px] font-medium" style={{ color: 'var(--muted2)' }}>Total: </span>
              <span className="text-xs font-bold font-mono" style={{ color: 'var(--text)' }}>{teamATotal.toLocaleString()}</span>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: '#22d3ee' }}>Team 2 gives</div>
            <PickSelector onSelect={(p) => setTeamBPicks(prev => [...prev, p])} leagueSize={leagueSize} />
          </div>
          <PlayerSearch onSelect={(p) => setTeamBPlayers(prev => [...prev, p])} />
          <div className="space-y-1.5 min-h-[44px]">
            {teamBPlayers.map((p, i) => (
              <AssetCard key={`bp-${i}`} asset={p} type="player" onRemove={() => setTeamBPlayers(prev => prev.filter((_, j) => j !== i))} />
            ))}
            {teamBPicks.map((p, i) => (
              <AssetCard key={`bpk-${i}`} asset={p} type="pick" onRemove={() => setTeamBPicks(prev => prev.filter((_, j) => j !== i))} />
            ))}
            {teamBPlayers.length === 0 && teamBPicks.length === 0 && (
              <div className="flex items-center justify-center h-[44px] rounded-lg text-[11px]" style={{ color: 'var(--muted2)', border: '1px dashed var(--border)' }}>
                Add players or picks
              </div>
            )}
          </div>
          {teamBTotal > 0 && (
            <div className="text-right">
              <span className="text-[11px] font-medium" style={{ color: 'var(--muted2)' }}>Total: </span>
              <span className="text-xs font-bold font-mono" style={{ color: 'var(--text)' }}>{teamBTotal.toLocaleString()}</span>
            </div>
          )}
        </div>
      </div>

      {teamATotal > 0 && teamBTotal > 0 && (
        <div className="mb-4">
          <div className="flex rounded-lg overflow-hidden h-2.5" style={{ background: 'var(--subtle-bg)' }}>
            <motion.div
              className="h-full rounded-l-lg"
              style={{ background: 'linear-gradient(to right, #ef4444, #f97316)' }}
              initial={{ width: 0 }}
              animate={{ width: `${(teamATotal / (teamATotal + teamBTotal)) * 100}%` }}
              transition={{ duration: 0.5 }}
            />
            <motion.div
              className="h-full rounded-r-lg"
              style={{ background: 'linear-gradient(to right, #06b6d4, #22d3ee)' }}
              initial={{ width: 0 }}
              animate={{ width: `${(teamBTotal / (teamATotal + teamBTotal)) * 100}%` }}
              transition={{ duration: 0.5 }}
            />
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-[11px] font-mono font-bold" style={{ color: '#ef4444' }}>{teamATotal.toLocaleString()}</span>
            <span className="text-[11px] font-mono" style={{ color: 'var(--muted2)' }}>
              {Math.abs(((teamATotal - teamBTotal) / Math.max(teamATotal, teamBTotal)) * 100).toFixed(1)}% diff
            </span>
            <span className="text-[11px] font-mono font-bold" style={{ color: '#22d3ee' }}>{teamBTotal.toLocaleString()}</span>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-3 mb-4">
        <div>
          <div className="text-[11px] font-medium mb-1.5" style={{ color: 'var(--muted2)' }}>League Size</div>
          <select
            value={leagueSize}
            onChange={(e) => { setLeagueSize(Number(e.target.value)); track('trade_refine_used', { league_size: Number(e.target.value) }) }}
            className="rounded-lg px-2.5 py-1 text-[11px] outline-none min-h-[28px] font-semibold"
            style={{ background: 'var(--panel2)', border: '1px solid var(--border)', color: 'var(--text)' }}
          >
            {LEAGUE_SIZES.map((n) => (
              <option key={n} value={n}>{n}-team</option>
            ))}
          </select>
        </div>

        <div>
          <div className="text-[11px] font-medium mb-1.5" style={{ color: 'var(--muted2)' }}>Scoring</div>
          <select
            value={scoring}
            onChange={(e) => setScoring(e.target.value as any)}
            className="rounded-lg px-2.5 py-1 text-[11px] outline-none min-h-[28px]"
            style={{ background: 'var(--panel2)', border: '1px solid var(--border)', color: 'var(--text)' }}
          >
            <option value="ppr">PPR</option>
            <option value="half">0.5 PPR</option>
            <option value="standard">Standard</option>
            <option value="superflex">Superflex</option>
          </select>
        </div>

        <div className="flex items-end gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={isDynasty} onChange={(e) => setIsDynasty(e.target.checked)} className="w-4 h-4 accent-cyan-400" />
            <span className="text-[11px] font-medium" style={{ color: 'var(--text)' }}>Dynasty</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer" title="Superflex — boosts QB value in analysis">
            <input type="checkbox" checked={isSuperFlex} onChange={(e) => setIsSuperFlex(e.target.checked)} className="w-4 h-4 accent-cyan-400" />
            <span className="text-[11px] font-medium" style={{ color: 'var(--text)' }}>SF</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer" title="Tight End Premium — boosts TE value in analysis">
            <input type="checkbox" checked={tePremium} onChange={(e) => setTePremium(e.target.checked)} className="w-4 h-4 accent-cyan-400" />
            <span className="text-[11px] font-medium" style={{ color: 'var(--text)' }}>TEP</span>
          </label>
        </div>
      </div>

      <button
        onClick={runAnalysis}
        disabled={loading || !hasAssets}
        className="w-full rounded-xl py-3.5 font-bold text-sm text-black min-h-[48px]
                   bg-gradient-to-r from-cyan-400 via-cyan-300 to-cyan-400 bg-[length:200%_auto]
                   shadow-[0_6px_24px_rgba(34,211,238,0.35)]
                   hover:shadow-[0_8px_32px_rgba(34,211,238,0.5)] hover:bg-right
                   active:scale-[0.985] disabled:opacity-40 disabled:cursor-not-allowed
                   flex items-center justify-center gap-3 transition-all duration-200"
      >
        {loading ? (
          <><Loader2 className="w-5 h-5 animate-spin" />AI Analyzing Trade...</>
        ) : (
          <>⚡ Analyze Trade</>
        )}
      </button>

      <AnimatePresence>
        {loading && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-5 space-y-2.5">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-4 rounded animate-pulse" style={{ background: 'var(--subtle-bg)' }} />
            ))}
          </motion.div>
        )}

        {result && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mt-6 space-y-4">
            {(() => {
              const team1Names = [...teamAPlayers.map(p => p.name), ...teamAPicks.map(p => p.label)]
              const team2Names = [...teamBPlayers.map(p => p.name), ...teamBPicks.map(p => p.label)]
              const team1Side = team1Names.length === 0 ? 'Team 1' : team1Names.length <= 2 ? team1Names.join(' & ') : `${team1Names[0]} side`
              const team2Side = team2Names.length === 0 ? 'Team 2' : team2Names.length <= 2 ? team2Names.join(' & ') : `${team2Names[0]} side`
              const favorsTeam1 = result.lean === 'Them'
              const favorsTeam2 = result.lean === 'You'
              const isEven = result.lean === 'Even'
              const winnerLabel = isEven ? 'Even Trade' : favorsTeam2 ? `Favors ${team2Side}` : `Favors ${team1Side}`
              const valueDiff = result.values ? Math.abs(result.values.youGiveTotal - result.values.youGetTotal) : 0
              const pctDiff = result.values ? result.values.percentDiff : 0

              return (
                <div className={`relative overflow-hidden rounded-xl border ${
                  isEven ? 'border-amber-500/30' : favorsTeam2 ? 'border-emerald-500/30' : 'border-red-500/30'
                }`} style={{ background: 'var(--panel2)' }}>
                  <div className={`absolute inset-0 opacity-10 ${
                    isEven ? 'bg-gradient-to-br from-amber-500/30 to-transparent' : favorsTeam2 ? 'bg-gradient-to-br from-emerald-500/30 to-transparent' : 'bg-gradient-to-br from-red-500/30 to-transparent'
                  }`} />
                  <div className="relative p-4 sm:p-5">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="text-2xl">{isEven ? '⚖️' : favorsTeam2 ? '🔥' : '⚠️'}</span>
                        <div>
                          <div className="text-lg sm:text-xl font-black tracking-tight" style={{ color: 'var(--text)' }}>{result.verdict}</div>
                          <div className="text-[11px] font-semibold" style={{ color: isEven ? '#f59e0b' : favorsTeam2 ? '#22d3ee' : '#ef4444' }}>
                            {winnerLabel}
                          </div>
                        </div>
                      </div>
                      <div className={`px-3 py-1.5 rounded-full text-[11px] font-bold ${
                        result.confidence === 'HIGH' ? 'bg-emerald-500 text-black' : result.confidence === 'MEDIUM' ? 'bg-amber-500 text-black' : 'bg-red-500 text-white'
                      }`}>{result.confidence}</div>
                    </div>

                    {!isEven && valueDiff > 0 && (
                      <div className="flex items-center gap-2 px-3 py-2 rounded-lg mb-1" style={{ background: 'rgba(0,0,0,0.2)' }}>
                        <div className="flex-1">
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: '#ef4444' }}>Team 1</span>
                            <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: '#22d3ee' }}>Team 2</span>
                          </div>
                          <div className="flex rounded-full overflow-hidden h-3" style={{ background: 'var(--subtle-bg)' }}>
                            <motion.div
                              className="h-full"
                              style={{ background: favorsTeam1 ? 'linear-gradient(to right, #ef4444, #f97316)' : '#ef444480' }}
                              initial={{ width: 0 }}
                              animate={{ width: result.values ? `${(result.values.youGiveTotal / (result.values.youGiveTotal + result.values.youGetTotal)) * 100}%` : '50%' }}
                              transition={{ duration: 0.8 }}
                            />
                            <motion.div
                              className="h-full"
                              style={{ background: favorsTeam2 ? 'linear-gradient(to right, #06b6d4, #22d3ee)' : '#22d3ee80' }}
                              initial={{ width: 0 }}
                              animate={{ width: result.values ? `${(result.values.youGetTotal / (result.values.youGiveTotal + result.values.youGetTotal)) * 100}%` : '50%' }}
                              transition={{ duration: 0.8 }}
                            />
                          </div>
                          <div className="flex items-center justify-between mt-1">
                            <span className="text-[11px] font-mono font-bold" style={{ color: '#ef4444' }}>{result.values?.youGiveTotal.toLocaleString()}</span>
                            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{
                              color: isEven ? '#f59e0b' : favorsTeam2 ? '#22d3ee' : '#ef4444',
                              background: isEven ? 'rgba(245,158,11,0.1)' : favorsTeam2 ? 'rgba(34,211,238,0.1)' : 'rgba(239,68,68,0.1)',
                            }}>
                              {pctDiff > 0 ? `${Math.abs(pctDiff).toFixed(1)}% gap` : 'Close'}
                            </span>
                            <span className="text-[11px] font-mono font-bold" style={{ color: '#22d3ee' }}>{result.values?.youGetTotal.toLocaleString()}</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )
            })()}

            {result.values && (
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-xl bg-red-500/5" style={{ border: '1px solid var(--border)' }}>
                  <div className="text-[11px] font-medium mb-2" style={{ color: '#ef4444', opacity: 0.8 }}>TEAM 1 GIVES</div>
                  {result.values.youGive.map((a, i) => (
                    <div key={i} className="flex items-center justify-between text-xs py-0.5">
                      <span className="truncate mr-1" style={{ color: 'var(--muted)' }}>{a.name}</span>
                      <span className="shrink-0 font-mono" style={{ color: 'var(--muted2)' }}>{a.value.toLocaleString()}</span>
                    </div>
                  ))}
                  <div className="text-right font-bold text-xs mt-2" style={{ color: '#ef4444', opacity: 0.85 }}>{result.values.youGiveTotal.toLocaleString()}</div>
                </div>
                <div className="p-3 rounded-xl bg-emerald-500/5" style={{ border: '1px solid var(--border)' }}>
                  <div className="text-[11px] font-medium mb-2" style={{ color: '#22d3ee', opacity: 0.8 }}>TEAM 2 GIVES</div>
                  {result.values.youGet.map((a, i) => (
                    <div key={i} className="flex items-center justify-between text-xs py-0.5">
                      <span className="truncate mr-1" style={{ color: 'var(--muted)' }}>{a.name}</span>
                      <span className="shrink-0 font-mono" style={{ color: 'var(--muted2)' }}>{a.value.toLocaleString()}</span>
                    </div>
                  ))}
                  <div className="text-right font-bold text-xs mt-2" style={{ color: '#22d3ee', opacity: 0.85 }}>{result.values.youGetTotal.toLocaleString()}</div>
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              {result.bullets.map((b, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="mt-0.5 text-xs shrink-0" style={{ color: 'var(--accent-cyan-strong)' }}>•</span>
                  <span className="text-xs" style={{ color: 'var(--muted)' }}>{b}</span>
                </div>
              ))}
            </div>

            {result.sensitivity && (
              <div className="p-3 rounded-xl bg-purple-500/10 border border-purple-500/20">
                <div className="flex items-start gap-2">
                  <span className="text-sm shrink-0" style={{ color: '#a855f7' }}>💡</span>
                  <span className="text-xs" style={{ color: 'var(--muted)' }}>{result.sensitivity}</span>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${result.confidence === 'HIGH' ? 'bg-emerald-400' : result.confidence === 'MEDIUM' ? 'bg-amber-400' : 'bg-red-400'}`} />
                <span className="text-[11px]" style={{ color: 'var(--muted2)' }}>{result.confidence} confidence</span>
              </div>
              <span className="text-[11px]" style={{ color: 'var(--muted2)' }}>{result.leagueSize || leagueSize}-team {scoring.toUpperCase()}{isSuperFlex ? ' SF' : ''}{tePremium ? ' TEP' : ''} {isDynasty ? 'dynasty' : 'redraft'}</span>
            </div>

            <div className="flex gap-2 pt-2" style={{ borderTop: '1px solid var(--border)' }}>
              <button onClick={copyAnalysis} className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-medium transition-all active:scale-[0.97]" style={{ border: '1px solid var(--border)', color: 'var(--muted)' }}>
                <Copy className="w-3.5 h-3.5" /> Copy
              </button>
              <button onClick={clearAll} className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-medium transition-all active:scale-[0.97]" style={{ border: '1px solid var(--border)', color: 'var(--muted)' }}>
                New Trade
              </button>
            </div>

            <button
              onClick={() => { setShowImproveModal(true); track('improve_trade_opened') }}
              className="w-full py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2
                         bg-gradient-to-r from-cyan-500/15 to-purple-500/15
                         border border-cyan-400/30 hover:border-cyan-400/50
                         hover:from-cyan-500/25 hover:to-purple-500/25 transition-all active:scale-[0.985]"
              style={{ color: 'var(--text)' }}
            >
              <Sparkles className="w-4 h-4 text-cyan-400" />
              Improve This Trade
            </button>

            <Link
              href="/af-legacy"
              onClick={() => track('legacy_trade_cta_clicked')}
              className="block w-full p-4 rounded-xl transition-all group hover:scale-[1.01]"
              style={{ background: 'linear-gradient(135deg, rgba(168,85,247,0.15), rgba(34,211,238,0.15))', border: '1px solid rgba(168,85,247,0.3)' }}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm">🧠</span>
                    <span className="text-xs font-bold" style={{ color: 'var(--text)' }}>Want deeper analysis?</span>
                  </div>
                  <p className="text-[11px]" style={{ color: 'var(--muted)' }}>
                    Try the <span className="font-semibold" style={{ color: '#a855f7' }}>AF Legacy Trade Analyzer</span> for roster context, league-specific grades, AI negotiation tools, and more.
                  </p>
                </div>
                <ChevronRight className="w-5 h-5 shrink-0 group-hover:translate-x-1 transition-transform" style={{ color: '#a855f7' }} />
              </div>
            </Link>
          </motion.div>
        )}
      </AnimatePresence>

      {error && (
        <div className="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
          <p className="text-xs text-center" style={{ color: '#ef4444' }}>{error}</p>
        </div>
      )}

      {!result && !loading && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: 'var(--muted2)' }}>🔒</span>
            <span className="text-[11px]" style={{ color: 'var(--muted2)' }}>No login required · Free instant analysis</span>
          </div>
          <Link
            href="/af-legacy"
            onClick={() => track('legacy_trade_cta_clicked')}
            className="flex items-center gap-2 px-3 py-2 rounded-lg transition-all hover:opacity-80"
            style={{ background: 'rgba(168,85,247,0.08)', border: '1px solid rgba(168,85,247,0.2)' }}
          >
            <span className="text-xs">🧠</span>
            <span className="text-[11px]" style={{ color: 'var(--muted)' }}>
              Try <span className="font-semibold" style={{ color: '#a855f7' }}>AF Legacy</span> for in-depth trade analysis with roster context
            </span>
            <ChevronRight className="w-3.5 h-3.5 shrink-0 ml-auto" style={{ color: '#a855f7' }} />
          </Link>
        </div>
      )}

      <ImproveTradeModal
        isOpen={showImproveModal}
        onClose={() => setShowImproveModal(false)}
        originalTradeText={tradeText}
        leagueSize={leagueSize}
        scoring={scoring}
        isDynasty={isDynasty}
        currentResult={result}
      />
    </div>
  )
}
