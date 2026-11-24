'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { toLocalDateTimeInput } from '@/lib/tournament/tournamentWords'
import type {
  DraftPhaseKey,
  DraftScheduleV1,
  PhaseDraftPlan,
  PhaseScheduleFields,
} from '@/lib/tournament/draft-schedule-types'
import {
  DRAFT_PHASE_KEYS,
  defaultDraftScheduleV1,
  defaultPhaseSchedule,
} from '@/lib/tournament/draft-schedule-types'

type Feeder = { leagueId: string; name: string }

function mergeSchedule(
  raw: unknown,
  feeders: Feeder[],
): DraftScheduleV1 {
  const base = defaultDraftScheduleV1()
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const o = raw as DraftScheduleV1
    if (o.phases && typeof o.phases === 'object') {
      base.phases = { ...base.phases, ...o.phases }
    }
  }
  for (const k of DRAFT_PHASE_KEYS) {
    const ph = base.phases[k]
    if (!ph) continue
    if (ph.mode === 'per_league' && ph.perLeague && feeders.length) {
      const next: Record<string, PhaseScheduleFields> = { ...ph.perLeague }
      for (const f of feeders) {
        if (!next[f.leagueId]) next[f.leagueId] = defaultPhaseSchedule()
      }
      base.phases[k] = { ...ph, perLeague: next }
    }
  }
  return base
}

export function TournamentDraftSchedulePanel({
  tournamentId,
  feeders,
  draftScheduleV1,
  canEdit,
  onSaved,
}: {
  tournamentId: string
  feeders: Feeder[]
  draftScheduleV1: unknown | null
  canEdit: boolean
  onSaved: () => void
}) {
  const { t } = useLanguage()
  const [phase, setPhase] = useState<DraftPhaseKey>('startup')
  const [model, setModel] = useState<DraftScheduleV1>(() => mergeSchedule(draftScheduleV1, feeders))

  useEffect(() => {
    setModel(mergeSchedule(draftScheduleV1, feeders))
  }, [draftScheduleV1, feeders])

  const plan = useMemo((): PhaseDraftPlan => {
    const p = model.phases[phase]
    if (p) return p
    return {
      mode: 'uniform',
      uniform: defaultPhaseSchedule(),
      perLeague: {},
      groups: [],
    }
  }, [model.phases, phase])

  const updatePlan = useCallback(
    (next: PhaseDraftPlan) => {
      setModel((m) => ({
        ...m,
        phases: { ...m.phases, [phase]: next },
      }))
    },
    [phase],
  )

  const save = useCallback(async () => {
    if (!canEdit) return
    try {
      const res = await fetch(`/api/tournament/${encodeURIComponent(tournamentId)}/legacy-settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hubSettings: { draftScheduleV1: model } }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(typeof j.error === 'string' ? j.error : t('tournament.draftSchedule.error.save'))
        return
      }
      toast.success(t('tournament.draftSchedule.toast.saved'))
      onSaved()
    } catch {
      toast.error(t('tournament.draftSchedule.error.network'))
    }
  }, [canEdit, model, onSaved, t, tournamentId])

  function applyUniformToAll() {
    const u = plan.uniform ?? defaultPhaseSchedule()
    const per: Record<string, PhaseScheduleFields> = {}
    for (const f of feeders) {
      per[f.leagueId] = { ...u }
    }
    updatePlan({ ...plan, mode: 'per_league', perLeague: per })
    toast.message(t('tournament.draftSchedule.toast.uniformApplied'))
  }

  function applySelectedGroup(selectedIds: string[]) {
    if (selectedIds.length === 0) {
      toast.error(t('tournament.draftSchedule.error.selectLeague'))
      return
    }
    const u = plan.uniform ?? defaultPhaseSchedule()
    const groups = plan.groups?.length ? [...plan.groups] : []
    const id = `g-${Date.now()}`
    groups.push({ id, leagueIds: selectedIds, schedule: { ...u } })
    updatePlan({ ...plan, mode: 'grouped', groups })
    toast.success(t('tournament.draftSchedule.toast.groupSaved'))
  }

  return (
    <div className="space-y-4 text-sm text-white/80" data-testid="tournament-draft-schedule-panel">
      <div className="flex flex-wrap gap-2">
        {DRAFT_PHASE_KEYS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setPhase(k)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              phase === k ? 'bg-cyan-500/20 text-cyan-100 ring-1 ring-cyan-400/35' : 'bg-white/5 text-white/55 hover:bg-white/10'
            }`}
          >
            {t(`tournament.draftPhase.${k}`)}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-white/10 bg-black/20 p-4">
        <label className="block text-[11px] font-bold uppercase tracking-wide text-white/45">
          {t('tournament.draftSchedule.schedulingMode')}
        </label>
        <select
          className="mt-2 w-full max-w-md rounded-lg border border-white/10 bg-[#0c1220] px-3 py-2 text-sm text-white"
          value={plan.mode}
          disabled={!canEdit}
          onChange={(e) => {
            const mode = e.target.value as PhaseDraftPlan['mode']
            const next: PhaseDraftPlan = {
              ...plan,
              mode,
              uniform: plan.uniform ?? defaultPhaseSchedule(),
              perLeague: plan.perLeague ?? {},
              groups: plan.groups ?? [],
            }
            updatePlan(next)
          }}
        >
          <option value="uniform">{t('tournament.draftSchedule.mode.uniform')}</option>
          <option value="per_league">{t('tournament.draftSchedule.mode.perLeague')}</option>
          <option value="grouped">{t('tournament.draftSchedule.mode.grouped')}</option>
        </select>

        <div className="mt-4 space-y-2 rounded-lg border border-white/5 bg-white/[0.02] p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-white/40">
            {t('tournament.draftSchedule.uniformClock')}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs text-white/55">
              {t('tournament.draftSchedule.startLocal')}
              <input
                type="datetime-local"
                className="mt-1 w-full rounded-lg border border-white/10 bg-[#0c1220] px-2 py-1.5 text-white"
                disabled={!canEdit}
                value={toLocalDateTimeInput(plan.uniform?.scheduledAt)}
                onChange={(e) => {
                  const v = e.target.value
                  updatePlan({
                    ...plan,
                    uniform: {
                      ...(plan.uniform ?? defaultPhaseSchedule()),
                      scheduledAt: v ? new Date(v).toISOString() : null,
                      status: v ? 'scheduled' : 'unset',
                    },
                  })
                }}
              />
            </label>
            <label className="block text-xs text-white/55">
              {t('tournament.draftSchedule.ianaTimezone')}
              <input
                className="mt-1 w-full rounded-lg border border-white/10 bg-[#0c1220] px-2 py-1.5 text-white"
                disabled={!canEdit}
                value={plan.uniform?.timezone ?? 'America/New_York'}
                onChange={(e) =>
                  updatePlan({
                    ...plan,
                    uniform: { ...(plan.uniform ?? defaultPhaseSchedule()), timezone: e.target.value },
                  })
                }
              />
            </label>
            <label className="block text-xs text-white/55">
              {t('tournament.draftSchedule.pickTimerSec')}
              <input
                type="number"
                min={10}
                max={600}
                className="mt-1 w-full rounded-lg border border-white/10 bg-[#0c1220] px-2 py-1.5 text-white"
                disabled={!canEdit}
                value={plan.uniform?.pickTimerSec ?? 90}
                onChange={(e) =>
                  updatePlan({
                    ...plan,
                    uniform: {
                      ...(plan.uniform ?? defaultPhaseSchedule()),
                      pickTimerSec: Number(e.target.value) || 90,
                    },
                  })
                }
              />
            </label>
            <label className="block text-xs text-white/55">
              {t('tournament.draftSchedule.draftMode')}
              <select
                className="mt-1 w-full rounded-lg border border-white/10 bg-[#0c1220] px-2 py-1.5 text-white"
                disabled={!canEdit}
                value={plan.uniform?.draftMode ?? 'snake'}
                onChange={(e) =>
                  updatePlan({
                    ...plan,
                    uniform: { ...(plan.uniform ?? defaultPhaseSchedule()), draftMode: e.target.value },
                  })
                }
              >
                <option value="snake">{t('tournament.draftSchedule.draftMode.snake')}</option>
                <option value="linear">{t('tournament.draftSchedule.draftMode.linear')}</option>
                <option value="auction">{t('tournament.draftSchedule.draftMode.auction')}</option>
              </select>
            </label>
          </div>
          <div className="flex flex-wrap gap-2 pt-2">
            <button
              type="button"
              disabled={!canEdit || plan.mode !== 'uniform'}
              onClick={() => applyUniformToAll()}
              className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold text-cyan-100 hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t('tournament.draftSchedule.applyTemplatePerLeague')}
            </button>
          </div>
        </div>

        {plan.mode === 'per_league' && feeders.length > 0 ? (
          <div className="mt-4 overflow-x-auto">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-white/40">
              {t('tournament.draftSchedule.perLeagueClocks')}
            </p>
            <table className="w-full min-w-[520px] text-left text-xs">
              <thead>
                <tr className="border-b border-white/10 text-white/45">
                  <th className="py-2 pr-2">{t('tournament.draftSchedule.col.league')}</th>
                  <th className="py-2">{t('tournament.draftSchedule.col.start')}</th>
                  <th className="py-2">{t('tournament.draftSchedule.col.status')}</th>
                </tr>
              </thead>
              <tbody>
                {feeders.map((f) => {
                  const row = plan.perLeague?.[f.leagueId] ?? defaultPhaseSchedule()
                  return (
                    <tr key={f.leagueId} className="border-b border-white/5">
                      <td className="py-2 pr-2 font-medium text-white/85">{f.name}</td>
                      <td className="py-2">
                        <input
                          type="datetime-local"
                          className="rounded border border-white/10 bg-[#0c1220] px-2 py-1 text-white"
                          disabled={!canEdit}
                          value={toLocalDateTimeInput(row.scheduledAt)}
                          onChange={(e) => {
                            const v = e.target.value
                            const nextStatus: PhaseScheduleFields['status'] = v ? 'scheduled' : 'unset'
                            const next: Record<string, PhaseScheduleFields> = {
                              ...(plan.perLeague ?? {}),
                              [f.leagueId]: {
                                ...row,
                                scheduledAt: v ? new Date(v).toISOString() : null,
                                status: nextStatus,
                              },
                            }
                            updatePlan({ ...plan, perLeague: next })
                          }}
                        />
                      </td>
                      <td className="py-2 text-white/50">{row.status}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : null}

        {plan.mode === 'grouped' && feeders.length > 0 ? (
          <GroupedLeaguePicker
            feeders={feeders}
            canEdit={canEdit}
            onCommit={(ids) => applySelectedGroup(ids)}
          />
        ) : null}
      </div>

      <button
        type="button"
        disabled={!canEdit}
        onClick={() => void save()}
        className="rounded-xl border border-cyan-500/35 bg-cyan-500/15 px-4 py-2.5 text-sm font-semibold text-cyan-50 hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-40"
        data-testid="tournament-draft-schedule-save"
      >
        {t('tournament.draftSchedule.saveButton')}
      </button>
    </div>
  )
}

function GroupedLeaguePicker({
  feeders,
  canEdit,
  onCommit,
}: {
  feeders: Feeder[]
  canEdit: boolean
  onCommit: (ids: string[]) => void
}) {
  const { t } = useLanguage()
  const [sel, setSel] = useState<Record<string, boolean>>({})
  const toggle = (id: string) => setSel((s) => ({ ...s, [id]: !s[id] }))
  const selected = useMemo(() => Object.keys(sel).filter((k) => sel[k]), [sel])

  return (
    <div className="mt-4 rounded-lg border border-amber-500/20 bg-amber-950/10 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-200/80">
        {t('tournament.draftSchedule.groupBatch')}
      </p>
      <p className="mt-1 text-xs text-white/50">{t('tournament.draftSchedule.groupBatchHint')}</p>
      <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto">
        {feeders.map((f) => (
          <li key={f.leagueId}>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-white/75">
              <input
                type="checkbox"
                className="rounded border-white/20"
                disabled={!canEdit}
                checked={Boolean(sel[f.leagueId])}
                onChange={() => toggle(f.leagueId)}
              />
              {f.name}
            </label>
          </li>
        ))}
      </ul>
      <button
        type="button"
        disabled={!canEdit || selected.length === 0}
        onClick={() => onCommit(selected)}
        className="mt-3 rounded-lg border border-amber-500/35 bg-amber-500/15 px-3 py-1.5 text-xs font-semibold text-amber-100 hover:bg-amber-500/25 disabled:opacity-40"
      >
        {t('tournament.draftSchedule.applyGroup')}
      </button>
    </div>
  )
}
