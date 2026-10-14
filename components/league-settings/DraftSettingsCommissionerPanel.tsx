'use client'

/**
 * components/league-settings/DraftSettingsCommissionerPanel.tsx
 * Commissioner Draft tab: schedule, draft type, pick clock (+ pace label), overnight auto-pause
 * (slow drafts only), CPU auto-pick, rounds (= draftable roster spots unless an AF Commissioner
 * overrides), draft order (Fill with CI, Randomize ×N), and the rookie order for dynasty-family
 * leagues. Persists through /api/leagues/[leagueId]/draft/settings and
 * /api/leagues/[leagueId]/draft/randomize-order. Built for a 360–390px phone first.
 *
 * Timer / pace / rounds rules live in lib/draft/draftSettingsPolicy.ts and are shared with the
 * server, which re-applies them on save.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { Calendar, Clock, Shuffle, Sparkles, Info, ChevronDown, Trophy, TrendingDown, X } from 'lucide-react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { SettingsSwitch } from '@/components/league-settings/SettingsSwitch'
import {
  LEGACY_TIMER_SECONDS,
  RANDOMIZE_MAX_TIMES,
  STANDARD_TIMER_SECONDS,
  classifyDraftPace,
  customTimerToSeconds,
  secondsToCustomParts,
  slowDraftPauseAllowed,
  timerOptionsFor,
  type CustomTimerUnit,
  type DraftPace,
} from '@/lib/draft/draftSettingsPolicy'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DraftTeamSlot {
  position: number
  teamName: string | null
  ownerName: string | null
  avatarUrl: string | null
  isEmpty: boolean
}

interface ComputedRounds {
  rounds: number
  rosterSpots: number
  countsTaxiAndDevy: boolean
}

type T = (key: string) => string

/** Keys exist for every standard and legacy value: `lsEd.dr.timer.s<seconds>`. */
const KEYED_TIMERS = new Set<number>([...STANDARD_TIMER_SECONDS, ...LEGACY_TIMER_SECONDS])

const ROUND_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 25, 28, 30, 35, 40, 45, 50]

const CUSTOM_VALUE = 'custom'

const fill = (s: string, vars: Record<string, string | number>) =>
  Object.entries(vars).reduce((acc, [k, v]) => acc.split(`{{${k}}}`).join(String(v)), s)

function formatTimer(seconds: number, t: T): string {
  if (KEYED_TIMERS.has(seconds)) return t(`lsEd.dr.timer.s${seconds}`)
  let short: string
  if (seconds < 60) short = fill(t('lsEd.dr.v2.fmtSec'), { n: seconds })
  else if (seconds < 3600) short = fill(t('lsEd.dr.v2.fmtMin'), { n: Math.round((seconds / 60) * 10) / 10 })
  else short = fill(t('lsEd.dr.v2.fmtHr'), { n: Math.round((seconds / 3600) * 100) / 100 })
  return fill(t('lsEd.dr.v2.customValue'), { value: short })
}

const pad = (n: number) => String(n).padStart(2, '0')

/** ISO instant → local `YYYY-MM-DD` and `HH:MM` (both in the viewer's own timezone). */
function splitLocal(iso: string): { date: string; time: string } | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  leagueId: string
  /** AF Commissioner subscription — unlocks the custom pick timer, the rounds override and Randomize ×N. */
  hasAfCommissionerSub?: boolean
}

export function DraftSettingsCommissionerPanel({ leagueId, hasAfCommissionerSub = false }: Props) {
  const { t, language } = useLanguage()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [isCommissioner, setIsCommissioner] = useState(false)
  const [serverSub, setServerSub] = useState(false)
  const hasSub = hasAfCommissionerSub || serverSub

  // Draft config
  const [draftType, setDraftType] = useState<string>('snake')
  const [rounds, setRounds] = useState<number>(15)
  const [computedRounds, setComputedRounds] = useState<ComputedRounds | null>(null)
  const [timerSeconds, setTimerSeconds] = useState<number>(28800)
  const [autostartEnabled, setAutostartEnabled] = useState(false)
  const [cpuAutoPickEnabled, setCpuAutoPickEnabled] = useState(true)
  const [slowDraftPauseEnabled, setSlowDraftPauseEnabled] = useState(false)
  const [slowDraftPauseFrom, setSlowDraftPauseFrom] = useState('21:00')
  const [slowDraftPauseTo, setSlowDraftPauseTo] = useState('09:00')

  // Custom timer editor (AF Commissioner)
  const [customOpen, setCustomOpen] = useState(false)
  const [customAmount, setCustomAmount] = useState('')
  const [customUnit, setCustomUnit] = useState<CustomTimerUnit>('minutes')
  const [customError, setCustomError] = useState<string | null>(null)

  // Draft date/time — empty until the commissioner picks one.
  const [draftDate, setDraftDate] = useState<string>('')
  const [draftTime, setDraftTime] = useState<string>('')

  // Draft order
  const [teams, setTeams] = useState<DraftTeamSlot[]>([])
  const [orderLocked, setOrderLocked] = useState(false)
  const [fillInfoOpen, setFillInfoOpen] = useState(false)
  const [randomizeOpen, setRandomizeOpen] = useState(false)
  const [randomizeTimes, setRandomizeTimes] = useState('1')
  const [randomizeError, setRandomizeError] = useState<string | null>(null)

  // Rookie draft order (dynasty/C2C/devy only)
  const [isDynastyLike, setIsDynastyLike] = useState(false)
  const [rookieMode, setRookieMode] = useState<'worst_to_first' | 'reverse_max_pf'>('worst_to_first')
  const [rookieEnabled, setRookieEnabled] = useState(false)
  const [rookieSlots, setRookieSlots] = useState<Array<{
    slot: number; teamName: string; ownerName: string; avatarUrl: string | null
    orderLabel: string; isPlayoffTeam: boolean; playoffFinish: string | null
  }>>([])
  const [rookieNextSeason, setRookieNextSeason] = useState(0)
  const [rookieWarning, setRookieWarning] = useState<string | null>(null)
  const [rookieSaving, setRookieSaving] = useState(false)

  const ids = {
    autostart: useId(), slowPause: useId(), cpu: useId(), rookieAuto: useId(), timer: useId(),
    draftType: useId(), rounds: useId(), fillInfo: useId(), randomize: useId(), customAmount: useId(), customUnit: useId(),
  }

  const flash = useCallback((msg: string) => {
    setNotice(msg)
    setTimeout(() => setNotice((cur) => (cur === msg ? null : cur)), 2500)
  }, [])

  const applySettings = useCallback((data: Record<string, any>) => {
    setIsCommissioner(Boolean(data.isCommissioner))
    setServerSub(Boolean(data.hasAfCommissionerSub))
    const cfg = data.config ?? {}
    setDraftType(cfg.draft_type ?? cfg.snake_or_linear ?? 'snake')
    setRounds(typeof cfg.rounds === 'number' ? cfg.rounds : 15)
    if (typeof cfg.timer_seconds === 'number' && cfg.timer_seconds > 0) setTimerSeconds(cfg.timer_seconds)
    setAutostartEnabled(Boolean(data.autostartEnabled ?? cfg.autostart))
    setCpuAutoPickEnabled(data.cpuAutoPickEnabled ?? cfg.autopick_behavior !== 'skip')
    setSlowDraftPauseEnabled(Boolean(data.slowDraftPauseEnabled))
    if (data.slowDraftPauseFrom) setSlowDraftPauseFrom(data.slowDraftPauseFrom)
    if (data.slowDraftPauseTo) setSlowDraftPauseTo(data.slowDraftPauseTo)
    const local = data.draftDate ? splitLocal(data.draftDate) : null
    if (local) { setDraftDate(local.date); setDraftTime(local.time) }
    if (Array.isArray(data.teams)) setTeams(data.teams)
    setOrderLocked(Boolean(data.draftOrderLocked))
    const cr = data.computedRounds
    setComputedRounds(cr && typeof cr.rounds === 'number' ? { rounds: cr.rounds, rosterSpots: cr.rosterSpots, countsTaxiAndDevy: Boolean(cr.countsTaxiAndDevy) } : null)
  }, [])

  const loadSettings = useCallback(async () => {
    const r = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft/settings`, { cache: 'no-store' })
    const data = await r.json()
    applySettings(data ?? {})
  }, [leagueId, applySettings])

  // Load
  useEffect(() => {
    let active = true
    loadSettings()
      .catch(() => { if (active) setError(t('lsEd.dr.loadFailed')) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId])

  // Load rookie draft order (dynasty/C2C/devy only)
  const loadRookieOrder = useCallback(async (mode?: string) => {
    try {
      const modeParam = mode ? `?mode=${mode}` : ''
      const res = await fetch(
        `/api/commissioner/leagues/${encodeURIComponent(leagueId)}/rookie-draft-order${modeParam}`,
        { cache: 'no-store' }
      )
      if (res.status === 400) { setIsDynastyLike(false); return }
      const data = await res.json()
      if (data.error) return
      setIsDynastyLike(true)
      setRookieMode(data.savedMode ?? data.mode ?? 'worst_to_first')
      setRookieEnabled(data.enabled ?? false)
      setRookieSlots(data.slots ?? [])
      setRookieNextSeason(data.season ?? 0)
      setRookieWarning(data.warning ?? null)
    } catch { /* silent */ }
  }, [leagueId])

  useEffect(() => { loadRookieOrder() }, [loadRookieOrder])

  // Save rookie draft order config. Free: both modes are a deterministic sort.
  const saveRookieConfig = useCallback(async () => {
    setRookieSaving(true); setError(null)
    try {
      const res = await fetch(
        `/api/commissioner/leagues/${encodeURIComponent(leagueId)}/rookie-draft-order`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: rookieMode, enabled: rookieEnabled }),
        }
      )
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? t('lsEd.saveFailed')); return }
      flash(t('lsEd.dr.saved'))
      await loadRookieOrder(rookieMode)
    } catch { setError(t('lsEd.requestFailed')) }
    finally { setRookieSaving(false) }
  }, [leagueId, rookieMode, rookieEnabled, loadRookieOrder, flash, t])

  const pace = classifyDraftPace(timerSeconds)
  const pauseAllowed = slowDraftPauseAllowed(timerSeconds)
  const effectiveRounds = hasSub ? rounds : (computedRounds?.rounds ?? rounds)

  // Save all settings
  const saveSettings = useCallback(async () => {
    setSaving(true); setError(null); setNotice(null)
    try {
      const payload: Record<string, unknown> = {
        draft_type: draftType,
        snake_or_linear: draftType,
        pick_order_rules: draftType,
        rounds: effectiveRounds,
        timer_seconds: timerSeconds,
        autopick_behavior: cpuAutoPickEnabled ? 'queue-first' : 'skip',
        cpuAutoPick: cpuAutoPickEnabled,
        autostart: autostartEnabled,
        slowDraftPauseEnabled: slowDraftPauseEnabled && pauseAllowed,
        slowDraftPauseFrom,
        slowDraftPauseTo,
      }
      if (draftDate) {
        const local = new Date(`${draftDate}T${draftTime || '19:30'}:00`)
        if (!Number.isNaN(local.getTime())) payload.draftDate = local.toISOString()
        if (!draftTime) setDraftTime('19:30')
      }
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error ?? t('lsEd.failedToSave')); return }
      const d = await res.json().catch(() => ({}))
      if (typeof d?.config?.rounds === 'number') setRounds(d.config.rounds)
      flash(t('lsEd.dr.saved'))
    } catch { setError(t('lsEd.requestFailed')) }
    finally { setSaving(false) }
  }, [leagueId, draftType, effectiveRounds, timerSeconds, cpuAutoPickEnabled, autostartEnabled, slowDraftPauseEnabled, pauseAllowed,
    slowDraftPauseFrom, slowDraftPauseTo, draftDate, draftTime, flash, t])

  // Randomize draft order — once for everyone, 1–100 times for AF Commissioner (posted to chat).
  const runRandomize = useCallback(async (times: number) => {
    setSaving(true); setError(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft/randomize-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ times }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setError(d.error ?? t('lsEd.dr.randomizeFailed')); return }
      if (Array.isArray(d.teams) && d.teams.length) {
        setTeams(d.teams)
        setRandomizeOpen(false)
        flash((d.times ?? times) > 1 ? fill(t('lsEd.dr.v2.randomizedN'), { n: d.times ?? times }) : t('lsEd.dr.v2.randomizedOnce'))
      } else {
        setError(t('lsEd.dr.noTeamsRandomize'))
      }
    } catch { setError(t('lsEd.requestFailed')) }
    finally { setSaving(false) }
  }, [leagueId, flash, t])

  const onRandomizeClick = () => {
    if (!hasSub) { void runRandomize(1); return }
    setRandomizeError(null)
    setRandomizeOpen((o) => !o)
  }

  const submitRandomizeTimes = () => {
    const n = Number(randomizeTimes)
    if (!Number.isInteger(n) || n < 1 || n > RANDOMIZE_MAX_TIMES) { setRandomizeError(t('lsEd.dr.v2.randomizeInvalid')); return }
    setRandomizeError(null)
    void runRandomize(n)
  }

  // Fill empty seats with Chimmy Intelligence teams (POST /fill-empty-slots).
  const fillEmptySlotsWithCi = useCallback(async () => {
    setSaving(true); setError(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/fill-empty-slots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setError(d.error ?? t('lsEd.dr.fillFailed')); return }
      if (d.ok) {
        // Fill rewrites the pick clock (30s) and turns CPU auto-pick on. Apply that NOW, then reload
        // the authoritative settings — otherwise Save would write the pre-fill clock back.
        if (typeof d.pickTimerSeconds === 'number' && d.pickTimerSeconds > 0) setTimerSeconds(d.pickTimerSeconds)
        if (d.cpuAutoPick === true) setCpuAutoPickEnabled(true)
        setCustomOpen(false)
        await loadSettings().catch(() => {})
        flash(t('lsEd.dr.saved'))
      } else {
        setError(d.message ?? t('lsEd.dr.noAction'))
      }
    } catch { setError(t('lsEd.requestFailed')) }
    finally { setSaving(false) }
  }, [leagueId, loadSettings, flash, t])

  // Time-per-pick select
  const timerChoices = useMemo(() => timerOptionsFor(timerSeconds), [timerSeconds])
  const onTimerSelect = (v: string) => {
    if (v === CUSTOM_VALUE) {
      const parts = secondsToCustomParts(timerSeconds)
      setCustomAmount(String(parts.amount)); setCustomUnit(parts.unit); setCustomError(null); setCustomOpen(true)
      return
    }
    setCustomOpen(false)
    setTimerSeconds(parseInt(v, 10))
  }
  const applyCustomTimer = () => {
    const sec = customTimerToSeconds(customAmount, customUnit)
    if (sec == null) { setCustomError(t('lsEd.dr.v2.customInvalid')); return }
    setTimerSeconds(sec); setCustomError(null); setCustomOpen(false)
  }

  const roundOptions = useMemo(() => {
    const set = new Set(ROUND_OPTIONS)
    set.add(rounds)
    if (computedRounds) set.add(computedRounds.rounds)
    return [...set].filter((n) => n >= 1 && n <= 50).sort((a, b) => a - b)
  }, [rounds, computedRounds])

  if (loading) return <div className="py-8 text-center text-sm text-white/50">{t('lsEd.dr.loading')}</div>

  const ro = !isCommissioner

  return (
    <div className="min-w-0 max-w-full space-y-4 overflow-x-hidden" data-testid="draft-settings-panel">
      {/* Header */}
      <div className="min-w-0">
        <h3 className="text-base font-semibold text-white">{t('draft.title')}</h3>
        <p className="mt-0.5 text-xs text-white/50">{t('lsEd.dr.v2.subtitle')}</p>
      </div>

      {/* ===== SCHEDULE ===== */}
      <section className="af-ls-card space-y-3">
        <p className="af-ls-eyebrow">{t('lsEd.dr.v2.schedule')}</p>
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
          <PickerField
            kind="date" label={t('lsEd.dr.v2.dateLabel')} placeholder={t('lsEd.dr.v2.datePlaceholder')}
            value={draftDate} onChange={setDraftDate} disabled={ro} language={language}
          />
          <PickerField
            kind="time" label={t('lsEd.dr.v2.timeLabel')} placeholder={t('lsEd.dr.v2.timePlaceholder')}
            value={draftTime} onChange={setDraftTime} disabled={ro} language={language}
          />
        </div>
        <p className="text-[11px] text-white/40">{t('lsEd.dr.localTz')}</p>
        <div className="border-t border-white/10 pt-1">
          <ToggleRow
            id={ids.autostart} label={t('draft.autostart')} description={t('draft.autostartDesc')}
            enabled={autostartEnabled} onChange={setAutostartEnabled} disabled={ro}
          />
        </div>
      </section>

      {/* ===== FORMAT & PICK CLOCK ===== */}
      <section className="af-ls-card space-y-4">
        <p className="af-ls-eyebrow">{t('lsEd.dr.v2.formatClock')}</p>

        <div className="min-w-0 space-y-1.5">
          <label htmlFor={ids.draftType} className="block text-[13px] font-semibold text-white/90">{t('draft.draftType')}</label>
          <SelectRow
            id={ids.draftType}
            value={draftType === 'snake' ? 'snake' : draftType === 'auction' ? 'auction' : 'linear'}
            options={[
              { value: 'snake', label: t('lsEd.dr.snake') },
              { value: 'linear', label: t('lsEd.dr.linear') },
              { value: 'auction', label: t('lsEd.dr.auction') },
            ]}
            onChange={setDraftType}
            disabled={ro}
          />
        </div>

        <div className="min-w-0 space-y-1.5">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <label htmlFor={ids.timer} className="text-[13px] font-semibold text-white/90">{t('draft.timePerPick')}</label>
            {pace && <PaceBadge pace={pace} t={t} />}
          </div>
          <SelectRow
            id={ids.timer}
            value={customOpen ? CUSTOM_VALUE : String(timerSeconds)}
            options={[
              ...timerChoices.map((s) => ({ value: String(s), label: formatTimer(s, t) })),
              ...(hasSub ? [{ value: CUSTOM_VALUE, label: t('lsEd.dr.v2.customOption') }] : []),
            ]}
            onChange={onTimerSelect}
            disabled={ro}
          />
          {hasSub && customOpen && !ro && (
            <div className="space-y-2 rounded-xl border border-white/10 bg-white/[0.03] p-3" data-testid="draft-custom-timer">
              <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
                <div className="min-w-0">
                  <label htmlFor={ids.customAmount} className="mb-1 block text-[11px] text-white/50">{t('lsEd.dr.v2.customAmount')}</label>
                  <input
                    id={ids.customAmount} type="number" inputMode="decimal" min={0} step="any"
                    value={customAmount} onChange={(e) => setCustomAmount(e.target.value)}
                    className="w-full min-w-0 rounded-lg border border-white/15 bg-[#0d1526] px-3 py-2.5 text-sm text-white"
                  />
                </div>
                <div className="min-w-0">
                  <label htmlFor={ids.customUnit} className="mb-1 block text-[11px] text-white/50">{t('lsEd.dr.v2.customUnit')}</label>
                  <SelectRow
                    id={ids.customUnit} value={customUnit}
                    options={[{ value: 'minutes', label: t('lsEd.dr.v2.unitMinutes') }, { value: 'hours', label: t('lsEd.dr.v2.unitHours') }]}
                    onChange={(v) => setCustomUnit(v === 'hours' ? 'hours' : 'minutes')}
                  />
                </div>
              </div>
              <button type="button" onClick={applyCustomTimer}
                className="w-full rounded-lg bg-cyan-600/80 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-600 transition">
                {t('lsEd.dr.v2.customApply')}
              </button>
              <p className="text-[11px] text-white/40">{t('lsEd.dr.v2.customHint')}</p>
              {customError && <p role="alert" className="text-[12px] text-red-300">{customError}</p>}
            </div>
          )}
        </div>

        <div className="space-y-2 border-t border-white/10 pt-1">
          <ToggleRow
            id={ids.slowPause} label={t('draft.slowDraftPause')}
            description={pauseAllowed ? t('draft.slowDraftPauseDesc') : t('lsEd.dr.v2.pauseSlowOnly')}
            enabled={slowDraftPauseEnabled && pauseAllowed} onChange={setSlowDraftPauseEnabled}
            disabled={ro || !pauseAllowed}
          />
          {pauseAllowed && slowDraftPauseEnabled && (
            <div className="grid min-w-0 grid-cols-2 gap-2" data-testid="draft-pause-window">
              <PickerField kind="time" label={t('lsEd.dr.v2.pauseFrom')} placeholder={t('lsEd.dr.v2.timePlaceholder')}
                value={slowDraftPauseFrom} onChange={setSlowDraftPauseFrom} disabled={ro} language={language} />
              <PickerField kind="time" label={t('lsEd.dr.v2.pauseUntil')} placeholder={t('lsEd.dr.v2.timePlaceholder')}
                value={slowDraftPauseTo} onChange={setSlowDraftPauseTo} disabled={ro} language={language} />
            </div>
          )}
          <ToggleRow
            id={ids.cpu} label={t('draft.cpuAutoPick')} description={t('draft.cpuAutoPickDesc')}
            enabled={cpuAutoPickEnabled} onChange={setCpuAutoPickEnabled} disabled={ro}
          />
        </div>
      </section>

      {/* ===== ROUNDS ===== */}
      <section className="af-ls-card space-y-2" data-testid="draft-rounds">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <p className="af-ls-eyebrow">{t('lsEd.dr.v2.rounds')}</p>
          {hasSub && <span className="rounded-full border border-amber-400/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-300">{t('lsEd.dr.v2.afBadge')}</span>}
        </div>
        {hasSub && !ro ? (
          <>
            <SelectRow
              id={ids.rounds}
              value={String(rounds)}
              options={roundOptions.map((r) => ({ value: String(r), label: fill(t('lsEd.dr.roundsN'), { n: r }) }))}
              onChange={(v) => setRounds(parseInt(v, 10))}
            />
            {computedRounds && (
              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                <p className="min-w-0 text-[12px] text-white/50">
                  {fill(t('lsEd.dr.v2.roundsComputed'), { rounds: computedRounds.rounds, spots: computedRounds.rosterSpots })}
                </p>
                {rounds !== computedRounds.rounds && (
                  <button type="button" onClick={() => setRounds(computedRounds.rounds)}
                    className="text-[12px] font-semibold text-cyan-300 underline-offset-2 hover:underline" style={{ minHeight: 32 }}>
                    {fill(t('lsEd.dr.v2.roundsUseComputed'), { n: computedRounds.rounds })}
                  </button>
                )}
              </div>
            )}
            <p className="text-[11px] text-white/40">{t('lsEd.dr.v2.roundsOverride')}</p>
          </>
        ) : (
          <>
            <p className="text-[15px] font-semibold text-white" data-testid="draft-rounds-readonly">
              {computedRounds
                ? fill(t('lsEd.dr.v2.roundsComputed'), { rounds: computedRounds.rounds, spots: computedRounds.rosterSpots })
                : fill(t('lsEd.dr.v2.roundsSavedOnly'), { rounds })}
            </p>
            {computedRounds && (
              <p className="text-[11px] text-white/40">
                {computedRounds.countsTaxiAndDevy ? t('lsEd.dr.v2.roundsNoteTaxi') : t('lsEd.dr.v2.roundsNote')}
              </p>
            )}
          </>
        )}
      </section>

      {/* ===== DRAFT ORDER ===== */}
      <section className="af-ls-card space-y-3">
        <p className="af-ls-eyebrow">{t('draft.draftOrder')}</p>
        {isCommissioner && (
          <div className="space-y-2">
            <div className="flex min-w-0 flex-wrap gap-2">
              <div className="flex min-w-[9rem] flex-1 items-stretch gap-1">
                <button type="button" onClick={fillEmptySlotsWithCi} disabled={saving}
                  className="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg bg-violet-600/80 px-3 py-2 text-[13px] font-semibold text-white hover:bg-violet-600 disabled:opacity-50 transition"
                  title={t('lsEd.dr.v2.fillCiTitle')}>
                  <Sparkles className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="truncate">{t('lsEd.dr.v2.fillCi')}</span>
                </button>
                <button type="button" onClick={() => setFillInfoOpen((o) => !o)}
                  aria-expanded={fillInfoOpen} aria-controls={ids.fillInfo} aria-label={t('lsEd.dr.v2.fillCiInfoLabel')}
                  className="flex shrink-0 items-center justify-center rounded-lg border border-white/15 text-white/60 hover:text-white transition">
                  <Info className="h-4 w-4" aria-hidden />
                </button>
              </div>
              <button type="button" onClick={onRandomizeClick} disabled={saving || orderLocked}
                aria-expanded={hasSub ? randomizeOpen : undefined} aria-controls={hasSub ? ids.randomize : undefined}
                className="flex min-w-[9rem] flex-1 items-center justify-center gap-1.5 rounded-lg bg-cyan-600/80 px-3 py-2 text-[13px] font-semibold text-white hover:bg-cyan-600 disabled:opacity-50 transition">
                <Shuffle className="h-4 w-4 shrink-0" aria-hidden />
                <span className="truncate">{t('draft.randomize')}</span>
              </button>
            </div>
            {fillInfoOpen && (
              <div id={ids.fillInfo} role="note" className="relative rounded-xl border border-violet-400/30 bg-violet-950/30 p-3 pr-10 text-[12px] leading-relaxed text-white/80">
                {t('lsEd.dr.v2.fillCiInfo')}
                <button type="button" onClick={() => setFillInfoOpen(false)} aria-label={t('lsEd.dr.v2.cancel')}
                  className="absolute right-1 top-1 flex items-center justify-center text-white/50 hover:text-white" style={{ minWidth: 36, minHeight: 36 }}>
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </div>
            )}
            {orderLocked && <p className="text-[11px] text-amber-300/80">{t('lsEd.dr.v2.orderLocked')}</p>}
            {hasSub && randomizeOpen && (
              <div id={ids.randomize} role="dialog" aria-label={t('lsEd.dr.v2.randomizeTitle')}
                className="space-y-2 rounded-xl border border-cyan-400/30 bg-cyan-950/20 p-3" data-testid="draft-randomize-dialog">
                <p className="text-[13px] font-semibold text-white">{t('lsEd.dr.v2.randomizeTitle')}</p>
                <label className="block min-w-0">
                  <span className="mb-1 block text-[11px] text-white/50">{t('lsEd.dr.v2.randomizeTimes')}</span>
                  <input type="number" inputMode="numeric" min={1} max={RANDOMIZE_MAX_TIMES} step={1}
                    value={randomizeTimes} onChange={(e) => setRandomizeTimes(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') submitRandomizeTimes() }}
                    className="w-full min-w-0 rounded-lg border border-white/15 bg-[#0d1526] px-3 py-2.5 text-sm text-white" />
                </label>
                <p className="text-[11px] text-white/40">{t('lsEd.dr.v2.randomizeTimesHint')}</p>
                {randomizeError && <p role="alert" className="text-[12px] text-red-300">{randomizeError}</p>}
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setRandomizeOpen(false)}
                    className="rounded-lg border border-white/15 px-3 py-2 text-[13px] font-semibold text-white/80 hover:text-white transition">
                    {t('lsEd.dr.v2.cancel')}
                  </button>
                  <button type="button" onClick={submitRandomizeTimes} disabled={saving}
                    className="rounded-lg bg-cyan-600/80 px-3 py-2 text-[13px] font-semibold text-white hover:bg-cyan-600 disabled:opacity-50 transition">
                    {t('lsEd.dr.v2.randomizeRun')}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <ol className="min-w-0 space-y-0.5 rounded-xl border border-white/10 bg-white/[0.02] p-1.5">
          {teams.length > 0 ? (
            teams.map((slot, idx) => (
              <li key={idx} className="flex min-w-0 items-center gap-2.5 rounded-lg px-2 py-2">
                <span className="w-6 shrink-0 text-right text-[13px] font-medium tabular-nums text-white/40">{idx + 1}.</span>
                {slot.avatarUrl ? (
                  <img src={slot.avatarUrl} alt="" className="h-7 w-7 shrink-0 rounded-full border border-white/10 object-cover" />
                ) : (
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-[11px] font-bold text-white/40">
                    {slot.isEmpty ? '–' : (slot.teamName?.[0] ?? '?')}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  {slot.isEmpty ? (
                    <span className="text-[13px] text-white/30">{t('lsEd.dr.empty')}</span>
                  ) : (
                    <span className="block truncate text-[13px] font-medium text-white">
                      {slot.teamName ?? slot.ownerName}
                      {slot.ownerName && slot.teamName && slot.ownerName !== slot.teamName && (
                        <span className="ml-1 text-white/40">({slot.ownerName})</span>
                      )}
                    </span>
                  )}
                </div>
              </li>
            ))
          ) : (
            <li className="px-2 py-4 text-center text-[12px] text-white/30">{t('lsEd.dr.noTeams')}</li>
          )}
        </ol>
      </section>

      {/* ===== ROOKIE DRAFT ORDER (Dynasty/C2C/Devy only) ===== */}
      {isDynastyLike && (
        <section className="af-ls-card space-y-4">
          <div className="min-w-0">
            <p className="af-ls-eyebrow">{t('draft.rookieDraftOrder')}</p>
            <p className="mt-0.5 text-[11px] text-white/40">
              {fill(t('lsEd.dr.autoCalc'), { season: rookieNextSeason ? String(rookieNextSeason) : t('lsEd.dr.next') })}
            </p>
          </div>

          <div className="space-y-2" role="radiogroup" aria-label={t('lsEd.dr.orderMode')}>
            <p className="text-[13px] font-semibold text-white/90">{t('lsEd.dr.orderMode')}</p>
            <RookieModeOption
              checked={rookieMode === 'worst_to_first'} disabled={ro} tone="cyan"
              icon={<TrendingDown className="h-4 w-4 shrink-0 text-cyan-400" aria-hidden />}
              title={t('draft.worstToFirst')} description={t('lsEd.dr.w2fDesc')}
              onSelect={() => { setRookieMode('worst_to_first'); loadRookieOrder('worst_to_first') }}
            />
            <RookieModeOption
              checked={rookieMode === 'reverse_max_pf'} disabled={ro} tone="violet"
              icon={<Trophy className="h-4 w-4 shrink-0 text-violet-400" aria-hidden />}
              title={t('draft.reverseMaxPF')} description={t('lsEd.dr.rmpfDesc')}
              onSelect={() => { setRookieMode('reverse_max_pf'); loadRookieOrder('reverse_max_pf') }}
            />
          </div>

          {isCommissioner && (
            <ToggleRow
              id={ids.rookieAuto} label={t('draft.autoSetOrder')} description={t('draft.autoSetOrderDesc')}
              enabled={rookieEnabled} onChange={setRookieEnabled}
            />
          )}

          {rookieSlots.length > 0 && (
            <div className="space-y-1">
              <div className="flex min-w-0 items-center justify-between gap-2">
                <p className="min-w-0 text-[11px] font-semibold uppercase tracking-wider text-white/40">
                  {fill(t('lsEd.dr.preview'), { season: String(rookieNextSeason) })}
                </p>
                <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] font-bold uppercase text-white/40">
                  {rookieMode === 'worst_to_first' ? 'W2F' : 'RMPF'}
                </span>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-1.5">
                {rookieSlots.some((s) => !s.isPlayoffTeam) && (
                  <p className="px-2 py-1 text-[11px] font-bold uppercase tracking-widest text-white/30">{t('lsEd.dr.nonPlayoff')}</p>
                )}
                {rookieSlots.filter((s) => !s.isPlayoffTeam).map((slot) => (
                  <RookieRow key={slot.slot} slot={slot} badge={<span className="shrink-0 text-[11px] text-white/40">{slot.orderLabel}</span>} />
                ))}
                {rookieSlots.some((s) => s.isPlayoffTeam) && (
                  <p className="mt-1 px-2 py-1 text-[11px] font-bold uppercase tracking-widest text-amber-400/60">{t('lsEd.dr.playoffTeams')}</p>
                )}
                {rookieSlots.filter((s) => s.isPlayoffTeam).map((slot) => (
                  <RookieRow key={slot.slot} slot={slot} badge={
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${
                      slot.playoffFinish === 'Champion' ? 'bg-amber-500/20 text-amber-300'
                        : slot.playoffFinish === 'Runner-Up' ? 'bg-slate-500/20 text-slate-300'
                        : 'bg-white/5 text-white/40'
                    }`}>{slot.playoffFinish === 'Champion' ? t('lsEd.dr.champion') : slot.playoffFinish === 'Runner-Up' ? t('lsEd.dr.runnerUp') : (slot.playoffFinish ?? slot.orderLabel)}</span>
                  } />
                ))}
              </div>
              {rookieWarning && <p className="text-[11px] text-amber-300/70">{rookieWarning}</p>}
            </div>
          )}

          {isCommissioner && (
            <button type="button" disabled={rookieSaving} onClick={saveRookieConfig}
              className="w-full rounded-lg border border-white/15 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/[0.08] disabled:opacity-50 transition">
              {rookieSaving ? t('scoring.saving') : t('draft.saveRookieSettings')}
            </button>
          )}
        </section>
      )}

      {/* ===== MESSAGES + SAVE ===== */}
      <div className="space-y-2" aria-live="polite">
        {error && <div role="alert" className="rounded-lg border border-red-500/20 bg-red-950/20 px-3 py-2 text-xs text-red-300">{error}</div>}
        {notice && <div className="rounded-lg border border-emerald-500/20 bg-emerald-950/20 px-3 py-2 text-xs text-emerald-300">{notice}</div>}
      </div>
      {isCommissioner && (
        <button type="button" disabled={saving} onClick={saveSettings}
          className="w-full rounded-lg bg-cyan-600/80 px-4 py-2.5 text-sm font-semibold text-white hover:bg-cyan-600 disabled:opacity-50 transition">
          {saving ? t('scoring.saving') : t('draft.saveDraftSettings')}
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function PaceBadge({ pace, t }: { pace: DraftPace; t: T }) {
  const cfg = {
    slow: { label: t('lsEd.dr.v2.paceSlow'), hint: t('lsEd.dr.v2.paceSlowHint'), cls: 'border-amber-400/35 bg-amber-500/10 text-amber-300' },
    middy: { label: t('lsEd.dr.v2.paceMiddy'), hint: t('lsEd.dr.v2.paceMiddyHint'), cls: 'border-violet-400/35 bg-violet-500/10 text-violet-300' },
    fast: { label: t('lsEd.dr.v2.paceFast'), hint: t('lsEd.dr.v2.paceFastHint'), cls: 'border-emerald-400/35 bg-emerald-500/10 text-emerald-300' },
  }[pace]
  return (
    <span title={cfg.hint} data-pace={pace}
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${cfg.cls}`}>
      {cfg.label}
    </span>
  )
}

/**
 * A date or time field that looks like a field even when empty: bordered box, icon, placeholder.
 * The native input covers the box (transparent) so a tap opens the platform picker on iOS/Android;
 * `showPicker()` does the same on desktop browsers.
 */
function PickerField({ kind, label, placeholder, value, onChange, disabled, language }: {
  kind: 'date' | 'time'; label: string; placeholder: string; value: string
  onChange: (v: string) => void; disabled?: boolean; language?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const id = useId()
  const display = useMemo(() => {
    if (!value) return ''
    try {
      if (kind === 'date') {
        const [y, m, d] = value.split('-').map(Number)
        return new Date(y!, (m ?? 1) - 1, d ?? 1).toLocaleDateString(language || undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
      }
      const [h, mi] = value.split(':').map(Number)
      const dt = new Date(); dt.setHours(h ?? 0, mi ?? 0, 0, 0)
      return dt.toLocaleTimeString(language || undefined, { hour: 'numeric', minute: '2-digit' })
    } catch { return value }
  }, [kind, value, language])
  const Icon = kind === 'date' ? Calendar : Clock
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1 block text-[11px] font-semibold text-white/50">{label}</label>
      <div className={`relative flex min-h-[44px] w-full min-w-0 items-center gap-2 rounded-lg border px-3 ${
        value ? 'border-white/20' : 'border-dashed border-cyan-400/40'
      } bg-[#0d1526] ${disabled ? 'opacity-50' : ''}`}>
        <Icon className={`h-4 w-4 shrink-0 ${value ? 'text-white/50' : 'text-cyan-300'}`} aria-hidden />
        <span className={`min-w-0 flex-1 truncate text-sm ${value ? 'text-white' : 'text-white/45'}`} aria-hidden>
          {display || placeholder}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-white/30" aria-hidden />
        <input
          ref={inputRef} id={id} type={kind} value={value} disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          onClick={() => { try { inputRef.current?.showPicker?.() } catch { /* not supported */ } }}
          aria-label={value ? `${label}: ${display}` : `${label}: ${placeholder}`}
          className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0 disabled:cursor-not-allowed"
          style={{ minHeight: 44, colorScheme: 'dark' }}
        />
      </div>
    </div>
  )
}

function ToggleRow({ id, label, description, enabled, onChange, disabled }: {
  id: string; label: string; description: string; enabled: boolean
  onChange: (v: boolean) => void; disabled?: boolean
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 py-1">
      <div className="min-w-0 flex-1">
        <p id={`${id}-label`} className="text-[13px] font-semibold text-white/90">{label}</p>
        <p id={`${id}-desc`} className="mt-0.5 text-[11px] leading-snug text-white/40">{description}</p>
      </div>
      <SettingsSwitch checked={enabled} onChange={onChange} disabled={disabled} labelledBy={`${id}-label`} describedBy={`${id}-desc`} />
    </div>
  )
}

function SelectRow({ id, value, options, onChange, disabled }: {
  id?: string; value: string; options: { value: string; label: string }[]
  onChange: (v: string) => void; disabled?: boolean
}) {
  return (
    <div className="relative min-w-0">
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full min-w-0 appearance-none truncate rounded-lg border border-white/15 bg-[#0d1526] px-3 py-2.5 pr-9 text-sm font-medium text-white disabled:cursor-default disabled:opacity-50"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" aria-hidden />
    </div>
  )
}

function RookieModeOption({ checked, disabled, tone, icon, title, description, onSelect }: {
  checked: boolean; disabled: boolean; tone: 'cyan' | 'violet'; icon: ReactNode
  title: string; description: string; onSelect: () => void
}) {
  const on = tone === 'cyan' ? 'border-cyan-500/40 bg-cyan-950/20' : 'border-violet-500/40 bg-violet-950/20'
  const dot = tone === 'cyan' ? 'border-cyan-400 bg-cyan-400' : 'border-violet-400 bg-violet-400'
  return (
    <label className={`flex min-w-0 cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${checked ? on : 'border-white/10 bg-white/[0.02]'}`}>
      <input type="radio" checked={checked} onChange={onSelect} disabled={disabled} className="sr-only" />
      <span aria-hidden className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${checked ? dot : 'border-white/30'}`}>
        {checked && <span className="h-2 w-2 rounded-full bg-[#0d1526]" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          {icon}
          <span className="text-[13px] font-semibold text-white/90">{title}</span>
        </span>
        <span className="mt-1 block text-[11px] leading-relaxed text-white/40">{description}</span>
      </span>
    </label>
  )
}

function RookieRow({ slot, badge }: {
  slot: { slot: number; teamName: string; ownerName: string; avatarUrl: string | null }
  badge: ReactNode
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5">
      <span className="w-5 shrink-0 text-right text-[12px] font-bold text-white/40">{slot.slot}.</span>
      {slot.avatarUrl ? (
        <img src={slot.avatarUrl} alt="" className="h-6 w-6 shrink-0 rounded-full border border-white/10 object-cover" />
      ) : (
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-[11px] font-bold text-white/40">
          {(slot.teamName ?? '?')[0]}
        </div>
      )}
      <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-white/80">{slot.ownerName || slot.teamName}</span>
      {badge}
    </div>
  )
}
