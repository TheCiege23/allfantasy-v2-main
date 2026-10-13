'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Lock } from 'lucide-react'
import { toast } from 'sonner'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { HubCard, HubChoices, HubSavingNote, HubToggle } from '../hubFields'

/** Mirrors `LegacyTournamentEditorValue` in lib/tournament-mode/legacyTournamentEditor.ts. */
export type LegacyTournamentSettingsValue = {
  name: string
  description: string
  draftType: 'snake' | 'auction'
  bubbleWeekEnabled: boolean
  eliminationAdvancementPerLeague: number
  qualificationTiebreakers: string[]
  faabBudgetDefault: number
  faabResetByRound: boolean
  benchSpotsElimination: number
}

/** As GET/PATCH /specialty-settings return it under `legacyTournament`. */
export type LegacyTournamentSettingsState = {
  tournamentId: string
  canEdit: boolean
  value: LegacyTournamentSettingsValue
  conferences: Array<{ id: string; name: string }>
  overview: { sport: string; season: number; status: string; phase: string; roundIndex: number; conferenceName: string; leagueCount: number }
  locked: boolean
  live: boolean
}

type Patch = Partial<LegacyTournamentSettingsValue> & { conferenceNames?: Array<{ id: string; name: string }> }

const TIEBREAK_KEYS = ['wins', 'points_for', 'points_against', 'head_to_head'] as const
const PHASES = ['qualification', 'elimination', 'elite_eight', 'championship'] as const
const DEBOUNCE_MS = 450

function presets(values: number[], current: number, label: (n: number) => string = String) {
  const all = values.includes(current) ? values : [...values, current].sort((a, b) => a - b)
  return all.map((n) => ({ value: n, label: label(n) }))
}

/** A text field (or textarea) that saves when it loses focus. */
function TextField({
  label,
  value,
  disabled,
  maxLength,
  multiline,
  allowEmpty,
  numeric,
  onCommit,
}: {
  label: string
  value: string
  disabled?: boolean
  maxLength: number
  multiline?: boolean
  allowEmpty?: boolean
  numeric?: boolean
  onCommit: (v: string) => void
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = () => {
    const v = multiline ? draft : draft.trim()
    if (!v.trim() && !allowEmpty) {
      setDraft(value)
      return
    }
    if (v !== value) onCommit(v)
  }
  const cls =
    'w-full rounded-xl border border-white/[0.10] bg-black/30 px-3 py-2 text-[13px] text-white outline-none focus:border-cyan-400/50 disabled:opacity-50'
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-white/40">{label}</span>
      {multiline ? (
        <textarea rows={3} value={draft} disabled={disabled} maxLength={maxLength} onChange={(e) => setDraft(e.target.value)} onBlur={commit} className={cls} />
      ) : (
        <input
          type="text"
          inputMode={numeric ? 'numeric' : undefined}
          value={draft}
          disabled={disabled}
          maxLength={maxLength}
          onChange={(e) => setDraft(numeric ? e.target.value.replace(/[^0-9]/g, '') : e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
          className={cls}
        />
      )}
    </label>
  )
}

/**
 * A legacy tournament's rules, saved through PATCH /api/leagues/[leagueId]/specialty-settings into
 * `LegacyTournament.settings` — only the keys the tournament-mode engine reads. Structure (pool
 * size, qualification weeks, conference mode) stays in the tournament hub.
 */
export function LegacyTournamentSettingsForm({ leagueId, initial }: { leagueId: string; initial: LegacyTournamentSettingsState }) {
  const { t } = useLanguage()
  const [state, setState] = useState<LegacyTournamentSettingsState>(initial)
  const [saving, setSaving] = useState(false)
  const saved = useRef<LegacyTournamentSettingsState>(initial)
  const pending = useRef<Patch>({})
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const canEdit = state.canEdit

  useEffect(() => {
    setState(initial)
    saved.current = initial
  }, [initial])
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const flush = useCallback(async () => {
    const legacyTournament = pending.current
    pending.current = {}
    if (Object.keys(legacyTournament).length === 0) return
    setSaving(true)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/specialty-settings`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ legacyTournament }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string; legacyTournament?: LegacyTournamentSettingsState | null }
      if (!res.ok || !data.legacyTournament) {
        toast.error(data.error ?? t('lsHub.sp.saveFailed'))
        setState(saved.current)
        return
      }
      saved.current = data.legacyTournament
      setState(data.legacyTournament)
    } catch {
      toast.error(t('lsHub.sp.saveFailed'))
      setState(saved.current)
    } finally {
      setSaving(false)
    }
  }, [leagueId, t])

  const update = (patch: Patch) => {
    if (!canEdit) return
    const { conferenceNames, ...value } = patch
    setState((s) => ({
      ...s,
      value: { ...s.value, ...value },
      conferences: conferenceNames
        ? s.conferences.map((c) => ({ ...c, name: conferenceNames.find((n) => n.id === c.id)?.name ?? c.name }))
        : s.conferences,
    }))
    const prevNames = pending.current.conferenceNames ?? []
    pending.current = {
      ...pending.current,
      ...value,
      ...(conferenceNames
        ? { conferenceNames: [...prevNames.filter((p) => !conferenceNames.some((n) => n.id === p.id)), ...conferenceNames] }
        : {}),
    }
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      void flush()
    }, DEBOUNCE_MS)
  }

  const v = state.value
  const o = state.overview
  const order = v.qualificationTiebreakers

  const moveStep = (index: number, delta: -1 | 1) => {
    const next = [...order]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target]!, next[index]!]
    update({ qualificationTiebreakers: next })
  }
  const toggleStep = (key: string) => {
    const has = order.includes(key)
    if (has && order.length === 1) return // the engine needs at least one step
    update({ qualificationTiebreakers: has ? order.filter((k) => k !== key) : [...order, key] })
  }

  return (
    <div className="space-y-5" data-testid="specialty-legacy-tournament-form">
      <HubCard title={t('lsHub.sp.tn.overview')}>
        <HubSavingNote saving={saving} text={t('lsHub.saving')} />
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12px]">
          {[
            [t('lsHub.sp.lt.phase'), (PHASES as readonly string[]).includes(o.phase) ? t(`lsHub.sp.lt.phase.${o.phase}`) : o.phase],
            [t('lsHub.sp.tn.thisLeague'), o.conferenceName],
            [t('lsHub.sp.lt.leagues'), String(o.leagueCount)],
            [t('lsHub.sp.tn.sport'), `${o.sport} · ${o.season}`],
          ].map(([k, val]) => (
            <div key={k} className="min-w-0">
              <dt className="text-[11px] font-bold uppercase tracking-wide text-white/40">{k}</dt>
              <dd className="truncate text-white/85">{val}</dd>
            </div>
          ))}
        </dl>
        <p className="text-[11px] leading-relaxed text-white/45">{t('lsHub.sp.lt.structureHint')}</p>
        <Link
          href={`/tournament/${state.tournamentId}`}
          className="inline-flex text-[12px] font-semibold text-cyan-200 underline-offset-2 hover:underline"
          data-testid="specialty-tournament-hub-link"
        >
          {t('lsHub.sp.t.open')}
        </Link>
      </HubCard>

      {!canEdit ? (
        <p className="flex items-start gap-2 text-[12px] leading-relaxed text-white/55" data-testid="legacy-tournament-readonly">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white/35" aria-hidden />
          {t('lsHub.sp.lt.readOnly')}
        </p>
      ) : null}

      <HubCard title={t('lsHub.sp.lt.identity')}>
        {state.locked ? <p className="text-[11px] leading-relaxed text-white/45">{t('lsHub.sp.lt.lockedHint')}</p> : null}
        <TextField label={t('lsHub.sp.tn.name')} value={v.name} disabled={!canEdit || state.locked} maxLength={120} onCommit={(name) => update({ name })} />
        <TextField
          label={t('lsHub.sp.lt.description')}
          value={v.description}
          disabled={!canEdit || state.locked}
          maxLength={1500}
          multiline
          allowEmpty
          onCommit={(description) => update({ description })}
        />
      </HubCard>

      <HubCard title={t('lsHub.sp.tn.cut')}>
        <HubChoices
          label={t('lsHub.sp.lt.advancers')}
          value={v.eliminationAdvancementPerLeague}
          disabled={!canEdit}
          options={presets([2, 4, 6, 8], v.eliminationAdvancementPerLeague)}
          onChange={(eliminationAdvancementPerLeague) => update({ eliminationAdvancementPerLeague })}
        />
        <HubToggle
          label={t('lsHub.sp.lt.bubble')}
          hint={state.live ? t('lsHub.sp.lt.liveHint') : t('lsHub.sp.lt.bubbleHint')}
          checked={v.bubbleWeekEnabled}
          disabled={!canEdit || state.live}
          onChange={(bubbleWeekEnabled) => update({ bubbleWeekEnabled })}
        />
        <div>
          <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-white/40">{t('lsHub.sp.tn.tiebreaker')}</span>
          <ol className="space-y-1.5">
            {order.map((key, i) => (
              <li key={key} className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-black/20 px-3 py-2">
                <span className="w-5 text-[12px] font-bold text-cyan-200/80">{i + 1}</span>
                <span className="flex-1 text-[13px] text-white/85">{t(`lsHub.sp.lt.tb.${key}`)}</span>
                <button
                  type="button"
                  aria-label={t('lsHub.sp.moveUp')}
                  disabled={!canEdit || i === 0}
                  onClick={() => moveStep(i, -1)}
                  className="rounded-lg p-1.5 text-white/55 hover:bg-white/[0.06] hover:text-white disabled:opacity-30"
                >
                  <ArrowUp className="h-3.5 w-3.5" aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label={t('lsHub.sp.moveDown')}
                  disabled={!canEdit || i === order.length - 1}
                  onClick={() => moveStep(i, 1)}
                  className="rounded-lg p-1.5 text-white/55 hover:bg-white/[0.06] hover:text-white disabled:opacity-30"
                >
                  <ArrowDown className="h-3.5 w-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ol>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {TIEBREAK_KEYS.map((key) => {
              const on = order.includes(key)
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={on}
                  disabled={!canEdit}
                  onClick={() => toggleStep(key)}
                  className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition disabled:opacity-50 ${
                    on ? 'border-cyan-400/50 bg-cyan-500/10 text-cyan-100' : 'border-white/[0.10] text-white/50 hover:text-white/80'
                  }`}
                >
                  {on ? '✓ ' : '+ '}
                  {t(`lsHub.sp.lt.tb.${key}`)}
                </button>
              )
            })}
          </div>
        </div>
      </HubCard>

      <HubCard title={t('lsHub.sp.lt.rounds')}>
        <HubChoices
          label={t('lsHub.sp.lt.draftType')}
          value={v.draftType}
          disabled={!canEdit || state.live}
          options={[
            { value: 'snake', label: t('lsHub.sp.sc.snake') },
            { value: 'auction', label: t('lsHub.sp.sc.auction') },
          ]}
          onChange={(draftType) => update({ draftType })}
        />
        {state.live ? <p className="text-[11px] leading-relaxed text-white/45">{t('lsHub.sp.lt.liveHint')}</p> : null}
        <TextField
          label={t('lsHub.sp.lt.faab')}
          value={String(v.faabBudgetDefault)}
          disabled={!canEdit}
          maxLength={5}
          numeric
          onCommit={(s) => update({ faabBudgetDefault: Number(s) })}
        />
        <HubToggle
          label={t('lsHub.sp.lt.faabReset')}
          hint={t('lsHub.sp.lt.faabResetHint')}
          checked={v.faabResetByRound}
          disabled={!canEdit}
          onChange={(faabResetByRound) => update({ faabResetByRound })}
        />
        <HubChoices
          label={t('lsHub.sp.lt.bench')}
          value={v.benchSpotsElimination}
          disabled={!canEdit}
          options={presets([0, 1, 2, 3, 4, 6], v.benchSpotsElimination)}
          onChange={(benchSpotsElimination) => update({ benchSpotsElimination })}
        />
      </HubCard>

      {state.conferences.length > 0 ? (
        <HubCard title={t('lsHub.sp.tn.conferences')}>
          {state.conferences.map((c) => (
            <TextField
              key={c.id}
              label={t('lsHub.sp.tn.conference')}
              value={c.name}
              disabled={!canEdit}
              maxLength={64}
              onCommit={(name) => update({ conferenceNames: [{ id: c.id, name }] })}
            />
          ))}
        </HubCard>
      ) : null}
    </div>
  )
}
