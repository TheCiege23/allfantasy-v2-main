'use client'

import Link from 'next/link'
import type { CareerRival } from '@/lib/core-app/careerRecordBook'
import { useMessages } from '@/components/i18n/useMessages'
import { careerRivalsMessages } from '@/lib/core-app/messages/careerRivals'

/**
 * Career overview: the three managers you have played most, with your head-to-head record against
 * each. The rows come from the cached weekly record book (MatchupFact history, paired scores); the
 * full ledger lives on the Records tab, which this links to. Renders nothing without a rival.
 */
export function CareerRivalsCard({ rivals, ledgerHref }: { rivals: readonly CareerRival[]; ledgerHref: string }) {
  const m = useMessages(careerRivalsMessages)
  const top = rivals.slice(0, 3)
  if (top.length === 0) return null
  return (
    <section className="af-c13-card af-crr" data-testid="career-rivals" aria-labelledby="af-crr-title">
      <header className="af-crr-head">
        <h2 id="af-crr-title" className="af-crs-title">{m.title}</h2>
        <p className="af-crs-note">{m.note}</p>
      </header>
      <ol className="af-crr-list">
        {top.map((r) => {
          const tone = r.wins > r.losses ? 'good' : r.wins < r.losses ? 'bad' : 'even'
          const first = r.seasons[0]
          const last = r.seasons[r.seasons.length - 1]
          return (
            <li key={r.key} className="af-crr-row" data-testid="career-rival">
              <span className="af-crr-av" aria-hidden>{r.name.charAt(0).toUpperCase()}</span>
              <span className="af-crr-who">
                <span className="af-crr-name">{r.name}</span>
                <span className="af-crr-meta">
                  {m.meetings(r.meetings)}
                  {first != null && last != null ? ` · ${m.seasons(first, last)}` : ''}
                </span>
              </span>
              <span className="af-crr-rec" data-tone={tone} aria-label={`${m.record} ${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ''}`}>
                {r.wins}-{r.losses}
                {r.ties ? `-${r.ties}` : ''}
              </span>
            </li>
          )
        })}
      </ol>
      <Link className="af-crr-link" href={ledgerHref}>{m.ledger}</Link>
    </section>
  )
}
