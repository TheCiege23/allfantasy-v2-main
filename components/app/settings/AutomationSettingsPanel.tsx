'use client'

import { useState, useCallback, useEffect } from 'react'
import type { DraftUISettings, TimerMode } from '@/lib/draft-defaults/DraftUISettingsResolver'

type DraftConfig = {
  draft_type?: string
  rounds?: number
  timer_seconds?: number | null
  snake_or_linear?: string
  [key: string]: unknown
}

type Response = {
  config: DraftConfig | null
  draftUISettings: DraftUISettings
  isCommissioner: boolean
  sessionVariant?: unknown
  sessionPreDraft?: boolean
}

const TIMER_MODE_OPTIONS: { value: TimerMode; label: string }[] = [
  { value: 'per_pick', label: 'Per pick' },
  { value: 'soft_pause', label: 'Soft pause' },
  { value: 'overnight_pause', label: 'Overnight pause (slow draft)' },
  { value: 'none', label: 'None' },
]

export default function AutomationSettingsPanel({ leagueId }: { leagueId: string }) {
  const [data, setData] = useState<Response | null>(null)
  const [loading, setLoading] = useState(!!leagueId)
  const [error, setError] = useState<string | null>(null)
  const [config, setConfig] = useState<DraftConfig | null>(null)
  const [ui, setUI] = useState<DraftUISettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)

  const load = useCallback(async () => {
    if (!leagueId) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft/settings`, { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error ?? 'Failed to load automation settings')
        setData(null)
        return
      }
      setData(json)
      setConfig(json.config ?? null)
      setUI(json.draftUISettings ?? null)
    } catch {
      setError('Failed to load automation settings')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [leagueId])

  useEffect(() => {
    load()
  }, [load])

  const setUIField = useCallback(<K extends keyof DraftUISettings>(key: K, value: DraftUISettings[K]) => {
    setUI((prev) => (prev ? { ...prev, [key]: value } : null))
  }, [])

  const handleSave = useCallback(async () => {
    if (!leagueId || !data?.isCommissioner) return
    setSaving(true)
    setSaveSuccess(false)
    try {
      const payload: Record<string, unknown> = {}
      if (ui) {
        const cpuManagersEnabled =
          ui.orphanTeamAiManagerEnabled && (ui.orphanDrafterMode ?? 'cpu') === 'cpu'
        payload.autoPickEnabled = ui.autoPickEnabled
        payload.timerMode = ui.timerMode
        payload.slowDraftPauseWindow = ui.slowDraftPauseWindow
        payload.commissionerForceAutoPickEnabled = ui.commissionerForceAutoPickEnabled
        payload.commissionerPauseControlsEnabled = ui.commissionerPauseControlsEnabled
        payload.allowPicksDuringOvernightPause = ui.allowPicksDuringOvernightPause
        payload.orphanTeamAiManagerEnabled = cpuManagersEnabled
        payload.orphanDrafterMode = 'cpu'
        payload.auctionAutoNominationEnabled = ui.auctionAutoNominationEnabled
      }
      if (config) payload.timer_seconds = config.timer_seconds
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error ?? 'Failed to save')
        return
      }
      setData((prev) => (prev ? { ...prev, config: json.config, draftUISettings: json.draftUISettings } : null))
      if (json.config) setConfig(json.config)
      if (json.draftUISettings) setUI(json.draftUISettings)
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 2000)
    } finally {
      setSaving(false)
    }
  }, [leagueId, data?.isCommissioner, config, ui])

  if (!leagueId) {
    return (
      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
        <h3 className="text-sm font-semibold text-white">Automation Settings</h3>
        <p className="mt-2 text-xs text-white/65">Select a league to configure deterministic automation.</p>
      </section>
    )
  }

  if (loading && !data) {
    return (
      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
        <h3 className="text-sm font-semibold text-white">Automation Settings</h3>
        <p className="mt-2 text-xs text-white/65">Loading…</p>
      </section>
    )
  }

  if (error && !data) {
    return (
      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
        <h3 className="text-sm font-semibold text-white">Automation Settings</h3>
        <p className="mt-2 text-xs text-red-400/90">{error}</p>
      </section>
    )
  }

  const isCommissioner = data?.isCommissioner ?? false
  const effectiveConfig = config ?? data?.config ?? null
  const effectiveUI = ui ?? data?.draftUISettings

  if (!effectiveUI) {
    return (
      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
        <h3 className="text-sm font-semibold text-white">Automation Settings</h3>
        <p className="mt-2 text-xs text-white/65">No draft settings available.</p>
      </section>
    )
  }

  return (
    <section className="space-y-6 rounded-xl border border-white/10 bg-black/20 p-4">
      <div>
        <h3 className="text-sm font-semibold text-white">Automation Settings</h3>
        <p className="mt-1 text-xs text-white/65">
          Deterministic automation only — no Chimmy API required. Commissioners control timers, queue auto-pick, CPU empty-team automation, overnight pauses, pause controls, and auction automation.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-white/70">Auto-pick timer</h4>
          <p className="mt-1 text-xs text-white/50">Per-pick timer (seconds). When it expires, queue autopick may run if enabled below.</p>
          <div className="mt-2 flex items-center gap-2">
            {isCommissioner ? (
              <input
                type="number"
                min={0}
                max={86400}
                value={effectiveConfig?.timer_seconds ?? ''}
                onChange={(e) => setConfig((prev) => ({ ...(prev ?? {}), timer_seconds: e.target.value === '' ? null : parseInt(e.target.value, 10) }))}
                placeholder="e.g. 90"
                data-testid="commissioner-automation-autopick-timer-input"
                className="w-24 rounded border border-white/20 bg-black/40 px-2 py-1.5 text-sm text-white"
              />
            ) : (
              <span className="text-sm text-white/90">{effectiveConfig?.timer_seconds ?? '—'} seconds</span>
            )}
          </div>
        </div>

        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-white/70">Queue autopick</h4>
          <p className="mt-1 text-xs text-white/50">When timer expires, automatically pick from the manager’s queue (deterministic).</p>
          <label className="mt-2 flex items-center gap-2 text-sm text-white/90">
            <input
              type="checkbox"
              checked={effectiveUI.autoPickEnabled}
              onChange={(e) => setUIField('autoPickEnabled', e.target.checked)}
              disabled={!isCommissioner}
              data-testid="commissioner-automation-queue-autopick-toggle"
              className="rounded border-white/20"
            />
            Enable queue autopick
          </label>
        </div>

        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-white/70">CPU managers for empty teams</h4>
          <p className="mt-1 text-xs text-white/50">Rules-based drafting for orphan/empty teams. This panel enforces CPU mode only.</p>
          <label className="mt-2 flex items-center gap-2 text-sm text-white/90">
            <input
              type="checkbox"
              checked={effectiveUI.orphanTeamAiManagerEnabled && (effectiveUI.orphanDrafterMode ?? 'cpu') === 'cpu'}
              onChange={(e) => {
                const enabled = e.target.checked
                setUIField('orphanTeamAiManagerEnabled', enabled)
                setUIField('orphanDrafterMode', 'cpu')
              }}
              disabled={!isCommissioner}
              data-testid="commissioner-automation-cpu-empty-team-toggle"
              className="rounded border-white/20"
            />
            Enable CPU managers for empty teams
          </label>
          {effectiveUI.orphanTeamAiManagerEnabled && (effectiveUI.orphanDrafterMode ?? 'cpu') === 'ai' && (
            <p className="mt-2 text-xs text-amber-300">
              Chimmy empty-team manager is currently active from Chimmy settings. Enable the CPU toggle above to switch automation back to deterministic CPU mode.
            </p>
          )}
        </div>

        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-white/70">Pause overnight (slow drafts)</h4>
          <p className="mt-1 text-xs text-white/50">Timer does not count down during this window — e.g. 10pm–8am league time.</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select
              value={effectiveUI.timerMode}
              onChange={(e) => setUIField('timerMode', e.target.value as TimerMode)}
              disabled={!isCommissioner}
              data-testid="commissioner-automation-timer-mode-select"
              className="rounded border border-white/20 bg-black/40 px-2 py-1 text-sm text-white"
            >
              {TIMER_MODE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          {effectiveUI.timerMode === 'overnight_pause' && isCommissioner && (
            <div className="mt-3 flex flex-wrap gap-3 rounded-lg border border-white/10 bg-white/5 p-3 text-xs">
              <label className="flex items-center gap-1.5">
                <span className="text-white/60">Start</span>
                <input
                  type="text"
                  placeholder="22:00"
                  value={effectiveUI.slowDraftPauseWindow?.start ?? ''}
                  onChange={(e) => setUIField('slowDraftPauseWindow', { ...(effectiveUI.slowDraftPauseWindow ?? { start: '', end: '', timezone: 'America/New_York' }), start: e.target.value })}
                  data-testid="commissioner-automation-overnight-start-input"
                  className="w-16 rounded border border-white/20 bg-black/40 px-2 py-1 text-white"
                />
              </label>
              <label className="flex items-center gap-1.5">
                <span className="text-white/60">End</span>
                <input
                  type="text"
                  placeholder="08:00"
                  value={effectiveUI.slowDraftPauseWindow?.end ?? ''}
                  onChange={(e) => setUIField('slowDraftPauseWindow', { ...(effectiveUI.slowDraftPauseWindow ?? { start: '', end: '', timezone: 'America/New_York' }), end: e.target.value })}
                  data-testid="commissioner-automation-overnight-end-input"
                  className="w-16 rounded border border-white/20 bg-black/40 px-2 py-1 text-white"
                />
              </label>
              <label className="flex items-center gap-1.5">
                <span className="text-white/60">Timezone</span>
                <input
                  type="text"
                  placeholder="America/New_York"
                  value={effectiveUI.slowDraftPauseWindow?.timezone ?? ''}
                  onChange={(e) => setUIField('slowDraftPauseWindow', { ...(effectiveUI.slowDraftPauseWindow ?? { start: '', end: '', timezone: 'America/New_York' }), timezone: e.target.value })}
                  data-testid="commissioner-automation-overnight-timezone-input"
                  className="w-40 rounded border border-white/20 bg-black/40 px-2 py-1 text-white"
                />
              </label>
              <label className="mt-2 flex w-full items-center gap-2 text-white/85">
                <input
                  type="checkbox"
                  checked={Boolean(effectiveUI.allowPicksDuringOvernightPause)}
                  onChange={(e) => setUIField('allowPicksDuringOvernightPause', e.target.checked)}
                  disabled={!isCommissioner}
                  data-testid="commissioner-automation-overnight-allow-picks-toggle"
                  className="rounded border-white/20"
                />
                Allow picks during overnight quiet window
              </label>
            </div>
          )}
        </div>

        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-white/70">Draft pause controls</h4>
          <p className="mt-1 text-xs text-white/50">Allow commissioner pause/resume/reset-timer controls in the draft room control center.</p>
          <label className="mt-2 flex items-center gap-2 text-sm text-white/90">
            <input
              type="checkbox"
              checked={effectiveUI.commissionerPauseControlsEnabled ?? true}
              onChange={(e) => setUIField('commissionerPauseControlsEnabled', e.target.checked)}
              disabled={!isCommissioner}
              data-testid="commissioner-automation-pause-controls-toggle"
              className="rounded border-white/20"
            />
            Enable commissioner draft pause controls
          </label>
          <label className="mt-2 flex items-center gap-2 text-sm text-white/90">
            <input
              type="checkbox"
              checked={effectiveUI.commissionerForceAutoPickEnabled}
              onChange={(e) => setUIField('commissionerForceAutoPickEnabled', e.target.checked)}
              disabled={!isCommissioner}
              data-testid="commissioner-automation-force-autopick-toggle"
              className="rounded border-white/20"
            />
            Enable commissioner force auto-pick
          </label>
        </div>

        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-white/70">Auction auto-nomination</h4>
          <p className="mt-1 text-xs text-white/50">When the current nominator doesn’t nominate in time, system auto-nominates next player (deterministic order).</p>
          <label className="mt-2 flex items-center gap-2 text-sm text-white/90">
            <input
              type="checkbox"
              checked={effectiveUI.auctionAutoNominationEnabled}
              onChange={(e) => setUIField('auctionAutoNominationEnabled', e.target.checked)}
              disabled={!isCommissioner}
              data-testid="commissioner-automation-auction-auto-nomination-toggle"
              className="rounded border-white/20"
            />
            Enable auction auto-nomination
          </label>
        </div>
      </div>

      {isCommissioner && (
        <div className="flex items-center gap-2 pt-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            data-testid="commissioner-automation-save"
            className="rounded-lg border border-cyan-500/40 bg-cyan-500/20 px-4 py-2 text-xs font-medium text-cyan-200 hover:bg-cyan-500/30 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save automation settings'}
          </button>
          {saveSuccess && <span className="text-xs text-emerald-400">Saved.</span>}
        </div>
      )}
    </section>
  )
}
