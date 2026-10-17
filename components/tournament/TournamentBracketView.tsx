'use client'

import { useMemo } from 'react'
import { Trophy, ChevronRight, Crown } from 'lucide-react'

interface BracketNode {
  id: string
  label: string
  phase: string
  leagueId?: string
  teamCount: number
  teamSlots: number
  status: string
  conferenceName?: string
  conferenceTheme?: string
}

interface BracketRound {
  roundIndex: number
  roundLabel: string
  phase: string
  nodes: BracketNode[]
  status: string
}

interface TournamentBracketViewProps {
  rounds: BracketRound[]
  myLeagueId?: string | null
  championName?: string | null
  championUserId?: string | null
  tournamentStatus?: string
}

function phaseColor(phase: string): string {
  switch (phase) {
    case 'qualification': return 'border-blue-500/40 bg-blue-500/10'
    case 'elimination': return 'border-cyan-500/40 bg-cyan-500/10'
    case 'elite_eight': return 'border-purple-500/40 bg-purple-500/10'
    case 'championship': return 'border-yellow-500/50 bg-yellow-500/10'
    default: return 'border-white/10 bg-white/5'
  }
}

function phaseLabel(phase: string): string {
  switch (phase) {
    case 'qualification': return 'Qualification'
    case 'elimination': return 'Elimination'
    case 'elite_eight': return 'Elite Eight'
    case 'championship': return 'Championship'
    default: return phase
  }
}

function statusBadge(status: string) {
  if (status === 'active') return <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[11px] font-bold text-emerald-300">LIVE</span>
  if (status === 'completed' || status === 'archived') return <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-bold text-white/50">DONE</span>
  return <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] font-bold text-white/30">PENDING</span>
}

export function TournamentBracketView({
  rounds,
  myLeagueId,
  championName,
  championUserId,
  tournamentStatus,
}: TournamentBracketViewProps) {
  const sortedRounds = useMemo(
    () => [...rounds].sort((a, b) => a.roundIndex - b.roundIndex),
    [rounds]
  )

  const isCompleted = tournamentStatus === 'completed'

  return (
    <div className="space-y-4">
      {/* Horizontal bracket flow */}
      <div className="scrollbar-none overflow-x-auto pb-4">
        <div className="flex min-w-[720px] items-start gap-2">
          {sortedRounds.map((round, rIdx) => (
            <div key={round.roundIndex} className="flex items-start gap-2">
              <div className="flex w-[180px] shrink-0 flex-col gap-2">
                {/* Round header */}
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-white/70">
                    {round.roundLabel}
                  </span>
                  {statusBadge(round.status)}
                </div>
                <div className="mb-1 text-[11px] text-white/40">{phaseLabel(round.phase)}</div>

                {/* Nodes */}
                {round.nodes.map((node) => {
                  const isMine = node.leagueId === myLeagueId
                  return (
                    <div
                      key={node.id}
                      className={`rounded-xl border p-2.5 transition-all ${phaseColor(round.phase)} ${
                        isMine
                          ? 'ring-1 ring-yellow-400/40 shadow-[0_0_12px_rgba(245,184,0,0.15)]'
                          : ''
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <p className="text-[11px] font-semibold text-white">{node.label}</p>
                        {isMine && (
                          <span className="text-[11px] font-bold uppercase text-yellow-300">YOU</span>
                        )}
                      </div>
                      {node.conferenceName && (
                        <p className="mt-0.5 text-[11px] text-white/40">{node.conferenceName}</p>
                      )}
                      <div className="mt-1 flex items-center gap-2 text-[11px] text-white/50">
                        <span>{node.teamCount}/{node.teamSlots} teams</span>
                        <span className="text-white/20">·</span>
                        <span>{node.status}</span>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Arrow connector between rounds */}
              {rIdx < sortedRounds.length - 1 && (
                <div className="flex shrink-0 items-center self-center pt-8">
                  <ChevronRight className="h-5 w-5 text-white/20" />
                </div>
              )}
            </div>
          ))}

          {/* Champion node */}
          <div className="flex items-start gap-2">
            {sortedRounds.length > 0 && (
              <div className="flex shrink-0 items-center self-center pt-8">
                <ChevronRight className="h-5 w-5 text-yellow-500/40" />
              </div>
            )}
            <div className="flex w-[160px] shrink-0 flex-col items-center gap-2 pt-6">
              <div className={`flex flex-col items-center rounded-2xl border-2 p-4 text-center ${
                isCompleted
                  ? 'border-yellow-500/60 bg-gradient-to-b from-yellow-500/20 to-yellow-900/10 shadow-[0_0_24px_rgba(245,184,0,0.2)]'
                  : 'border-white/10 bg-white/[0.02]'
              }`}>
                {isCompleted ? (
                  <Crown className="mb-2 h-8 w-8 text-yellow-400" />
                ) : (
                  <Trophy className="mb-2 h-8 w-8 text-white/30" />
                )}
                <p className="text-[12px] font-bold text-white">
                  {isCompleted ? 'Champion' : 'TBD'}
                </p>
                {championName && (
                  <p className="mt-1 text-[11px] font-semibold text-yellow-300">
                    {championName}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Funnel summary */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
        <h3 className="mb-2 text-[12px] font-bold text-white/70">Tournament funnel</h3>
        <div className="flex items-center gap-1 text-[11px]">
          {sortedRounds.map((round, idx) => {
            const teamCount = round.nodes.reduce((sum, n) => sum + n.teamCount, 0)
            return (
              <div key={round.roundIndex} className="flex items-center gap-1">
                <span className={`rounded-lg px-2 py-1 font-mono font-bold ${
                  round.status === 'active' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/5 text-white/60'
                }`}>
                  {teamCount}
                </span>
                {idx < sortedRounds.length - 1 && (
                  <ChevronRight className="h-3.5 w-3.5 text-white/20" />
                )}
              </div>
            )
          })}
          {sortedRounds.length > 0 && (
            <>
              <ChevronRight className="h-3.5 w-3.5 text-yellow-500/40" />
              <span className="rounded-lg bg-yellow-500/20 px-2 py-1 font-mono font-bold text-yellow-300">
                {isCompleted ? '1' : '?'}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
