'use client'

import { useEffect, useState } from 'react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { describePickTerms, type PickTerms } from '@/lib/league-trade-engine/pickTerms'
import type { PickTermsView } from '@/lib/league-trade-engine/pickTermsService'

/**
 * Terms for the future picks in an offer (lib/league-trade-engine/pickTerms.ts), in the Trade
 * Center's send panel: no terms, protected, or conditional, per pick. Renders nothing unless the
 * league allows terms and the offer holds a pick of this league's. The trade route checks every term
 * again; this editor only offers what it would accept. Strings: pickTerms.* (EN/ES).
 */
const K = 'pickTerms.'

export type OfferPick = { pickId: string; label: string; round: number; originalRosterId: string }

export function usePickTermsView(leagueId: string | null): Extract<PickTermsView, { supported: true }> | null {
  const [view, setView] = useState<Extract<PickTermsView, { supported: true }> | null>(null)
  useEffect(() => {
    if (!leagueId) return
    let live = true
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/pick-terms`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((v: PickTermsView | null) => {
        if (live && v?.supported) setView(v)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [leagueId])
  return view
}

export function PickTermsEditor(props: {
  view: Extract<PickTermsView, { supported: true }>
  picks: OfferPick[]
  value: Record<string, PickTerms | undefined>
  onChange: (pickId: string, terms: PickTerms | undefined) => void
}) {
  const { language, t } = useOptionalLanguage()
  const tx = (key: string) => t(K + key)
  const lang = language === 'es' ? 'es' : 'en'
  const { view, picks, value, onChange } = props
  if (!view.active || picks.length === 0) return null

  const name = (id: string) => view.teams.find((x) => x.rosterId === id)?.name ?? '—'
  const teamCount = view.teams.length
  const select = 'rounded-md border border-white/15 bg-white/[0.04] px-2 py-1 text-[12px]'
  // A pick that already carries terms from an earlier trade keeps them; they cannot be replaced here.
  const carried = new Set(view.picks.filter((p) => p.outcome == null).map((p) => p.pickId))

  return (
    <div className="af-tc-pick-terms" data-testid="pick-terms-editor">
      <span className="af-label">{tx('title')}</span>
      <p className="af-tc-row-sub">{tx('intro')}</p>
      <ul className="af-tc-list">
        {picks.map((p) => {
          const terms = value[p.pickId]
          const kind = terms?.kind ?? 'none'
          if (carried.has(p.pickId)) {
            const existing = view.picks.find((x) => x.pickId === p.pickId)!
            return (
              <li key={p.pickId}>
                <strong>{p.label}</strong> · {tx('carried')}: {describePickTerms(existing.terms, name, lang, name(p.originalRosterId))}
              </li>
            )
          }
          return (
            <li key={p.pickId} data-testid="pick-terms-row">
              <strong>{p.label}</strong>{' '}
              <select
                className={select}
                aria-label={tx('kind')}
                value={kind}
                onChange={(e) => {
                  const k = e.target.value
                  if (k === 'none') onChange(p.pickId, undefined)
                  else if (k === 'protected') onChange(p.pickId, { kind: 'protected', top: Math.min(3, teamCount - 1), ifProtected: 'stays' })
                  else onChange(p.pickId, { kind: 'conditional', teamRosterId: p.originalRosterId, event: 'misses_playoffs', effect: 'becomes_round', round: p.round > 1 ? p.round - 1 : 2 })
                }}
                data-testid="pick-terms-kind"
              >
                <option value="none">{tx('none')}</option>
                <option value="protected">{tx('protected')}</option>
                <option value="conditional">{tx('conditional')}</option>
              </select>
              {terms?.kind === 'protected' ? (
                <>
                  {' '}
                  <select className={select} aria-label={tx('top')} value={terms.top} onChange={(e) => onChange(p.pickId, { ...terms, top: Number(e.target.value) })} data-testid="pick-terms-top">
                    {Array.from({ length: Math.max(1, teamCount - 1) }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>{`${tx('topN')} ${n}`}</option>
                    ))}
                  </select>{' '}
                  <select className={select} aria-label={tx('ifProtected')} value={terms.ifProtected} onChange={(e) => onChange(p.pickId, { ...terms, ifProtected: e.target.value as 'stays' | 'rolls_over' })} data-testid="pick-terms-if">
                    <option value="stays">{tx('stays')}</option>
                    <option value="rolls_over">{tx('rollsOver')}</option>
                  </select>
                </>
              ) : null}
              {terms?.kind === 'conditional' ? (
                <>
                  {' '}
                  <select className={select} aria-label={tx('team')} value={terms.teamRosterId} onChange={(e) => onChange(p.pickId, { ...terms, teamRosterId: e.target.value })} data-testid="pick-terms-team">
                    {view.teams.map((team) => (
                      <option key={team.rosterId} value={team.rosterId}>{team.name}</option>
                    ))}
                  </select>{' '}
                  <select className={select} aria-label={tx('event')} value={terms.event} onChange={(e) => onChange(p.pickId, { ...terms, event: e.target.value as 'makes_playoffs' | 'misses_playoffs' })} data-testid="pick-terms-event">
                    <option value="misses_playoffs">{tx('misses')}</option>
                    <option value="makes_playoffs">{tx('makes')}</option>
                  </select>{' '}
                  <select
                    className={select}
                    aria-label={tx('effect')}
                    value={terms.effect === 'does_not_convey' ? 'void' : String(terms.round)}
                    onChange={(e) =>
                      onChange(p.pickId, e.target.value === 'void' ? { ...terms, effect: 'does_not_convey', round: undefined } : { ...terms, effect: 'becomes_round', round: Number(e.target.value) })
                    }
                    data-testid="pick-terms-effect"
                  >
                    {Array.from({ length: view.rounds }, (_, i) => i + 1)
                      .filter((r) => r !== p.round)
                      .map((r) => (
                        <option key={r} value={String(r)}>{`${tx('becomesRound')} ${r}`}</option>
                      ))}
                    <option value="void">{tx('doesNotConvey')}</option>
                  </select>
                </>
              ) : null}
              {terms ? <p className="af-tc-row-sub" data-testid="pick-terms-summary">{describePickTerms(terms, name, lang, name(p.originalRosterId))}</p> : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
