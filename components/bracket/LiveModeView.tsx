"use client"

import { useState, useMemo } from "react"
import { Activity, Radio, AlertTriangle, Clock, Trophy, TrendingUp, Zap, ChevronDown, ChevronUp, Shield } from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import { useUserTimezone } from "@/hooks/useUserTimezone"

type Game = {
  id: string
  homeTeam: string
  awayTeam: string
  homeScore: number | null
  awayScore: number | null
  status: string | null
  startTime: string | null
  seedHome?: number | null
  seedAway?: number | null
}

type StandingEntry = {
  entryId: string
  entryName: string
  userId: string
  displayName: string
  avatarUrl?: string | null
  totalPoints: number
  correctPicks: number
  totalPicks: number
  championPick?: string | null
  maxPossible?: number
  insuredNodeId?: string | null
  roundCorrect?: Record<number, number>
  roundPoints?: Record<number, number>
  scoringDetails?: {
    total: number
    breakdown?: Array<{
      nodeId: string
      base: number
      upsetDelta?: number
      leverageBonus?: number
      insured?: boolean
      total: number
    }>
  }
}

type Props = {
  games: Game[]
  standings: StandingEntry[]
  currentUserId: string
  playByPlaySupported?: boolean
  scoringMode?: string
}

function teamAbbrev(name: string) {
  if (!name) return "TBD"
  const words = name.trim().split(/\s+/)
  if (words.length === 1) return name.length <= 4 ? name.toUpperCase() : name.slice(0, 3).toUpperCase()
  if (words.length === 2 && name.length <= 5) return name.toUpperCase()
  return words.map((w) => w[0]).join("").toUpperCase().slice(0, 4)
}

function formatGameTime(
  dateStr: string | null,
  formatTime: (date: Date | string | number) => string
) {
  if (!dateStr) return "TBD"
  try {
    return formatTime(dateStr).toLowerCase()
  } catch {
    return "TBD"
  }
}

const ROUND_LABELS = [
  { round: 1, label: "R64" },
  { round: 2, label: "R32" },
  { round: 3, label: "S16" },
  { round: 4, label: "E8" },
  { round: 5, label: "F4" },
  { round: 6, label: "CH" },
]

export function LiveModeView({ games, standings, currentUserId, playByPlaySupported = false, scoringMode }: Props) {
  const [filter, setFilter] = useState<"all" | "live" | "final" | "upcoming">("all")
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null)
  const { formatTimeInTimezone } = useUserTimezone()

  const liveGames = useMemo(() => games.filter(g => g.status === "in_progress"), [games])
  const finalGames = useMemo(() => games.filter(g => g.status === "final"), [games])
  const upcomingGames = useMemo(() => games.filter(g => g.status !== "in_progress" && g.status !== "final"), [games])

  const filtered = useMemo(() => {
    switch (filter) {
      case "live": return liveGames
      case "final": return finalGames
      case "upcoming": return upcomingGames
      default: return [...liveGames, ...upcomingGames, ...finalGames]
    }
  }, [filter, liveGames, finalGames, upcomingGames, games])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="relative">
            <Radio className="h-5 w-5" style={{ color: '#ef4444' }} />
            {liveGames.length > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full animate-pulse" style={{ background: '#ef4444' }} />
            )}
          </div>
          <span className="text-sm font-bold text-white">LIVE MODE</span>
          {liveGames.length > 0 && (
            <span className="text-[11px] px-2 py-0.5 rounded-full font-bold" style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444' }}>
              {liveGames.length} LIVE
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[11px] px-1.5 py-0.5 rounded" style={{ background: scoringMode === 'momentum' ? 'rgba(251,146,60,0.12)' : scoringMode === 'accuracy_boldness' ? 'rgba(99,102,241,0.12)' : scoringMode === 'streak_survival' ? 'rgba(34,197,94,0.12)' : 'rgba(255,255,255,0.05)', color: scoringMode === 'momentum' ? '#fb923c' : scoringMode === 'accuracy_boldness' ? '#818cf8' : scoringMode === 'streak_survival' ? '#22c55e' : 'rgba(255,255,255,0.4)' }}>
            {scoringMode === 'momentum' ? 'Momentum' : scoringMode === 'accuracy_boldness' ? 'Accuracy+Bold' : scoringMode === 'streak_survival' ? 'Streak' : 'Standard'}
          </span>
        </div>
      </div>

      <div className="flex gap-1">
        {(["all", "live", "final", "upcoming"] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className="px-3 py-1.5 rounded-lg text-[11px] font-semibold uppercase tracking-wide transition-all"
            style={{
              background: filter === f ? 'rgba(251,146,60,0.12)' : 'rgba(255,255,255,0.03)',
              color: filter === f ? '#fb923c' : 'rgba(255,255,255,0.4)',
              border: `1px solid ${filter === f ? 'rgba(251,146,60,0.2)' : 'rgba(255,255,255,0.06)'}`,
            }}
          >
            {f === "all" ? `All (${games.length})` : f === "live" ? `Live (${liveGames.length})` : f === "final" ? `Final (${finalGames.length})` : `Upcoming (${upcomingGames.length})`}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <AnimatePresence mode="popLayout">
          {filtered.map((g) => (
            <LiveGameTile key={g.id} game={g} formatTimeInTimezone={formatTimeInTimezone} />
          ))}
        </AnimatePresence>
      </div>

      {filtered.length === 0 && (
        <div className="rounded-xl p-8 text-center" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <Clock className="h-8 w-8 mx-auto mb-2" style={{ color: 'rgba(255,255,255,0.15)' }} />
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>
            {filter === "live" ? "No games currently in progress" : filter === "final" ? "No completed games yet" : "No upcoming games"}
          </p>
        </div>
      )}

      {!playByPlaySupported && (
        <div className="rounded-xl p-3 flex items-center gap-2" style={{ background: 'rgba(234,179,8,0.06)', border: '1px solid rgba(234,179,8,0.15)' }}>
          <AlertTriangle className="h-4 w-4 flex-shrink-0" style={{ color: '#eab308' }} />
          <div>
            <div className="text-[11px] font-semibold" style={{ color: '#eab308' }}>Play-by-play unavailable</div>
            <div className="text-[11px]" style={{ color: 'rgba(234,179,8,0.6)' }}>Current data provider does not support play-by-play. Showing score-only updates.</div>
          </div>
        </div>
      )}

      {playByPlaySupported && liveGames.length > 0 && (
        <PlayByPlayFeed games={liveGames} />
      )}

      {standings.length > 0 && (
        <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="px-3 py-2 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
            <div className="flex items-center gap-2">
              <Trophy className="h-3.5 w-3.5" style={{ color: '#fb923c' }} />
              <span className="text-[11px] font-bold" style={{ color: 'rgba(255,255,255,0.6)' }}>LIVE LEADERBOARD</span>
            </div>
            <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.2)' }}>{standings.length} entries</span>
          </div>
          {standings.map((s, i) => {
            const isMe = s.userId === currentUserId
            const isExpanded = expandedEntry === s.entryId
            const bd = s.scoringDetails?.breakdown || []
            const totalUpset = bd.reduce((sum: number, b: any) => sum + (b.upsetDelta || 0), 0)
            const totalLeverage = bd.reduce((sum: number, b: any) => sum + (b.leverageBonus || 0), 0)
            const hasInsured = bd.some((b: any) => b.insured)
            const insuredPts = bd.filter((b: any) => b.insured && b.total > 0).reduce((sum: number, b: any) => sum + b.total, 0)
            const isEdge = scoringMode === "fancred_edge"
            const roundPoints = s.roundPoints ?? {}
            const roundCorrect = s.roundCorrect ?? {}
            return (
              <div
                key={s.entryId}
                className="cursor-pointer transition-colors"
                style={{ borderBottom: '1px solid rgba(255,255,255,0.03)', background: isMe ? 'rgba(251,146,60,0.04)' : 'transparent' }}
                onClick={() => setExpandedEntry(isExpanded ? null : s.entryId)}
              >
                <div className="flex items-center gap-3 px-3 py-2">
                  <span className="text-[11px] font-bold w-5 text-center" style={{ color: i === 0 ? '#fbbf24' : i === 1 ? '#94a3b8' : i === 2 ? '#cd7f32' : 'rgba(255,255,255,0.3)' }}>
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-white truncate">
                      {s.displayName || s.entryName}
                      {isMe && <span className="text-[11px] ml-1" style={{ color: '#fb923c' }}>(You)</span>}
                    </div>
                    {isEdge && !isExpanded && (totalUpset > 0 || totalLeverage > 0 || hasInsured) && (
                      <div className="flex gap-2 mt-0.5">
                        {totalUpset > 0 && (
                          <span className="text-[11px] tabular-nums" style={{ color: '#a78bfa' }}>
                            <Zap className="inline h-2.5 w-2.5 mr-0.5" />+{Math.round(totalUpset * 10) / 10}
                          </span>
                        )}
                        {totalLeverage > 0 && (
                          <span className="text-[11px] tabular-nums" style={{ color: '#fbbf24' }}>
                            +{Math.round(totalLeverage * 10) / 10}
                          </span>
                        )}
                        {hasInsured && (
                          <span className="text-[11px]" style={{ color: '#34d399' }}>
                            <Shield className="inline h-2.5 w-2.5" />
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="text-right flex items-center gap-1.5">
                    <div>
                      <div className="text-xs font-bold tabular-nums" style={{ color: '#fb923c' }}>{s.totalPoints}</div>
                      <div className="text-[11px]" style={{ color: 'rgba(255,255,255,0.25)' }}>{s.correctPicks}/{s.totalPicks}</div>
                    </div>
                    {isExpanded
                      ? <ChevronUp className="w-3 h-3 flex-shrink-0" style={{ color: 'rgba(255,255,255,0.2)' }} />
                      : <ChevronDown className="w-3 h-3 flex-shrink-0" style={{ color: 'rgba(255,255,255,0.2)' }} />
                    }
                  </div>
                </div>

                {isExpanded && (
                  <div className="px-3 pb-2" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                    <div className="ml-8 mt-1.5">
                      <div className="grid gap-0" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
                        {ROUND_LABELS.map((rl) => (
                          <div key={`h-${rl.round}`} className="text-center text-[11px] font-bold" style={{ color: 'rgba(255,255,255,0.25)' }}>
                            {rl.label}
                          </div>
                        ))}
                        {ROUND_LABELS.map((rl) => {
                          const rPts = roundPoints[rl.round] ?? 0
                          const rCorr = roundCorrect[rl.round] ?? 0
                          return (
                            <div key={`p-${rl.round}`} className="text-center">
                              <div className="text-[11px] font-bold tabular-nums" style={{ color: rPts > 0 ? '#fb923c' : 'rgba(255,255,255,0.1)' }}>
                                {rPts > 0 ? rPts : '-'}
                              </div>
                              <div className="text-[11px] tabular-nums" style={{ color: rCorr > 0 ? 'rgba(34,197,94,0.6)' : 'rgba(255,255,255,0.1)' }}>
                                {rCorr > 0 ? `${rCorr}W` : '-'}
                              </div>
                            </div>
                          )
                        })}
                      </div>

                      {isEdge && (totalUpset > 0 || totalLeverage > 0 || hasInsured) && (
                        <div className="flex flex-wrap gap-2 mt-1.5 pt-1.5" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                          {totalUpset > 0 && (
                            <span className="text-[11px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(167,139,250,0.1)', color: '#a78bfa' }}>
                              <Zap className="inline h-2.5 w-2.5 mr-0.5" />+{Math.round(totalUpset * 10) / 10} upset
                            </span>
                          )}
                          {totalLeverage > 0 && (
                            <span className="text-[11px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(251,191,36,0.1)', color: '#fbbf24' }}>
                              +{Math.round(totalLeverage * 10) / 10} leverage
                            </span>
                          )}
                          {hasInsured && (
                            <span className="text-[11px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(52,211,153,0.1)', color: '#34d399' }}>
                              <Shield className="inline h-2.5 w-2.5 mr-0.5" />{insuredPts > 0 ? `+${insuredPts} insured` : 'Insured'}
                            </span>
                          )}
                        </div>
                      )}

                      {s.championPick && (
                        <div className="flex items-center gap-1 mt-1.5 text-[11px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
                          <Trophy className="h-2.5 w-2.5" style={{ color: '#fbbf24' }} />
                          Champion: {s.championPick}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function LiveGameTile({
  game,
  formatTimeInTimezone,
}: {
  game: Game
  formatTimeInTimezone: (date: Date | string | number) => string
}) {
  const isLive = game.status === "in_progress"
  const isFinal = game.status === "final"

  const isUpset = isFinal && game.seedHome != null && game.seedAway != null && game.homeScore != null && game.awayScore != null && (
    (game.homeScore > game.awayScore && game.seedHome > game.seedAway) ||
    (game.awayScore > game.homeScore && game.seedAway > game.seedHome)
  )

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="rounded-xl p-3 space-y-2 relative overflow-hidden"
      style={{
        background: isLive ? 'rgba(239,68,68,0.04)' : 'rgba(255,255,255,0.02)',
        border: `1px solid ${isLive ? 'rgba(239,68,68,0.15)' : isUpset ? 'rgba(251,146,60,0.2)' : 'rgba(255,255,255,0.06)'}`,
      }}
    >
      {isLive && (
        <div className="absolute top-0 left-0 right-0 h-0.5" style={{ background: 'linear-gradient(90deg, transparent, #ef4444, transparent)' }}>
          <motion.div
            className="h-full w-1/3 rounded-full"
            style={{ background: '#ef4444' }}
            animate={{ x: ['0%', '200%'] }}
            transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
          />
        </div>
      )}

      {isUpset && (
        <div className="absolute top-2 right-2">
          <motion.div
            initial={{ scale: 0, rotate: -20 }}
            animate={{ scale: 1, rotate: 0 }}
            className="px-1.5 py-0.5 rounded text-[11px] font-black uppercase"
            style={{ background: 'rgba(251,146,60,0.2)', color: '#fb923c' }}
          >
            UPSET
          </motion.div>
        </div>
      )}

      <div className="space-y-1.5">
        <TeamRow
          name={game.homeTeam}
          seed={game.seedHome}
          score={game.homeScore}
          isWinner={isFinal && game.homeScore != null && game.awayScore != null && game.homeScore > game.awayScore}
          isLive={isLive}
        />
        <TeamRow
          name={game.awayTeam}
          seed={game.seedAway}
          score={game.awayScore}
          isWinner={isFinal && game.homeScore != null && game.awayScore != null && game.awayScore > game.homeScore}
          isLive={isLive}
        />
      </div>

      <div className="flex items-center justify-between pt-1" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
        <span className="text-[11px] font-semibold" style={{
          color: isLive ? '#ef4444' : isFinal ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.3)',
        }}>
          {isLive ? (
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#ef4444' }} />
              LIVE
            </span>
          ) : isFinal ? "FINAL" : formatGameTime(game.startTime, formatTimeInTimezone)}
        </span>
      </div>
    </motion.div>
  )
}

function TeamRow({ name, seed, score, isWinner, isLive }: {
  name: string
  seed?: number | null
  score: number | null
  isWinner: boolean
  isLive: boolean
}) {
  return (
    <div className="flex items-center gap-2">
      {seed != null && (
        <span className="text-[11px] font-bold w-4 text-center" style={{ color: 'rgba(255,255,255,0.3)' }}>
          {seed}
        </span>
      )}
      <span className={`text-xs font-semibold flex-1 truncate ${isWinner ? 'text-white' : 'text-white/60'}`}>
        {teamAbbrev(name)}
      </span>
      {(isLive || score != null) && (
        <motion.span
          key={score}
          initial={isLive ? { scale: 1.3 } : false}
          animate={{ scale: 1 }}
          className={`text-sm font-bold tabular-nums ${isWinner ? 'text-white' : 'text-white/50'}`}
        >
          {score ?? 0}
        </motion.span>
      )}
      {isWinner && (
        <Zap className="h-3 w-3" style={{ color: '#fbbf24' }} />
      )}
    </div>
  )
}

function PlayByPlayFeed({ games }: { games: Game[] }) {
  return (
    <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="px-3 py-2 flex items-center gap-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
        <Activity className="h-3.5 w-3.5" style={{ color: '#22c55e' }} />
        <span className="text-[11px] font-bold" style={{ color: 'rgba(255,255,255,0.6)' }}>PLAY-BY-PLAY</span>
        <span className="text-[11px] px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(34,197,94,0.1)', color: '#22c55e' }}>LIVE</span>
      </div>
      <div className="max-h-48 overflow-y-auto p-3 space-y-2">
        {games.map(g => (
          <div key={g.id} className="flex items-start gap-2 text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>
            <TrendingUp className="h-3 w-3 mt-0.5 flex-shrink-0" style={{ color: '#22c55e' }} />
            <div>
              <span className="font-semibold text-white">{teamAbbrev(g.homeTeam)}</span>
              <span className="mx-1">vs</span>
              <span className="font-semibold text-white">{teamAbbrev(g.awayTeam)}</span>
              <span className="ml-1.5" style={{ color: '#fb923c' }}>
                {g.homeScore ?? 0} - {g.awayScore ?? 0}
              </span>
            </div>
          </div>
        ))}
        {games.length === 0 && (
          <p className="text-center text-[11px]" style={{ color: 'rgba(255,255,255,0.2)' }}>Waiting for plays...</p>
        )}
      </div>
    </div>
  )
}
