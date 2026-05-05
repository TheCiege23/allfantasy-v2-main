'use client'

import React, { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import PlayerBadge from '@/components/PlayerBadge'
import PlayerSearchDropdown from '@/components/PlayerSearchDropdown'
import { normalizePlayer } from '@/lib/normalize-player'
import NegotiationSheet, { type NegotiationBlock } from '@/components/ai/NegotiationSheet'
import type { TradeCandidate } from '@/lib/trade-finder/apply-counter'
import type { TradeAsset as IndexTradeAsset } from '@/lib/trade-finder/asset-index'

type Sport = 'NFL' | 'NBA'
type Format = 'redraft' | 'dynasty' | 'specialty'
type Side = 'A' | 'B'

type RosterSlot = 'Starter' | 'Bench' | 'IR' | 'Taxi'

type RosteredPlayer = {
  id: string
  name: string
  pos: string
  team?: string
  slot: RosterSlot
  isIdp?: boolean
  media?: {
    headshotUrl: string | null
    teamLogoUrl: string | null
  }
}

type TradeAsset =
  | { type: 'player'; player: RosteredPlayer }
  | { type: 'pick'; pick: { year: number; round: 1 | 2 | 3 | 4; pickNumber?: number; originalRosterId?: number } }
  | { type: 'faab'; faab: { amount: number } }

type AnalyzeResult = {
  grade?: 'A+' | 'A' | 'A-' | 'B+' | 'B' | 'B-' | 'C+' | 'C' | 'C-' | 'D' | 'F'
  verdict:
    | 'Fair'
    | 'Slightly favors A'
    | 'Slightly favors B'
    | 'Strongly favors A'
    | 'Strongly favors B'
  winProbabilityShift?: number
  
  teamAnalysis?: {
    teamAPhase?: 'Contender' | 'Middle' | 'Rebuild'
    teamBPhase?: 'Contender' | 'Middle' | 'Rebuild'
    teamAProblems?: string[]
    teamBProblems?: string[]
  }
  
  assetBreakdown?: {
    teamAReceives?: Array<{ asset: string; tier: string; outlook: string }>
    teamBReceives?: Array<{ asset: string; tier: string; outlook: string }>
  }
  
  lineupDelta?: {
    teamAChange?: string
    teamBChange?: string
    weeklyPointsImpactA?: string
    weeklyPointsImpactB?: string
  }
  
  riskFlags?: string[]
  expertAnalysis?: string
  whenThisBackfires?: string[]
  
  counterOffers?: Array<{
    description: string
    whyBetter: string
  }>
  
  tradePitch?: string
  
  // Legacy fields
  why: string[]
  teamImpactA: string[]
  teamImpactB: string[]
  betterPartners?: Array<{
    managerUsername: string
    needs: string[]
    proposedTrade: string
    whyBetter: string
  }>
  leverage?: {
    suggestedAsk: string[]
    suggestedCounters: string[]
    riskChecks: string[]
  }
  notes: string[]
  leagueSizeImpact?: string[]
  _leagueSize?: number
  _scarcityMultiplier?: number
  _pickContext?: Array<{ year: number; roundLabel: string; tier: string }>
  negotiation?: NegotiationBlock
}

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ')
}

function Pill({ children, tone }: { children: React.ReactNode; tone?: 'cyan' | 'purple' | 'default' }) {
  const toneClass =
    tone === 'cyan'
      ? 'bg-cyan-500/10 border-cyan-400/25 text-cyan-200'
      : tone === 'purple'
      ? 'bg-purple-500/10 border-purple-400/25 text-purple-200'
      : 'bg-black/30 border-white/10 text-white/60'

  return (
    <span className={cx('px-2 py-0.5 rounded-full border text-[11px]', toneClass)}>
      {children}
    </span>
  )
}

function CooldownPill({ remaining, retryAfterSec, label }: { remaining: number | null; retryAfterSec: number | null; label?: string }) {
  return (
    <>
      {remaining != null && <Pill>{label || 'AI runs'} left: {remaining}</Pill>}
      {retryAfterSec != null && retryAfterSec > 0 && <Pill>Cooldown: {retryAfterSec}s</Pill>}
    </>
  )
}

function verdictPillClass(verdict?: string) {
  const v = (verdict || '').toLowerCase()

  if (v.includes('fair')) {
    return 'bg-white/5 border-white/10 text-white/70'
  }

  if (v.includes('favors a')) {
    const strong = v.includes('strongly')
    return strong
      ? 'bg-emerald-500/20 border-emerald-400/30 text-emerald-200'
      : 'bg-emerald-500/12 border-emerald-400/25 text-emerald-200'
  }

  if (v.includes('favors b')) {
    const strong = v.includes('strongly')
    return strong
      ? 'bg-rose-500/20 border-rose-400/30 text-rose-200'
      : 'bg-rose-500/12 border-rose-400/25 text-rose-200'
  }

  return 'bg-white/5 border-white/10 text-white/70'
}

function VerdictPill({ verdict }: { verdict?: string }) {
  return (
    <span
      className={cx(
        'px-3 py-1 rounded-full border text-xs font-semibold',
        verdictPillClass(verdict)
      )}
    >
      {verdict || '—'}
    </span>
  )
}

function verdictBorderTint(verdict?: string) {
  const v = (verdict || '').toLowerCase()

  if (v.includes('favors a')) {
    return v.includes('strongly')
      ? 'border-emerald-400/40'
      : 'border-emerald-400/25'
  }

  if (v.includes('favors b')) {
    return v.includes('strongly')
      ? 'border-rose-400/40'
      : 'border-rose-400/25'
  }

  if (v.includes('fair')) {
    return 'border-white/15'
  }

  return 'border-white/10'
}

function verdictHoverGlow(verdict?: string) {
  const v = (verdict || '').toLowerCase()

  if (v.includes('favors a')) {
    return v.includes('strongly')
      ? 'hover:shadow-[0_0_30px_rgba(52,211,153,0.35)]'
      : 'hover:shadow-[0_0_24px_rgba(52,211,153,0.25)]'
  }

  if (v.includes('favors b')) {
    return v.includes('strongly')
      ? 'hover:shadow-[0_0_30px_rgba(244,63,94,0.35)]'
      : 'hover:shadow-[0_0_24px_rgba(244,63,94,0.25)]'
  }

  if (v.includes('fair')) {
    return 'hover:shadow-[0_0_20px_rgba(255,255,255,0.15)]'
  }

  return 'hover:shadow-[0_0_16px_rgba(255,255,255,0.12)]'
}

function Card({ children, className, glow, accent = 'cyan' }: { children: React.ReactNode; className?: string; glow?: boolean; accent?: 'cyan' | 'purple' | 'amber' | 'emerald' | 'rose' }) {
  const gradients = {
    cyan: 'from-cyan-400 via-purple-500 to-cyan-400',
    purple: 'from-purple-400 via-cyan-500 to-purple-400',
    amber: 'from-amber-400 via-orange-500 to-amber-400',
    emerald: 'from-emerald-400 via-cyan-500 to-emerald-400',
    rose: 'from-rose-400 via-pink-500 to-rose-400',
  }
  const borders = {
    cyan: 'border-cyan-500/20',
    purple: 'border-purple-500/20',
    amber: 'border-amber-500/20',
    emerald: 'border-emerald-500/20',
    rose: 'border-rose-500/20',
  }
  return (
    <div className={cx(
      'relative rounded-2xl sm:rounded-3xl bg-gradient-to-br from-slate-900/80 to-slate-950/80 backdrop-blur-xl shadow-[0_15px_40px_rgba(0,0,0,0.35)] sm:shadow-[0_20px_60px_rgba(0,0,0,0.4)] overflow-hidden transition-all duration-200',
      borders[accent],
      'border',
      className
    )}>
      <div className={cx('h-1 sm:h-1.5 bg-gradient-to-r', gradients[accent])} />
      <div className="p-4 sm:p-5 md:p-6">
        {children}
      </div>
    </div>
  )
}

function Input({
  value,
  onChange,
  placeholder,
  type = 'text',
  className,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  className?: string
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={cx("w-full px-3 sm:px-4 py-2.5 sm:py-3 bg-black/30 border border-white/10 rounded-xl sm:rounded-2xl text-sm sm:text-base text-white placeholder:text-white/30 focus:outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20 transition-all duration-200 min-h-[44px] touch-manipulation", className)}
    />
  )
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (v: string) => void
  options: Array<{ value: string; label: string }>
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-3 sm:px-4 py-2.5 sm:py-3 bg-black/30 border border-white/10 rounded-xl sm:rounded-2xl text-sm sm:text-base text-white focus:outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20 transition-all duration-200 min-h-[44px] touch-manipulation"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

function Chip({ label, onRemove, asset }: { label: string; onRemove: () => void; asset?: TradeAsset }) {
  const isGenericPick = asset?.type === 'pick' && (!asset.pick.pickNumber || asset.pick.pickNumber < 1)
  return (
    <div
      className="inline-flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-2 sm:py-2.5 rounded-lg sm:rounded-xl bg-black/30 border border-white/10 text-xs sm:text-sm text-white/80 transition-all duration-200 hover:border-white/20 touch-manipulation"
      title={isGenericPick ? 'Tier defaults to mid unless slot is known.' : undefined}
    >
      {asset?.type === 'player' ? (
        <PlayerBadge
          name={asset.player.name}
          sleeperId={asset.player.id}
          position={asset.player.pos}
          team={asset.player.team}
          slot={asset.player.slot}
          size="sm"
          showSlot={false}
        />
      ) : (
        <span className="truncate max-w-[140px] sm:max-w-[200px] md:max-w-[260px]">
          {label}
          {isGenericPick && <span className="ml-1 text-[10px] text-amber-400/70">mid</span>}
        </span>
      )}
      <button onClick={onRemove} className="flex-shrink-0 w-5 h-5 sm:w-6 sm:h-6 flex items-center justify-center rounded-full bg-white/5 text-white/50 hover:text-white hover:bg-white/10 transition text-base sm:text-lg leading-none active:scale-90" title="Remove">
        ×
      </button>
    </div>
  )
}

function formatAsset(a: TradeAsset) {
  if (a.type === 'player') {
    const p = a.player
    const suffix = p.team ? ` • ${p.team}` : ''
    const idpTag = p.isIdp ? ' • IDP' : ''
    return `${p.name} • ${p.pos}${suffix} • ${p.slot}${idpTag}`
  }
  if (a.type === 'pick') {
    const pickNum = a.pick.pickNumber
    if (pickNum && pickNum >= 1) {
      const pickStr = String(pickNum).padStart(2, '0')
      return `${a.pick.year} ${a.pick.round}.${pickStr}`
    }
    return `${a.pick.year} Round ${a.pick.round} (Generic)`
  }
  return `FAAB $${a.faab.amount}`
}

function normalizeName(s?: string) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
}

function extractPlayerNamesFromAssets(assetsA: TradeAsset[], assetsB: TradeAsset[]) {
  const names = [...assetsA, ...assetsB]
    .filter((a): a is { type: 'player'; player: RosteredPlayer } => a?.type === 'player' && !!(a as any).player)
    .map((a) => a.player.name.trim())
    .filter(Boolean)

  return Array.from(new Set(names)).slice(0, 20)
}

function hasAtLeastOnePlayerAsset(assetsA: TradeAsset[], assetsB: TradeAsset[]) {
  return [...assetsA, ...assetsB].some((a) => a?.type === 'player' && (a as any)?.player?.name)
}

function extractPlayerContextFromAssets(assetsA: TradeAsset[], assetsB: TradeAsset[]) {
  const players = [...assetsA, ...assetsB]
    .filter((a): a is { type: 'player'; player: RosteredPlayer } => a?.type === 'player' && !!(a as any).player)
    .map((a) => ({
      name: a.player.name.trim(),
      pos: a.player.pos,
      team: a.player.team ?? null,
      isIdp: !!a.player.isIdp,
    }))
    .filter((p) => p.name)

  const seen = new Set<string>()
  const deduped = []
  for (const p of players) {
    const key = p.name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(p)
    if (deduped.length >= 20) break
  }
  return deduped
}

function currentYear() {
  return 2026
}


type LeagueType = 'standard' | 'bestball'

type LeagueOption = {
  league_id: string
  name: string
  season: string
  sport: string
  status: string
  total_rosters: number
  scoring_settings?: any
  roster_positions?: string[]
}

type ManagerOption = {
  user_id: string
  display_name: string
  username: string
  roster_id: number
}

const SLOT_ORDER: RosterSlot[] = ['Starter', 'Bench', 'IR', 'Taxi']
const SLOT_LABELS: Record<RosterSlot, string> = { Starter: 'Starters', Bench: 'Bench', IR: 'IR', Taxi: 'Taxi' }

function RosterPickerPanel({
  roster,
  selectedIds,
  onAdd,
  accent,
  idpEnabled,
}: {
  roster: RosteredPlayer[]
  selectedIds: Set<string>
  onAdd: (p: RosteredPlayer) => void
  accent: 'cyan' | 'rose'
  idpEnabled: boolean
}) {
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({ IR: true, Taxi: true })

  const filtered = idpEnabled ? roster : roster.filter(p => !p.isIdp)

  const grouped = SLOT_ORDER.reduce<Record<RosterSlot, RosteredPlayer[]>>((acc, slot) => {
    acc[slot] = filtered.filter(p => p.slot === slot)
    return acc
  }, { Starter: [], Bench: [], IR: [], Taxi: [] })

  const borderColor = accent === 'cyan' ? 'border-cyan-400/30' : 'border-rose-400/30'
  const hoverBg = accent === 'cyan' ? 'hover:bg-cyan-500/10' : 'hover:bg-rose-500/10'
  const addColor = accent === 'cyan' ? 'text-cyan-400' : 'text-rose-400'

  if (roster.length === 0) return null

  return (
    <div className="mt-3 space-y-2">
      {SLOT_ORDER.map(slot => {
        const players = grouped[slot]
        if (players.length === 0) return null
        const isCollapsed = collapsed[slot] ?? false
        return (
          <div key={slot}>
            <button
              onClick={() => setCollapsed(prev => ({ ...prev, [slot]: !prev[slot] }))}
              className="flex items-center gap-2 w-full text-left py-1"
            >
              <span className="text-[10px] uppercase tracking-wider text-white/40 font-semibold">{SLOT_LABELS[slot]} ({players.length})</span>
              <span className="text-white/30 text-[10px]">{isCollapsed ? '+ Show' : '- Hide'}</span>
            </button>
            {!isCollapsed && (
              <div className="grid grid-cols-1 gap-1">
                {players.map(p => {
                  const added = selectedIds.has(p.id)
                  return (
                    <button
                      key={p.id}
                      disabled={added}
                      onClick={() => onAdd(p)}
                      className={cx(
                        'flex items-center gap-2 px-2.5 py-2 rounded-lg border text-left text-xs transition-all duration-150 touch-manipulation min-h-[40px]',
                        added
                          ? 'bg-white/3 border-white/5 opacity-40 cursor-not-allowed'
                          : `bg-black/20 ${borderColor} ${hoverBg} cursor-pointer active:scale-[0.98]`
                      )}
                    >
                      <PlayerBadge
                        name={p.name}
                        sleeperId={p.id}
                        position={p.pos}
                        team={p.team}
                        size="sm"
                        showSlot={false}
                      />
                      {!added && <span className={cx('ml-auto text-[10px] font-medium', addColor)}>+ Add</span>}
                      {added && <span className="ml-auto text-[10px] text-white/30">Added</span>}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

const TRADE_GOAL_PRESETS = [
  { id: 'win-now', label: 'Win Now', icon: '🏆', description: 'Acquire production to compete this season' },
  { id: 'rebuild', label: 'Rebuild', icon: '🔄', description: 'Sell veterans for youth and picks' },
  { id: 'consolidate', label: 'Consolidate', icon: '📦', description: 'Trade depth for elite talent' },
  { id: 'acquire-depth', label: 'Add Depth', icon: '📊', description: 'Trade stars for multiple pieces' },
  { id: 'acquire-picks', label: 'Get Picks', icon: '🎯', description: 'Acquire draft capital' },
  { id: 'sell-high', label: 'Sell High', icon: '📈', description: 'Move overvalued assets' },
  { id: 'buy-low', label: 'Buy Low', icon: '📉', description: 'Acquire undervalued players' },
]

function analyzerAssetToIndex(a: TradeAsset, side: 'A' | 'B'): IndexTradeAsset {
  if (a.type === 'player') {
    return { id: a.player.id, label: a.player.name, kind: 'PLAYER', position: a.player.pos }
  }
  if (a.type === 'pick') {
    const ordinal = a.pick.round === 1 ? '1st' : a.pick.round === 2 ? '2nd' : a.pick.round === 3 ? '3rd' : `${a.pick.round}th`
    const label = `${a.pick.year} ${ordinal}`
    const id = `pick_${a.pick.year}_r${a.pick.round}_side${side}${a.pick.pickNumber ? `_n${a.pick.pickNumber}` : ''}`
    return { id, label, kind: 'PICK' }
  }
  return { id: `faab_${side}_${a.faab.amount}`, label: `$${a.faab.amount} FAAB`, kind: 'PICK', value: a.faab.amount }
}

function buildAnalyzerCandidate(assetsA: TradeAsset[], assetsB: TradeAsset[]): TradeCandidate {
  const aAssets = assetsA.filter(a => a.type !== 'faab').map(a => analyzerAssetToIndex(a, 'A'))
  const bAssets = assetsB.filter(a => a.type !== 'faab').map(a => analyzerAssetToIndex(a, 'B'))
  return {
    tradeId: 'analyzer',
    youSend: aAssets,
    youReceive: bAssets,
    themSend: bAssets,
    themReceive: aAssets,
  }
}

function buildAnalyzerAssetIndex(assetsA: TradeAsset[], assetsB: TradeAsset[]): Record<string, IndexTradeAsset> {
  const index: Record<string, IndexTradeAsset> = {}
  const addEntry = (ia: IndexTradeAsset) => {
    index[ia.id] = ia
    if (ia.label && !index[ia.label]) index[ia.label] = ia
    const lower = ia.label?.toLowerCase()
    if (lower && !index[lower]) index[lower] = ia
  }
  for (const a of assetsA) addEntry(analyzerAssetToIndex(a, 'A'))
  for (const a of assetsB) addEntry(analyzerAssetToIndex(a, 'B'))
  return index
}

export default function LegacyTradeAnalyzerPage() {
  const [sport, setSport] = useState<Sport>('NFL')
  const [format, setFormat] = useState<Format>('dynasty')
  const [leagueType, setLeagueType] = useState<LeagueType>('standard')
  const [idpEnabled, setIdpEnabled] = useState(true)

  // Trade goal state
  const [selectedGoal, setSelectedGoal] = useState<string | null>(null)
  const [showGoalComment, setShowGoalComment] = useState(false)
  const [goalComment, setGoalComment] = useState('')

  // League and manager selection
  const [userLeagues, setUserLeagues] = useState<LeagueOption[]>([])
  const [selectedLeagueId, setSelectedLeagueId] = useState('')
  const [leagueManagers, setLeagueManagers] = useState<ManagerOption[]>([])
  const [managerByRosterId, setManagerByRosterId] = useState<Record<number, ManagerOption>>({})
  const [loadingLeagues, setLoadingLeagues] = useState(false)
  const [loadingManagers, setLoadingManagers] = useState(false)

  const [sleeperA, setSleeperA] = useState('')
  const [sleeperB, setSleeperB] = useState('')
  const [leagueId, setLeagueId] = useState('')

  const [rosterA, setRosterA] = useState<RosteredPlayer[]>([])
  const [rosterB, setRosterB] = useState<RosteredPlayer[]>([])

  const [prepLoading, setPrepLoading] = useState(false)
  const [prepReady, setPrepReady] = useState(false)
  const [leagueInfo, setLeagueInfo] = useState<{
    name?: string
    season?: string
    managerCount?: number
    scoringType?: string
  } | null>(null)

  const [resolvedA, setResolvedA] = useState<{
    league_id: string
    sport: 'nfl' | 'nba'
    sleeper_username_input: string
    username: string
    display_name: string
    user_id: string
    roster_id: number
  } | null>(null)
  const [resolvedB, setResolvedB] = useState<{
    league_id: string
    sport: 'nfl' | 'nba'
    sleeper_username_input: string
    username: string
    display_name: string
    user_id: string
    roster_id: number
  } | null>(null)

  const [assetsA, setAssetsA] = useState<TradeAsset[]>([])
  const [assetsB, setAssetsB] = useState<TradeAsset[]>([])
  const [pickSelectA, setPickSelectA] = useState('')
  const [pickSelectB, setPickSelectB] = useState('')

  const [playerQueryA, setPlayerQueryA] = useState('')
  const [playerQueryB, setPlayerQueryB] = useState('')

  const [pickYearA, setPickYearA] = useState(String(currentYear()))
  const [pickRoundA, setPickRoundA] = useState('1')
  const [pickNumberA, setPickNumberA] = useState('')
  const [faabA, setFaabA] = useState('')

  const [pickYearB, setPickYearB] = useState(String(currentYear()))
  const [pickRoundB, setPickRoundB] = useState('1')
  const [pickNumberB, setPickNumberB] = useState('')
  const [faabB, setFaabB] = useState('')

  const [analyzing, setAnalyzing] = useState(false)
  const [step, setStep] = useState(0)
  const [result, setResult] = useState<AnalyzeResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showNegotiation, setShowNegotiation] = useState(false)

  const [negCandidate, setNegCandidate] = useState<TradeCandidate | null>(null)
  const [negAssetIndex, setNegAssetIndex] = useState<Record<string, IndexTradeAsset> | null>(null)

  const [pickInventoryByRoster, setPickInventoryByRoster] = useState<Record<number, Array<{ value: string; label: string; year: number; round: number; pick: number }>>>({})
  const [faabByRoster, setFaabByRoster] = useState<Record<number, number>>({})

  const [tradeRemaining, setTradeRemaining] = useState<number | null>(null)
  const [tradeRetryAfterSec, setTradeRetryAfterSec] = useState<number | null>(null)

  const [numTeams, setNumTeams] = useState<number | null>(null)

  const [includeSocialPulse, setIncludeSocialPulse] = useState(false)
  const [socialPulse, setSocialPulse] = useState<any>(null)
  const [socialLoading, setSocialLoading] = useState(false)
  const [socialInfo, setSocialInfo] = useState<string | null>(null)
  const [socialRemaining, setSocialRemaining] = useState<number | null>(null)
  const [socialRetryAfterSec, setSocialRetryAfterSec] = useState<number | null>(null)

  useEffect(() => {
    if (!showNegotiation) {
      setNegCandidate(null)
      setNegAssetIndex(null)
    }
  }, [showNegotiation, assetsA, assetsB])

  const fetchSocialPulse = async (players: string[]) => {
    if (!players.length) return

    setSocialLoading(true)
    setSocialPulse(null)
    setSocialInfo(null)

    try {
      const res = await fetch('/api/legacy/social-pulse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          players: extractPlayerContextFromAssets(assetsA, assetsB),
          sport,
          format,
        }),
      })
      const data = await res.json()

      if (data?.rate_limit) {
        setSocialRemaining(data.rate_limit.remaining ?? null)
        setSocialRetryAfterSec(data.rate_limit.retryAfterSec ?? null)
      }

      if (res.status === 429) {
        setSocialInfo(`Social Pulse rate limit hit. Try again in ${data?.retryAfterSec ?? 60}s.`)
        return
      }

      if (!res.ok) {
        setSocialInfo(data?.error || 'Failed to fetch Social Pulse')
        return
      }

      setSocialPulse(data?.result ?? null)
    } catch (e) {
      setSocialInfo(e instanceof Error ? e.message : 'Failed to fetch Social Pulse')
    } finally {
      setSocialLoading(false)
    }
  }

  const leagueMode = Boolean((selectedLeagueId || leagueId).trim())
  const showIdp = sport === 'NFL'
  const canRunSocialPulse = useMemo(() => {
    return [...assetsA, ...assetsB].some((a) => a?.type === 'player' && (a as any)?.player?.name)
  }, [assetsA, assetsB])

  // Fetch user leagues when username is entered
  const fetchUserLeagues = async (username: string) => {
    if (!username.trim()) return
    setLoadingLeagues(true)
    try {
      const sportLower = sport.toLowerCase()
      const res = await fetch(`https://api.sleeper.app/v1/user/${username}`) // db-first-exception: legacy trade analyzer bootstrap
      if (!res.ok) throw new Error('User not found')
      const userData = await res.json()
      
      const leaguesRes = await fetch(`https://api.sleeper.app/v1/user/${userData.user_id}/leagues/${sportLower}/2025`) // db-first-exception: legacy trade analyzer bootstrap
      if (!leaguesRes.ok) throw new Error('Failed to fetch leagues')
      const leagues = await leaguesRes.json()
      
      setUserLeagues(leagues.filter((l: any) => l.status === 'in_season' || l.status === 'pre_draft' || l.status === 'drafting' || l.status === 'complete'))
    } catch (e) {
      console.error('Failed to fetch leagues:', e)
      setUserLeagues([])
    } finally {
      setLoadingLeagues(false)
    }
  }

  type SleeperTradedPick = {
    season: string | number
    round: number
    roster_id: number
    previous_owner_id: number
    owner_id: number
  }

  const parseSeasonYear = (s: string | number) => {
    const n = typeof s === 'string' ? Number(s) : s
    return Number.isFinite(n) ? n : currentYear()
  }

  const buildDefaultPickInventory = (
    rosters: ManagerOption[], 
    sportVal: Sport,
    slotMap: Map<number, number> | null
  ) => {
    const years = [currentYear(), currentYear() + 1, currentYear() + 2, currentYear() + 3]
    const rounds = sportVal === 'NFL' ? [1, 2, 3, 4] : [1, 2]

    const inv: Record<number, Array<{ value: string; label: string; year: number; round: number; pick: number }>> = {}
    for (const r of rosters) inv[r.roster_id] = []

    rosters.forEach((r) => {
      const slot = slotMap?.get(r.roster_id) ?? r.roster_id
      const pickStr = String(slot).padStart(2, '0')
      for (const year of years) {
        for (const round of rounds) {
          inv[r.roster_id].push({
            value: `${year}-${round}.${pickStr}`,
            label: `${year} ${round}.${pickStr}`,
            year,
            round,
            pick: slot,
          })
        }
      }
    })
    return inv
  }

  const applyTradedPicks = (
    base: Record<number, Array<{ value: string; label: string; year: number; round: number; pick: number }>>,
    traded: SleeperTradedPick[],
    rosters: ManagerOption[],
    slotMap: Map<number, number> | null
  ) => {
    const rosterIds = new Set(rosters.map(r => r.roster_id))
    const numTeams = rosters.length || 12

    const removePickEverywhere = (year: number, round: number, slot: number) => {
      const pickStr = String(slot).padStart(2, '0')
      const value = `${year}-${round}.${pickStr}`
      for (const rid of Object.keys(base)) {
        base[Number(rid)] = base[Number(rid)].filter(p => p.value !== value)
      }
      return { value, label: `${year} ${round}.${pickStr}`, year, round, pick: slot }
    }

    for (const tp of traded) {
      const year = parseSeasonYear(tp.season)
      const round = Number(tp.round)
      const originalRosterId = Number(tp.roster_id)
      const newOwnerRosterId = Number(tp.owner_id)

      if (!rosterIds.has(originalRosterId) || !rosterIds.has(newOwnerRosterId)) continue
      if (originalRosterId === newOwnerRosterId) continue
      const slot = slotMap?.get(originalRosterId) ?? originalRosterId
      if (!slot || slot < 1 || slot > numTeams) continue

      const movedPick = removePickEverywhere(year, round, slot)
      base[newOwnerRosterId] = base[newOwnerRosterId] ?? []
      base[newOwnerRosterId].push(movedPick)
    }

    for (const rid of Object.keys(base)) {
      base[Number(rid)].sort((a, b) => (a.year - b.year) || (a.round - b.round) || (a.pick - b.pick))
    }
    return base
  }

  const fetchLeaguePickInventory = async (leagueIdToFetch: string, rosters: ManagerOption[], sportVal: Sport) => {
    if (!leagueIdToFetch || !rosters.length) return
    try {
      const [tradedRes, draftsRes] = await Promise.all([
        fetch(`https://api.sleeper.app/v1/league/${leagueIdToFetch}/traded_picks`), // db-first-exception: legacy trade analyzer league bootstrap
        fetch(`https://api.sleeper.app/v1/league/${leagueIdToFetch}/drafts`), // db-first-exception: legacy trade analyzer league bootstrap
      ])
      const traded: SleeperTradedPick[] = tradedRes.ok ? await tradedRes.json() : []
      const drafts: any[] = draftsRes.ok ? await draftsRes.json() : []

      // Build roster_id -> draft slot mapping from the most recent draft
      let slotMap: Map<number, number> | null = null
      const rosterUsers = await fetch(`https://api.sleeper.app/v1/league/${leagueIdToFetch}/rosters`) // db-first-exception: legacy trade analyzer league bootstrap
      const rosterData: any[] = rosterUsers.ok ? await rosterUsers.json() : []
      const userToRoster = new Map<string, number>()
      for (const r of rosterData) {
        if (r?.owner_id) userToRoster.set(String(r.owner_id), Number(r.roster_id))
      }

      // Sort drafts by season descending to find the most recent
      const sortedDrafts = [...drafts].sort((a, b) => parseInt(b.season || '0') - parseInt(a.season || '0'))
      for (const draft of sortedDrafts) {
        const map = new Map<number, number>()
        if (draft.slot_to_roster_id) {
          for (const [slotStr, rId] of Object.entries(draft.slot_to_roster_id)) {
            map.set(Number(rId), parseInt(slotStr))
          }
        } else if (draft.draft_order) {
          for (const [userId, slot] of Object.entries(draft.draft_order)) {
            const rosterId = userToRoster.get(userId)
            if (rosterId) map.set(rosterId, Number(slot))
          }
        }
        if (map.size > 0) {
          slotMap = map
          break
        }
      }

      const base = buildDefaultPickInventory(rosters, sportVal, slotMap)
      const finalInv = applyTradedPicks(base, traded, rosters, slotMap)
      setPickInventoryByRoster(finalInv)
    } catch (e) {
      console.error('Failed to fetch traded picks:', e)
      setPickInventoryByRoster(buildDefaultPickInventory(rosters, sportVal, null))
    }
  }

  // Fetch managers when league is selected
  const fetchLeagueManagers = async (leagueIdToFetch: string) => {
    if (!leagueIdToFetch) return
    setLoadingManagers(true)
    try {
      const [usersRes, rostersRes] = await Promise.all([
        fetch(`https://api.sleeper.app/v1/league/${leagueIdToFetch}/users`), // db-first-exception: legacy trade analyzer league bootstrap
        fetch(`https://api.sleeper.app/v1/league/${leagueIdToFetch}/rosters`), // db-first-exception: legacy trade analyzer league bootstrap
      ])

      const users = await usersRes.json()
      const rosters = await rostersRes.json()

      const userById = new Map<string, any>()
      for (const u of Array.isArray(users) ? users : []) {
        if (u?.user_id) userById.set(String(u.user_id), u)
      }

      const byRosterId: Record<number, ManagerOption> = {}
      for (const roster of Array.isArray(rosters) ? rosters : []) {
        const rid = Number(roster?.roster_id)
        if (!Number.isFinite(rid)) continue

        const ownerId = roster?.owner_id != null ? String(roster.owner_id) : null
        const user = ownerId ? userById.get(ownerId) : null

        const username = (user?.username || '').trim()
        const displayName = (user?.display_name || user?.username || `Team ${rid}`).trim()

        byRosterId[rid] = {
          user_id: ownerId || `roster_${rid}`,
          display_name: displayName,
          username,
          roster_id: rid,
        }
      }

      setManagerByRosterId(byRosterId)

      const managers: ManagerOption[] = Object.values(byRosterId).filter((m) => !!m.username)

      const faabMap: Record<number, number> = {}
      for (const r of Array.isArray(rosters) ? rosters : []) {
        const rid = Number(r?.roster_id)
        const budget =
          r?.settings?.waiver_budget ??
          r?.settings?.faab ??
          r?.settings?.budget ??
          null
        if (Number.isFinite(rid) && budget != null && Number.isFinite(Number(budget))) {
          faabMap[rid] = Number(budget)
        }
      }
      setFaabByRoster(faabMap)

      setLeagueManagers(managers)
      await fetchLeaguePickInventory(leagueIdToFetch, managers, sport)
    } catch (e) {
      console.error('Failed to fetch managers:', e)
      setLeagueManagers([])
      setManagerByRosterId({})
    } finally {
      setLoadingManagers(false)
    }
  }

  // Handle league selection
  const handleLeagueSelect = async (newLeagueId: string) => {
    setSelectedLeagueId(newLeagueId)
    setLeagueId(newLeagueId)
    setSleeperB('')
    setRosterA([])
    setRosterB([])
    setResolvedA(null)
    setResolvedB(null)
    setPrepReady(false)
    setAssetsA([])
    setAssetsB([])
    
    if (newLeagueId) {
      await fetchLeagueManagers(newLeagueId)
      // Also fetch user's roster in this league
      const selectedLeague = userLeagues.find(l => l.league_id === newLeagueId)
      if (selectedLeague) {
        // Set format based on league type
        if (selectedLeague.sport === 'nfl') setSport('NFL')
        else if (selectedLeague.sport === 'nba') setSport('NBA')
      }
    } else {
      setLeagueManagers([])
    }
  }

  // Handle trade partner selection
  const handlePartnerSelect = async (partnerUsername: string) => {
    setSleeperB(partnerUsername)
    setResolvedB(null)
    setRosterB([])
    setAssetsA([])
    if (partnerUsername && leagueId && sleeperA) {
      // Auto-prep league data
      await runLeaguePrep()
    }
  }

  // Available players for dropdown (filter out already selected)
  const availablePlayersA = useMemo(() => {
    const selectedIds = assetsA.filter(a => a.type === 'player').map(a => (a as any).player.id)
    return rosterB.filter(p => !selectedIds.includes(p.id))
  }, [rosterB, assetsA])

  const availablePlayersB = useMemo(() => {
    const selectedIds = assetsB.filter(a => a.type === 'player').map(a => (a as any).player.id)
    return rosterA.filter(p => !selectedIds.includes(p.id))
  }, [rosterA, assetsB])

  const selectedIdsA = useMemo(() => {
    return new Set(assetsA.filter(a => a.type === 'player').map(a => (a as any).player.id as string))
  }, [assetsA])

  const selectedIdsB = useMemo(() => {
    return new Set(assetsB.filter(a => a.type === 'player').map(a => (a as any).player.id as string))
  }, [assetsB])

  const managerA = useMemo(
    () => leagueManagers.find(m => m.username?.toLowerCase() === sleeperA.toLowerCase()),
    [leagueManagers, sleeperA]
  )

  const managerB = useMemo(
    () => leagueManagers.find(m => m.username?.toLowerCase() === sleeperB.toLowerCase()),
    [leagueManagers, sleeperB]
  )

  const pickOptionsFromPartner = useMemo(() => {
    if (!managerB) return []
    return pickInventoryByRoster[managerB.roster_id] ?? []
  }, [pickInventoryByRoster, managerB])

  const pickOptionsFromYou = useMemo(() => {
    if (!managerA) return []
    return pickInventoryByRoster[managerA.roster_id] ?? []
  }, [pickInventoryByRoster, managerA])

  const pickOptions = useMemo(() => {
    const numTeams = leagueManagers.length || 12
    const options: Array<{ value: string; label: string; year: number; round: number; pick: number }> = []
    const years = [currentYear(), currentYear() + 1, currentYear() + 2, currentYear() + 3]
    const rounds = sport === 'NFL' ? [1, 2, 3, 4] : [1, 2]
    for (const year of years) {
      for (const round of rounds) {
        for (let pick = 1; pick <= numTeams; pick++) {
          const pickStr = String(pick).padStart(2, '0')
          options.push({ value: `${year}-${round}.${pickStr}`, label: `${year} ${round}.${pickStr}`, year, round, pick })
        }
      }
    }
    return options
  }, [leagueManagers.length, sport])

  useEffect(() => {
    if (!canRunSocialPulse && includeSocialPulse) {
      setIncludeSocialPulse(false)
    }
  }, [canRunSocialPulse, includeSocialPulse])

  // Side A picks from rosterB (what A receives FROM B)
  const suggestionsA = useMemo(() => {
    const q = normalizeName(playerQueryA)
    if (!leagueMode || !q) return []
    const source = showIdp ? (idpEnabled ? rosterB : rosterB.filter((p) => !p.isIdp)) : rosterB
    return source.filter((p) => normalizeName(p.name).includes(q)).slice(0, 10)
  }, [leagueMode, rosterB, playerQueryA, idpEnabled, showIdp])

  // Side B picks from rosterA (what B receives FROM A)
  const suggestionsB = useMemo(() => {
    const q = normalizeName(playerQueryB)
    if (!leagueMode || !q) return []
    const source = showIdp ? (idpEnabled ? rosterA : rosterA.filter((p) => !p.isIdp)) : rosterA
    return source.filter((p) => normalizeName(p.name).includes(q)).slice(0, 10)
  }, [leagueMode, rosterA, playerQueryB, idpEnabled, showIdp])

  const canAddPick = (year: number) => {
    const y0 = currentYear()
    return year >= y0 && year <= y0 + 3
  }

  const addPlayerFromRoster = (side: Side, p: RosteredPlayer) => {
    const normalized = normalizePlayer(
      { id: p.id, name: p.name, position: p.pos, team: p.team },
      sport === 'NFL' ? 'nfl' : 'nba'
    )
    const enriched: RosteredPlayer = {
      ...p,
      media: normalized.media,
    }
    const asset: TradeAsset = { type: 'player', player: enriched }
    if (side === 'A') setAssetsA((prev) => [...prev, asset])
    else setAssetsB((prev) => [...prev, asset])
  }

  const addManualPlayer = (side: Side, name: string) => {
    const sportKey = sport === 'NFL' ? 'nfl' : 'nba'
    const normalized = normalizePlayer(
      { name, position: sport === 'NFL' ? 'WR' : 'SG' },
      sportKey
    )
    const mock: RosteredPlayer = {
      id: normalized.id,
      name,
      pos: sport === 'NFL' ? 'WR' : 'SG',
      slot: 'Bench',
      team: '',
      isIdp: false,
      media: normalized.media,
    }
    addPlayerFromRoster(side, mock)
  }

  const addPlayerByQuery = (side: Side) => {
    const q = (side === 'A' ? playerQueryA : playerQueryB).trim()
    if (!q) return

    if (leagueMode) {
      // Side A receives from rosterB, Side B receives from rosterA
      const roster = side === 'A' ? rosterB : rosterA
      const source = showIdp ? (idpEnabled ? roster : roster.filter((p) => !p.isIdp)) : roster
      const normalizedQ = normalizeName(q)
      
      // Try exact match first, then partial match
      let match = source.find((p) => normalizeName(p.name) === normalizedQ)
      if (!match) {
        // Partial match - find the first player whose name contains the query
        const matches = source.filter((p) => normalizeName(p.name).includes(normalizedQ))
        if (matches.length === 1) {
          match = matches[0]
        } else if (matches.length > 1) {
          setError('Multiple players match. Please select from the dropdown.')
          return
        }
      }

      if (!match) {
        setError(`Player not found on ${side === 'A' ? sleeperB : sleeperA}'s roster. Select from the dropdown.`)
        return
      }
      if (showIdp && !idpEnabled && match.isIdp) {
        setError('IDP is currently turned OFF. Turn it ON to add defensive players.')
        return
      }
      addPlayerFromRoster(side, match)
    } else {
      addManualPlayer(side, q)
    }

    if (side === 'A') setPlayerQueryA('')
    else setPlayerQueryB('')
  }

  const maxRounds = sport === 'NFL' ? 4 : 2
  const maxPickNumber = sport === 'NFL' ? 32 : 30

  const addPick = (side: Side) => {
    const year = Number(side === 'A' ? pickYearA : pickYearB)
    const round = Number(side === 'A' ? pickRoundA : pickRoundB) as 1 | 2 | 3 | 4
    const pickNumStr = side === 'A' ? pickNumberA : pickNumberB
    const pickNumber = pickNumStr.trim() ? Number(pickNumStr) : undefined
    
    if (!Number.isFinite(year) || !canAddPick(year)) {
      setError(`Pick year must be between ${currentYear()} and ${currentYear() + 3}.`)
      return
    }
    if (round < 1 || round > maxRounds) {
      setError(`Pick round must be 1–${maxRounds}.`)
      return
    }
    if (pickNumber !== undefined && (!Number.isFinite(pickNumber) || pickNumber < 1 || pickNumber > maxPickNumber)) {
      setError(`Pick number must be between 1 and ${maxPickNumber}.`)
      return
    }
    
    const asset: TradeAsset = { type: 'pick', pick: { year, round, pickNumber } }
    if (side === 'A') setAssetsA((p) => [...p, asset])
    else setAssetsB((p) => [...p, asset])
    
    if (side === 'A') setPickNumberA('')
    else setPickNumberB('')
  }

  const addFaab = (side: Side) => {
    const raw = side === 'A' ? faabA : faabB
    const amt = Math.max(0, Math.floor(Number(raw)))
    if (!Number.isFinite(amt)) {
      setError('FAAB must be a number.')
      return
    }
    const limitRoster = side === 'A' ? managerB?.roster_id : managerA?.roster_id
    const budget = limitRoster ? faabByRoster[limitRoster] : null
    if (budget != null && amt > budget) {
      setError(`FAAB can't exceed available budget (${budget}).`)
      return
    }
    const asset: TradeAsset = { type: 'faab', faab: { amount: amt } }
    if (side === 'A') setAssetsA((p) => [...p, asset])
    else setAssetsB((p) => [...p, asset])
  }

  const removeAsset = (side: Side, idx: number) => {
    if (side === 'A') setAssetsA((p) => p.filter((_, i) => i !== idx))
    else setAssetsB((p) => p.filter((_, i) => i !== idx))
  }

  const runLeaguePrep = async () => {
    setError(null)
    setPrepReady(false)
    setLeagueInfo(null)

    if (!leagueId.trim()) {
      setError('Enter a Sleeper League ID to prep league data.')
      return
    }
    if (!sleeperA.trim() || !sleeperB.trim()) {
      setError('Enter both Sleeper usernames before prepping league data.')
      return
    }

    setPrepLoading(true)
    try {
      const apiSport = sport === 'NBA' ? 'nba' : 'nfl'
      const lid = leagueId.trim()

      const safeFetch = async (url: string) => {
        const r = await fetch(url)
        if (!r.ok) {
          const text = await r.text().catch(() => '')
          throw new Error(text || `Request failed (${r.status})`)
        }
        return r.json()
      }

      const [aRes, bRes, leagueRes, usersRes] = await Promise.all([
        safeFetch(`/api/legacy/trade/roster?${new URLSearchParams({
          league_id: lid,
          sleeper_username: sleeperA.trim(),
          sport: apiSport,
        }).toString()}`),
        safeFetch(`/api/legacy/trade/roster?${new URLSearchParams({
          league_id: lid,
          sleeper_username: sleeperB.trim(),
          sport: apiSport,
        }).toString()}`),
        safeFetch(`https://api.sleeper.app/v1/league/${encodeURIComponent(lid)}`).catch(() => null), // db-first-exception: legacy trade analyzer context hydration
        safeFetch(`https://api.sleeper.app/v1/league/${encodeURIComponent(lid)}/users`).catch(() => null), // db-first-exception: legacy trade analyzer context hydration
      ])

      if (!aRes?.success) throw new Error(aRes?.error || 'Failed to load roster A')
      if (!bRes?.success) throw new Error(bRes?.error || 'Failed to load roster B')

      setResolvedA(aRes.resolved ?? null)
      setResolvedB(bRes.resolved ?? null)

      setRosterA(aRes.roster ?? [])
      setRosterB(bRes.roster ?? [])
      
      // Extract league info
      if (leagueRes) {
        const scoringSettings = leagueRes.scoring_settings || {}
        let scoringType = 'Standard'
        if (scoringSettings.rec === 1) scoringType = 'PPR'
        else if (scoringSettings.rec === 0.5) scoringType = 'Half PPR'
        else if (scoringSettings.bonus_rec_te) scoringType = 'TEP'
        
        const managerCount = Array.isArray(usersRes) ? usersRes.length : undefined
        setLeagueInfo({
          name: leagueRes.name || undefined,
          season: leagueRes.season || undefined,
          managerCount,
          scoringType,
        })
        setNumTeams(managerCount ?? null)
      }
      
      setPrepReady(true)
    } catch (e) {
      setRosterA([])
      setRosterB([])
      setLeagueInfo(null)
      setPrepReady(false)
      setError(e instanceof Error ? e.message : 'Failed to prep league data')
    } finally {
      setPrepLoading(false)
    }
  }

  const steps = useMemo(() => {
    const base = [
      'Validating inputs…',
      leagueMode ? 'Pulling Sleeper league data…' : 'Loading player stats…',
      'Applying format weighting…',
      sport === 'NFL' && idpEnabled ? 'Applying IDP weighting…' : null,
      'Evaluating trade fairness…',
      leagueMode ? 'Finding better trade partners…' : null,
      'Finalizing report…',
    ].filter(Boolean) as string[]
    return base
  }, [leagueMode, sport, idpEnabled])

  const analyze = async () => {
    setError(null)
    setResult(null)

    if (!sleeperA.trim() || !sleeperB.trim()) {
      setError('Please enter both Sleeper usernames.')
      return
    }

    const leagueIdResolved = (selectedLeagueId || leagueId).trim()

    if (leagueMode && !leagueIdResolved) {
      setError('Select a league first.')
      return
    }

    if (leagueMode && !prepReady) {
      setError('League mode is ON. Select a league + partner so Prep can load rosters.')
      return
    }

    if (assetsA.length === 0 || assetsB.length === 0) {
      setError('Add at least one asset on both sides.')
      return
    }

    const userRosterId = resolvedA?.roster_id ?? null
    const partnerRosterId = resolvedB?.roster_id ?? null

    if (leagueMode && (!userRosterId || !partnerRosterId)) {
      setError('League mode is ON. Prep must resolve both rosters (select league + partner, then wait for Prep).')
      return
    }

    const canonicalA = (resolvedA?.username || sleeperA.trim()).trim()
    const canonicalB = (resolvedB?.username || sleeperB.trim()).trim()

    setAnalyzing(true)
    setStep(0)

    try {
      for (let i = 0; i < steps.length; i++) {
        setStep(i)
        await new Promise((r) => setTimeout(r, 180))
      }

      const tradeGoalContext = selectedGoal
        ? `Trade Goal: ${TRADE_GOAL_PRESETS.find(g => g.id === selectedGoal)?.label}${goalComment ? ` - Additional context: ${goalComment}` : ''}`
        : goalComment || null

      console.log('[TradeAnalyze] resolved roster ids', {
        sleeperA: sleeperA.trim(),
        sleeperB: sleeperB.trim(),
        userRosterId,
        partnerRosterId,
        canonicalA,
        canonicalB,
      })

      const res = await fetch('/api/legacy/trade/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sport,
          format,
          leagueType,
          idpEnabled,

          league_id: leagueIdResolved || null,
          user_roster_id: userRosterId,
          partner_roster_id: partnerRosterId,

          sleeper_username_a: canonicalA,
          sleeper_username_b: canonicalB,

          assetsA,
          assetsB,

          numTeams: leagueMode
            ? (leagueInfo?.managerCount ?? numTeams ?? null)
            : (numTeams ?? null),

          tradeGoal: tradeGoalContext,

          rosterA: leagueMode ? rosterA : [],
          rosterB: leagueMode ? rosterB : [],
        }),
      })

      const data = await res.json()

      const rl = data?.rate_limit ?? null
      const retryAfterSecRaw = rl?.retryAfterSec ?? data?.retryAfterSec
      const remainingRaw = rl?.remaining ?? data?.remaining

      const retryAfterSec =
        retryAfterSecRaw == null ? null : Number(retryAfterSecRaw) || 0
      const remaining =
        remainingRaw == null ? null : (Number.isFinite(Number(remainingRaw)) ? Number(remainingRaw) : null)

      if (retryAfterSec != null || rl) {
        setTradeRemaining(remaining)
        setTradeRetryAfterSec(retryAfterSec)
      }

      if (res.status === 429) {
        const layer = rl?.layer ? ` (${rl.layer})` : ''
        const retry = retryAfterSec ?? 0
        const msg = data?.error || data?.message || `Rate limit hit${layer}. Try again in ${retry}s.`
        setError(msg)
        return
      }

      if (!res.ok) {
        setError(data?.error || 'Failed to analyze trade')
        return
      }

      const aiResult = data.result ?? data.data ?? null
      if (aiResult && (data.pickContext || data.leagueSize)) {
        aiResult._pickContext = data.pickContext || []
        aiResult._leagueSize = data.leagueSize ?? null
        aiResult._scarcityMultiplier = data.scarcityMultiplier ?? null
      }
      setResult(aiResult)

      if (includeSocialPulse) {
        const players = extractPlayerNamesFromAssets(assetsA, assetsB)
        if (!players.length) {
          setSocialPulse(null)
          setSocialInfo("Social Pulse requires at least 1 player asset (picks/FAAB don't count).")
        } else {
          await fetchSocialPulse(players)
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to analyze trade')
    } finally {
      setAnalyzing(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-20 left-1/4 h-96 w-96 rounded-full bg-cyan-500/15 blur-3xl" />
        <div className="absolute top-1/3 right-1/4 h-96 w-96 rounded-full bg-purple-500/15 blur-3xl" />
      </div>

      <div className="relative container mx-auto px-4 py-6 pb-24 sm:py-8 lg:pb-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <Link
            href="/af-legacy?tab=trade"
            className="inline-flex items-center gap-2 text-cyan-300 hover:text-cyan-200 transition text-sm"
          >
            <span>←</span>
            <span>Back to Legacy Tools</span>
          </Link>

          <div className="flex flex-wrap gap-2">
            <Pill tone="cyan">Legacy Tool</Pill>
            <Pill>App: Pro/Supreme</Pill>
          </div>
        </div>

        <div className="mb-6 sm:mb-8">
          <div className="flex items-center gap-3 sm:gap-4 mb-3 sm:mb-4">
            <div className="w-11 h-11 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl bg-gradient-to-br from-cyan-500/30 to-purple-500/30 flex items-center justify-center text-2xl sm:text-3xl shadow-lg flex-shrink-0">
              ⚖️
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl sm:text-3xl md:text-4xl font-extrabold tracking-tight text-white">
                Trade Analyzer
              </h1>
              <p className="mt-0.5 sm:mt-1 text-xs sm:text-sm text-white/60 truncate">
                NFL (with IDP) + NBA trade evaluation with AI synthesis
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5 sm:gap-2">
            {[
              'Sleeper rosters',
              'IDP support',
              'Better partners',
              'Leverage tips',
              'Social Pulse',
            ].map((t) => (
              <span
                key={t}
                className="px-2 sm:px-3 py-1 rounded-full bg-black/20 border border-white/10 text-[10px] sm:text-xs text-white/70"
              >
                {t}
              </span>
            ))}
          </div>
        </div>

        <div className="space-y-6">
          {/* Trade Goals Section */}
          <Card accent="amber">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500/30 to-orange-400/20 flex items-center justify-center text-xl">🎯</div>
              <div>
                <h3 className="text-xl font-bold text-white">What's Your Trade Goal?</h3>
                <p className="text-xs text-white/50">Select a goal to help the AI understand your strategy</p>
              </div>
            </div>

            <div className="mb-4 grid grid-cols-1 gap-2 min-[380px]:grid-cols-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4">
              {TRADE_GOAL_PRESETS.map((goal) => (
                <button
                  key={goal.id}
                  onClick={() => {
                    setSelectedGoal(selectedGoal === goal.id ? null : goal.id)
                    setShowGoalComment(false)
                  }}
                  className={cx(
                    'p-3 rounded-xl border transition-all text-left',
                    selectedGoal === goal.id
                      ? 'bg-amber-500/20 border-amber-400/40 ring-2 ring-amber-400/30'
                      : 'bg-black/20 border-white/10 hover:border-white/20 hover:bg-black/30'
                  )}
                >
                  <div className="text-lg mb-1">{goal.icon}</div>
                  <div className="text-sm font-semibold text-white">{goal.label}</div>
                  <div className="text-[10px] text-white/50 mt-0.5">{goal.description}</div>
                </button>
              ))}
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={() => setShowGoalComment(!showGoalComment)}
                className={cx(
                  'px-4 py-2 text-sm rounded-xl border transition font-medium',
                  showGoalComment
                    ? 'bg-purple-500/20 border-purple-400/30 text-purple-200'
                    : 'bg-black/20 border-white/10 text-white/60 hover:text-white/80 hover:border-white/20'
                )}
              >
                {showGoalComment ? 'Hide Comment' : 'Add Custom Note'}
              </button>

              <button
                onClick={() => {
                  setShowGoalComment(true)
                  if (!goalComment.trim()) setGoalComment('The narrative I want is: ')
                }}
                className="px-4 py-2 text-sm rounded-xl border transition font-medium bg-black/20 border-white/10 text-white/60 hover:text-white/80 hover:border-white/20"
              >
                Not my narrative
              </button>

              {selectedGoal && (
                <Pill tone="cyan">
                  Goal: {TRADE_GOAL_PRESETS.find(g => g.id === selectedGoal)?.label}
                </Pill>
              )}
            </div>

            {showGoalComment && (
              <div className="mt-3">
                <Input
                  value={goalComment}
                  onChange={setGoalComment}
                  placeholder="If the presets don't fit, tell the AI the narrative you want (ex: 'I need RB depth but refuse to move my 2026 1st')"
                />
              </div>
            )}
          </Card>

          {/* Setup Section */}
          <Card accent="purple">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
              <h3 className="text-xl font-bold text-cyan-300">Setup</h3>
              <div className="flex flex-wrap gap-2">
                <Pill>{leagueMode ? 'Deep mode' : 'Quick mode'}</Pill>
                {sport === 'NFL' && <Pill>{idpEnabled ? 'IDP: On' : 'IDP: Off'}</Pill>}
                <Pill>Format: {format.toUpperCase()}</Pill>
              </div>
            </div>

            {/* Step 1: Enter username and load leagues */}
            <div className="rounded-2xl bg-black/30 border border-white/10 p-4 mb-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-6 h-6 rounded-full bg-cyan-500/20 flex items-center justify-center text-xs font-bold text-cyan-300">1</div>
                <div className="text-sm font-semibold text-white">Enter Your Sleeper Username</div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="min-w-0 flex-1">
                  <Input
                    value={sleeperA}
                    onChange={(v) => {
                      setSleeperA(v)
                      setPrepReady(false)
                      setResolvedA(null)
                      setResolvedB(null)
                      setUserLeagues([])
                      setSelectedLeagueId('')
                      setLeagueManagers([])
                    }}
                    placeholder="e.g. theciege"
                  />
                </div>
                <button
                  onClick={() => fetchUserLeagues(sleeperA)}
                  disabled={!sleeperA.trim() || loadingLeagues}
                  className="touch-manipulation rounded-2xl border border-cyan-400/25 bg-cyan-500/15 px-4 py-3 text-sm font-medium text-cyan-200 transition hover:bg-cyan-500/25 disabled:opacity-50 min-h-[48px] sm:min-h-0 sm:shrink-0"
                >
                  {loadingLeagues ? 'Loading...' : 'Load Leagues'}
                </button>
              </div>
            </div>

            {/* Step 2: Select League */}
            {userLeagues.length > 0 && (
              <div className="rounded-2xl bg-black/30 border border-white/10 p-4 mb-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-6 h-6 rounded-full bg-purple-500/20 flex items-center justify-center text-xs font-bold text-purple-300">2</div>
                  <div className="text-sm font-semibold text-white">Select League</div>
                </div>
                <select
                  value={selectedLeagueId}
                  onChange={(e) => handleLeagueSelect(e.target.value)}
                  className="w-full px-4 py-3 bg-black/30 border border-white/10 rounded-2xl text-sm text-white focus:outline-none focus:border-purple-400/60 focus:ring-2 focus:ring-purple-400/20 transition"
                >
                  <option value="">Choose a league...</option>
                  {userLeagues.map((league) => (
                    <option key={league.league_id} value={league.league_id}>
                      {league.name} ({league.season}) - {league.total_rosters} teams
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Step 3: Select Trade Partner */}
            {selectedLeagueId && leagueManagers.length > 0 && (
              <div className="rounded-2xl bg-black/30 border border-white/10 p-4 mb-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-6 h-6 rounded-full bg-rose-500/20 flex items-center justify-center text-xs font-bold text-rose-300">3</div>
                  <div className="text-sm font-semibold text-white">Select Trade Partner</div>
                </div>
                <select
                  value={sleeperB}
                  onChange={(e) => handlePartnerSelect(e.target.value)}
                  className="w-full px-4 py-3 bg-black/30 border border-white/10 rounded-2xl text-sm text-white focus:outline-none focus:border-rose-400/60 focus:ring-2 focus:ring-rose-400/20 transition"
                >
                  <option value="">Choose a trade partner...</option>
                  {leagueManagers
                    .filter(m => m.username.toLowerCase() !== sleeperA.toLowerCase())
                    .map((manager) => (
                      <option key={manager.user_id} value={manager.username}>
                        {manager.display_name} (@{manager.username})
                      </option>
                    ))}
                </select>
              </div>
            )}

            {/* Settings row */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
              <div>
                <div className="text-[11px] uppercase tracking-wide text-white/50 mb-2">Sport</div>
                <Select
                  value={sport}
                  onChange={(v) => {
                    setSport(v as Sport)
                    setResult(null)
                    setError(null)
                    setPrepReady(false)
                    setResolvedA(null)
                    setResolvedB(null)
                    setRosterA([])
                    setRosterB([])
                    setAssetsA([])
                    setAssetsB([])
                  }}
                  options={[
                    { value: 'NFL', label: 'NFL' },
                    { value: 'NBA', label: 'NBA' },
                  ]}
                />
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wide text-white/50 mb-2">Format</div>
                <Select
                  value={format}
                  onChange={(v) => {
                    setFormat(v as Format)
                    setResult(null)
                    setError(null)
                  }}
                  options={[
                    { value: 'redraft', label: 'Redraft' },
                    { value: 'dynasty', label: 'Dynasty' },
                    { value: 'specialty', label: 'Specialty' },
                  ]}
                />
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wide text-white/50 mb-2">League Type</div>
                <Select
                  value={leagueType}
                  onChange={(v) => {
                    setLeagueType(v as LeagueType)
                    setResult(null)
                    setError(null)
                  }}
                  options={[
                    { value: 'standard', label: 'Standard' },
                    { value: 'bestball', label: 'Bestball' },
                  ]}
                />
              </div>
            </div>

            {leagueType === 'bestball' && (
              <div className="rounded-2xl bg-gradient-to-r from-amber-500/10 to-orange-500/10 border border-amber-500/20 p-4 mb-4">
                <div className="flex items-center gap-2 text-amber-200 text-sm font-medium">
                  <span>🎯</span>
                  <span>Bestball Mode Active</span>
                </div>
                <div className="text-xs text-white/60 mt-1">
                  Analysis will prioritize depth, boom/bust upside, and weekly ceiling over floor. Handcuffs valued less, high-variance players valued more.
                </div>
              </div>
            )}

            {showIdp && (
              <div className="rounded-2xl bg-black/30 border border-white/10 p-4 mb-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-white">IDP Enabled (NFL)</div>
                    <div className="text-xs text-white/50 mt-1">Include DL/LB/DB/EDGE in roster suggestions.</div>
                  </div>
                  <button
                    onClick={() => {
                      setIdpEnabled((p) => !p)
                      setError(null)
                    }}
                    className={cx(
                      'px-4 py-2 text-sm rounded-xl border transition font-medium',
                      idpEnabled
                        ? 'bg-emerald-500/15 hover:bg-emerald-500/25 border-emerald-400/25 text-emerald-200'
                        : 'bg-white/5 hover:bg-white/10 border-white/10 text-white/70'
                    )}
                  >
                    {idpEnabled ? 'On' : 'Off'}
                  </button>
                </div>
              </div>
            )}

            {/* League data status */}
            {prepReady && leagueInfo && (
              <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/30 p-4 mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-emerald-400 text-lg">✓</span>
                  <span className="text-emerald-200 font-semibold">Ready to Build Trade</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  {leagueInfo.name && (
                    <div>
                      <div className="text-white/50 text-xs uppercase tracking-wide">League</div>
                      <div className="text-white/90 truncate" title={leagueInfo.name}>{leagueInfo.name}</div>
                    </div>
                  )}
                  {leagueInfo.season && (
                    <div>
                      <div className="text-white/50 text-xs uppercase tracking-wide">Season</div>
                      <div className="text-white/90">{leagueInfo.season}</div>
                    </div>
                  )}
                  {leagueInfo.managerCount && (
                    <div>
                      <div className="text-white/50 text-xs uppercase tracking-wide">Managers</div>
                      <div className="text-white/90">{leagueInfo.managerCount} teams</div>
                    </div>
                  )}
                  {leagueInfo.scoringType && (
                    <div>
                      <div className="text-white/50 text-xs uppercase tracking-wide">Scoring</div>
                      <div className="text-white/90">{leagueInfo.scoringType}</div>
                    </div>
                  )}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Pill tone="cyan">{sleeperA}: {rosterA.length} players</Pill>
                  <Pill tone="purple">{sleeperB}: {rosterB.length} players</Pill>
                  {resolvedA?.roster_id != null && <Pill tone="cyan">Roster ID: {resolvedA.roster_id}</Pill>}
                  {resolvedB?.roster_id != null && <Pill tone="purple">Roster ID: {resolvedB.roster_id}</Pill>}
                </div>
              </div>
            )}

            {error && (
              <div className="mt-4 rounded-2xl bg-red-500/10 border border-red-500/30 p-4 text-sm text-red-200">
                {error}
              </div>
            )}
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card accent="cyan">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500/30 to-cyan-400/20 flex items-center justify-center text-xl">📥</div>
                  <div>
                    <h3 className="text-xl font-bold text-white"><span className="text-cyan-300">{sleeperA || 'You'}</span> Receives</h3>
                    {prepReady && <div className="text-xs text-white/50">From {sleeperB || "Partner"}'s roster</div>}
                  </div>
                </div>
              </div>

              {/* Players Section */}
              <div className="rounded-2xl bg-black/30 border border-white/10 p-4 mb-3">
                <div className="text-[11px] uppercase tracking-wide text-white/50 mb-2">Add Player</div>
                {prepReady && availablePlayersA.length > 0 ? (
                  <PlayerSearchDropdown
                    players={availablePlayersA}
                    onSelect={(player) => addPlayerFromRoster('A', player as RosteredPlayer)}
                    placeholder={`Search ${sleeperB}'s roster...`}
                    accent="cyan"
                  />
                ) : (
                  <div className="text-sm text-white/40 py-2">
                    {prepReady ? 'No available players' : 'Select a league and trade partner first'}
                  </div>
                )}
                
                {/* Selected Players */}
                {assetsA.some(a => a.type === 'player') && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {assetsA.map((a, realIdx) => {
                      if (a.type !== 'player') return null
                      return (
                        <Chip key={`A-player-${realIdx}`} label={formatAsset(a)} asset={a} onRemove={() => removeAsset('A', realIdx)} />
                      )
                    })}
                  </div>
                )}

                {prepReady && (
                  <RosterPickerPanel
                    roster={rosterB}
                    selectedIds={selectedIdsA}
                    onAdd={(p) => addPlayerFromRoster('A', p)}
                    accent="cyan"
                    idpEnabled={idpEnabled}
                  />
                )}
              </div>

              {/* Draft Picks Section */}
              <div className="rounded-2xl bg-black/30 border border-white/10 p-4 mb-3">
                <div className="text-[11px] uppercase tracking-wide text-white/50 mb-2">Add Draft Pick</div>
                <select
                  value={pickSelectA}
                  onChange={(e) => {
                    const val = e.target.value
                    setPickSelectA(val)
                    const opts = pickOptionsFromPartner.length ? pickOptionsFromPartner : pickOptions
                    const pick = opts.find(p => p.value === val)
                    if (pick) {
                      const asset: TradeAsset = { 
                        type: 'pick', 
                        pick: { year: pick.year, round: pick.round as 1|2|3|4, pickNumber: pick.pick, originalRosterId: pick.pick } 
                      }
                      setAssetsA(prev => [...prev, asset])
                      setPickSelectA('')
                    }
                  }}
                  className="w-full px-4 py-3 bg-black/30 border border-white/10 rounded-2xl text-sm text-white focus:outline-none focus:border-purple-400/60 focus:ring-2 focus:ring-purple-400/20 transition"
                >
                  <option value="">Select a draft pick (e.g., 2026 1.01)...</option>
                  {(pickOptionsFromPartner.length ? pickOptionsFromPartner : pickOptions).map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
                
                {/* Selected Picks */}
                {assetsA.some(a => a.type === 'pick') && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {assetsA.map((a, realIdx) => {
                      if (a.type !== 'pick') return null
                      return (
                        <Chip key={`A-pick-${realIdx}`} label={formatAsset(a)} asset={a} onRemove={() => removeAsset('A', realIdx)} />
                      )
                    })}
                  </div>
                )}
              </div>

              {/* FAAB Section */}
              <div className="rounded-2xl bg-black/30 border border-white/10 p-4">
                <div className="text-[11px] uppercase tracking-wide text-white/50 mb-2">Add FAAB</div>
                {managerB && faabByRoster[managerB.roster_id] != null && (
                  <div className="text-[11px] text-white/40 mb-2">
                    {sleeperB} FAAB available: <span className="text-white/70">{faabByRoster[managerB.roster_id]}</span>
                  </div>
                )}
                <div className="flex gap-2">
                  <Input value={faabA} onChange={setFaabA} placeholder="Amount ($)" type="number" />
                  <button
                    onClick={() => {
                      addFaab('A')
                      setFaabA('')
                    }}
                    disabled={!faabA}
                    className="px-4 py-3 rounded-2xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-400/25 text-amber-200 transition font-medium text-sm disabled:opacity-50"
                  >
                    Add
                  </button>
                </div>
                
                {/* Selected FAAB */}
                {assetsA.some(a => a.type === 'faab') && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {assetsA.map((a, realIdx) => {
                      if (a.type !== 'faab') return null
                      return (
                        <Chip key={`A-faab-${realIdx}`} label={formatAsset(a)} asset={a} onRemove={() => removeAsset('A', realIdx)} />
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Summary */}
              <div className="mt-4 rounded-xl bg-cyan-500/10 border border-cyan-400/20 p-3">
                <div className="text-xs font-medium text-cyan-200">
                  {sleeperA || 'You'} receives: {assetsA.length} asset{assetsA.length !== 1 ? 's' : ''}
                </div>
              </div>
            </Card>

            <Card accent="rose">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-500/30 to-rose-400/20 flex items-center justify-center text-xl">📥</div>
                  <div>
                    <h3 className="text-xl font-bold text-white"><span className="text-rose-300">{sleeperB || 'Partner'}</span> Receives</h3>
                    {prepReady && <div className="text-xs text-white/50">From {sleeperA || "Your"}'s roster</div>}
                  </div>
                </div>
              </div>

              {/* Players Section */}
              <div className="rounded-2xl bg-black/30 border border-white/10 p-4 mb-3">
                <div className="text-[11px] uppercase tracking-wide text-white/50 mb-2">Add Player</div>
                {prepReady && availablePlayersB.length > 0 ? (
                  <PlayerSearchDropdown
                    players={availablePlayersB}
                    onSelect={(player) => addPlayerFromRoster('B', player as RosteredPlayer)}
                    placeholder={`Search ${sleeperA}'s roster...`}
                    accent="rose"
                  />
                ) : (
                  <div className="text-sm text-white/40 py-2">
                    {prepReady ? 'No available players' : 'Select a league and trade partner first'}
                  </div>
                )}
                
                {/* Selected Players */}
                {assetsB.some(a => a.type === 'player') && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {assetsB.map((a, realIdx) => {
                      if (a.type !== 'player') return null
                      return (
                        <Chip key={`B-player-${realIdx}`} label={formatAsset(a)} asset={a} onRemove={() => removeAsset('B', realIdx)} />
                      )
                    })}
                  </div>
                )}

                {prepReady && (
                  <RosterPickerPanel
                    roster={rosterA}
                    selectedIds={selectedIdsB}
                    onAdd={(p) => addPlayerFromRoster('B', p)}
                    accent="rose"
                    idpEnabled={idpEnabled}
                  />
                )}
              </div>

              {/* Draft Picks Section */}
              <div className="rounded-2xl bg-black/30 border border-white/10 p-4 mb-3">
                <div className="text-[11px] uppercase tracking-wide text-white/50 mb-2">Add Draft Pick</div>
                <select
                  value={pickSelectB}
                  onChange={(e) => {
                    const val = e.target.value
                    setPickSelectB(val)
                    const opts = pickOptionsFromYou.length ? pickOptionsFromYou : pickOptions
                    const pick = opts.find(p => p.value === val)
                    if (pick) {
                      const asset: TradeAsset = { 
                        type: 'pick', 
                        pick: { year: pick.year, round: pick.round as 1|2|3|4, pickNumber: pick.pick, originalRosterId: pick.pick } 
                      }
                      setAssetsB(prev => [...prev, asset])
                      setPickSelectB('')
                    }
                  }}
                  className="w-full px-4 py-3 bg-black/30 border border-white/10 rounded-2xl text-sm text-white focus:outline-none focus:border-purple-400/60 focus:ring-2 focus:ring-purple-400/20 transition"
                >
                  <option value="">Select a draft pick (e.g., 2026 1.01)...</option>
                  {(pickOptionsFromYou.length ? pickOptionsFromYou : pickOptions).map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
                
                {/* Selected Picks */}
                {assetsB.some(a => a.type === 'pick') && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {assetsB.map((a, realIdx) => {
                      if (a.type !== 'pick') return null
                      return (
                        <Chip key={`B-pick-${realIdx}`} label={formatAsset(a)} asset={a} onRemove={() => removeAsset('B', realIdx)} />
                      )
                    })}
                  </div>
                )}
              </div>

              {/* FAAB Section */}
              <div className="rounded-2xl bg-black/30 border border-white/10 p-4">
                <div className="text-[11px] uppercase tracking-wide text-white/50 mb-2">Add FAAB</div>
                {managerA && faabByRoster[managerA.roster_id] != null && (
                  <div className="text-[11px] text-white/40 mb-2">
                    {sleeperA} FAAB available: <span className="text-white/70">{faabByRoster[managerA.roster_id]}</span>
                  </div>
                )}
                <div className="flex gap-2">
                  <Input value={faabB} onChange={setFaabB} placeholder="Amount ($)" type="number" />
                  <button
                    onClick={() => {
                      addFaab('B')
                      setFaabB('')
                    }}
                    disabled={!faabB}
                    className="px-4 py-3 rounded-2xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-400/25 text-amber-200 transition font-medium text-sm disabled:opacity-50"
                  >
                    Add
                  </button>
                </div>
                
                {/* Selected FAAB */}
                {assetsB.some(a => a.type === 'faab') && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {assetsB.map((a, realIdx) => {
                      if (a.type !== 'faab') return null
                      return (
                        <Chip key={`B-faab-${realIdx}`} label={formatAsset(a)} asset={a} onRemove={() => removeAsset('B', realIdx)} />
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Summary */}
              <div className="mt-4 rounded-xl bg-rose-500/10 border border-rose-400/20 p-3">
                <div className="text-xs font-medium text-rose-200">
                  {sleeperB || 'Partner'} receives: {assetsB.length} asset{assetsB.length !== 1 ? 's' : ''}
                </div>
              </div>
            </Card>
          </div>

          <Card accent="purple">
            <div className="flex flex-col gap-3 sm:gap-4 mb-4">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-lg sm:text-xl font-bold text-cyan-300">Analyze</h3>
                <CooldownPill remaining={tradeRemaining} retryAfterSec={tradeRetryAfterSec} label="AI runs" />
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={analyze}
                  disabled={
                    analyzing ||
                    (tradeRetryAfterSec != null && tradeRetryAfterSec > 0) ||
                    assetsA.length === 0 ||
                    assetsB.length === 0 ||
                    (leagueMode && (!prepReady || !resolvedA || !resolvedB))
                  }
                  className="flex-1 sm:flex-none px-4 sm:px-5 py-3 sm:py-2.5 text-sm sm:text-base rounded-xl font-semibold transition-all duration-200 disabled:opacity-50 active:scale-95 touch-manipulation
                    bg-gradient-to-r from-cyan-500/80 to-purple-500/80 hover:from-cyan-400/90 hover:to-purple-400/90
                    text-white shadow-[0_6px_16px_rgba(0,0,0,0.25)] sm:shadow-[0_8px_20px_rgba(0,0,0,0.3)] min-h-[48px] sm:min-h-auto"
                >
                  {analyzing ? (
                    <span className="inline-flex items-center gap-2 justify-center">
                      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                      Analyzing…
                    </span>
                  ) : (
                    'Analyze Trade'
                  )}
                </button>
                <button
                  onClick={() => setResult(null)}
                  disabled={analyzing}
                  className="px-3 sm:px-4 py-3 sm:py-2.5 text-sm rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 transition-all duration-200 disabled:opacity-50 font-medium active:scale-95 touch-manipulation min-h-[48px] sm:min-h-auto"
                >
                  Clear
                </button>
                <button
                  onClick={() => setIncludeSocialPulse((v) => !v)}
                  disabled={analyzing || !canRunSocialPulse}
                  className={cx(
                    "flex-1 sm:flex-none px-3 sm:px-4 py-3 sm:py-2.5 text-xs sm:text-sm rounded-xl border transition-all duration-200 disabled:opacity-50 font-medium active:scale-95 touch-manipulation min-h-[48px] sm:min-h-auto",
                    includeSocialPulse
                      ? "bg-purple-500/15 hover:bg-purple-500/25 border-purple-400/25 text-purple-200"
                      : "bg-white/5 hover:bg-white/10 border-white/10 text-white/70"
                  )}
                  title={
                    !canRunSocialPulse
                      ? "Add at least 1 player asset (picks/FAAB don't count) to enable Social Pulse"
                      : "Adds a read-only summary of public social narratives (does not change verdict)"
                  }
                >
                  {includeSocialPulse ? "Social Pulse: ON" : "Social Pulse: OFF"}
                </button>
              </div>

              {!analyzing && (
                <div className="text-[11px] text-white/40 mt-1">
                  {leagueMode && !prepReady && !prepLoading && 'Select a league + partner to load rosters'}
                  {leagueMode && prepLoading && 'Prep is loading…'}
                  {leagueMode && prepReady && resolvedA && resolvedB && assetsA.length > 0 && assetsB.length > 0 && 'Ready'}
                  {(!leagueMode || (prepReady && resolvedA && resolvedB)) && (assetsA.length === 0 || assetsB.length === 0) && 'Add assets on both sides to analyze'}
                </div>
              )}
            </div>

            {analyzing ? (
              <div>
                <div className="text-sm text-white/70">{steps[Math.min(step, steps.length - 1)]}</div>
                <div className="mt-3 h-2 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-2 rounded-full bg-gradient-to-r from-cyan-400/70 to-purple-400/70 transition-all duration-300"
                    style={{ width: `${Math.round(((step + 1) / steps.length) * 100)}%` }}
                  />
                </div>
                <div className="mt-2 text-[11px] text-white/50">
                  Step {Math.min(step + 1, steps.length)} / {steps.length}
                </div>
              </div>
            ) : (
              <div className="text-sm text-white/50">
                {leagueMode ? (
                  <>Deep mode uses <span className="text-white/70">roster-only</span> assets + league context.</>
                ) : (
                  <>Quick mode uses manual assets. Add a League ID for full context.</>
                )}
              </div>
            )}
          </Card>

          {result ? (
            <div className="space-y-6">
              <Card
                className={cx(
                  'transition-shadow duration-300',
                  verdictBorderTint(result.verdict),
                  verdictHoverGlow(result.verdict)
                )}
              >
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                  <div className="flex items-center gap-3">
                    <h3 className="text-xl font-bold text-cyan-300">Verdict</h3>
                    {result.grade && (
                      <span className={cx(
                        "px-3 py-1 rounded-lg font-bold text-lg",
                        result.grade.startsWith('A') ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30" :
                        result.grade.startsWith('B') ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30" :
                        result.grade.startsWith('C') ? "bg-yellow-500/20 text-yellow-300 border border-yellow-500/30" :
                        "bg-red-500/20 text-red-300 border border-red-500/30"
                      )}>
                        {result.grade}
                      </span>
                    )}
                  </div>
                  <VerdictPill verdict={result.verdict} />
                </div>

                {result.expertAnalysis && (
                  <div className="rounded-2xl bg-gradient-to-br from-purple-500/10 to-cyan-500/10 border border-purple-500/20 p-4 mb-4">
                    <div className="text-sm font-semibold text-purple-300 mb-2">Expert Analysis</div>
                    <p className="text-sm text-white/80 leading-relaxed">{result.expertAnalysis}</p>
                  </div>
                )}

                {result.teamAnalysis && (
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className="rounded-xl bg-black/20 border border-white/10 p-3">
                      <div className="text-xs text-white/50 uppercase tracking-wide mb-1">{sleeperA || 'Team A'}</div>
                      <div className="text-sm font-semibold text-cyan-300">{result.teamAnalysis.teamAPhase || 'Unknown'}</div>
                      {result.teamAnalysis.teamAProblems?.slice(0, 2).map((p: string, i: number) => (
                        <div key={i} className="text-xs text-white/60 mt-1">• {p}</div>
                      ))}
                    </div>
                    <div className="rounded-xl bg-black/20 border border-white/10 p-3">
                      <div className="text-xs text-white/50 uppercase tracking-wide mb-1">{sleeperB || 'Team B'}</div>
                      <div className="text-sm font-semibold text-purple-300">{result.teamAnalysis.teamBPhase || 'Unknown'}</div>
                      {result.teamAnalysis.teamBProblems?.slice(0, 2).map((p: string, i: number) => (
                        <div key={i} className="text-xs text-white/60 mt-1">• {p}</div>
                      ))}
                    </div>
                  </div>
                )}

                {result.assetBreakdown && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    {(result.assetBreakdown.teamAReceives?.length ?? 0) > 0 && (
                      <div className="rounded-2xl bg-black/30 border border-cyan-500/20 p-4">
                        <div className="text-sm font-semibold text-cyan-300 mb-3">{sleeperA || 'Team A'} Receives</div>
                        <div className="space-y-2">
                          {(result.assetBreakdown.teamAReceives ?? []).map((a: any, i: number) => (
                            <div key={i} className="rounded-xl bg-black/30 border border-white/10 p-2">
                              <div className="flex items-center justify-between">
                                <span className="text-sm font-medium text-white/90">{a.asset}</span>
                                <span className="text-xs px-2 py-0.5 rounded bg-white/10 text-white/70">{a.tier}</span>
                              </div>
                              <div className="text-xs text-white/60 mt-1">{a.outlook}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {(result.assetBreakdown.teamBReceives?.length ?? 0) > 0 && (
                      <div className="rounded-2xl bg-black/30 border border-purple-500/20 p-4">
                        <div className="text-sm font-semibold text-purple-300 mb-3">{sleeperB || 'Team B'} Receives</div>
                        <div className="space-y-2">
                          {(result.assetBreakdown.teamBReceives ?? []).map((a: any, i: number) => (
                            <div key={i} className="rounded-xl bg-black/30 border border-white/10 p-2">
                              <div className="flex items-center justify-between">
                                <span className="text-sm font-medium text-white/90">{a.asset}</span>
                                <span className="text-xs px-2 py-0.5 rounded bg-white/10 text-white/70">{a.tier}</span>
                              </div>
                              <div className="text-xs text-white/60 mt-1">{a.outlook}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {result.lineupDelta && (
                  <div className="rounded-2xl bg-black/30 border border-white/10 p-4 mb-4">
                    <div className="text-sm font-semibold text-white/80 mb-3">Lineup Impact</div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <div className="text-xs text-white/50 uppercase tracking-wide">{sleeperA}</div>
                        <div className="text-sm text-white/80 mt-1">{result.lineupDelta.teamAChange || 'No change'}</div>
                        {result.lineupDelta.weeklyPointsImpactA && (
                          <div className="text-xs text-emerald-400 mt-1">{result.lineupDelta.weeklyPointsImpactA}</div>
                        )}
                      </div>
                      <div>
                        <div className="text-xs text-white/50 uppercase tracking-wide">{sleeperB}</div>
                        <div className="text-sm text-white/80 mt-1">{result.lineupDelta.teamBChange || 'No change'}</div>
                        {result.lineupDelta.weeklyPointsImpactB && (
                          <div className="text-xs text-emerald-400 mt-1">{result.lineupDelta.weeklyPointsImpactB}</div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {Array.isArray(result.leagueSizeImpact) && result.leagueSizeImpact.length > 0 && (
                  <div className="rounded-2xl bg-gradient-to-br from-indigo-500/10 to-blue-500/10 border border-indigo-500/20 p-4 mb-4">
                    <div className="text-sm font-semibold text-indigo-300 mb-2">
                      League Size Impact{result._leagueSize ? ` (${result._leagueSize} teams)` : ''}
                    </div>
                    <ul className="space-y-1">
                      {result.leagueSizeImpact.map((b: string, i: number) => (
                        <li key={i} className="text-sm text-white/80 flex gap-2">
                          <span className="text-indigo-400 mt-0.5">•</span>
                          <span>{b}</span>
                        </li>
                      ))}
                    </ul>
                    {result._scarcityMultiplier != null && result._scarcityMultiplier !== 1 && (
                      <div className="mt-2 text-xs text-indigo-300/70">
                        Scarcity multiplier: {result._scarcityMultiplier}x on locked-in starters
                      </div>
                    )}
                  </div>
                )}

                {Array.isArray(result._pickContext) && result._pickContext.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-4">
                    {result._pickContext.map((pc: any, i: number) => (
                      <span
                        key={i}
                        className={cx(
                          'px-2.5 py-1 rounded-full text-xs font-semibold border',
                          pc.tier === 'early' ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25' :
                          pc.tier === 'late' ? 'bg-orange-500/15 text-orange-300 border-orange-500/25' :
                          'bg-white/10 text-white/70 border-white/15'
                        )}
                      >
                        {pc.year} {pc.roundLabel}
                      </span>
                    ))}
                  </div>
                )}

                {Array.isArray(result.riskFlags) && result.riskFlags.length > 0 && (
                  <div className="rounded-2xl bg-red-500/10 border border-red-500/20 p-4 mb-4">
                    <div className="text-sm font-semibold text-red-300 mb-2">Risk Flags</div>
                    <ul className="space-y-1">
                      {result.riskFlags.map((r: string, i: number) => (
                        <li key={i} className="text-sm text-red-200/80 flex gap-2">
                          <span className="text-red-400">⚠</span>
                          <span>{r}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {Array.isArray(result.whenThisBackfires) && result.whenThisBackfires.length > 0 && (
                  <div className="rounded-2xl bg-yellow-500/10 border border-yellow-500/20 p-4 mb-4">
                    <div className="text-sm font-semibold text-yellow-300 mb-2">When This Backfires</div>
                    <ul className="space-y-1">
                      {result.whenThisBackfires.map((w: string, i: number) => (
                        <li key={i} className="text-sm text-yellow-200/80 flex gap-2">
                          <span className="text-yellow-400">•</span>
                          <span>{w}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {Array.isArray(result.why) && result.why.length > 0 && (
                  <div className="rounded-2xl bg-black/30 border border-white/10 p-4">
                    <div className="text-sm font-semibold text-white/80 mb-2">Key Reasons</div>
                    <ul className="space-y-2 text-sm text-white/70">
                      {result.why.slice(0, 8).map((x, i) => (
                        <li key={i} className="flex gap-2">
                          <span className="text-cyan-300 mt-0.5">•</span>
                          <span>{x}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {(Array.isArray(result.teamImpactA) || Array.isArray(result.teamImpactB)) && (
                  <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="rounded-2xl bg-black/30 border border-white/10 p-4">
                      <div className="text-sm font-semibold text-white/80 mb-2">Impact: {sleeperA || 'Side A'}</div>
                      <ul className="space-y-2 text-sm text-white/70">
                        {(result.teamImpactA || []).slice(0, 6).map((x: string, i: number) => (
                          <li key={i} className="flex gap-2">
                            <span className="text-emerald-300 mt-0.5">•</span>
                            <span>{x}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="rounded-2xl bg-black/30 border border-white/10 p-4">
                      <div className="text-sm font-semibold text-white/80 mb-2">Impact: {sleeperB || 'Side B'}</div>
                      <ul className="space-y-2 text-sm text-white/70">
                        {(result.teamImpactB || []).slice(0, 6).map((x: string, i: number) => (
                          <li key={i} className="flex gap-2">
                            <span className="text-rose-300 mt-0.5">•</span>
                            <span>{x}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
              </Card>

              {Array.isArray(result.counterOffers) && result.counterOffers.length > 0 && (
                <Card>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xl font-bold text-cyan-300">Counter Offers</h3>
                    <Pill tone="cyan">Optimize</Pill>
                  </div>
                  <div className="space-y-3">
                    {result.counterOffers.map((c: any, i: number) => (
                      <div key={i} className="rounded-2xl bg-black/30 border border-cyan-500/20 p-4">
                        <div className="text-sm font-medium text-white/90 mb-1">{c.description}</div>
                        <div className="text-xs text-cyan-300/80">{c.whyBetter}</div>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {result.tradePitch && (
                <Card>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xl font-bold text-cyan-300">Trade Pitch</h3>
                    <Pill tone="purple">Send to league</Pill>
                  </div>
                  <div className="rounded-2xl bg-gradient-to-br from-purple-500/10 to-cyan-500/10 border border-purple-500/20 p-4">
                    <p className="text-sm text-white/80 leading-relaxed italic">"{result.tradePitch}"</p>
                  </div>
                </Card>
              )}

              {result.leverage && (
                <Card>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xl font-bold text-cyan-300">Leverage</h3>
                    <Pill tone="cyan">Negotiate +EV</Pill>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="rounded-2xl bg-black/30 border border-white/10 p-4">
                      <div className="text-sm font-semibold text-white/80 mb-2">Suggested Ask</div>
                      <ul className="space-y-2 text-sm text-white/70">
                        {(result.leverage.suggestedAsk || []).slice(0, 6).map((x: string, i: number) => (
                          <li key={i} className="flex gap-2">
                            <span className="text-cyan-300 mt-0.5">•</span>
                            <span>{x}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="rounded-2xl bg-black/30 border border-white/10 p-4">
                      <div className="text-sm font-semibold text-white/80 mb-2">Suggested Counters</div>
                      <ul className="space-y-2 text-sm text-white/70">
                        {(result.leverage.suggestedCounters || []).slice(0, 6).map((x: string, i: number) => (
                          <li key={i} className="flex gap-2">
                            <span className="text-purple-300 mt-0.5">•</span>
                            <span>{x}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="rounded-2xl bg-black/30 border border-white/10 p-4">
                      <div className="text-sm font-semibold text-white/80 mb-2">Risk Checks</div>
                      <ul className="space-y-2 text-sm text-white/70">
                        {(result.leverage.riskChecks || []).slice(0, 6).map((x: string, i: number) => (
                          <li key={i} className="flex gap-2">
                            <span className="text-rose-300 mt-0.5">•</span>
                            <span>{x}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </Card>
              )}

              {Array.isArray(result.betterPartners) && result.betterPartners.length > 0 && (
                <Card>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xl font-bold text-cyan-300">Better Trade Partners</h3>
                    <Pill tone="purple">League context</Pill>
                  </div>
                  <div className="space-y-4">
                    {result.betterPartners.slice(0, 5).map((bp, idx) => (
                      <div key={idx} className="rounded-2xl bg-black/30 border border-white/10 p-4">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
                          <div className="text-sm font-semibold text-white/85">@{bp.managerUsername}</div>
                          <Pill>Alt option</Pill>
                        </div>
                        {Array.isArray(bp.needs) && bp.needs.length > 0 && (
                          <div className="flex flex-wrap gap-2 mb-3">
                            {bp.needs.slice(0, 6).map((n: string, i: number) => (
                              <span key={i} className="px-2 py-1 rounded-full bg-white/5 border border-white/10 text-[11px] text-white/60">
                                {n}
                              </span>
                            ))}
                          </div>
                        )}
                        <div className="rounded-xl bg-black/20 border border-white/10 p-3">
                          <div className="text-[11px] uppercase tracking-wide text-white/50 mb-1">Proposed trade</div>
                          <div className="text-sm text-white/75">{bp.proposedTrade}</div>
                        </div>
                        <div className="mt-3 text-sm text-white/70">
                          <span className="text-white/80 font-semibold">Why it fits:</span> {bp.whyBetter}
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {Array.isArray(result.notes) && result.notes.length > 0 && (
                <Card>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xl font-bold text-cyan-300">Notes</h3>
                    <Pill>FYI</Pill>
                  </div>
                  <div className="rounded-2xl bg-black/30 border border-white/10 p-4">
                    <ul className="space-y-2 text-sm text-white/70">
                      {result.notes.slice(0, 8).map((x: string, i: number) => (
                        <li key={i} className="flex gap-2">
                          <span className="text-cyan-300 mt-0.5">•</span>
                          <span>{x}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </Card>
              )}

              {result.negotiation && (
                <Card>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xl font-bold text-cyan-300">Negotiation Assistant</h3>
                    <Pill tone="cyan">AI-powered</Pill>
                  </div>
                  <p className="text-sm text-white/60 mb-4">
                    Ready-to-send messages, counter-offers, and sweeteners tailored to this trade.
                  </p>
                  <button
                    onClick={() => {
                      setNegCandidate(buildAnalyzerCandidate(assetsA, assetsB))
                      setNegAssetIndex(buildAnalyzerAssetIndex(assetsA, assetsB))
                      setShowNegotiation(true)
                    }}
                    className="w-full py-3 rounded-xl bg-gradient-to-r from-cyan-500/20 to-purple-500/20 border border-cyan-400/25 text-sm font-medium text-white hover:from-cyan-500/30 hover:to-purple-500/30 transition-all touch-manipulation active:scale-[0.98]"
                  >
                    Open Negotiation Toolkit
                  </button>
                  <NegotiationSheet
                    open={showNegotiation}
                    onClose={() => setShowNegotiation(false)}
                    negotiation={(result.negotiation ?? null) as NegotiationBlock}
                    candidate={negCandidate ?? buildAnalyzerCandidate(assetsA, assetsB)}
                    assetIndex={negAssetIndex ?? buildAnalyzerAssetIndex(assetsA, assetsB)}
                    onCandidateUpdate={(next) => {
                      setNegCandidate(next)
                    }}
                  />
                </Card>
              )}

              <Card>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
                  <h3 className="text-xl font-bold text-purple-300">Social Pulse</h3>
                  <div className="flex items-center gap-2 flex-wrap">
                    <CooldownPill remaining={socialRemaining} retryAfterSec={socialRetryAfterSec} label="Runs" />
                    <Pill tone="purple">Read-only</Pill>
                  </div>
                </div>

                <div className="text-xs text-white/50 mb-3">
                  Public narrative snapshot (X). Does not affect the verdict.
                </div>

                {socialInfo && (
                  <div className="rounded-2xl bg-black/30 border border-white/10 p-3 text-sm text-white/60 mb-3">
                    {socialInfo}
                  </div>
                )}

                {!includeSocialPulse ? (
                  <div className="rounded-2xl bg-black/30 border border-white/10 p-4 text-sm text-white/50">
                    Turn <span className="text-white/70">Social Pulse</span> on to include market narratives after analysis.
                  </div>
                ) : socialLoading ? (
                  <div className="rounded-2xl bg-black/30 border border-white/10 p-4">
                    <div className="inline-flex items-center gap-2 text-sm text-white/70">
                      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-purple-200/40 border-t-purple-200" />
                      Fetching Social Pulse…
                    </div>
                    <div className="mt-3 h-2 rounded-full bg-white/10 overflow-hidden">
                      <div className="h-2 rounded-full bg-gradient-to-r from-purple-400/70 to-cyan-400/70 w-2/3" />
                    </div>
                  </div>
                ) : socialPulse ? (
                  <div className="space-y-3">
                    <div className="rounded-2xl bg-black/30 border border-white/10 p-4">
                      <div className="text-sm font-semibold text-white/80 mb-1">Summary</div>
                      <div className="text-sm text-white/70">{socialPulse.summary}</div>
                    </div>

                    <div className="rounded-2xl bg-black/30 border border-white/10 p-4">
                      <div className="text-sm font-semibold text-white/80 mb-2">Key Narratives</div>
                      <ul className="space-y-2 text-sm text-white/70">
                        {(socialPulse.bullets || []).slice(0, 10).map((x: string, i: number) => (
                          <li key={i} className="flex gap-2">
                            <span className="text-purple-300 mt-0.5">•</span>
                            <span>{x}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    {Array.isArray(socialPulse.market) && socialPulse.market.length > 0 && (
                      <div className="rounded-2xl bg-black/30 border border-white/10 p-4">
                        <div className="text-sm font-semibold text-white/80 mb-2">Market Signals</div>
                        <div className="flex flex-wrap gap-2">
                          {socialPulse.market.slice(0, 12).map((m: any, i: number) => (
                            <span
                              key={i}
                              className="px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-xs text-white/70"
                            >
                              {m.player}: {m.signal}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="rounded-2xl bg-black/30 border border-white/10 p-4 text-sm text-white/50">
                    No Social Pulse yet. Run <span className="text-white/70">Analyze Trade</span> with Social Pulse ON.
                  </div>
                )}
              </Card>
            </div>
          ) : (
            <Card accent="cyan">
              <div className="text-center py-12">
                <div className="text-6xl mb-4">🔄</div>
                <div className="text-xl font-bold text-white/80">Ready to analyze</div>
                <div className="mt-2 text-sm text-white/50 max-w-md mx-auto">
                  Add assets on both sides, then click <span className="text-white/70">Analyze Trade</span>.
                  {leagueMode && (
                    <> Deep mode requires <span className="text-white/70">Prep League Data</span> first.</>
                  )}
                </div>
              </div>
            </Card>
          )}

          <div className="text-center text-xs text-white/40 py-4">
            In the main AllFantasy app, Trade Analyzer is available for AF Pro and AF Supreme.
          </div>
        </div>
      </div>
    </div>
  )
}
