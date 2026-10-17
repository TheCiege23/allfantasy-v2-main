'use client'

import React, { useState, useCallback, useMemo } from 'react'

type EnhancedView = 'this_year' | 'dynasty_horizon' | 'overall'
type GoalOption = 'win-now' | 'balanced' | 'rebuild' | ''
type PositionFilter = '' | 'QB' | 'RB' | 'WR' | 'TE'
type SortField = 'userRank' | 'market' | 'impact' | 'teamFit' | 'goalAlign'

interface PlayerRank {
  playerId: string
  name: string
  position: string
  team: string | null
  age: number | null
  marketValue: number
  marketRank: number
  impactScore: number
  impactRank: number
  scarcityScore: number
  demandScore: number
  compositeScore: number
  compositeRank: number
  leagueRankScore: number
  teamFitScore: number
  goalAlignmentScore: number
  riskFitScore: number
  userRankScore: number
  userRank: number
  trend30Day: number
  positionRank: number
  isOnUserRoster: boolean
  estimatedPPG: number
  tfsBreakdown: {
    slotNeedFit: number
    volatilityBalance: number
    ageCurveFit: number
    byeClusterRelief: number
    raw: number
    scaled: number
  }
  goalDetails: {
    goal: string
    alignmentScore: number
    reasoning: string
  }
  riskDetails: {
    riskScore: number
    volatility: number
    ageRisk: number
  }
}

interface PositionalStrength {
  position: string
  userValue: number
  leagueAvgValue: number
  leagueMaxValue: number
  strengthPct: number
  playerCount: number
}

interface RosterProfile {
  avgAge: number
  youngCount: number
  primeCount: number
  veteranCount: number
  totalValue: number
  posValues: Record<string, number>
  posCounts: Record<string, number>
  assetConcentration: number
  rosterSize: number
}

interface PlanItem {
  timeframe: string
  action: string
  type: string
}

interface EnhancedRankingsProps {
  username: string
  leagueId: string
  leagueName?: string
}

const POS_COLORS: Record<string, string> = {
  QB: 'text-rose-300',
  RB: 'text-cyan-300',
  WR: 'text-emerald-300',
  TE: 'text-amber-300',
}

const POS_BAR_COLORS: Record<string, string> = {
  QB: 'bg-rose-400',
  RB: 'bg-cyan-400',
  WR: 'bg-emerald-400',
  TE: 'bg-amber-400',
}

const POS_BG: Record<string, string> = {
  QB: 'bg-rose-500/15 border-rose-500/20',
  RB: 'bg-cyan-500/15 border-cyan-500/20',
  WR: 'bg-emerald-500/15 border-emerald-500/20',
  TE: 'bg-amber-500/15 border-amber-500/20',
}

const VIEW_CONFIG: { key: EnhancedView; label: string; desc: string; emoji: string }[] = [
  { key: 'this_year', label: 'This Year', desc: 'Impact-heavy contender ranking', emoji: '&#x1F3C6;' },
  { key: 'dynasty_horizon', label: 'Dynasty 3-5yr', desc: 'Value + demand for the future', emoji: '&#x1F4C8;' },
  { key: 'overall', label: 'Overall', desc: 'Balanced blend of all factors', emoji: '&#x2B50;' },
]

function cx(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ')
}

function ScoreBar({ value, max = 100, color = 'cyan', label, showValue = true }: {
  value: number; max?: number; color?: string; label?: string; showValue?: boolean
}) {
  const pct = Math.min(100, (value / max) * 100)
  const colorMap: Record<string, string> = {
    cyan: 'bg-cyan-400', emerald: 'bg-emerald-400', amber: 'bg-amber-400',
    purple: 'bg-purple-400', rose: 'bg-rose-400', blue: 'bg-blue-400',
  }
  return (
    <div className="space-y-0.5">
      {label && (
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-white/40">{label}</span>
          {showValue && <span className="text-[11px] text-white/60 font-mono">{Math.round(value)}</span>}
        </div>
      )}
      <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
        <div className={cx('h-full rounded-full transition-all', colorMap[color] || 'bg-cyan-400')} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function PositionalStrengthChart({ data }: { data: PositionalStrength[] }) {
  const maxPct = Math.max(...data.map(d => d.strengthPct), 150)

  return (
    <div className="rounded-xl bg-black/30 border border-white/10 p-4">
      <h4 className="text-xs font-bold text-white/60 uppercase mb-3">Your Team vs League</h4>
      <div className="space-y-3">
        {data.map(d => {
          const barWidth = Math.min(100, (d.strengthPct / maxPct) * 100)
          const medianBarWidth = Math.min(100, (100 / maxPct) * 100)
          const isStrong = d.strengthPct >= 110
          const isWeak = d.strengthPct < 85
          return (
            <div key={d.position} className="space-y-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={cx('text-xs font-bold w-7', POS_COLORS[d.position])}>{d.position}</span>
                  <span className="text-[11px] text-white/30">{d.playerCount} rostered</span>
                </div>
                <span className={cx('text-xs font-bold', isStrong ? 'text-emerald-300' : isWeak ? 'text-rose-300' : 'text-white/60')}>
                  {d.strengthPct}%
                </span>
              </div>
              <div className="relative h-3 bg-white/5 rounded-full overflow-hidden">
                <div
                  className={cx('absolute inset-y-0 left-0 rounded-full transition-all', POS_BAR_COLORS[d.position] || 'bg-cyan-400')}
                  style={{ width: `${barWidth}%`, opacity: 0.7 }}
                />
                <div
                  className="absolute inset-y-0 w-0.5 bg-white/40"
                  style={{ left: `${medianBarWidth}%` }}
                  title="League median"
                />
              </div>
              <div className="flex justify-between text-[11px] text-white/25">
                <span>{d.userValue.toLocaleString()} value</span>
                <span>Avg: {d.leagueAvgValue.toLocaleString()}</span>
              </div>
            </div>
          )
        })}
      </div>
      <div className="mt-3 flex items-center gap-3 text-[11px] text-white/25">
        <div className="flex items-center gap-1"><div className="w-0.5 h-3 bg-white/40" /> League average (100%)</div>
      </div>
    </div>
  )
}

function RosterProfileCard({ profile }: { profile: RosterProfile }) {
  const total = profile.youngCount + profile.primeCount + profile.veteranCount
  const youngPct = total > 0 ? (profile.youngCount / total) * 100 : 0
  const primePct = total > 0 ? (profile.primeCount / total) * 100 : 0
  const vetPct = total > 0 ? (profile.veteranCount / total) * 100 : 0

  return (
    <div className="rounded-xl bg-black/30 border border-white/10 p-4">
      <h4 className="text-xs font-bold text-white/60 uppercase mb-3">Roster DNA</h4>
      <div className="grid grid-cols-3 gap-3 mb-3">
        <div className="text-center p-2 bg-black/20 rounded-lg">
          <div className="text-lg font-bold text-white">{profile.avgAge}</div>
          <div className="text-[11px] text-white/30">Avg Age</div>
        </div>
        <div className="text-center p-2 bg-black/20 rounded-lg">
          <div className="text-lg font-bold text-white">{profile.rosterSize}</div>
          <div className="text-[11px] text-white/30">Players</div>
        </div>
        <div className="text-center p-2 bg-black/20 rounded-lg">
          <div className="text-lg font-bold text-white">{profile.assetConcentration}%</div>
          <div className="text-[11px] text-white/30">Top-5 Share</div>
        </div>
      </div>
      <div className="space-y-1.5">
        <div className="text-[11px] text-white/40">Age Distribution</div>
        <div className="flex h-4 rounded-full overflow-hidden">
          {youngPct > 0 && <div className="bg-emerald-400/70" style={{ width: `${youngPct}%` }} title={`Young (≤24): ${profile.youngCount}`} />}
          {primePct > 0 && <div className="bg-cyan-400/70" style={{ width: `${primePct}%` }} title={`Prime (25-28): ${profile.primeCount}`} />}
          {vetPct > 0 && <div className="bg-amber-400/70" style={{ width: `${vetPct}%` }} title={`Veteran (29+): ${profile.veteranCount}`} />}
        </div>
        <div className="flex justify-between text-[11px] text-white/30">
          <span className="text-emerald-300/60">Young {profile.youngCount}</span>
          <span className="text-cyan-300/60">Prime {profile.primeCount}</span>
          <span className="text-amber-300/60">Veteran {profile.veteranCount}</span>
        </div>
      </div>
    </div>
  )
}

function PlanCard({ plan, goal }: { plan: PlanItem[]; goal: string }) {
  if (plan.length === 0) return null

  return (
    <div className="rounded-xl bg-gradient-to-br from-purple-500/10 to-cyan-500/10 border border-purple-400/20 p-4 sm:p-5">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-lg">&#x1F5FA;</span>
        <div>
          <h4 className="text-sm font-bold text-white">Your 3-5 Year Roadmap</h4>
          <p className="text-[11px] text-white/40">AI-generated plan constrained by your roster data ({goal})</p>
        </div>
      </div>
      <div className="space-y-3">
        {plan.map((item, i) => (
          <div key={i} className={cx(
            'flex gap-3 p-3 rounded-lg border',
            item.type === 'avoid' ? 'bg-rose-500/5 border-rose-500/15' :
            item.type === 'strategy' ? 'bg-cyan-500/5 border-cyan-500/15' :
            'bg-white/3 border-white/8'
          )}>
            <div className={cx(
              'flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold',
              item.type === 'avoid' ? 'bg-rose-500/20 text-rose-300' :
              item.type === 'strategy' ? 'bg-cyan-500/20 text-cyan-300' :
              'bg-emerald-500/20 text-emerald-300'
            )}>
              {item.type === 'avoid' ? '!' : i + 1}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] text-white/40 font-semibold uppercase">{item.timeframe}</div>
              <p className="text-xs text-white/80 leading-relaxed mt-0.5">{item.action}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function PlayerRow({ player, expanded, onToggle }: {
  player: PlayerRank; expanded: boolean; onToggle: () => void
}) {
  return (
    <div className={cx(
      'border rounded-xl overflow-hidden transition-colors',
      player.isOnUserRoster ? 'bg-cyan-500/5 border-cyan-500/15' : 'bg-black/20 border-white/5'
    )}>
      <button onClick={onToggle} className="w-full text-left px-3 py-2.5 touch-manipulation">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center flex-shrink-0">
            <span className="text-xs font-bold text-white/70">{player.userRank}</span>
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
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              {player.team && <span className="text-[11px] text-white/30">{player.team}</span>}
              {player.age && <span className="text-[11px] text-white/25">Age {player.age}</span>}
              <span className="text-[11px] text-white/20">{player.estimatedPPG} PPG</span>
              {player.trend30Day > 0 && <span className="text-[11px] text-emerald-400">&#x2191;</span>}
              {player.trend30Day < 0 && <span className="text-[11px] text-rose-400">&#x2193;</span>}
            </div>
          </div>
          <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
            <span className="text-[11px] text-white/40">TFS <span className={cx('font-bold', player.teamFitScore >= 60 ? 'text-emerald-300' : player.teamFitScore >= 40 ? 'text-cyan-300' : 'text-white/50')}>{player.teamFitScore}</span></span>
            <span className="text-[11px] text-white/30">Score {player.userRankScore}</span>
          </div>
          <div className="flex-shrink-0 ml-1">
            <span className={cx('text-white/25 text-xs transition-transform inline-block', expanded ? 'rotate-90' : '')}>&#x25B6;</span>
          </div>
        </div>
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-white/5 pt-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <ScoreBar value={player.leagueRankScore} label="League Rank Score" color="cyan" />
              <ScoreBar value={player.teamFitScore} label="Team Fit Score" color="emerald" />
            </div>
            <div className="space-y-2">
              <ScoreBar value={player.goalAlignmentScore} label="Goal Alignment" color="purple" />
              <ScoreBar value={player.riskFitScore} label="Risk Fit" color="amber" />
            </div>
          </div>

          <div className="grid grid-cols-4 gap-1.5">
            <div className="text-center p-1.5 bg-white/3 rounded-lg">
              <div className="text-[11px] text-white/30">Slot Need</div>
              <div className="text-[11px] font-medium text-white/70">{Math.round(player.tfsBreakdown.slotNeedFit)}</div>
            </div>
            <div className="text-center p-1.5 bg-white/3 rounded-lg">
              <div className="text-[11px] text-white/30">Volatility</div>
              <div className="text-[11px] font-medium text-white/70">{Math.round(player.tfsBreakdown.volatilityBalance)}</div>
            </div>
            <div className="text-center p-1.5 bg-white/3 rounded-lg">
              <div className="text-[11px] text-white/30">Age Fit</div>
              <div className="text-[11px] font-medium text-white/70">{Math.round(player.tfsBreakdown.ageCurveFit)}</div>
            </div>
            <div className="text-center p-1.5 bg-white/3 rounded-lg">
              <div className="text-[11px] text-white/30">Bye Relief</div>
              <div className="text-[11px] font-medium text-white/70">{Math.round(player.tfsBreakdown.byeClusterRelief)}</div>
            </div>
          </div>

          {player.goalDetails.reasoning && (
            <div className="p-2 rounded-lg bg-purple-500/5 border border-purple-500/10">
              <span className="text-[11px] text-purple-300/80">{player.goalDetails.reasoning}</span>
            </div>
          )}

          <div className="flex items-center gap-2 text-[11px] text-white/30">
            <span>Mkt #{player.marketRank}</span>
            <span>|</span>
            <span>Value: {player.marketValue.toLocaleString()}</span>
            <span>|</span>
            <span>Pos #{player.positionRank}</span>
          </div>
        </div>
      )}
    </div>
  )
}

export default function EnhancedRankingsPanel({ username, leagueId, leagueName }: EnhancedRankingsProps) {
  const [view, setView] = useState<EnhancedView>('overall')
  const [goalOverride, setGoalOverride] = useState<GoalOption>('')
  const [posFilter, setPosFilter] = useState<PositionFilter>('')
  const [sortField, setSortField] = useState<SortField>('userRank')
  const [rosterOnly, setRosterOnly] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [players, setPlayers] = useState<PlayerRank[]>([])
  const [positionalStrength, setPositionalStrength] = useState<PositionalStrength[]>([])
  const [rosterProfile, setRosterProfile] = useState<RosterProfile | null>(null)
  const [aiPlan, setAiPlan] = useState<PlanItem[]>([])
  const [detectedGoal, setDetectedGoal] = useState<string>('')
  const [meta, setMeta] = useState<any>(null)
  const [expandedPlayer, setExpandedPlayer] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  const fetchRankings = useCallback(async (v: EnhancedView = view) => {
    if (!username || !leagueId) return
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/legacy/rankings/enhanced', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          league_id: leagueId,
          sleeper_username: username,
          view: v,
          goal: goalOverride || undefined,
          include_plan: v === 'dynasty_horizon' || v === 'overall',
          limit: 200,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to load rankings')
        return
      }
      import("@/lib/telemetry/client").then(m => m.logLegacyToolUsage({ tool: "EnhancedRankingsPanel", leagueId, action: "run", meta: { view: v } })).catch(() => {})
      setPlayers(data.players || [])
      setPositionalStrength(data.positionalStrength || [])
      setRosterProfile(data.rosterProfile || null)
      setAiPlan(data.aiPlan || [])
      setDetectedGoal(data.goal || 'balanced')
      setMeta(data.meta || null)
      setLoaded(true)
    } catch {
      setError('Network error - please try again')
    } finally {
      setLoading(false)
    }
  }, [username, leagueId, view, goalOverride])

  const handleViewChange = useCallback((v: EnhancedView) => {
    setView(v)
    setExpandedPlayer(null)
    if (loaded) fetchRankings(v)
  }, [loaded, fetchRankings])

  const sortedPlayers = useMemo(() => {
    let filtered = players
    if (posFilter) filtered = filtered.filter(p => p.position === posFilter)
    if (rosterOnly) filtered = filtered.filter(p => p.isOnUserRoster)
    const sorted = [...filtered]
    switch (sortField) {
      case 'market': sorted.sort((a, b) => a.marketRank - b.marketRank); break
      case 'impact': sorted.sort((a, b) => b.impactScore - a.impactScore); break
      case 'teamFit': sorted.sort((a, b) => b.teamFitScore - a.teamFitScore); break
      case 'goalAlign': sorted.sort((a, b) => b.goalAlignmentScore - a.goalAlignmentScore); break
      default: sorted.sort((a, b) => a.userRank - b.userRank); break
    }
    return sorted
  }, [players, posFilter, sortField, rosterOnly])

  const userRosterPlayers = useMemo(() => players.filter(p => p.isOnUserRoster), [players])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-cyan-400 text-lg">&#x1F4CA;</span>
        <h3 className="text-base font-bold text-white">Enhanced Rankings</h3>
      </div>
      <p className="text-xs text-white/40 -mt-3">
        Personal rankings with Team Fit Score + Goal Alignment + Risk Fit
      </p>

      <div className="flex bg-black/30 border border-white/10 rounded-xl overflow-hidden">
        {VIEW_CONFIG.map(v => (
          <button
            key={v.key}
            onClick={() => handleViewChange(v.key)}
            className={cx(
              'flex-1 flex flex-col items-center gap-0.5 py-2.5 text-xs font-medium transition-all touch-manipulation',
              view === v.key
                ? 'bg-gradient-to-b from-cyan-500/20 to-purple-500/20 text-white'
                : 'text-white/40 hover:text-white/70'
            )}
          >
            <span className="text-sm" dangerouslySetInnerHTML={{ __html: v.emoji }} />
            <span className="text-[11px]">{v.label}</span>
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <select
          value={goalOverride}
          onChange={(e) => setGoalOverride(e.target.value as GoalOption)}
          className="flex-1 px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-white text-xs focus:outline-none focus:border-cyan-500/40"
        >
          <option value="">Auto-detect goal</option>
          <option value="win-now">Win Now</option>
          <option value="balanced">Balanced</option>
          <option value="rebuild">Rebuild</option>
        </select>
      </div>

      {!loaded && !loading && (
        <button
          onClick={() => fetchRankings()}
          className="w-full py-3 bg-gradient-to-r from-cyan-500/20 to-purple-500/20 hover:from-cyan-500/30 hover:to-purple-500/30 border border-cyan-400/25 text-white font-medium rounded-xl transition touch-manipulation"
        >
          Load Enhanced Rankings
        </button>
      )}

      {loading && (
        <div className="flex flex-col items-center justify-center py-10 gap-3">
          <div className="relative w-10 h-10">
            <div className="absolute inset-0 rounded-full border-2 border-cyan-400/20" />
            <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-cyan-400 animate-spin" />
          </div>
          <p className="text-sm text-white/60">Computing {view === 'this_year' ? 'contender' : view === 'dynasty_horizon' ? 'dynasty horizon' : 'overall'} rankings...</p>
          <p className="text-xs text-white/30">League Rank + Team Fit + Goal Alignment + Risk Fit</p>
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
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="text-[11px] text-white/30">
                {meta.leagueName} | {meta.leagueType} | {meta.scoring}{meta.isSF ? ' | SF' : ''}{meta.isTEP ? ' | TEP' : ''} | {meta.numTeams}T
              </div>
              <span className={cx('px-2.5 py-1 rounded-full text-[11px] font-bold',
                detectedGoal === 'win-now' ? 'bg-green-500/20 text-green-300' :
                detectedGoal === 'rebuild' ? 'bg-purple-500/20 text-purple-300' :
                'bg-yellow-500/20 text-yellow-300'
              )}>
                {detectedGoal === 'win-now' ? 'WIN NOW' : detectedGoal === 'rebuild' ? 'REBUILD' : 'BALANCED'}
              </span>
            </div>
          )}

          {rosterProfile && <RosterProfileCard profile={rosterProfile} />}

          {positionalStrength.length > 0 && <PositionalStrengthChart data={positionalStrength} />}

          {aiPlan.length > 0 && <PlanCard plan={aiPlan} goal={detectedGoal} />}

          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex gap-1 flex-1 min-w-0">
              {(['', 'QB', 'RB', 'WR', 'TE'] as PositionFilter[]).map(p => (
                <button
                  key={p || 'ALL'}
                  onClick={() => setPosFilter(p)}
                  className={cx(
                    'px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all touch-manipulation border',
                    posFilter === p ? 'bg-white/10 border-white/20 text-white' : 'bg-transparent border-transparent text-white/35 hover:text-white/60'
                  )}
                >
                  {p || 'ALL'}
                </button>
              ))}
            </div>
            <button
              onClick={() => setRosterOnly(!rosterOnly)}
              className={cx(
                'px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition',
                rosterOnly ? 'bg-cyan-500/20 border-cyan-500/30 text-cyan-300' : 'border-transparent text-white/35 hover:text-white/60'
              )}
            >
              My Team
            </button>
            <button
              onClick={() => {
                const fields: SortField[] = ['userRank', 'market', 'impact', 'teamFit', 'goalAlign']
                const idx = fields.indexOf(sortField)
                setSortField(fields[(idx + 1) % fields.length])
              }}
              className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] text-white/40 hover:text-white/70 transition touch-manipulation"
            >
              <span>&#x21C5;</span>
              <span className="capitalize">{sortField === 'userRank' ? 'Rank' : sortField === 'teamFit' ? 'TFS' : sortField === 'goalAlign' ? 'Goal' : sortField}</span>
            </button>
          </div>

          <div className="space-y-1.5">
            {sortedPlayers.slice(0, 100).map(player => (
              <PlayerRow
                key={player.playerId}
                player={player}
                expanded={expandedPlayer === player.playerId}
                onToggle={() => setExpandedPlayer(expandedPlayer === player.playerId ? null : player.playerId)}
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
