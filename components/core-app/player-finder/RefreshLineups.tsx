'use client'

import { useState } from 'react'

import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'
import { LOCK_ZONE } from '@/lib/core-app/lineupLock'
import '@/components/core-app/af-refresh-lineups.css'

/**
 * "Lineups as of 11:52a ET · Refresh my lineups" — on the game-day list's header.
 *
 * ⚠ THE STAMP IS THE OLDEST LINEUP READ, NOT THE NEWEST. The list is only as current as its
 * stalest league; a newest-first stamp would say "just now" over a league last seen at 9am.
 *
 * The button posts to /api/core/players/refresh-lineups until nothing remains (each post is one
 * time-boxed batch — see lib/import-os/collector/lineupRefresh.ts), then reloads so the list is
 * re-read from the refreshed rosters. A plain reload rather than the app router: this component
 * also renders in tests and pages with no router mounted.
 */

export function asOfLabel(iso: string | null | undefined, nowIso: string): string | null {
  if (!iso) return null
  const at = new Date(iso)
  const now = new Date(nowIso)
  if (Number.isNaN(at.getTime()) || Number.isNaN(now.getTime())) return null
  const mins = Math.max(0, Math.floor((now.getTime() - at.getTime()) / 60_000))
  const clock = (() => {
    try {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: LOCK_ZONE, hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(at)
      const get = (t: Intl.DateTimeFormatPart['type']) => parts.find((p) => p.type === t)?.value ?? ''
      return `${get('hour')}:${get('minute')}${get('dayPeriod').toLowerCase().startsWith('p') ? 'p' : 'a'} ET`
    } catch {
      return ''
    }
  })()
  const ago = mins < 1 ? 'just now' : mins < 60 ? `${mins} min ago` : mins < 24 * 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m ago` : `${Math.floor(mins / (24 * 60))}d ago`
  return mins < 24 * 60 && clock ? `Lineups as of ${clock} · ${ago}` : `Lineups as of ${ago}`
}

type Batch = { total: number; remaining: number; refreshed: number; busy: number; skipped: number; failed: number }

const MAX_ROUNDS = 8

export function RefreshLineups({ asOf, nowIso }: { asOf: string | null | undefined; nowIso: string }) {
  const [state, setState] = useState<{ phase: 'idle' | 'running' | 'error'; note?: string }>({ phase: 'idle' })
  /* The stamp and notes are built in English (asOfLabel is shared and tested as such) and translated here. */
  const { language } = useOptionalLanguage()
  const copy = (english: string) => coreUiCopy(english, language)
  const stamp = asOfLabel(asOf, nowIso)

  const run = async () => {
    setState({ phase: 'running', note: 'Refreshing your lineups…' })
    let done = 0
    let failed = 0
    try {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const res = await fetch('/api/core/players/refresh-lineups', { method: 'POST' })
        if (res.status === 429) break // just refreshed — reload what we have
        if (!res.ok) throw new Error(String(res.status))
        const b = (await res.json()) as Batch
        done += b.refreshed + b.busy
        failed += b.failed
        if (b.remaining <= 0) break
        setState({ phase: 'running', note: `Refreshing your lineups… ${done} of ${b.total}` })
      }
      if (failed > 0) setState({ phase: 'running', note: `${failed} ${failed === 1 ? 'league' : 'leagues'} could not be refreshed — reloading the rest` })
      window.location.reload()
    } catch {
      setState({ phase: 'error', note: 'Could not refresh right now. Your platforms are still the source of truth.' })
    }
  }

  return (
    <div className="af-pf-refresh" data-phase={state.phase}>
      {stamp ? <span className="af-pf-refresh-asof af-num">{copy(stamp)}</span> : null}
      <button type="button" className="af-pf-refresh-btn" onClick={run} disabled={state.phase === 'running'} aria-busy={state.phase === 'running'}>
        {copy(state.phase === 'running' ? 'Refreshing…' : 'Refresh my lineups')}
      </button>
      {state.note ? (
        <span className="af-pf-refresh-note" role="status">
          {copy(state.note)}
        </span>
      ) : null}
    </div>
  )
}

export default RefreshLineups
