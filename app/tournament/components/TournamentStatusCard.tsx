'use client'

import Link from 'next/link'
import type { SerializedConference } from '@/lib/tournament/tournamentPageData'
import type { SerializedTournamentLeague } from '@/lib/tournament/tournamentPageData'
import type { TournamentParticipantUiStatus } from '@/lib/tournament/useTournamentParticipantState'

export function TournamentStatusCard({
  status,
  conference,
  league,
  shellName,
  currentRound,
  totalRounds,
  recordW,
  recordL,
  pointsFor,
  conferenceRank,
  basePath,
  nextDraftAt,
  isDraftLive,
  isWildcardAdvance,
}: {
  status: TournamentParticipantUiStatus
  conference: SerializedConference | null
  league: SerializedTournamentLeague | null
  shellName: string
  currentRound: number
  totalRounds: number
  recordW: number
  recordL: number
  pointsFor: number
  conferenceRank: number | null
  basePath: string
  nextDraftAt: Date | null
  isDraftLive: boolean
  isWildcardAdvance?: boolean
}) {
  const wl = `${recordW}-${recordL}`

  let centerTitle = ''
  let centerSub = ''
  let centerClass = 'text-[var(--tournament-active)]'

  if (status === 'champion') {
    centerTitle = '🏆 Tournament Champion'
    centerSub = `You won ${shellName}`
    centerClass = 'bg-gradient-to-r from-yellow-200 via-amber-300 to-yellow-200 bg-clip-text text-transparent'
  } else if (status === 'eliminated') {
    centerTitle = 'Your tournament run has ended'
    centerSub = `Round ${currentRound} · ${wl} · ${pointsFor.toFixed(1)} PF`
    centerClass = 'text-[var(--tournament-elim)]'
  } else if (status === 'bubble') {
    centerTitle = '⚠ You are in the bubble'
    centerSub = 'Every point counts — climb the cutline to advance.'
    centerClass = 'text-[var(--tournament-bubble)]'
  } else if (status === 'advanced') {
    const wild = Boolean(isWildcardAdvance)
    centerTitle = wild ? '🃏 Wildcard qualifier' : '🏆 You qualified for the next round'
    centerSub = `Round ${currentRound} → keep an eye on your new league & draft`
    centerClass = 'text-[var(--tournament-gold)]'
  } else if (isDraftLive || nextDraftAt) {
    centerTitle = 'Draft window'
    centerSub = isDraftLive ? 'Draft is live — head to your league room.' : `Scheduled draft · check Drafts tab`
    centerClass = 'text-[var(--tournament-gold)]'
  } else {
    centerTitle = `You are competing in Round ${currentRound}`
    centerSub = 'Standings update as scores sync — no invite needed when you advance.'
    centerClass = 'text-[var(--tournament-active)]'
  }

  const cta =
    status === 'eliminated' ? (
      <Link
        href={`${basePath}/history`}
        className="mt-4 inline-flex w-full min-h-[48px] items-center justify-center rounded-xl bg-white/10 text-[14px] font-semibold text-white hover:bg-white/15"
        data-testid="tournament-status-history"
      >
        View tournament history
      </Link>
    ) : status === 'bubble' ? (
      <Link
        href={`${basePath}/standings`}
        className="mt-4 inline-flex w-full min-h-[48px] items-center justify-center rounded-xl bg-amber-500/20 text-[14px] font-semibold text-amber-100 hover:bg-amber-500/30"
        data-testid="tournament-status-bubble-standings"
      >
        View bubble standings
      </Link>
    ) : status === 'advanced' ? (
      <Link
        href={`${basePath}/league`}
        className="mt-4 inline-flex w-full min-h-[48px] items-center justify-center rounded-xl bg-yellow-500/25 text-[14px] font-semibold text-yellow-50 hover:bg-yellow-500/35"
        data-testid="tournament-status-new-league"
      >
        See your new league
      </Link>
    ) : nextDraftAt || isDraftLive ? (
      <Link
        href={league?.leagueId ? `/league/${league.leagueId}` : `${basePath}/drafts`}
        className="mt-4 inline-flex w-full min-h-[48px] items-center justify-center rounded-xl bg-cyan-500/20 text-[14px] font-semibold text-cyan-100 hover:bg-cyan-500/30"
        data-testid="tournament-status-draft"
      >
        {isDraftLive ? 'Enter draft room' : 'View draft room'}
      </Link>
    ) : (
      <Link
        href={`${basePath}/league`}
        className="mt-4 inline-flex w-full min-h-[48px] items-center justify-center rounded-xl bg-cyan-500/20 text-[14px] font-semibold text-cyan-100 hover:bg-cyan-500/30"
        data-testid="tournament-status-league"
      >
        View my league
      </Link>
    )

  return (
    <div className="tournament-panel relative overflow-hidden p-4 md:p-5">
      {status === 'eliminated' ? (
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-gray-900/40 to-transparent" />
      ) : null}
      <div className="relative flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {conference ? (
              <span
                className="rounded-full border px-3 py-1 text-[11px] font-bold"
                style={{
                  borderColor: `${conference.colorHex ?? '#fff'}55`,
                  background: `${conference.colorHex ?? '#333'}22`,
                  color: 'var(--tournament-text-full)',
                }}
              >
                {conference.name}
              </span>
            ) : null}
            {league ? (
              <span className="text-[14px] font-bold text-white">{league.name}</span>
            ) : (
              <span className="text-[14px] font-bold text-white/80">League TBD</span>
            )}
          </div>
          <span className="rounded-md bg-white/10 px-2 py-1 font-mono text-[11px] text-[var(--tournament-active)]">
            Round {currentRound}
          </span>
        </div>

        <div className="py-2 text-center">
          <p className={`text-[18px] font-bold leading-snug md:text-[22px] ${centerClass}`}>{centerTitle}</p>
          <p className="mt-2 text-[13px] text-[var(--tournament-text-mid)]">{centerSub}</p>
        </div>

        <div className="grid grid-cols-3 gap-2 border-t border-[var(--tournament-border)] pt-4 text-center">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-[var(--tournament-text-dim)]">Record</p>
            <p className="text-[15px] font-bold text-white">{wl}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-[var(--tournament-text-dim)]">Points for</p>
            <p className="text-[15px] font-bold text-white">{pointsFor.toFixed(1)}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-[var(--tournament-text-dim)]">Conf. rank</p>
            <p className="text-[15px] font-bold text-white">{conferenceRank ?? '—'}</p>
          </div>
        </div>

        {cta}
      </div>
    </div>
  )
}
