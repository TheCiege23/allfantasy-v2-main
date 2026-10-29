'use client'

import { useCallback, useEffect, useState } from 'react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { CUSTOM_KINDS, CUSTOM_MAX, LABEL_MAX, type CustomKind } from '@/lib/deadline-autopilot/autopilot'
import type { AutopilotView } from '@/lib/deadline-autopilot/autopilotService'

/**
 * Deadline autopilot card (docs/AF_COMMISSIONER_SETTINGS_SPEC.md §3.5), on the Commissioner Hub.
 *
 * Free: the deadline list and "Remind now". Commissioner plan: the automatic 72 h / 24 h / 1 h
 * reminders. The route enforces both; this card only reflects what it was told.
 */

type Row = { id?: string; kind: CustomKind; label: string; local: string }

const KIND_LABEL: Record<CustomKind, [string, string]> = {
  trade: ['Trade deadline', 'Fecha límite de intercambios'],
  taxi: ['Taxi squad', 'Escuadrón taxi'],
  franchise_tag: ['Franchise tag', 'Franchise tag'],
  contract: ['Contracts', 'Contratos'],
  keeper: ['Keepers', 'Keepers'],
  other: ['Other', 'Otro'],
}

const ERRORS: Record<string, [string, string]> = {
  not_entitled: ['Automatic reminders are part of the AF Commissioner plan. "Remind now" stays free.', 'Los recordatorios automáticos son parte del plan AF Commissioner. «Recordar ahora» sigue siendo gratis.'],
  cooldown: ['A reminder for this deadline went out in the last 6 hours.', 'Ya se envió un recordatorio de esta fecha en las últimas 6 horas.'],
  no_recipients: ['Nobody left to remind — everyone has acted.', 'No queda nadie a quien recordar: todos ya actuaron.'],
  label_required: ['Give every deadline a name.', 'Ponle nombre a cada fecha límite.'],
  invalid_time: ['Pick a date and time for every deadline.', 'Elige fecha y hora para cada fecha límite.'],
  too_many: [`Up to ${CUSTOM_MAX} deadlines.`, `Hasta ${CUSTOM_MAX} fechas límite.`],
}

/** ISO → the value an <input type="datetime-local"> wants, in the viewer's own time zone. */
function toLocalInput(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function DeadlineAutopilot({ leagueId }: { leagueId: string }) {
  const { language } = useOptionalLanguage()
  const es = language === 'es'
  const t = (en: string, spanish: string) => (es ? spanish : en)
  const endpoint = `/api/commissioner/leagues/${encodeURIComponent(leagueId)}/deadline-autopilot`

  const [view, setView] = useState<AutopilotView | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const adopt = useCallback((v: AutopilotView) => {
    setView(v)
    setRows(v.custom.map((c) => ({ id: c.id, kind: c.kind, label: c.label, local: toLocalInput(c.at) })))
    setDirty(false)
  }, [])

  useEffect(() => {
    let live = true
    fetch(endpoint, { credentials: 'same-origin', cache: 'no-store' })
      .then(async (res) => {
        const body = await res.json().catch(() => null)
        if (!live) return
        if (res.ok && body) adopt(body as AutopilotView)
        else setMessage((body as { error?: string } | null)?.error ?? `HTTP ${res.status}`)
      })
      .catch((e) => live && setMessage(String(e)))
    return () => {
      live = false
    }
  }, [endpoint, adopt])

  const say = (code: string | undefined, status: number) => {
    const known = code ? ERRORS[code] : undefined
    setMessage(known ? t(known[0], known[1]) : code ?? t(`Could not save (${status}).`, `No se pudo guardar (${status}).`))
  }

  async function save(payload: Record<string, unknown>, done: string) {
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch(endpoint, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(payload) })
      const body = await res.json().catch(() => null)
      if (!res.ok) return say((body as { error?: string } | null)?.error, res.status)
      adopt(body as AutopilotView)
      setMessage(done)
    } finally {
      setBusy(false)
    }
  }

  async function remindNow(key: string) {
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ action: 'remind_now', key }) })
      const body = (await res.json().catch(() => null)) as { sent?: number; error?: string } | null
      if (!res.ok) return say(body?.error, res.status)
      setMessage(t(`Reminder sent to ${body?.sent ?? 0} managers.`, `Recordatorio enviado a ${body?.sent ?? 0} mánagers.`))
      const fresh = await fetch(endpoint, { credentials: 'same-origin', cache: 'no-store' })
      if (fresh.ok) adopt((await fresh.json()) as AutopilotView)
    } finally {
      setBusy(false)
    }
  }

  const edit = (i: number, patch: Partial<Row>) => {
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
    setDirty(true)
  }

  if (!view) {
    return <p className="af-ch-muted">{message ?? t('Loading deadlines…', 'Cargando fechas límite…')}</p>
  }

  return (
    <div className="af-ch-recipes" data-testid="deadline-autopilot">
      {!view.sendEnabled && view.enabled ? (
        <p className="af-ch-recipes-banner">
          {t(
            'Your choice is saved. Automatic reminders start once AllFantasy switches automated sending on. "Remind now" works today.',
            'Tu elección quedó guardada. Los recordatorios automáticos empiezan cuando AllFantasy active los envíos automáticos. «Recordar ahora» ya funciona.',
          )}
        </p>
      ) : null}

      <ul className="af-ch-recipe-list">
        <li data-on={view.enabled && view.entitled}>
          <div className="af-ch-recipe-body">
            <p className="af-ch-recipe-label">{t('Deadline autopilot', 'Piloto automático de fechas límite')}</p>
            <p className="af-ch-recipe-desc">
              {t(
                'Reminders 72 hours, 24 hours and 1 hour before every deadline below. Keeper reminders go only to managers who have not submitted; your own deadlines go to every manager.',
                'Recordatorios 72 horas, 24 horas y 1 hora antes de cada fecha límite de abajo. Los de keepers van solo a quien no los envió; tus fechas propias van a todos los mánagers.',
              )}
            </p>
            <p className="af-ch-recipe-meta">
              {view.entitled
                ? t('AF Commissioner · notifications to managers', 'AF Commissioner · notificaciones a los mánagers')
                : t('AF Commissioner plan — "Remind now" below is free', 'Plan AF Commissioner — «Recordar ahora» es gratis')}
            </p>
          </div>
          <label className="af-ch-switch">
            <input
              type="checkbox"
              role="switch"
              checked={view.enabled}
              disabled={busy || (!view.entitled && !view.enabled)}
              aria-label={t('Deadline autopilot', 'Piloto automático de fechas límite')}
              onChange={(e) => save({ enabled: e.target.checked }, e.target.checked ? t('Autopilot on.', 'Piloto automático activado.') : t('Autopilot off.', 'Piloto automático desactivado.'))}
            />
            <span aria-hidden className="af-ch-switch-track">
              <span className="af-ch-switch-thumb" />
            </span>
          </label>
        </li>

        {view.deadlines.length === 0 ? (
          <li>
            <p className="af-ch-recipe-desc">{t('No upcoming deadlines. Add one below.', 'No hay fechas límite próximas. Agrega una abajo.')}</p>
          </li>
        ) : (
          view.deadlines.map((d) => (
            <li key={d.key}>
              <div className="af-ch-recipe-body">
                <p className="af-ch-recipe-label">{d.kind === 'keeper' && d.targeted ? t('Keeper deadline', 'Fecha límite de keepers') : d.label}</p>
                <p className="af-ch-recipe-meta">
                  {new Date(d.at).toLocaleString(es ? 'es' : 'en', { dateStyle: 'medium', timeStyle: 'short' })} ·{' '}
                  {d.targeted
                    ? t(`${d.recipients} still to submit`, `${d.recipients} sin enviar`)
                    : t(`${d.recipients} managers`, `${d.recipients} mánagers`)}
                  {d.lastSent ? t(` · last reminder ${new Date(d.lastSent).toLocaleString()}`, ` · último recordatorio ${new Date(d.lastSent).toLocaleString('es')}`) : ''}
                </p>
              </div>
              <button type="button" className="af-btn" disabled={busy || !d.manualAllowed || d.recipients === 0} onClick={() => remindNow(d.key)}>
                {t('Remind now', 'Recordar ahora')}
              </button>
            </li>
          ))
        )}
      </ul>

      <h4 className="af-ch-recipe-label" style={{ marginTop: 16 }}>{t('Your deadlines', 'Tus fechas límite')}</h4>
      <p className="af-ch-recipe-desc">
        {t(
          'Add the deadlines AllFantasy cannot see — trade, taxi, franchise tag, contracts, or any deadline on the platform your league lives on. Times are in your time zone.',
          'Agrega las fechas límite que AllFantasy no puede ver: intercambios, taxi, franchise tag, contratos o cualquier fecha de la plataforma donde vive tu liga. Las horas están en tu zona horaria.',
        )}
      </p>
      <ul className="af-ch-recipe-list">
        {rows.map((r, i) => (
          <li key={r.id ?? `new-${i}`} style={{ gap: 8, flexWrap: 'wrap' }}>
            <select value={r.kind} disabled={busy} aria-label={t('Type', 'Tipo')} onChange={(e) => edit(i, { kind: e.target.value as CustomKind })}>
              {CUSTOM_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(...KIND_LABEL[k])}
                </option>
              ))}
            </select>
            <input value={r.label} maxLength={LABEL_MAX} disabled={busy} aria-label={t('Name', 'Nombre')} placeholder={t('e.g. Trade deadline', 'p. ej. Fecha límite de intercambios')} onChange={(e) => edit(i, { label: e.target.value })} />
            <input type="datetime-local" value={r.local} disabled={busy} aria-label={t('Date and time', 'Fecha y hora')} onChange={(e) => edit(i, { local: e.target.value })} />
            <button type="button" className="af-btn" disabled={busy} onClick={() => { setRows(rows.filter((_, j) => j !== i)); setDirty(true) }}>
              {t('Remove', 'Quitar')}
            </button>
          </li>
        ))}
      </ul>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button
          type="button"
          className="af-btn"
          disabled={busy || rows.length >= CUSTOM_MAX}
          onClick={() => {
            setRows([...rows, { kind: 'trade', label: t('Trade deadline', 'Fecha límite de intercambios'), local: '' }])
            setDirty(true)
          }}
        >
          {t('Add a deadline', 'Agregar fecha límite')}
        </button>
        <button
          type="button"
          className="af-btn"
          disabled={busy || !dirty}
          onClick={() =>
            save(
              { custom: rows.map((r) => ({ id: r.id, kind: r.kind, label: r.label, at: r.local ? new Date(r.local).toISOString() : '' })) },
              t('Deadlines saved.', 'Fechas límite guardadas.'),
            )
          }
        >
          {t('Save deadlines', 'Guardar fechas límite')}
        </button>
      </div>
      {message ? (
        <p role="status" className="af-ch-recipe-error">
          {message}
        </p>
      ) : null}
    </div>
  )
}
