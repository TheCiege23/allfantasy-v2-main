'use client'

import { useCallback, useEffect, useState } from 'react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { ABSENT_LIMITS, type AbsentManagerRule } from '@/lib/draft-day/absentManager'
import type { ShowKind, ShowPace } from '@/lib/draft-day/draftShow'
import type { DraftDayView } from '@/lib/draft-day/draftDayService'

/**
 * Draft-day kit (docs/AF_COMMISSIONER_SETTINGS_SPEC.md §3, idea 9), in Draft settings:
 * start the order reveal / lottery show, print the board, and the absent-manager rule.
 * Keeper pre-fill and auto-pick for absent managers were already in the draft room.
 */

type Copy = (en: string, es: string) => string

const ERRORS: Record<string, [string, string]> = {
  draft_started: ['The draft has already started — the show is for before the first pick.', 'El draft ya empezó: el show es para antes de la primera selección.'],
  order_incomplete: ['Set a full draft order first (randomize, lottery or by hand).', 'Primero define un orden completo del draft (aleatorio, lotería o a mano).'],
  no_lottery: ['Run the draft lottery first.', 'Primero ejecuta la lotería del draft.'],
  lottery_stale: ['The draft order has changed since the lottery ran, so the draw is not the order the draft will use.', 'El orden del draft cambió desde la lotería, así que el sorteo no es el orden que usará el draft.'],
}

export function DraftDayKit({ leagueId, isCommissioner }: { leagueId: string; isCommissioner: boolean }) {
  const { language } = useOptionalLanguage()
  const t: Copy = (en, es) => (language === 'es' ? es : en)
  const [view, setView] = useState<DraftDayView | null>(null)
  const [kind, setKind] = useState<ShowKind>('order')
  const [pace, setPace] = useState<ShowPace>('standard')
  const [rule, setRule] = useState<AbsentManagerRule | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const url = `/api/leagues/${encodeURIComponent(leagueId)}/draft-day`

  const apply = useCallback((v: DraftDayView) => {
    if (!v || typeof v !== 'object' || !v.canStartShow || !v.absentRule) return
    setView(v)
    setRule(v.absentRule)
    if (!v.canStartShow.lottery) setKind('order')
  }, [])

  useEffect(() => {
    let live = true
    // Never rejects: a failed read leaves the card hidden.
    fetch(url, { credentials: 'same-origin', cache: 'no-store' })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as DraftDayView | null
        if (live && res.ok && body) apply(body)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [url, apply])

  const post = async (payload: Record<string, unknown>, done: string) => {
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const body = (await res.json().catch(() => null)) as (DraftDayView & { error?: string }) | null
      if (res.ok && body) {
        apply(body)
        setMessage(done)
      } else {
        const e = ERRORS[String(body?.error ?? '')]
        setMessage(e ? t(e[0], e[1]) : t('That did not work. Try again.', 'No funcionó. Inténtalo de nuevo.'))
      }
    } catch {
      setMessage(t('That did not work. Try again.', 'No funcionó. Inténtalo de nuevo.'))
    } finally {
      setBusy(false)
    }
  }

  if (!view?.sessionId) return null
  const canShow = view.canStartShow.order || view.canStartShow.lottery

  return (
    <section className="af-ls-card space-y-3" data-testid="draft-day-kit">
      <div>
        <h4 className="text-[13px] font-semibold text-white">{t('Draft-day kit', 'Kit del día del draft')}</h4>
        <p className="mt-0.5 text-[11px] text-white/40">
          {t('Keepers are placed on the board and absent managers are auto-picked in the draft room.', 'Los keepers se colocan en el tablero y los mánagers ausentes se eligen automáticamente en la sala del draft.')}
        </p>
      </div>

      <a href={`/drafts/${encodeURIComponent(view.sessionId)}/print`} target="_blank" rel="noopener noreferrer" className="inline-block rounded-lg border border-white/15 px-3 py-2 text-[13px] font-semibold text-white/85 hover:text-white">
        {t('Print the draft board', 'Imprimir el tablero del draft')}
      </a>

      {isCommissioner && (
        <div className="space-y-2 rounded-xl border border-white/10 p-3">
          <p className="text-[13px] font-semibold text-white/90">{t('Order reveal show', 'Show de revelación del orden')}</p>
          <p className="text-[11px] text-white/40">
            {t('Everyone in the draft room watches the order revealed from the last pick up to #1, together.', 'Todos en la sala del draft ven el orden revelado desde la última selección hasta la #1, a la vez.')}
          </p>
          {view.show ? (
            <button type="button" disabled={busy} onClick={() => void post({ action: 'stop_show' }, t('Show stopped.', 'Show detenido.'))} className="w-full rounded-lg border border-white/15 px-3 py-2 text-[13px] font-semibold text-white/85 disabled:opacity-50">
              {t('Stop the show', 'Detener el show')}
            </button>
          ) : canShow ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <select aria-label={t('Show', 'Show')} value={kind} onChange={(e) => setKind(e.target.value as ShowKind)} className="min-w-0 rounded-lg border border-white/15 bg-[#0d1526] px-2 py-2 text-sm text-white">
                  <option value="order">{t('Draft order', 'Orden del draft')}</option>
                  {view.canStartShow.lottery && <option value="lottery">{t('Lottery draw', 'Sorteo de lotería')}</option>}
                </select>
                <select aria-label={t('Pace', 'Ritmo')} value={pace} onChange={(e) => setPace(e.target.value as ShowPace)} className="min-w-0 rounded-lg border border-white/15 bg-[#0d1526] px-2 py-2 text-sm text-white">
                  <option value="quick">{t('Quick', 'Rápido')}</option>
                  <option value="standard">{t('Standard', 'Normal')}</option>
                  <option value="dramatic">{t('Dramatic', 'Dramático')}</option>
                </select>
              </div>
              <button type="button" disabled={busy} onClick={() => void post({ action: 'start_show', kind, pace }, t('The show is live in the draft room.', 'El show está en vivo en la sala del draft.'))} className="w-full rounded-lg bg-cyan-600/80 px-3 py-2 text-[13px] font-semibold text-white hover:bg-cyan-600 disabled:opacity-50">
                {t('Start the show', 'Empezar el show')}
              </button>
            </>
          ) : (
            <p className="text-[11px] text-amber-300/80">
              {view.status && !['pre_draft', 'configuring', 'configured'].includes(view.status)
                ? t(ERRORS.draft_started[0], ERRORS.draft_started[1])
                : t(ERRORS.order_incomplete[0], ERRORS.order_incomplete[1])}
            </p>
          )}
        </div>
      )}

      {isCommissioner && rule && (
        <div className="space-y-2 rounded-xl border border-white/10 p-3">
          <label className="flex items-center justify-between gap-3">
            <span className="text-[13px] font-semibold text-white/90">{t('Absent-manager clock', 'Reloj para mánagers ausentes')}</span>
            <input type="checkbox" checked={rule.enabled} onChange={(e) => setRule({ ...rule, enabled: e.target.checked })} className="h-5 w-5" />
          </label>
          <p className="text-[11px] text-white/40">
            {t(
              `After ${rule.missedPicks} auto-pick${rule.missedPicks === 1 ? '' : 's'} in a row, that team gets ${rule.seconds} seconds per pick until the manager picks again — so one no-show does not cost the room the full clock all draft.`,
              `Tras ${rule.missedPicks} selección${rule.missedPicks === 1 ? '' : 'es'} automática${rule.missedPicks === 1 ? '' : 's'} seguida${rule.missedPicks === 1 ? '' : 's'}, ese equipo tiene ${rule.seconds} segundos por selección hasta que el mánager vuelva a elegir, para que una ausencia no cueste el reloj completo todo el draft.`,
            )}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <label className="block min-w-0 text-[11px] text-white/50">
              {t('Missed picks', 'Selecciones perdidas')}
              <input type="number" min={ABSENT_LIMITS.missedPicks.min} max={ABSENT_LIMITS.missedPicks.max} value={rule.missedPicks} onChange={(e) => setRule({ ...rule, missedPicks: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-white/15 bg-[#0d1526] px-2 py-2 text-sm text-white" />
            </label>
            <label className="block min-w-0 text-[11px] text-white/50">
              {t('Seconds per pick', 'Segundos por selección')}
              <input type="number" min={ABSENT_LIMITS.seconds.min} max={ABSENT_LIMITS.seconds.max} value={rule.seconds} onChange={(e) => setRule({ ...rule, seconds: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-white/15 bg-[#0d1526] px-2 py-2 text-sm text-white" />
            </label>
          </div>
          <button type="button" disabled={busy} onClick={() => void post({ action: 'save_absent_rule', rule }, t('Saved.', 'Guardado.'))} className="w-full rounded-lg border border-white/15 px-3 py-2 text-[13px] font-semibold text-white/85 disabled:opacity-50">
            {t('Save', 'Guardar')}
          </button>
        </div>
      )}

      {message && <p role="status" className="text-[12px] text-white/70">{message}</p>}
    </section>
  )
}
