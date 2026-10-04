'use client'

import { useLeagueSectionData } from '@/hooks/useLeagueSectionData'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { waiverSettingsRequestSchema } from '@/lib/waiver-wire/settings-request'

type WaiverConfig = {
  waiver_type?: string
  processing_days?: number[]
  processing_time_utc?: string | null
  claim_limit_per_period?: number | null
  game_lock_behavior?: string | null
  free_agent_unlock_behavior?: string
  continuous_waivers?: boolean
  faab_enabled?: boolean
  faab_budget?: number | null
  faab_reset_rules?: string | null
  claim_priority_behavior?: string | null
  sport?: string
  variant?: string | null
  tiebreak_rule?: string | null
  instant_fa_after_clear?: boolean
}

type EditableWaiverForm = {
  waiverType: string
  processingDayOfWeek: number | null
  processingTimeUtc: string | null
  claimLimitPerPeriod: number | null
  faabBudget: number | null
  tiebreakRule: string | null
  lockType: string | null
  instantFaAfterClear: boolean
}

const WAIVER_TYPE_OPTIONS = [
  { value: 'faab', label: 'FAAB' },
  { value: 'rolling', label: 'Rolling waivers' },
  { value: 'reverse_standings', label: 'Reverse standings' },
  { value: 'fcfs', label: 'FCFS' },
  { value: 'standard', label: 'Standard' },
] as const

const CLAIM_PRIORITY_OPTIONS = [
  { value: 'faab_highest', label: 'Highest FAAB bid' },
  { value: 'priority_lowest_first', label: 'Waiver priority' },
  { value: 'reverse_standings', label: 'Reverse standings' },
  { value: 'earliest_claim', label: 'Earliest claim' },
] as const

const GAME_LOCK_OPTIONS = [
  { value: 'game_time', label: 'Game time' },
  { value: 'first_game', label: 'First game' },
  { value: 'slate_lock', label: 'Slate lock' },
  { value: 'manual', label: 'Manual' },
] as const

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function toEditableForm(config: WaiverConfig): EditableWaiverForm {
  return {
    waiverType: config.waiver_type ?? 'standard',
    processingDayOfWeek:
      Array.isArray(config.processing_days) && config.processing_days.length > 0
        ? config.processing_days[0]!
        : null,
    processingTimeUtc: config.processing_time_utc ?? null,
    claimLimitPerPeriod: config.claim_limit_per_period ?? null,
    faabBudget: config.faab_budget ?? null,
    tiebreakRule: config.tiebreak_rule ?? config.claim_priority_behavior ?? null,
    lockType: config.game_lock_behavior ?? null,
    instantFaAfterClear: config.instant_fa_after_clear ?? false,
  }
}

export default function WaiverSettingsPanel({ leagueId }: { leagueId: string }) {
  return <LeagueWaiverSettingsPanel key={leagueId} leagueId={leagueId} />
}

function LeagueWaiverSettingsPanel({ leagueId }: { leagueId: string }) {
  const { data: config, loading, error, reload } = useLeagueSectionData<WaiverConfig>(
    leagueId,
    'waiver/config',
  )
  const [canEdit, setCanEdit] = useState(false)
  const [checkingEditPermission, setCheckingEditPermission] = useState(false)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<EditableWaiverForm | null>(null)
  const mounted = useRef(true)
  const savingRef = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  useEffect(() => {
    if (!leagueId) return
    let active = true
    setCheckingEditPermission(true)
    fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/waivers?type=settings`, {
      cache: 'no-store',
    })
      .then(async (res) => {
        const settings = await res.json().catch(() => null)
        if (!active) return
        setCanEdit(res.ok && settings?.leagueId === leagueId && typeof settings?.waiverType === 'string')
      })
      .catch(() => {
        if (!active) return
        setCanEdit(false)
      })
      .finally(() => {
        if (!active) return
        setCheckingEditPermission(false)
      })
    return () => {
      active = false
    }
  }, [leagueId])

  useEffect(() => {
    if (!config) return
    if (typeof config.waiver_type !== 'string' || !waiverSettingsRequestSchema.safeParse(toEditableForm(config)).success) {
      setForm(null)
      return
    }
    setForm(toEditableForm(config))
  }, [config])

  const isFaab = useMemo(
    () => (editing ? form?.waiverType === 'faab' : config?.waiver_type === 'faab'),
    [editing, form?.waiverType, config?.waiver_type]
  )

  async function saveOverrides() {
    if (!form || savingRef.current || !canEdit) return
    const validated = waiverSettingsRequestSchema.safeParse(form)
    if (!validated.success) { toast.error('Check waiver limits and processing time before saving'); return }
    savingRef.current = true
    setSaving(true)
    try {
      const res = await fetch(
        `/api/commissioner/leagues/${encodeURIComponent(leagueId)}/waivers`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            waiverType: form.waiverType,
            processingDayOfWeek: form.processingDayOfWeek,
            processingTimeUtc: form.processingTimeUtc,
            claimLimitPerPeriod: form.claimLimitPerPeriod,
            faabBudget: form.faabBudget,
            tiebreakRule: form.tiebreakRule,
            lockType: form.lockType,
            instantFaAfterClear: form.instantFaAfterClear,
          }),
        }
      )
      const json = await res.json().catch(() => ({}))
      if (!mounted.current) return
      if (!res.ok) {
        toast.error(json?.error ?? 'Failed to save waiver overrides')
        return
      }
      if (json?.leagueId !== leagueId || typeof json?.waiverType !== 'string') {
        toast.error('Could not confirm saved waiver settings. Reload before retrying.')
        return
      }
      setEditing(false)
      toast.success('Waiver overrides saved')
      await reload()
    } catch {
      if (mounted.current) toast.error('Could not confirm saved waiver settings. Reload before retrying.')
    } finally {
      if (mounted.current) { savingRef.current = false; setSaving(false) }
    }
  }

  if (!leagueId) {
    return (
      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
        <h3 className="text-sm font-semibold text-white">Waiver Settings</h3>
        <p className="mt-2 text-xs text-white/65">Select a league to view waiver settings.</p>
      </section>
    )
  }

  if (loading) {
    return (
      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
        <h3 className="text-sm font-semibold text-white">Waiver Settings</h3>
        <p className="mt-2 text-xs text-white/65">Loading…</p>
      </section>
    )
  }

  if (error || !config) {
    return (
      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
        <h3 className="text-sm font-semibold text-white">Waiver Settings</h3>
        <p className="mt-2 text-xs text-red-400/90">{error ?? 'Failed to load waiver config.'}</p>
      </section>
    )
  }

  if (!form) return <p role="alert">Could not verify this league&apos;s waiver settings. Reload before editing.</p>

  return (
    <section className="rounded-xl border border-white/10 bg-black/20 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-white">Waiver Settings</h3>
        {canEdit && (
          <button
            type="button"
            disabled={checkingEditPermission || saving}
            onClick={() => {
              if (editing) {
                setForm(toEditableForm(config))
                setEditing(false)
              } else {
                setEditing(true)
              }
            }}
            data-testid="commissioner-waiver-edit-toggle"
            className="rounded border border-white/20 px-2.5 py-1 text-xs text-white/80 hover:bg-white/10 disabled:opacity-50"
          >
            {editing ? 'Cancel' : 'Edit overrides'}
          </button>
        )}
      </div>
      <p className="mt-1 text-xs text-white/65">
        Sport-aware defaults from league creation. Commissioner overrides can be applied via Commissioner tab or Waivers tab.
      </p>
      {checkingEditPermission && (
        <p className="mt-1 text-[11px] text-white/45">Checking commissioner access…</p>
      )}

      {editing ? (
        <div className="mt-4 space-y-3 rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-white/70">
              Waiver type
              <select
                value={form.waiverType}
                onChange={(e) =>
                  setForm((prev) =>
                    prev
                      ? {
                          ...prev,
                          waiverType: e.target.value,
                          tiebreakRule:
                            e.target.value === 'faab'
                              ? 'faab_highest'
                              : prev.tiebreakRule ?? 'priority_lowest_first',
                        }
                      : prev
                  )
                }
                className="mt-1 w-full rounded border border-white/20 bg-black/40 px-2 py-1.5 text-xs text-white"
                data-testid="commissioner-waiver-type-select"
              >
                {WAIVER_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-white/70">
              Processing day
              <select
                value={form.processingDayOfWeek ?? ''}
                onChange={(e) =>
                  setForm((prev) =>
                    prev
                      ? {
                          ...prev,
                          processingDayOfWeek: e.target.value === '' ? null : Number(e.target.value),
                        }
                      : prev
                  )
                }
                className="mt-1 w-full rounded border border-white/20 bg-black/40 px-2 py-1.5 text-xs text-white"
              >
                <option value="">None</option>
                {WEEKDAY_LABELS.map((label, day) => (
                  <option key={label} value={day}>{label}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-white/70">
              Processing time (UTC)
              <input
                type="time"
                value={form.processingTimeUtc ?? ''}
                onChange={(e) =>
                  setForm((prev) =>
                    prev
                      ? {
                          ...prev,
                          processingTimeUtc: e.target.value ? e.target.value : null,
                        }
                      : prev
                  )
                }
                className="mt-1 w-full rounded border border-white/20 bg-black/40 px-2 py-1.5 text-xs text-white"
              />
            </label>
            <label className="text-xs text-white/70">
              Claim limit per period
              <input
                type="number"
                min={0}
                value={form.claimLimitPerPeriod ?? ''}
                onChange={(e) =>
                  setForm((prev) =>
                    prev
                      ? {
                          ...prev,
                          claimLimitPerPeriod: e.target.value === '' ? null : Math.max(0, Number(e.target.value) || 0),
                        }
                      : prev
                  )
                }
                className="mt-1 w-full rounded border border-white/20 bg-black/40 px-2 py-1.5 text-xs text-white"
                placeholder="Unlimited"
              />
            </label>
            <label className="text-xs text-white/70">
              Claim priority
              <select
                value={form.tiebreakRule ?? ''}
                onChange={(e) =>
                  setForm((prev) => (prev ? { ...prev, tiebreakRule: e.target.value || null } : prev))
                }
                className="mt-1 w-full rounded border border-white/20 bg-black/40 px-2 py-1.5 text-xs text-white"
              >
                <option value="">Default</option>
                {CLAIM_PRIORITY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-white/70">
              Game lock
              <select
                value={form.lockType ?? ''}
                onChange={(e) =>
                  setForm((prev) => (prev ? { ...prev, lockType: e.target.value || null } : prev))
                }
                className="mt-1 w-full rounded border border-white/20 bg-black/40 px-2 py-1.5 text-xs text-white"
              >
                <option value="">Default</option>
                {GAME_LOCK_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            {form.waiverType === 'faab' && (
              <label className="text-xs text-white/70">
                FAAB budget
                <input
                  type="number"
                  min={0}
                  value={form.faabBudget ?? ''}
                  onChange={(e) =>
                    setForm((prev) =>
                      prev
                        ? {
                            ...prev,
                            faabBudget: e.target.value === '' ? null : Math.max(0, Number(e.target.value) || 0),
                          }
                        : prev
                    )
                  }
                  className="mt-1 w-full rounded border border-white/20 bg-black/40 px-2 py-1.5 text-xs text-white"
                  data-testid="commissioner-waiver-faab-budget-input"
                />
              </label>
            )}
            <label className="inline-flex items-center gap-2 text-xs text-white/70">
              <input
                type="checkbox"
                checked={form.instantFaAfterClear}
                onChange={(e) =>
                  setForm((prev) =>
                    prev ? { ...prev, instantFaAfterClear: e.target.checked } : prev
                  )
                }
                className="rounded border-white/20"
                data-testid="commissioner-waiver-instant-fa-toggle"
              />
              Instant free agents after clear
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setForm(toEditableForm(config))
                setEditing(false)
              }}
              data-testid="commissioner-waiver-cancel"
              className="rounded border border-white/20 px-3 py-1.5 text-xs text-white/80 hover:bg-white/10"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void saveOverrides()}
              data-testid="commissioner-waiver-save"
              className="rounded bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-500 disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save overrides'}
            </button>
          </div>
        </div>
      ) : null}

      <dl className="mt-4 grid gap-2 text-xs sm:grid-cols-2">
        <div>
          <dt className="text-white/50">Waiver type</dt>
          <dd className="text-white/90">{editing ? form.waiverType : config.waiver_type ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-white/50">Processing days</dt>
          <dd className="text-white/90">
            {Array.isArray(config.processing_days) && config.processing_days.length > 0
              ? config.processing_days.map((d) => WEEKDAY_LABELS[d] ?? d).join(', ')
              : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-white/50">Processing time (UTC)</dt>
          <dd className="text-white/90">{config.processing_time_utc ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-white/50">Claim limit per period</dt>
          <dd className="text-white/90">{config.claim_limit_per_period ?? 'Unlimited'}</dd>
        </div>
        <div>
          <dt className="text-white/50">Game lock</dt>
          <dd className="text-white/90">{config.game_lock_behavior ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-white/50">Free agent unlock</dt>
          <dd className="text-white/90">{config.free_agent_unlock_behavior ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-white/50">Continuous waivers</dt>
          <dd className="text-white/90">{config.continuous_waivers ? 'Yes' : 'No'}</dd>
        </div>
        <div>
          <dt className="text-white/50">FAAB enabled</dt>
          <dd className="text-white/90">{isFaab ? 'Yes' : 'No'}</dd>
        </div>
        {isFaab && (
          <div>
            <dt className="text-white/50">FAAB budget</dt>
            <dd className="text-white/90">{editing ? form.faabBudget ?? '—' : config.faab_budget ?? '—'}</dd>
          </div>
        )}
        {config.faab_reset_rules && (
          <div>
            <dt className="text-white/50">FAAB reset</dt>
            <dd className="text-white/90">{config.faab_reset_rules}</dd>
          </div>
        )}
        {config.tiebreak_rule && (
          <div>
            <dt className="text-white/50">Tiebreaker</dt>
            <dd className="text-white/90">{config.tiebreak_rule}</dd>
          </div>
        )}
        <div>
          <dt className="text-white/50">Instant FA after clear</dt>
          <dd className="text-white/90">{config.instant_fa_after_clear ? 'Yes' : 'No'}</dd>
        </div>
        {config.sport && (
          <div>
            <dt className="text-white/50">Sport / variant</dt>
            <dd className="text-white/90">{config.sport}{config.variant ? ` · ${config.variant}` : ''}</dd>
          </div>
        )}
      </dl>
    </section>
  )
}
