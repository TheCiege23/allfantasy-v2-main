'use client';

import { useState } from 'react';
import {
  Target,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle2,
  Info,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Shield,
  Zap,
  Clock,
  ArrowRight,
  ArrowUpRight,
  ArrowDownRight,
  Lock,
  Trash2,
  Sparkles,
  ShoppingCart,
  GraduationCap,
  Users,
} from 'lucide-react';

interface StrategyPhase {
  name: string;
  weekRange: string;
  priority: string;
  actions: string[];
  targets: string[];
}

interface TradeWindow {
  type: 'buy' | 'sell' | 'hold';
  window: string;
  reason: string;
  urgency: 'high' | 'medium' | 'low';
  targets?: string[];
}

interface RiskPoint {
  category: string;
  description: string;
  severity: 'critical' | 'warning' | 'info';
  mitigation: string;
}

interface ClassificationMetrics {
  rosterValue: number;
  rosterValueRank: number;
  rosterValuePercentile: number;
  starterValue: number;
  starterValueRank: number;
  winRate: number;
  winRateRank: number;
  pointsFor: number;
  pointsForRank: number;
  draftCapitalValue: number;
  draftCapitalRank: number;
  avgAge: number;
  positionBreakdown: Record<string, { count: number; value: number }>;
  contenderScore: number;
  totalTeams: number;
  record: string;
}

interface StandingsSummary {
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  rank: number;
  totalTeams: number;
  playoffSpots: number;
}

interface PlayerMove {
  name: string;
  position: string;
  team: string | null;
  value: number;
  age: number | null;
  reason: string;
}

interface RosterMoves {
  sellHigh: PlayerMove[];
  tradeChips: PlayerMove[];
  holdCore: PlayerMove[];
  buyLowTargets: string[];
  dropCandidates: PlayerMove[];
  sleepers: PlayerMove[];
}

interface DraftStrategy {
  approach: string;
  description: string;
  targetPositions: string[];
  roundPlan: Array<{ round: string; focus: string; rationale: string }>;
  picksOwned: number;
  totalPickValue: number;
}

interface StrategyData {
  classification: 'contender' | 'competitive' | 'rebuilder';
  confidence: number;
  metrics: ClassificationMetrics;
  standings: StandingsSummary;
  phases: StrategyPhase[];
  tradeWindows: TradeWindow[];
  riskPoints: RiskPoint[];
  rosterMoves?: RosterMoves;
  draftStrategy?: DraftStrategy;
  aiRoadmap: string;
  weekNumber: number;
  isOffseason?: boolean;
  fromCache: boolean;
  snapshotId: string;
}

interface LeagueOption {
  league_id: string;
  name: string;
  season: number;
  type: string;
  team_count: number;
}

interface StrategyPlannerProps {
  leagues: LeagueOption[];
  sleeperUsername: string;
}

export default function StrategyPlanner({ leagues, sleeperUsername }: StrategyPlannerProps) {
  const [strategy, setStrategy] = useState<StrategyData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedPhase, setExpandedPhase] = useState<number | null>(0);
  const [showRoadmap, setShowRoadmap] = useState(false);
  const [selectedLeagueId, setSelectedLeagueId] = useState(leagues[0]?.league_id || '');
  const [rosterId, setRosterId] = useState<number | null>(null);
  const [managers, setManagers] = useState<Array<{ rosterId: number; displayName: string; userId: string }>>([]);
  const [managersLoading, setManagersLoading] = useState(false);

  const loadManagers = async (leagueId: string) => {
    if (!leagueId) return;
    setManagersLoading(true);
    try {
      const res = await fetch(`/api/legacy/trade/league-managers?league_id=${leagueId}&sport=nfl`);
      const data = await res.json();
      if (res.ok && data.managers) {
        setManagers(data.managers);
        const userTeam = data.managers.find((m: { displayName?: string; username?: string; userId?: string }) =>
          m.displayName?.toLowerCase() === sleeperUsername?.toLowerCase() ||
          m.username?.toLowerCase() === sleeperUsername?.toLowerCase() ||
          m.userId === sleeperUsername
        );
        setRosterId(userTeam ? userTeam.rosterId : data.managers[0]?.rosterId || null);
      }
    } catch { /* ignore */ }
    setManagersLoading(false);
  };

  const fetchStrategy = async (forceRefresh = false) => {
    if (!selectedLeagueId || !rosterId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/legacy/season-strategy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          league_id: selectedLeagueId,
          roster_id: rosterId,
          sleeper_username: sleeperUsername,
          force_refresh: forceRefresh,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate strategy');
      setStrategy(data);
      setExpandedPhase(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const classificationConfig = {
    contender: {
      label: 'Contender',
      color: 'from-emerald-500/20 to-green-500/10 border-emerald-400/40 text-emerald-300',
      bgColor: 'bg-emerald-500/15',
      icon: <TrendingUp className="w-5 h-5" />,
      description: 'Your team is built to compete for a championship this season.',
    },
    competitive: {
      label: 'Competitive',
      color: 'from-amber-500/20 to-yellow-500/10 border-amber-400/40 text-amber-300',
      bgColor: 'bg-amber-500/15',
      icon: <Target className="w-5 h-5" />,
      description: 'You could compete or rebuild — your next few weeks will decide the path.',
    },
    rebuilder: {
      label: 'Rebuilder',
      color: 'from-blue-500/20 to-cyan-500/10 border-blue-400/40 text-blue-300',
      bgColor: 'bg-blue-500/15',
      icon: <TrendingDown className="w-5 h-5" />,
      description: 'Focus on building for the future — accumulate youth and draft capital.',
    },
  };

  const urgencyColors = {
    high: 'text-red-400 bg-red-500/15 border-red-400/30',
    medium: 'text-amber-400 bg-amber-500/15 border-amber-400/30',
    low: 'text-blue-400 bg-blue-500/15 border-blue-400/30',
  };

  const severityConfig = {
    critical: { icon: <AlertTriangle className="w-4 h-4 text-red-400" />, color: 'border-red-500/30 bg-red-500/10' },
    warning: { icon: <AlertTriangle className="w-4 h-4 text-amber-400" />, color: 'border-amber-500/30 bg-amber-500/10' },
    info: { icon: <Info className="w-4 h-4 text-blue-400" />, color: 'border-blue-500/30 bg-blue-500/10' },
  };

  const selectedLeague = leagues.find(l => l.league_id === selectedLeagueId);

  if (!strategy && !loading) {
    return (
      <div className="space-y-6">
        <div className="text-center py-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500/20 to-cyan-500/20 border border-purple-400/20 mb-4">
            <Target className="w-8 h-8 text-purple-300" />
          </div>
          <h3 className="text-xl font-bold text-white mb-2">Season Strategy Planner</h3>
          <p className="text-white/60 text-sm max-w-md mx-auto mb-6">
            Get an AI-powered roadmap for your season. We&apos;ll analyze your roster, standings, draft capital,
            and schedule to classify your team and build a phased action plan.
          </p>
        </div>

        <div className="max-w-md mx-auto space-y-4">
          <div>
            <label className="block text-sm text-white/70 mb-2">Select League</label>
            <select
              value={selectedLeagueId}
              onChange={(e) => {
                setSelectedLeagueId(e.target.value);
                setRosterId(null);
                setManagers([]);
                setStrategy(null);
                if (e.target.value) loadManagers(e.target.value);
              }}
              className="w-full px-4 py-3 rounded-xl bg-black/50 border border-white/20 text-white focus:outline-none focus:border-purple-400/60 focus:ring-2 focus:ring-purple-400/20 transition appearance-none cursor-pointer text-sm"
            >
              <option value="" className="bg-gray-900">Choose a league...</option>
              {leagues.map(l => (
                <option key={l.league_id} value={l.league_id} className="bg-gray-900">
                  {l.name} ({l.season}) — {l.type} {l.team_count}-team
                </option>
              ))}
            </select>
          </div>

          {managersLoading && (
            <div className="text-center py-4">
              <RefreshCw className="w-5 h-5 text-purple-400 animate-spin mx-auto" />
              <p className="text-xs text-white/40 mt-2">Loading teams...</p>
            </div>
          )}

          {managers.length > 0 && !managersLoading && (
            <div>
              <label className="block text-sm text-white/70 mb-2">Your Team</label>
              <select
                value={rosterId ?? ''}
                onChange={(e) => setRosterId(Number(e.target.value))}
                className="w-full px-4 py-3 rounded-xl bg-black/50 border border-white/20 text-white focus:outline-none focus:border-purple-400/60 focus:ring-2 focus:ring-purple-400/20 transition appearance-none cursor-pointer text-sm"
              >
                {managers.map(m => (
                  <option key={m.rosterId} value={m.rosterId} className="bg-gray-900">
                    {m.displayName || `Team ${m.rosterId}`}
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            onClick={() => {
              if (!rosterId && selectedLeagueId && managers.length === 0) {
                loadManagers(selectedLeagueId);
              } else {
                fetchStrategy();
              }
            }}
            disabled={!selectedLeagueId || (managers.length > 0 && !rosterId)}
            className="w-full px-6 py-3 rounded-xl bg-gradient-to-r from-purple-600 to-cyan-600 text-white font-semibold
              hover:from-purple-500 hover:to-cyan-500 transition-all shadow-lg shadow-purple-500/20
              disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {managers.length === 0 && selectedLeagueId ? 'Load Teams' : 'Generate My Strategy'}
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="text-center py-16">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500/20 to-cyan-500/20 border border-purple-400/20 mb-4 animate-pulse">
            <RefreshCw className="w-8 h-8 text-purple-300 animate-spin" />
          </div>
          <h3 className="text-lg font-semibold text-white mb-2">Analyzing Your Season...</h3>
          <p className="text-white/50 text-sm">Valuing roster, computing standings, and generating AI roadmap</p>
          <div className="mt-6 max-w-xs mx-auto space-y-2">
            {['Valuing all league rosters', 'Computing draft capital', 'Classifying team direction', 'Generating AI roadmap'].map((step, i) => (
              <div key={i} className="flex items-center gap-2 text-xs text-white/40">
                <div className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" style={{ animationDelay: `${i * 0.3}s` }} />
                {step}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div className="text-center py-12">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-red-500/15 border border-red-400/20 mb-4">
            <AlertTriangle className="w-6 h-6 text-red-400" />
          </div>
          <h3 className="text-lg font-semibold text-white mb-2">Strategy Generation Failed</h3>
          <p className="text-red-300/80 text-sm mb-4">{error}</p>
          <button
            onClick={() => fetchStrategy()}
            className="px-4 py-2 rounded-lg bg-white/10 border border-white/10 text-white text-sm hover:bg-white/15 transition"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (!strategy) return null;

  const config = classificationConfig[strategy.classification];
  const m = strategy.metrics;

  return (
    <div className="space-y-6">
      {/* League Switcher */}
      {leagues.length > 1 && (
        <div className="flex items-center gap-3">
          <select
            value={selectedLeagueId}
            onChange={(e) => {
              setSelectedLeagueId(e.target.value);
              setRosterId(null);
              setManagers([]);
              setStrategy(null);
              setError(null);
              if (e.target.value) loadManagers(e.target.value);
            }}
            className="flex-1 px-3 py-2 rounded-lg bg-black/40 border border-white/15 text-white text-sm focus:outline-none focus:border-purple-400/50 transition appearance-none cursor-pointer"
          >
            {leagues.map(l => (
              <option key={l.league_id} value={l.league_id} className="bg-gray-900">
                {l.name} ({l.season}) — {l.type} {l.team_count}-team
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-bold text-white">Season Strategy</h3>
          {strategy.fromCache && (
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/5 text-white/40 border border-white/10">
              Cached
            </span>
          )}
        </div>
        <button
          onClick={() => fetchStrategy(true)}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white/60 text-xs hover:bg-white/10 hover:text-white/80 transition"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className={`p-5 rounded-2xl bg-gradient-to-r ${config.color} border`}>
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0 mt-0.5">{config.icon}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-1">
              <span className="text-xl font-bold text-white">{config.label}</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-white/70">
                {Math.round(strategy.confidence * 100)}% confidence
              </span>
            </div>
            <p className="text-sm text-white/60">{config.description}</p>
            <div className="mt-3 flex flex-wrap gap-3 text-xs">
              <span className="text-white/50">{strategy.isOffseason ? 'Offseason' : `Week ${strategy.weekNumber}`}</span>
              <span className="text-white/30">|</span>
              <span className="text-white/50">Score: {m.contenderScore}/1.00</span>
              <span className="text-white/30">|</span>
              <span className="text-white/50">{m.record} (#{m.winRateRank})</span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Roster Value', value: `#${m.rosterValueRank}`, sub: `${Math.round(m.rosterValuePercentile * 100)}th pctile` },
          { label: 'Starters', value: `#${m.starterValueRank}`, sub: `of ${m.totalTeams}` },
          { label: 'Points For', value: `#${m.pointsForRank}`, sub: `${Math.round(m.pointsFor)} pts` },
          { label: 'Draft Capital', value: `#${m.draftCapitalRank}`, sub: `${Math.round(m.draftCapitalValue)} value` },
        ].map((stat, i) => (
          <div key={i} className="p-3 rounded-xl bg-white/5 border border-white/10">
            <div className="text-[11px] text-white/40 uppercase tracking-wider mb-1">{stat.label}</div>
            <div className="text-lg font-bold text-white">{stat.value}</div>
            <div className="text-[11px] text-white/50">{stat.sub}</div>
          </div>
        ))}
      </div>

      <div>
        <h4 className="text-sm font-semibold text-white/80 mb-3 flex items-center gap-2">
          <Clock className="w-4 h-4 text-purple-400" />
          Strategy Phases
        </h4>
        <div className="space-y-2">
          {strategy.phases.map((phase, i) => {
            const isExpanded = expandedPhase === i;
            return (
              <div
                key={i}
                className="rounded-xl border border-white/10 bg-white/5 overflow-hidden transition-all"
              >
                <button
                  onClick={() => setExpandedPhase(isExpanded ? null : i)}
                  className="w-full flex items-center gap-3 p-4 text-left hover:bg-white/5 transition"
                >
                  <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500/20 to-cyan-500/20 border border-purple-400/20 flex items-center justify-center text-xs font-bold text-purple-300">
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-white">{phase.name}</span>
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/10 text-white/50">{phase.weekRange}</span>
                    </div>
                    <p className="text-xs text-white/50 mt-0.5 truncate">{phase.priority}</p>
                  </div>
                  {isExpanded ? <ChevronDown className="w-4 h-4 text-white/40" /> : <ChevronRight className="w-4 h-4 text-white/40" />}
                </button>
                {isExpanded && (
                  <div className="px-4 pb-4 pt-0">
                    <div className="ml-11 space-y-2">
                      {phase.actions.map((action, j) => (
                        <div key={j} className="flex items-start gap-2 text-xs">
                          <ArrowRight className="w-3 h-3 text-cyan-400 mt-0.5 flex-shrink-0" />
                          <span className="text-white/70">{action}</span>
                        </div>
                      ))}
                      {phase.targets.length > 0 && (
                        <div className="flex items-center gap-2 mt-2">
                          <span className="text-[11px] text-white/40">Focus positions:</span>
                          {phase.targets.map((t, k) => (
                            <span key={k} className="text-[11px] px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-400/20">{t}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {strategy.tradeWindows.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-white/80 mb-3 flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-400" />
            Trade Windows
          </h4>
          <div className="space-y-2">
            {strategy.tradeWindows.map((tw, i) => (
              <div key={i} className={`p-4 rounded-xl border ${urgencyColors[tw.urgency]}`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-semibold uppercase">{tw.type}</span>
                  <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-white/10 text-white/50">{tw.window}</span>
                  <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${urgencyColors[tw.urgency]}`}>{tw.urgency}</span>
                </div>
                <p className="text-xs text-white/60">{tw.reason}</p>
                {tw.targets && tw.targets.length > 0 && (
                  <div className="flex items-center gap-1.5 mt-2">
                    {tw.targets.map((t, k) => (
                      <span key={k} className="text-[11px] px-1.5 py-0.5 rounded bg-white/10 text-white/60">{t}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {strategy.riskPoints.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-white/80 mb-3 flex items-center gap-2">
            <Shield className="w-4 h-4 text-red-400" />
            Risk Assessment
          </h4>
          <div className="space-y-2">
            {strategy.riskPoints.map((rp, i) => {
              const sConfig = severityConfig[rp.severity];
              return (
                <div key={i} className={`p-4 rounded-xl border ${sConfig.color}`}>
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 mt-0.5">{sConfig.icon}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-semibold text-white">{rp.category}</span>
                        <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-white/10 text-white/40 capitalize">{rp.severity}</span>
                      </div>
                      <p className="text-xs text-white/60 mb-2">{rp.description}</p>
                      <div className="flex items-start gap-1.5">
                        <CheckCircle2 className="w-3 h-3 text-emerald-400 mt-0.5 flex-shrink-0" />
                        <span className="text-xs text-emerald-300/80">{rp.mitigation}</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {strategy.rosterMoves && (
        <div className="space-y-4">
          <h4 className="text-sm font-semibold text-white/80 flex items-center gap-2">
            <Users className="w-4 h-4 text-cyan-400" />
            Roster Move Recommendations
          </h4>

          {strategy.rosterMoves.holdCore.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Lock className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-xs font-semibold text-emerald-300 uppercase tracking-wider">Hold — Core Pieces</span>
              </div>
              <div className="grid gap-2">
                {strategy.rosterMoves.holdCore.map((p, i) => (
                  <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-emerald-500/5 border border-emerald-400/15">
                    <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-400/20 flex items-center justify-center text-[11px] font-bold text-emerald-300">{p.position}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-white">{p.name}</span>
                        <span className="text-[11px] px-1.5 py-0.5 rounded bg-white/10 text-white/50">{p.team || '—'}</span>
                        {p.age && <span className="text-[11px] text-white/40">Age {p.age}</span>}
                      </div>
                      <p className="text-xs text-white/50 mt-0.5">{p.reason}</p>
                    </div>
                    <span className="text-xs font-mono text-emerald-300/70">{p.value}v</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {strategy.rosterMoves.sellHigh.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <ArrowUpRight className="w-3.5 h-3.5 text-red-400" />
                <span className="text-xs font-semibold text-red-300 uppercase tracking-wider">Sell High</span>
              </div>
              <div className="grid gap-2">
                {strategy.rosterMoves.sellHigh.map((p, i) => (
                  <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-red-500/5 border border-red-400/15">
                    <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-red-500/15 border border-red-400/20 flex items-center justify-center text-[11px] font-bold text-red-300">{p.position}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-white">{p.name}</span>
                        <span className="text-[11px] px-1.5 py-0.5 rounded bg-white/10 text-white/50">{p.team || '—'}</span>
                        {p.age && <span className="text-[11px] text-white/40">Age {p.age}</span>}
                      </div>
                      <p className="text-xs text-white/50 mt-0.5">{p.reason}</p>
                    </div>
                    <span className="text-xs font-mono text-red-300/70">{p.value}v</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {strategy.rosterMoves.tradeChips.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <ShoppingCart className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-xs font-semibold text-amber-300 uppercase tracking-wider">Trade Chips</span>
              </div>
              <div className="grid gap-2">
                {strategy.rosterMoves.tradeChips.map((p, i) => (
                  <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-amber-500/5 border border-amber-400/15">
                    <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-400/20 flex items-center justify-center text-[11px] font-bold text-amber-300">{p.position}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-white">{p.name}</span>
                        <span className="text-[11px] px-1.5 py-0.5 rounded bg-white/10 text-white/50">{p.team || '—'}</span>
                        {p.age && <span className="text-[11px] text-white/40">Age {p.age}</span>}
                      </div>
                      <p className="text-xs text-white/50 mt-0.5">{p.reason}</p>
                    </div>
                    <span className="text-xs font-mono text-amber-300/70">{p.value}v</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {strategy.rosterMoves.sleepers.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                <span className="text-xs font-semibold text-purple-300 uppercase tracking-wider">Sleepers & Breakout Candidates</span>
              </div>
              <div className="grid gap-2">
                {strategy.rosterMoves.sleepers.map((p, i) => (
                  <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-purple-500/5 border border-purple-400/15">
                    <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-purple-500/15 border border-purple-400/20 flex items-center justify-center text-[11px] font-bold text-purple-300">{p.position}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-white">{p.name}</span>
                        <span className="text-[11px] px-1.5 py-0.5 rounded bg-white/10 text-white/50">{p.team || '—'}</span>
                        {p.age && <span className="text-[11px] text-white/40">Age {p.age}</span>}
                      </div>
                      <p className="text-xs text-white/50 mt-0.5">{p.reason}</p>
                    </div>
                    <span className="text-xs font-mono text-purple-300/70">{p.value}v</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {strategy.rosterMoves.buyLowTargets.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <ArrowDownRight className="w-3.5 h-3.5 text-cyan-400" />
                <span className="text-xs font-semibold text-cyan-300 uppercase tracking-wider">Buy Low Targets</span>
              </div>
              <div className="space-y-1.5">
                {strategy.rosterMoves.buyLowTargets.map((target, i) => (
                  <div key={i} className="flex items-start gap-2 p-3 rounded-xl bg-cyan-500/5 border border-cyan-400/15">
                    <ArrowRight className="w-3 h-3 text-cyan-400 mt-0.5 flex-shrink-0" />
                    <span className="text-xs text-white/70">{target}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {strategy.rosterMoves.dropCandidates.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Trash2 className="w-3.5 h-3.5 text-white/40" />
                <span className="text-xs font-semibold text-white/50 uppercase tracking-wider">Drop Candidates</span>
              </div>
              <div className="grid gap-2">
                {strategy.rosterMoves.dropCandidates.map((p, i) => (
                  <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-white/3 border border-white/8">
                    <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-[11px] font-bold text-white/40">{p.position}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-white/60">{p.name}</span>
                        <span className="text-[11px] px-1.5 py-0.5 rounded bg-white/5 text-white/40">{p.team || '—'}</span>
                      </div>
                      <p className="text-xs text-white/40 mt-0.5">{p.reason}</p>
                    </div>
                    <span className="text-xs font-mono text-white/30">{p.value}v</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {strategy.draftStrategy && (
        <div>
          <h4 className="text-sm font-semibold text-white/80 mb-3 flex items-center gap-2">
            <GraduationCap className="w-4 h-4 text-green-400" />
            Draft Strategy
          </h4>
          <div className="p-4 rounded-2xl bg-gradient-to-br from-green-500/5 to-emerald-500/5 border border-green-400/15 space-y-4">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <span className="text-base font-bold text-white">{strategy.draftStrategy.approach}</span>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-green-500/15 text-green-300 border border-green-400/20">
                  {strategy.draftStrategy.picksOwned} pick{strategy.draftStrategy.picksOwned !== 1 ? 's' : ''} owned
                </span>
              </div>
              <p className="text-xs text-white/60 leading-relaxed">{strategy.draftStrategy.description}</p>
            </div>

            {strategy.draftStrategy.targetPositions.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-white/40 uppercase tracking-wider">Target Positions:</span>
                {strategy.draftStrategy.targetPositions.map((pos, i) => (
                  <span key={i} className="text-[11px] px-2 py-0.5 rounded-full bg-green-500/15 text-green-300 border border-green-400/20 font-semibold">{pos}</span>
                ))}
              </div>
            )}

            <div className="space-y-2">
              {strategy.draftStrategy.roundPlan.map((rp, i) => (
                <div key={i} className="p-3 rounded-xl bg-black/20 border border-white/5">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-semibold text-green-300">{rp.round}</span>
                  </div>
                  <p className="text-sm text-white/80 font-medium">{rp.focus}</p>
                  <p className="text-[11px] text-white/40 mt-0.5">{rp.rationale}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {strategy.aiRoadmap && (
        <div>
          <button
            onClick={() => setShowRoadmap(!showRoadmap)}
            className="flex items-center gap-2 text-sm font-semibold text-white/80 mb-3 hover:text-white transition"
          >
            <Zap className="w-4 h-4 text-cyan-400" />
            AI Strategy Roadmap
            {showRoadmap ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
          {showRoadmap && (
            <div className="p-5 rounded-2xl bg-gradient-to-br from-purple-500/5 to-cyan-500/5 border border-purple-400/15">
              <div className="prose prose-invert prose-sm max-w-none">
                {strategy.aiRoadmap.split('\n').map((line, i) => {
                  if (!line.trim()) return <br key={i} />;
                  if (line.startsWith('##')) {
                    return <h4 key={i} className="text-white font-semibold text-sm mt-3 mb-1">{line.replace(/^#+\s*/, '')}</h4>;
                  }
                  if (line.startsWith('**') && line.endsWith('**')) {
                    return <p key={i} className="text-white font-semibold text-sm mt-2 mb-1">{line.replace(/\*\*/g, '')}</p>;
                  }
                  return <p key={i} className="text-white/70 text-xs leading-relaxed mb-1">{line}</p>;
                })}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="text-center text-[11px] text-white/30 pt-2">
        Snapshot ID: {strategy.snapshotId?.slice(0, 8)} | {strategy.isOffseason ? 'Offseason' : `Week ${strategy.weekNumber}`} | Updated weekly
      </div>
    </div>
  );
}
