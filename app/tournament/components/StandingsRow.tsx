'use client'

import type { StandingsLeagueRow } from '@/lib/tournament/tournamentStandingsFetch'

const statusStyles: Record<string, string> = {
  qualified: 'bg-yellow-500/15 text-yellow-100 border-yellow-500/30',
  wildcard_eligible: 'bg-blue-500/15 text-blue-100 border-blue-500/30',
  bubble: 'bg-amber-500/15 text-amber-100 border-amber-500/30',
  competing: 'bg-white/5 text-white/70 border-white/10',
  eliminated: 'bg-white/5 text-white/40 border-white/10',
}

export function StandingsRow({
  row,
  rank,
  highlight,
  movement,
  hidePf,
  variant = 'season',
}: {
  row: StandingsLeagueRow
  rank: number
  highlight?: boolean
  movement?: string
  hidePf?: boolean
  /** `weekly`: show redraft week score from `row.weekPoints` (fallback 0) instead of season record. */
  variant?: 'season' | 'weekly'
}) {
  const weekPf = variant === 'weekly' ? (row.weekPoints ?? 0) : row.pointsFor
  const st = row.advancementStatus ?? 'competing'
  const chip =
    st === 'wildcard_eligible'
      ? 'WILDCARD'
      : st === 'qualified'
        ? 'ADVANCING'
        : st.replace(/_/g, ' ').toUpperCase()
  return (
    <tr
      className={`border-b border-[var(--tournament-border)] text-[12px] ${
        highlight ? 'bg-white/[0.04]' : ''
      }`}
      style={
        highlight
          ? { boxShadow: 'inset 3px 0 0 0 var(--tournament-gold)' }
          : undefined
      }
    >
      <td className="w-9 py-2.5 pl-2 font-mono text-[13px] font-bold text-white">{rank}</td>
      <td className="w-9 py-2.5">
        <div className="h-7 w-7 rounded-full bg-white/10 text-center text-[11px] leading-7 text-white/60">
          {row.participant.displayName.slice(0, 1)}
        </div>
      </td>
      <td className="max-w-[120px] truncate py-2.5 font-medium text-white md:max-w-none">
        {row.participant.displayName}
      </td>
      <td className="hidden py-2.5 sm:table-cell">
        <span
          className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-bold ${statusStyles[st] ?? statusStyles.competing}`}
        >
          {chip}
        </span>
      </td>
      <td className="hidden w-14 py-2.5 text-center text-[11px] text-[var(--tournament-text-dim)] md:table-cell">
        {movement ?? '—'}
      </td>
      <td className="w-14 whitespace-nowrap py-2.5 text-[11px] text-[var(--tournament-text-mid)]">
        {variant === 'weekly' ? '—' : (
          <>
            {row.wins}-{row.losses}
            {row.ties ? `-${row.ties}` : ''}
          </>
        )}
      </td>
      {!hidePf ? (
        <td className="w-[72px] py-2.5 text-right font-semibold text-white">{weekPf.toFixed(1)}</td>
      ) : null}
      <td className="hidden w-12 py-2.5 text-right text-[11px] text-[var(--tournament-text-dim)] lg:table-cell">
        {row.conferenceRank ?? '—'}
      </td>
    </tr>
  )
}
