'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { tInterpolate } from '@/lib/i18n/tInterpolate'

type PastSession = {
  id: string
  status: string
  createdAt: string
  mergedAt: string | null
  sources: Array<{ id: string; sourceType: string; sourcePlatform: string | null; classification: string | null; connectionStatus: string }>
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; sessions: PastSession[] }
  | { kind: 'forbidden' }
  | { kind: 'error' }

/**
 * Commissioner settings → Import. The list doubles as the commissioner check: the sessions route
 * answers 403 to anyone who is not the league's commissioner or co-commissioner, and only a
 * commissioner gets the link into the wizard.
 */
export function DevyImportPanel({ leagueId }: { leagueId: string }) {
  const { t, language } = useOptionalLanguage()
  const tr = useCallback((key: string, vars?: Record<string, string | number>) => tInterpolate(t, key, vars ?? {}), [t])
  const [state, setState] = useState<LoadState>({ kind: 'loading' })

  const load = useCallback(async () => {
    setState({ kind: 'loading' })
    try {
      const r = await fetch(`/api/devy/import?leagueId=${encodeURIComponent(leagueId)}`, { credentials: 'include' })
      if (r.status === 401 || r.status === 403) {
        setState({ kind: 'forbidden' })
        return
      }
      if (!r.ok) throw new Error(String(r.status))
      const j = (await r.json()) as { sessions?: PastSession[] }
      setState({ kind: 'ready', sessions: j.sessions ?? [] })
    } catch {
      setState({ kind: 'error' })
    }
  }, [leagueId])

  useEffect(() => {
    void load()
  }, [load])

  const wizardHref = `/devy/${encodeURIComponent(leagueId)}/import`
  const fmtDate = (iso: string) => {
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(language === 'es' ? 'es' : 'en', { dateStyle: 'medium' } as Intl.DateTimeFormatOptions)
  }

  return (
    <div className="space-y-5 px-4 py-5 text-[13px] text-white/85 md:px-6" data-testid="devy-import-panel">
      <div>
        {state.kind === 'ready' ? (
          <Link
            href={wizardHref}
            className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-cyan-500/40 bg-cyan-500/15 px-4 py-2 text-[13px] font-semibold text-cyan-100"
            data-testid="devy-open-import-wizard"
          >
            {tr('devyImport.panel.open')}
          </Link>
        ) : (
          <button
            type="button"
            disabled
            className="inline-flex min-h-[44px] cursor-not-allowed items-center justify-center rounded-xl border border-white/[0.1] bg-white/[0.04] px-4 py-2 text-[13px] font-semibold text-white/40"
            data-testid="devy-open-import-wizard"
          >
            {tr('devyImport.panel.open')}
          </button>
        )}
        <p className="mt-2 text-[12px] text-white/55">{tr('devyImport.panel.intro')}</p>
        {state.kind === 'forbidden' ? (
          <p className="mt-2 text-[12px] text-amber-200/80" data-testid="devy-import-forbidden">
            {tr('devyImport.panel.commissionerOnly')}
          </p>
        ) : null}
      </div>

      {state.kind !== 'forbidden' ? (
        <section className="rounded-xl border border-white/[0.08] bg-[#0a1228] p-4">
          <h3 className="text-[12px] font-bold uppercase tracking-wide text-white/80">{tr('devyImport.panel.pastTitle')}</h3>
          {state.kind === 'loading' ? (
            <p className="mt-2 text-[12px] text-white/50" role="status">
              {tr('devyImport.loading')}
            </p>
          ) : state.kind === 'error' ? (
            <div className="mt-2 text-[12px] text-red-200" role="alert" data-testid="devy-import-panel-error">
              <p>{tr('devyImport.error.generic')}</p>
              <button type="button" onClick={() => void load()} className="mt-1 min-h-[36px] font-semibold underline">
                {tr('devyImport.retry')}
              </button>
            </div>
          ) : state.sessions.length === 0 ? (
            <p className="mt-2 text-[12px] text-white/50" data-testid="devy-import-panel-empty">
              {tr('devyImport.panel.pastEmpty')}
            </p>
          ) : (
            <ul className="mt-2 space-y-2" data-testid="devy-import-sessions">
              {state.sessions.map(s => (
                <li key={s.id} className="rounded-lg border border-white/[0.06] bg-black/20 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-white">{tr('devyImport.panel.startedOn', { date: fmtDate(s.createdAt) })}</span>
                    <span className="text-[11px] text-white/55">{tr(`devyImport.status.${s.status}`)}</span>
                  </div>
                  <p className="mt-1 text-[11px] text-white/50">
                    {s.sources.length === 0
                      ? tr('devyImport.panel.noSources')
                      : s.sources
                          .map(src => tr(`devyImport.platform.${src.sourcePlatform === 'sleeper' ? 'sleeper' : src.sourceType === 'csv_upload' ? 'csv' : 'other'}`))
                          .join(' · ')}
                  </p>
                  <Link
                    href={`${wizardHref}?sessionId=${encodeURIComponent(s.id)}`}
                    className="mt-2 inline-flex min-h-[36px] items-center text-[12px] font-semibold text-cyan-200 underline"
                    data-testid={`devy-import-session-${s.id}`}
                  >
                    {s.status === 'merged' ? tr('devyImport.panel.viewAudit') : tr('devyImport.panel.resume')}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  )
}
