'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Circle, RefreshCw, ChevronDown } from 'lucide-react'
import type { CommissionerSetupChecklist as Checklist } from '@/lib/league/commissioner-setup-checklist'
import './commissioner-setup-checklist.css'

export function CommissionerSetupChecklist({ leagueId, onOpenSettings, settingsOpen = false }: {
  leagueId: string
  onOpenSettings: (panel: string) => void
  settingsOpen?: boolean
}) {
  const [data, setData] = useState<Checklist | null>(null)
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(true)
  const request = useRef<AbortController | null>(null)
  const load = useCallback(async () => {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setLoading(true)
    setFailed(false)
    try {
      const response = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/setup/checklist`, {
        cache: 'no-store', signal: controller.signal,
      })
      if (!response.ok) throw new Error('Setup unavailable')
      const next = await response.json() as Checklist
      if (!controller.signal.aborted) setData(next)
    } catch {
      if (!controller.signal.aborted) setFailed(true)
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [leagueId])

  useEffect(() => {
    if (settingsOpen) return
    void load()
    const refresh = () => { if (document.visibilityState === 'visible') void load() }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      request.current?.abort()
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [load, settingsOpen])

  return (
    <section className="af-setup-checklist" aria-label="Commissioner setup checklist" data-testid="commissioner-setup-checklist">
      <div className="af-setup-heading">
        <button type="button" aria-expanded={expanded} aria-controls={`setup-steps-${leagueId}`} onClick={() => setExpanded(value => !value)}>
          <ChevronDown size={16} aria-hidden style={{ transform: expanded ? undefined : 'rotate(-90deg)' }} />
          <span>Commissioner setup</span>
        </button>
        <span className="af-setup-count" aria-live="polite">
          {failed ? 'Status unavailable' : loading ? 'Checking setup…' : data ? `${data.completed}/${data.total} checks complete` : ''}
        </span>
        <button type="button" aria-label="Refresh setup checklist" disabled={loading} onClick={() => void load()}><RefreshCw size={14} aria-hidden /></button>
      </div>
      {expanded && <div id={`setup-steps-${leagueId}`}>
        {failed ? <div className="af-setup-error" role="alert">Could not load the latest setup. <button type="button" onClick={() => void load()}>Try again</button></div>
          : data ? <>
            <progress value={data.completed} max={data.total} aria-label="Required setup checks complete" />
            <p className="af-setup-summary">{data.ready ? 'Setup checks complete. Review the draft room before starting.' : 'Finish these checks before draft day. Saved defaults are configured; review them to suit your league.'}</p>
            <ol className="af-setup-steps">
              {data.steps.map(step => <li key={step.id} data-done={step.done}>
                <span className="af-setup-icon" aria-label={step.done ? 'Complete' : step.optional ? 'Optional' : 'Needs attention'}>{step.done ? <Check size={16} aria-hidden /> : <Circle size={16} aria-hidden />}</span>
                <div><h3>{step.label}{step.optional && <span className="af-setup-optional">Optional</span>}</h3>
                  <p>{step.id === 'date' && step.done ? `Scheduled: ${new Date(step.detail.replace('Scheduled: ', '')).toLocaleString()}` : step.detail}</p></div>
                {step.panel ? <button type="button" onClick={() => onOpenSettings(step.panel!)}>{step.action}</button>
                  : <Link href={`/league/${leagueId}/draft`}>{step.action}</Link>}
              </li>)}
            </ol>
          </> : <p className="af-setup-summary" role="status">Loading saved league setup…</p>}
      </div>}
    </section>
  )
}
