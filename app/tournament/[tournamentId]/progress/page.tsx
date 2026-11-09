'use client'

import { useMemo, useState } from 'react'
import { useTournamentUi } from '@/app/tournament/[tournamentId]/TournamentUiContext'
import { TournamentBracketView } from '@/components/tournament/TournamentBracketView'
import { ChampionCelebration } from '@/components/tournament/ChampionCelebration'

export default function TournamentProgressPage() {
  const ctx = useTournamentUi()
  const { shell, rounds, tournamentLeagues, conferences, participant } = ctx
  const [tab, setTab] = useState<'bracket' | 'list'>('bracket')

  const myConf = useMemo(
    () => conferences.find((c) => c.id === participant?.currentConferenceId) ?? conferences[0],
    [conferences, participant?.currentConferenceId],
  )

  const byRound = useMemo(() => {
    const m = new Map<string, typeof tournamentLeagues>()
    for (const tl of tournamentLeagues) {
      const arr = m.get(tl.roundId) ?? []
      arr.push(tl)
      m.set(tl.roundId, arr)
    }
    return m
  }, [tournamentLeagues])

  // Build bracket data from rounds + leagues
  const bracketRounds = useMemo(() => {
    return rounds.map((r) => {
      const tls = byRound.get(r.id) ?? []
      return {
        roundIndex: r.roundNumber ?? 0,
        roundLabel: r.roundLabel ?? `Round ${r.roundNumber}`,
        phase: r.roundType ?? 'qualification',
        status: r.status ?? 'pending',
        nodes: tls.map((l) => ({
          id: l.id,
          label: l.name ?? `League`,
          phase: r.roundType ?? 'qualification',
          leagueId: l.leagueId ?? undefined,
          teamCount: l.currentTeamCount ?? 0,
          teamSlots: l.teamSlots ?? 0,
          status: l.status ?? 'pending',
          conferenceName: conferences.find((c) => c.id === l.conferenceId)?.name,
        })),
      }
    })
  }, [rounds, byRound, conferences])

  // Champion info from shell settings
  const championName = (shell as Record<string, unknown>)?.championTeamName as string | null ?? null
  const championUserId = (shell as Record<string, unknown>)?.championUserId as string | null ?? null
  const tournamentStatus = shell?.status

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <h1 className="text-[18px] font-bold text-white">Progression map</h1>
      <p className="text-[12px] text-[var(--tournament-text-mid)]">
        Multi-league funnel — each node is a tournament league. You advance automatically; no invites.
      </p>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setTab('bracket')}
          className={`rounded-lg px-3 py-1.5 text-[12px] font-bold ${
            tab === 'bracket' ? 'bg-cyan-500/20 text-cyan-100' : 'bg-white/5 text-white/60'
          }`}
        >
          Bracket view
        </button>
        <button
          type="button"
          onClick={() => setTab('list')}
          className={`rounded-lg px-3 py-1.5 text-[12px] font-bold ${
            tab === 'list' ? 'bg-cyan-500/20 text-cyan-100' : 'bg-white/5 text-white/60'
          }`}
        >
          List view
        </button>
      </div>

      {tab === 'bracket' ? (
        <TournamentBracketView
          rounds={bracketRounds}
          myLeagueId={participant?.currentLeagueId}
          championName={championName}
          championUserId={championUserId}
          tournamentStatus={tournamentStatus}
        />
      ) : (
        <>
          <div className="scrollbar-none overflow-x-auto pb-4">
            <div className="flex min-w-[720px] gap-4">
              {rounds.map((r) => {
                const tls = byRound.get(r.id) ?? []
                return (
                  <div key={r.id} className="flex w-[200px] shrink-0 flex-col gap-2">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-cyan-200/90">{r.roundLabel}</p>
                    {tls.map((l) => {
                      const mine = l.id === participant?.currentLeagueId
                      return (
                        <div
                          key={l.id}
                          className={`rounded-xl border p-3 text-[11px] ${
                            mine
                              ? 'border-tournament-gold/60 bg-yellow-500/10 shadow-[0_0_16px_rgba(245,184,0,0.12)]'
                              : 'border-[var(--tournament-border)] bg-[var(--tournament-panel)]'
                          }`}
                        >
                          <p className="font-semibold text-white">{l.name}</p>
                          <p className="mt-1 text-[var(--tournament-text-dim)]">
                            {l.currentTeamCount}/{l.teamSlots} · {l.status}
                          </p>
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </div>

          <div className="tournament-panel p-4">
            <h2 className="text-[13px] font-bold text-white">Participants by round</h2>
            <ul className="mt-2 space-y-2 text-[12px] text-[var(--tournament-text-mid)]">
              {rounds.map((r) => {
                const tls = byRound.get(r.id) ?? []
                const n = tls.reduce((acc, l) => acc + l.currentTeamCount, 0)
                return (
                  <li key={r.id} className="flex justify-between border-b border-white/5 py-1">
                    <span>{r.roundLabel}</span>
                    <span className="font-mono text-white">{n || '—'}</span>
                  </li>
                )
              })}
              <li className="flex justify-between pt-2 font-bold text-[var(--tournament-gold)]">
                <span>Champion</span>
                <span>{championName ?? '🏆'}</span>
              </li>
            </ul>
          </div>
        </>
      )}

      {/* Champion celebration overlay — shown once when tournament is completed */}
      {tournamentStatus === 'completed' && championName && (
        <ChampionCelebration
          championName={championName}
          tournamentName={shell?.name ?? 'Tournament'}
        />
      )}
    </div>
  )
}
