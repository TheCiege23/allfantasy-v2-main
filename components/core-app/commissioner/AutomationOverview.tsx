'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { useMessages } from '@/components/i18n/useMessages'
import { automationOverviewMessages } from '@/lib/core-app/messages/automationOverview'
import type { AutomationOverviewView } from '@/lib/commissioner-hub/automationOverviewService'
import type { AutomationGroup, AutomationRow } from '@/lib/commissioner-hub/automationOverview'
import type { AutomationPreset, PresetPlan } from '@/lib/commissioner-hub/automationPreset'
import { automationToggleRequest, isToggleableAutomation } from '@/lib/commissioner-hub/automationToggles'
import { AutomaticChangesLog } from '@/components/league/AutomaticChangesLog'

/**
 * "What runs itself" (lib/commissioner-hub/automationOverview.ts) on the Commissioner Hub: every
 * automation in the league, whether it is on, and a link to its switch. Read-only; each switch stays
 * on its own card or settings page.
 */
const GROUPS: Array<[AutomationGroup, 'groupLineups' | 'groupDrafts' | 'groupFairness']> = [
  ['lineups', 'groupLineups'],
  ['drafts', 'groupDrafts'],
  ['fairness', 'groupFairness'],
]

export function AutomationOverview({ leagueId }: { leagueId: string }) {
  const m = useMessages(automationOverviewMessages)
  const [view, setView] = useState<AutomationOverviewView | null>(null)
  const [failed, setFailed] = useState(false)
  const [preview, setPreview] = useState<PresetPlan | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const presetUrl = `/api/leagues/${encodeURIComponent(leagueId)}/automation-preset`

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/automation-overview`, { cache: 'no-store' })
      if (!r.ok) throw new Error(String(r.status))
      setView((await r.json()) as AutomationOverviewView)
    } catch {
      setFailed(true)
    }
  }, [leagueId])

  useEffect(() => {
    void load()
  }, [load])

  /** Show what a preset would change; nothing is saved until the commissioner confirms. */
  const ask = async (preset: AutomationPreset) => {
    setBusy(true)
    setMessage('')
    try {
      const r = await fetch(`${presetUrl}?preset=${preset}`, { cache: 'no-store' })
      const body = (await r.json().catch(() => ({}))) as PresetPlan & { error?: string }
      if (!r.ok) throw new Error(body.error || '')
      setPreview(body)
    } catch (e) {
      setMessage(e instanceof Error && e.message ? e.message : m.loadFailed)
    } finally {
      setBusy(false)
    }
  }

  /** A free automation switched right here, through its own endpoint. */
  const flip = async (r: AutomationRow) => {
    if (!isToggleableAutomation(r.key)) return
    setBusy(true)
    setMessage('')
    try {
      const req = automationToggleRequest(leagueId, r.key, r.state !== 'on')
      const res = await fetch(req.url, { method: req.method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req.body) })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(body.error || '')
      setMessage(m.saved)
      await load()
    } catch (e) {
      setMessage(e instanceof Error && e.message ? e.message : m.saveFailed)
    } finally {
      setBusy(false)
    }
  }

  const confirm = async () => {
    if (!preview) return
    setBusy(true)
    try {
      const r = await fetch(presetUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preset: preview.preset }) })
      const body = (await r.json().catch(() => ({}))) as PresetPlan & { error?: string }
      if (!r.ok) throw new Error(body.error || '')
      setMessage(m.savedChanges(body.changes.length))
      setPreview(null)
      await load()
    } catch (e) {
      setMessage(e instanceof Error && e.message ? e.message : m.saveFailed)
    } finally {
      setBusy(false)
    }
  }

  if (failed || (view && !view.supported)) return null
  const rows = view?.supported ? view.rows : []
  const on = rows.filter((r) => r.state === 'on').length
  const stateText = (r: AutomationRow) =>
    r.state === 'on' ? m.stateOn : r.state === 'needs_plan' ? m.stateNeedsPlan : m.stateOff

  return (
    <section id="ch-automation-overview" className="af-tw af-tw-panel" data-testid="automation-overview">
      <h2>{m.title}</h2>
      {view === null ? (
        <p role="status">{m.loading}</p>
      ) : (
        <>
          <p>
            {m.summary(on, rows.length)}
          </p>
          <p data-testid="automation-presets">
            <button type="button" className="af-btn" disabled={busy} onClick={() => void ask('recommended')} data-testid="preset-recommended">
              {m.presetRecommended}
            </button>{' '}
            <button type="button" className="af-btn" disabled={busy} onClick={() => void ask('run_it')} data-testid="preset-run-it">
              {m.presetRunIt}
            </button>
          </p>
          {preview ? (
            <div data-testid="preset-preview">
              {preview.changes.length === 0 ? (
                <p>{m.presetAllOn}</p>
              ) : (
                <>
                  <p>{m.savingWill}</p>
                  <ul>
                    {preview.changes.map((c) => (
                      <li key={c.label}>{m.fromApi(c.label, c.labelEs)}</li>
                    ))}
                  </ul>
                </>
              )}
              {preview.needsPlan.length > 0 ? (
                <p>
                  {m.needsPlanPrefix}
                  {m.fromApi(preview.needsPlan.join(', '), preview.needsPlanEs.join(', '))}.
                </p>
              ) : null}
              {preview.changes.length > 0 ? (
                <button type="button" className="af-btn" disabled={busy} onClick={() => void confirm()} data-testid="preset-confirm">
                  {busy ? m.saving : m.save}
                </button>
              ) : null}{' '}
              <button type="button" className="af-btn" disabled={busy} onClick={() => setPreview(null)}>
                {m.cancel}
              </button>
            </div>
          ) : null}
          {GROUPS.map(([group, heading]) => {
            const inGroup = rows.filter((r) => r.group === group)
            if (inGroup.length === 0) return null
            return (
              <div key={group}>
                <h3>{m[heading]}</h3>
                <ul>
                  {inGroup.map((r) => (
                    <li key={r.key} data-testid={`automation-${r.key}`} data-state={r.state}>
                      {isToggleableAutomation(r.key) ? (
                        <input
                          type="checkbox"
                          checked={r.state === 'on'}
                          disabled={busy}
                          onChange={() => void flip(r)}
                          aria-label={m.rowLabel(r.key, r.label)}
                          data-testid={`automation-toggle-${r.key}`}
                        />
                      ) : null}{' '}
                      <strong>{m.rowLabel(r.key, r.label)}</strong> · {stateText(r)}
                      {m.fromApi(r.detail ?? '', r.detailEs ?? '') ? ` · ${m.fromApi(r.detail ?? '', r.detailEs ?? '')}` : ''}{' '}
                      {r.href.startsWith('#') ? <a href={r.href}>{m.change}</a> : <Link href={r.href}>{m.change}</Link>}
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </>
      )}
      <AutomaticChangesLog leagueId={leagueId} />
      <p role="status">{message}</p>
    </section>
  )
}
