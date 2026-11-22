'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { SportConfigFull, SettingDef } from '@/lib/sportConfig/types'
import {
  expandSportConfigToggles,
  getCommissionerSettings,
  getRosterSlots,
  getScoringCategories,
  resolveSportConfigKey,
} from '@/lib/sportConfig'
import { SettingsSection } from './ui'
import { ScoringCategoryEditor } from './ScoringCategoryEditor'
import { RosterSlotEditor } from './RosterSlotEditor'
import { GamesCountSettingControl } from './GamesCountSettingControl'

const SECTION_ORDER = ['scoring', 'roster', 'schedule', 'advanced'] as const

function togglesFromBlob(sc: Record<string, unknown>): string[] {
  const t: string[] = []
  if (sc.enableIDP === true) t.push('IDP')
  if (sc.enableSuperflex === true) t.push('SUPERFLEX')
  if (sc.enableTEPremium === true) t.push('TE_PREMIUM')
  return t
}

export function SportConfigSettingsPanel({
  sport,
  leagueSettings,
  onSportConfigChange,
  canEdit,
  omitSections,
}: {
  sport: string
  leagueSettings: Record<string, unknown>
  onSportConfigChange: (next: Record<string, unknown>) => void
  canEdit: boolean
  /** Hide sport-config subsections (e.g. scoring moved to dedicated commissioner scoring panel). */
  omitSections?: Partial<Record<(typeof SECTION_ORDER)[number], boolean>>
}) {
  const disabled = !canEdit
  const sportKey = resolveSportConfigKey(sport)

  const [fullConfig, setFullConfig] = useState<SportConfigFull | null>(null)
  const [loadError, setLoadError] = useState(false)

  const baseSc = useMemo(() => {
    const raw = leagueSettings.sportConfig
    return raw && typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  }, [leagueSettings.sportConfig])

  const [local, setLocal] = useState<Record<string, unknown>>({})

  useEffect(() => {
    setLocal(baseSc)
  }, [baseSc])

  useEffect(() => {
    let cancelled = false
    fetch(`/api/sport-config?sport=${encodeURIComponent(sportKey)}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: SportConfigFull) => {
        if (!cancelled) setFullConfig(data)
      })
      .catch(() => {
        if (!cancelled) setLoadError(true)
      })
    return () => {
      cancelled = true
    }
  }, [sportKey])

  const patch = useCallback(
    (partial: Record<string, unknown>) => {
      setLocal((prev) => {
        const next = { ...prev, ...partial }
        onSportConfigChange(next)
        return next
      })
    },
    [onSportConfigChange],
  )

  const activeToggles = useMemo(() => togglesFromBlob(local), [local])
  const expandedToggles = useMemo(() => expandSportConfigToggles(activeToggles), [activeToggles])

  const scoringCategories = useMemo(() => {
    if (!fullConfig) return []
    return getScoringCategories(fullConfig.sport, expandedToggles)
  }, [fullConfig, expandedToggles])

  const rosterSlots = useMemo(() => {
    if (!fullConfig) return []
    return getRosterSlots(fullConfig.sport, expandedToggles)
  }, [fullConfig, expandedToggles])

  const settingDefs = useMemo(() => {
    if (!fullConfig) return []
    return getCommissionerSettings(fullConfig.sport, expandedToggles)
  }, [fullConfig, expandedToggles])

  const defsBySection = useMemo(() => {
    const m: Record<string, SettingDef[]> = {}
    for (const s of SECTION_ORDER) m[s] = []
    for (const d of settingDefs) {
      const sec = SECTION_ORDER.includes(d.section as (typeof SECTION_ORDER)[number]) ? d.section : 'advanced'
      m[sec] = m[sec] ?? []
      m[sec].push(d)
    }
    return m
  }, [settingDefs])

  const categoryPoints = useMemo(() => {
    const raw = local.categoryPoints
    const fromLeague = raw && typeof raw === 'object' && raw !== null ? (raw as Record<string, number>) : {}
    const out: Record<string, number> = { ...fromLeague }
    for (const c of scoringCategories) {
      if (out[c.key] === undefined) out[c.key] = c.defaultPoints
    }
    return out
  }, [local.categoryPoints, scoringCategories])

  const slotCounts = useMemo(() => {
    const raw = local.rosterSlotCounts
    const fromLeague = raw && typeof raw === 'object' && raw !== null ? (raw as Record<string, number>) : {}
    const out: Record<string, number> = { ...fromLeague }
    for (const s of rosterSlots) {
      if (out[s.key] === undefined) out[s.key] = s.defaultCount
    }
    return out
  }, [local.rosterSlotCounts, rosterSlots])

  const setCategoryPoints = useCallback(
    (next: Record<string, number>) => {
      patch({ categoryPoints: next, scoringPreset: local.scoringPreset ?? 'CUSTOM' })
    },
    [patch, local.scoringPreset],
  )

  const onChangePoints = (key: string, points: number) => {
    setCategoryPoints({ ...categoryPoints, [key]: points })
  }

  const onResetGroup = (group: string) => {
    const next = { ...categoryPoints }
    for (const c of scoringCategories) {
      if (c.group === group) next[c.key] = c.defaultPoints
    }
    setCategoryPoints(next)
  }

  const onResetAll = () => {
    const next: Record<string, number> = {}
    for (const c of scoringCategories) next[c.key] = c.defaultPoints
    setCategoryPoints(next)
  }

  const onChangeSlotCount = (key: string, count: number) => {
    patch({ rosterSlotCounts: { ...slotCounts, [key]: count } })
  }

  const renderDef = (d: SettingDef) => {
    const val = local[d.key] ?? d.defaultValue
    if (d.type === 'toggle') {
      return (
        <label className="flex cursor-pointer items-center gap-2 text-[13px] text-white/80">
          <input
            type="checkbox"
            className="rounded border-white/20 bg-[#0a1220]"
            checked={Boolean(val)}
            disabled={disabled || (d.locksAfterStart && false)}
            onChange={(e) => patch({ [d.key]: e.target.checked })}
          />
          <span>{d.label}</span>
        </label>
      )
    }
    if (d.type === 'number') {
      return (
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-[13px] text-white/70">{d.label}</span>
          <input
            type="number"
            min={d.min}
            max={d.max}
            disabled={disabled}
            className="w-28 rounded-lg border border-white/[0.12] bg-[#0a1220] px-2 py-1 text-white"
            value={Number(val)}
            onChange={(e) => patch({ [d.key]: Number(e.target.value) })}
          />
        </div>
      )
    }
    if (d.type === 'select') {
      return (
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-[13px] text-white/70">{d.label}</span>
          <select
            className="max-w-xs rounded-lg border border-white/[0.12] bg-[#0a1220] px-2 py-1 text-[13px] text-white"
            disabled={disabled}
            value={String(val)}
            onChange={(e) => {
              const opt = d.options?.find((o) => String(o.value) === e.target.value)
              patch({ [d.key]: opt?.value ?? e.target.value })
            }}
          >
            {(d.options ?? []).map((o) => (
              <option key={String(o.value)} value={String(o.value)}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      )
    }
    if (d.type === 'scoring_editor' || d.type === 'roster_editor') {
      return null
    }
    return null
  }

  if (loadError && !fullConfig) {
    return (
      <div className="px-6 py-8 text-[13px] text-red-400">
        Could not load sport configuration. Try again.
      </div>
    )
  }

  if (!fullConfig) {
    return (
      <div className="space-y-3 px-6 py-8">
        <div className="h-10 animate-pulse rounded-xl bg-white/[0.06]" />
        <div className="h-10 animate-pulse rounded-xl bg-white/[0.06]" />
      </div>
    )
  }

  return (
    <div className="pb-6 text-[13px] text-white/85" data-testid="sport-config-settings-panel">
      <p className="border-b border-white/[0.06] px-6 py-4 text-[12px] text-white/50">
        {fullConfig.displayName} — defaults from sport config. Changes save automatically.
      </p>

      {/* NBA/NHL/MLB only; renders nothing for any other sport. */}
      <GamesCountSettingControl sport={sport} sportConfig={local} onPatch={patch} disabled={disabled} />

      {SECTION_ORDER.map((section) => {
        if (omitSections?.[section]) return null
        const defs = defsBySection[section] ?? []
        if (defs.length === 0 && section !== 'scoring' && section !== 'roster') return null
        const title =
          section === 'scoring'
            ? 'Scoring'
            : section === 'roster'
              ? 'Roster'
              : section === 'schedule'
                ? 'Schedule'
                : 'Advanced'
        return (
          <SettingsSection key={section} title={title}>
            {defs.map((d) => (
              <div key={d.key}>
                {d.description ? <p className="mb-1 text-[11px] text-white/40">{d.description}</p> : null}
                {renderDef(d)}
              </div>
            ))}
            {section === 'scoring' && scoringCategories.length > 0 ? (
              <ScoringCategoryEditor
                categories={scoringCategories}
                categoryPoints={categoryPoints}
                onChangePoints={onChangePoints}
                onResetGroup={onResetGroup}
                onResetAll={onResetAll}
                disabled={disabled}
                tePremiumNote={activeToggles.includes('TE_PREMIUM')}
              />
            ) : null}
            {section === 'roster' && rosterSlots.length > 0 ? (
              <RosterSlotEditor
                slots={rosterSlots}
                slotCounts={slotCounts}
                onChangeCount={onChangeSlotCount}
                disabled={disabled}
              />
            ) : null}
          </SettingsSection>
        )
      })}
    </div>
  )
}
