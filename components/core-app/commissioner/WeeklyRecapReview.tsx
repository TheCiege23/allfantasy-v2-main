'use client'

import { useCallback, useEffect, useState } from 'react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { RECAP_TEXT_MAX, type RecapDraft, type RecapReviewSettings } from '@/lib/recap-review/recapReview'

/**
 * Weekly recap review card (docs/AF_COMMISSIONER_SETTINGS_SPEC.md §3, idea 6), on the Commissioner Hub.
 * Auto keeps today's behaviour; Review holds Tuesday's recap here for the commissioner to edit and post.
 */

type View = { review: RecapReviewSettings; chimmySpeaksUp: boolean; draft: RecapDraft | null }

const ERRORS: Record<string, [string, string]> = {
  chimmy_quiet: ['Chimmy is switched off for this league, so the recap cannot post. Turn Chimmy back on under Automations.', 'Chimmy está apagado en esta liga, así que el resumen no puede publicarse. Vuelve a activarlo en Automatizaciones.'],
  already_posted: ['This week’s recap is already in league chat.', 'El resumen de esta semana ya está en el chat de la liga.'],
  not_pending: ['This recap was already posted or discarded.', 'Este resumen ya se publicó o se descartó.'],
  text_required: ['The recap cannot be empty. Discard it instead.', 'El resumen no puede quedar vacío. Descártalo.'],
}

export function WeeklyRecapReview({ leagueId }: { leagueId: string }) {
  const { language } = useOptionalLanguage()
  const es = language === 'es'
  const t = (en: string, spanish: string) => (es ? spanish : en)
  const endpoint = `/api/commissioner/leagues/${encodeURIComponent(leagueId)}/weekly-recap`

  const [view, setView] = useState<View | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(endpoint, { credentials: 'same-origin', cache: 'no-store' })
    const body = (await res.json().catch(() => null)) as View | { error?: string } | null
    if (!res.ok || !body || !('review' in body)) return setMessage((body as { error?: string } | null)?.error ?? `HTTP ${res.status}`)
    setView(body)
    setText(body.draft ? (body.draft.editedText ?? body.draft.generatedText) : '')
  }, [endpoint])

  useEffect(() => {
    void load()
  }, [load])

  async function call(method: 'PUT' | 'POST', payload: Record<string, unknown>, done: string) {
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch(endpoint, { method, headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(payload) })
      const body = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        const known = body?.error ? ERRORS[body.error] : undefined
        setMessage(known ? t(known[0], known[1]) : body?.error ?? `HTTP ${res.status}`)
        return
      }
      setMessage(done)
      await load()
    } finally {
      setBusy(false)
    }
  }

  if (!view) return <p className="af-ch-muted">{message ?? t('Loading…', 'Cargando…')}</p>
  const { review, draft } = view
  const at = draft ? { season: draft.season, week: draft.week } : null

  return (
    <div className="af-ch-recipes" data-testid="weekly-recap-review">
      <ul className="af-ch-recipe-list">
        <li data-on={review.mode === 'review'}>
          <div className="af-ch-recipe-body">
            <p className="af-ch-recipe-label">{t('Review the weekly recap before it posts', 'Revisar el resumen semanal antes de publicarlo')}</p>
            <p className="af-ch-recipe-desc">
              {t(
                'Tuesday’s recap waits here instead of posting. Fix a name, add a line about the week, then post it to league chat as Chimmy.',
                'El resumen del martes espera aquí en lugar de publicarse. Corrige un nombre, agrega una línea sobre la semana y publícalo en el chat como Chimmy.',
              )}
            </p>
            {review.mode === 'review' && (
              <label className="af-ch-recipe-meta" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={review.autoPostIfUntouched}
                  disabled={busy}
                  onChange={(e) => call('PUT', { mode: 'review', autoPostIfUntouched: e.target.checked }, t('Saved.', 'Guardado.'))}
                />
                {t('If I don’t get to it, post it Wednesday morning as written', 'Si no llego, publicarlo el miércoles por la mañana tal cual')}
              </label>
            )}
          </div>
          <label className="af-ch-switch">
            <input
              type="checkbox"
              role="switch"
              checked={review.mode === 'review'}
              disabled={busy}
              aria-label={t('Review the weekly recap before it posts', 'Revisar el resumen semanal antes de publicarlo')}
              onChange={(e) =>
                call('PUT', { mode: e.target.checked ? 'review' : 'auto', autoPostIfUntouched: review.autoPostIfUntouched }, e.target.checked ? t('Recaps will wait for you.', 'Los resúmenes te esperarán.') : t('Recaps post automatically again.', 'Los resúmenes vuelven a publicarse solos.'))
              }
            />
            <span aria-hidden className="af-ch-switch-track">
              <span className="af-ch-switch-thumb" />
            </span>
          </label>
        </li>
      </ul>

      {!view.chimmySpeaksUp && (
        <p className="af-ch-recipes-banner">{t('Chimmy is switched off for this league, so no recap is written or posted.', 'Chimmy está apagado en esta liga, así que no se escribe ni publica ningún resumen.')}</p>
      )}

      {draft && at ? (
        <div style={{ marginTop: 12 }}>
          <p className="af-ch-recipe-label">{t(`Week ${draft.week} recap — waiting for you`, `Resumen de la semana ${draft.week}: te espera`)}</p>
          <textarea
            className="w-full rounded-lg bg-black/30 p-2 text-sm"
            style={{ marginTop: 8, minHeight: 220, fontFamily: 'inherit' }}
            maxLength={RECAP_TEXT_MAX}
            value={text}
            disabled={busy}
            onChange={(e) => setText(e.target.value)}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <button type="button" className="af-btn" disabled={busy || !text.trim()} onClick={() => call('POST', { action: 'post', ...at, text }, t('Posted to league chat.', 'Publicado en el chat de la liga.'))}>
              {t('Post to league chat', 'Publicar en el chat')}
            </button>
            <button type="button" className="af-btn" disabled={busy || !text.trim()} onClick={() => call('POST', { action: 'save', ...at, text }, t('Edit saved. It will not post until you post it.', 'Cambios guardados. No se publicará hasta que lo publiques.'))}>
              {t('Save edit', 'Guardar cambios')}
            </button>
            <button type="button" className="af-btn" disabled={busy} onClick={() => setText(draft.generatedText)}>
              {t('Reset to original', 'Volver al original')}
            </button>
            <button type="button" className="af-btn" disabled={busy} onClick={() => call('POST', { action: 'discard', ...at }, t('Discarded. Nothing posts this week.', 'Descartado. Esta semana no se publica nada.'))}>
              {t('Skip this week', 'Saltar esta semana')}
            </button>
          </div>
        </div>
      ) : review.mode === 'review' ? (
        <p className="af-ch-recipe-desc" style={{ marginTop: 8 }}>{t('No recap waiting. The next one arrives Tuesday afternoon.', 'No hay resumen pendiente. El próximo llega el martes por la tarde.')}</p>
      ) : null}

      {message && <p role="status" className="af-ch-recipe-error">{message}</p>}
    </div>
  )
}
