'use client'

import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { describePickTerms, type PickTermsOutcome } from '@/lib/league-trade-engine/pickTerms'
import { usePickTermsView } from '@/components/core-app/PickTermsEditor'

/**
 * Every future pick in the league that carries terms (lib/league-trade-engine/pickTerms.ts), on the
 * Trades page: what the terms say, who holds the pick, and — once its rookie draft is created — how
 * they settled. Renders nothing when no pick carries terms. Strings: pickTerms.* (EN/ES).
 */
const K = 'pickTerms.'

export function PickTermsCard({ leagueId }: { leagueId: string }) {
  const { language, t, tInterpolate } = useOptionalLanguage()
  const tx = (key: string, vars?: Record<string, string | number>) => (vars ? tInterpolate(K + key, vars) : t(K + key))
  const lang = language === 'es' ? 'es' : 'en'
  const view = usePickTermsView(leagueId)
  if (!view || view.picks.length === 0) return null

  const name = (id: string) => view.teams.find((x) => x.rosterId === id)?.name ?? '—'
  const outcome = (o: PickTermsOutcome, round: number | null) => tx(`outcome.${o}`, { round: round ?? '?' })

  return (
    <section id="pick-terms" className="af-card af-tr-section" data-testid="pick-terms-card">
      <h2 className="af-display">{tx('cardTitle')}</h2>
      <ul className="af-tc-list">
        {view.picks.map((p) => (
          <li key={p.pickId} data-testid="pick-terms-item">
            <strong>{tx('pickLine', { season: p.season, round: p.round, team: p.original })}</strong>
            {p.holder ? ` · ${tx('heldBy', { team: p.holder })}` : ''} · {describePickTerms(p.terms, name, lang, p.original)}
            <span className="af-tc-row-sub"> — {p.outcome ? outcome(p.outcome, p.outcomeRound) : tx('pending')}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
