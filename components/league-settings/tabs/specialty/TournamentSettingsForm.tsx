'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Info, Lock } from 'lucide-react'
import { toast } from 'sonner'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { HubCard, HubChoices, HubSavingNote, HubToggle } from '../hubFields'

/** Mirrors `TournamentEditorValue` in lib/tournament/tournamentEditorPatch.ts. */
export type TournamentSettingsValue = {
  name: string
  advancersPerLeague: number
  wildcardCount: number
  bubbleEnabled: boolean
  bubbleSize: number
  tiebreakerMode: string
}

/** As GET/PATCH /specialty-settings return it under `tournament`. */
export type TournamentSettingsState = {
  tournamentId: string
  canEdit: boolean
  value: TournamentSettingsValue
  conferences: Array<{ id: string; name: string; isActive: boolean }>
  overview: {
    sport: string
    status: string
    currentRoundNumber: number
    totalRounds: number
    conferenceCount: number
    leaguesPerConference: number
    teamsPerLeague: number
    thisLeague: { roundLabel: string; conferenceName: string | null }
  }
  alreadyAdvanced: boolean
}

type Patch = Partial<TournamentSettingsValue> & { conferenceNames?: Array<{ id: string; name: string }> }

const DEBOUNCE_MS = 450

function presets(values: number[], current: number) {
  const all = values.includes(current) ? values : [...values, current].sort((a, b) => a - b)
  return all.map((n) => ({ value: n, label: String(n) }))
}

/** A text field that saves when it loses focus (or on Enter). */
function TextField({
  label,
  value,
  disabled,
  maxLength,
  onCommit,
  testId,
}: {
  label: string
  value: string
  disabled?: boolean
  maxLength: number
  onCommit: (v: string) => void
  testId?: string
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = () => {
    const v = draft.trim()
    if (!v) {
      setDraft(value)
      return
    }
    if (v !== value) onCommit(v)
  }
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-white/40">{label}</span>
      <input
        type="text"
        data-testid={testId}
        value={draft}
        disabled={disabled}
        maxLength={maxLength}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
        className="w-full rounded-xl border border-white/[0.10] bg-black/30 px-3 py-2 text-[13px] text-white outline-none focus:border-cyan-400/50 disabled:opacity-50"
      />
    </label>
  )
}

/**
 * The tournament's cut, bubble, tiebreaker, name and conference names, saved through
 * PATCH /api/leagues/[leagueId]/specialty-settings into lib/tournament/updateTournamentSettings.
 * The tournament's structure (conferences, leagues, teams per league) is shown, not edited: it
 * changes only through a rebalance in the tournament hub.
 */
export function TournamentSettingsForm({ leagueId, initial }: { leagueId: string; initial: TournamentSettingsState }) {
  const { t } = useLanguage()
  const [state, setState] = useState<TournamentSettingsState>(initial)
  const [saving, setSaving] = useState(false)
  const saved = useRef<TournamentSettingsState>(initial)
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
    const tournament = pending.current
    pending.current = {}
    if (Object.keys(tournament).length === 0) return
    setSaving(true)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/specialty-settings`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tournament }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string; tournament?: TournamentSettingsState | null }
      if (!res.ok || !data.tournament) {
        toast.error(data.error ?? t('lsHub.sp.saveFailed'))
        setState(saved.current)
        return
      }
      saved.current = data.tournament
      setState(data.tournament)
      if (data.tournament.alreadyAdvanced) toast.message(t('lsHub.sp.tn.savedAfterAdvance'))
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

  return (
    <div className="space-y-5" data-testid="specialty-tournament-form">
      <HubCard title={t('lsHub.sp.tn.overview')}>
        <HubSavingNote saving={saving} text={t('lsHub.saving')} />
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12px]">
          {[
            [t('lsHub.sp.tn.round'), t('lsHub.sp.tn.roundOf').replace('{{n}}', String(o.currentRoundNumber)).replace('{{total}}', String(o.totalRounds))],
            [t('lsHub.sp.tn.thisLeague'), o.thisLeague.conferenceName ? `${o.thisLeague.roundLabel} · ${o.thisLeague.conferenceName}` : o.thisLeague.roundLabel],
            [t('lsHub.sp.tn.structure'), t('lsHub.sp.tn.structureLine')
              .replace('{{c}}', String(o.conferenceCount))
              .replace('{{l}}', String(o.leaguesPerConference))
              .replace('{{t}}', String(o.teamsPerLeague))],
            [t('lsHub.sp.tn.sport'), o.sport],
          ].map(([k, val]) => (
            <div key={k} className="min-w-0">
              <dt className="text-[11px] font-bold uppercase tracking-wide text-white/40">{k}</dt>
              <dd className="truncate text-white/85">{val}</dd>
            </div>
          ))}
        </dl>
        <p className="text-[11px] leading-relaxed text-white/45">{t('lsHub.sp.tn.structureHint')}</p>
        <Link
          href={`/tournament/${state.tournamentId}`}
          className="inline-flex text-[12px] font-semibold text-cyan-200 underline-offset-2 hover:underline"
          data-testid="specialty-tournament-hub-link"
        >
          {t('lsHub.sp.t.open')}
        </Link>
      </HubCard>

      {!canEdit ? (
        <p className="flex items-start gap-2 text-[12px] leading-relaxed text-white/55" data-testid="tournament-readonly">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white/35" aria-hidden />
          {t('lsHub.sp.tn.readOnly')}
        </p>
      ) : null}
      {state.alreadyAdvanced ? (
        <p className="flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-[12px] leading-relaxed text-amber-100">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {t('lsHub.sp.tn.advancedNote')}
        </p>
      ) : null}

      <HubCard title={t('lsHub.sp.tn.cut')}>
        <TextField
          label={t('lsHub.sp.tn.name')}
          value={v.name}
          disabled={!canEdit}
          maxLength={120}
          onCommit={(name) => update({ name })}
          testId="tournament-name"
        />
        <HubChoices
          label={t('lsHub.sp.tn.advancers')}
          value={v.advancersPerLeague}
          disabled={!canEdit}
          options={presets([0, 1, 2, 3, 4], v.advancersPerLeague)}
          onChange={(advancersPerLeague) => update({ advancersPerLeague })}
        />
        <HubChoices
          label={t('lsHub.sp.tn.wildcards')}
          value={v.wildcardCount}
          disabled={!canEdit}
          options={presets([0, 1, 2, 4, 6, 8], v.wildcardCount)}
          onChange={(wildcardCount) => update({ wildcardCount })}
        />
        <p className="text-[11px] leading-relaxed text-white/45">{t('lsHub.sp.tn.wildcardsHint')}</p>
        <HubChoices
          label={t('lsHub.sp.tn.tiebreaker')}
          value={v.tiebreakerMode}
          disabled={!canEdit}
          options={[
            { value: 'points_for', label: t('lsHub.sp.tn.tbPointsFor'), hint: t('lsHub.sp.tn.tbPointsForHint') },
            { value: 'points_against_inverse', label: t('lsHub.sp.tn.tbPointsAgainst'), hint: t('lsHub.sp.tn.tbPointsAgainstHint') },
          ]}
          onChange={(tiebreakerMode) => update({ tiebreakerMode })}
        />
      </HubCard>

      <HubCard title={t('lsHub.sp.tn.bubble')}>
        <HubToggle
          label={t('lsHub.sp.tn.bubbleOn')}
          hint={t('lsHub.sp.tn.bubbleHint')}
          checked={v.bubbleEnabled}
          disabled={!canEdit}
          onChange={(bubbleEnabled) => update({ bubbleEnabled })}
        />
        {v.bubbleEnabled ? (
          <HubChoices
            label={t('lsHub.sp.tn.bubbleSize')}
            value={v.bubbleSize}
            disabled={!canEdit}
            options={presets([4, 8, 12, 16], v.bubbleSize)}
            onChange={(bubbleSize) => update({ bubbleSize })}
          />
        ) : null}
      </HubCard>

      {state.conferences.length > 0 ? (
        <HubCard title={t('lsHub.sp.tn.conferences')}>
          {state.conferences.map((c) => (
            <TextField
              key={c.id}
              label={c.isActive ? t('lsHub.sp.tn.conference') : t('lsHub.sp.tn.conferenceInactive')}
              value={c.name}
              disabled={!canEdit}
              maxLength={60}
              onCommit={(name) => update({ conferenceNames: [{ id: c.id, name }] })}
            />
          ))}
        </HubCard>
      ) : null}
    </div>
  )
}
