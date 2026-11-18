'use client'

import { useEffect, useState } from 'react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'

/**
 * The manager's side of "Auto-switch injured starters" (owner decision 2026-11-18: the commissioner
 * turns it on, the manager is told and can turn it off). Shown on the manager's own Team tab only while
 * it is on for their team; renders nothing otherwise.
 *
 * Reads and writes `/api/leagues/[leagueId]/auto-switch-injured` (lib/lineup-automation).
 */
type Level = 'out' | 'doubtful' | 'questionable'
type Timing = 'pregame_90' | 'night_before'
type Mine = { rosterId: string | null; setting: { level: Level; timing: Timing } | null; ownerHasPro: boolean }

const COPY = {
  en: {
    title: 'Auto-switch injured starters is on',
    body: (l: string, t: string) => `Your commissioner turned this on for your team: a starter who ${l} is swapped for your best healthy bench player ${t}. Everything else in your lineup stays as you set it.`,
    levels: { out: 'is ruled out', doubtful: 'is doubtful or worse', questionable: 'is questionable or worse' } as Record<Level, string>,
    timings: { pregame_90: 'in the 90 minutes before his game', night_before: 'from 8pm Eastern the night before his game' } as Record<Timing, string>,
    needsPro: 'It runs only while you have AllFantasy Pro.',
    off: 'Turn off',
    saving: 'Turning off…',
    done: 'Turned off. Your commissioner can see that you did.',
    failed: 'Could not turn it off. Try again.',
  },
  es: {
    title: 'El cambio automático de titulares lesionados está activo',
    body: (l: string, t: string) => `Tu comisionado lo activó para tu equipo: un titular que ${l} se cambia por tu mejor suplente sano ${t}. El resto de tu alineación queda como la pusiste.`,
    levels: { out: 'queda descartado', doubtful: 'está en duda o peor', questionable: 'es cuestionable o peor' } as Record<Level, string>,
    timings: { pregame_90: 'en los 90 minutos antes de su partido', night_before: 'desde las 8pm (hora del Este) la noche antes de su partido' } as Record<Timing, string>,
    needsPro: 'Solo funciona mientras tengas AllFantasy Pro.',
    off: 'Desactivar',
    saving: 'Desactivando…',
    done: 'Desactivado. Tu comisionado puede ver que lo hiciste.',
    failed: 'No se pudo desactivar. Inténtalo de nuevo.',
  },
}

export function AutoSwitchOwnerCard({ leagueId }: { leagueId: string }) {
  const { language } = useOptionalLanguage()
  const c = language === 'es' ? COPY.es : COPY.en
  const [mine, setMine] = useState<Mine | null>(null)
  const [state, setState] = useState<'idle' | 'saving' | 'done' | 'failed'>('idle')
  const url = `/api/leagues/${encodeURIComponent(leagueId)}/auto-switch-injured`

  useEffect(() => {
    let cancelled = false
    fetch(url, { credentials: 'same-origin', cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((json: Mine | null) => {
        if (!cancelled && json) setMine(json)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [url])

  if (state === 'done') {
    return <p role="status" className="m-0 text-[13px] font-semibold" style={{ color: 'var(--lsk-text, var(--text))' }}>{c.done}</p>
  }
  if (!mine?.setting || !mine.rosterId) return null

  async function turnOff() {
    setState('saving')
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rosterId: mine!.rosterId, on: false }),
    }).catch(() => null)
    setState(res?.ok ? 'done' : 'failed')
  }

  return (
    <section
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3"
      style={{ border: '1px solid rgba(59,130,246,.45)', background: 'rgba(59,130,246,.08)' }}
      data-testid="auto-switch-owner-card"
    >
      <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-1">
        <h3 className="m-0 text-[15px] font-bold" style={{ color: 'var(--lsk-text, var(--text))' }}>{c.title}</h3>
        <p className="m-0 text-[13px] leading-relaxed" style={{ color: 'var(--lsk-muted, var(--muted))' }}>
          {c.body(c.levels[mine.setting.level], c.timings[mine.setting.timing])}
          {mine.ownerHasPro ? '' : ` ${c.needsPro}`}
        </p>
        {state === 'failed' ? <p role="alert" className="m-0 text-[13px] font-semibold" style={{ color: '#ff6b81' }}>{c.failed}</p> : null}
      </div>
      <button
        type="button"
        onClick={() => void turnOff()}
        disabled={state === 'saving'}
        className="min-h-[40px] rounded-full px-4 text-[13px] font-bold disabled:opacity-60"
        style={{ border: '1px solid var(--lsk-line, var(--line2))', color: 'var(--lsk-text, var(--text))', background: 'var(--lsk-surface2, var(--surface2))' }}
        data-testid="auto-switch-owner-off"
      >
        {state === 'saving' ? c.saving : c.off}
      </button>
    </section>
  )
}
