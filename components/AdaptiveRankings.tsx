'use client'

import React, { useState, useCallback } from 'react'
import { Globe, Users, User, ChevronDown, ChevronUp, TrendingUp, TrendingDown, BarChart3, Flame, ArrowUpDown } from 'lucide-react'
import { cx } from '@/components/ui/legacy-ui'

type RankingView = 'global' | 'league' | 'team' | 'win_now' | 'rebuild' | 'consolidate'
type TopView = 'global' | 'league' | 'team'
type TeamIntent = 'team' | 'win_now' | 'rebuild' | 'consolidate'
type PositionFilter = '' | 'QB' | 'RB' | 'WR' | 'TE'
type SortField = 'composite' | 'market' | 'impact' | 'scarcity' | 'demand'

interface PlayerRank {
  playerId: string
  name: string
  position: string
  team: string | null
  age: number | null
  marketRank: number
  marketValue: number
  impactRank: number
  impactScore: number
  estimatedPPG: number
  scarcityRank: number
  scarcityScore: number
  scarcityFactors: {
    volatilityFit: number
    ageCurveFit: number
    positionalScarcity: number
    rosterNeedFit: number
  }
  demandRank: number
  demandScore: number
  compositeRank: number
  compositeScore: number
  trend30Day: number
  positionRank: number
  isOnUserRoster: boolean
}

interface PositionDemand {
  position: string
  demandScore: number
  avgOverpayPct: number
  tradeVolume: number
  premiumPlayers: string[]
}

interface PlayerDemand {
  playerName: string
  position: string
  demandScore: number
  timesTraded: number
  avgValuePaid: number
  avgMarketValue: number
  overpayPct: number
}

interface PickDemandItem {
  round: number
  avgClearingValue: number
  premiumPct: number
  tradeCount: number
}

interface AdaptiveRankingsProps {
  username: string
  leagueId: string
  leagueName?: string
}

const VIEW_CONFIG: { key: TopView; label: string; icon: any; description: string }[] = [
  { key: 'global', label: 'Global', icon: Globe, description: '45% MS + 35% IS + 20% SS' },
  { key: 'league', label: 'Your League', icon: Users, description: '35% MS + 30% IS + 15% SS + 20% DS' },
  { key: 'team', label: 'Your Team', icon: User, description: 'Intent-aware rankings' },
]

const INTENT_OPTIONS: { key: TeamIntent; label: string; description: string }[] = [
  { key: 'team', label: 'Balanced', description: 'Default roster fit' },
  { key: 'win_now', label: 'Win Now', description: '55% impact focused' },
  { key: 'rebuild', label: 'Rebuild', description: '55% market value' },
  { key: 'consolidate', label: 'Consolidate', description: 'Trade-value focused' },
]

const POS_COLORS: Record<string, string> = {
  QB: 'text-rose-300',
  RB: 'text-cyan-300',
  WR: 'text-emerald-300',
  TE: 'text-amber-300',
}

const POS_BG: Record<string, string> = {
  QB: 'bg-rose-500/15 border-rose-500/20',
  RB: 'bg-cyan-500/15 border-cyan-500/20',
  WR: 'bg-emerald-500/15 border-emerald-500/20',
  TE: 'bg-amber-500/15 border-amber-500/20',
}

function RankBadge({ rank, size = 'sm' }: { rank: number; size?: 'sm' | 'md' }) {
  const color = rank <= 10 ? 'text-emerald-300' : rank <= 30 ? 'text-cyan-300' : rank <= 75 ? 'text-white/60' : 'text-white/40'
  return (
    <span className={cx('font-mono font-bold', color, size === 'md' ? 'text-sm' : 'text-[11px]')}>
      #{rank}
    </span>
  )
}

function MiniBar({ value, max = 100, color = 'cyan' }: { value: number; max?: number; color?: string }) {
  const pct = Math.min(100, (value / max) * 100)
  const colorMap: Record<string, string> = {
    cyan: 'bg-cyan-400',
    emerald: 'bg-emerald-400',
    amber: 'bg-amber-400',
    purple: 'bg-purple-400',
    rose: 'bg-rose-400',
  }
  return (
    <div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden">
      <div className={cx('h-full rounded-full', colorMap[color] || 'bg-cyan-400')} style={{ width: `${pct}%` }} />
    </div>
  )
}

function PlayerRow({ player, expanded, onToggle, view }: {
  player: PlayerRank
  expanded: boolean
  onToggle: () => void
  view: RankingView
}) {
  const trendIcon = player.trend30Day > 0
    ? <TrendingUp className="w-3 h-3 text-emerald-400" />
    : player.trend30Day < 0
    ? <TrendingDown className="w-3 h-3 text-rose-400" />
    : null

  return (
    <div className={cx(
      'border rounded-xl overflow-hidden transition-colors',
      player.isOnUserRoster ? 'bg-cyan-500/5 border-cyan-500/15' : 'bg-black/20 border-white/5'
    )}>
      <button onClick={onToggle} className="w-full text-left px-3 py-2.5 touch-manipulation">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center flex-shrink-0">
            <span className="text-xs font-bold text-white/70">{player.compositeRank}</span>
          </div>
          <span className={cx('text-[11px] font-bold uppercase w-6 flex-shrink-0', POS_COLORS[player.position] || 'text-white/50')}>
            {player.position}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-sm text-white font-medium truncate">{player.name}</span>
              {player.isOnUserRoster && (
                <span className="text-[11px] px-1 py-0.5 bg-cyan-500/20 text-cyan-300 rounded flex-shrink-0">YOURS</span>
              )}
              {player.demandScore >= 65 && (
                <span className="text-[11px] px-1 py-0.5 bg-red-500/20 text-red-400 rounded flex-shrink-0">HIGH DEMAND</span>
              )}
              {player.demandScore <= 35 && (
                <span className="text-[11px] px-1 py-0.5 bg-cyan-500/20 text-cyan-400 rounded flex-shrink-0">LOW DEMAND</span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              {player.team && <span className="text-[11px] text-white/30">{player.team}</span>}
              {player.age && <span className="text-[11px] text-white/25">Age {player.age}</span>}
              <span className="text-[11px] text-white/20">{player.estimatedPPG} PPG</span>
              {trendIcon}
            </div>
          </div>
          <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
            <div className="flex items-center gap-1.5 text-[11px]">
              <span className="text-white/30">Mkt</span>
              <RankBadge rank={player.marketRank} />
            </div>
            {view !== 'global' && (
              <div className="flex items-center gap-1.5 text-[11px]">
                <span className="text-white/30">{['team', 'win_now', 'rebuild', 'consolidate'].includes(view) ? 'VORP' : 'Dmnd'}</span>
                <RankBadge rank={['team', 'win_now', 'rebuild', 'consolidate'].includes(view) ? player.scarcityRank : player.demandRank} />
              </div>
            )}
          </div>
          <div className="flex-shrink-0 ml-1">
            {expanded ? <ChevronUp className="w-3.5 h-3.5 text-white/25" /> : <ChevronDown className="w-3.5 h-3.5 text-white/25" />}
          </div>
        </div>
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-white/5 pt-2">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-white/40">Market</span>
                <RankBadge rank={player.marketRank} />
              </div>
              <MiniBar value={player.marketValue / 100} color="cyan" />
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-white/40">Impact</span>
                <RankBadge rank={player.impactRank} />
              </div>
              <MiniBar value={player.impactScore} color="emerald" />
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-white/40">Scarcity (VORP)</span>
                <RankBadge rank={player.scarcityRank} />
              </div>
              <MiniBar value={player.scarcityScore} color="purple" />
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-white/40">League Demand</span>
                <RankBadge rank={player.demandRank} />
              </div>
              <MiniBar value={player.demandScore} color="amber" />
            </div>
          </div>

          <div className="grid grid-cols-4 gap-1.5">
            <div className="text-center p-1.5 bg-white/3 rounded-lg">
              <div className="text-[11px] text-white/30">Volatility</div>
              <div className="text-[11px] font-medium text-white/70">{Math.round(player.scarcityFactors.volatilityFit)}</div>
            </div>
            <div className="text-center p-1.5 bg-white/3 rounded-lg">
              <div className="text-[11px] text-white/30">Age Curve</div>
              <div className="text-[11px] font-medium text-white/70">{Math.round(player.scarcityFactors.ageCurveFit)}</div>
            </div>
            <div className="text-center p-1.5 bg-white/3 rounded-lg">
              <div className="text-[11px] text-white/30">Pos Scarcity</div>
              <div className="text-[11px] font-medium text-white/70">{Math.round(player.scarcityFactors.positionalScarcity)}</div>
            </div>
            <div className="text-center p-1.5 bg-white/3 rounded-lg">
              <div className="text-[11px] text-white/30">Need Fit</div>
              <div className="text-[11px] font-medium text-white/70">{Math.round(player.scarcityFactors.rosterNeedFit)}</div>
            </div>
          </div>

          <div className="flex items-center gap-2 text-[11px] text-white/30">
            <span>Value: {player.marketValue.toLocaleString()}</span>
            <span>|</span>
            <span>Pos Rank: #{player.positionRank}</span>
            <span>|</span>
            <span>Composite: {player.compositeScore}/100</span>
          </div>
        </div>
      )}
    </div>
  )
}

function DemandInsightsCard({ positionDemand, hotPlayers, pickDemand }: {
  positionDemand: PositionDemand[]
  hotPlayers: PlayerDemand[]
  pickDemand: PickDemandItem[]
}) {
  const [open, setOpen] = useState(false)

  if (positionDemand.length === 0 && hotPlayers.length === 0) {
    return (
      <div className="p-3 bg-white/3 border border-white/5 rounded-xl text-center">
        <p className="text-xs text-white/40">No trade history available for this league yet. Import trade history to unlock League Demand insights.</p>
      </div>
    )
  }

  return (
    <div className="bg-black/30 border border-amber-500/15 rounded-xl overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full text-left p-3 touch-manipulation">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Flame className="w-4 h-4 text-amber-400" />
            <span className="text-sm font-semibold text-white">League Demand Index</span>
            <span className="text-[11px] px-1.5 py-0.5 bg-amber-500/15 text-amber-300/80 rounded-full border border-amber-500/20">LIVE</span>
          </div>
          {open ? <ChevronUp className="w-4 h-4 text-white/30" /> : <ChevronDown className="w-4 h-4 text-white/30" />}
        </div>
        {!open && positionDemand.length > 0 && (
          <div className="flex gap-2 mt-2">
            {positionDemand.slice(0, 4).map(pd => (
              <div key={pd.position} className={cx('flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px]', POS_BG[pd.position] || 'bg-white/5 border-white/10')}>
                <span className={cx('font-bold', POS_COLORS[pd.position] || 'text-white/60')}>{pd.position}</span>
                <span className="text-white/50">{pd.demandScore}</span>
              </div>
            ))}
          </div>
        )}
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-4 border-t border-white/5 pt-3">
          {positionDemand.length > 0 && (
            <div>
              <p className="text-[11px] text-white/40 uppercase tracking-wider font-medium mb-2">Position Demand</p>
              <div className="space-y-2">
                {positionDemand.map(pd => (
                  <div key={pd.position} className="flex items-center gap-2">
                    <span className={cx('text-xs font-bold w-6', POS_COLORS[pd.position])}>{pd.position}</span>
                    <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                      <div className="h-full bg-amber-400/70 rounded-full" style={{ width: `${pd.demandScore}%` }} />
                    </div>
                    <span className="text-[11px] text-white/40 w-6 text-right">{pd.demandScore}</span>
                    {pd.avgOverpayPct > 0 && (
                      <span className="text-[11px] text-amber-300/60">+{pd.avgOverpayPct}%</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {hotPlayers.length > 0 && (
            <div>
              <p className="text-[11px] text-white/40 uppercase tracking-wider font-medium mb-2">Most Traded Players</p>
              <div className="space-y-1">
                {hotPlayers.slice(0, 5).map((hp, i) => (
                  <div key={i} className="flex items-center gap-2 text-[11px]">
                    <span className={cx('font-bold w-6', POS_COLORS[hp.position])}>{hp.position}</span>
                    <span className="text-white/70 flex-1 truncate">{hp.playerName}</span>
                    <span className="text-white/30">{hp.timesTraded}x</span>
                    {hp.overpayPct > 0 && (
                      <span className="text-amber-300/70 text-[11px]">+{hp.overpayPct}%</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {pickDemand.length > 0 && (
            <div>
              <p className="text-[11px] text-white/40 uppercase tracking-wider font-medium mb-2">Pick Values Clearing</p>
              <div className="flex gap-2">
                {pickDemand.slice(0, 4).map(pd => (
                  <div key={pd.round} className="flex-1 text-center p-2 bg-white/3 rounded-lg">
                    <div className="text-[11px] text-white/30">Rd {pd.round}</div>
                    <div className="text-xs font-medium text-white/70">{pd.avgClearingValue.toLocaleString()}</div>
                    {pd.premiumPct !== 0 && (
                      <div className={cx('text-[11px]', pd.premiumPct > 0 ? 'text-emerald-400/70' : 'text-rose-400/70')}>
                        {pd.premiumPct > 0 ? '+' : ''}{pd.premiumPct}%
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function AdaptiveRankings({ username, leagueId, leagueName }: AdaptiveRankingsProps) {
  const [topView, setTopView] = useState<TopView>('global')
  const [teamIntent, setTeamIntent] = useState<TeamIntent>('team')
  const [posFilter, setPosFilter] = useState<PositionFilter>('')
  const [sortField, setSortField] = useState<SortField>('composite')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [players, setPlayers] = useState<PlayerRank[]>([])
  const [ldi, setLdi] = useState<{ positionDemand: PositionDemand[]; hotPlayers: PlayerDemand[]; pickDemand: PickDemandItem[]; tradesAnalyzed: number } | null>(null)
  const [meta, setMeta] = useState<any>(null)
  const [expandedPlayer, setExpandedPlayer] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  const activeView: RankingView = topView === 'team' ? teamIntent : topView

  const fetchRankings = useCallback(async (v: RankingView = activeView) => {
    if (!username || !leagueId) return
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/legacy/rankings/adaptive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          league_id: leagueId,
          sleeper_username: username,
          view: v,
          limit: 200,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to load rankings')
        return
      }
      setPlayers(data.players || [])
      setLdi(data.leagueDemandIndex || null)
      setMeta(data.meta || null)
      setLoaded(true)
      import("@/lib/telemetry/client").then(m => m.logLegacyToolUsage({ tool: "AdaptiveRankingsPanel", leagueId, action: "run", meta: { view: v } })).catch(() => {})
    } catch {
      setError('Network error - please try again')
    } finally {
      setLoading(false)
    }
  }, [username, leagueId, activeView])

  const handleTopViewChange = useCallback((v: TopView) => {
    setTopView(v)
    setExpandedPlayer(null)
    const newView: RankingView = v === 'team' ? teamIntent : v
    if (loaded) {
      fetchRankings(newView)
    }
  }, [loaded, fetchRankings, teamIntent])

  const handleIntentChange = useCallback((intent: TeamIntent) => {
    setTeamIntent(intent)
    setExpandedPlayer(null)
    if (loaded) {
      fetchRankings(intent)
    }
  }, [loaded, fetchRankings])

  const sortedPlayers = React.useMemo(() => {
    let filtered = posFilter ? players.filter(p => p.position === posFilter) : players
    const sorted = [...filtered]
    switch (sortField) {
      case 'market': sorted.sort((a, b) => a.marketRank - b.marketRank); break
      case 'impact': sorted.sort((a, b) => a.impactRank - b.impactRank); break
      case 'scarcity': sorted.sort((a, b) => a.scarcityRank - b.scarcityRank); break
      case 'demand': sorted.sort((a, b) => a.demandRank - b.demandRank); break
      default: sorted.sort((a, b) => a.compositeRank - b.compositeRank); break
    }
    return sorted
  }, [players, posFilter, sortField])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-1">
        <BarChart3 className="w-5 h-5 text-cyan-400" />
        <h3 className="text-base font-bold text-white">Adaptive Player Rankings</h3>
      </div>
      <p className="text-xs text-white/40 -mt-3">4-dimension rankings that adapt to your league and roster</p>

      <div className="flex bg-black/30 border border-white/10 rounded-xl overflow-hidden">
        {VIEW_CONFIG.map(v => (
          <button
            key={v.key}
            onClick={() => handleTopViewChange(v.key)}
            className={cx(
              'flex-1 flex flex-col items-center gap-0.5 py-2.5 text-xs font-medium transition-all touch-manipulation',
              topView === v.key
                ? 'bg-gradient-to-b from-cyan-500/20 to-purple-500/20 text-white'
                : 'text-white/40 hover:text-white/70'
            )}
          >
            <v.icon className="w-4 h-4" />
            <span className="text-[11px]">{v.label}</span>
          </button>
        ))}
      </div>

      {topView === 'team' && (
        <div className="flex gap-1 bg-black/20 border border-white/5 rounded-lg p-1">
          {INTENT_OPTIONS.map(opt => (
            <button
              key={opt.key}
              onClick={() => handleIntentChange(opt.key)}
              className={cx(
                'flex-1 py-1.5 px-2 rounded-md text-[11px] font-medium transition-all touch-manipulation',
                teamIntent === opt.key
                  ? 'bg-gradient-to-r from-cyan-500/25 to-purple-500/25 text-white border border-cyan-400/20'
                  : 'text-white/35 hover:text-white/60'
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {!loaded && !loading && (
        <button
          onClick={() => fetchRankings()}
          className="w-full py-3 bg-gradient-to-r from-cyan-500/20 to-purple-500/20 hover:from-cyan-500/30 hover:to-purple-500/30 border border-cyan-400/25 text-white font-medium rounded-xl transition touch-manipulation"
        >
          Load Adaptive Rankings
        </button>
      )}

      {loading && (
        <div className="flex flex-col items-center justify-center py-10 gap-3">
          <div className="relative w-10 h-10">
            <div className="absolute inset-0 rounded-full border-2 border-cyan-400/20" />
            <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-cyan-400 animate-spin" />
            <BarChart3 className="absolute inset-0 m-auto w-4 h-4 text-cyan-400/60" />
          </div>
          <p className="text-sm text-white/60">Computing {activeView === 'global' ? 'global' : activeView === 'league' ? 'league-aware' : activeView === 'win_now' ? 'win-now' : activeView === 'rebuild' ? 'rebuild' : activeView === 'consolidate' ? 'consolidation' : 'roster-fit'} rankings...</p>
          <p className="text-xs text-white/30">Market + Impact + Scarcity + Demand scoring</p>
        </div>
      )}

      {error && (
        <div className="p-4 bg-rose-500/10 border border-rose-400/20 rounded-xl">
          <p className="text-sm text-rose-300">{error}</p>
        </div>
      )}

      {loaded && !loading && (
        <>
          {meta && (
            <div className="text-center text-[11px] text-white/30">
              {meta.leagueName} | {meta.leagueType} | {meta.scoring}{meta.isSF ? ' | Superflex' : ''} | {meta.numTeams} teams
            </div>
          )}

          {ldi && <DemandInsightsCard positionDemand={ldi.positionDemand} hotPlayers={ldi.hotPlayers} pickDemand={ldi.pickDemand} />}

          <div className="flex items-center gap-2">
            <div className="flex gap-1 flex-1">
              {(['', 'QB', 'RB', 'WR', 'TE'] as PositionFilter[]).map(p => (
                <button
                  key={p || 'ALL'}
                  onClick={() => setPosFilter(p)}
                  className={cx(
                    'px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all touch-manipulation border',
                    posFilter === p
                      ? 'bg-white/10 border-white/20 text-white'
                      : 'bg-transparent border-transparent text-white/35 hover:text-white/60'
                  )}
                >
                  {p || 'ALL'}
                </button>
              ))}
            </div>
            <button
              onClick={() => {
                const fields: SortField[] = ['composite', 'market', 'impact', 'scarcity', 'demand']
                const idx = fields.indexOf(sortField)
                setSortField(fields[(idx + 1) % fields.length])
              }}
              className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] text-white/40 hover:text-white/70 transition touch-manipulation"
            >
              <ArrowUpDown className="w-3 h-3" />
              <span className="capitalize">{sortField}</span>
            </button>
          </div>

          <div className="space-y-1.5">
            {sortedPlayers.slice(0, 100).map(player => (
              <PlayerRow
                key={player.playerId}
                player={player}
                expanded={expandedPlayer === player.playerId}
                onToggle={() => setExpandedPlayer(expandedPlayer === player.playerId ? null : player.playerId)}
                view={activeView}
              />
            ))}
          </div>

          {sortedPlayers.length === 0 && (
            <div className="py-8 text-center">
              <p className="text-sm text-white/50">No players found{posFilter ? ` at ${posFilter}` : ''}</p>
            </div>
          )}

          {sortedPlayers.length > 100 && (
            <p className="text-center text-xs text-white/30">Showing top 100 of {sortedPlayers.length} players</p>
          )}
        </>
      )}
    </div>
  )
}
