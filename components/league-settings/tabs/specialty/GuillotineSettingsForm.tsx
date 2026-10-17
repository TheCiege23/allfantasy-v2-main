'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { toast } from 'sonner'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { HubCard, HubChoices, HubSavingNote, HubToggle, rangeChoices } from '../hubFields'

/** Mirrors `GuillotineConfig` + the resolved endgame, as GET /specialty-settings returns it. */
export type GuillotineSettingsValue = {
  endgame: 'last_team_standing' | 'final_four' | 'final_three' | 'final_two'
  eliminationStartWeek: number
  eliminationEndWeek: number | null
  teamsPerChop: number
  correctionWindow: string
  statCorrectionHours: number | null
  tiebreakerOrder: string[]
  rosterReleaseTiming: string
  commissionerOverride: boolean
}

const TIEBREAK_STEPS = ['bench_points', 'season_points', 'previous_period', 'draft_slot', 'commissioner', 'random'] as const
const DEBOUNCE_MS = 450

/**
 * Guillotine rules, written to `GuillotineLeagueConfig` — the table the elimination engine reads —
 * through PATCH /api/leagues/[leagueId]/specialty-settings. Autosaves like every other hub field.
 */
export function GuillotineSettingsForm({
  leagueId,
  initial,
  canEdit,
}: {
  leagueId: string
  initial: GuillotineSettingsValue
  canEdit: boolean
}) {
  const { t } = useLanguage()
  const [value, setValue] = useState<GuillotineSettingsValue>(initial)
  const [saving, setSaving] = useState(false)
  const pending = useRef<Partial<GuillotineSettingsValue>>({})
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => setValue(initial), [initial])
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const flush = useCallback(async () => {
    const guillotine = pending.current
    pending.current = {}
    if (Object.keys(guillotine).length === 0) return
    setSaving(true)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/specialty-settings`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guillotine }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string; guillotine?: GuillotineSettingsValue | null }
      if (!res.ok) {
        toast.error(data.error ?? t('lsHub.sp.saveFailed'))
        return
      }
      if (data.guillotine) setValue(data.guillotine)
    } catch {
      toast.error(t('lsHub.sp.saveFailed'))
    } finally {
      setSaving(false)
    }
  }, [leagueId, t])

  const update = (patch: Partial<GuillotineSettingsValue>) => {
    if (!canEdit) return
    setValue((v) => ({ ...v, ...patch }))
    pending.current = { ...pending.current, ...patch }
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      void flush()
    }, DEBOUNCE_MS)
  }

  const moveStep = (index: number, delta: -1 | 1) => {
    const next = [...value.tiebreakerOrder]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target]!, next[index]!]
    update({ tiebreakerOrder: next })
  }
  const toggleStep = (step: string) => {
    const has = value.tiebreakerOrder.includes(step)
    if (has && value.tiebreakerOrder.length === 1) return // the engine needs at least one step
    update({ tiebreakerOrder: has ? value.tiebreakerOrder.filter((s) => s !== step) : [...value.tiebreakerOrder, step] })
  }

  const weeks = rangeChoices(1, 18, (n) => t('lsHub.ro.weekN').replace('{{n}}', String(n)))

  return (
    <div className="space-y-5" data-testid="specialty-guillotine-form">
      <HubCard title={t('lsHub.sp.g.schedule')}>
        <HubSavingNote saving={saving} text={t('lsHub.saving')} />
        <HubChoices
          label={t('lsHub.sp.g.endgame')}
          value={value.endgame}
          disabled={!canEdit}
          options={[
            { value: 'last_team_standing', label: t('lsHub.sp.g.lastTeam'), hint: t('lsHub.sp.g.lastTeamHint') },
            { value: 'final_four', label: t('lsHub.sp.g.finalN').replace('{{n}}', '4'), hint: t('lsHub.sp.g.finalHint') },
            { value: 'final_three', label: t('lsHub.sp.g.finalN').replace('{{n}}', '3'), hint: t('lsHub.sp.g.finalHint') },
            { value: 'final_two', label: t('lsHub.sp.g.finalN').replace('{{n}}', '2'), hint: t('lsHub.sp.g.finalHint') },
          ]}
          onChange={(endgame) => update({ endgame })}
        />
        <HubChoices
          label={t('lsHub.sp.g.chopsPerWeek')}
          value={value.teamsPerChop}
          disabled={!canEdit}
          options={rangeChoices(1, 4)}
          onChange={(teamsPerChop) => update({ teamsPerChop })}
        />
        <HubChoices
          label={t('lsHub.sp.g.startWeek')}
          value={value.eliminationStartWeek}
          disabled={!canEdit}
          options={weeks}
          onChange={(eliminationStartWeek) => update({ eliminationStartWeek })}
        />
        <HubChoices
          label={t('lsHub.sp.g.endWeek')}
          value={value.eliminationEndWeek ?? 0}
          disabled={!canEdit}
          options={[{ value: 0, label: t('lsHub.sp.g.seasonEnd') }, ...weeks.filter((w) => w.value >= value.eliminationStartWeek)]}
          onChange={(n) => update({ eliminationEndWeek: n === 0 ? null : n })}
        />
      </HubCard>

      <HubCard title={t('lsHub.sp.g.timing')}>
        <HubChoices
          label={t('lsHub.sp.g.correction')}
          value={value.correctionWindow}
          disabled={!canEdit}
          options={[
            { value: 'after_stat_corrections', label: t('lsHub.sp.g.afterCorrections'), hint: t('lsHub.sp.g.afterCorrectionsHint') },
            { value: 'immediate', label: t('lsHub.sp.g.immediate'), hint: t('lsHub.sp.g.immediateHint') },
          ]}
          onChange={(correctionWindow) => update({ correctionWindow })}
        />
        {value.correctionWindow === 'after_stat_corrections' ? (
          <HubChoices
            label={t('lsHub.sp.g.correctionHours')}
            value={value.statCorrectionHours ?? 48}
            disabled={!canEdit}
            options={[12, 24, 36, 48, 72].map((h) => ({ value: h, label: t('lsHub.sp.hoursN').replace('{{n}}', String(h)) }))}
            onChange={(statCorrectionHours) => update({ statCorrectionHours })}
          />
        ) : null}
        <HubChoices
          label={t('lsHub.sp.g.release')}
          value={value.rosterReleaseTiming}
          disabled={!canEdit}
          options={[
            { value: 'next_waiver_run', label: t('lsHub.sp.g.nextWaivers'), hint: t('lsHub.sp.g.nextWaiversHint') },
            { value: 'immediate', label: t('lsHub.sp.g.releaseNow'), hint: t('lsHub.sp.g.releaseNowHint') },
          ]}
          onChange={(rosterReleaseTiming) => update({ rosterReleaseTiming })}
        />
        <HubToggle
          label={t('lsHub.sp.g.override')}
          hint={t('lsHub.sp.g.overrideHint')}
          checked={value.commissionerOverride}
          disabled={!canEdit}
          onChange={(commissionerOverride) => update({ commissionerOverride })}
        />
      </HubCard>

      <HubCard title={t('lsHub.sp.g.tiebreakers')}>
        <p className="text-[11px] leading-relaxed text-white/45">{t('lsHub.sp.g.tiebreakersHint')}</p>
        <ol className="space-y-1.5">
          {value.tiebreakerOrder.map((step, i) => (
            <li key={step} className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-black/20 px-3 py-2">
              <span className="w-5 text-[12px] font-bold text-cyan-200/80">{i + 1}</span>
              <span className="flex-1 text-[13px] text-white/85">{t(`lsHub.sp.g.tb.${step}`)}</span>
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
                disabled={!canEdit || i === value.tiebreakerOrder.length - 1}
                onClick={() => moveStep(i, 1)}
                className="rounded-lg p-1.5 text-white/55 hover:bg-white/[0.06] hover:text-white disabled:opacity-30"
              >
                <ArrowDown className="h-3.5 w-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-1.5">
          {TIEBREAK_STEPS.map((step) => {
            const on = value.tiebreakerOrder.includes(step)
            return (
              <button
                key={step}
                type="button"
                aria-pressed={on}
                disabled={!canEdit}
                onClick={() => toggleStep(step)}
                className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition disabled:opacity-50 ${
                  on ? 'border-cyan-400/50 bg-cyan-500/10 text-cyan-100' : 'border-white/[0.10] text-white/50 hover:text-white/80'
                }`}
              >
                {on ? '✓ ' : '+ '}
                {t(`lsHub.sp.g.tb.${step}`)}
              </button>
            )
          })}
        </div>
      </HubCard>
    </div>
  )
}
