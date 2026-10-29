'use client'

import { useCallback, useEffect, useState } from 'react'
import BroadcastModal from '@/components/commish/BroadcastModal'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { leagueSettingsHomeHref } from '@/lib/league-settings-home/settingsEntryRouting'
import type { RolloverStepKey, RolloverStepState } from '@/lib/season-rollover/rolloverWizard'
import type { RolloverView } from '@/lib/season-rollover/rolloverService'
import type { DynastyRolloverView } from '@/lib/season-rollover/dynastyRolloverService'
import { DynastyRolloverWizard } from './DynastyRolloverWizard'

/**
 * The season rollover wizard (lib/season-rollover) on the Commissioner Hub: the steps from the
 * champion being crowned to next season's draft being set up, each measured, then the one renew
 * (POST /api/commissioner/leagues/[id]/renew — the same renew the league banner runs). Shown to the
 * head commissioner from the playoffs on. AF Commissioner adds a drafted announcement and carrying
 * the dues into next season's payout buy-in. English and Spanish; a server message is shown as is.
 * A dynasty league gets its own steps from the same route (./DynastyRolloverWizard.tsx).
 */
type Order = 'standings' | 'reverse_standings' | 'random'

const STATE_WORD: Record<RolloverStepState, [string, string]> = {
  done: ['Done', 'Hecho'],
  todo: ['To do', 'Pendiente'],
  blocked: ['After the season', 'Tras la temporada'],
  optional: ['Optional', 'Opcional'],
}
const MARK: Record<RolloverStepState, string> = { done: '✓', todo: '•', blocked: '🔒', optional: '○' }

const money = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`

export function RolloverWizard({ leagueId }: { leagueId: string }) {
  const { language } = useOptionalLanguage()
  const es = language === 'es'
  const t = (en: string, spanish: string) => (es ? spanish : en)
  const ord = (n: number) => (es ? `${n}.º` : `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`)
  const url = `/api/leagues/${encodeURIComponent(leagueId)}/rollover`
  const [view, setView] = useState<(RolloverView & { applies: true }) | null>(null)
  const [dynasty, setDynasty] = useState<DynastyRolloverView | null>(null)
  const [dues, setDues] = useState('')
  const [order, setOrder] = useState<Order>('standings')
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [announcing, setAnnouncing] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await fetch(url, { cache: 'no-store' })
      if (!r.ok) return
      const body = (await r.json()) as RolloverView | DynastyRolloverView | { applies: false }
      if (!body.applies) return
      if (body.kind === 'dynasty') {
        setDynasty(body)
        return
      }
      setView(body)
      setDues(body.input.dues.amountDollars != null ? String(body.input.dues.amountDollars) : '')
      setOrder(body.input.draftOrder === 'manual' ? 'standings' : body.input.draftOrder)
    } catch {
      // A hub card: the rest of the hub renders without it.
    }
  }, [url])

  useEffect(() => {
    void load()
  }, [load])

  if (dynasty) return dynasty.show ? <DynastyRolloverWizard leagueId={leagueId} view={dynasty} reload={load} /> : null
  if (!view || !view.show) return null
  const { input, plan } = view
  const stateOf = (key: RolloverStepKey) => plan.steps.find((s) => s.key === key)!.state

  const renew = async () => {
    setBusy(true)
    setMessage(null)
    const amount = Number(dues)
    try {
      const r = await fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/renew`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedSeason: input.season,
          draftOrder: order,
          duesEnabled: Number.isFinite(amount) && amount > 0,
          duesAmount: Number.isFinite(amount) && amount > 0 ? amount : undefined,
        }),
      })
      const body = (await r.json().catch(() => ({}))) as { error?: string; message?: string }
      if (!r.ok) {
        setMessage({ ok: false, text: body.message || body.error || t('The renew did not go through. Try again.', 'La renovación no se completó. Inténtalo de nuevo.') })
        return
      }
      setMessage({ ok: true, text: t(`Renewed for ${input.nextSeason}. Next season’s draft is set up.`, `Renovada para ${input.nextSeason}. El draft de la próxima temporada está listo.`) })
      await load()
    } catch {
      setMessage({ ok: false, text: t('Could not reach the server. Try again.', 'No se pudo conectar con el servidor. Inténtalo de nuevo.') })
    } finally {
      setBusy(false)
    }
  }

  const carry = async () => {
    setBusy(true)
    setMessage(null)
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'carry_payouts' }) })
      const body = (await r.json().catch(() => ({}))) as { error?: string }
      if (!r.ok) {
        setMessage({ ok: false, text: body.error || t('Could not save. Try again.', 'No se pudo guardar. Inténtalo de nuevo.') })
        return
      }
      setMessage({ ok: true, text: t('Payouts now use next season’s dues.', 'Los pagos ya usan la cuota de la próxima temporada.') })
      await load()
    } catch {
      setMessage({ ok: false, text: t('Could not reach the server. Try again.', 'No se pudo conectar con el servidor. Inténtalo de nuevo.') })
    } finally {
      setBusy(false)
    }
  }

  const detail = (key: RolloverStepKey) => {
    switch (key) {
      case 'season':
        return input.seasonOver || input.renewed
          ? input.champion
            ? t(`${input.champion} won ${input.renewed ? input.season - 1 : input.season}.`, `${input.champion} ganó ${input.renewed ? input.season - 1 : input.season}.`)
            : t('The season is over.', 'La temporada terminó.')
          : t(`The rest opens once the ${input.season} champion is crowned.`, `Lo demás se abre cuando se corone al campeón de ${input.season}.`)
      case 'payouts':
        return input.payouts.configured ? (
          <>
            {input.payouts.places.map((p) => `${ord(p.place)} ${p.team ?? '—'} ${money(p.cents)}`).join(' · ')}
            {!input.payouts.final ? t(' (not final yet)', ' (aún no es definitivo)') : ''}
            {input.dues.unpaidTeams > 0
              ? t(` · ${input.dues.unpaidTeams} still owe this season’s dues.`, ` · ${input.dues.unpaidTeams} aún deben la cuota de esta temporada.`)
              : ''}{' '}
            <a href={`/core/standings?league=${encodeURIComponent(leagueId)}`}>{t('Payouts', 'Pagos')}</a>
          </>
        ) : (
          t('No payouts set. Set them on the Standings screen if your league plays for money.', 'No hay pagos definidos. Defínelos en Clasificación si tu liga juega por dinero.')
        )
      case 'managers':
        return input.managers.orphanTeams.length ? (
          <>
            {t(
              `${input.managers.orphanTeams.join(', ')} ${input.managers.orphanTeams.length === 1 ? 'has' : 'have'} no manager. Fill ${input.managers.orphanTeams.length === 1 ? 'it' : 'them'} before the draft.`,
              `${input.managers.orphanTeams.join(', ')} no ${input.managers.orphanTeams.length === 1 ? 'tiene' : 'tienen'} mánager. Cúbrelos antes del draft.`,
            )}{' '}
            <a href="#workflow-replace-manager">{t('Replace a manager', 'Reemplazar a un mánager')}</a>
          </>
        ) : (
          t(`All ${input.managers.active} teams have a manager.`, `Los ${input.managers.active} equipos tienen mánager.`)
        )
      case 'dues':
        return (
          <label className="af-ch-rollover-field">
            <span>{t(`Dues for ${input.nextSeason} $`, `Cuota de ${input.nextSeason} $`)}</span>
            <input
              inputMode="decimal"
              className="w-24"
              value={dues}
              placeholder="0"
              disabled={!plan.canRenew}
              aria-label={t(`Dues for ${input.nextSeason}, in dollars`, `Cuota de ${input.nextSeason}, en dólares`)}
              onChange={(e) => setDues(e.target.value)}
              data-testid="rollover-dues"
            />
          </label>
        )
      case 'rules':
        return (
          <>
            {t('Scoring, rosters and every other rule carry over as they are.', 'La puntuación, las plantillas y las demás reglas se mantienen tal cual.')}{' '}
            <a href={leagueSettingsHomeHref(leagueId)}>{t('League settings', 'Ajustes de la liga')}</a>
          </>
        )
      case 'draft_order':
        return (
          <label className="af-ch-rollover-field">
            <select value={order} disabled={!plan.canRenew} onChange={(e) => setOrder(e.target.value as Order)} data-testid="rollover-order">
              <option value="standings">{t('Worst record picks first', 'El peor récord elige primero')}</option>
              <option value="reverse_standings">{t('Champion picks first', 'El campeón elige primero')}</option>
              <option value="random">{t('Random', 'Aleatorio')}</option>
            </select>
          </label>
        )
      case 'renew':
        if (input.renewed) return t(`Renewed: the league is set up for ${input.season}.`, `Renovada: la liga está lista para ${input.season}.`)
        if (!plan.canRenew) return t('Opens when the season is over.', 'Se abre cuando termine la temporada.')
        return (
          <>
            <p>
              {t(
                `Every roster is reset for a new draft, teams and managers stay${plan.willCancel.trades || plan.willCancel.claims ? `, and ${plan.willCancel.trades} pending trade${plan.willCancel.trades === 1 ? '' : 's'} and ${plan.willCancel.claims} waiver claim${plan.willCancel.claims === 1 ? '' : 's'} are cancelled` : ''}.`,
                `Todas las plantillas se vacían para un nuevo draft y los equipos y mánagers se quedan${plan.willCancel.trades || plan.willCancel.claims ? `; se cancelan ${plan.willCancel.trades} intercambio(s) y ${plan.willCancel.claims} reclamo(s) pendientes` : ''}.`,
              )}
            </p>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} data-testid="rollover-confirm" />
              <span>{t('I understand', 'Lo entiendo')}</span>
            </label>
            <button type="button" className="af-btn" data-primary="true" disabled={!confirmed || busy} onClick={() => void renew()} data-testid="rollover-renew">
              {busy ? t('Renewing…', 'Renovando…') : t(`Renew for ${input.nextSeason}`, `Renovar para ${input.nextSeason}`)}
            </button>
          </>
        )
    }
  }

  const STEP_TITLE: Record<RolloverStepKey, [string, string]> = {
    season: ['Finish the season', 'Terminar la temporada'],
    payouts: ['Settle payouts', 'Liquidar los pagos'],
    managers: ['Returning managers', 'Mánagers que vuelven'],
    dues: ['Next season’s dues', 'Cuota de la próxima temporada'],
    rules: ['Review the rules', 'Revisar las reglas'],
    draft_order: ['Draft order', 'Orden del draft'],
    renew: ['Renew the league', 'Renovar la liga'],
  }
  const announcement = view.extras ? (es ? view.extras.announcement.es : view.extras.announcement.en) : ''

  return (
    <section id="ch-rollover" className="af-card af-ch-section" aria-labelledby="ch-rollover-h" data-testid="rollover-wizard">
      <header className="af-ch-section-head">
        <h2 id="ch-rollover-h" className="af-label">{t('Next season', 'Próxima temporada')}</h2>
        <span className="af-ch-section-note">
          {input.renewed ? t(`Ready for ${input.season}`, `Lista para ${input.season}`) : `${input.season} → ${input.nextSeason}`}
        </span>
      </header>
      <ol className="af-ch-week-list">
        {plan.steps.map((s) => (
          <li key={s.key} className="af-ch-week-item" data-status={s.state} data-testid={`rollover-step-${s.key}`}>
            <span className="af-ch-week-mark" aria-hidden>{MARK[s.state]}</span>
            <div>
              <strong>{t(...STEP_TITLE[s.key])}</strong> <span className="af-ch-muted">· {t(...STATE_WORD[s.state])}</span>
              <div>{detail(s.key)}</div>
            </div>
          </li>
        ))}
      </ol>

      {view.extras ? (
        <div className="af-ch-rollover-extras" data-testid="rollover-extras">
          <p className="af-label">{t('AF Commissioner', 'AF Commissioner')}</p>
          {view.extras.payoutCarry ? (
            <p>
              {t(
                `Payouts use ${view.extras.payoutCarry.fromCents != null ? money(view.extras.payoutCarry.fromCents) : 'the entry fee'} as the buy-in; next season’s dues are ${money(view.extras.payoutCarry.toCents)}.`,
                `Los pagos usan ${view.extras.payoutCarry.fromCents != null ? money(view.extras.payoutCarry.fromCents) : 'la cuota de inscripción'} como cuota; la de la próxima temporada es ${money(view.extras.payoutCarry.toCents)}.`,
              )}{' '}
              <button type="button" className="af-btn" disabled={busy} onClick={() => void carry()} data-testid="rollover-carry">
                {t('Use the new dues', 'Usar la nueva cuota')}
              </button>
            </p>
          ) : null}
          <p className="af-ch-muted">{t('Your announcement, drafted. Edit it before you send.', 'Tu anuncio, ya redactado. Edítalo antes de enviarlo.')}</p>
          <blockquote data-testid="rollover-announcement">{announcement}</blockquote>
          <button type="button" className="af-btn" onClick={() => setAnnouncing(true)} data-testid="rollover-announce">
            {t('Send to the league', 'Enviar a la liga')}
          </button>
          <BroadcastModal open={announcing} onClose={() => setAnnouncing(false)} defaultLeagueId={leagueId} defaultMessage={announcement} />
        </div>
      ) : (
        <p className="af-ch-muted" data-testid="rollover-upsell">
          {t(
            'AF Commissioner drafts your “we’re back” announcement and carries next season’s dues into the payouts.',
            'AF Commissioner redacta tu anuncio de vuelta y lleva la cuota de la próxima temporada a los pagos.',
          )}{' '}
          <a href="/pricing">{t('See plans', 'Ver planes')}</a>
        </p>
      )}

      {message ? (
        <p role={message.ok ? 'status' : 'alert'} className={message.ok ? 'af-ch-muted' : undefined}>
          {message.text}
        </p>
      ) : null}
    </section>
  )
}
