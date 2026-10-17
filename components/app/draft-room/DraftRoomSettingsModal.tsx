'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { X, Settings2, Shield, Eye, AlertCircle, Check, Loader2 } from 'lucide-react'
import type {
  DraftExecutionMode,
  DraftUISettings,
  OrphanDrafterMode,
  TimerMode,
} from '@/lib/draft-defaults/DraftUISettingsResolver'

export type DraftRoomSettingsModalProps = {
  open: boolean
  onClose: () => void
  leagueId: string
  leagueName: string
  /** `draftSession.status` from the live room */
  draftSessionStatus: string
  isCommissioner: boolean
  presentationVariant?: 'default' | 'redraft_snake'
  /** When the live session is an auction draft, show auction-only room toggles. */
  draftIsAuction?: boolean
  onSaved?: () => void
}

type SettingsGetResponse = {
  config?: {
    draft_type?: string
    rounds?: number
    timer_seconds?: number
    pick_order_rules?: string
    queue_size_limit?: number
    autopick_behavior?: string
  } | null
  draftUISettings?: DraftUISettings
  isCommissioner?: boolean
  draftOrderMode?: string
  error?: string
}

function labelExecutionMode(m: DraftExecutionMode): string {
  switch (m) {
    case 'live':
      return 'Live draft room'
    case 'auto':
      return 'Auto-draft'
    case 'offline':
      return 'Offline / in-person'
    default:
      return m
  }
}

function labelTimerMode(m: TimerMode): string {
  switch (m) {
    case 'per_pick':
      return 'Per pick'
    case 'soft_pause':
      return 'Soft pause between picks'
    case 'overnight_pause':
      return 'Overnight / slow-draft window'
    case 'none':
      return 'No timer mode'
    default:
      return m
  }
}

export function DraftRoomSettingsModal({
  open,
  onClose,
  leagueId,
  leagueName,
  draftSessionStatus,
  isCommissioner,
  presentationVariant = 'default',
  draftIsAuction = false,
  onSaved,
}: DraftRoomSettingsModalProps) {
  const rs = presentationVariant === 'redraft_snake'
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveOk, setSaveOk] = useState(false)
  const [payload, setPayload] = useState<SettingsGetResponse | null>(null)
  const [draftUI, setDraftUI] = useState<Partial<DraftUISettings>>({})
  const [serverCommissioner, setServerCommissioner] = useState(false)

  const draftComplete = draftSessionStatus === 'completed'
  const canEdit = isCommissioner && serverCommissioner && !draftComplete

  const resetDirtyFromPayload = useCallback((p: SettingsGetResponse) => {
    if (p.draftUISettings) setDraftUI({ ...p.draftUISettings })
  }, [])

  useEffect(() => {
    if (!open || !leagueId) return
    let cancelled = false
    setLoadError(null)
    setSaveError(null)
    setSaveOk(false)
    setLoading(true)
    void (async () => {
      try {
        const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft/settings`, {
          cache: 'no-store',
        })
        const data = (await res.json().catch(() => ({}))) as SettingsGetResponse
        if (!res.ok) {
          if (!cancelled) setLoadError(typeof data.error === 'string' ? data.error : 'Could not load settings.')
          return
        }
        if (!cancelled) {
          setPayload(data)
          setServerCommissioner(Boolean(data.isCommissioner))
          resetDirtyFromPayload(data)
        }
      } catch {
        if (!cancelled) setLoadError('Network error loading draft settings.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, leagueId, resetDirtyFromPayload])

  const baseline = payload?.draftUISettings
  const hasChanges = useMemo(() => {
    if (!baseline || !canEdit) return false
    const keys = Object.keys(draftUI) as (keyof DraftUISettings)[]
    for (const k of keys) {
      if (draftUI[k] !== undefined && draftUI[k] !== baseline[k]) return true
    }
    return false
  }, [baseline, draftUI, canEdit])

  const requestClose = useCallback(() => {
    if (typeof window !== 'undefined' && canEdit && hasChanges) {
      if (!window.confirm('Discard unsaved changes to draft preferences?')) return
    }
    onClose()
  }, [canEdit, hasChanges, onClose])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, requestClose])

  const handleSave = useCallback(async () => {
    if (!canEdit || !hasChanges || !baseline) return
    setSaving(true)
    setSaveError(null)
    setSaveOk(false)
    try {
      const body: Record<string, unknown> = {}
      const keys = Object.keys(draftUI) as (keyof DraftUISettings)[]
      for (const k of keys) {
        const next = draftUI[k]
        if (next === undefined || next === baseline[k]) continue
        body[k] = next
      }
      if (Object.keys(body).length === 0) {
        setSaving(false)
        return
      }
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const msg =
          typeof data.error === 'string'
            ? data.error
            : res.status === 409 && data?.code === 'LIVE_DRAFT_STRUCTURAL_LOCKED'
              ? 'Those settings cannot be changed while the draft is live.'
              : 'Save failed.'
        setSaveError(msg)
        return
      }
      setSaveOk(true)
      setPayload((prev) =>
        prev
          ? {
              ...prev,
              draftUISettings: (data.draftUISettings ?? prev.draftUISettings) as DraftUISettings,
            }
          : prev,
      )
      if (data.draftUISettings) {
        setDraftUI({ ...(data.draftUISettings as DraftUISettings) })
      }
      onSaved?.()
      window.setTimeout(() => setSaveOk(false), 3200)
    } catch {
      setSaveError('Network error while saving.')
    } finally {
      setSaving(false)
    }
  }, [baseline, canEdit, draftUI, hasChanges, leagueId, onSaved])

  const cfg = payload?.config

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-3 py-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="draft-room-settings-title"
      data-testid="draft-room-settings-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) requestClose()
      }}
    >
      <div
        className={`relative flex max-h-[min(92vh,880px)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border shadow-[0_24px_80px_rgba(0,0,0,0.55)] ${
          rs
            ? 'border-cyan-400/25 bg-[linear-gradient(165deg,rgba(8,22,38,0.98),rgba(4,10,22,0.99))]'
            : 'border-white/12 bg-[#0d1528]'
        }`}
      >
        <header
          className={`flex shrink-0 items-start justify-between gap-3 border-b px-4 py-3 ${
            rs ? 'border-cyan-500/15 bg-[linear-gradient(90deg,rgba(34,211,238,0.08),transparent)]' : 'border-white/10 bg-black/25'
          }`}
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Settings2 className={`h-5 w-5 shrink-0 ${rs ? 'text-cyan-300' : 'text-cyan-200/90'}`} />
              <h2 id="draft-room-settings-title" className="text-lg font-semibold text-white">
                Draft settings
              </h2>
              {canEdit ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/35 bg-emerald-500/12 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-100">
                  <Shield className="h-3 w-3" />
                  Commissioner
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full border border-white/20 bg-white/5 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white/75">
                  <Eye className="h-3 w-3" />
                  View only
                </span>
              )}
            </div>
            <p className="mt-1 truncate text-sm text-white/80" title={leagueName}>
              {leagueName}
            </p>
            <p className="mt-0.5 text-[11px] text-white/50">
              League ID <span className="font-mono text-white/65">{leagueId.slice(0, 8)}…</span> · Room{' '}
              <span className="text-cyan-200/90">{draftSessionStatus.replace(/_/g, ' ')}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={requestClose}
            className="rounded-lg border border-white/15 bg-black/30 p-2 text-white/80 hover:bg-white/10"
            aria-label="Close draft settings"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-sm">
          {loading ? (
            <div className="flex items-center gap-2 py-12 text-white/65">
              <Loader2 className="h-5 w-5 animate-spin text-cyan-300" />
              Loading league draft settings…
            </div>
          ) : loadError ? (
            <div className="flex gap-2 rounded-lg border border-rose-400/35 bg-rose-500/10 px-3 py-2 text-rose-100">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <p>{loadError}</p>
            </div>
          ) : (
            <>
              {draftComplete ? (
                <p className="mb-3 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100">
                  This draft is completed. Settings are shown for reference only.
                </p>
              ) : null}
              {!serverCommissioner && (
                <p className="mb-3 rounded-lg border border-white/12 bg-black/25 px-3 py-2 text-[11px] text-white/70">
                  Only commissioners can change draft preferences. You can review how this league is configured.
                </p>
              )}
              {draftSessionStatus === 'in_progress' || draftSessionStatus === 'paused' ? (
                <p className="mb-3 rounded-lg border border-cyan-400/25 bg-cyan-500/10 px-3 py-2 text-[11px] text-cyan-100">
                  While the draft is live, only <strong className="font-semibold">draft room preferences</strong> (below)
                  can be updated here. Draft type, rounds, and order are locked — use League → Draft if your league allows
                  changes between rounds.
                </p>
              ) : null}

              <section className="mb-4 space-y-2 rounded-xl border border-white/10 bg-black/20 p-3">
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">League draft configuration</h3>
                <dl className="grid gap-2 text-[13px]">
                  <div className="flex justify-between gap-2 border-b border-white/6 pb-1">
                    <dt className="text-white/55">Draft type</dt>
                    <dd className="font-medium text-white">{cfg?.draft_type ?? '—'}</dd>
                  </div>
                  <div className="flex justify-between gap-2 border-b border-white/6 pb-1">
                    <dt className="text-white/55">Rounds</dt>
                    <dd className="font-medium text-white">{cfg?.rounds ?? '—'}</dd>
                  </div>
                  <div className="flex justify-between gap-2 border-b border-white/6 pb-1">
                    <dt className="text-white/55">Pick order</dt>
                    <dd className="font-medium text-white">{cfg?.pick_order_rules ?? '—'}</dd>
                  </div>
                  <div className="flex justify-between gap-2 border-b border-white/6 pb-1">
                    <dt className="text-white/55">Pick timer (seconds)</dt>
                    <dd className="font-medium text-white">{cfg?.timer_seconds ?? '—'}</dd>
                  </div>
                  <div className="flex justify-between gap-2 border-b border-white/6 pb-1">
                    <dt className="text-white/55">Queue size limit</dt>
                    <dd className="font-medium text-white">{cfg?.queue_size_limit ?? '—'}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-white/55">Execution mode</dt>
                    <dd className="font-medium text-white">
                      {labelExecutionMode(
                        (draftUI.executionMode ?? baseline?.executionMode ?? 'live') as DraftExecutionMode,
                      )}
                    </dd>
                  </div>
                </dl>
              </section>

              <section className="space-y-3 rounded-xl border border-white/10 bg-black/25 p-3">
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">
                  Draft room preferences
                </h3>

                <ToggleRow
                  label="Sync draft chat to league chat"
                  helper="When on and the draft is live, normal messages also appear in your league chat stream."
                  checked={Boolean(draftUI.liveDraftChatSyncEnabled)}
                  disabled={!canEdit}
                  onChange={(v) => setDraftUI((p) => ({ ...p, liveDraftChatSyncEnabled: v }))}
                />
                <ToggleRow
                  label="AI ADP (league-aware)"
                  helper="Uses anonymized league ADP when available."
                  checked={Boolean(draftUI.aiAdpEnabled)}
                  disabled={!canEdit}
                  onChange={(v) => setDraftUI((p) => ({ ...p, aiAdpEnabled: v }))}
                />
                <ToggleRow
                  label="AI queue reorder suggestions"
                  checked={Boolean(draftUI.aiQueueReorderEnabled)}
                  disabled={!canEdit}
                  onChange={(v) => setDraftUI((p) => ({ ...p, aiQueueReorderEnabled: v }))}
                />
                <ToggleRow
                  label="Traded pick color tint"
                  checked={Boolean(draftUI.tradedPickColorModeEnabled)}
                  disabled={!canEdit}
                  onChange={(v) => setDraftUI((p) => ({ ...p, tradedPickColorModeEnabled: v }))}
                />
                <ToggleRow
                  label="Highlight traded-pick owner names"
                  checked={Boolean(draftUI.tradedPickOwnerNameRedEnabled)}
                  disabled={!canEdit}
                  onChange={(v) => setDraftUI((p) => ({ ...p, tradedPickOwnerNameRedEnabled: v }))}
                />
                <ToggleRow
                  label="Pick trading during draft"
                  checked={Boolean(draftUI.pickTradeEnabled)}
                  disabled={!canEdit}
                  onChange={(v) => setDraftUI((p) => ({ ...p, pickTradeEnabled: v }))}
                />
                {rs && !draftIsAuction ? (
                  <>
                    <ToggleRow
                      label="Round 1 on-screen pick reveal"
                      helper="Shows a premium banner when a Round 1 selection is made (snake redraft room)."
                      checked={draftUI.roundOnePickAnnouncementEnabled !== false}
                      disabled={!canEdit}
                      onChange={(v) => setDraftUI((p) => ({ ...p, roundOnePickAnnouncementEnabled: v }))}
                    />
                    <ToggleRow
                      label="Optional HeyGen Round 1 narration"
                      helper="When your server has HEYGEN_API_KEY, queues a short clip after each Round 1 pick. Never blocks the draft."
                      checked={Boolean(draftUI.roundOneHeyGenHighlightEnabled)}
                      disabled={!canEdit}
                      onChange={(v) => setDraftUI((p) => ({ ...p, roundOneHeyGenHighlightEnabled: v }))}
                    />
                  </>
                ) : null}
                <ToggleRow
                  label="Commissioner pause / resume / reset timer"
                  helper="Lets the commissioner use clock controls in the live room."
                  checked={draftUI.commissionerPauseControlsEnabled !== false}
                  disabled={!canEdit}
                  onChange={(v) => setDraftUI((p) => ({ ...p, commissionerPauseControlsEnabled: v }))}
                />
                <ToggleRow
                  label="Commissioner force auto-pick"
                  helper="Allows commissioner-triggered auto-picks when rules permit."
                  checked={Boolean(draftUI.commissionerForceAutoPickEnabled)}
                  disabled={!canEdit}
                  onChange={(v) => setDraftUI((p) => ({ ...p, commissionerForceAutoPickEnabled: v }))}
                />
                <ToggleRow
                  label="Member auto-pick (away mode)"
                  checked={Boolean(draftUI.autoPickEnabled)}
                  disabled={!canEdit}
                  onChange={(v) => setDraftUI((p) => ({ ...p, autoPickEnabled: v }))}
                />
                <ToggleRow
                  label="Orphan team AI manager"
                  checked={Boolean(draftUI.orphanTeamAiManagerEnabled)}
                  disabled={!canEdit}
                  onChange={(v) => setDraftUI((p) => ({ ...p, orphanTeamAiManagerEnabled: v }))}
                />

                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-white/75">Orphan drafter mode</label>
                  <select
                    className="w-full rounded-lg border border-white/15 bg-black/40 px-2 py-2 text-sm text-white disabled:opacity-50"
                    disabled={!canEdit}
                    value={(draftUI.orphanDrafterMode ?? baseline?.orphanDrafterMode ?? 'cpu') as OrphanDrafterMode}
                    onChange={(e) =>
                      setDraftUI((p) => ({ ...p, orphanDrafterMode: e.target.value as OrphanDrafterMode }))
                    }
                  >
                    <option value="cpu">CPU (deterministic)</option>
                    <option value="ai">AI (with CPU fallback)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-white/75">Timer mode</label>
                  <select
                    className="w-full rounded-lg border border-white/15 bg-black/40 px-2 py-2 text-sm text-white disabled:opacity-50"
                    disabled={!canEdit}
                    value={(draftUI.timerMode ?? baseline?.timerMode ?? 'per_pick') as TimerMode}
                    onChange={(e) => setDraftUI((p) => ({ ...p, timerMode: e.target.value as TimerMode }))}
                  >
                    {(['per_pick', 'soft_pause', 'overnight_pause', 'none'] as TimerMode[]).map((m) => (
                      <option key={m} value={m}>
                        {labelTimerMode(m)}
                      </option>
                    ))}
                  </select>
                </div>

                <ToggleRow
                  label="Draft import tools"
                  checked={Boolean(draftUI.importEnabled)}
                  disabled={!canEdit}
                  onChange={(v) => setDraftUI((p) => ({ ...p, importEnabled: v }))}
                />
                <ToggleRow
                  label="Draft order randomization (where applicable)"
                  checked={Boolean(draftUI.draftOrderRandomizationEnabled)}
                  disabled={!canEdit}
                  onChange={(v) => setDraftUI((p) => ({ ...p, draftOrderRandomizationEnabled: v }))}
                />
                {draftIsAuction ? (
                  <ToggleRow
                    label="Auto-nomination when clock expires (auction)"
                    helper="If the nominator does not act in time, the room picks the next player automatically."
                    checked={Boolean(draftUI.auctionAutoNominationEnabled)}
                    disabled={!canEdit}
                    onChange={(v) => setDraftUI((p) => ({ ...p, auctionAutoNominationEnabled: v }))}
                  />
                ) : null}
              </section>

              <p className="mt-3 text-[11px] leading-relaxed text-white/45">
                Full league draft setup (order lottery, salary cap, devy/C2C) lives in{' '}
                <a
                  href={`/league/${encodeURIComponent(leagueId)}?settingsPanel=draft`}
                  className="text-cyan-300 underline hover:text-cyan-200"
                  target="_blank"
                  rel="noreferrer"
                >
                  League settings → Draft
                </a>
                .
              </p>

              {saveError ? (
                <div className="mt-3 flex gap-2 rounded-lg border border-rose-400/35 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-100">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {saveError}
                </div>
              ) : null}
              {saveOk ? (
                <div className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-400/35 bg-emerald-500/12 px-3 py-2 text-[12px] text-emerald-100">
                  <Check className="h-4 w-4" />
                  Saved. The draft room will pick up these preferences on the next sync.
                </div>
              ) : null}
            </>
          )}
        </div>

        <footer
          className={`flex shrink-0 flex-wrap items-center gap-2 border-t px-4 py-3 ${
            canEdit ? 'justify-end' : 'justify-between'
          } ${rs ? 'border-cyan-500/12 bg-black/30' : 'border-white/10 bg-black/25'}`}
        >
          {!canEdit ? (
            <p className="max-w-[14rem] text-[11px] leading-snug text-white/48">
              View-only for members. Commissioners can adjust preferences here when the league allows it.
            </p>
          ) : null}
          <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={requestClose}
            className="rounded-lg border border-white/15 px-4 py-2 text-sm text-white/85 hover:bg-white/10"
          >
            Close
          </button>
          {canEdit ? (
            <button
              type="button"
              disabled={!hasChanges || saving || loading}
              onClick={() => void handleSave()}
              data-testid="draft-room-settings-save"
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-lg disabled:opacity-45 ${
                rs
                  ? 'border border-cyan-400/45 bg-gradient-to-r from-cyan-600/35 to-violet-600/25 hover:brightness-110'
                  : 'border border-cyan-400/35 bg-cyan-600/30 hover:bg-cyan-600/40'
              }`}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          ) : null}
          </div>
        </footer>
      </div>
    </div>
  )
}

function ToggleRow({
  label,
  helper,
  checked,
  disabled,
  onChange,
}: {
  label: string
  helper?: string
  checked: boolean
  disabled: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className={`flex cursor-pointer items-start gap-3 rounded-lg border border-white/8 bg-black/20 px-2 py-2 ${disabled ? 'cursor-not-allowed opacity-70' : 'hover:bg-white/5'}`}>
      <input
        type="checkbox"
        className="mt-1 h-4 w-4 rounded border-white/25 bg-black/50"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        <span className="block text-[13px] font-medium text-white">{label}</span>
        {helper ? <span className="mt-0.5 block text-[11px] text-white/50">{helper}</span> : null}
      </span>
    </label>
  )
}
