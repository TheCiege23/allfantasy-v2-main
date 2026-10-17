'use client'

import { useCallback, useEffect, useState } from 'react'
import { Trophy, Users, BarChart3, ArrowRight, Clock, Shield, AlertTriangle, Sparkles } from 'lucide-react'

interface TournamentStatus {
  tournamentName: string
  sport: string
  currentRound: number
  totalRounds: number
  conferenceName: string
  conferenceColor: string
  leagueName: string
  leagueSlug: string
  globalRank: number
  totalParticipants: number
  status: string
  cutlineDistance: number
  record: string
  pointsFor: number
  nextEvent: string | null
  nextEventTime: string | null
  nextDraftTime: string | null
  latestAnnouncement: string | null
  advancedTo: string | null
}

interface TournamentHomeScreenProps {
  tournamentId: string
}

const STATUS_MAP: Record<string, { label: string; color: string; icon: typeof Trophy }> = {
  active: { label: 'Competing', color: 'text-cyan-400', icon: Shield },
  qualified: { label: 'Qualified', color: 'text-emerald-400', icon: Shield },
  safe: { label: 'Safe', color: 'text-emerald-300', icon: Shield },
  bubble: { label: 'On the Bubble', color: 'text-amber-400', icon: AlertTriangle },
  out: { label: 'Outside Cutline', color: 'text-red-400', icon: AlertTriangle },
  advanced: { label: 'Advanced!', color: 'text-emerald-400', icon: ArrowRight },
  eliminated: { label: 'Eliminated', color: 'text-red-500', icon: AlertTriangle },
  awaiting_redraft: { label: 'Awaiting Redraft', color: 'text-violet-400', icon: Clock },
  championship: { label: 'Championship Round', color: 'text-amber-400', icon: Trophy },
  champion: { label: 'Champion!', color: 'text-amber-300', icon: Trophy },
}

export function TournamentHomeScreen({ tournamentId }: TournamentHomeScreenProps) {
  const [data, setData] = useState<TournamentStatus | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/tournament/${tournamentId}`)
      .then((r) => r.json())
      .then((d) => setData(d.status ?? d))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [tournamentId])

  if (loading) return <div className="text-sm text-white/40 p-4">Loading tournament...</div>
  if (!data) return <div className="text-sm text-white/40 p-4">Tournament not found.</div>

  const statusCfg = STATUS_MAP[data.status] ?? STATUS_MAP.active!
  const StatusIcon = statusCfg.icon

  return (
    <div className="space-y-4 p-4">
      {/* Tournament Header */}
      <div className="rounded-2xl border border-purple-500/20 bg-gradient-to-br from-purple-500/10 to-transparent p-5">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-purple-300/60">Tournament Mode</div>
            <div className="text-xl font-bold text-white mt-1">{data.tournamentName}</div>
            <div className="text-xs text-white/50 mt-1">{data.sport} · Round {data.currentRound} of {data.totalRounds}</div>
          </div>
          <Trophy className="h-8 w-8 text-purple-400/40" />
        </div>
      </div>

      {/* Status + Conference + League */}
      <div className="grid gap-3 sm:grid-cols-2">
        {/* Your Status */}
        <div className={`rounded-xl border p-4 ${
          data.status === 'eliminated' ? 'border-red-500/20 bg-red-500/5' :
          data.status === 'championship' ? 'border-amber-400/20 bg-amber-400/5' :
          data.status === 'advanced' ? 'border-emerald-400/20 bg-emerald-400/5' :
          'border-white/10 bg-white/[0.03]'
        }`}>
          <div className="text-xs text-white/40 mb-1">Your Status</div>
          <div className={`flex items-center gap-2 ${statusCfg.color}`}>
            <StatusIcon className="h-5 w-5" />
            <span className="text-lg font-bold">{statusCfg.label}</span>
          </div>
          <div className="mt-2 text-xs text-white/50">{data.record} · {data.pointsFor.toFixed(1)} PF</div>
          {data.cutlineDistance !== 0 && (
            <div className={`mt-1 text-xs ${data.cutlineDistance > 0 ? 'text-emerald-400/70' : 'text-red-400/70'}`}>
              {data.cutlineDistance > 0 ? `+${data.cutlineDistance.toFixed(1)} above cutline` : `${data.cutlineDistance.toFixed(1)} below cutline`}
            </div>
          )}
        </div>

        {/* Current League */}
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <div className="text-xs text-white/40 mb-1">Current League</div>
          <div className="text-sm font-semibold text-white">{data.leagueName}</div>
          <div className="flex items-center gap-2 mt-2">
            <div className="h-2 w-2 rounded-full" style={{ backgroundColor: data.conferenceColor || '#8b5cf6' }} />
            <span className="text-xs text-white/50">{data.conferenceName}</span>
          </div>
          <div className="mt-2 text-xs text-white/40">
            <Users className="inline h-3 w-3 mr-1" />
            Global #{data.globalRank} of {data.totalParticipants}
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid gap-2 sm:grid-cols-3">
        {data.nextDraftTime && (
          <div className="rounded-xl border border-violet-400/20 bg-violet-400/5 px-4 py-3">
            <div className="text-xs text-violet-300/60">Next Draft</div>
            <div className="text-sm font-medium text-violet-200 mt-1">
              <Clock className="inline h-3 w-3 mr-1" />
              {new Date(data.nextDraftTime).toLocaleDateString()}
            </div>
          </div>
        )}
        {data.advancedTo && (
          <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/5 px-4 py-3">
            <div className="text-xs text-emerald-300/60">Moving To</div>
            <div className="text-sm font-medium text-emerald-200 mt-1">
              <ArrowRight className="inline h-3 w-3 mr-1" />
              {data.advancedTo}
            </div>
          </div>
        )}
        <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
          <div className="text-xs text-white/40">Round Progress</div>
          <div className="mt-1.5 h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div className="h-full rounded-full bg-purple-400/60" style={{ width: `${(data.currentRound / data.totalRounds) * 100}%` }} />
          </div>
          <div className="mt-1 text-[11px] text-white/30">{data.currentRound}/{data.totalRounds} rounds</div>
        </div>
      </div>

      {/* Latest Announcement */}
      {data.latestAnnouncement && (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3">
          <div className="flex items-center gap-1.5 text-xs text-white/40 mb-1">
            <Sparkles className="h-3 w-3" />Latest Update
          </div>
          <div className="text-xs text-white/60">{data.latestAnnouncement}</div>
        </div>
      )}

      {/* Navigation Cards */}
      <div className="grid gap-2 sm:grid-cols-2">
        <a href={`/tournament/${tournamentId}`} className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 flex items-center gap-3 hover:border-white/20 transition">
          <BarChart3 className="h-5 w-5 text-cyan-400/60" />
          <div>
            <div className="text-sm font-medium text-white/80">Standings</div>
            <div className="text-[11px] text-white/40">League, conference, and global rankings</div>
          </div>
        </a>
        <a href={`/tournament/${tournamentId}`} className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 flex items-center gap-3 hover:border-white/20 transition">
          <Trophy className="h-5 w-5 text-purple-400/60" />
          <div>
            <div className="text-sm font-medium text-white/80">Tournament Central</div>
            <div className="text-[11px] text-white/40">Forum, announcements, round progress</div>
          </div>
        </a>
      </div>
    </div>
  )
}
