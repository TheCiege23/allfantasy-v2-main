'use client'

/**
 * [NEW] components/league-settings/RosterSettingsEditor.tsx
 * Editable roster settings panel matching the screenshot design.
 * Shows position rows with plus/minus controls, colored dots, and read-only mode for non-commissioners.
 * Supports NFL sections: Offense, Flex, K/DST, IDP, Bench/Reserve, and C2C College.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { DualTrackRosterRenderer } from './roster/DualTrackRosterRenderer'
import { ResetToDefaultButton } from './roster/ResetToDefaultButton'
import { RosterSettingsModalShell } from './roster/RosterSettingsModalShell'
import { RosterValidationBanner } from './roster/RosterValidationBanner'
import type { RosterConfig, SlotDef, UnifiedRosterSection } from './roster/types'
import { emitLeagueDraftRoomRevalidate } from '@/lib/draft-room/emitLeagueDraftRoomRevalidate'

interface RosterTemplateOption {
  key: string
  label: string
  description?: string
  slots: Record<string, number>
}

interface ImportPreviewResult {
  mappedSlots: Record<string, number>
  unmappedSlots: string[]
  validation: {
    valid: boolean
    warnings: string[]
    errors: string[]
  }
}

function flattenSections(sections: UnifiedRosterSection[] | undefined): Record<string, number> {
  if (!sections || sections.length === 0) return {}
  const merged: Record<string, number> = {}
  for (const section of sections) {
    for (const [key, value] of Object.entries(section.slots ?? {})) {
      merged[key] = Number(value || 0)
    }
  }
  return merged
}

function getFootballSlotDefaults(sport: unknown): Record<string, number> {
  const normalized = String(sport ?? '').trim().toUpperCase()
  return {
    QB: 1,
    RB: 2,
    WR: 2,
    TE: 1,
    FLEX: 1,
    SUPERFLEX: 0,
    K: 1,
    DEF: 1,
    BN: normalized === 'NCAAF' ? 8 : 6,
    IR: 1,
  }
}

const FOOTBALL_SLOT_ORDER = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPERFLEX', 'K', 'DEF', 'BN', 'IR']

function isFootballRosterSport(value: unknown): boolean {
  const normalized = String(value ?? '').trim().toUpperCase()
  return normalized === 'NFL' || normalized === 'NCAAF'
}

function normalizeFootballSlots(slots: Record<string, number>, sport: unknown): Record<string, number> {
  if (!isFootballRosterSport(sport)) return slots
  const next = { ...slots }
  if (next.SUPERFLEX == null && next.SF != null) next.SUPERFLEX = Number(next.SF || 0)
  if (next.DEF == null && next.DST != null) next.DEF = Number(next.DST || 0)
  delete next.SF
  delete next.DST
  for (const [key, value] of Object.entries(getFootballSlotDefaults(sport))) {
    if (next[key] == null || !Number.isFinite(Number(next[key]))) {
      next[key] = value
    }
  }
  return next
}

function buildSectionsFromSlots(slots: Record<string, number>): UnifiedRosterSection[] {
  const hasC2C = Object.keys(slots).some((k) => k.startsWith('C2C_'))
  if (!hasC2C) {
    const ordered: Record<string, number> = {}
    for (const key of FOOTBALL_SLOT_ORDER) {
      if (Object.prototype.hasOwnProperty.call(slots, key)) ordered[key] = slots[key] ?? 0
    }
    for (const [key, value] of Object.entries(slots)) {
      if (!Object.prototype.hasOwnProperty.call(ordered, key)) ordered[key] = value
    }
    return [{ key: 'primary', label: 'Primary', slots: ordered }]
  }

  const primary: Record<string, number> = {}
  const c2c: Record<string, number> = {}
  for (const [key, value] of Object.entries(slots)) {
    if (key.startsWith('C2C_')) c2c[key] = value
    else primary[key] = value
  }
  return [
    { key: 'primary', label: 'Primary', slots: primary },
    { key: 'c2c', label: 'C2C / Dual Track', slots: c2c },
  ]
}

export function RosterSettingsEditor({ leagueId }: { leagueId: string }) {
  const [slotDefs, setSlotDefs] = useState<SlotDef[]>([])
  const [config, setConfig] = useState<RosterConfig | null>(null)
  const [templates, setTemplates] = useState<RosterTemplateOption[]>([])
  const [selectedTemplateKey, setSelectedTemplateKey] = useState<string>('custom')
  const [warnings, setWarnings] = useState<string[]>([])
  const [matchesTemplate, setMatchesTemplate] = useState(true)
  const [readOnlyMode, setReadOnlyMode] = useState(false)
  const [defaultTemplateKey, setDefaultTemplateKey] = useState<string | null>(null)
  const [rosterSport, setRosterSport] = useState<string | null>(null)
  const [isCommissioner, setIsCommissioner] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [pendingSlots, setPendingSlots] = useState<Record<string, number>>({})
  const [importSourcePlatform, setImportSourcePlatform] = useState('yahoo')
  const [importPayloadText, setImportPayloadText] = useState(`{
  "QB": 1,
  "RB": 2,
  "WR": 2,
  "TE": 1,
  "BN": 6
}`)
  const [importPreview, setImportPreview] = useState<ImportPreviewResult | null>(null)
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    let active = true
    fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/roster-settings`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (!active) return
        setSlotDefs(data.slotDefs ?? [])
        setConfig(data.config ?? null)
        setTemplates(data.templates ?? [])
        setWarnings(data.unifiedConfig?.rosterWarnings ?? [])
        setMatchesTemplate(data.unifiedConfig?.rosterMatchesTemplate ?? true)
        setReadOnlyMode(Boolean(data.roleAwareReadOnlyMode))
        setDefaultTemplateKey((data.defaultTemplateKey as string | undefined) ?? null)
        setRosterSport(typeof data.sport === 'string' ? data.sport : null)
        setIsCommissioner(data.isCommissioner ?? false)
        setSelectedTemplateKey(data.config?.templateKey ?? 'custom')
        const fromUnified = flattenSections(data.unifiedConfig?.rosterConfig?.sections)
        setPendingSlots(normalizeFootballSlots(
          Object.keys(fromUnified).length > 0 ? fromUnified : (data.config?.slots ?? {}),
          data.sport,
        ))
      })
      .catch(() => { if (active) setError('Failed to load') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [leagueId])

  const adjust = useCallback((key: string, delta: number) => {
    if (!isCommissioner) return
    const def = slotDefs.find((s) => s.key === key)
    if (!def) return
    setPendingSlots((prev) => {
      const current = prev[key] ?? 0
      const next = Math.max(def.minCount, Math.min(def.maxCount, current + delta))
      return { ...prev, [key]: next }
    })
  }, [isCommissioner, slotDefs])

  const save = useCallback(async () => {
    setSaving(true); setError(null); setSuccess(false)
    try {
      const res = await fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/roster-settings`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slots: pendingSlots, templateKey: selectedTemplateKey }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Save failed'); return }
      setConfig(data.config)
      setSelectedTemplateKey(data.config?.templateKey ?? selectedTemplateKey)
      setWarnings(data.unifiedConfig?.rosterWarnings ?? [])
      setMatchesTemplate(data.unifiedConfig?.rosterMatchesTemplate ?? true)
      setSuccess(true)
      emitLeagueDraftRoomRevalidate(leagueId)
    } catch { setError('Request failed') }
    finally { setSaving(false) }
  }, [leagueId, pendingSlots, selectedTemplateKey])

  const resetToDefault = useCallback(() => {
    if (config) {
      setPendingSlots(config.slots)
      setSelectedTemplateKey(config.templateKey)
    }
  }, [config])

  const applySelectedTemplate = useCallback(() => {
    const template = templates.find((t) => t.key === selectedTemplateKey)
    if (!template) return
    setPendingSlots(template.slots)
    setSuccess(false)
    setError(null)
  }, [selectedTemplateKey, templates])

  const parseImportConfig = useCallback((): Record<string, number> | null => {
    try {
      const parsed = JSON.parse(importPayloadText) as Record<string, unknown>
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setError('Import payload must be a JSON object')
        return null
      }

      const config: Record<string, number> = {}
      for (const [key, value] of Object.entries(parsed)) {
        const numeric = Number(value)
        if (!Number.isFinite(numeric)) {
          setError(`Import slot ${key} must be numeric`)
          return null
        }
        config[key] = numeric
      }

      return config
    } catch {
      setError('Invalid JSON import payload')
      return null
    }
  }, [importPayloadText])

  const previewImport = useCallback(async () => {
    if (!isCommissioner) return
    const importedConfig = parseImportConfig()
    if (!importedConfig) return

    setImporting(true)
    setError(null)
    setSuccess(false)
    try {
      const res = await fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/roster-settings/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'preview',
          sourcePlatform: importSourcePlatform,
          importedConfig,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Import preview failed')
        return
      }

      setImportPreview({
        mappedSlots: data.mappedSlots ?? {},
        unmappedSlots: data.unmappedSlots ?? [],
        validation: data.validation ?? { valid: true, warnings: [], errors: [] },
      })
    } catch {
      setError('Import preview request failed')
    } finally {
      setImporting(false)
    }
  }, [importSourcePlatform, isCommissioner, leagueId, parseImportConfig])

  const applyImport = useCallback(async () => {
    if (!isCommissioner) return
    const importedConfig = parseImportConfig()
    if (!importedConfig) return

    setImporting(true)
    setError(null)
    setSuccess(false)
    try {
      const res = await fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/roster-settings/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'apply',
          sourcePlatform: importSourcePlatform,
          importedConfig,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Import apply failed')
        return
      }

      const unified = data.unifiedConfig
      if (unified?.rosterConfig?.sections) {
        const merged = flattenSections(unified.rosterConfig.sections)
        setPendingSlots(normalizeFootballSlots(merged, rosterSport))
      }
      setSelectedTemplateKey('custom')
      setWarnings(unified?.rosterWarnings ?? [])
      setMatchesTemplate(Boolean(unified?.rosterMatchesTemplate))
      setImportPreview(null)
      setSuccess(true)
      emitLeagueDraftRoomRevalidate(leagueId)
    } catch {
      setError('Import apply request failed')
    } finally {
      setImporting(false)
    }
  }, [importSourcePlatform, isCommissioner, leagueId, parseImportConfig, rosterSport])

  const resetToLeagueDefault = useCallback(async () => {
    if (!isCommissioner) return
    setSaving(true)
    setError(null)
    setSuccess(false)
    try {
      const res = await fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/roster-settings/reset-default`, {
        method: 'POST',
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Reset failed'); return }
      setConfig(data.config)
      setSelectedTemplateKey(data.config?.templateKey ?? defaultTemplateKey ?? 'custom')
      setWarnings(data.unifiedConfig?.rosterWarnings ?? [])
      setMatchesTemplate(data.unifiedConfig?.rosterMatchesTemplate ?? true)
      if (typeof data.sport === 'string') setRosterSport(data.sport)
      const fromUnified = flattenSections(data.unifiedConfig?.rosterConfig?.sections)
      setPendingSlots(normalizeFootballSlots(
        Object.keys(fromUnified).length > 0 ? fromUnified : (data.config?.slots ?? {}),
        data.sport,
      ))
      setSuccess(true)
      emitLeagueDraftRoomRevalidate(leagueId)
    } catch {
      setError('Reset request failed')
    } finally {
      setSaving(false)
    }
  }, [defaultTemplateKey, isCommissioner, leagueId])

  const rosterTotals = useMemo(() => {
    let starters = 0
    let bench = 0
    for (const [key, count] of Object.entries(pendingSlots)) {
      const def = slotDefs.find((s) => s.key === key)
      if (!def || count <= 0) continue
      if (def.category === 'bench' || def.category === 'reserve' || def.category === 'college') bench += count
      else starters += count
    }
    return { starters, bench, total: starters + bench }
  }, [pendingSlots, slotDefs])

  const activeSections = useMemo(() => buildSectionsFromSlots(pendingSlots), [pendingSlots])

  if (loading) return <div className="py-8 text-center text-sm text-white/50">Loading roster settings...</div>

  const hasChanges = config && JSON.stringify(pendingSlots) !== JSON.stringify(config.slots)

  return (
    <RosterSettingsModalShell title="Roster Settings" subtitle="Set lineup slots and reserve structure">
      <RosterValidationBanner warnings={warnings} errors={error ? [error] : []} />

      <div className="flex gap-4 text-[11px] text-white/50">
        <span>Starters: <span className="font-mono text-white/80">{rosterTotals.starters}</span></span>
        <span>Bench/Reserve: <span className="font-mono text-white/80">{rosterTotals.bench}</span></span>
        <span>Total: <span className="font-mono text-white/80">{rosterTotals.total}</span></span>
      </div>

      {!matchesTemplate && (
        <div className="rounded-lg border border-amber-500/25 bg-amber-950/20 px-3 py-2 text-xs text-amber-200">
          Current roster no longer matches the league default template.
        </div>
      )}

      {isCommissioner && templates.length > 0 && (
        <div className="space-y-2 rounded-lg border border-white/10 bg-white/[0.02] p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-white/40">Template</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <select
              value={selectedTemplateKey}
              onChange={(event) => setSelectedTemplateKey(event.target.value)}
              aria-label="Roster template"
              title="Roster template"
              className="min-w-0 flex-1 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs text-white outline-none focus:border-cyan-500/50"
            >
              {templates.map((template) => (
                <option key={template.key} value={template.key}>
                  {template.label}
                </option>
              ))}
              <option value="custom">Custom</option>
            </select>
            <button
              type="button"
              onClick={applySelectedTemplate}
              disabled={selectedTemplateKey === 'custom' || saving}
              className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs text-white/70 transition hover:bg-white/10 disabled:cursor-default disabled:opacity-40"
            >
              Apply Template
            </button>
          </div>
        </div>
      )}

      {isCommissioner && (
        <div className="space-y-2 rounded-lg border border-white/10 bg-white/[0.02] p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-white/40">Import Mapping</p>
          <div className="flex flex-col gap-2">
            <label className="text-[11px] text-white/50" htmlFor="roster-import-source">Source platform</label>
            <select
              id="roster-import-source"
              value={importSourcePlatform}
              onChange={(event) => setImportSourcePlatform(event.target.value)}
              className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs text-white outline-none focus:border-cyan-500/50"
              aria-label="Import source platform"
              title="Import source platform"
            >
              <option value="yahoo">Yahoo</option>
              <option value="fpl">FPL</option>
              <option value="espn">ESPN</option>
              <option value="sleeper">Sleeper</option>
            </select>

            <label className="text-[11px] text-white/50" htmlFor="roster-import-json">Imported slot JSON</label>
            <textarea
              id="roster-import-json"
              value={importPayloadText}
              onChange={(event) => setImportPayloadText(event.target.value)}
              rows={7}
              className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 font-mono text-xs text-white outline-none focus:border-cyan-500/50"
            />

            <div className="flex gap-2">
              <button
                type="button"
                onClick={previewImport}
                disabled={importing || saving}
                className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs text-white/70 transition hover:bg-white/10 disabled:cursor-default disabled:opacity-40"
              >
                Preview Import
              </button>
              <button
                type="button"
                onClick={applyImport}
                disabled={importing || saving}
                className="rounded-lg border border-cyan-500/30 bg-cyan-950/20 px-3 py-2 text-xs text-cyan-200 transition hover:bg-cyan-900/25 disabled:cursor-default disabled:opacity-40"
              >
                Apply Import
              </button>
            </div>
          </div>

          {importPreview && (
            <div className="space-y-1 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-white/70">
              <p>Mapped slots: {Object.keys(importPreview.mappedSlots).length}</p>
              <p>Unmapped slots: {importPreview.unmappedSlots.join(', ') || 'None'}</p>
              {!importPreview.validation.valid && (
                <p className="text-red-300">Validation errors: {importPreview.validation.errors.join('; ')}</p>
              )}
              {importPreview.validation.warnings.length > 0 && (
                <p className="text-amber-200">Validation warnings: {importPreview.validation.warnings.join('; ')}</p>
              )}
            </div>
          )}
        </div>
      )}

      {(readOnlyMode || !isCommissioner) && (
        <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-[11px] text-white/40">
          Only commissioners can edit roster settings.
        </div>
      )}

      <DualTrackRosterRenderer
        slotDefs={slotDefs}
        pendingSlots={pendingSlots}
        sections={activeSections}
        isCommissioner={isCommissioner}
        onAdjust={(key, delta) => {
          setSelectedTemplateKey('custom')
          adjust(key, delta)
        }}
      />

      {isCommissioner && (
        <div className="space-y-2 border-t border-white/10 pt-3">
          {success && <div className="rounded-lg border border-emerald-500/20 bg-emerald-950/20 px-3 py-2 text-xs text-emerald-300">Roster settings saved.</div>}
          <div className="flex gap-2">
            <button type="button" disabled={saving || !hasChanges} onClick={save}
              className="flex-1 rounded-lg bg-cyan-600/80 px-4 py-2.5 text-sm font-medium text-white hover:bg-cyan-600 disabled:opacity-50">
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button
              type="button"
              onClick={resetToLeagueDefault}
              disabled={saving || (matchesTemplate && selectedTemplateKey === (defaultTemplateKey ?? selectedTemplateKey))}
              className="rounded-lg border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-xs text-amber-200 transition hover:bg-amber-900/25 disabled:cursor-default disabled:opacity-40"
            >
              Reset to League Default
            </button>
            {hasChanges && (
              <ResetToDefaultButton onClick={resetToDefault} disabled={saving} />
            )}
          </div>
        </div>
      )}
    </RosterSettingsModalShell>
  )
}
