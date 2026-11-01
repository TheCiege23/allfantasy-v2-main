'use client'

import { useCallback, useEffect, useState } from 'react'
import { MAX_PAYOUT_PLACES } from '@/lib/payouts/payoutCalculator'
import type { PayoutsView } from '@/lib/payouts/payoutService'
import { formatPrize } from '@/lib/side-contests/sideContests'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { Card } from './NativeScreenParts'

/** English ordinal categories (1st, 2nd, 3rd, 4th, 11th…) pick the catalog key; Spanish writes every one as "n.º". */
const ORDINAL_RULES = new Intl.PluralRules('en-US', { type: 'ordinal' })

/**
 * The payout calculator (lib/payouts) on the standings screen: the pot, what the weekly prizes set
 * aside, the place split, and what each team stands to collect — final once the season's standings
 * are, "if the season ended today" before that. Every member sees it once the commissioner sets a
 * place split; the commissioner sets it up here. English and Spanish. A message the server sends back
 * (a refused save) is shown as it comes.
 */
type Draft = { buyIn: string; percents: string[] }

const toDraft = (v: PayoutsView): Draft => ({
  buyIn: v.plan.buyInCents != null ? (v.plan.buyInCents / 100).toFixed(2).replace(/\.00$/, '') : '',
  percents: (v.plan.placePercents.length ? v.plan.placePercents : v.suggestedPercents).map(String),
})

export function PayoutsCard({ leagueId }: { leagueId: string }) {
  const { t, tInterpolate } = useOptionalLanguage()
  const ordinal = (n: number) => tInterpolate(`league.payouts.ordinal.${ORDINAL_RULES.select(n)}`, { n })
  const url = `/api/leagues/${encodeURIComponent(leagueId)}/payouts`
  const [view, setView] = useState<PayoutsView | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch(url, { cache: 'no-store' })
      if (!r.ok) return
      setView((await r.json()) as PayoutsView)
    } catch {
      // A side card: the standings still render without it.
    }
  }, [url])

  useEffect(() => {
    void load()
  }, [load])

  if (!view || !view.native) return null
  const configured = view.plan.placePercents.length > 0
  if (!configured && !view.canEdit) return null
  const r = view.result

  const save = async () => {
    if (!draft) return
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ buyIn: draft.buyIn.trim(), placePercents: draft.percents.map((p) => Number(p)) }),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setMessage({ ok: false, text: body.error || t('league.common.saveFailed') })
        return
      }
      setEditing(false)
      setMessage({ ok: true, text: t('league.common.saved') })
      await load()
    } catch {
      setMessage({ ok: false, text: t('league.common.serverUnreachable') })
    } finally {
      setSaving(false)
    }
  }

  const draftTotal = draft ? draft.percents.reduce((sum, p) => sum + (Number(p) || 0), 0) : 0
  const name = (id: string | null) => (id && r ? r.names[id] ?? t('league.payouts.team') : '—')

  return (
    <Card
      label={t('league.payouts.label')}
      right={view.canEdit && !editing ? (
        <button type="button" className="nl-text-link" onClick={() => { setDraft(toDraft(view)); setEditing(true); setMessage(null) }}>
          {configured ? t('league.common.edit') : t('league.common.setUp')}
        </button>
      ) : null}
    >
      <div data-testid="payouts">
        {editing && draft ? (
          <div className="space-y-3" data-testid="payouts-edit">
            <label className="flex items-center gap-2">
              <span>{t('league.payouts.buyIn')}</span>
              <input
                inputMode="decimal"
                className="w-24"
                placeholder={view.entryFeeCents ? (view.entryFeeCents / 100).toFixed(0) : '0'}
                value={draft.buyIn}
                aria-label={t('league.payouts.buyInAria')}
                onChange={(e) => setDraft({ ...draft, buyIn: e.target.value })}
                data-testid="payouts-buy-in"
              />
            </label>
            <p className="nls-muted">
              {view.entryFeeCents
                ? tInterpolate('league.payouts.buyInDefault', { fee: formatPrize(view.entryFeeCents) })
                : t('league.payouts.noEntryFee')}
            </p>
            <ol className="space-y-1">
              {draft.percents.map((p, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="w-10">{ordinal(i + 1)}</span>
                  <input
                    inputMode="numeric"
                    className="w-16"
                    value={p}
                    aria-label={tInterpolate('league.payouts.placePercentAria', { place: ordinal(i + 1) })}
                    onChange={(e) => setDraft({ ...draft, percents: draft.percents.map((x, j) => (j === i ? e.target.value : x)) })}
                    data-testid={`payouts-percent-${i + 1}`}
                  />
                  <span>%</span>
                  <button
                    type="button"
                    className="nl-text-link"
                    aria-label={tInterpolate('league.payouts.removePlaceAria', { place: ordinal(i + 1) })}
                    onClick={() => setDraft({ ...draft, percents: draft.percents.filter((_, j) => j !== i) })}
                    data-testid={`payouts-remove-${i + 1}`}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ol>
            <div className="flex gap-3">
              {draft.percents.length < MAX_PAYOUT_PLACES ? (
                <button type="button" className="nl-text-link" onClick={() => setDraft({ ...draft, percents: [...draft.percents, '0'] })} data-testid="payouts-add-place">
                  {t('league.payouts.addPlace')}
                </button>
              ) : null}
              <button type="button" className="nl-text-link" onClick={() => setDraft({ ...draft, percents: view.suggestedPercents.map(String) })}>
                {t('league.payouts.commonSplit')}
              </button>
            </div>
            <p className="nls-muted" data-testid="payouts-draft-total">
              {tInterpolate('league.payouts.draftTotal', { total: draftTotal })}
              {draftTotal > 100 ? ` ${t('league.payouts.overHundred')}` : ''}
            </p>
            <p className="nls-muted">
              {t('league.payouts.weeklyFirst')}
            </p>
            <div className="flex gap-2">
              <button type="button" className="nls-btn" data-variant="primary" disabled={saving} onClick={() => void save()}>
                {saving ? t('league.common.saving') : t('league.common.save')}
              </button>
              <button type="button" className="nls-btn" disabled={saving} onClick={() => setEditing(false)}>
                {t('league.common.cancel')}
              </button>
            </div>
          </div>
        ) : !configured || !r ? (
          <p className="nls-muted">
            {t('league.payouts.intro')}
          </p>
        ) : (
          <>
            <dl className="nls-dl" data-testid="payouts-summary">
              <div>
                <dt>{t('league.payouts.pot')}</dt>
                <dd className="nls-mono">{`${formatPrize(r.buyInCents)} × ${view.teamCount} = ${formatPrize(r.potCents)}`}</dd>
              </div>
              {r.weeklyReserveCents > 0 ? (
                <div>
                  <dt>{t('league.common.weeklyPrizes')}</dt>
                  <dd className="nls-mono">{formatPrize(r.weeklyReserveCents)}</dd>
                </div>
              ) : null}
              <div>
                <dt>{t('league.payouts.forPlaces')}</dt>
                <dd className="nls-mono">{formatPrize(r.placePoolCents)}</dd>
              </div>
              {view.collected ? (
                <div data-testid="payouts-collected">
                  <dt>{t('league.payouts.collected')}</dt>
                  <dd className="nls-mono">
                    {tInterpolate('league.payouts.collectedValue', {
                      amount: formatPrize(view.collected.cents),
                      paid: view.collected.paidTeams,
                      teams: view.teamCount,
                    })}
                  </dd>
                </div>
              ) : null}
            </dl>
            {r.overCommittedCents > 0 ? (
              <p role="alert" data-testid="payouts-overcommitted">
                {tInterpolate('league.payouts.overCommitted', { amount: formatPrize(r.overCommittedCents) })}
              </p>
            ) : null}
            {r.unassignedPercent > 0 ? (
              <p className="nls-muted" data-testid="payouts-unassigned">
                {tInterpolate('league.payouts.unassigned', { percent: r.unassignedPercent, amount: formatPrize(r.unassignedCents) })}
              </p>
            ) : null}
            <p className="nls-label pt-2">{r.final ? t('league.payouts.final') : t('league.payouts.ifEndedToday')}</p>
            <ul className="space-y-1">
              {r.places.map((p) => (
                <li key={p.place} data-testid={`payouts-place-${p.place}`}>
                  <strong>{ordinal(p.place)}</strong> · {p.percent}% · {formatPrize(p.cents)} · {name(p.rosterId)}
                </li>
              ))}
            </ul>
            {r.teams.some((tm) => tm.totalCents > 0) ? (
              <>
                <p className="nls-label pt-2">{t('league.payouts.byTeam')}</p>
                <dl className="nls-dl" data-testid="payouts-teams">
                  {r.teams.filter((tm) => tm.totalCents > 0).map((tm) => (
                    <div key={tm.rosterId}>
                      <dt>{name(tm.rosterId)}</dt>
                      <dd className="nls-mono">
                        {formatPrize(tm.totalCents)}
                        {tm.weeklyCents > 0 && tm.placeCents > 0
                          ? ` ${tInterpolate('league.payouts.teamSplit', { placeAmount: formatPrize(tm.placeCents), weeklyAmount: formatPrize(tm.weeklyCents) })}`
                          : tm.weeklyCents > 0
                            ? ` ${t('league.payouts.weeklyOnly')}`
                            : ''}
                      </dd>
                    </div>
                  ))}
                </dl>
              </>
            ) : null}
            <p className="nls-muted pt-2">{t('league.common.moneyNote')}</p>
          </>
        )}
        {message ? (
          <p role={message.ok ? 'status' : 'alert'} className={message.ok ? 'nls-muted' : undefined}>
            {message.text}
          </p>
        ) : null}
      </div>
    </Card>
  )
}
