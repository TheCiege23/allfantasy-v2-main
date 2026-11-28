'use client'

import Link from 'next/link'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import type { SerializedConference } from '@/lib/tournament/tournamentPageData'
import type { SerializedTournamentLeague } from '@/lib/tournament/tournamentPageData'
import type { TournamentParticipantUiStatus } from '@/lib/tournament/useTournamentParticipantState'

/**
 * Your place in the tournament: one headline, your record, points and conference rank, and the one next step.
 * The round is not repeated here — the Home header carries it (2026-11-24 audit). Every word is translated.
 */
export function TournamentStatusCard({
  status,
  conference,
  league,
  shellName,
  currentRound,
  recordW,
  recordL,
  pointsFor,
  conferenceRank,
  pointsRank,
  pointsRankOf,
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
  /** Kept for callers; the round is said in the Home header, not here. */
  totalRounds?: number
  recordW: number
  recordL: number
  pointsFor: number
  conferenceRank: number | null
  /** Your place on the whole field by points scored, said under Points for rather than as a separate panel. */
  pointsRank?: number | null
  pointsRankOf?: number
  basePath: string
  nextDraftAt: Date | null
  isDraftLive: boolean
  isWildcardAdvance?: boolean
}) {
  const { t, tInterpolate } = useLanguage()
  const wl = `${recordW}-${recordL}`

  let centerTitle = ''
  let centerSub = ''
  let centerClass = 'text-[var(--tournament-active)]'

  if (status === 'champion') {
    centerTitle = t('tournament.status.champion.title')
    centerSub = tInterpolate('tournament.status.champion.sub', { name: shellName })
    centerClass = 'bg-gradient-to-r from-yellow-200 via-amber-300 to-yellow-200 bg-clip-text text-transparent'
  } else if (status === 'eliminated') {
    centerTitle = t('tournament.status.eliminated.title')
    centerSub = tInterpolate('tournament.status.eliminated.sub', {
      round: String(currentRound),
      record: wl,
      points: pointsFor.toFixed(1),
    })
    centerClass = 'text-[var(--tournament-elim)]'
  } else if (status === 'bubble') {
    centerTitle = t('tournament.status.bubble.title')
    centerSub = t('tournament.status.bubble.sub')
    centerClass = 'text-[var(--tournament-bubble)]'
  } else if (status === 'advanced') {
    centerTitle = isWildcardAdvance ? t('tournament.status.advanced.wildcard') : t('tournament.status.advanced.title')
    centerSub = t('tournament.status.advanced.sub')
    centerClass = 'text-[var(--tournament-gold)]'
  } else if (isDraftLive || nextDraftAt) {
    centerTitle = t('tournament.status.draft.title')
    centerSub = isDraftLive ? t('tournament.status.draft.live') : t('tournament.status.draft.scheduled')
    centerClass = 'text-[var(--tournament-gold)]'
  } else {
    centerTitle = tInterpolate('tournament.status.competing.title', { round: String(currentRound) })
    centerSub = t('tournament.status.competing.sub')
    centerClass = 'text-[var(--tournament-active)]'
  }

  const ctaClass = 'mt-4 inline-flex w-full min-h-[48px] items-center justify-center rounded-xl text-[14px] font-semibold'
  const cta =
    status === 'eliminated' ? (
      <Link href={`${basePath}/history`} className={`${ctaClass} bg-white/10 text-white hover:bg-white/15`} data-testid="tournament-status-history">
        {t('tournament.status.cta.history')}
      </Link>
    ) : status === 'bubble' ? (
      <Link
        href={`${basePath}/standings`}
        className={`${ctaClass} bg-amber-500/20 text-amber-100 hover:bg-amber-500/30`}
        data-testid="tournament-status-bubble-standings"
      >
        {t('tournament.status.cta.bubble')}
      </Link>
    ) : status === 'advanced' ? (
      <Link
        href={`${basePath}/league`}
        className={`${ctaClass} bg-yellow-500/25 text-yellow-50 hover:bg-yellow-500/35`}
        data-testid="tournament-status-new-league"
      >
        {t('tournament.status.cta.newLeague')}
      </Link>
    ) : nextDraftAt || isDraftLive ? (
      <Link
        href={league?.leagueId ? `/league/${league.leagueId}` : `${basePath}/drafts`}
        className={`${ctaClass} bg-cyan-500/20 text-cyan-100 hover:bg-cyan-500/30`}
        data-testid="tournament-status-draft"
      >
        {isDraftLive ? t('tournament.status.cta.enterDraft') : t('tournament.status.cta.viewDraft')}
      </Link>
    ) : (
      <Link
        href={`${basePath}/league`}
        className={`${ctaClass} bg-cyan-500/20 text-cyan-100 hover:bg-cyan-500/30`}
        data-testid="tournament-status-league"
      >
        {t('tournament.status.cta.myLeague')}
      </Link>
    )

  return (
    <div className="tournament-panel relative overflow-hidden p-4 md:p-5" data-testid="tournament-status-card">
      {status === 'eliminated' ? (
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-gray-900/40 to-transparent" />
      ) : null}
      <div className="relative flex flex-col gap-3">
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
            <span className="text-[14px] font-bold text-white/80">{t('tournament.status.leagueTbd')}</span>
          )}
        </div>

        <div className="py-2 text-center">
          <p className={`text-[18px] font-bold leading-snug md:text-[22px] ${centerClass}`}>{centerTitle}</p>
          <p className="mt-2 text-[13px] text-[var(--tournament-text-mid)]">{centerSub}</p>
        </div>

        <div className="grid grid-cols-3 gap-2 border-t border-[var(--tournament-border)] pt-4 text-center">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-[var(--tournament-text-dim)]">{t('tournament.status.stat.record')}</p>
            <p className="text-[15px] font-bold text-white">{wl}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-[var(--tournament-text-dim)]">{t('tournament.status.stat.points')}</p>
            <p className="text-[15px] font-bold text-white">{pointsFor.toFixed(1)}</p>
            {pointsRank != null && pointsRankOf ? (
              <p className="text-[11px] text-[var(--tournament-text-dim)]" data-testid="tournament-status-points-rank">
                {tInterpolate('tournament.status.stat.pointsRank', { rank: String(pointsRank), total: String(pointsRankOf) })}
              </p>
            ) : null}
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-[var(--tournament-text-dim)]">{t('tournament.status.stat.confRank')}</p>
            <p className="text-[15px] font-bold text-white">{conferenceRank ?? '—'}</p>
          </div>
        </div>

        {cta}
      </div>
    </div>
  )
}
