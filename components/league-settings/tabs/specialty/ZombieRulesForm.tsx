'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { HubCard, HubChoices, HubSavingNote, HubToggle } from '../hubFields'

/** As GET/PATCH /specialty-settings return it under `zombie`. */
export type ZombieRulesState = {
  value: {
    bashingThreshold: number
    maulingThreshold: number
    bashDecisionHours: number
    weaponShieldThreshold: number
    weaponAmbushThreshold: number
    bombEnabled: boolean
    reviveThreshold: number
    serumMaxHold: number
    whispererDefeatRule: string
    whispererSelection: string
    whispererAmbushCount: number
    infectionLossToWhisperer: boolean
    infectionLossToZombie: boolean
  }
  sportDefaults: {
    bashingThreshold: number
    maulingThreshold: number
    weaponShieldThreshold: number
    weaponAmbushThreshold: number
    reviveThreshold: number
    serumMaxHold: number
  }
  overridden: string[]
  universe: { name: string; promotionEnabled: boolean; promotionCount: number; relegationEnabled: boolean; relegationCount: number } | null
}

type Value = ZombieRulesState['value']
/** A value, or `null` to put an override back to the sport's rule. */
type Patch = { [K in keyof Value]?: Value[K] | null }

const DEBOUNCE_MS = 450

function presets(values: number[], current: number, label: (n: number) => string = String) {
  const all = values.includes(current) ? values : [...values, current].sort((a, b) => a - b)
  return all.map((n) => ({ value: n, label: label(n) }))
}

/** A points field (half points allowed) that saves on blur, with the sport's number and a reset. */
function PointsField({
  label,
  hint,
  value,
  sportDefault,
  overridden,
  disabled,
  onCommit,
  onReset,
  resetLabel,
  defaultLabel,
}: {
  label: string
  hint?: string
  value: number
  sportDefault: number
  overridden: boolean
  disabled?: boolean
  onCommit: (n: number) => void
  onReset: () => void
  resetLabel: string
  defaultLabel: string
}) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const commit = () => {
    const n = Number(draft)
    if (draft.trim() === '' || !Number.isFinite(n) || n <= 0 || !Number.isInteger(n * 2)) {
      setDraft(String(value))
      return
    }
    if (n !== value) onCommit(n)
  }
  return (
    <div>
      <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-white/40">{label}</span>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          inputMode="decimal"
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value.replace(/[^0-9.]/g, ''))}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
          className="w-24 rounded-xl border border-white/[0.10] bg-black/30 px-3 py-2 text-[13px] text-white outline-none focus:border-cyan-400/50 disabled:opacity-50"
        />
        <span className="text-[11px] text-white/45">{defaultLabel.replace('{{n}}', String(sportDefault))}</span>
        {overridden && !disabled ? (
          <button type="button" onClick={onReset} className="text-[11px] font-semibold text-cyan-200 underline-offset-2 hover:underline">
            {resetLabel}
          </button>
        ) : null}
      </div>
      {hint ? <p className="mt-1.5 text-[11px] leading-relaxed text-white/45">{hint}</p> : null}
    </div>
  )
}

/**
 * Zombie rules for THIS league, saved through PATCH /api/leagues/[leagueId]/specialty-settings.
 * Bash/maul/weapon/serum numbers override the sport's rules (`League.settings.zombie_rules`), which
 * the weekly resolution reads; Whisperer and infection settings write the columns it already reads.
 */
export function ZombieRulesForm({ leagueId, initial, canEdit }: { leagueId: string; initial: ZombieRulesState; canEdit: boolean }) {
  const { t } = useLanguage()
  const [state, setState] = useState<ZombieRulesState>(initial)
  const [saving, setSaving] = useState(false)
  const saved = useRef<ZombieRulesState>(initial)
  const pending = useRef<Patch>({})
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setState(initial)
    saved.current = initial
  }, [initial])
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const flush = useCallback(async () => {
    const zombie = pending.current
    pending.current = {}
    if (Object.keys(zombie).length === 0) return
    setSaving(true)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/specialty-settings`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zombie }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string; zombie?: ZombieRulesState | null }
      if (!res.ok || !data.zombie) {
        toast.error(data.error ?? t('lsHub.sp.saveFailed'))
        setState(saved.current)
        return
      }
      saved.current = data.zombie
      setState(data.zombie)
    } catch {
      toast.error(t('lsHub.sp.saveFailed'))
      setState(saved.current)
    } finally {
      setSaving(false)
    }
  }, [leagueId, t])

  const update = (patch: Patch) => {
    if (!canEdit) return
    setState((s) => {
      const value = { ...s.value }
      for (const [k, v] of Object.entries(patch)) {
        if (v !== null) (value as Record<string, unknown>)[k] = v
        else if (k in s.sportDefaults) (value as Record<string, unknown>)[k] = (s.sportDefaults as Record<string, unknown>)[k]
      }
      return { ...s, value }
    })
    pending.current = { ...pending.current, ...patch }
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      void flush()
    }, DEBOUNCE_MS)
  }

  const v = state.value
  const d = state.sportDefaults
  const isSet = (k: string) => state.overridden.includes(k)
  const pts = (k: 'bashingThreshold' | 'maulingThreshold' | 'weaponShieldThreshold' | 'weaponAmbushThreshold', label: string, hint?: string) => (
    <PointsField
      label={label}
      hint={hint}
      value={v[k]}
      sportDefault={d[k]}
      overridden={isSet(k)}
      disabled={!canEdit}
      onCommit={(n) => update({ [k]: n })}
      onReset={() => update({ [k]: null })}
      resetLabel={t('lsHub.sp.zr.reset')}
      defaultLabel={t('lsHub.sp.zr.sportDefault')}
    />
  )

  return (
    <div className="space-y-5" data-testid="specialty-zombie-rules-form">
      <HubCard title={t('lsHub.sp.zr.combat')}>
        <HubSavingNote saving={saving} text={t('lsHub.saving')} />
        <p className="text-[11px] leading-relaxed text-white/45">{t('lsHub.sp.zr.combatHint')}</p>
        {pts('bashingThreshold', t('lsHub.sp.zr.bash'), t('lsHub.sp.zr.bashHint'))}
        {pts('maulingThreshold', t('lsHub.sp.zr.maul'), t('lsHub.sp.zr.maulHint'))}
        <HubChoices
          label={t('lsHub.sp.zr.decision')}
          value={v.bashDecisionHours}
          disabled={!canEdit}
          options={presets([12, 24, 36, 48, 72, 96], v.bashDecisionHours, (n) => t('lsHub.sp.hoursN').replace('{{n}}', String(n)))}
          onChange={(bashDecisionHours) => update({ bashDecisionHours })}
        />
      </HubCard>

      <HubCard title={t('lsHub.sp.zr.items')}>
        {pts('weaponShieldThreshold', t('lsHub.sp.zr.knife'), t('lsHub.sp.zr.knifeHint'))}
        {pts('weaponAmbushThreshold', t('lsHub.sp.zr.bow'), t('lsHub.sp.zr.bowHint'))}
        <HubToggle
          label={t('lsHub.sp.zr.bomb')}
          hint={t('lsHub.sp.zr.bombHint')}
          checked={v.bombEnabled}
          disabled={!canEdit}
          onChange={(bombEnabled) => update({ bombEnabled })}
        />
        <HubChoices
          label={t('lsHub.sp.zr.revive')}
          value={v.reviveThreshold}
          disabled={!canEdit}
          options={presets([1, 2, 3, 4, 5], v.reviveThreshold)}
          onChange={(reviveThreshold) => update({ reviveThreshold })}
        />
        <HubChoices
          label={t('lsHub.sp.zr.serumMax')}
          value={v.serumMaxHold}
          disabled={!canEdit}
          options={presets([3, 5, 8, 10], v.serumMaxHold)}
          onChange={(serumMaxHold) => update({ serumMaxHold })}
        />
      </HubCard>

      <HubCard title={t('lsHub.sp.zr.whisperer')}>
        <HubChoices
          label={t('lsHub.sp.zr.selection')}
          value={v.whispererSelection}
          disabled={!canEdit}
          options={[
            { value: 'random', label: t('lsHub.sp.zr.selRandom') },
            { value: 'veteran_priority', label: t('lsHub.sp.zr.selVeteran'), hint: t('lsHub.sp.zr.selVeteranHint') },
          ]}
          onChange={(whispererSelection) => update({ whispererSelection })}
        />
        <HubChoices
          label={t('lsHub.sp.zr.ambushes')}
          value={v.whispererAmbushCount}
          disabled={!canEdit}
          options={presets([0, 1, 2, 3, 4, 5], v.whispererAmbushCount)}
          onChange={(whispererAmbushCount) => update({ whispererAmbushCount })}
        />
        <p className="text-[11px] leading-relaxed text-white/45">{t('lsHub.sp.zr.ambushesHint')}</p>
        <HubChoices
          label={t('lsHub.sp.zr.defeat')}
          value={v.whispererDefeatRule}
          disabled={!canEdit}
          options={[
            { value: 'new_whisperer_emerges', label: t('lsHub.sp.zr.defeatNew') },
            { value: 'whisperer_demoted_to_zombie', label: t('lsHub.sp.zr.defeatDemote') },
            { value: 'season_escalation', label: t('lsHub.sp.zr.defeatEscalate') },
            { value: 'commissioner_decides', label: t('lsHub.sp.zr.defeatCommish') },
          ]}
          onChange={(whispererDefeatRule) => update({ whispererDefeatRule })}
        />
      </HubCard>

      <HubCard title={t('lsHub.sp.zr.infection')}>
        <HubToggle
          label={t('lsHub.sp.zr.lossToWhisperer')}
          checked={v.infectionLossToWhisperer}
          disabled={!canEdit}
          onChange={(infectionLossToWhisperer) => update({ infectionLossToWhisperer })}
        />
        <HubToggle
          label={t('lsHub.sp.zr.lossToZombie')}
          checked={v.infectionLossToZombie}
          disabled={!canEdit}
          onChange={(infectionLossToZombie) => update({ infectionLossToZombie })}
        />
      </HubCard>

      {state.universe ? (
        <HubCard title={t('lsHub.sp.zr.universe')}>
          <p className="text-[12px] leading-relaxed text-white/75">
            {t('lsHub.sp.zr.universeLine')
              .replace('{{name}}', state.universe.name)
              .replace('{{up}}', state.universe.promotionEnabled ? String(state.universe.promotionCount) : '0')
              .replace('{{down}}', state.universe.relegationEnabled ? String(state.universe.relegationCount) : '0')}
          </p>
          <p className="text-[11px] leading-relaxed text-white/45">{t('lsHub.sp.zr.universeHint')}</p>
        </HubCard>
      ) : null}
    </div>
  )
}
