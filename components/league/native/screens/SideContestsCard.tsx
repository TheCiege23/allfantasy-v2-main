'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  CONTEST_KINDS,
  CONTEST_LABELS,
  formatPrize,
  type ContestKind,
  type SideContestsConfig,
  type SideContestsView,
} from '@/lib/side-contests/sideContests'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { Card } from './NativeScreenParts'

/**
 * Weekly side contests (lib/side-contests) on the standings screen: each finished week's high score
 * and closest loss, and the season's prize money per team. Every member sees it once the commissioner
 * turns a contest on; the commissioner sets them up here. Hidden for everyone else until then.
 * English and Spanish. A message the server sends back (a refused save) is shown as it comes.
 */
type Draft = Record<ContestKind, { enabled: boolean; prize: string }>

const toDraft = (c: SideContestsConfig): Draft => ({
  high_score: { enabled: c.high_score.enabled, prize: c.high_score.prizeCents ? (c.high_score.prizeCents / 100).toFixed(2) : '' },
  closest_loss: { enabled: c.closest_loss.enabled, prize: c.closest_loss.prizeCents ? (c.closest_loss.prizeCents / 100).toFixed(2) : '' },
})

const fmt = (n: number) => n.toFixed(2)

export function SideContestsCard({ leagueId }: { leagueId: string }) {
  const { language } = useOptionalLanguage()
  const es = language === 'es'
  const t = (en: string, esText: string) => (es ? esText : en)
  const label = (k: ContestKind) => (es ? CONTEST_LABELS[k].es : CONTEST_LABELS[k].en)
  const help = (k: ContestKind) => (es ? CONTEST_LABELS[k].helpEs : CONTEST_LABELS[k].helpEn)
  const url = `/api/leagues/${encodeURIComponent(leagueId)}/side-contests`
  const [view, setView] = useState<SideContestsView | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch(url, { cache: 'no-store' })
      if (!r.ok) return
      setView((await r.json()) as SideContestsView)
    } catch {
      // A side card: the standings still render without it.
    }
  }, [url])

  useEffect(() => {
    void load()
  }, [load])

  if (!view || !view.native) return null
  const anyOn = CONTEST_KINDS.some((k) => view.config[k].enabled)
  if (!anyOn && !view.canEdit) return null
  const hasPrizes = CONTEST_KINDS.some((k) => view.config[k].enabled && view.config[k].prizeCents > 0)

  const save = async () => {
    if (!draft) return
    setSaving(true)
    setMessage(null)
    try {
      const r = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      })
      const body = (await r.json().catch(() => ({}))) as { error?: string }
      if (!r.ok) {
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

  const latest = view.weeks[0] ?? null
  const earlier = view.weeks.slice(1)

  const weekLines = (w: SideContestsView['weeks'][number]) =>
    CONTEST_KINDS.filter((k) => w.contests[k]?.length).map((k) => {
      const winners = w.contests[k]!
      const names = winners.map((x) => x.teamName).join(t(' and ', ' y '))
      const what =
        k === 'high_score'
          ? t(`${fmt(winners[0].value)} points`, `${fmt(winners[0].value)} puntos`)
          : t('lost by ', 'perdió por ') +
            fmt(winners[0].value) +
            (winners.length === 1 && winners[0].opponentName ? t(` to ${winners[0].opponentName}`, ` ante ${winners[0].opponentName}`) : '')
      const prize = winners[0].prizeCents > 0 ? ` · ${formatPrize(Math.round(winners[0].prizeCents))}${winners.length > 1 ? t(' each', ' cada uno') : ''}` : ''
      return (
        <li key={k} data-testid={`side-contest-${k}`}>
          <strong>{label(k)}:</strong> {names}, {what}
          {winners.length > 1 ? t(' (tie)', ' (empate)') : ''}
          {prize}
        </li>
      )
    })

  return (
    <Card
      label={t('Weekly prizes', 'Premios semanales')}
      right={view.canEdit && !editing ? (
        <button type="button" className="nl-text-link" onClick={() => { setDraft(toDraft(view.config)); setEditing(true); setMessage(null) }}>
          {anyOn ? t('Edit', 'Editar') : t('Set up', 'Configurar')}
        </button>
      ) : null}
    >
      <div data-testid="side-contests">
        {editing && draft ? (
          <div className="space-y-3" data-testid="side-contests-edit">
            {CONTEST_KINDS.map((k) => (
              <fieldset key={k} className="space-y-1">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={draft[k].enabled}
                    onChange={(e) => setDraft({ ...draft, [k]: { ...draft[k], enabled: e.target.checked } })}
                    data-testid={`side-contest-toggle-${k}`}
                  />
                  <span>{label(k)}</span>
                </label>
                <p className="nls-muted">{help(k)}</p>
                {draft[k].enabled ? (
                  <label className="flex items-center gap-2">
                    <span>{t('Prize per week $', 'Premio por semana $')}</span>
                    <input
                      inputMode="decimal"
                      className="w-24"
                      placeholder="0"
                      value={draft[k].prize}
                      aria-label={t(`${label(k)} prize per week, in dollars`, `Premio por semana de ${label(k).toLowerCase()}, en dólares`)}
                      onChange={(e) => setDraft({ ...draft, [k]: { ...draft[k], prize: e.target.value } })}
                      data-testid={`side-contest-prize-${k}`}
                    />
                  </label>
                ) : null}
              </fieldset>
            ))}
            <p className="nls-muted">
              {t(
                'Regular-season weeks only, decided once every game is final. A tie splits the prize. AllFantasy tracks the money; it does not collect or pay it.',
                'Solo semanas de temporada regular, decididas cuando todos los partidos terminan. Un empate reparte el premio. AllFantasy lleva la cuenta del dinero; no lo cobra ni lo paga.',
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
        ) : !anyOn ? (
          <p className="nls-muted">
            {t(
              'Award a weekly high score and a closest loss, with a prize for each if your league plays for one.',
              'Premia la puntuación más alta de la semana y la derrota más ajustada, con un premio para cada una si tu liga juega por dinero.',
            )}
          </p>
        ) : !latest ? (
          <p className="nls-muted">{t('Winners appear here once the first week is final.', 'Los ganadores aparecen aquí cuando termine la primera semana.')}</p>
        ) : (
          <>
            <p className="nls-label">{t('Week', 'Semana')} {latest.week}</p>
            <ul className="space-y-1">{weekLines(latest)}</ul>
            {hasPrizes && view.totals.some((t) => t.prizeCents > 0) ? (
              <>
                <p className="nls-label pt-2">{t('Season prize money', 'Premios de la temporada')}</p>
                <dl className="nls-dl" data-testid="side-contest-totals">
                  {view.totals.filter((t) => t.prizeCents > 0).map((t) => (
                    <div key={t.rosterId}>
                      <dt>{t.teamName}</dt>
                      <dd className="nls-mono">{formatPrize(t.prizeCents)}</dd>
                    </div>
                  ))}
                </dl>
              </>
            ) : null}
            {earlier.length ? (
              <details>
                <summary>{t('Earlier weeks', 'Semanas anteriores')}</summary>
                {earlier.map((w) => (
                  <div key={w.week} className="pt-2">
                    <p className="nls-label">{t('Week', 'Semana')} {w.week}</p>
                    <ul className="space-y-1">{weekLines(w)}</ul>
                  </div>
                ))}
              </details>
            ) : null}
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
