'use client'

import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import type { StandingsLeagueRow } from '@/lib/tournament/tournamentStandingsFetch'
import { advancementWord } from '@/lib/tournament/tournamentWords'

const statusStyles: Record<string, string> = {
  qualified: 'bg-yellow-500/15 text-yellow-100 border-yellow-500/30',
  wildcard_eligible: 'bg-blue-500/15 text-blue-100 border-blue-500/30',
  bubble: 'bg-amber-500/15 text-amber-100 border-amber-500/30',
  competing: 'bg-white/5 text-white/70 border-white/10',
  eliminated: 'bg-white/5 text-white/40 border-white/10',
}

/**
 * The column headings for a table of `StandingsRow`s, hiding the same columns at the same widths. The Standings
 * tabs had no headings at all, and a movement column ("Mv") that no screen ever filled (2026-11-24 audit).
 */
export function StandingsHeaderRow({ variant = 'season' }: { variant?: 'season' | 'weekly' }) {
  const { t } = useLanguage()
  return (
    <tr className="border-b border-[var(--tournament-border)] text-left text-[11px] uppercase text-[var(--tournament-text-dim)]">
      <th className="w-9 py-2 pl-2">#</th>
      <th className="w-9 py-2" aria-hidden />
      <th className="py-2">{t('tournament.standings.col.team')}</th>
      <th className="hidden py-2 sm:table-cell">{t('tournament.standings.col.status')}</th>
      <th className="w-14 py-2">{variant === 'weekly' ? '' : t('tournament.standings.col.record')}</th>
      <th className="w-[72px] py-2 text-right">
        {variant === 'weekly' ? t('tournament.standings.col.week') : t('tournament.standings.col.points')}
      </th>
      <th className="hidden w-12 py-2 pr-2 text-right lg:table-cell">{t('tournament.standings.col.conf')}</th>
    </tr>
  )
}

export function StandingsRow({
  row,
  rank,
  highlight,
  hidePf,
  variant = 'season',
}: {
  row: StandingsLeagueRow
  rank: number
  highlight?: boolean
  hidePf?: boolean
  /** `weekly`: show redraft week score from `row.weekPoints` (fallback 0) instead of season record. */
  variant?: 'season' | 'weekly'
}) {
  const { t } = useLanguage()
  const weekPf = variant === 'weekly' ? (row.weekPoints ?? 0) : row.pointsFor
  const st = row.advancementStatus ?? 'competing'
  return (
    <tr
      className={`border-b border-[var(--tournament-border)] text-[12px] ${highlight ? 'bg-white/[0.04]' : ''}`}
      style={highlight ? { boxShadow: 'inset 3px 0 0 0 var(--tournament-gold)' } : undefined}
    >
      <td className="w-9 py-2.5 pl-2 font-mono text-[13px] font-bold text-white">{rank}</td>
      <td className="w-9 py-2.5">
        <div className="h-7 w-7 rounded-full bg-white/10 text-center text-[11px] leading-7 text-white/60">
          {row.participant.displayName.slice(0, 1)}
        </div>
      </td>
      <td className="max-w-[120px] truncate py-2.5 font-medium text-white md:max-w-none">{row.participant.displayName}</td>
      <td className="hidden py-2.5 sm:table-cell">
        <span
          className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase ${statusStyles[st] ?? statusStyles.competing}`}
        >
          {advancementWord(st, t)}
        </span>
      </td>
      <td className="w-14 whitespace-nowrap py-2.5 text-[11px] text-[var(--tournament-text-mid)]">
        {variant === 'weekly' ? null : (
          <>
            {row.wins}-{row.losses}
            {row.ties ? `-${row.ties}` : ''}
          </>
        )}
      </td>
      {!hidePf ? <td className="w-[72px] py-2.5 text-right font-semibold text-white">{weekPf.toFixed(1)}</td> : null}
      <td className="hidden w-12 py-2.5 pr-2 text-right text-[11px] text-[var(--tournament-text-dim)] lg:table-cell">
        {row.conferenceRank ?? '—'}
      </td>
    </tr>
  )
}
