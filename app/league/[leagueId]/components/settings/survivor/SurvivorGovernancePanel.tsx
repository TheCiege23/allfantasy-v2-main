'use client'

import { useCallback, useEffect, useState } from 'react'
import { Input, Select, SettingsRow, SettingsSection, Toggle } from '../../../tabs/settings/components'
import { useMessages } from '@/components/i18n/useMessages'
import {
  SURVIVOR_CROSS_TRIBE_WINDOW_MAX,
  SURVIVOR_GOVERNANCE_DAYS,
  SURVIVOR_GOVERNANCE_DEFAULTS,
  SURVIVOR_GOVERNANCE_LIMITS,
  crossTribeWindowPresetsFor,
  type SurvivorCrossTribeWindow,
  type SurvivorGovernanceKey,
  type SurvivorGovernanceSettings,
  type SurvivorScheduledSwap,
  type SurvivorSwapMode,
} from '@/lib/survivor/survivorGovernanceSettings'
import { survivorGovernanceMessages } from '@/lib/survivor/survivorGovernanceUiMessages'
import type { SurvivorSettingsPanelProps } from './types'

type Loaded = { settings: SurvivorGovernanceSettings; locked: SurvivorGovernanceKey[]; context?: { currentWeek: number; firstWeek: number }; sport?: string | null }

const range = (min: number, max: number) => Array.from({ length: max - min + 1 }, (_, i) => min + i)

/**
 * League settings → Survivor → Rules & Conduct. Every Survivor governance rule the commissioner can
 * set (lib/survivor/survivorGovernanceSettings.ts), saved through the Commissioner Hub action
 * `governance_settings`, which applies the same validation and locks as this screen shows.
 */
export function SurvivorGovernancePanel({ leagueId, canEdit }: SurvivorSettingsPanelProps) {
  const m = useMessages(survivorGovernanceMessages)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [draft, setDraft] = useState<SurvivorGovernanceSettings>(SURVIVOR_GOVERNANCE_DEFAULTS)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch(`/api/survivor/commissioner?leagueId=${encodeURIComponent(leagueId)}&type=governance`, { credentials: 'include' })
      if (!res.ok) throw new Error(String(res.status))
      const data = (await res.json()) as Loaded
      if (!data?.settings) throw new Error('shape')
      setLoaded(data)
      setDraft(data.settings)
    } catch {
      setError(m.loadFailed)
    }
  }, [leagueId, m.loadFailed])

  useEffect(() => { void load() }, [load])

  const locked = (key: SurvivorGovernanceKey) => Boolean(loaded?.locked.includes(key))
  const off = !canEdit || saving || !loaded
  const set = <K extends SurvivorGovernanceKey>(key: K, value: SurvivorGovernanceSettings[K]) => setDraft((d) => ({ ...d, [key]: value }))

  async function save() {
    if (!loaded || !canEdit) return
    const patch: Partial<SurvivorGovernanceSettings> = {}
    for (const key of Object.keys(draft) as SurvivorGovernanceKey[]) {
      if (key === 'experienceOverrides') continue
      if (JSON.stringify(draft[key]) !== JSON.stringify(loaded.settings[key])) (patch as Record<string, unknown>)[key] = draft[key]
    }
    if (Object.keys(patch).length === 0) { setStatus(m.saved); return }
    setSaving(true)
    setStatus(null)
    try {
      const res = await fetch('/api/survivor/commissioner', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId, action: 'governance_settings', settings: patch }),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string; settings?: SurvivorGovernanceSettings }
      if (!res.ok || !body.settings) throw new Error(body.error || m.saveFailed)
      setLoaded({ ...loaded, settings: body.settings })
      setDraft(body.settings)
      setStatus(m.saved)
    } catch (e) {
      setStatus(e instanceof Error ? e.message : m.saveFailed)
    } finally {
      setSaving(false)
    }
  }

  const updateSwap = (index: number, next: Partial<SurvivorScheduledSwap>) =>
    set('swapSchedule', draft.swapSchedule.map((s, i) => (i === index ? normalizeSwap({ ...s, ...next }) : s)))
  const addSwap = () => {
    const used = new Set(draft.swapSchedule.map((s) => s.week))
    const start = Math.max((loaded?.context?.currentWeek ?? 0) + 1, (loaded?.context?.firstWeek ?? 1) + 1)
    let week = start
    while (used.has(week)) week++
    const added: SurvivorScheduledSwap = { week, mode: 'random_shuffle' }
    set('swapSchedule', [...draft.swapSchedule, added].sort((a, b) => a.week - b.week))
  }
  const dayOptions = SURVIVOR_GOVERNANCE_DAYS.map((d) => <option key={d} value={d}>{m.day(d)}</option>)
  // Cross-tribe windows (1–3 a week). An older saved league reads as one Tribal-opened window.
  const windows: SurvivorCrossTribeWindow[] = draft.crossTribeWindows?.length ? draft.crossTribeWindows : SURVIVOR_GOVERNANCE_DEFAULTS.crossTribeWindows
  const setWindows = (next: SurvivorCrossTribeWindow[]) => set('crossTribeWindows', next.map(normalizeWindow))
  const updateWindow = (index: number, next: Partial<SurvivorCrossTribeWindow>) => setWindows(windows.map((w, i) => (i === index ? { ...w, ...next } : w)))
  const presets = crossTribeWindowPresetsFor(loaded?.sport)
  const windowsOff = off || !draft.tradeRulesEnabled

  return (
    <div className="space-y-5 px-6 py-6 text-[13px] text-white/85" data-testid="survivor-governance-panel">
      <p className="text-[11px] text-amber-200/80">{m.intro}</p>
      {!loaded && !error && <p className="text-sm text-white/50">{m.loading}</p>}
      {error && <p className="text-sm text-rose-300" role="alert">{error}</p>}

      <SettingsSection id="sv-gov-swaps" title={m.swapsTitle} description={m.swapsDesc}>
        {draft.swapSchedule.length === 0 && <p className="text-xs text-white/50">{m.swapsNone}</p>}
        {draft.swapSchedule.map((swap, index) => {
          const past = (loaded?.context?.currentWeek ?? 0) > 0 && swap.week <= (loaded?.context?.currentWeek ?? 0)
          return (
            <div key={`${swap.week}-${index}`} className="flex flex-wrap items-end gap-2 rounded-xl border border-white/[0.06] p-3" data-testid={`survivor-governance-swap-${index}`}>
              <label className="flex flex-col gap-1 text-[11px] text-white/60">{m.swapWeek}
                <Input type="number" min={1} max={30} value={swap.week} disabled={off || past} onChange={(e) => updateSwap(index, { week: Number(e.target.value) })} className="w-20" />
              </label>
              <label className="flex flex-col gap-1 text-[11px] text-white/60">{m.swapMode}
                <Select value={swap.mode} disabled={off || past} onChange={(v) => updateSwap(index, { mode: v as SurvivorSwapMode })}>
                  <option value="random_shuffle">{m.swapModeRandom}</option>
                  <option value="resize">{m.swapModeResize}</option>
                  <option value="return_to_original">{m.swapModeReturn}</option>
                  <option value="custom_pattern">{m.swapModePattern}</option>
                </Select>
              </label>
              {swap.mode === 'resize' && (
                <label className="flex flex-col gap-1 text-[11px] text-white/60">{m.swapTribes}
                  <Select value={swap.tribeCount ?? 3} disabled={off || past} onChange={(v) => updateSwap(index, { tribeCount: Number(v) })}>
                    {range(SURVIVOR_GOVERNANCE_LIMITS.swapTribeCount[0], SURVIVOR_GOVERNANCE_LIMITS.swapTribeCount[1]).map((n) => <option key={n} value={n}>{n}</option>)}
                  </Select>
                </label>
              )}
              {swap.mode === 'custom_pattern' && (
                <>
                  <label className="flex flex-col gap-1 text-[11px] text-white/60" title={m.swapPatternHelp}>{m.swapPattern}
                    <Input value={swap.pattern ?? ''} maxLength={40} disabled={off || past} onChange={(e) => updateSwap(index, { pattern: e.target.value.toUpperCase().replace(/[^A-E]/g, '') })} className="w-36" />
                  </label>
                  <label className="flex flex-col gap-1 text-[11px] text-white/60">{m.swapOrder}
                    <Select value={swap.order ?? 'season_points'} disabled={off || past} onChange={(v) => updateSwap(index, { order: v as 'season_points' | 'random' })}>
                      <option value="season_points">{m.swapOrderPoints}</option>
                      <option value="random">{m.swapOrderRandom}</option>
                    </Select>
                  </label>
                </>
              )}
              {!past && <button type="button" disabled={off} onClick={() => set('swapSchedule', draft.swapSchedule.filter((_, i) => i !== index))} className="rounded-lg border border-white/15 px-3 py-2 text-xs text-white/70 disabled:opacity-40">{m.swapRemove}</button>}
              {past && <span className="text-[11px] text-white/40">{m.locked}</span>}
            </div>
          )
        })}
        {draft.swapSchedule.length < SURVIVOR_GOVERNANCE_LIMITS.swapScheduleLength[1] && (
          <button type="button" disabled={off} onClick={addSwap} className="rounded-xl border border-white/15 px-3 py-2 text-xs text-white/80 disabled:opacity-40" data-testid="survivor-governance-add-swap">{m.swapAdd}</button>
        )}
        <p className="text-[11px] text-white/40">{m.swapPatternHelp}</p>
      </SettingsSection>

      <SettingsSection id="sv-gov-alliances" title={m.alliancesTitle} description={m.alliancesDesc}>
        <SettingsRow label={m.alliancesEnabled} control={<Toggle checked={draft.alliancesEnabled} disabled={off} onChange={(v) => set('alliancesEnabled', v)} />} />
        <SettingsRow label={m.allianceMaxSize} control={
          <Select value={draft.allianceMaxSize} disabled={off} onChange={(v) => set('allianceMaxSize', Number(v))}>
            {range(SURVIVOR_GOVERNANCE_LIMITS.allianceMaxSize[0], SURVIVOR_GOVERNANCE_LIMITS.allianceMaxSize[1]).map((n) => <option key={n} value={n}>{n}</option>)}
          </Select>} />
        <SettingsRow label={m.allianceSameTribeOnly} control={<Toggle checked={draft.allianceSameTribeOnly} disabled={off} onChange={(v) => set('allianceSameTribeOnly', v)} />} />
        <SettingsRow label={m.allianceHostCanRead} description={m.allianceHostCanReadHelp} control={<Toggle checked={draft.allianceHostCanRead} disabled={off} onChange={(v) => set('allianceHostCanRead', v)} />} />
      </SettingsSection>

      <SettingsSection id="sv-gov-strikes" title={m.strikesTitle} description={m.strikesDesc}>
        <SettingsRow label={m.strikeLimit} control={
          <Select value={draft.strikeLimit} disabled={off} onChange={(v) => set('strikeLimit', Number(v))}>
            {range(SURVIVOR_GOVERNANCE_LIMITS.strikeLimit[0], SURVIVOR_GOVERNANCE_LIMITS.strikeLimit[1]).map((n) => <option key={n} value={n}>{n}</option>)}
          </Select>} />
        <SettingsRow label={m.strikeAutoRemove} description={m.strikeAutoRemoveHelp} control={<Toggle checked={draft.strikeAutoRemove} disabled={off} onChange={(v) => set('strikeAutoRemove', v)} />} />
      </SettingsSection>

      <SettingsSection id="sv-gov-trades" title={m.tradesTitle} description={m.tradesDesc}>
        <SettingsRow label={m.tradeRulesEnabled} control={<Toggle checked={draft.tradeRulesEnabled} disabled={off} onChange={(v) => set('tradeRulesEnabled', v)} />} />
        <SettingsRow label={m.crossTribeTrades} control={
          <Select value={draft.crossTribeTrades} disabled={off || !draft.tradeRulesEnabled} onChange={(v) => set('crossTribeTrades', v as SurvivorGovernanceSettings['crossTribeTrades'])}>
            <option value="allowed">{m.crossAllowed}</option>
            <option value="window">{m.crossWindow}</option>
            <option value="banned">{m.crossBanned}</option>
          </Select>} />
        {draft.crossTribeTrades === 'window' && (
          <div className="space-y-2 rounded-xl border border-white/[0.06] p-3" data-testid="survivor-governance-windows">
            <p className="text-[12px] text-white/80">{m.crossWindowsTitle}</p>
            <p className="text-[11px] text-white/50">{m.crossWindowsHelp}</p>
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-white/60">
              <span>{m.crossPresets}</span>
              {presets.map((preset) => (
                <button key={preset.id} type="button" disabled={windowsOff} onClick={() => setWindows(preset.windows)} data-testid={`survivor-governance-window-preset-${preset.id}`}
                  className="rounded-lg border border-white/15 px-2 py-1 text-white/80 hover:bg-white/5 disabled:opacity-40">
                  {preset.id === 'original_nfl' ? m.crossPresetOriginal : m.crossPresetSingle}
                </button>
              ))}
            </div>
            {windows.map((w, index) => (
              <div key={index} className="flex flex-wrap items-end gap-2" data-testid={`survivor-governance-window-${index}`}>
                <span className="text-[11px] text-white/60">{m.crossWindowN(index + 1)}</span>
                <label className="flex flex-col gap-1 text-[11px] text-white/60">{m.crossOpensOn}
                  <Select value={w.opensOn} disabled={windowsOff} onChange={(v) => updateWindow(index, v === 'time' ? { opensOn: 'time', openDay: w.openDay ?? 'Friday', openTime: w.openTime ?? '00:00' } : { opensOn: 'tribal' })}>
                    <option value="tribal">{m.crossOpensTribal}</option>
                    <option value="time">{m.crossOpensTime}</option>
                  </Select>
                </label>
                {w.opensOn === 'time' && (
                  <label className="flex flex-col gap-1 text-[11px] text-white/60">{m.crossOpenAt}
                    <div className="flex gap-2">
                      <Select value={w.openDay ?? 'Friday'} disabled={windowsOff} onChange={(v) => updateWindow(index, { openDay: v as SurvivorCrossTribeWindow['closeDay'] })}>{dayOptions}</Select>
                      <Input type="time" value={w.openTime ?? '00:00'} disabled={windowsOff} onChange={(e) => updateWindow(index, { openTime: e.target.value })} aria-label={`${m.crossWindowN(index + 1)} ${m.crossOpenAt}`} />
                    </div>
                  </label>
                )}
                <label className="flex flex-col gap-1 text-[11px] text-white/60">{m.crossClose}
                  <div className="flex gap-2">
                    <Select value={w.closeDay} disabled={windowsOff} onChange={(v) => updateWindow(index, { closeDay: v as SurvivorCrossTribeWindow['closeDay'] })}>{dayOptions}</Select>
                    <Input type="time" value={w.closeTime} disabled={windowsOff} onChange={(e) => updateWindow(index, { closeTime: e.target.value })} aria-label={`${m.crossWindowN(index + 1)} ${m.crossClose}`} />
                  </div>
                </label>
                {windows.length > 1 && (
                  <button type="button" disabled={windowsOff} onClick={() => setWindows(windows.filter((_, i) => i !== index))} className="text-[11px] text-rose-300 disabled:opacity-40">{m.crossRemoveWindow}</button>
                )}
              </div>
            ))}
            {windows.length < SURVIVOR_CROSS_TRIBE_WINDOW_MAX && (
              <button type="button" disabled={windowsOff} onClick={() => setWindows([...windows, { opensOn: 'time', openDay: 'Friday', openTime: '00:00', closeDay: 'Sunday', closeTime: '13:00' }])}
                data-testid="survivor-governance-window-add" className="rounded-lg border border-white/15 px-2 py-1 text-[11px] text-white/80 disabled:opacity-40">
                {m.crossAddWindow}
              </button>
            )}
          </div>
        )}
        <SettingsRow label={m.withinTribeUnplayedOnly} control={<Toggle checked={draft.withinTribeUnplayedOnly} disabled={off || !draft.tradeRulesEnabled} onChange={(v) => set('withinTribeUnplayedOnly', v)} />} />
        <SettingsRow label={m.playedLockUntilTribal} control={<Toggle checked={draft.playedLockUntilTribal} disabled={off || !draft.tradeRulesEnabled} onChange={(v) => set('playedLockUntilTribal', v)} />} />
        <SettingsRow label={m.weeklyFreeze} description={m.weeklyFreezeHelp} control={<Toggle checked={draft.weeklyTradeFreezeEnabled} disabled={off || !draft.tradeRulesEnabled} onChange={(v) => set('weeklyTradeFreezeEnabled', v)} />} />
        <SettingsRow label={m.failureModeTitle} description={m.failureModeHelp} control={
          <Select value={draft.tradeCheckFailureMode ?? 'allow'} disabled={off || !draft.tradeRulesEnabled} onChange={(v) => set('tradeCheckFailureMode', v as SurvivorGovernanceSettings['tradeCheckFailureMode'])}>
            <option value="allow">{m.failureModeAllow}</option>
            <option value="hold">{m.failureModeHold}</option>
          </Select>} />
        {draft.weeklyTradeFreezeEnabled && (
          <SettingsRow label={m.weeklyFreezeAt} control={
            <div className="flex gap-2">
              <Select value={draft.weeklyTradeFreezeDay} disabled={off || !draft.tradeRulesEnabled} onChange={(v) => set('weeklyTradeFreezeDay', v as SurvivorGovernanceSettings['weeklyTradeFreezeDay'])}>{dayOptions}</Select>
              <Input type="time" value={draft.weeklyTradeFreezeTime} disabled={off || !draft.tradeRulesEnabled} onChange={(e) => set('weeklyTradeFreezeTime', e.target.value)} aria-label={m.weeklyFreezeAt} />
            </div>} />
        )}
      </SettingsSection>

      <SettingsSection id="sv-gov-split" title={m.splitTitle} description={m.splitDesc}>
        <SettingsRow label={m.splitTitle} control={
          <Select value={draft.tribeSplit} disabled={off || locked('tribeSplit')} onChange={(v) => set('tribeSplit', v as SurvivorGovernanceSettings['tribeSplit'])}>
            <option value="none">{m.splitNone}</option>
            <option value="rooks_vs_vets">{m.splitRooksVets}</option>
          </Select>} />
        {locked('tribeSplit') && <p className="text-[11px] text-white/40" data-testid="survivor-governance-split-locked">{m.locked}</p>}
        <SettingsRow label={m.experienceCrossLeague} description={m.experienceCrossLeagueHelp} control={<Toggle checked={Boolean(draft.experienceCrossLeague)} disabled={off} onChange={(v) => set('experienceCrossLeague', v)} />} />
      </SettingsSection>

      <SettingsSection id="sv-gov-week1" title={m.weekOneTitle} description={m.weekOneDesc}>
        <SettingsRow label={m.weekOneTitle} control={
          <Select value={draft.weekOneScoringStartDay ?? ''} disabled={off || locked('weekOneScoringStartDay')} onChange={(v) => set('weekOneScoringStartDay', (v || null) as SurvivorGovernanceSettings['weekOneScoringStartDay'])}>
            <option value="">{m.weekOneWhole}</option>
            {SURVIVOR_GOVERNANCE_DAYS.map((d) => <option key={d} value={d}>{m.weekOneFrom(d)}</option>)}
          </Select>} />
      </SettingsSection>

      <SettingsSection id="sv-gov-display" title={m.displayTitle}>
        <SettingsRow label={m.tribeEmojiInNames} description={m.tribeEmojiHelp} control={<Toggle checked={draft.tribeEmojiInNames} disabled={off} onChange={(v) => set('tribeEmojiInNames', v)} />} />
      </SettingsSection>

      <div className="flex items-center justify-end gap-3">
        {status && <p role="status" className="text-xs text-amber-200">{status}</p>}
        <button type="button" onClick={() => void save()} disabled={off} data-testid="survivor-governance-save"
          className="rounded-xl border border-[#ff3d81]/35 bg-cyan-950/30 px-4 py-2 text-xs text-[#ffd7e5] hover:bg-cyan-950/45 disabled:opacity-40">
          {saving ? m.saving : m.save}
        </button>
      </div>
    </div>
  )
}

function normalizeWindow(w: SurvivorCrossTribeWindow): SurvivorCrossTribeWindow {
  return w.opensOn === 'time'
    ? { opensOn: 'time', openDay: w.openDay ?? 'Friday', openTime: w.openTime ?? '00:00', closeDay: w.closeDay, closeTime: w.closeTime }
    : { opensOn: 'tribal', closeDay: w.closeDay, closeTime: w.closeTime }
}

function normalizeSwap(swap: SurvivorScheduledSwap): SurvivorScheduledSwap {
  const out: SurvivorScheduledSwap = { week: swap.week, mode: swap.mode }
  if (swap.mode === 'resize') out.tribeCount = swap.tribeCount ?? 3
  if (swap.mode === 'custom_pattern') { out.pattern = swap.pattern ?? 'ABC'; out.order = swap.order ?? 'season_points' }
  return out
}
