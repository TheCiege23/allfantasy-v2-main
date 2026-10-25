'use client'

/**
 * The league log (lib/league-log/leagueLog.ts): every commissioner action in plain words. Members
 * read it unless the commissioner set it to "commish only"; the commissioner sees every row, can
 * open the raw details, and sets who may read it. GET/PUT /api/leagues/:id/league-log.
 */
import { useCallback, useEffect, useState } from 'react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { LOG_CATEGORY_LABELS, type LeagueLogEntry, type LeagueLogVisibility, type LogCategory } from '@/lib/league-log/leagueLog'

const COPY = {
  en: {
    title: 'League log',
    hint: 'Every commissioner action, newest first.',
    all: 'All',
    empty: 'Nothing logged yet.',
    hidden: 'The commissioner keeps the league log private.',
    error: 'Could not load the league log.',
    more: 'Show more',
    loading: 'Loading…',
    details: 'Details',
    whoSees: 'Who can see the log',
    league: 'Whole league',
    commishOnly: 'Commish only',
    saveFailed: 'Could not change who sees the log.',
    by: 'by',
  },
  es: {
    title: 'Registro de la liga',
    hint: 'Cada acción del comisionado, de la más reciente a la más antigua.',
    all: 'Todo',
    empty: 'Aún no hay nada registrado.',
    hidden: 'El comisionado mantiene privado el registro de la liga.',
    error: 'No se pudo cargar el registro de la liga.',
    more: 'Ver más',
    loading: 'Cargando…',
    details: 'Detalles',
    whoSees: 'Quién puede ver el registro',
    league: 'Toda la liga',
    commishOnly: 'Solo el comisionado',
    saveFailed: 'No se pudo cambiar quién ve el registro.',
    by: 'por',
  },
} as const

type Payload = {
  canManage: boolean
  visibility: LeagueLogVisibility
  hidden: boolean
  entries: LeagueLogEntry[]
  nextCursor: string | null
}

const CATEGORIES = Object.keys(LOG_CATEGORY_LABELS) as LogCategory[]

export function LeagueLog({ leagueId, refreshSignal = 0 }: { leagueId: string; refreshSignal?: number }) {
  const { language } = useOptionalLanguage()
  const lang = language === 'es' ? 'es' : 'en'
  const c = COPY[lang]
  const [category, setCategory] = useState<LogCategory | null>(null)
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(
    async (cursor: string | null) => {
      setLoading(true)
      setError(null)
      try {
        const qs = new URLSearchParams({ lang })
        if (category) qs.set('category', category)
        if (cursor) qs.set('cursor', cursor)
        const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/league-log?${qs}`)
        if (!res.ok) throw new Error(String(res.status))
        const next = (await res.json()) as Payload
        setData((prev) => (cursor && prev ? { ...next, entries: [...prev.entries, ...next.entries] } : next))
      } catch {
        setError(c.error)
      } finally {
        setLoading(false)
      }
    },
    [leagueId, lang, category, c.error],
  )

  useEffect(() => {
    void load(null)
  }, [load, refreshSignal])

  const setVisibility = async (visibility: LeagueLogVisibility) => {
    if (!data || visibility === data.visibility) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/league-log`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visibility }),
      })
      if (!res.ok) throw new Error(String(res.status))
      setData({ ...data, visibility })
    } catch {
      setError(c.saveFailed)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="rounded-2xl border border-white/[0.08] bg-[#0a1228]/90 p-4" data-testid="league-log">
      <h2 className="text-[13px] font-bold uppercase tracking-wide text-white/60">{c.title}</h2>
      <p className="mt-1 text-[12px] text-white/45">{c.hint}</p>

      {data?.canManage ? (
        <fieldset className="mt-3 flex flex-wrap items-center gap-2" data-testid="league-log-visibility">
          <legend className="mb-1 w-full text-[11px] text-white/50">{c.whoSees}</legend>
          {(['league', 'commish_only'] as const).map((v) => (
            <button
              key={v}
              type="button"
              disabled={saving}
              aria-pressed={data.visibility === v}
              onClick={() => void setVisibility(v)}
              className={`rounded-full border px-3 py-1 text-[12px] ${
                data.visibility === v ? 'border-cyan-300/60 bg-cyan-400/15 text-cyan-100' : 'border-white/10 text-white/60'
              }`}
            >
              {v === 'league' ? c.league : c.commishOnly}
            </button>
          ))}
        </fieldset>
      ) : null}

      {data && !data.hidden ? (
        <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label={c.title}>
          {[null, ...CATEGORIES].map((cat) => (
            <button
              key={cat ?? 'all'}
              type="button"
              aria-pressed={category === cat}
              onClick={() => setCategory(cat)}
              className={`rounded-full border px-2.5 py-0.5 text-[11px] ${
                category === cat ? 'border-white/40 bg-white/10 text-white' : 'border-white/10 text-white/55'
              }`}
            >
              {cat ? LOG_CATEGORY_LABELS[cat][lang] : c.all}
            </button>
          ))}
        </div>
      ) : null}

      {error ? <p className="mt-3 text-[12px] text-red-300/90">{error}</p> : null}
      {data?.hidden ? <p className="mt-3 text-[13px] text-white/60" data-testid="league-log-hidden">{c.hidden}</p> : null}
      {data && !data.hidden && data.entries.length === 0 && !loading ? (
        <p className="mt-3 text-[12px] text-white/45">{c.empty}</p>
      ) : null}

      {data && !data.hidden && data.entries.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {data.entries.map((e) => (
            <li key={e.id} className="rounded-xl border border-white/[0.06] bg-black/20 px-3 py-2" data-testid="league-log-entry">
              <p className="text-[13px] text-white/90">{e.title}</p>
              {e.detail ? <p className="mt-0.5 text-[12px] text-white/60">“{e.detail}”</p> : null}
              <p className="mt-1 text-[11px] text-white/40">
                {new Date(e.at).toLocaleString(lang === 'es' ? 'es' : 'en')} · {c.by} {e.actor}
                {e.category ? ` · ${LOG_CATEGORY_LABELS[e.category][lang]}` : ''}
              </p>
              {e.raw ? (
                <details className="mt-1">
                  <summary className="cursor-pointer text-[11px] text-white/40">{c.details}</summary>
                  <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all text-[11px] leading-snug text-white/45">
                    {JSON.stringify(e.raw, null, 1)}
                  </pre>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {loading ? <p className="mt-3 text-[12px] text-white/50">{c.loading}</p> : null}
      {data?.nextCursor && !loading ? (
        <button type="button" onClick={() => void load(data.nextCursor)} className="mt-3 text-[12px] font-semibold text-cyan-300 underline">
          {c.more}
        </button>
      ) : null}
    </section>
  )
}
