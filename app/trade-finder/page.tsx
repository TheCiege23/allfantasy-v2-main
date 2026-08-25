'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { ManagerRoleBadge } from '@/components/ManagerRoleBadge'
import { resolvesToLeagueRecord, type LeagueRecordPolicyInput } from '@/lib/dashboard/league-card-fetch-policy'

// ─── TYPES ────────────────────────────────────────────────────────

type Objective    = 'WIN_NOW' | 'REBUILD' | 'BALANCED'
type FinderMode   = 'FAST' | 'DEEP' | 'EXHAUSTIVE'
type FocusPreset  = 'NONE' | 'TARGET_POSITION' | 'ACQUIRE_PICKS' | 'CONSOLIDATE'
type Position     = 'QB' | 'RB' | 'WR' | 'TE' | 'FLEX' | 'K' | 'DEF'
type Tone         = 'FRIENDLY' | 'CONFIDENT' | 'CASUAL' | 'DATA_BACKED' | 'SHORT'
type ActiveTab    = 'find' | 'partners'

interface UserLeague {
  id:              string
  name:            string
  platform:        'sleeper' | 'yahoo' | 'mfl' | 'fantrax' | 'espn'
  sport:           string
  format:          string
  scoring:         string
  teamCount:       number
  season:          string
  sleeperLeagueId?: string
}

interface RosterPlayer {
  id:           string
  name:         string
  position:     Position
  team:         string
  tradeValue?:  number
  injuryStatus?: string | null
}

interface DraftPick {
  id:    string
  label: string   // e.g. "2026 1st"
  year:  string
  round: string
}

interface TradeOpportunity {
  id:           string
  give:         { name: string; position: string; team: string; value: number }[]
  get:          { name: string; position: string; team: string; value: number }[]
  partnerName:  string
  partnerRecord: string
  partnerObjective: string
  fairnessScore: number
  valueDelta:   number
  aiSummary:    string
  verdict:      'SMASH' | 'ACCEPT' | 'LEAN' | 'FAIR' | 'DECLINE'
  confidence:   number
}

interface PartnerMatch {
  rosterId:       number
  managerName:    string
  teamRecord:     string
  objective:      string
  compatibility:  number
  whyTheyTrade:   string
  sharedNeeds:    string[]
  role:           string
  isOrphan:       boolean
}

// ─── CONSTANTS ────────────────────────────────────────────────────

const PLATFORM_CONFIG = {
  sleeper: { emoji: '🌙', color: '#818cf8' },
  yahoo:   { emoji: '🏈', color: '#ef4444' },
  mfl:     { emoji: '🏆', color: '#fbbf24' },
  fantrax: { emoji: '📊', color: '#34d399' },
  espn:    { emoji: '🔴', color: '#f97316' },
}

const VERDICT_CONFIG = {
  SMASH:   { label: 'SMASH',   color: '#10b981', dots: 5 },
  ACCEPT:  { label: 'ACCEPT',  color: '#34d399', dots: 4 },
  LEAN:    { label: 'LEAN',    color: '#fbbf24', dots: 3 },
  FAIR:    { label: 'FAIR',    color: '#fbbf24', dots: 3 },
  DECLINE: { label: 'DECLINE', color: '#ef4444', dots: 1 },
}

const POS_COLORS: Record<string, string> = {
  QB:   'bg-red-500/20 text-red-300 border-red-500/30',
  RB:   'bg-green-500/20 text-green-300 border-green-500/30',
  WR:   'bg-blue-500/20 text-blue-300 border-blue-500/30',
  TE:   'bg-orange-500/20 text-orange-300 border-orange-500/30',
  K:    'bg-gray-500/20 text-gray-300 border-gray-500/30',
  DEF:  'bg-purple-500/20 text-purple-300 border-purple-500/30',
  FLEX: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
}

const PECR_PHASES = [
  { key: 'context',    label: 'Building league context',     icon: '📋' },
  { key: 'pricing',   label: 'Pricing all assets',           icon: '💰' },
  { key: 'scanning',  label: 'Scanning trade candidates',    icon: '🔍' },
  { key: 'ai',        label: 'AI evaluating opportunities',  icon: '🧠' },
  { key: 'gating',    label: 'Quality-gating results',       icon: '✅' },
]

function uid() { return `${Date.now()}-${Math.random().toString(36).slice(2,6)}` }

// ─── SUB COMPONENTS ───────────────────────────────────────────────

function PosBadge({ pos }: { pos: string }) {
  return (
    <span className={`text-[10px] font-black px-1.5 py-0.5 rounded border ${POS_COLORS[pos] ?? 'bg-white/10 text-white/60 border-white/20'}`}>
      {pos}
    </span>
  )
}

function PECRAnimation({ phase }: { phase: string }) {
  const activeIdx = PECR_PHASES.findIndex(p => p.key === phase)
  return (
    <div className="rounded-2xl border border-white/8 bg-[#0c0c1e] p-8 text-center">
      <div className="flex items-center justify-center gap-1.5 mb-8">
        {[0,1,2].map(i => (
          <div key={i} className="w-2 h-2 rounded-full animate-bounce"
               style={{ background: '#06b6d4', animationDelay: `${i*150}ms` }}/>
        ))}
      </div>
      <div className="space-y-2 max-w-xs mx-auto">
        {PECR_PHASES.map((p, i) => (
          <div key={p.key} className={`flex items-center gap-3 rounded-xl px-4 py-2.5 transition-all ${
            i < activeIdx  ? 'opacity-40' :
            i === activeIdx ? 'bg-cyan-500/10 border border-cyan-500/20' : 'opacity-20'
          }`}>
            <span>{p.icon}</span>
            <span className="text-sm text-white/80 flex-1 text-left">{p.label}</span>
            {i < activeIdx  && <span className="text-green-400 text-xs">✓</span>}
            {i === activeIdx && <div className="w-3 h-3 rounded-full border border-cyan-500 border-t-transparent animate-spin"/>}
          </div>
        ))}
      </div>
    </div>
  )
}

function SkeletonCard() {
  return (
    <div className="rounded-2xl border border-white/6 bg-[#0c0c1e] p-5 animate-pulse">
      <div className="h-4 w-1/3 rounded bg-white/10 mb-3"/>
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="space-y-2">
          <div className="h-3 w-full rounded bg-white/8"/>
          <div className="h-3 w-3/4 rounded bg-white/6"/>
        </div>
        <div className="space-y-2">
          <div className="h-3 w-full rounded bg-white/8"/>
          <div className="h-3 w-3/4 rounded bg-white/6"/>
        </div>
      </div>
      <div className="h-3 w-full rounded bg-white/6"/>
    </div>
  )
}

// ─── LEAGUE GATE ──────────────────────────────────────────────────

function LeagueGate({ onSelect, requestedLeagueId }: { onSelect: (l: UserLeague) => void; requestedLeagueId?: string | null }) {
  const [leagues,  setLeagues]  = useState<UserLeague[]>([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)
  const [hovered,  setHovered]  = useState<string | null>(null)
  const autoSelectedRef = useRef(false)

  useEffect(() => {
    /*
     * ⚠ Everything this picker leads to is keyed on the `leagues` table —
     * `/api/league/roster?leagueId=` and `/api/trade-partner-match?leagueId=` both resolve the id
     * there. AF Legacy rows and tournament hubs carry ids from other tables, so a card for one is
     * a dead end. `resolvesToLeagueRecord` covers both; `hasUnifiedRecord` alone would not, since
     * tournament rows set it true.
     */
    const onlyResolvable = (rows: unknown) =>
      (Array.isArray(rows) ? rows : []).filter((l) => resolvesToLeagueRecord(l as LeagueRecordPolicyInput)) as UserLeague[]
    fetch('/api/league/list')
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => setLeagues(onlyResolvable(d.leagues ?? d.data ?? d)))
      .catch(() =>
        fetch('/api/league/sleeper-user-leagues')
          .then(r => r.ok ? r.json() : Promise.reject())
          .then(d => setLeagues(Array.isArray(d.leagues ?? d.data ?? d) ? (d.leagues ?? d.data ?? d) : []))
          .catch(() => setError('Could not load leagues.'))
      )
      .finally(() => setLoading(false))
  }, [])

  // Phase 4: when launched with an explicit league context (?leagueId=), skip the picker and open
  // the trade flow directly for that league. The picker only shows for the global / AI Trade Finder
  // entry (no league context) or when the id doesn't match a connected league.
  useEffect(() => {
    if (autoSelectedRef.current || !requestedLeagueId || leagues.length === 0) return
    const match = leagues.find((l) => l.id === requestedLeagueId)
    if (match) {
      autoSelectedRef.current = true
      onSelect(match)
    }
  }, [requestedLeagueId, leagues, onSelect])

  return (
    <div className="min-h-screen bg-[#07071a] text-white">
      <div className="border-b border-white/6 bg-[#07071a]/80 backdrop-blur-xl">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-5">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-xs font-bold text-violet-400 uppercase tracking-widest">🔄 AI-Powered</span>
          </div>
          <h1 className="text-2xl font-black text-white">AI Trade Finder</h1>
          <p className="text-sm text-white/45 mt-0.5">League-specific trade opportunities based on your strategy and roster</p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
        <div className="mb-8">
          <h2 className="text-lg font-bold text-white mb-1">Select a League</h2>
          <p className="text-sm text-white/45">
            The AI scans all managers in your league to find the best available trades for your specific situation.
          </p>
        </div>

        {loading && (
          <div className="grid sm:grid-cols-2 gap-4">
            {[1,2,3,4].map(i => <div key={i} className="h-36 rounded-2xl border border-white/6 bg-[#0c0c1e] animate-pulse"/>)}
          </div>
        )}
        {error && <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300">⚠️ {error}</div>}

        {!loading && !error && leagues.length === 0 && (
          <div className="rounded-3xl border border-white/8 bg-[#0c0c1e] p-10 text-center">
            <div className="text-5xl mb-4">🔄</div>
            <h3 className="text-xl font-bold text-white mb-2">No leagues connected yet</h3>
            <p className="text-sm text-white/50 mb-6">Import a league to unlock AI trade finding.</p>
            <Link href="/af-rankings"
              className="inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-bold text-white"
              style={{ background: 'linear-gradient(135deg, #7c3aed, #0891b2)' }}>
              Import a League →
            </Link>
          </div>
        )}

        {!loading && leagues.length > 0 && (
          <div className="grid sm:grid-cols-2 gap-4">
            {leagues.map((league: UserLeague) => {
              const plat = PLATFORM_CONFIG[league.platform] ?? PLATFORM_CONFIG.sleeper
              const isH  = hovered === league.id
              return (
                <button key={league.id} onClick={() => onSelect(league)}
                  onMouseEnter={() => setHovered(league.id)}
                  onMouseLeave={() => setHovered(null)}
                  className="text-left rounded-2xl border bg-[#0c0c1e] p-5 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                  style={{
                    borderColor: isH ? `${plat.color}60` : 'rgba(255,255,255,0.08)',
                    boxShadow:   isH ? `0 0 24px ${plat.color}20` : 'none',
                  }}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{plat.emoji}</span>
                      <span className="text-xs font-bold uppercase tracking-wide" style={{ color: plat.color }}>
                        {league.platform.charAt(0).toUpperCase() + league.platform.slice(1)}
                      </span>
                    </div>
                    <div className="flex gap-1.5">
                      <span className="text-[10px] bg-white/8 rounded-full px-2 py-0.5 text-white/50">{league.sport}</span>
                      <span className="text-[10px] bg-white/8 rounded-full px-2 py-0.5 text-white/50">{league.format}</span>
                    </div>
                  </div>
                  <h3 className="text-base font-bold text-white mb-1 truncate">{league.name}</h3>
                  <p className="text-[11px] text-white/35">{league.teamCount} teams · {league.scoring} · {league.season}</p>
                  <div className={`mt-3 text-sm font-bold transition-all ${isH ? '' : 'text-white/25'}`}
                       style={isH ? { color: plat.color } : {}}>
                    {isH ? 'Find Trades →' : ''}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── TRADE CARD ───────────────────────────────────────────────────

function TradeCard({
  opp, onSendToAnalyzer, onSave,
}: {
  opp: TradeOpportunity
  onSendToAnalyzer: (o: TradeOpportunity) => void
  onSave: (o: TradeOpportunity) => void
}) {
  const cfg   = VERDICT_CONFIG[opp.verdict] ?? VERDICT_CONFIG.FAIR
  const delta = opp.valueDelta

  return (
    <div className="rounded-2xl border border-white/8 bg-[#0c0c1e] overflow-hidden hover:border-white/15 transition-all">
      {/* Top accent */}
      <div className="h-0.5" style={{ background: cfg.color }}/>

      <div className="p-5">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className="text-xs font-black px-2.5 py-1 rounded-lg"
                  style={{ background: `${cfg.color}20`, color: cfg.color, border: `1px solid ${cfg.color}40` }}>
              {cfg.label}
            </span>
            <div className="flex gap-0.5">
              {Array.from({ length: 5 }, (_, i) => (
                <div key={i} className="w-1.5 h-1.5 rounded-full" style={{
                  background: i < cfg.dots ? cfg.color : 'rgba(255,255,255,0.1)'
                }}/>
              ))}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-white/40">Fairness</div>
            <div className="text-sm font-black text-white">{opp.fairnessScore}</div>
          </div>
        </div>

        {/* Trade sides */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          {/* Give */}
          <div className="rounded-xl border border-red-500/15 bg-red-500/5 p-3">
            <div className="text-[10px] font-bold text-red-400 uppercase tracking-widest mb-2">You Give</div>
            {opp.give.map((a, i) => (
              <div key={i} className="flex items-center gap-2 mb-1.5">
                <PosBadge pos={a.position}/>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-white/80 truncate">{a.name}</div>
                  <div className="text-[10px] text-white/30">{a.team} · {a.value.toLocaleString()}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Get */}
          <div className="rounded-xl border border-green-500/15 bg-green-500/5 p-3">
            <div className="text-[10px] font-bold text-green-400 uppercase tracking-widest mb-2">You Get</div>
            {opp.get.map((a, i) => (
              <div key={i} className="flex items-center gap-2 mb-1.5">
                <PosBadge pos={a.position}/>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-white/80 truncate">{a.name}</div>
                  <div className="text-[10px] text-white/30">{a.team} · {a.value.toLocaleString()}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Partner info */}
        <div className="flex items-center gap-2 mb-3 text-xs text-white/45">
          <span className="w-1 h-1 rounded-full bg-white/30"/>
          <span className="font-semibold text-white/60">{opp.partnerName}</span>
          <span>·</span>
          <span>{opp.partnerRecord}</span>
          <span>·</span>
          <span className="rounded-full bg-white/8 px-2 py-0.5">{opp.partnerObjective}</span>
        </div>

        {/* AI summary */}
        <p className="text-xs text-white/60 italic leading-relaxed mb-4 border-l-2 pl-3" style={{ borderColor: cfg.color }}>
          "{opp.aiSummary}"
        </p>

        {/* Value delta */}
        <div className="flex items-center justify-between text-xs mb-4">
          <span className="text-white/35">Value delta</span>
          <span className={`font-black ${delta > 0 ? 'text-green-400' : delta < 0 ? 'text-red-400' : 'text-white/60'}`}>
            {delta > 0 ? '+' : ''}{delta.toLocaleString()}
          </span>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={() => onSendToAnalyzer(opp)}
            className="flex-1 rounded-xl py-2.5 text-xs font-bold border border-white/15 text-white/60 hover:text-white hover:border-white/30 transition-all">
            Send to Analyzer →
          </button>
          <button
            onClick={() => onSave(opp)}
            className="w-9 h-9 rounded-xl border border-white/15 text-white/40 hover:text-white hover:border-white/30 transition-all flex items-center justify-center text-base">
            🔖
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── MAIN PAGE ────────────────────────────────────────────────────

export default function TradeFinderPage() {
  const router = useRouter()
  // Phase 4: in-league entry deep-links with ?leagueId= to skip the global league picker.
  const requestedLeagueId = useSearchParams()?.get('leagueId') ?? null

  // League gate
  const [league,       setLeague]       = useState<UserLeague | null>(null)

  // Strategy controls
  const [objective,    setObjective]    = useState<Objective>('BALANCED')
  const [finderMode,   setFinderMode]   = useState<FinderMode>('FAST')
  const [preset,       setPreset]       = useState<FocusPreset>('NONE')
  const [targetPos,    setTargetPos]    = useState<Position | null>(null)
  const [needPositions, setNeedPos]     = useState<Set<Position>>(new Set())
  const [tone,         setTone]         = useState<Tone>('CONFIDENT')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [minFairness,  setMinFairness]  = useState(0)
  const [excludeInjured, setExclInj]   = useState(false)

  // Roster state
  const [roster,       setRoster]       = useState<RosterPlayer[]>([])
  const [picks,        setPicks]        = useState<DraftPick[]>([])
  const [onBlock,      setOnBlock]      = useState<Set<string>>(new Set())
  const [picksOnBlock, setPicksBlock]   = useState<Set<string>>(new Set())

  // Results state
  const [activeTab,    setActiveTab]    = useState<ActiveTab>('find')
  const [loading,      setLoading]      = useState(false)
  const [phase,        setPhase]        = useState('context')
  const [results,      setResults]      = useState<TradeOpportunity[]>([])
  const [partners,     setPartners]     = useState<PartnerMatch[]>([])
  const [error,        setError]        = useState<string | null>(null)
  const [savedOpps,    setSavedOpps]    = useState<TradeOpportunity[]>([])
  const partnerSortRef = useRef(false)

  // Load roster when league selected
  useEffect(() => {
    if (!league) return
    fetch(`/api/league/roster?leagueId=${league.id}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => {
        const raw = d.roster ?? d.players ?? d ?? []
        setRoster((Array.isArray(raw) ? raw : []).map((p: Record<string,unknown>) => ({
          id:           String(p.id ?? p.playerId ?? uid()),
          name:         String(p.name ?? p.playerName ?? 'Unknown'),
          position:     String(p.position ?? 'WR') as Position,
          team:         String(p.team ?? p.nflTeam ?? ''),
          tradeValue:   Number(p.tradeValue ?? p.value ?? 0),
          injuryStatus: (p.injuryStatus ?? null) as string | null,
        })))
      })
      .catch(() => setRoster([]))

    // Load picks from league data
    fetch(`/api/league/list`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(() => {
        // Generate representative picks if no pick API
        const fakePicks: DraftPick[] = ['2025','2026','2027'].flatMap(year =>
          ['1st','2nd','3rd'].map(round => ({
            id:    `${year}-${round}`,
            label: `${year} ${round}`,
            year,
            round,
          }))
        )
        setPicks(fakePicks.slice(0, 6))
      })
      .catch(() => setPicks([]))
  }, [league])

  const toggleNeed = useCallback((pos: Position) => {
    setNeedPos(s => {
      const next = new Set(s)
      next.has(pos) ? next.delete(pos) : next.add(pos)
      return next
    })
  }, [])

  const toggleBlock = useCallback((id: string) => {
    setOnBlock(s => {
      const next = new Set(s)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])

  const togglePickBlock = useCallback((id: string) => {
    setPicksBlock(s => {
      const next = new Set(s)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])

  const findTrades = useCallback(async (lockedPartnerId?: number) => {
    if (!league || loading) return
    setLoading(true)
    setError(null)
    setResults([])

    const phases = ['pricing','scanning','ai','gating']
    const timers = phases.map((p,i) => window.setTimeout(() => setPhase(p), (i+1)*2000))

    try {
      // Map UI state to API schema
      const apiMode = finderMode === 'EXHAUSTIVE' ? 'DEEP' : finderMode as 'FAST' | 'DEEP'
      const body: Record<string, unknown> = {
        league_id:     league.sleeperLeagueId ?? league.id,
        objective,
        mode:          apiMode,
        preset,
        preferredTone: tone,
      }
      if (lockedPartnerId) body.user_roster_id = lockedPartnerId
      if (preset === 'TARGET_POSITION' && targetPos) body.target_position = targetPos

      const res  = await fetch('/api/trade-finder', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`)

      // Map response → TradeOpportunity[]
      const opps: TradeOpportunity[] = (data.opportunities ?? data.trades ?? data.results ?? []).map(
        (o: Record<string, unknown>) => {
          const give = (o.give ?? o.sending ?? o.myAssets ?? []) as Record<string,unknown>[]
          const get  = (o.get  ?? o.receiving ?? o.theirAssets ?? []) as Record<string,unknown>[]
          return {
            id:               String(o.id ?? uid()),
            give: give.map((a: Record<string,unknown>) => ({
              name:     String(a.name ?? a.playerName ?? ''),
              position: String(a.position ?? 'WR'),
              team:     String(a.team ?? ''),
              value:    Number(a.value ?? a.tradeValue ?? 0),
            })),
            get: get.map((a: Record<string,unknown>) => ({
              name:     String(a.name ?? a.playerName ?? ''),
              position: String(a.position ?? 'WR'),
              team:     String(a.team ?? ''),
              value:    Number(a.value ?? a.tradeValue ?? 0),
            })),
            partnerName:      String(o.partnerName ?? o.managerName ?? o.partner ?? 'Manager'),
            partnerRecord:    String(o.partnerRecord ?? o.record ?? ''),
            partnerObjective: String(o.partnerObjective ?? o.strategy ?? ''),
            fairnessScore:    Number(o.fairnessScore ?? o.fairness ?? 80),
            valueDelta:       Number(o.valueDelta ?? o.delta ?? 0),
            aiSummary:        String(o.aiSummary ?? o.summary ?? o.analysis ?? o.narrative ?? ''),
            verdict:          (o.verdict ?? 'FAIR') as TradeOpportunity['verdict'],
            confidence:       Number(o.confidence ?? 0.8),
          }
        }
      )
      setResults(opps.filter(o => o.fairnessScore >= minFairness))

    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to find trades')
    } finally {
      timers.forEach(window.clearTimeout)
      setLoading(false)
    }
  }, [league, objective, finderMode, preset, targetPos, tone, minFairness, loading])

  const loadPartners = useCallback(async () => {
    if (!league) return
    setLoading(true)
    setError(null)
    try {
      const res  = await fetch(`/api/trade-partner-match?leagueId=${league.sleeperLeagueId ?? league.id}`)
      const data = await res.json()
      const raw  = data.partners ?? data.matches ?? data ?? []
      setPartners((Array.isArray(raw) ? raw : []).map((p: Record<string,unknown>) => ({
        rosterId:      Number(p.rosterId ?? p.roster_id ?? 0),
        managerName:   String(p.managerName ?? p.ownerName ?? p.teamName ?? p.name ?? ''),
        teamRecord:    String(p.teamRecord ?? p.record ?? ''),
        objective:     String(p.objective ?? p.strategy ?? ''),
        compatibility: Number(p.compatibility ?? p.score ?? 5),
        whyTheyTrade:  String(p.whyTheyTrade ?? p.reason ?? ''),
        sharedNeeds:   ((p.sharedNeeds ?? p.needs ?? []) as unknown[]).filter((item): item is string => typeof item === 'string'),
        role:          String(p.role ?? 'member'),
        isOrphan:      p.isOrphan === true,
      })))
      partnerSortRef.current = false
    } catch {
      setError('Failed to load partners')
    } finally {
      setLoading(false)
    }
  }, [league])

  const sendToAnalyzer = useCallback((opp: TradeOpportunity) => {
    const params = new URLSearchParams({
      senderPlayers:   JSON.stringify(opp.give.map(a => a.name)),
      receiverPlayers: JSON.stringify(opp.get.map(a => a.name)),
      senderName:      'My Team',
      receiverName:    opp.partnerName,
    })
    router.push(`/trade-evaluator?${params.toString()}`)
  }, [router])

  const saveOpportunity = useCallback((opp: TradeOpportunity) => {
    setSavedOpps(s => s.some(o => o.id === opp.id) ? s : [...s, opp])
  }, [])

  // ── IF NO LEAGUE SELECTED: GATE ────────────────────────────────
  if (!league) return <LeagueGate onSelect={setLeague} requestedLeagueId={requestedLeagueId}/>

  const plat = PLATFORM_CONFIG[league.platform] ?? PLATFORM_CONFIG.sleeper

  return (
    <div className="min-h-screen bg-[#07071a] text-white flex flex-col">
      {/* Sticky header */}
      <div className="border-b border-white/6 bg-[#07071a]/90 backdrop-blur-xl sticky top-0 z-20">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-3 flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 mr-2">
            <span className="text-base">🔄</span>
            <h1 className="text-base font-black text-white">AI Trade Finder</h1>
          </div>

          {/* League pill */}
          <div className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/4 px-3 py-1.5">
            <span>{plat.emoji}</span>
            <span className="text-xs font-bold" style={{ color: plat.color }}>{league.name}</span>
            <span className="text-[10px] text-white/30">· {league.sport} {league.format}</span>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {savedOpps.length > 0 && (
              <div className="text-xs text-white/40 border border-white/10 rounded-xl px-3 py-1.5">
                🔖 {savedOpps.length} saved
              </div>
            )}
            <button
              onClick={() => { setLeague(null); setResults([]); setPartners([]) }}
              className="text-xs text-white/40 hover:text-white border border-white/10 hover:border-white/25 rounded-xl px-3 py-1.5 transition-all"
            >
              Change League
            </button>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 pt-4 w-full">
          <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300 flex items-center gap-2">
            ⚠️ {error}
            <button onClick={() => setError(null)} className="ml-auto text-red-400">✕</button>
          </div>
        </div>
      )}

      {/* Tab bar */}
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 pt-5 w-full">
        <div className="inline-flex rounded-2xl border border-white/8 bg-[#0c0c1e] p-1 gap-1">
          {(['find','partners'] as ActiveTab[]).map(tab => (
            <button
              key={tab}
              onClick={() => {
                setActiveTab(tab)
                if (tab === 'partners' && partners.length === 0) loadPartners()
              }}
              className={`text-sm font-bold px-5 py-2 rounded-xl transition-all ${
                activeTab === tab
                  ? 'bg-gradient-to-r from-cyan-500 to-violet-500 text-white'
                  : 'text-white/45 hover:text-white'
              }`}
            >
              {tab === 'find' ? '🔍 Find Trades' : '🤝 Partner Match'}
            </button>
          ))}
        </div>
      </div>

      {/* Main layout */}
      <div className="flex-1 max-w-[1400px] mx-auto w-full px-4 sm:px-6 py-5">
        {activeTab === 'find' && (
          <div className="grid lg:grid-cols-[240px_1fr] gap-5">

            {/* ── LEFT: Controls ── */}
            <div className="space-y-4">

              {/* Strategy */}
              <div className="rounded-2xl border border-white/8 bg-[#0c0c1e] p-4">
                <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest mb-3">Team Strategy</p>
                <div className="space-y-2">
                  {([
                    { v: 'WIN_NOW',  label: '🏆 Win Now',   color: '#ef4444' },
                    { v: 'REBUILD',  label: '🔨 Rebuild',   color: '#60a5fa' },
                    { v: 'BALANCED', label: '⚖️ Balanced',  color: '#06b6d4' },
                  ] as { v: Objective; label: string; color: string }[]).map(s => (
                    <button key={s.v} onClick={() => setObjective(s.v)}
                      className={`w-full text-left rounded-xl px-4 py-2.5 text-sm font-bold transition-all border ${
                        objective === s.v ? 'text-white' : 'border-transparent text-white/45 hover:text-white hover:bg-white/4'
                      }`}
                      style={objective === s.v ? {
                        borderColor: `${s.color}50`,
                        background:  `${s.color}15`,
                        color:        s.color,
                      } : {}}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Focus preset */}
              <div className="rounded-2xl border border-white/8 bg-[#0c0c1e] p-4">
                <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest mb-3">Trade Focus</p>
                <div className="flex flex-wrap gap-1.5">
                  {([
                    { v: 'NONE',             label: 'Any'             },
                    { v: 'TARGET_POSITION',  label: '🎯 Position'    },
                    { v: 'ACQUIRE_PICKS',    label: '📥 Picks'       },
                    { v: 'CONSOLIDATE',      label: '🔀 Consolidate' },
                  ] as { v: FocusPreset; label: string }[]).map(f => (
                    <button key={f.v} onClick={() => setPreset(f.v)}
                      className={`text-xs font-bold px-3 py-1.5 rounded-xl transition-all ${
                        preset === f.v
                          ? 'bg-violet-500 text-white'
                          : 'bg-white/6 text-white/50 hover:bg-white/10 hover:text-white'
                      }`}>
                      {f.label}
                    </button>
                  ))}
                </div>

                {preset === 'TARGET_POSITION' && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {(['QB','RB','WR','TE'] as Position[]).map(pos => (
                      <button key={pos} onClick={() => setTargetPos(targetPos === pos ? null : pos)}
                        className={`text-xs font-black px-2.5 py-1 rounded-lg border transition-all ${
                          targetPos === pos
                            ? `border-current ${POS_COLORS[pos]}`
                            : 'border-white/15 text-white/40 hover:text-white'
                        }`}>
                        {pos}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Position needs */}
              <div className="rounded-2xl border border-white/8 bg-[#0c0c1e] p-4">
                <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest mb-3">Position Needs</p>
                <div className="grid grid-cols-3 gap-1.5">
                  {(['QB','RB','WR','TE','FLEX','Picks'] as const).map(pos => {
                    const isActive = pos === 'Picks' ? needPositions.has('K') : needPositions.has(pos as Position)
                    return (
                      <button key={pos}
                        onClick={() => toggleNeed(pos === 'Picks' ? 'K' : pos as Position)}
                        className={`text-xs font-bold px-2 py-1.5 rounded-lg border transition-all ${
                          isActive ? 'bg-violet-500/20 border-violet-500/50 text-violet-300' : 'border-white/10 text-white/40 hover:border-white/25 hover:text-white'
                        }`}>
                        {pos}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Players on block */}
              {roster.length > 0 && (
                <div className="rounded-2xl border border-white/8 bg-[#0c0c1e] p-4">
                  <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest mb-3">
                    Players I'd Trade
                  </p>
                  <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                    {roster.map(p => (
                      <label key={p.id} className="flex items-center gap-2.5 cursor-pointer group rounded-lg px-2 py-1.5 hover:bg-white/4">
                        <div
                          onClick={() => toggleBlock(p.id)}
                          className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border transition-all ${
                            onBlock.has(p.id) ? 'bg-violet-500 border-violet-500' : 'border-white/20'
                          }`}>
                          {onBlock.has(p.id) && <span className="text-[9px] font-black text-white">✓</span>}
                        </div>
                        <PosBadge pos={p.position}/>
                        <span className="text-xs text-white/75 truncate">{p.name}</span>
                        <span className="text-[10px] text-white/30 ml-auto shrink-0">{p.team}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Picks on block */}
              {picks.length > 0 && (
                <div className="rounded-2xl border border-white/8 bg-[#0c0c1e] p-4">
                  <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest mb-3">
                    Picks I'd Trade
                  </p>
                  <div className="space-y-1">
                    {picks.map(pk => (
                      <label key={pk.id} className="flex items-center gap-2.5 cursor-pointer rounded-lg px-2 py-1.5 hover:bg-white/4">
                        <div
                          onClick={() => togglePickBlock(pk.id)}
                          className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border transition-all ${
                            picksOnBlock.has(pk.id) ? 'bg-violet-500 border-violet-500' : 'border-white/20'
                          }`}>
                          {picksOnBlock.has(pk.id) && <span className="text-[9px] font-black text-white">✓</span>}
                        </div>
                        <span className="text-xs text-white/75">{pk.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* AI depth */}
              <div className="rounded-2xl border border-white/8 bg-[#0c0c1e] p-4">
                <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest mb-3">AI Depth</p>
                <div className="flex gap-1.5">
                  {(['FAST','DEEP','EXHAUSTIVE'] as FinderMode[]).map(m => (
                    <button key={m} onClick={() => setFinderMode(m)}
                      className={`flex-1 text-xs font-bold py-1.5 rounded-xl transition-all ${
                        finderMode === m ? 'bg-cyan-500 text-black' : 'bg-white/6 text-white/50 hover:bg-white/10 hover:text-white'
                      }`}>
                      {m === 'FAST' ? 'Quick' : m === 'DEEP' ? 'Deep' : 'Full'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Advanced */}
              <div className="rounded-2xl border border-white/8 bg-[#0c0c1e] overflow-hidden">
                <button
                  onClick={() => setShowAdvanced(s => !s)}
                  className="w-full flex items-center justify-between px-4 py-3 text-[11px] font-bold text-white/35 hover:text-white/60 transition-colors">
                  <span>Advanced Options</span>
                  <span>{showAdvanced ? '▲' : '▼'}</span>
                </button>

                {showAdvanced && (
                  <div className="px-4 pb-4 space-y-3 border-t border-white/6">
                    <div className="pt-3">
                      <p className="text-[10px] text-white/30 mb-1.5">Min fairness score: {minFairness}</p>
                      <input type="range" min={0} max={80} value={minFairness}
                        onChange={e => setMinFairness(Number(e.target.value))}
                        className="w-full accent-violet-500"/>
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={excludeInjured}
                        onChange={e => setExclInj(e.target.checked)}
                        className="accent-violet-500"/>
                      <span className="text-xs text-white/60">Exclude injured targets</span>
                    </label>
                    <div>
                      <p className="text-[10px] text-white/30 mb-1.5">AI Tone</p>
                      <select value={tone} onChange={e => setTone(e.target.value as Tone)}
                        className="w-full rounded-xl border border-white/10 bg-[#07071a] text-xs text-white px-3 py-2 focus:outline-none focus:border-violet-500/50">
                        {(['FRIENDLY','CONFIDENT','CASUAL','DATA_BACKED','SHORT'] as Tone[]).map(t => (
                          <option key={t} value={t}>{t.replace('_',' ')}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ── RIGHT: Results ── */}
            <div>
              {/* Find button */}
              <button
                onClick={() => findTrades()}
                disabled={loading}
                className="w-full rounded-2xl py-4 text-base font-black mb-5 transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98]"
                style={{
                  background: 'linear-gradient(135deg, #7c3aed, #0891b2)',
                  boxShadow:  loading ? 'none' : '0 8px 32px rgba(124,58,237,0.35)',
                }}>
                {loading ? 'Analyzing League...' : '⚡ Find Trades'}
              </button>

              {loading && <PECRAnimation phase={phase}/>}

              {!loading && results.length === 0 && (
                <div className="rounded-2xl border border-dashed border-white/15 bg-transparent p-12 text-center">
                  <div className="text-4xl mb-3">🔄</div>
                  <p className="text-sm text-white/35">
                    Set your strategy and click "Find Trades" to see AI-powered suggestions
                  </p>
                </div>
              )}

              {!loading && results.length > 0 && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-bold text-white">{results.length} trade opportunities found</span>
                    <span className="text-white/35">{objective.replace('_',' ')} · {finderMode}</span>
                  </div>
                  {results.map(opp => (
                    <TradeCard key={opp.id} opp={opp}
                      onSendToAnalyzer={sendToAnalyzer}
                      onSave={saveOpportunity}/>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── PARTNER MATCH TAB ── */}
        {activeTab === 'partners' && (
          <div>
            {loading && (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {[1,2,3,4,5,6].map(i => <SkeletonCard key={i}/>)}
              </div>
            )}

            {!loading && partners.length === 0 && (
              <div className="rounded-2xl border border-dashed border-white/15 p-12 text-center">
                <p className="text-sm text-white/35">Loading partner data...</p>
              </div>
            )}

            {!loading && partners.length > 0 && (
              <>
                <p className="text-sm text-white/45 mb-5">
                  {partners.length} managers in {league.name} — sorted by trade compatibility with you
                </p>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {(partnerSortRef.current ? partners : [...partners].sort((a,b) => b.compatibility - a.compatibility)).map(partner => (
                    <div key={partner.rosterId}
                      className="rounded-2xl border border-white/8 bg-[#0c0c1e] p-5 hover:border-white/15 transition-all">
                      {/* Compatibility ring */}
                      <div className="flex items-start gap-4 mb-4">
                        <div className="relative w-12 h-12 shrink-0">
                          <svg className="absolute inset-0 -rotate-90" width="48" height="48">
                            <circle cx="24" cy="24" r="18" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="4"/>
                            <circle cx="24" cy="24" r="18" fill="none"
                              stroke={partner.compatibility >= 7 ? '#10b981' : partner.compatibility >= 5 ? '#fbbf24' : '#ef4444'}
                              strokeWidth="4"
                              strokeDasharray={`${(partner.compatibility/10) * 113} 113`}
                              strokeLinecap="round"/>
                          </svg>
                          <div className="absolute inset-0 flex items-center justify-center">
                            <span className="text-xs font-black text-white">{partner.compatibility}</span>
                          </div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <h3 className="min-w-0 truncate font-bold text-white text-sm">{partner.managerName}</h3>
                            <ManagerRoleBadge role={partner.isOrphan ? 'orphan' : partner.role ?? 'member'} />
                          </div>
                          <div className="flex items-center gap-1.5 text-[11px] text-white/40 mt-0.5">
                            <span>{partner.teamRecord}</span>
                            <span>·</span>
                            <span className="rounded-full bg-white/8 px-1.5 py-0.5">{partner.objective}</span>
                          </div>
                        </div>
                      </div>

                      <p className="text-xs text-white/55 italic leading-relaxed mb-3">
                        "{partner.whyTheyTrade}"
                      </p>

                      {partner.sharedNeeds.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-4">
                          {partner.sharedNeeds.slice(0,3).map(n => (
                            <span key={n} className="text-[10px] bg-violet-500/15 border border-violet-500/30 text-violet-300 rounded-full px-2 py-0.5">
                              {n}
                            </span>
                          ))}
                        </div>
                      )}

                      <button
                        onClick={() => { setActiveTab('find'); findTrades(partner.rosterId) }}
                        className="w-full rounded-xl py-2.5 text-xs font-bold transition-all"
                        style={{ background: 'linear-gradient(135deg, #7c3aed40, #0891b240)', border: '1px solid rgba(124,58,237,0.3)', color: '#a78bfa' }}>
                        Find Trades with {partner.managerName.split(' ')[0]} →
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
