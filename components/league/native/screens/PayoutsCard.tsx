'use client'

import { useCallback, useEffect, useState } from 'react'
import { MAX_PAYOUT_PLACES } from '@/lib/payouts/payoutCalculator'
import type { PayoutsView } from '@/lib/payouts/payoutService'
import { formatPrize } from '@/lib/side-contests/sideContests'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { Card } from './NativeScreenParts'

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
  const { language } = useOptionalLanguage()
  const es = language === 'es'
  const t = (en: string, esText: string) => (es ? esText : en)
  const ordinal = (n: number) => (es ? `${n}.º` : `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`)
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
        setMessage({ ok: false, text: body.error || t('Could not save. Try again.', 'No se pudo guardar. Inténtalo de nuevo.') })
        return
      }
      setEditing(false)
      setMessage({ ok: true, text: t('Saved.', 'Guardado.') })
      await load()
    } catch {
      setMessage({ ok: false, text: t('Could not reach the server. Try again.', 'No se pudo conectar con el servidor. Inténtalo de nuevo.') })
    } finally {
      setSaving(false)
    }
  }

  const draftTotal = draft ? draft.percents.reduce((sum, p) => sum + (Number(p) || 0), 0) : 0
  const name = (id: string | null) => (id && r ? r.names[id] ?? t('Team', 'Equipo') : '—')

  return (
    <Card
      label={t('Payouts', 'Pagos')}
      right={view.canEdit && !editing ? (
        <button type="button" className="nl-text-link" onClick={() => { setDraft(toDraft(view)); setEditing(true); setMessage(null) }}>
          {configured ? t('Edit', 'Editar') : t('Set up', 'Configurar')}
        </button>
      ) : null}
    >
      <div data-testid="payouts">
        {editing && draft ? (
          <div className="space-y-3" data-testid="payouts-edit">
            <label className="flex items-center gap-2">
              <span>{t('Buy-in per team $', 'Cuota por equipo $')}</span>
              <input
                inputMode="decimal"
                className="w-24"
                placeholder={view.entryFeeCents ? (view.entryFeeCents / 100).toFixed(0) : '0'}
                value={draft.buyIn}
                aria-label={t('Buy-in per team, in dollars', 'Cuota por equipo, en dólares')}
                onChange={(e) => setDraft({ ...draft, buyIn: e.target.value })}
                data-testid="payouts-buy-in"
              />
            </label>
            <p className="nls-muted">
              {view.entryFeeCents
                ? t(`Leave empty to use the league entry fee (${formatPrize(view.entryFeeCents)}).`, `Déjalo vacío para usar la cuota de la liga (${formatPrize(view.entryFeeCents)}).`)
                : t('The league has no entry fee set; enter the buy-in here.', 'La liga no tiene cuota de inscripción; escribe la cuota aquí.')}
            </p>
            <ol className="space-y-1">
              {draft.percents.map((p, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="w-10">{ordinal(i + 1)}</span>
                  <input
                    inputMode="numeric"
                    className="w-16"
                    value={p}
                    aria-label={t(`${ordinal(i + 1)} place, percent`, `${ordinal(i + 1)} puesto, porcentaje`)}
                    onChange={(e) => setDraft({ ...draft, percents: draft.percents.map((x, j) => (j === i ? e.target.value : x)) })}
                    data-testid={`payouts-percent-${i + 1}`}
                  />
                  <span>%</span>
                  <button
                    type="button"
                    className="nl-text-link"
                    aria-label={t(`Remove ${ordinal(i + 1)} place`, `Quitar ${ordinal(i + 1)} puesto`)}
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
                  {t('Add a place', 'Añadir un puesto')}
                </button>
              ) : null}
              <button type="button" className="nl-text-link" onClick={() => setDraft({ ...draft, percents: view.suggestedPercents.map(String) })}>
                {t('Use a common split', 'Usar un reparto habitual')}
              </button>
            </div>
            <p className="nls-muted" data-testid="payouts-draft-total">
              {t(`Total ${draftTotal}% of the place pool`, `Total ${draftTotal}% del bote de puestos`)}
              {draftTotal > 100 ? t(' — more than 100%', ' — más del 100%') : ''}
            </p>
            <p className="nls-muted">
              {t(
                'The weekly prizes come out of the pot first; the places split what is left. AllFantasy tracks the money; it does not collect or pay it.',
                'Los premios semanales salen primero del bote; los puestos se reparten lo que queda. AllFantasy lleva la cuenta del dinero; no lo cobra ni lo paga.',
              )}
            </p>
            <div className="flex gap-2">
              <button type="button" className="nls-btn" data-variant="primary" disabled={saving} onClick={() => void save()}>
                {saving ? t('Saving…', 'Guardando…') : t('Save', 'Guardar')}
              </button>
              <button type="button" className="nls-btn" disabled={saving} onClick={() => setEditing(false)}>
                {t('Cancel', 'Cancelar')}
              </button>
            </div>
          </div>
        ) : !configured || !r ? (
          <p className="nls-muted">
            {t(
              'Set the buy-in and how the pot splits by finishing place. Everyone sees what each team stands to collect.',
              'Define la cuota y cómo se reparte el bote según el puesto final. Todos ven lo que le corresponde a cada equipo.',
            )}
          </p>
        ) : (
          <>
            <dl className="nls-dl" data-testid="payouts-summary">
              <div>
                <dt>{t('Pot', 'Bote')}</dt>
                <dd className="nls-mono">{`${formatPrize(r.buyInCents)} × ${view.teamCount} = ${formatPrize(r.potCents)}`}</dd>
              </div>
              {r.weeklyReserveCents > 0 ? (
                <div>
                  <dt>{t('Weekly prizes', 'Premios semanales')}</dt>
                  <dd className="nls-mono">{formatPrize(r.weeklyReserveCents)}</dd>
                </div>
              ) : null}
              <div>
                <dt>{t('For the places', 'Para los puestos')}</dt>
                <dd className="nls-mono">{formatPrize(r.placePoolCents)}</dd>
              </div>
              {view.collected ? (
                <div data-testid="payouts-collected">
                  <dt>{t('Collected', 'Cobrado')}</dt>
                  <dd className="nls-mono">
                    {t(
                      `${formatPrize(view.collected.cents)} · ${view.collected.paidTeams} of ${view.teamCount} paid`,
                      `${formatPrize(view.collected.cents)} · ${view.collected.paidTeams} de ${view.teamCount} pagados`,
                    )}
                  </dd>
                </div>
              ) : null}
            </dl>
            {r.overCommittedCents > 0 ? (
              <p role="alert" data-testid="payouts-overcommitted">
                {t(
                  `The weekly prizes promise ${formatPrize(r.overCommittedCents)} more than the pot holds.`,
                  `Los premios semanales prometen ${formatPrize(r.overCommittedCents)} más de lo que tiene el bote.`,
                )}
              </p>
            ) : null}
            {r.unassignedPercent > 0 ? (
              <p className="nls-muted" data-testid="payouts-unassigned">
                {t(
                  `${r.unassignedPercent}% of the place pool (${formatPrize(r.unassignedCents)}) is not assigned to a place.`,
                  `El ${r.unassignedPercent}% del bote de puestos (${formatPrize(r.unassignedCents)}) no está asignado a ningún puesto.`,
                )}
              </p>
            ) : null}
            <p className="nls-label pt-2">{r.final ? t('Final', 'Final') : t('If the season ended today', 'Si la temporada terminara hoy')}</p>
            <ul className="space-y-1">
              {r.places.map((p) => (
                <li key={p.place} data-testid={`payouts-place-${p.place}`}>
                  <strong>{ordinal(p.place)}</strong> · {p.percent}% · {formatPrize(p.cents)} · {name(p.rosterId)}
                </li>
              ))}
            </ul>
            {r.teams.some((tm) => tm.totalCents > 0) ? (
              <>
                <p className="nls-label pt-2">{t('By team', 'Por equipo')}</p>
                <dl className="nls-dl" data-testid="payouts-teams">
                  {r.teams.filter((tm) => tm.totalCents > 0).map((tm) => (
                    <div key={tm.rosterId}>
                      <dt>{name(tm.rosterId)}</dt>
                      <dd className="nls-mono">
                        {formatPrize(tm.totalCents)}
                        {tm.weeklyCents > 0 && tm.placeCents > 0
                          ? t(` (${formatPrize(tm.placeCents)} place + ${formatPrize(tm.weeklyCents)} weekly)`, ` (${formatPrize(tm.placeCents)} puesto + ${formatPrize(tm.weeklyCents)} semanal)`)
                          : tm.weeklyCents > 0
                            ? t(' weekly prizes', ' en premios semanales')
                            : ''}
                      </dd>
                    </div>
                  ))}
                </dl>
              </>
            ) : null}
            <p className="nls-muted pt-2">{t('AllFantasy tracks the money; it does not collect or pay it.', 'AllFantasy lleva la cuenta del dinero; no lo cobra ni lo paga.')}</p>
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
