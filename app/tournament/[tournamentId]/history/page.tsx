'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useMemo } from 'react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { useTournamentUi } from '@/app/tournament/[tournamentId]/TournamentUiContext'
import { tournamentStatusWord } from '@/lib/tournament/tournamentWords'

/**
 * Round by round, what happened. The same "recaps appear here as the season progresses" line sat under all three
 * rounds, the heading printed the year twice ("AllFantasy Open 2026 · 2026 · NFL", today's year beside the
 * tournament's), and each round showed its stored status code (2026-11-24 audit). The note is now said once.
 */
export default function TournamentHistoryPage() {
  const { t, tInterpolate } = useLanguage()
  const tournamentId = useParams<{ tournamentId: string }>()?.tournamentId ?? ''
  const base = `/tournament/${tournamentId}`
  const ctx = useTournamentUi()
  const { shell, rounds, participant } = ctx

  const hist = useMemo(() => {
    const h = participant?.advancementHistory
    if (Array.isArray(h)) return h as { round?: number; advanced?: boolean; pointsFor?: number }[]
    return []
  }, [participant?.advancementHistory])

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="tournament-panel p-5">
        <h1 className="text-[18px] font-bold text-white">{shell.name}</h1>
        <p className="mt-1 text-[12px] text-[var(--tournament-text-dim)]">{shell.sport}</p>
        {participant?.status === 'champion' ? (
          <p className="mt-3 text-[20px] font-bold text-[var(--tournament-gold)]">🏆 {t('tournament.progress.champion')}</p>
        ) : null}
      </div>

      <ol className="space-y-3" data-testid="tournament-history-rounds">
        {rounds.map((r) => (
          <li key={r.id} className="tournament-panel p-4">
            <h2 className="text-[14px] font-bold text-cyan-100">
              {tInterpolate('tournament.history.roundHeading', { n: String(r.roundNumber), label: r.roundLabel })}
            </h2>
            <p className="mt-1 text-[12px] text-[var(--tournament-text-dim)]">
              {tInterpolate('tournament.history.roundWeeks', { start: String(r.weekStart), end: String(r.weekEnd) })}
              {' · '}
              {tournamentStatusWord(r.status, t)}
            </p>
          </li>
        ))}
      </ol>
      {rounds.length > 0 ? (
        <p className="text-center text-[12px] text-[var(--tournament-text-mid)]" data-testid="tournament-history-note">
          {t('tournament.history.recapNote')}
        </p>
      ) : null}

      {hist.length ? (
        <div className="tournament-panel p-4">
          <h2 className="text-[13px] font-bold text-white">{t('tournament.history.logTitle')}</h2>
          <ul className="mt-2 space-y-2 text-[12px] text-[var(--tournament-text-mid)]">
            {hist.map((e, i) => (
              <li key={i} className="border-b border-white/5 pb-2">
                {tInterpolate('tournament.history.logRow', {
                  n: String(e.round ?? '—'),
                  result: e.advanced ? t('tournament.history.advanced') : t('tournament.history.out'),
                  points: e.pointsFor != null ? String(e.pointsFor) : '—',
                })}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Link href={`${base}/standings`} className="block text-center text-[13px] font-semibold text-cyan-300 hover:underline">
        {t('tournament.history.viewStandings')}
      </Link>
    </div>
  )
}
