'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Fragment, useMemo } from 'react'
import { useTournamentUi } from '@/app/tournament/[tournamentId]/TournamentUiContext'
import { useTournamentParticipantState } from '@/lib/tournament/useTournamentParticipantState'
import { CutlineRow } from '@/app/tournament/components/CutlineRow'
import { BubbleLine } from '@/app/tournament/components/BubbleLine'
import { StandingsRow } from '@/app/tournament/components/StandingsRow'

export default function TournamentMyLeaguePage() {
  const tournamentId = useParams<{ tournamentId: string }>()?.tournamentId ?? ''
  const base = `/tournament/${tournamentId}`
  const ctx = useTournamentUi()
  const state = useTournamentParticipantState(ctx)
  const { shell, conferences } = ctx

  const conference = useMemo(
    () => conferences.find((c) => c.id === ctx.participant?.currentConferenceId) ?? null,
    [conferences, ctx.participant?.currentConferenceId],
  )

  const league = useMemo(() => {
    if (!state.myStandingsRow) return null
    return state.standingsLeagues.find((l) => l.id === state.myStandingsRow?.tournamentLeagueId) ?? null
  }, [state.myStandingsRow, state.standingsLeagues])

  const rows = league?.participants.slice().sort((a, b) => (a.leagueRank ?? 999) - (b.leagueRank ?? 999)) ?? []

  const adv = league?.advancersCount ?? shell.advancersPerLeague
  const bubbleCap = shell.bubbleEnabled ? shell.bubbleSize : 0

  const eliminated = state.status === 'eliminated'

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="sticky top-0 z-20 flex min-h-[48px] items-center justify-between gap-2 border-b border-[var(--tournament-border)] bg-[var(--tournament-bg)]/95 py-2 text-[12px] backdrop-blur">
        <div className="min-w-0">
          <span className="text-[var(--tournament-gold)]">🏆</span>{' '}
          <span className="font-semibold text-white">{ctx.shell.name}</span>
          <span className="text-[var(--tournament-text-dim)]"> · </span>
          <span className="text-[var(--tournament-text-mid)]">{conference?.name ?? 'Conference'}</span>
          <span className="text-[var(--tournament-text-dim)]"> · </span>
          <span className="text-cyan-200/90">{state.standingsRound?.roundLabel ?? 'Round'}</span>
        </div>
        <Link href={`${base}/standings`} className="shrink-0 text-[11px] font-semibold text-cyan-300 hover:underline">
          Conference standings
        </Link>
      </div>

      {league ? (
        <>
          <div
            className="overflow-hidden rounded-2xl border border-[var(--tournament-border)]"
            style={{
              background: conference?.colorHex
                ? `linear-gradient(180deg, ${conference.colorHex}33, transparent)`
                : undefined,
            }}
          >
            <div className="p-4 md:p-6">
              <h1 className="text-[22px] font-black text-white">{league.name}</h1>
              <div className="mt-2 flex flex-wrap gap-2">
                {conference ? (
                  <span className="rounded-full border border-white/15 bg-white/5 px-3 py-0.5 text-[11px]">
                    {conference.name}
                  </span>
                ) : null}
                <span className="rounded-full bg-white/10 px-3 py-0.5 text-[11px]">
                  {state.standingsRound?.roundLabel ?? 'Round'}
                </span>
                <span className="rounded-full bg-white/5 px-3 py-0.5 text-[11px] text-[var(--tournament-text-mid)]">
                  {league.teamSlots} teams · Top {adv} advance
                </span>
              </div>
              <p className="mt-3 text-[12px] text-[var(--tournament-text-dim)]">
                Bubble pool ~{bubbleCap} · Tiebreaker: {shell.tiebreakerMode.replace(/_/g, ' ')}
              </p>
            </div>
          </div>

          <div className="tournament-panel overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse">
              <thead>
                <tr className="border-b border-[var(--tournament-border)] text-left text-[11px] uppercase text-[var(--tournament-text-dim)]">
                  <th className="py-2 pl-2">#</th>
                  <th className="py-2" />
                  <th className="py-2">Team</th>
                  <th className="hidden py-2 sm:table-cell">Status</th>
                  <th className="hidden py-2 md:table-cell">Mv</th>
                  <th className="py-2">W-L</th>
                  <th className="py-2 text-right">PF</th>
                  <th className="hidden py-2 text-right lg:table-cell">Conf</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => {
                  const rank = row.leagueRank ?? idx + 1
                  return (
                    <Fragment key={row.id}>
                      <StandingsRow
                        row={row}
                        rank={rank}
                        highlight={row.userId === ctx.viewerUserId}
                        hidePf={false}
                      />
                      {adv > 0 && rank === adv ? <CutlineRow topN={adv} /> : null}
                      {bubbleCap > 0 && rank === adv + 1 ? <BubbleLine nextN={bubbleCap} /> : null}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>

          <details className="tournament-panel group p-4">
            <summary className="cursor-pointer text-[13px] font-bold text-white">
              Cutline detail <span className="text-[var(--tournament-text-dim)]">(tap to expand)</span>
            </summary>
            <p className="mt-3 text-[12px] text-[var(--tournament-text-mid)]">
              You need enough wins and points for to pass the qualification line. Tiebreaker:{' '}
              <strong className="text-white">{shell.tiebreakerMode.replace(/_/g, ' ')}</strong>. Remaining weeks follow
              the round template configured for this shell.
            </p>
          </details>

          {league.leagueId ? (
            <Link
              href={`/league/${league.leagueId}`}
              className="flex min-h-[52px] w-full items-center justify-center rounded-xl bg-cyan-500/20 text-[15px] font-bold text-cyan-100 hover:bg-cyan-500/30"
              data-testid="tournament-open-full-league"
            >
              Open full league workspace (tabs, waivers, draft)
            </Link>
          ) : null}
        </>
      ) : (
        <p className="text-[13px] text-[var(--tournament-text-dim)]">No league assignment loaded yet.</p>
      )}

      {eliminated ? (
        <p className="text-center text-[11px] text-[var(--tournament-text-dim)]">Read-only archive view</p>
      ) : null}
    </div>
  )
}
