'use client'

import { useCallback, useEffect, useState } from 'react'
import { CheckCircle, XCircle, Clock, ArrowRight, Trophy, AlertTriangle } from 'lucide-react'

interface AdvancementStatus {
  userId: string
  displayName: string
  currentRound: number
  totalRounds: number
  status: 'active' | 'advanced' | 'eliminated' | 'awaiting_redraft' | 'championship' | 'champion'
  currentLeagueName: string
  currentConference: string
  nextLeagueName: string | null
  nextDraftTime: string | null
  globalRank: number
  cutlineDistance: number
  path: Array<{ round: number; leagueName: string; result: 'advanced' | 'eliminated' | 'active' }>
}

interface TournamentAdvancementTrackerProps {
  tournamentId: string
  userId?: string // if provided, shows personal tracker
}

const STATUS_CONFIG: Record<string, { icon: typeof CheckCircle; color: string; label: string }> = {
  active: { icon: Clock, color: 'text-cyan-400', label: 'Competing' },
  advanced: { icon: CheckCircle, color: 'text-emerald-400', label: 'Advanced' },
  eliminated: { icon: XCircle, color: 'text-red-400', label: 'Eliminated' },
  awaiting_redraft: { icon: Clock, color: 'text-violet-400', label: 'Awaiting Redraft' },
  championship: { icon: Trophy, color: 'text-amber-400', label: 'Championship Round' },
  champion: { icon: Trophy, color: 'text-amber-300', label: 'Champion' },
}

export function TournamentAdvancementTracker({ tournamentId, userId }: TournamentAdvancementTrackerProps) {
  const [tracker, setTracker] = useState<AdvancementStatus | null>(null)
  const [allParticipants, setAllParticipants] = useState<AdvancementStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'personal' | 'all'>(userId ? 'personal' : 'all')

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const url = userId
        ? `/api/tournament/${tournamentId}/champion-path?userId=${userId}`
        : `/api/tournament/${tournamentId}/standings`
      const res = await fetch(url)
      if (res.ok) {
        const data = await res.json()
        if (userId) {
          setTracker(data.tracker ?? data)
        }
        setAllParticipants(data.participants ?? data.standings ?? [])
      }
    } finally {
      setLoading(false)
    }
  }, [tournamentId, userId])

  useEffect(() => { fetchData() }, [fetchData])

  if (loading) return <div className="text-sm text-white/40">Loading advancement tracker...</div>

  return (
    <div className="space-y-4">
      {/* View toggle */}
      {userId && (
        <div className="flex gap-2">
          <button onClick={() => setView('personal')}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium ${view === 'personal' ? 'bg-cyan-400/10 text-cyan-100' : 'text-white/50'}`}>
            My Path
          </button>
          <button onClick={() => setView('all')}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium ${view === 'all' ? 'bg-cyan-400/10 text-cyan-100' : 'text-white/50'}`}>
            All Participants
          </button>
        </div>
      )}

      {/* Personal tracker */}
      {view === 'personal' && tracker && (
        <div className="space-y-4">
          {/* Status card */}
          <div className={`rounded-2xl border p-4 ${
            tracker.status === 'eliminated' ? 'border-red-500/20 bg-red-500/5' :
            tracker.status === 'championship' ? 'border-amber-400/20 bg-amber-400/5' :
            'border-cyan-400/20 bg-cyan-400/5'
          }`}>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-white/40">Round {tracker.currentRound} of {tracker.totalRounds}</div>
                <div className="text-lg font-bold text-white mt-1">{tracker.displayName}</div>
                <div className="text-xs text-white/50">{tracker.currentLeagueName} · {tracker.currentConference}</div>
              </div>
              <div className="text-right">
                {(() => {
                  const cfg = STATUS_CONFIG[tracker.status] ?? STATUS_CONFIG.active!
                  const Icon = cfg.icon
                  return (
                    <div className={`flex items-center gap-1.5 ${cfg.color}`}>
                      <Icon className="h-5 w-5" />
                      <span className="text-sm font-semibold">{cfg.label}</span>
                    </div>
                  )
                })()}
                <div className="mt-1 text-xs text-white/40">Global #{tracker.globalRank}</div>
              </div>
            </div>

            {/* Cutline distance */}
            {tracker.cutlineDistance !== 0 && (
              <div className={`mt-3 rounded-lg px-3 py-1.5 text-xs ${
                tracker.cutlineDistance > 0 ? 'bg-emerald-400/10 text-emerald-300' : 'bg-red-400/10 text-red-300'
              }`}>
                {tracker.cutlineDistance > 0 ? `+${tracker.cutlineDistance.toFixed(1)} above cutline` : `${tracker.cutlineDistance.toFixed(1)} below cutline`}
              </div>
            )}

            {/* Next assignment */}
            {tracker.nextLeagueName && (
              <div className="mt-3 flex items-center gap-2 text-xs text-white/60">
                <ArrowRight className="h-3 w-3" />
                Next: <span className="text-white/80 font-medium">{tracker.nextLeagueName}</span>
                {tracker.nextDraftTime && <span className="text-white/40">· Draft: {new Date(tracker.nextDraftTime).toLocaleDateString()}</span>}
              </div>
            )}
          </div>

          {/* Journey path */}
          <div>
            <div className="text-xs font-semibold text-white/60 mb-2">Championship Path</div>
            <div className="flex items-center gap-1 overflow-x-auto">
              {tracker.path.map((step, i) => {
                const isLast = i === tracker.path.length - 1
                return (
                  <div key={i} className="flex items-center gap-1">
                    <div className={`rounded-lg border px-2.5 py-1.5 text-[11px] whitespace-nowrap ${
                      step.result === 'advanced' ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200' :
                      step.result === 'eliminated' ? 'border-red-400/30 bg-red-400/10 text-red-200' :
                      'border-cyan-400/30 bg-cyan-400/10 text-cyan-200'
                    }`}>
                      <div className="font-bold">R{step.round}</div>
                      <div className="text-[11px] text-white/40">{step.leagueName}</div>
                    </div>
                    {!isLast && <ArrowRight className="h-3 w-3 text-white/20 flex-shrink-0" />}
                  </div>
                )
              })}
              {tracker.status !== 'eliminated' && (
                <>
                  <ArrowRight className="h-3 w-3 text-white/20 flex-shrink-0" />
                  <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 px-2.5 py-1.5 text-[11px] text-amber-200">
                    <Trophy className="h-3 w-3 inline mr-0.5" />Championship
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* All participants view */}
      {view === 'all' && (
        <div className="space-y-1">
          {allParticipants.length === 0 ? (
            <div className="text-sm text-white/40">No participants yet.</div>
          ) : (
            allParticipants.slice(0, 64).map((p) => {
              const cfg = STATUS_CONFIG[p.status] ?? STATUS_CONFIG.active!
              const Icon = cfg.icon
              return (
                <div key={p.userId} className={`flex items-center justify-between rounded-lg border border-white/5 px-3 py-1.5 text-xs ${p.status === 'eliminated' ? 'opacity-40' : ''}`}>
                  <div className="flex items-center gap-2">
                    <span className="w-5 text-center text-white/30 font-bold">{p.globalRank}</span>
                    <span className="text-white/80">{p.displayName}</span>
                    <span className="text-white/30 hidden sm:inline">{p.currentConference}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-white/40">R{p.currentRound}</span>
                    <Icon className={`h-3 w-3 ${cfg.color}`} />
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
