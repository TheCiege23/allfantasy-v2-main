'use client'

import { useMemo } from 'react'
import { Trophy, ChevronRight, Crown } from 'lucide-react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'

interface BracketNode {
  /** The tournament league's own id — what `myLeagueId` is matched against. */
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
  /** The viewer's tournament league id (`participant.currentLeagueId`), or its app league id. */
  myLeagueId?: string | null
  championName?: string | null
  championUserId?: string | null
  tournamentStatus?: string
}

function phaseColor(phase: string): string {
  switch (phase) {
    case 'qualification':
    case 'opening':
      return 'border-blue-500/40 bg-blue-500/10'
    case 'elimination':
      return 'border-cyan-500/40 bg-cyan-500/10'
    case 'elite_eight':
    case 'elite':
      return 'border-purple-500/40 bg-purple-500/10'
    case 'championship':
    case 'final':
      return 'border-yellow-500/50 bg-yellow-500/10'
    default:
      return 'border-white/10 bg-white/5'
  }
}

/**
 * The tournament's rounds as a funnel. On a phone the rounds stack top to bottom (sideways, round 3 sat off-screen);
 * a round with no leagues yet shows "—", not "0" teams (2026-11-24 audit). The round's own label is its only name —
 * the stored phase code ("opening", "elite") is no longer printed under it.
 */
export function TournamentBracketView({
  rounds,
  myLeagueId,
  championName,
  tournamentStatus,
}: TournamentBracketViewProps) {
  const { t, tInterpolate } = useLanguage()
  const sortedRounds = useMemo(() => [...rounds].sort((a, b) => a.roundIndex - b.roundIndex), [rounds])
  const isCompleted = tournamentStatus === 'completed'

  const statusBadge = (status: string) => {
    if (status === 'active' || status === 'drafting')
      return <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[11px] font-bold text-emerald-300">{t('tournament.words.roundBadge.live')}</span>
    if (status === 'complete' || status === 'completed' || status === 'archived')
      return <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-bold text-white/50">{t('tournament.words.roundBadge.done')}</span>
    return <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] font-bold text-white/50">{t('tournament.words.roundBadge.next')}</span>
  }

  return (
    <div className="space-y-4">
      <div className="pb-4 md:overflow-x-auto">
        <div className="flex flex-col gap-3 md:min-w-[720px] md:flex-row md:items-start md:gap-2" data-testid="tournament-bracket">
          {sortedRounds.map((round, rIdx) => (
            <div key={round.roundIndex} className="flex flex-col gap-2 md:flex-row md:items-start">
              <div className="flex w-full flex-col gap-2 md:w-[180px] md:shrink-0">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-white/70">{round.roundLabel}</span>
                  {statusBadge(round.status)}
                </div>
                {round.nodes.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-white/10 p-2.5 text-[11px] text-white/45">
                    {t('tournament.progress.leaguesLater')}
                  </p>
                ) : null}
                {round.nodes.map((node) => {
                  const isMine = Boolean(myLeagueId) && (node.id === myLeagueId || node.leagueId === myLeagueId)
                  return (
                    <div
                      key={node.id}
                      data-mine={isMine ? '' : undefined}
                      className={`rounded-xl border p-2.5 transition-all ${phaseColor(round.phase)} ${
                        isMine ? 'ring-1 ring-yellow-400/40 shadow-[0_0_12px_rgba(245,184,0,0.15)]' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[12px] font-semibold text-white">{node.label}</p>
                        {isMine && (
                          <span className="shrink-0 text-[11px] font-bold uppercase text-yellow-300">{t('tournament.progress.you')}</span>
                        )}
                      </div>
                      {node.conferenceName && <p className="mt-0.5 text-[11px] text-white/45">{node.conferenceName}</p>}
                      <p className="mt-1 text-[11px] text-white/55">
                        {tInterpolate('tournament.progress.teamsOf', { count: String(node.teamCount), slots: String(node.teamSlots) })}
                      </p>
                    </div>
                  )
                })}
              </div>
              {rIdx < sortedRounds.length - 1 && (
                <div className="flex shrink-0 items-center justify-center md:self-center md:pt-8">
                  <ChevronRight className="h-5 w-5 rotate-90 text-white/20 md:rotate-0" />
                </div>
              )}
            </div>
          ))}

          <div className="flex flex-col items-center gap-2 md:flex-row md:items-start">
            {sortedRounds.length > 0 && (
              <div className="flex shrink-0 items-center justify-center md:self-center md:pt-8">
                <ChevronRight className="h-5 w-5 rotate-90 text-yellow-500/40 md:rotate-0" />
              </div>
            )}
            <div className="flex w-[160px] shrink-0 flex-col items-center gap-2 md:pt-6">
              <div
                className={`flex w-full flex-col items-center rounded-2xl border-2 p-4 text-center ${
                  isCompleted
                    ? 'border-yellow-500/60 bg-gradient-to-b from-yellow-500/20 to-yellow-900/10 shadow-[0_0_24px_rgba(245,184,0,0.2)]'
                    : 'border-white/10 bg-white/[0.02]'
                }`}
              >
                {isCompleted ? <Crown className="mb-2 h-8 w-8 text-yellow-400" /> : <Trophy className="mb-2 h-8 w-8 text-white/30" />}
                <p className="text-[12px] font-bold text-white">{t('tournament.progress.champion')}</p>
                <p className="mt-1 text-[11px] font-semibold text-yellow-300">{championName ?? t('tournament.progress.championTbd')}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
        <h3 className="mb-2 text-[12px] font-bold text-white/70">{t('tournament.progress.funnelTitle')}</h3>
        <ul className="flex flex-wrap items-center gap-1 text-[11px]" data-testid="tournament-funnel">
          {sortedRounds.map((round, idx) => {
            const teamCount = round.nodes.reduce((sum, n) => sum + n.teamCount, 0)
            return (
              <li key={round.roundIndex} className="flex items-center gap-1">
                <span
                  className={`rounded-lg px-2 py-1 font-bold ${
                    round.status === 'active' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/5 text-white/60'
                  }`}
                >
                  {round.roundLabel} <span className="font-mono">{teamCount > 0 ? teamCount : '—'}</span>
                </span>
                {idx < sortedRounds.length - 1 && <ChevronRight className="h-3.5 w-3.5 text-white/20" />}
              </li>
            )
          })}
          {sortedRounds.length > 0 && (
            <li className="flex items-center gap-1">
              <ChevronRight className="h-3.5 w-3.5 text-yellow-500/40" />
              <span className="rounded-lg bg-yellow-500/20 px-2 py-1 font-bold text-yellow-300">🏆{isCompleted ? ' 1' : ''}</span>
            </li>
          )}
        </ul>
      </div>
    </div>
  )
}
