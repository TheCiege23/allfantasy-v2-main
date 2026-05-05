'use client'

/**
 * Slice 1 — Draft Settings modal.
 * Canonical entry point: opened from CommissionerControlCenterModal "Draft Settings" button.
 * Surfaces 5 settings:
 *   - thirdRoundReversal      (DraftSession.thirdRoundReversal — locked when status !== 'pre_draft')
 *   - softTimerEnabled        (derived from draftUISettings.timerMode === 'soft_pause')
 *   - onClockTradeTimerBehavior (DraftSession column)
 *   - inDraftPlayerTradesEnabled (DraftSession column)
 *   - customRankingsEnabled    (DraftSession column)
 */

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'

type OnClockBehavior = 'inherit_remaining' | 'reset_timer'

type DraftSettingsResponse = {
  variantSettings?: {
    sessionStatus?: string | null
    sessionFlags?: {
      thirdRoundReversal: boolean
      softTimerEnabled: boolean
      onClockTradeTimerBehavior: OnClockBehavior
      inDraftPlayerTradesEnabled: boolean
      customRankingsEnabled: boolean
    } | null
    draftUISettings?: { timerMode?: string }
  }
  isCommissioner?: boolean
}

export type DraftSettingsModalProps = {
  leagueId: string
  onClose: () => void
}

export function DraftSettingsModal({ leagueId, onClose }: DraftSettingsModalProps) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [statusBanner, setStatusBanner] = useState<string | null>(null)
  const [sessionStatus, setSessionStatus] = useState<string | null>(null)
  const [thirdRoundReversal, setThirdRoundReversal] = useState(false)
  const [softTimerEnabled, setSoftTimerEnabled] = useState(false)
  const [onClockBehavior, setOnClockBehavior] = useState<OnClockBehavior>('inherit_remaining')
  const [inDraftPlayerTradesEnabled, setInDraftPlayerTradesEnabled] = useState(true)
  const [customRankingsEnabled, setCustomRankingsEnabled] = useState(true)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/leagues/${leagueId}/draft/settings`, { credentials: 'same-origin' })
        if (!res.ok) throw new Error(`Failed to load (${res.status})`)
        const data = (await res.json()) as DraftSettingsResponse
        if (cancelled) return
        const flags = data.variantSettings?.sessionFlags ?? null
        setSessionStatus(data.variantSettings?.sessionStatus ?? null)
        setThirdRoundReversal(Boolean(flags?.thirdRoundReversal))
        const derivedSoft =
          flags?.softTimerEnabled ?? data.variantSettings?.draftUISettings?.timerMode === 'soft_pause'
        setSoftTimerEnabled(Boolean(derivedSoft))
        setOnClockBehavior(flags?.onClockTradeTimerBehavior === 'reset_timer' ? 'reset_timer' : 'inherit_remaining')
        setInDraftPlayerTradesEnabled(flags?.inDraftPlayerTradesEnabled !== false)
        setCustomRankingsEnabled(flags?.customRankingsEnabled !== false)
      } catch (err) {
        if (!cancelled) setError((err as Error).message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [leagueId])

  const trrLocked = sessionStatus !== null && sessionStatus !== 'pre_draft'

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setStatusBanner(null)
    try {
      const body: Record<string, unknown> = {
        onClockTradeTimerBehavior: onClockBehavior,
        inDraftPlayerTradesEnabled,
        customRankingsEnabled,
        timerMode: softTimerEnabled ? 'soft_pause' : 'per_pick',
      }
      if (!trrLocked) body.thirdRoundReversal = thirdRoundReversal
      const res = await fetch(`/api/leagues/${leagueId}/draft/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (res.status === 409 && json?.code === 'THIRD_ROUND_REVERSAL_LOCKED') {
          setError('Third Round Reversal is locked because the draft has already started.')
        } else {
          setError(json?.error ?? `Save failed (${res.status})`)
        }
        return
      }
      setStatusBanner('Saved.')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      data-testid="draft-settings-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Draft settings"
    >
      <div className="relative w-full max-w-lg rounded-2xl bg-zinc-900 p-6 text-zinc-100 shadow-xl">
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-md p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          data-testid="draft-settings-modal-close"
        >
          <X size={18} />
        </button>
        <h2 className="mb-1 text-xl font-semibold">Draft Settings</h2>
        <p className="mb-4 text-sm text-zinc-400">Commissioner-only. Some fields lock once the draft starts.</p>

        {loading ? (
          <div className="py-8 text-center text-zinc-400">Loading…</div>
        ) : (
          <div className="space-y-4">
            {error ? (
              <div className="rounded-md border border-red-700 bg-red-950/40 p-3 text-sm text-red-200" role="alert">
                {error}
              </div>
            ) : null}
            {statusBanner ? (
              <div className="rounded-md border border-emerald-700 bg-emerald-950/40 p-3 text-sm text-emerald-200">
                {statusBanner}
              </div>
            ) : null}

            <fieldset className="space-y-1" data-testid="draft-settings-trr-field">
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={thirdRoundReversal}
                  disabled={trrLocked || saving}
                  onChange={(e) => setThirdRoundReversal(e.target.checked)}
                  className="mt-1"
                  data-testid="draft-settings-trr"
                />
                <span>
                  <span className="font-medium">Third Round Reversal</span>
                  <span className="block text-xs text-zinc-400">
                    Round 2 and Round 3 go in the same direction. {trrLocked ? 'Locked — draft already started.' : 'Editable only before the draft starts.'}
                  </span>
                </span>
              </label>
            </fieldset>

            <fieldset className="space-y-1" data-testid="draft-settings-soft-timer-field">
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={softTimerEnabled}
                  disabled={saving}
                  onChange={(e) => setSoftTimerEnabled(e.target.checked)}
                  className="mt-1"
                  data-testid="draft-settings-soft-timer"
                />
                <span>
                  <span className="font-medium">Soft timer</span>
                  <span className="block text-xs text-zinc-400">
                    Expired clocks do not auto-pick. Useful for multi-day drafts.
                  </span>
                </span>
              </label>
            </fieldset>

            <fieldset className="space-y-2" data-testid="draft-settings-onclock-trade-field">
              <legend className="font-medium">On-clock pick trade timer</legend>
              <label className="flex items-start gap-3 text-sm">
                <input
                  type="radio"
                  name="onClockBehavior"
                  value="inherit_remaining"
                  checked={onClockBehavior === 'inherit_remaining'}
                  disabled={saving}
                  onChange={() => setOnClockBehavior('inherit_remaining')}
                  className="mt-1"
                  data-testid="draft-settings-onclock-inherit"
                />
                <span>
                  <span className="font-medium">Inherit remaining</span>
                  <span className="block text-xs text-zinc-400">New owner inherits the time left on the clock (Sleeper-parity).</span>
                </span>
              </label>
              <label className="flex items-start gap-3 text-sm">
                <input
                  type="radio"
                  name="onClockBehavior"
                  value="reset_timer"
                  checked={onClockBehavior === 'reset_timer'}
                  disabled={saving}
                  onChange={() => setOnClockBehavior('reset_timer')}
                  className="mt-1"
                  data-testid="draft-settings-onclock-reset"
                />
                <span>
                  <span className="font-medium">Reset timer</span>
                  <span className="block text-xs text-zinc-400">New owner gets a fresh full timer.</span>
                </span>
              </label>
            </fieldset>

            <fieldset className="space-y-1" data-testid="draft-settings-player-trades-field">
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={inDraftPlayerTradesEnabled}
                  disabled={saving}
                  onChange={(e) => setInDraftPlayerTradesEnabled(e.target.checked)}
                  className="mt-1"
                  data-testid="draft-settings-player-trades"
                />
                <span>
                  <span className="font-medium">In-draft player trades</span>
                  <span className="block text-xs text-zinc-400">
                    Allow trading already-drafted players during the draft.
                  </span>
                </span>
              </label>
            </fieldset>

            <fieldset className="space-y-1" data-testid="draft-settings-custom-rankings-field">
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={customRankingsEnabled}
                  disabled={saving}
                  onChange={(e) => setCustomRankingsEnabled(e.target.checked)}
                  className="mt-1"
                  data-testid="draft-settings-custom-rankings"
                />
                <span>
                  <span className="font-medium">Custom rankings (CSV)</span>
                  <span className="block text-xs text-zinc-400">
                    Per-user CSV ranks influence queue, AI suggestions, and autopick fallback.
                  </span>
                </span>
              </label>
            </fieldset>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-800"
                data-testid="draft-settings-modal-cancel"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                data-testid="draft-settings-modal-save"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default DraftSettingsModal
