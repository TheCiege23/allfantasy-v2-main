'use client'

/**
 * [NEW] Commissioner panel: week progression, automation run, audit log, overrides. PROMPT 4.
 */

import { useState } from 'react'

export interface BigBrotherCommissionerPanelProps {
  leagueId: string
  onAction?: () => void
  nominees?: { id: string; name: string }[]
}

const AUTOMATION_ACTIONS = [
  { value: 'auto_nominate', label: 'Run auto-nomination (HOH missed deadline)' },
  { value: 'veto_draw', label: 'Run veto draw' },
  { value: 'veto_decision_timeout', label: 'Veto decision timeout (keep noms, open voting)' },
  { value: 'auto_replacement', label: 'Run auto replacement nominee' },
  { value: 'lock_voting', label: 'Lock voting' },
  { value: 'close_eviction', label: 'Close eviction (tally & announce)' },
] as const

const ADMIN_ACTIONS = [
  { value: 'start_week_one', label: 'Start week 1 (create first cycle)' },
  { value: 'force_advance_week', label: 'Force advance week (by phase)' },
  { value: 'reopen_nominations', label: 'Reopen nominations' },
  { value: 'reopen_veto', label: 'Reopen veto decision' },
  { value: 'extend_vote_window', label: 'Extend vote window' },
  { value: 'resolve_eviction_tie', label: 'Resolve commissioner eviction tie' },
  { value: 'rerun_vote_tally', label: 'Rerun vote tally (no eviction)' },
  { value: 'force_waiver_release', label: 'Force waiver release (evicted roster)' },
  { value: 'resolve_veto_state', label: 'Resolve veto state (keep noms)' },
  { value: 'replace_inactive_hoh', label: 'Replace inactive HOH (auto-nominate)' },
  { value: 'replace_inactive_veto_decision', label: 'Replace inactive veto decision' },
  { value: 'repair_duplicate_status', label: 'Repair duplicate/invalid phases' },
  { value: 'pause_week', label: 'Pause week progression' },
  { value: 'resume_week', label: 'Resume week progression' },
] as const

export function BigBrotherCommissionerPanel({ leagueId, onAction, nominees = [] }: BigBrotherCommissionerPanelProps) {
  const [action, setAction] = useState<string>(AUTOMATION_ACTIONS[0].value)
  const [adminAction, setAdminAction] = useState<string>(ADMIN_ACTIONS[0].value)
  const [adminParams, setAdminParams] = useState<{ minutes?: string; rosterId?: string }>({})
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [audit, setAudit] = useState<{ eventType: string; createdAt: string }[]>([])
  const [auditLoading, setAuditLoading] = useState(false)

  const runAutomation = async () => {
    setRunning(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/big-brother/automation/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setMessage(`Done: ${(data as { actionTaken?: string }).actionTaken ?? action}`)
        onAction?.()
      } else {
        setMessage(`Error: ${(data as { error?: string }).error ?? res.status}`)
      }
    } catch {
      setMessage('Request failed')
    } finally {
      setRunning(false)
    }
  }

  const runAdminAction = async () => {
    setRunning(true)
    setMessage(null)
    try {
      const params: Record<string, unknown> = {}
      if (adminAction === 'extend_vote_window' && adminParams.minutes) params.minutes = parseInt(adminParams.minutes, 10) || 60
      if (['force_waiver_release','resolve_eviction_tie'].includes(adminAction) && adminParams.rosterId) params.rosterId = adminParams.rosterId.trim()
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/big-brother/admin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: adminAction, params: Object.keys(params).length ? params : undefined }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setMessage((data as { message?: string }).message ?? 'Done')
        onAction?.()
      } else {
        setMessage(`Error: ${(data as { error?: string }).error ?? res.status}`)
      }
    } catch {
      setMessage('Request failed')
    } finally {
      setRunning(false)
    }
  }

  const loadAudit = async () => {
    setAuditLoading(true)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/big-brother/audit?limit=30`, { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        setAudit((data as { log?: { eventType: string; createdAt: string }[] }).log ?? [])
      }
    } catch {
      setAudit([])
    } finally {
      setAuditLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <h3 className="text-sm font-medium text-white/90">Automation</h3>
        <p className="mt-1 text-xs text-white/50">Run a single automation step. Use when deadlines have passed or for testing.</p>
        <div className="mt-3">
          <select
            value={action}
            onChange={(e) => setAction(e.target.value)}
            className="rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-sm text-white"
          >
            {AUTOMATION_ACTIONS.map((a: { value: string; label: string }) => (
              <option key={a.value} value={a.value}>{a.label}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={runAutomation}
            disabled={running}
            className="ml-2 rounded-xl bg-amber-500/20 px-4 py-2 text-sm text-amber-200 hover:bg-amber-500/30 disabled:opacity-50"
          >
            {running ? 'Running…' : 'Run'}
          </button>
        </div>
        {message && <p className="mt-2 text-sm text-white/70">{message}</p>}
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <h3 className="text-sm font-medium text-white/90">Admin tools</h3>
        <p className="mt-1 text-xs text-white/50">Force-advance, reopen phases, extend vote, rerun tally, force waiver release, resolve veto, replace inactive, repair phases, pause/resume.</p>
        <div className="mt-3">
          <select
            value={adminAction}
            onChange={(e) => setAdminAction(e.target.value)}
            className="rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-sm text-white"
          >
            {ADMIN_ACTIONS.map((a) => (
              <option key={a.value} value={a.value}>{a.label}</option>
            ))}
          </select>
          {adminAction === 'extend_vote_window' && (
            <input
              type="number"
              min={1}
              max={10080}
              placeholder="Minutes"
              value={adminParams.minutes ?? ''}
              onChange={(e) => setAdminParams((p) => ({ ...p, minutes: e.target.value }))}
              className="ml-2 w-24 rounded-lg border border-white/20 bg-white/5 px-2 py-2 text-sm text-white"
            />
          )}
          {adminAction === 'resolve_eviction_tie' && <label className="ml-2 text-sm text-white/80">Evict tied nominee
            <select aria-label="Evict tied nominee" value={adminParams.rosterId ?? ''} onChange={e => setAdminParams(p => ({...p, rosterId: e.target.value}))} className="ml-2 min-h-11 rounded-lg border border-white/20 bg-white/5 px-3 py-2">
              <option value="">Choose nominee</option>{nominees.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
            </select>
          </label>}
          {adminAction === 'force_waiver_release' && (
            <input
              type="text"
              placeholder="Roster ID"
              value={adminParams.rosterId ?? ''}
              onChange={(e) => setAdminParams((p) => ({ ...p, rosterId: e.target.value }))}
              className="ml-2 w-48 rounded-lg border border-white/20 bg-white/5 px-2 py-2 text-sm text-white"
            />
          )}
          <button
            type="button"
            onClick={runAdminAction}
            disabled={running}
            className="ml-2 rounded-xl bg-rose-500/20 px-4 py-2 text-sm text-rose-200 hover:bg-rose-500/30 disabled:opacity-50"
          >
            {running ? 'Running…' : 'Run admin'}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <h3 className="text-sm font-medium text-white/90">Audit log</h3>
        <p className="mt-1 text-xs text-white/50">Recent Big Brother events (phase transitions, noms, veto, eviction, jury).</p>
        <button
          type="button"
          onClick={loadAudit}
          disabled={auditLoading}
          className="mt-2 rounded-lg border border-white/20 bg-white/5 px-3 py-1.5 text-xs text-white/80 hover:bg-white/10 disabled:opacity-50"
        >
          {auditLoading ? 'Loading…' : 'Load audit log'}
        </button>
        {audit.length > 0 && (
          <ul className="mt-2 max-h-48 overflow-y-auto text-xs text-white/60">
            {audit.map((e, i) => (
              <li key={i}>{e.eventType} — {e.createdAt}</li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-xs text-white/40">Schedule controls and inactivity overrides are in Settings → Big Brother Settings. Emergency timing extensions can be added as config overrides.</p>
    </div>
  )
}
