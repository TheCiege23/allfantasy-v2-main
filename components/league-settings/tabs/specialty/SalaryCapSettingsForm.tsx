'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Lock } from 'lucide-react'
import { toast } from 'sonner'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { HubCard, HubChoices, HubSavingNote, HubToggle, rangeChoices } from '../hubFields'

/** Mirrors `SalaryCapSettingsValue` in lib/salary-cap/salaryCapSettingsPatch.ts. */
export type SalaryCapSettingsValue = {
  mode: string
  startupCap: number
  capGrowthPercent: number
  capFloorEnabled: boolean
  capFloorAmount: number | null
  contractMinYears: number
  contractMaxYears: number
  rookieContractYears: number
  minimumSalary: number
  deadMoneyEnabled: boolean
  deadMoneyPercentPerYear: number
  rolloverEnabled: boolean
  rolloverMax: number
  extensionsEnabled: boolean
  franchiseTagEnabled: boolean
  startupDraftType: 'auction' | 'snake'
  auctionHoldback: number
  futureDraftType: 'snake' | 'auction' | 'weighted_lottery'
}

export type CapTeamRow = {
  rosterId: string
  name: string
  cap: number
  capHit: number
  capSpace: number
  overCap: boolean
  belowFloor: boolean
}

/** As GET/PATCH /specialty-settings return it under `salaryCap`. */
export type SalaryCapSettingsState = {
  value: SalaryCapSettingsValue
  startupLocked: boolean
  capYear: number
  teams: CapTeamRow[]
}

const DEBOUNCE_MS = 450

/** Preset pills, plus the saved value when a league was created with one off the list. */
function presets(values: number[], current: number, label: (n: number) => string) {
  const all = values.includes(current) ? values : [...values, current].sort((a, b) => a - b)
  return all.map((n) => ({ value: n, label: label(n) }))
}

/** A whole-dollar field that saves when it loses focus (or on Enter), not on every keystroke. */
function MoneyField({
  label,
  hint,
  value,
  disabled,
  onCommit,
  testId,
}: {
  label: string
  hint?: string
  value: number
  disabled?: boolean
  onCommit: (n: number) => void
  testId?: string
}) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const commit = () => {
    const n = Number(draft)
    if (draft.trim() === '' || !Number.isInteger(n) || n < 0) {
      setDraft(String(value))
      return
    }
    if (n !== value) onCommit(n)
  }
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-white/40">{label}</span>
      <span className="flex items-center gap-1.5">
        <span className="text-[13px] font-semibold text-white/50">$</span>
        <input
          type="text"
          inputMode="numeric"
          data-testid={testId}
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ''))}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
          className="w-28 rounded-xl border border-white/[0.10] bg-black/30 px-3 py-2 text-[13px] text-white outline-none focus:border-cyan-400/50 disabled:opacity-50"
        />
      </span>
      {hint ? <span className="mt-1.5 block text-[11px] leading-relaxed text-white/45">{hint}</span> : null}
    </label>
  )
}

/**
 * Salary Cap rules, written to `SalaryCapLeagueConfig` — the row the cap engine reads — through
 * PATCH /api/leagues/[leagueId]/specialty-settings. Autosaves like every other hub field; a refused
 * save puts the field back to what is saved and says why.
 */
export function SalaryCapSettingsForm({
  leagueId,
  initial,
  canEdit,
}: {
  leagueId: string
  initial: SalaryCapSettingsState
  canEdit: boolean
}) {
  const { t } = useLanguage()
  const [state, setState] = useState<SalaryCapSettingsState>(initial)
  const [saving, setSaving] = useState(false)
  const saved = useRef<SalaryCapSettingsValue>(initial.value)
  const pending = useRef<Partial<SalaryCapSettingsValue>>({})
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setState(initial)
    saved.current = initial.value
  }, [initial])
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const flush = useCallback(async () => {
    const salaryCap = pending.current
    pending.current = {}
    if (Object.keys(salaryCap).length === 0) return
    setSaving(true)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/specialty-settings`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ salaryCap }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string; salaryCap?: SalaryCapSettingsState | null }
      if (!res.ok || !data.salaryCap) {
        toast.error(data.error ?? t('lsHub.sp.saveFailed'))
        setState((s) => ({ ...s, value: saved.current }))
        return
      }
      saved.current = data.salaryCap.value
      setState(data.salaryCap)
    } catch {
      toast.error(t('lsHub.sp.saveFailed'))
      setState((s) => ({ ...s, value: saved.current }))
    } finally {
      setSaving(false)
    }
  }, [leagueId, t])

  const update = (patch: Partial<SalaryCapSettingsValue>) => {
    if (!canEdit) return
    setState((s) => ({ ...s, value: { ...s.value, ...patch } }))
    pending.current = { ...pending.current, ...patch }
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      void flush()
    }, DEBOUNCE_MS)
  }

  const v = state.value
  const years = (n: number) => t('lsHub.sp.sc.yearsN').replace('{{n}}', String(n))
  const pct = (n: number) => `${n}%`
  const money = (n: number) => `$${n}`
  const flagged = state.teams.filter((r) => r.overCap || r.belowFloor)

  return (
    <div className="space-y-5" data-testid="specialty-salary-cap-form">
      <HubCard title={t('lsHub.sp.sc.cap')}>
        <HubSavingNote saving={saving} text={t('lsHub.saving')} />
        <p className="text-[11px] leading-relaxed text-white/45">
          {t('lsHub.sp.sc.modeLine').replace('{{mode}}', t(v.mode === 'bestball' ? 'lsHub.sp.sc.modeBestBall' : 'lsHub.sp.sc.modeDynasty'))}
        </p>
        <MoneyField
          label={t('lsHub.sp.sc.startupCap')}
          hint={t('lsHub.sp.sc.startupCapHint')}
          value={v.startupCap}
          disabled={!canEdit}
          onCommit={(startupCap) => update({ startupCap })}
          testId="salary-cap-startup-cap"
        />
        <HubChoices
          label={t('lsHub.sp.sc.growth')}
          value={v.capGrowthPercent}
          disabled={!canEdit}
          options={presets([0, 2.5, 5, 7.5, 10, 15], v.capGrowthPercent, pct)}
          onChange={(capGrowthPercent) => update({ capGrowthPercent })}
        />
        <HubToggle
          label={t('lsHub.sp.sc.floor')}
          hint={t('lsHub.sp.sc.floorHint')}
          checked={v.capFloorEnabled}
          disabled={!canEdit}
          onChange={(capFloorEnabled) => update({ capFloorEnabled })}
        />
        {v.capFloorEnabled ? (
          <MoneyField
            label={t('lsHub.sp.sc.floorAmount')}
            value={v.capFloorAmount ?? 0}
            disabled={!canEdit}
            onCommit={(capFloorAmount) => update({ capFloorAmount })}
          />
        ) : null}
      </HubCard>

      <HubCard title={t('lsHub.sp.sc.contracts')}>
        <p className="text-[11px] leading-relaxed text-white/45">{t('lsHub.sp.sc.contractsHint')}</p>
        <HubChoices
          label={t('lsHub.sp.sc.minYears')}
          value={v.contractMinYears}
          disabled={!canEdit}
          options={rangeChoices(1, Math.min(5, v.contractMaxYears), years)}
          onChange={(contractMinYears) => update({ contractMinYears })}
        />
        <HubChoices
          label={t('lsHub.sp.sc.maxYears')}
          value={v.contractMaxYears}
          disabled={!canEdit}
          options={rangeChoices(Math.max(1, v.contractMinYears), 10, years)}
          onChange={(contractMaxYears) => update({ contractMaxYears })}
        />
        <HubChoices
          label={t('lsHub.sp.sc.rookieYears')}
          value={v.rookieContractYears}
          disabled={!canEdit}
          options={rangeChoices(1, 5, years)}
          onChange={(rookieContractYears) => update({ rookieContractYears })}
        />
        <MoneyField
          label={t('lsHub.sp.sc.minSalary')}
          value={v.minimumSalary}
          disabled={!canEdit}
          onCommit={(minimumSalary) => update({ minimumSalary })}
        />
        <HubToggle
          label={t('lsHub.sp.sc.extensions')}
          hint={t('lsHub.sp.sc.extensionsHint')}
          checked={v.extensionsEnabled}
          disabled={!canEdit}
          onChange={(extensionsEnabled) => update({ extensionsEnabled })}
        />
        <HubToggle
          label={t('lsHub.sp.sc.tag')}
          hint={t('lsHub.sp.sc.tagHint')}
          checked={v.franchiseTagEnabled}
          disabled={!canEdit}
          onChange={(franchiseTagEnabled) => update({ franchiseTagEnabled })}
        />
      </HubCard>

      <HubCard title={t('lsHub.sp.sc.cutsRollover')}>
        <HubToggle
          label={t('lsHub.sp.sc.deadMoney')}
          hint={t('lsHub.sp.sc.deadMoneyHint')}
          checked={v.deadMoneyEnabled}
          disabled={!canEdit}
          onChange={(deadMoneyEnabled) => update({ deadMoneyEnabled })}
        />
        {v.deadMoneyEnabled ? (
          <HubChoices
            label={t('lsHub.sp.sc.deadMoneyPct')}
            value={v.deadMoneyPercentPerYear}
            disabled={!canEdit}
            options={presets([10, 25, 50, 75, 100], v.deadMoneyPercentPerYear, pct)}
            onChange={(deadMoneyPercentPerYear) => update({ deadMoneyPercentPerYear })}
          />
        ) : null}
        <HubToggle
          label={t('lsHub.sp.sc.rollover')}
          hint={t('lsHub.sp.sc.rolloverHint')}
          checked={v.rolloverEnabled}
          disabled={!canEdit}
          onChange={(rolloverEnabled) => update({ rolloverEnabled })}
        />
        {v.rolloverEnabled ? (
          <HubChoices
            label={t('lsHub.sp.sc.rolloverMax')}
            value={v.rolloverMax}
            disabled={!canEdit}
            options={presets([5, 10, 15, 25, 50, 100], v.rolloverMax, money)}
            onChange={(rolloverMax) => update({ rolloverMax })}
          />
        ) : null}
      </HubCard>

      <HubCard title={t('lsHub.sp.sc.drafts')}>
        {state.startupLocked ? (
          <p className="flex items-start gap-2 text-[11px] leading-relaxed text-white/45">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white/35" aria-hidden />
            {t('lsHub.sp.sc.startupLocked')}
          </p>
        ) : null}
        <HubChoices
          label={t('lsHub.sp.sc.startupDraft')}
          value={v.startupDraftType}
          disabled={!canEdit || state.startupLocked}
          options={[
            { value: 'auction', label: t('lsHub.sp.sc.auction'), hint: t('lsHub.sp.sc.auctionHint') },
            { value: 'snake', label: t('lsHub.sp.sc.snake'), hint: t('lsHub.sp.sc.snakeHint') },
          ]}
          onChange={(startupDraftType) => update({ startupDraftType })}
        />
        {v.startupDraftType === 'auction' ? (
          <MoneyField
            label={t('lsHub.sp.sc.holdback')}
            hint={t('lsHub.sp.sc.holdbackHint')}
            value={v.auctionHoldback}
            disabled={!canEdit || state.startupLocked}
            onCommit={(auctionHoldback) => update({ auctionHoldback })}
          />
        ) : null}
        <HubChoices
          label={t('lsHub.sp.sc.futureDraft')}
          value={v.futureDraftType}
          disabled={!canEdit}
          options={[
            { value: 'snake', label: t('lsHub.sp.sc.snake'), hint: t('lsHub.sp.sc.futureSnakeHint') },
            { value: 'auction', label: t('lsHub.sp.sc.auction'), hint: t('lsHub.sp.sc.futureAuctionHint') },
            { value: 'weighted_lottery', label: t('lsHub.sp.sc.lottery'), hint: t('lsHub.sp.sc.lotteryHint') },
          ]}
          onChange={(futureDraftType) => update({ futureDraftType })}
        />
      </HubCard>

      {state.teams.length > 0 ? (
        <HubCard title={t('lsHub.sp.sc.teams').replace('{{year}}', String(state.capYear))} testId="salary-cap-compliance">
          {flagged.length > 0 ? (
            <p className="flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-[12px] leading-relaxed text-amber-100">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              {t('lsHub.sp.sc.flagged').replace('{{n}}', String(flagged.length))}
            </p>
          ) : (
            <p className="text-[11px] leading-relaxed text-white/45">{t('lsHub.sp.sc.allLegal')}</p>
          )}
          <ul className="divide-y divide-white/[0.06] overflow-hidden rounded-xl border border-white/[0.08]">
            {state.teams.map((r) => (
              <li key={r.rosterId} className="flex items-center gap-3 bg-black/20 px-3 py-2 text-[12px]">
                <span className="min-w-0 flex-1 truncate text-white/85">{r.name}</span>
                <span className="tabular-nums text-white/50">
                  {money(r.capHit)} / {money(r.cap)}
                </span>
                <span
                  className={`w-[88px] text-right font-semibold tabular-nums ${
                    r.overCap ? 'text-rose-300' : r.belowFloor ? 'text-amber-200' : 'text-emerald-200/90'
                  }`}
                >
                  {r.overCap
                    ? t('lsHub.sp.sc.overBy').replace('{{n}}', String(-r.capSpace))
                    : r.belowFloor
                      ? t('lsHub.sp.sc.belowFloor')
                      : t('lsHub.sp.sc.spaceN').replace('{{n}}', String(r.capSpace))}
                </span>
              </li>
            ))}
          </ul>
        </HubCard>
      ) : null}
    </div>
  )
}
