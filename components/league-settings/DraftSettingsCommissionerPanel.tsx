'use client'

/**
 * components/league-settings/DraftSettingsCommissionerPanel.tsx
 * Commissioner draft settings panel matching Sleeper-style UI.
 * Handles: draft time, type, timer, auto-pause, CPU auto-pick,
 * number of rounds, draft order with randomize, and keepers/dynasty.
 * Connected to /api/leagues/[leagueId]/draft/settings.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Calendar, Clock, RefreshCw, Shuffle, Cpu, Pause, ChevronDown, Trophy, TrendingDown } from 'lucide-react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DraftConfig {
  draft_type?: string
  rounds?: number
  timer_seconds?: number | null
  slow_timer_seconds?: number | null
  snake_or_linear?: string
  pick_order_rules?: string
  third_round_reversal?: boolean
  autopick_behavior?: string
  queue_size_limit?: number | null
  pre_draft_ranking_source?: string
  roster_fill_order?: string
  position_filter_behavior?: string
  sport?: string
  variant?: string | null
  leagueSize?: number
}

interface DraftTeamSlot {
  position: number
  teamName: string | null
  ownerName: string | null
  avatarUrl: string | null
  isEmpty: boolean
}

interface DraftSettingsResponse {
  config: DraftConfig | null
  isCommissioner: boolean
  draftUISettings?: Record<string, unknown>
  teams?: DraftTeamSlot[]
  draftDate?: string | null
  draftStatus?: string
  autostartEnabled?: boolean
  slowDraftPauseEnabled?: boolean
  slowDraftPauseFrom?: string | null
  slowDraftPauseTo?: string | null
  cpuAutoPickEnabled?: boolean
}

// ---------------------------------------------------------------------------
// Timer presets
// ---------------------------------------------------------------------------

/** Labels are dictionary keys (`lsEd.dr.timer.s<seconds>`), resolved at render. */
const TIMER_OPTIONS = [30, 60, 90, 120, 300, 600, 3600, 14400, 28800, 43200, 86400].map((value) => ({ value, labelKey: `lsEd.dr.timer.s${value}` }))

const ROUND_OPTIONS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 18, 20, 25, 30]

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  leagueId: string
}

export function DraftSettingsCommissionerPanel({ leagueId }: Props) {
  const { t } = useLanguage()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [isCommissioner, setIsCommissioner] = useState(false)

  // Draft config
  const [draftType, setDraftType] = useState<string>('snake')
  const [rounds, setRounds] = useState<number>(15)
  const [timerSeconds, setTimerSeconds] = useState<number>(28800)
  const [autostartEnabled, setAutostartEnabled] = useState(true)
  const [cpuAutoPickEnabled, setCpuAutoPickEnabled] = useState(true)
  const [slowDraftPauseEnabled, setSlowDraftPauseEnabled] = useState(true)
  const [slowDraftPauseFrom, setSlowDraftPauseFrom] = useState('21:00')
  const [slowDraftPauseTo, setSlowDraftPauseTo] = useState('09:00')

  // Draft date/time
  const [draftDate, setDraftDate] = useState<string>('')
  const [draftTime, setDraftTime] = useState<string>('19:30')

  // Draft order
  const [teams, setTeams] = useState<DraftTeamSlot[]>([])
  const [draftStatus, setDraftStatus] = useState<string>('pre_draft')

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
  const [rookieLoading, setRookieLoading] = useState(false)
  const [rookieSaving, setRookieSaving] = useState(false)

  // Load
  useEffect(() => {
    let active = true
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft/settings`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (!active) return
        setIsCommissioner(data.isCommissioner ?? false)
        const cfg = data.config ?? {}
        setDraftType(cfg.draft_type ?? cfg.snake_or_linear ?? 'snake')
        setRounds(cfg.rounds ?? 15)
        setTimerSeconds(cfg.timer_seconds ?? 28800)
        setAutostartEnabled(data.autostartEnabled ?? Boolean(cfg.autostart))
        setCpuAutoPickEnabled(data.cpuAutoPickEnabled ?? Boolean(cfg.autopick_behavior !== 'skip'))
        setSlowDraftPauseEnabled(data.slowDraftPauseEnabled ?? true)
        if (data.slowDraftPauseFrom) setSlowDraftPauseFrom(data.slowDraftPauseFrom)
        if (data.slowDraftPauseTo) setSlowDraftPauseTo(data.slowDraftPauseTo)
        if (data.draftDate) {
          const d = new Date(data.draftDate)
          setDraftDate(d.toISOString().split('T')[0])
          setDraftTime(d.toTimeString().slice(0, 5))
        }
        setTeams(data.teams ?? [])
        setDraftStatus(data.draftStatus ?? 'pre_draft')
      })
      .catch(() => { if (active) setError(t('lsEd.dr.loadFailed')) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [leagueId])

  // Load rookie draft order (dynasty/C2C/devy only)
  const loadRookieOrder = useCallback(async (mode?: string) => {
    setRookieLoading(true)
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
    finally { setRookieLoading(false) }
  }, [leagueId])

  useEffect(() => { loadRookieOrder() }, [loadRookieOrder])

  // Save rookie draft order config. Free: both modes are a deterministic sort, not AI.
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
      setSuccess(true); setTimeout(() => setSuccess(false), 2000)
      // Reload with new mode
      await loadRookieOrder(rookieMode)
    } catch { setError(t('lsEd.requestFailed')) }
    finally { setRookieSaving(false) }
  }, [leagueId, rookieMode, rookieEnabled, loadRookieOrder])

  // Save draft time
  const saveDraftTime = useCallback(async () => {
    if (!draftDate) return
    setSaving(true); setError(null)
    try {
      const dateTime = new Date(`${draftDate}T${draftTime}:00`)
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draftDate: dateTime.toISOString() }),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error ?? t('lsEd.failedToSave')); return }
      setSuccess(true); setTimeout(() => setSuccess(false), 2000)
    } catch { setError(t('lsEd.requestFailed')) }
    finally { setSaving(false) }
  }, [leagueId, draftDate, draftTime])

  // Save all settings
  const saveSettings = useCallback(async () => {
    setSaving(true); setError(null); setSuccess(false)
    try {
      const payload: Record<string, unknown> = {
        draft_type: draftType === 'snake' || draftType === 'linear' ? draftType : 'snake',
        snake_or_linear: draftType,
        pick_order_rules: draftType,
        rounds,
        timer_seconds: timerSeconds,
        autopick_behavior: cpuAutoPickEnabled ? 'queue-first' : 'skip',
        autostart: autostartEnabled,
        slowDraftPauseEnabled,
        slowDraftPauseFrom,
        slowDraftPauseTo,
      }
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error ?? t('lsEd.failedToSave')); return }
      setSuccess(true); setTimeout(() => setSuccess(false), 2000)
    } catch { setError(t('lsEd.requestFailed')) }
    finally { setSaving(false) }
  }, [leagueId, draftType, rounds, timerSeconds, cpuAutoPickEnabled, autostartEnabled, slowDraftPauseEnabled, slowDraftPauseFrom, slowDraftPauseTo])

  // Randomize draft order
  const randomizeOrder = useCallback(async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draft_order_mode: 'randomize', randomize: true }),
      })
      const d = await res.json()
      if (!res.ok) {
        setError(d.error ?? t('lsEd.dr.randomizeFailed'))
        return
      }
      if (d.teams) {
        setTeams(d.teams)
        setSuccess(true)
        setTimeout(() => setSuccess(false), 2000)
      } else {
        setError(t('lsEd.dr.noTeamsRandomize'))
      }
    } catch (e) {
      setError(t('lsEd.requestFailed'))
    }
    finally { setSaving(false) }
  }, [leagueId])

  // Fill empty slots with AI
  const fillEmptySlotsWithAI = useCallback(async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/fill-empty-slots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const d = await res.json()
      if (!res.ok) {
        setError(d.error ?? t('lsEd.dr.fillFailed'))
        return
      }
      if (d.ok) {
        // Refresh the settings to get updated teams
        const settingsRes = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft/settings`, { cache: 'no-store' })
        if (settingsRes.ok) {
          const settingsData = await settingsRes.json()
          if (settingsData.teams) {
            setTeams(settingsData.teams)
          }
        }
        setSuccess(true)
        setTimeout(() => setSuccess(false), 2000)
      } else {
        setError(d.message ?? t('lsEd.dr.noAction'))
      }
    } catch (e) {
      setError(t('lsEd.requestFailed'))
    }
    finally { setSaving(false) }
  }, [leagueId])

  if (loading) return <div className="py-8 text-center text-sm text-white/50">{t('lsEd.dr.loading')}</div>

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h3 className="text-base font-semibold text-white">{t('draft.title')}</h3>
        <p className="mt-0.5 text-xs text-white/50">
          {t('lsEd.dr.subtitle')}
        </p>
      </div>

      {/* ===== DRAFT TIME ===== */}
      <div className="space-y-3">
        <p className="text-[11px] font-bold uppercase tracking-wider text-white/50">{t('draft.draftTime')}</p>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <input
              type="date"
              value={draftDate}
              onChange={(e) => setDraftDate(e.target.value)}
              disabled={!isCommissioner}
              className="rounded-lg border border-white/15 bg-[#0d1526] px-3 py-2 text-sm text-white disabled:opacity-50"
            />
          </div>
          <div>
            <input
              type="time"
              value={draftTime}
              onChange={(e) => setDraftTime(e.target.value)}
              disabled={!isCommissioner}
              className="rounded-lg border border-white/15 bg-[#0d1526] px-3 py-2 text-sm text-white disabled:opacity-50"
            />
          </div>
          {isCommissioner && (
            <button type="button" onClick={saveDraftTime} disabled={saving || !draftDate}
              className="rounded-lg bg-cyan-600/80 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-600 disabled:opacity-50 transition">
              {t('draft.saveDraftTime')}
            </button>
          )}
        </div>
        <p className="text-[11px] text-white/30">{t('lsEd.dr.localTz')}</p>
      </div>

      {/* ===== AUTOSTART DRAFT ===== */}
      <ToggleRow
        label={t('draft.autostart')}
        description={t('draft.autostartDesc')}
        enabled={autostartEnabled}
        onChange={setAutostartEnabled}
        disabled={!isCommissioner}
      />

      {/* ===== DRAFT TYPE ===== */}
      <div className="space-y-2">
        <p className="text-[11px] font-bold uppercase tracking-wider text-white/50">{t('draft.draftType')}</p>
        <SelectRow
          value={draftType === 'snake' ? 'snake' : draftType === 'auction' ? 'auction' : 'linear'}
          options={[
            { value: 'snake', label: t('lsEd.dr.snake') },
            { value: 'linear', label: t('lsEd.dr.linear') },
            { value: 'auction', label: t('lsEd.dr.auction') },
          ]}
          onChange={setDraftType}
          disabled={!isCommissioner}
        />
      </div>

      {/* ===== TIME PER PICK ===== */}
      <div className="space-y-2">
        <p className="text-[11px] font-bold uppercase tracking-wider text-white/50">{t('draft.timePerPick')}</p>
        <SelectRow
          value={String(timerSeconds)}
          options={TIMER_OPTIONS.map((o) => ({ value: String(o.value), label: t(o.labelKey) }))}
          onChange={(v) => setTimerSeconds(parseInt(v, 10))}
          disabled={!isCommissioner}
        />
      </div>

      {/* ===== SLOW DRAFT AUTO-PAUSE ===== */}
      <div className="space-y-3">
        <ToggleRow
          label={t('draft.slowDraftPause')}
          description={t('draft.slowDraftPauseDesc')}
          enabled={slowDraftPauseEnabled}
          onChange={setSlowDraftPauseEnabled}
          disabled={!isCommissioner}
        />
        {slowDraftPauseEnabled && (
          <div className="ml-0 space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-white/40">{t('lsEd.dr.pauseFrom')}</p>
            <div className="flex items-center gap-2">
              <input type="time" value={slowDraftPauseFrom}
                onChange={(e) => setSlowDraftPauseFrom(e.target.value)}
                disabled={!isCommissioner}
                className="rounded-lg border border-white/15 bg-[#0d1526] px-3 py-2 text-sm text-white disabled:opacity-50"
              />
              <span className="text-xs text-white/40">{t('lsEd.dr.to')}</span>
              <input type="time" value={slowDraftPauseTo}
                onChange={(e) => setSlowDraftPauseTo(e.target.value)}
                disabled={!isCommissioner}
                className="rounded-lg border border-white/15 bg-[#0d1526] px-3 py-2 text-sm text-white disabled:opacity-50"
              />
            </div>
          </div>
        )}
      </div>

      {/* ===== CPU AUTO PICK ===== */}
      <ToggleRow
        label={t('draft.cpuAutoPick')}
        description={t('draft.cpuAutoPickDesc')}
        enabled={cpuAutoPickEnabled}
        onChange={setCpuAutoPickEnabled}
        disabled={!isCommissioner}
      />

      {/* ===== NUMBER OF ROUNDS ===== */}
      <div className="space-y-2">
        <p className="text-[11px] font-bold uppercase tracking-wider text-white/50">{t('draft.numRounds')}</p>
        <SelectRow
          value={String(rounds)}
          options={ROUND_OPTIONS.map((r) => ({ value: String(r), label: t('lsEd.dr.roundsN').replace('{{n}}', String(r)) }))}
          onChange={(v) => setRounds(parseInt(v, 10))}
          disabled={!isCommissioner}
        />
      </div>

      {/* ===== DRAFT ORDER ===== */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-bold uppercase tracking-wider text-white/50">{t('draft.draftOrder')}</p>
          {isCommissioner && (
            <div className="flex items-center gap-2">
              <button type="button" onClick={fillEmptySlotsWithAI} disabled={saving}
                className="flex items-center gap-1.5 rounded-lg bg-purple-600/80 px-4 py-2 text-xs font-semibold text-white hover:bg-purple-600 disabled:opacity-50 transition"
                title={t('lsEd.dr.fillAiTitle')}>
                <Cpu className="h-3.5 w-3.5" />
                {t('lsEd.dr.fillAi')}
              </button>
              <button type="button" onClick={randomizeOrder} disabled={saving}
                className="flex items-center gap-1.5 rounded-lg bg-cyan-600/80 px-4 py-2 text-xs font-semibold text-white hover:bg-cyan-600 disabled:opacity-50 transition">
                <Shuffle className="h-3.5 w-3.5" />
                {t('draft.randomize')}
              </button>
            </div>
          )}
        </div>

        <div className="space-y-0.5 rounded-xl border border-white/10 bg-white/[0.02] p-2">
          {teams.length > 0 ? (
            teams.map((slot, idx) => (
              <div key={idx}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-white/[0.03] transition">
                <span className="w-6 text-right text-[13px] font-medium text-white/40">{idx + 1}.</span>
                {slot.avatarUrl ? (
                  <img src={slot.avatarUrl} alt="" className="h-8 w-8 rounded-full border border-white/10 object-cover" />
                ) : (
                  <div className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/5 text-[11px] font-bold text-white/40">
                    {slot.teamName?.[0] ?? '?'}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  {slot.isEmpty ? (
                    <span className="text-[13px] text-white/30">{t('lsEd.dr.empty')}</span>
                  ) : (
                    <span className="text-[13px] font-medium text-white">
                      {slot.teamName}
                      {slot.ownerName && <span className="ml-1 text-white/40">({slot.ownerName})</span>}
                    </span>
                  )}
                </div>
                {isCommissioner && !slot.isEmpty && (
                  <span className="text-[11px] text-white/30 hover:text-cyan-400 cursor-pointer">{t('lsEd.dr.reassign')}</span>
                )}
              </div>
            ))
          ) : (
            <div className="py-4 text-center text-[12px] text-white/30">
              {t('lsEd.dr.noTeams')}
            </div>
          )}
        </div>
      </div>

      {/* ===== SET KEEPERS / DYNASTY ===== */}
      <div className="space-y-2 border-t border-white/10 pt-4">
        <p className="text-[11px] font-bold uppercase tracking-wider text-white/50">{t('lsEd.dr.keepers')}</p>
        <p className="text-xs text-white/40">
          {t('lsEd.dr.keepersHint')}
        </p>
        {isCommissioner && (
          <button type="button"
            className="rounded-lg bg-cyan-600/80 px-4 py-2.5 text-sm font-semibold text-white hover:bg-cyan-600 transition">
            {t('lsEd.dr.setPlayers')}
          </button>
        )}
      </div>

      {/* ===== ROOKIE DRAFT ORDER (Dynasty/C2C/Devy only) ===== */}
      {isDynastyLike && (
        <div className="space-y-4 border-t border-white/10 pt-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-white/50">
                {t('draft.rookieDraftOrder')}
              </p>
              <p className="text-[11px] text-white/30">
                {t('lsEd.dr.autoCalc').replace('{{season}}', rookieNextSeason ? String(rookieNextSeason) : t('lsEd.dr.next'))}
              </p>
            </div>
          </div>

          {/* Mode selector */}
          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-white/40">{t('lsEd.dr.orderMode')}</p>

            {/* Option 1: Worst to First */}
            <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${
              rookieMode === 'worst_to_first'
                ? 'border-cyan-500/30 bg-cyan-950/15'
                : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.04]'
            }`}>
              <div className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                rookieMode === 'worst_to_first' ? 'border-cyan-400 bg-cyan-400' : 'border-white/30'
              }`}>
                {rookieMode === 'worst_to_first' && <div className="h-2 w-2 rounded-full bg-[#0d1526]" />}
              </div>
              <div className="min-w-0 flex-1">
                <input type="radio" name="rookieMode" value="worst_to_first"
                  checked={rookieMode === 'worst_to_first'}
                  onChange={() => { setRookieMode('worst_to_first'); loadRookieOrder('worst_to_first') }}
                  disabled={!isCommissioner} className="sr-only" />
                <div className="flex items-center gap-2">
                  <TrendingDown className="h-4 w-4 text-cyan-400" />
                  <span className="text-[13px] font-semibold text-white/80">{t('draft.worstToFirst')}</span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-white/40">
                  {t('lsEd.dr.w2fDesc')}
                </p>
              </div>
            </label>

            {/* Option 2: Reverse Max PF */}
            <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${
              rookieMode === 'reverse_max_pf'
                ? 'border-violet-500/30 bg-violet-950/15'
                : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.04]'
            }`}>
              <div className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                rookieMode === 'reverse_max_pf' ? 'border-violet-400 bg-violet-400' : 'border-white/30'
              }`}>
                {rookieMode === 'reverse_max_pf' && <div className="h-2 w-2 rounded-full bg-[#0d1526]" />}
              </div>
              <div className="min-w-0 flex-1">
                <input type="radio" name="rookieMode" value="reverse_max_pf"
                  checked={rookieMode === 'reverse_max_pf'}
                  onChange={() => { setRookieMode('reverse_max_pf'); loadRookieOrder('reverse_max_pf') }}
                  disabled={!isCommissioner} className="sr-only" />
                <div className="flex items-center gap-2">
                  <Trophy className="h-4 w-4 text-violet-400" />
                  <span className="text-[13px] font-semibold text-white/80">{t('draft.reverseMaxPF')}</span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-white/40">
                  {t('lsEd.dr.rmpfDesc')}
                </p>
              </div>
            </label>
          </div>

          {/* Enable toggle */}
          {isCommissioner && (
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-white/50">{t('draft.autoSetOrder')}</p>
                <p className="text-[11px] text-white/30">{t('draft.autoSetOrderDesc')}</p>
              </div>
              <button type="button" role="switch" aria-checked={rookieEnabled}
                onClick={() => setRookieEnabled(!rookieEnabled)}
                className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
                  rookieEnabled ? 'bg-cyan-500' : 'bg-white/15'
                } cursor-pointer`}>
                <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${
                  rookieEnabled ? 'translate-x-[22px]' : 'translate-x-0.5'
                }`} />
              </button>
            </div>
          )}

          {/* Preview order */}
          {rookieSlots.length > 0 && (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-white/30">
                  {t('lsEd.dr.preview').replace('{{season}}', String(rookieNextSeason))}
                </p>
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] font-bold uppercase text-white/30">
                  {rookieMode === 'worst_to_first' ? 'W2F' : 'RMPF'}
                </span>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-2">
                {/* Non-playoff header */}
                {rookieSlots.some(s => !s.isPlayoffTeam) && (
                  <p className="px-2 py-1 text-[11px] font-bold uppercase tracking-widest text-white/20">{t('lsEd.dr.nonPlayoff')}</p>
                )}
                {rookieSlots.filter(s => !s.isPlayoffTeam).map((slot) => (
                  <div key={slot.slot} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/[0.03]">
                    <span className="w-5 text-right text-[12px] font-bold text-white/30">{slot.slot}.</span>
                    {slot.avatarUrl ? (
                      <img src={slot.avatarUrl} alt="" className="h-6 w-6 rounded-full border border-white/10 object-cover" />
                    ) : (
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-[11px] font-bold text-white/30">
                        {(slot.teamName ?? '?')[0]}
                      </div>
                    )}
                    <span className="flex-1 text-[12px] font-medium text-white/70">{slot.ownerName || slot.teamName}</span>
                    <span className="text-[11px] text-white/30">{slot.orderLabel}</span>
                  </div>
                ))}
                {/* Playoff header */}
                {rookieSlots.some(s => s.isPlayoffTeam) && (
                  <p className="mt-1 px-2 py-1 text-[11px] font-bold uppercase tracking-widest text-amber-400/40">{t('lsEd.dr.playoffTeams')}</p>
                )}
                {rookieSlots.filter(s => s.isPlayoffTeam).map((slot) => (
                  <div key={slot.slot} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/[0.03] ${
                    slot.playoffFinish === 'Champion' ? 'bg-amber-950/10' : slot.playoffFinish === 'Runner-Up' ? 'bg-slate-800/20' : ''
                  }`}>
                    <span className="w-5 text-right text-[12px] font-bold text-white/30">{slot.slot}.</span>
                    {slot.avatarUrl ? (
                      <img src={slot.avatarUrl} alt="" className="h-6 w-6 rounded-full border border-white/10 object-cover" />
                    ) : (
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-[11px] font-bold text-white/30">
                        {(slot.teamName ?? '?')[0]}
                      </div>
                    )}
                    <span className="flex-1 text-[12px] font-medium text-white/70">{slot.ownerName || slot.teamName}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                      slot.playoffFinish === 'Champion' ? 'bg-amber-500/20 text-amber-300'
                        : slot.playoffFinish === 'Runner-Up' ? 'bg-slate-500/20 text-slate-300'
                        : 'bg-white/5 text-white/30'
                    }`}>{slot.playoffFinish === 'Champion' ? t('lsEd.dr.champion') : slot.playoffFinish === 'Runner-Up' ? t('lsEd.dr.runnerUp') : (slot.playoffFinish ?? slot.orderLabel)}</span>
                  </div>
                ))}
              </div>
              {rookieWarning && (
                <p className="text-[11px] text-amber-300/60">{rookieWarning}</p>
              )}
            </div>
          )}

          {/* Save rookie config */}
          {isCommissioner && (
            <button type="button" disabled={rookieSaving} onClick={saveRookieConfig}
              className="w-full rounded-lg bg-gradient-to-r from-violet-600/70 to-cyan-600/70 px-4 py-2.5 text-sm font-medium text-white hover:from-violet-600 hover:to-cyan-600 disabled:opacity-50 transition">
              {rookieSaving ? t('scoring.saving') : t('draft.saveRookieSettings')}
            </button>
          )}
        </div>
      )}

      {/* ===== SAVE ===== */}
      {isCommissioner && (
        <div className="space-y-2 border-t border-white/10 pt-3">
          {error && <div className="rounded-lg border border-red-500/20 bg-red-950/20 px-3 py-2 text-xs text-red-300">{error}</div>}
          {success && <div className="rounded-lg border border-emerald-500/20 bg-emerald-950/20 px-3 py-2 text-xs text-emerald-300">{t('lsEd.dr.saved')}</div>}
          <button type="button" disabled={saving} onClick={saveSettings}
            className="w-full rounded-lg bg-cyan-600/80 px-4 py-2.5 text-sm font-medium text-white hover:bg-cyan-600 disabled:opacity-50 transition">
            {saving ? t('scoring.saving') : t('draft.saveDraftSettings')}
          </button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shared UI components
// ---------------------------------------------------------------------------

function ToggleRow({ label, description, enabled, onChange, disabled }: {
  label: string; description: string; enabled: boolean
  onChange: (v: boolean) => void; disabled?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wider text-white/50">{label}</p>
        <p className="text-[11px] text-white/30">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        disabled={disabled}
        onClick={() => onChange(!enabled)}
        className={`relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200 ${
          enabled ? 'bg-cyan-500' : 'bg-white/15'
        } ${disabled ? 'cursor-default opacity-50' : 'cursor-pointer'}`}
      >
        <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform duration-200 ${
          enabled ? 'translate-x-[22px]' : 'translate-x-0.5'
        }`} />
      </button>
    </div>
  )
}

function SelectRow({ value, options, onChange, disabled }: {
  value: string; options: { value: string; label: string }[]
  onChange: (v: string) => void; disabled?: boolean
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full appearance-none rounded-lg border border-white/15 bg-[#0d1526] px-4 py-2.5 pr-10 text-sm font-medium text-white disabled:cursor-default disabled:opacity-50"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
    </div>
  )
}
