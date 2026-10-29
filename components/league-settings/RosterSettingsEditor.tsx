'use client'

/**
 * components/league-settings/RosterSettingsEditor.tsx
 * Commissioner roster settings: template select + apply, compact per-slot steppers, save / reset.
 * Read-only for non-commissioners.
 *
 * 🛑 SPORT-CORRECT BY CONSTRUCTION. Rows, grouping and order come from the `slotDefs` the roster
 * API serves for the league's sport (`lib/roster-engine` registry: NFL, NCAAF, NBA, NCAAB, MLB,
 * NHL, SOCCER). The football helpers below run ONLY for NFL/NCAAF. When the API refuses a sport
 * it does not support, the editor says "not available for this sport" — it never falls back to
 * NFL slots. A stored slot map that belongs to another sport is flagged, not rendered as-is.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ResetToDefaultButton } from './roster/ResetToDefaultButton'
import { RosterSettingsModalShell } from './roster/RosterSettingsModalShell'
import { RosterSectionRenderer } from './roster/RosterSectionRenderer'
import { RosterValidationBanner } from './roster/RosterValidationBanner'
import { alignSlotsToSport, buildRosterGroups, isFootballSport } from './roster/buildRosterGroups'
import type { RosterConfig, SlotDef, UnifiedRosterSection } from './roster/types'
import { emitLeagueDraftRoomRevalidate } from '@/lib/draft-room/emitLeagueDraftRoomRevalidate'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { RosterLabel } from '@/components/league-labels/RosterLabel'
import { matchRosterLabel } from '@/lib/league-labels/liveValues'
import { useMidSeasonConfirm } from '@/components/league-settings/useMidSeasonConfirm'

interface RosterTemplateOption {
  key: string
  label: string
  description?: string
  slots: Record<string, number>
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

/** Football only: SF/DST aliases and the always-visible core slots. A no-op for every other sport. */
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

/** Football defs in the canonical football order; every other sport keeps its registry order. */
function orderDefsForSport(defs: SlotDef[], sport: unknown): SlotDef[] {
  if (!isFootballRosterSport(sport)) return defs
  const rank = (k: string) => {
    const i = FOOTBALL_SLOT_ORDER.indexOf(k)
    return i === -1 ? FOOTBALL_SLOT_ORDER.length : i
  }
  return defs
    .map((d, i) => ({ d, i }))
    .sort((a, b) => rank(a.d.key) - rank(b.d.key) || a.i - b.i)
    .map(({ d }) => d)
}

/** Stored slots → this sport's slot map. Football gets its normaliser; nobody gets football slots. */
function slotsForSport(raw: Record<string, number>, defs: SlotDef[], sport: unknown) {
  const normalized = normalizeFootballSlots(raw, sport)
  return alignSlotsToSport(normalized, defs)
}

function sportLabel(sport: string | null | undefined): string {
  return String(sport ?? '').trim().toUpperCase() || '—'
}

export function RosterSettingsEditor({ leagueId, sport: leagueSport }: { leagueId: string; sport?: string | null }) {
  const { t } = useLanguage()
  const { confirmFetch, dialog: midSeasonDialog } = useMidSeasonConfirm()
  const [slotDefs, setSlotDefs] = useState<SlotDef[]>([])
  const [config, setConfig] = useState<RosterConfig | null>(null)
  const [baselineSlots, setBaselineSlots] = useState<Record<string, number>>({})
  const [templates, setTemplates] = useState<RosterTemplateOption[]>([])
  const [selectedTemplateKey, setSelectedTemplateKey] = useState<string>('custom')
  const [warnings, setWarnings] = useState<string[]>([])
  const [matchesTemplate, setMatchesTemplate] = useState(true)
  const [readOnlyMode, setReadOnlyMode] = useState(false)
  const [defaultTemplateKey, setDefaultTemplateKey] = useState<string | null>(null)
  const [rosterSport, setRosterSport] = useState<string | null>(leagueSport ?? null)
  const [isCommissioner, setIsCommissioner] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [foreignRoster, setForeignRoster] = useState(false)
  const [success, setSuccess] = useState(false)
  // What the roster change did to the draft (rounds follow the roster), so it is never a surprise.
  const [draftNote, setDraftNote] = useState<string | null>(null)
  const [pendingSlots, setPendingSlots] = useState<Record<string, number>>({})

  /** Apply a roster-settings payload (GET, PUT or reset) to state, sport-correctly. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped API payload, read defensively
  const applyPayload = useCallback((data: Record<string, any>, defsOverride?: SlotDef[]) => {
    const defs: SlotDef[] = defsOverride ?? (Array.isArray(data.slotDefs) ? data.slotDefs : [])
    const sport: string | null = typeof data.sport === 'string' ? data.sport : (leagueSport ?? null)
    const fromUnified = flattenSections(data.unifiedConfig?.rosterConfig?.sections)
    const raw = Object.keys(fromUnified).length > 0 ? fromUnified : (data.config?.slots ?? {})
    const aligned = slotsForSport(raw, defs, sport)
    const tpls: RosterTemplateOption[] = Array.isArray(data.templates) ? data.templates : []
    const defaultKey: string | null = (data.defaultTemplateKey as string | undefined) ?? null
    setRosterSport(sport)
    setBaselineSlots(aligned.slots)
    setForeignRoster(aligned.foreign)
    if (aligned.foreign) {
      // A roster saved for a different sport: start from this sport's default template so the
      // commissioner sees real positions and can save the fix in one click.
      const fallback = tpls.find((tp) => tp.key === defaultKey) ?? tpls[0]
      setPendingSlots(fallback ? alignSlotsToSport(fallback.slots, defs).slots : aligned.slots)
      setSelectedTemplateKey(fallback?.key ?? 'custom')
    } else {
      setPendingSlots(aligned.slots)
      setSelectedTemplateKey(data.config?.templateKey ?? 'custom')
    }
  }, [leagueSport])

  useEffect(() => {
    let active = true
    fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/roster-settings`, { cache: 'no-store' })
      .then(async (r) => {
        const data = await r.json().catch(() => ({}))
        if (!active) return
        if (!r.ok) {
          // 400 = the roster engine has no service for this sport. Say so; never show NFL slots.
          if (r.status === 400) setUnavailable(true)
          else setError(data?.error ?? t('lsEd.loadFailed'))
          return
        }
        const defs: SlotDef[] = Array.isArray(data.slotDefs) ? data.slotDefs : []
        if (defs.length === 0) { setUnavailable(true); return }
        const sport = typeof data.sport === 'string' ? data.sport : null
        const ordered = orderDefsForSport(defs, sport)
        setSlotDefs(ordered)
        setConfig(data.config ?? null)
        setTemplates(data.templates ?? [])
        setWarnings(data.unifiedConfig?.rosterWarnings ?? [])
        setMatchesTemplate(data.unifiedConfig?.rosterMatchesTemplate ?? true)
        setReadOnlyMode(Boolean(data.roleAwareReadOnlyMode))
        setDefaultTemplateKey((data.defaultTemplateKey as string | undefined) ?? null)
        setIsCommissioner(data.isCommissioner ?? false)
        applyPayload(data, ordered)
      })
      .catch(() => { if (active) setError(t('lsEd.loadFailed')) })
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
    setSuccess(false)
  }, [isCommissioner, slotDefs])

  const save = useCallback(async () => {
    setSaving(true); setError(null); setSuccess(false)
    try {
      // Only this sport's keys are ever sent.
      const slots = alignSlotsToSport(pendingSlots, slotDefs).slots
      const res = await confirmFetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/roster-settings`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slots, templateKey: selectedTemplateKey }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? t('lsEd.saveFailed')); return }
      setConfig(data.config)
      setWarnings(data.unifiedConfig?.rosterWarnings ?? [])
      setMatchesTemplate(data.unifiedConfig?.rosterMatchesTemplate ?? true)
      applyPayload({ ...data, sport: rosterSport }, slotDefs)
      setSuccess(true)
      setDraftNote(describeDraftRoundsSync(data.draftRounds, t))
      emitLeagueDraftRoomRevalidate(leagueId)
    } catch { setError(t('lsEd.requestFailed')) }
    finally { setSaving(false) }
  }, [applyPayload, confirmFetch, leagueId, pendingSlots, rosterSport, selectedTemplateKey, slotDefs])

  const resetToSaved = useCallback(() => {
    setPendingSlots(baselineSlots)
    if (config) setSelectedTemplateKey(config.templateKey)
    setSuccess(false)
  }, [baselineSlots, config])

  const applySelectedTemplate = useCallback(() => {
    const template = templates.find((tp) => tp.key === selectedTemplateKey)
    if (!template) return
    setPendingSlots(alignSlotsToSport(template.slots, slotDefs).slots)
    setSuccess(false)
    setError(null)
  }, [selectedTemplateKey, slotDefs, templates])

  const resetToLeagueDefault = useCallback(async () => {
    if (!isCommissioner) return
    setSaving(true)
    setError(null)
    setSuccess(false)
    try {
      const res = await confirmFetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/roster-settings/reset-default`, {
        method: 'POST',
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? t('lsEd.ro.resetFailed')); return }
      setConfig(data.config)
      setWarnings(data.unifiedConfig?.rosterWarnings ?? [])
      setMatchesTemplate(data.unifiedConfig?.rosterMatchesTemplate ?? true)
      applyPayload({ ...data, sport: data.sport ?? rosterSport, templates }, slotDefs)
      if (!data.config?.templateKey) setSelectedTemplateKey(defaultTemplateKey ?? 'custom')
      setSuccess(true)
      setDraftNote(describeDraftRoundsSync(data.draftRounds, t))
      emitLeagueDraftRoomRevalidate(leagueId)
    } catch {
      setError(t('lsEd.ro.resetRequestFailed'))
    } finally {
      setSaving(false)
    }
  }, [applyPayload, confirmFetch, defaultTemplateKey, isCommissioner, leagueId, rosterSport, slotDefs, templates])

  const groups = useMemo(
    () => buildRosterGroups(slotDefs, pendingSlots, { isCommissioner, sport: rosterSport }),
    [slotDefs, pendingSlots, isCommissioner, rosterSport],
  )

  if (loading) return <div className="py-8 text-center text-sm text-white/50">{t('lsEd.ro.loading')}</div>

  const sportName = sportLabel(rosterSport ?? leagueSport)

  if (unavailable) {
    return (
      <RosterSettingsModalShell title={t('lsEd.ro.title')} subtitle={t('lsEd.ro.subtitle')}>
        <div className="af-ls-card text-[13px] text-white/70" data-testid="roster-settings-unavailable">
          {t('lsEd.ro2.unavailable').replace('{{sport}}', sportName)}
        </div>
      </RosterSettingsModalShell>
    )
  }

  const hasChanges = Boolean(config) && JSON.stringify(pendingSlots) !== JSON.stringify(baselineSlots)
  const canEdit = isCommissioner && !readOnlyMode
  const badge = (
    <>
      <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white/70">
        {sportName}
      </span>
      {!isCommissioner || readOnlyMode ? (
        <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] font-semibold text-white/60">
          {t('lsEd.ro.readOnly')}
        </span>
      ) : null}
    </>
  )

  return (
    <>
      {midSeasonDialog}
    <RosterSettingsModalShell title={t('lsEd.ro.title')} subtitle={t('lsEd.ro.subtitle')} badge={badge}>
      <RosterValidationBanner warnings={warnings} errors={error ? [error] : []} />

      {foreignRoster && (
        <div className="break-words rounded-xl border border-amber-500/25 bg-amber-950/20 px-3 py-2 text-xs text-amber-200" data-testid="roster-sport-mismatch">
          {t('lsEd.ro2.sportMismatch').split('{{sport}}').join(sportName)}
        </div>
      )}

      {!foreignRoster && !matchesTemplate && (
        <div className="break-words rounded-xl border border-amber-500/25 bg-amber-950/20 px-3 py-2 text-xs text-amber-200">
          {t('lsEd.ro.noMatch')}
        </div>
      )}

      {(() => {
        // The roster label whose starters match. Bench and IR/IL are the league's own counts.
        const sport = sportLabel(rosterSport)
        const match = !foreignRoster && (sport === 'NFL' || sport === 'NBA') ? matchRosterLabel(sport, pendingSlots) : null
        return match ? (
          <div className="af-ls-card text-white" data-testid="roster-settings-label">
            <RosterLabel id={match.label.id} size="md" bench={match.shape.bench} injured={match.shape.injured} showText={false} />
          </div>
        ) : null
      })()}

      {canEdit && templates.length > 0 && (
        <div className="af-ls-card space-y-2">
          <label htmlFor={`roster-template-${leagueId}`} className="af-ls-eyebrow block">{t('lsEd.ro.template')}</label>
          <div className="flex min-w-0 gap-2">
            <select
              id={`roster-template-${leagueId}`}
              value={selectedTemplateKey}
              onChange={(event) => setSelectedTemplateKey(event.target.value)}
              aria-label={t('lsEd.ro.templateAria')}
              title={t('lsEd.ro.templateAria')}
              className="min-w-0 flex-1 truncate rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-[13px] text-white outline-none focus:border-cyan-500/50"
            >
              {templates.map((template) => (
                <option key={template.key} value={template.key}>
                  {template.label}
                </option>
              ))}
              <option value="custom">{t('lsEd.ro.custom')}</option>
            </select>
            <button
              type="button"
              onClick={applySelectedTemplate}
              disabled={selectedTemplateKey === 'custom' || saving}
              className="shrink-0 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-[12px] font-semibold text-white/80 transition hover:bg-white/10 disabled:cursor-default disabled:opacity-40"
            >
              {t('lsEd.ro.applyTemplate')}
            </button>
          </div>
        </div>
      )}

      {(readOnlyMode || !isCommissioner) && (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2 text-[12px] text-white/60">
          {t('lsEd.ro.commishOnly')}
        </div>
      )}

      <RosterSectionRenderer
        groups={groups}
        pendingSlots={pendingSlots}
        isCommissioner={canEdit}
        football={isFootballSport(rosterSport)}
        onAdjust={(key, delta) => {
          setSelectedTemplateKey('custom')
          adjust(key, delta)
        }}
      />

      {canEdit && (
        <div className="space-y-2 border-t border-white/10 pt-3">
          {success && (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/20 px-3 py-2 text-xs text-emerald-300" data-testid="roster-settings-saved">
              {t('lsEd.ro.saved')}
              {draftNote ? <span className="mt-1 block text-emerald-200/80">{draftNote}</span> : null}
            </div>
          )}
          <button
            type="button"
            disabled={saving || !hasChanges}
            onClick={save}
            className="w-full rounded-xl bg-cyan-600/80 px-4 py-2.5 text-sm font-semibold text-white hover:bg-cyan-600 disabled:opacity-50"
          >
            {saving ? t('lsEd.saving') : t('lsEd.save')}
          </button>
          <div className="flex min-w-0 flex-wrap gap-2">
            <button
              type="button"
              onClick={resetToLeagueDefault}
              disabled={saving || (matchesTemplate && !foreignRoster && selectedTemplateKey === (defaultTemplateKey ?? selectedTemplateKey))}
              className="min-w-0 flex-1 rounded-xl border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-[12px] font-semibold text-amber-200 transition hover:bg-amber-900/25 disabled:cursor-default disabled:opacity-40"
            >
              {t('lsEd.ro.resetLeague')}
            </button>
            {hasChanges && (
              <ResetToDefaultButton onClick={resetToSaved} disabled={saving} />
            )}
          </div>
        </div>
      )}
    </RosterSettingsModalShell>
    </>
  )
}

/** One line for the roster save's `draftRounds` result (lib/draft/syncDraftRoundsToRoster.ts). */
function describeDraftRoundsSync(result: unknown, t: (key: string) => string): string | null {
  if (!result || typeof result !== 'object') return null
  const r = result as { synced?: boolean; rounds?: number; reason?: string }
  if (r.synced && typeof r.rounds === 'number') return t('lsEd.ro.draftSynced').replace('{{n}}', String(r.rounds))
  if (r.reason === 'manual_override') return t('lsEd.ro.draftKept')
  if (r.reason === 'draft_started') return t('lsEd.ro.draftStarted')
  return null
}
